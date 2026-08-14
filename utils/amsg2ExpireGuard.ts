// utils/amsg2ExpireGuard.ts
/**
 * amsg2 防穿帮闸 — 纯判定逻辑。
 *
 * ⚠️ 叶子模块：会被 worker/amsg 打进 Cloudflare bundle，同时被客户端送达兜底
 * （activeMsgRuntime）与排程现状块（amsg2TaskContext）复用——不得 import
 * 浏览器 / DB / React 依赖（与 utils/agenticTools.ts 同一约束）。
 *
 * 语义（设计：claude-notes/2026-07-21-amsg2-liveness-design.md「防穿帮闸」）：
 *   - expire（默认）：到点时对话已前进 → 作废，转「排程现状块」告知；
 *   - force：闹钟型，照发；
 *   - 一次性任务「对话前进」= 创建锚点之后出现真实用户消息；
 *   - 循环任务只看「到点前 ACTIVE_CHAT_WINDOW_MS 内是否在聊」——用锚点的话，
 *     昨天聊过天就会永久作废今天的早安。
 */

export type AmsgExpirePolicy = 'expire' | 'force';

/** 循环任务的「正在聊天」窗口：到点前 10 分钟内有真实用户消息就算热聊。 */
export const ACTIVE_CHAT_WINDOW_MS = 10 * 60_000;

/** 触发时刻附近的推理/送达宽限（fire 后 10-30s 才送达，判定窗口向后放这么多）。 */
export const FIRE_GRACE_MS = 90_000;

/** 排程现状块只回看这么久内的触发时刻，太老的不再提。 */
const DEFAULT_LOOKBACK_MS = 48 * 3600_000;

const DAY_MS = 24 * 3600_000;

/** 循环任务两次触发之间隔多久；一次性任务没有周期，返回 null。 */
export const recurrencePeriodMs = (recurrenceType: string | undefined): number | null =>
  recurrenceType === 'daily' ? DAY_MS
    : recurrenceType === 'weekly' ? 7 * DAY_MS
      : null;

export interface ExpireFireInput {
  policy: string | undefined;
  recurrenceType: string | undefined;
  /** 任务创建时最后一条真实用户消息的时间戳；没有为 0 / null。 */
  anchorMs: number | null | undefined;
  /** 判定时刻已知的最后一条真实用户消息时间戳。 */
  lastUserMessageAt: number | null | undefined;
  nowMs: number;
  /**
   * 本次触发时刻。循环任务的「正在聊天」窗口锚定它而不是 nowMs——生成+送达可能比到点
   * 晚十几分钟，拿判定时刻算 10 分钟窗会把撞上对话的消息误放行。worker 在到点当时判定
   * （两者几乎相等），客户端送达兜底则晚得多，所以必须显式给。
   */
  occurrenceMs: number | null | undefined;
}

/**
 * fire 时刻该不该作废这次触发。worker onBeforeFire（数据来自 fire_pack /
 * task metadata）与客户端送达兜底（数据来自本地历史 / push metadata）共用。
 * 判不了（缺策略 / 缺数据）一律放行——宁可让兜底层再拦，不误杀。唯一的例外是
 * 「排程时有对话、现在一条都没有」，那不是缺数据而是对话被清空了，见函数末尾。
 */
export function shouldExpireFire(input: ExpireFireInput): boolean {
  if (input.policy !== 'expire') return false;
  // 任务身份整组缺失（既没有 recurrenceType 也没有 occurrenceMs）：判不了，放行。
  // 客户端送达兜底闸会碰上——老版本 SW 落的收件箱行没有这两个顶层字段，循环任务会被
  // 当成一次性走锚点规则，只要用户在排任务之后聊过天就恒吞，每天的早安一条都到不了。
  // worker 侧走不到这条：occurrenceMs 由 onBeforeFire 解析校验过，恒为有限数。
  if (input.recurrenceType == null && input.occurrenceMs == null) return false;
  const last = input.lastUserMessageAt;
  if (input.recurrenceType === 'daily' || input.recurrenceType === 'weekly') {
    if (last == null) return false;
    // 缺触发时刻就算不出窗口，跟缺锚点一样放行——这道闸宁可让兜底层再拦，不误杀。
    if (input.occurrenceMs == null) return false;
    return last > input.occurrenceMs - ACTIVE_CHAT_WINDOW_MS && last <= input.nowMs;
  }
  const anchor = input.anchorMs;
  if (anchor == null) return false;
  // 排程那一刻对话是存在的（anchor > 0），到点却一条真实用户消息都找不到 = 用户把聊天
  // 记录清空了。这时候还发，出来就是一条指着不存在的对话往下说的消息，按作废处理（走
  // 既有 skip + 回执链路，面板照实说明）。anchor 为 0 是「从没聊过就排的任务」，照发。
  if (last == null) return anchor > 0;
  return last > anchor;
}

export interface RealUserMessageLike {
  role: string;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
}

/** 「真实用户消息」定义与 activeMsgClient.buildTimeGapHint 保持一致。 */
const isRealUserMessage = (m: RealUserMessageLike): boolean =>
  m.role === 'user' && !(m.metadata as { proactiveHint?: unknown } | null | undefined)?.proactiveHint;

export function getLastRealUserMessageAt(messages: RealUserMessageLike[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserMessage(messages[i])) return messages[i].timestamp;
  }
  return null;
}

/** (afterMs, beforeMs] 内是否有真实用户消息。 */
export function hasRealUserMessageBetween(
  messages: RealUserMessageLike[],
  afterMs: number,
  beforeMs: number,
): boolean {
  return messages.some((m) =>
    isRealUserMessage(m) && m.timestamp > afterMs && m.timestamp <= beforeMs);
}

/** 送达判定的回看窗：触发时刻之后这么久内的消息才算这次触发的产物。 */
const DELIVERED_WINDOW_MS = 30 * 60_000;

/**
 * 某个触发时刻附近是否真的送达过定时主动消息（区分「作废了」和「发出去之后
 * 用户才回复」）。定时任务的落库消息带 metadata.activeMsg2.taskId（非空）；
 * instant 聊天回复的 taskId 是 null，不算。
 *
 * 按精确 id 归属：任务的送达一定带同源 amsgClientTaskId，id 不同或缺 id 的消息都不算
 * 本任务的送达——否则会拿别的任务的送达当证据、误抹掉本任务的作废回执。
 */
export function hasDeliveredProactiveNear(
  messages: RealUserMessageLike[],
  occurrenceMs: number,
  clientTaskId: string,
): boolean {
  return messages.some((m) => {
    if (m.role !== 'assistant') return false;
    const meta = m.metadata as { activeMsg2?: { taskId?: unknown }; amsgClientTaskId?: unknown } | null | undefined;
    if (meta?.activeMsg2?.taskId == null) return false;
    if (meta.amsgClientTaskId !== clientTaskId) return false;
    return m.timestamp >= occurrenceMs - FIRE_GRACE_MS && m.timestamp <= occurrenceMs + DELIVERED_WINDOW_MS;
  });
}

export interface ExpiredNoticeCandidate {
  /** 一次性 = taskUuid；循环 = `${taskUuid}:${occurrenceMs}`。 */
  id: string;
  occurrenceMs: number;
}

export interface DetectExpiredInput {
  taskUuid: string;
  policy: string | undefined;
  recurrenceType: string | undefined;
  /** ISO 字符串，任务首次触发时间。 */
  firstSendTime: string;
  anchorMs: number | null | undefined;
  messages: RealUserMessageLike[];
  nowMs: number;
  lookbackMs?: number;
}

/**
 * 排程现状块的作废检出：回看期内哪些触发时刻满足作废条件。调用方需另用
 * hasDeliveredProactiveNear 排除实际送达过的（这里不做，方便单测各管一半）。
 */
export function detectExpiredOccurrences(input: DetectExpiredInput): ExpiredNoticeCandidate[] {
  if (input.policy !== 'expire') return [];
  const first = new Date(input.firstSendTime).getTime();
  if (!Number.isFinite(first)) return [];
  const horizon = input.nowMs - (input.lookbackMs ?? DEFAULT_LOOKBACK_MS);

  const periodMs = recurrencePeriodMs(input.recurrenceType);
  if (periodMs === null) {
    if (first > input.nowMs || first < horizon) return [];
    if (input.anchorMs == null) return [];
    // 窗口放宽到 nowMs：worker 的 skip 只看「锚点后有没有用户消息」，与 Cron 何时
    // 消费无关（可能晚到点几分钟才 fire）——窄窗会在 Cron 迟到时漏掉回执。
    // 「其实已正常送达」由调用方用 hasDeliveredProactiveNear 按任务归属排除。
    if (!hasRealUserMessageBetween(input.messages, input.anchorMs, input.nowMs)) return [];
    return [{ id: input.taskUuid, occurrenceMs: first }];
  }

  // 快进到回看期起点，别从几个月前逐个迭代。
  let t = first;
  if (t < horizon) t = first + Math.ceil((horizon - first) / periodMs) * periodMs;
  const out: ExpiredNoticeCandidate[] = [];
  for (; t <= input.nowMs; t += periodMs) {
    // 「到点前后都在聊」的对称窗：覆盖 fire 略晚于到点的 Cron 延迟场景。
    if (hasRealUserMessageBetween(input.messages, t - ACTIVE_CHAT_WINDOW_MS, t + ACTIVE_CHAT_WINDOW_MS)) {
      out.push({ id: `${input.taskUuid}:${t}`, occurrenceMs: t });
    }
  }
  return out;
}
