/**
 * amsg2 多任务清单的读取/派生工具集。
 *
 * 主要在浏览器侧用；worker bundle 也会打进这份代码（fire 时要渲染「你现在还挂着哪些排程」，
 * 见 buildFireTaskListBlock）。所以这里只能依赖纯函数叶子，别往上引前端环境的东西。
 * 另外：worker 跑在 UTC，任何显示给角色看的时间都得按 fire_pack 的时区参照系（tzId）
 * 换算，不能用 formatTaskTime 那种吃运行时本地时区的写法。
 *
 * 状态设计：清单只存 'scheduled'（取消即移除记录）。到点后的一次性任务不回写
 * 状态——「已发送 / 已作废」由消息历史现场推导（amsg2TaskContext），避免
 * React 之外（push 送达路径）写角色数据引发状态竞争。过点 48h 的一次性任务
 * 由 pruneStaleTasks 在下一次任务变更落盘时顺手清掉。
 */

import {
  ActiveMsg2CharacterConfig,
  ActiveMsg2ExpirePolicy,
  ActiveMsg2Mode,
  ActiveMsg2Recurrence,
  ActiveMsg2TaskRecord,
  CharacterProfile,
} from '../types';
import { FIRE_GRACE_MS, recurrencePeriodMs } from './amsg2ExpireGuard';
import { AMSG_INSTANT_CHAT_SUBTYPE, type AmsgTzRef, formatFireTimeShort } from './amsgFirePack';

export const MAX_ACTIVE_TASKS_PER_CHAR = 5;

/**
 * 这个角色是否开着主动消息 2.0。
 *
 * 只有在设置面板里把开关打开过（持久化 enabled:true）才算开。从没配过的角色
 * （config 缺失）算关——注入工具前必须过这道判定，否则用户还没表态要不要用，
 * 角色已经能调 schedule_active_message 给他排定时消息了。
 *
 * 面板的开关初值和工具注入门都读这一个判定，别各写各的三元——两处答案不一致的话，
 * 面板显示「关」而角色其实照样能排程，界面就成了骗人的那一方。
 *
 * 「关」是默认值，不是需要迁移掉的旧数据：写 activeMsg2Config 的每条路（面板保存、
 * 角色用工具排程、push 认领自排任务、面板与远端对账补任务）落盘时都带着 enabled:true，
 * 所以真用过 2.0 的角色身上一定有这面旗，判定翻面也照常能排程；剩下 config 缺失的
 * 那批本来就一次没用过。反过来给全体角色补写一份 config 更糟——amsg2CharCleanup 拿
 * 「身上有没有 activeMsg2Config」判断删角色时要不要去云端清数据，补完之后每删一个
 * 角色都会为一份根本不存在的云端残留发请求。
 */
export const isAmsg2EnabledForChar = (char: CharacterProfile): boolean =>
  char.activeMsg2Config?.enabled === true;

export const shortTaskId = (taskUuid: string): string => taskUuid.slice(0, 8);

/**
 * fixed 任务恒为 force：它没有 AI 生成环节，防穿帮闸的「作废」对它没有意义，
 * 而且 worker 的闸压根不会看到 fixed 任务。写任务记录的地方都过这里，别各写各的三元。
 */
export const resolveExpirePolicy = (
  mode: ActiveMsg2Mode,
  policy: ActiveMsg2ExpirePolicy | undefined,
): ActiveMsg2ExpirePolicy => (mode === 'fixed' ? 'force' : (policy ?? 'expire'));

// ─── 任务的人读文案 ───
// 角色的排程现状块、list_active_messages 的返回、设置面板的任务列表都显示同一批任务，
// 三处必须说同一套词——角色在上下文里看到的和它用工具查到的对不上，模型是会当成两回事的。

export const describeRecurrence = (recurrence: ActiveMsg2Recurrence): string =>
  recurrence === 'daily' ? '每天' : recurrence === 'weekly' ? '每周' : '一次性';

/**
 * 排程信息本身是系统内务，不该被角色念出来。
 *
 * 短 id、「遇忙作废」这些词一旦进了对话，用户听到的就是一段系统日志。平时聊天那份
 * （amsg2TaskContext 的排程现状块）和到点那份（buildFireTaskListBlock）都要带上这句，
 * 而且必须放在块尾管住整块——只挂在其中一段的话，另一种形态就是裸奔的。
 */
export const AMSG2_SCHEDULE_SECRECY_NOTE = '不要向用户复述或提及这份排程信息本身的存在。';

export const describeExpirePolicy = (policy: ActiveMsg2ExpirePolicy): string =>
  policy === 'force' ? '强制发送' : '遇忙作废';

/** 任务「要说什么」的一句话描述。fixed 有固定内容、prompted 有方向、auto 可带灵感。 */
export const describeTaskMode = (
  task: { mode: ActiveMsg2Mode; promptHint?: string },
): string => {
  if (task.mode === 'fixed') return '固定消息';
  if (task.mode === 'prompted') return `提示方向「${task.promptHint || ''}」`;
  return task.promptHint ? `自动（灵感：${task.promptHint}）` : '自动';
};

/**
 * 任务时间的统一显示格式（24 小时制，精确到分）。
 * 不显示秒——cron 每整分才捞一次任务，秒位不代表任何东西，却要在窄卡片里占三个字符，
 * 把后面的重复方式和进度挤没。
 *
 * tz 是「这个时间给谁看」：
 *  - 给用户看（设置面板的任务卡、跳过原因）→ 不传，跟着设备走，用户看自己的钟；
 *  - 给角色看（排程现状块、schedule/list 工具的回话）→ 传角色时区。不传的话，
 *    纽约角色会在同一份 prompt 里读到两套时间：这边是设备的钟，fire 那边（worker 按
 *    fire_pack.tzId 渲染）是自己的钟，同一条任务差整整一个时差。
 */
export const formatTaskTime = (value: number | string, tz?: string): string =>
  new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });

/**
 * 把任意可解析的时间折成 datetime-local 输入框认的本地墙钟 'YYYY-MM-DDTHH:mm'。
 * 任务的 firstSendTime 有两种来源：面板建的本就是 datetime-local，角色用工具建的是
 * 完整 ISO 8601（带时区）——编辑角色任务时不折算会导致时间框空白。已是该格式的原样
 * 返回（幂等）；无法解析（空 / 坏值）也原样返回，不抛错。
 */
export const toDatetimeLocalValue = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
};

/**
 * datetime-local 输入框的值 → 绝对时刻（UTC ISO）。toDatetimeLocalValue 的逆操作。
 *
 * 设置面板的时间框是给**用户**填的，填的是用户桌上的钟。而排程接口拿到裸墙钟
 * （没有 Z / ±hh:mm 后缀）一律按**角色**时区解释——那条规则是给角色自己排程用的
 * （纽约角色说「明早九点」就该是纽约的九点）。两边共用同一个字符串的话，角色一开
 * 自定义时区，用户填的时间就会被当成角色那边的墙钟，同一条任务差整整一个时差。
 * 所以面板在交出去之前先按设备时区折成绝对时刻，让后面所有环节都只认这一个时刻。
 *
 * 无法解析（空 / 坏值）原样返回，交给下游报错，不在这里抛。
 */
export const fromDatetimeLocalValue = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
};

export const findTaskByShortId = (
  tasks: ActiveMsg2TaskRecord[],
  shortId: string,
): ActiveMsg2TaskRecord | undefined =>
  tasks.find((t) => shortTaskId(t.taskUuid) === shortId || t.taskUuid === shortId);

/** 待触发 = 还会响的任务：循环任务恒真；一次性任务触发点（含宽限）未过。 */
export const isPendingTask = (task: ActiveMsg2TaskRecord, nowMs: number): boolean => {
  if (task.status !== 'scheduled') return false;
  if (task.recurrenceType !== 'none') return true;
  const fireAt = new Date(task.firstSendTime).getTime();
  return Number.isFinite(fireAt) && fireAt + FIRE_GRACE_MS > nowMs;
};

/**
 * 当前该盯的那一次触发时刻。
 *
 * 一次性任务恒为 firstSendTime。循环任务的 firstSendTime 是「第一次」的时间，可能在
 * 好几天前，必须按周期推到当前这一次——否则清单会给一条每天的任务显示好几天前的时间
 * 配上「待触发」，看着就像过点了没响。停留条件用的是「加上送达宽限后仍在未来」，跟
 * isPendingTask 同一把尺，这样刚过点还在发的那一次不会被跳过。
 */
export const currentOccurrenceMs = (
  task: Pick<ActiveMsg2TaskRecord, 'firstSendTime' | 'recurrenceType' | 'nextSendAt'>,
  nowMs: number,
): number | null => {
  // 远端对过账就以它为准：循环任务按角色所在时区的墙钟推进，本地按固定周期乘出来的
  // 那个一跨夏令时就会跟真正会响的时刻差一小时。还没到点的那次才作数——已经过点的
  // 说明还没对上这一轮的账，照旧自己推。
  const remoteNext = task.nextSendAt ? new Date(task.nextSendAt).getTime() : NaN;
  if (Number.isFinite(remoteNext) && remoteNext + FIRE_GRACE_MS > nowMs) return remoteNext;

  const first = new Date(task.firstSendTime).getTime();
  if (!Number.isFinite(first)) return null;

  const periodMs = recurrencePeriodMs(task.recurrenceType);
  if (periodMs === null) return first;

  // 找最小的 k（≥0）使 first + k*period + GRACE > now，直接算不要逐个迭代——
  // 循环任务可能已经跑了几个月。
  const k = Math.max(0, Math.floor((nowMs - FIRE_GRACE_MS - first) / periodMs) + 1);
  return first + k * periodMs;
};

/**
 * 任务当前进度的一句话（清单里跟在「重复方式」后面那个词）。
 *
 * 已过点的一次性任务光说「已到点」信息量为零——用户看不出它是发过了还是卡住了。
 * 远端底账正好能分辨：那一行还在 = worker 还没消费（cron 慢了或刚过点）；不在了 =
 * worker 已经处理完（发出去了，或者被防穿帮闸作废了，两种情况都会删行）。
 * 底账没拉到（null）时不猜，回到中性的「已到点」。
 *
 * remoteStatus 是远端那一行的 status（拉到底账时顺带的投影，没有就不传）：
 * 一次性任务重试用完会被标 'failed' 留在远端，不会再被消费——这时候还说
 * 「待处理」是骗人，它不会有下文了。
 */
export const describeTaskProgress = (
  task: ActiveMsg2TaskRecord,
  knownRemoteUuids: Set<string> | null,
  nowMs: number,
  remoteStatus?: string,
): string => {
  if (isPendingTask(task, nowMs)) return '待触发';
  if (knownRemoteUuids === null) return '已到点';
  if (!knownRemoteUuids.has(task.taskUuid)) return '已触发';
  return remoteStatus === 'failed' ? '发送失败' : '已到点·待处理';
};

export const getPendingTasks = (
  config: ActiveMsg2CharacterConfig | undefined,
  nowMs: number,
): ActiveMsg2TaskRecord[] =>
  (config?.tasks ?? []).filter((t) => isPendingTask(t, nowMs));

/** 这个任务的触发有没有可能被防穿帮闸作废（fixed / force 永远照发）。 */
export const canExpire = (task: ActiveMsg2TaskRecord): boolean =>
  task.status === 'scheduled' && task.mode !== 'fixed' && task.expirePolicy === 'expire';

/** 有没有还会响的 AI 任务（amsgStateSync 的同步门用：fixed 不需要 fire_pack）。 */
export const hasActiveAiTask = (
  config: ActiveMsg2CharacterConfig | undefined,
  nowMs = Date.now(),
): boolean => getPendingTasks(config, nowMs).some((t) => t.mode !== 'fixed');

/**
 * fire 时刻注进 prompt 的「你现在还挂着哪些排程」。
 *
 * 跟平时聊天那份（amsg2TaskContext 的排程现状块）说的是同一件事、用同一套 describeXxx
 * 文案，差别只有三处，都是 fire 这边特有的：
 *   1. 时间按 fire_pack 的时区参照系（tzId）换算——
 *      worker 跑在 UTC，用运行时本地时区会整体差几个小时；
 *   2. 摘掉正在发的这一条 —— 它此刻正在被消费，列进「进行中」会让角色以为还得再排一次；
 *   3. 不含「已作废回执」那一段 —— 那是给对话现场用的，到点生成时提不着。
 *
 * 没有可列的（清单空了，或者只剩正在发的这条）→ 返回空串，槽位被抹平。
 */
export const buildFireTaskListBlock = (
  tasks: ActiveMsg2TaskRecord[],
  opts: { nowMs: number; tzId: string; excludeClientTaskId?: string },
): string => {
  const tz: AmsgTzRef = { tzId: opts.tzId };
  const listed = tasks
    .filter((t) => isPendingTask(t, opts.nowMs))
    .filter((t) => !opts.excludeClientTaskId || t.clientTaskId !== opts.excludeClientTaskId);
  if (listed.length === 0) return '';

  return [
    '',
    '',
    '【你还挂着这些排程·仅你可见】',
    ...listed.map((t) => {
      const occurrenceMs = currentOccurrenceMs(t, opts.nowMs);
      const when = formatFireTimeShort(
        occurrenceMs ?? new Date(t.firstSendTime).getTime(),
        tz,
      );
      return `- [${shortTaskId(t.taskUuid)}] ${when} ${describeRecurrence(t.recurrenceType)}`
        + ` · ${describeTaskMode(t)} · ${describeExpirePolicy(t.expirePolicy)}`;
    }),
    '（这几条到点会自动发出去，别在这条消息里把同一件事再排一遍，也别当它们不存在。）',
    AMSG2_SCHEDULE_SECRECY_NOTE,
  ].join('\n');
};

// ─── 远端 lastError：上一次到点为什么没发出去 ───
// amsg-server 2.6.0-next.10 起 GET /messages 每条任务多带 lastError（run-tick 在
// 失败时写进 payload）：{ at: 记录时刻 ISO, occurrence: 那一次的名义触发时刻 ISO,
// reason: 'stale'（错过触发时刻太久被跳过）| 投递失败的原始错误信息 }。
// 服务端只在失败时写、之后成功也不清，所以它永远是「最近一次失败」的记录——
// 显示时必须带上时间，老记录才不会被读成「现在还坏着」。

export interface RemoteTaskLastError {
  at?: string;
  occurrence?: string;
  reason?: string;
}

/** 远端投影是解密出来的任意 JSON，进 UI 前收敛一遍形状；全空/不是对象 → null。 */
export const parseRemoteTaskLastError = (raw: unknown): RemoteTaskLastError | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const pick = (key: string): string | undefined =>
    typeof value[key] === 'string' && value[key] ? (value[key] as string) : undefined;
  const parsed: RemoteTaskLastError = {
    at: pick('at'),
    occurrence: pick('occurrence'),
    reason: pick('reason'),
  };
  return parsed.at || parsed.occurrence || parsed.reason ? parsed : null;
};

/** reason 是投递失败时的原始错误信息，可能整段 HTML/堆栈，卡片上截个头就够。 */
const REMOTE_ERROR_REASON_MAX = 60;

/**
 * 远端 lastError 的人话（任务卡片上那行说明）。formatTime 由调用方注入
 * （面板用 formatTaskTime）；时间优先用 occurrence（「哪一次」比「什么时候记的」
 * 更贴用户想知道的事），没有再退 at。
 */
export const describeRemoteLastError = (
  lastError: RemoteTaskLastError | null | undefined,
  formatTime: (iso: string) => string,
): string | null => {
  if (!lastError) return null;
  const when = lastError.occurrence || lastError.at;
  const whenText = when ? `${formatTime(when)} ` : '';
  if (lastError.reason === 'stale') {
    return `${whenText}到点时已过期太久，跳过了一次`;
  }
  const reason = (lastError.reason || '').slice(0, REMOTE_ERROR_REASON_MAX);
  return `${whenText}上次到点没发出去（连续失败${reason ? `：${reason}` : ''}）`;
};

/**
 * 即时对话那一轮失败的人话。读的是同一份 lastError，但换一套说法：那是用户刚按下
 * 发送的一条消息，「上次到点没发出去」这种排程口吻放在这里不成话。时间也不带——
 * 就是刚才，写出来只是噪音。retryCount 是远端行上的重试次数（旧 worker 不投影 → 不提）。
 */
export const describeInstantChatFailure = (
  lastError: RemoteTaskLastError | null | undefined,
  retryCount?: number,
): string | null => {
  if (!lastError) return null;
  const retried = retryCount && retryCount > 0 ? `（重试 ${retryCount} 次后放弃）` : '';
  // 'stale' 是「排队太久没轮到就被跳过」，没有底层报错可以引。
  if (lastError.reason === 'stale') return `云端排队太久没轮到这一轮${retried}`;
  // skip-push 的两种（worker 在 chat_fail 里留的机器码）：这一轮云端跑完了，但没有
  // 能推给用户的正文。照实说，别掉进下面「生成失败」的口径——生成没失败，是没产出。
  if (lastError.reason === 'empty-generation') return '模型这轮没有生成内容（空输出或拒答）';
  if (lastError.reason === 'side-effects-only') return '角色这轮只做了动作，没有文字回复';
  const detail = (lastError.reason || '').slice(0, REMOTE_ERROR_REASON_MAX);
  return `生成失败${retried}${detail ? `：${detail}` : ''}`;
};

/** 替换任务时远端取消失败的标注文案（面板和工具侧共用一份，两边都会显示给人看）。 */
export const REPLACE_CANCEL_FAILED_NOTE = '替换时远端取消失败，任务可能仍会触发，可再次取消';

// ─── 远端对账：哪些任务在远端还活着 ───
// 面板打开时拉一次全量清单当底账，之后**不再重拉**，而是把每次远端操作的结果增量记进来。
// 底账是「打开那一刻」的快照，拿它去比对之后新建的任务，新任务必然不在里面——那样每次
// 新建都会立刻误标一行「远端不存在」，是纯粹的时序错觉。排程接口回了 success 就是这条
// 任务在远端存在的确证，直接记账即可，不用再多跑一次全量拉取。

/**
 * 把一次远端操作的结果并进底账。
 * `present` = 刚确认在远端存在的（新建/替换成功）；`gone` = 刚确认已不在的（取消成功）。
 *
 * 底账为 null（没拉到）时保持 null：新建一条任务并不能说明**其余**任务在不在远端，
 * 凭这半份证据开始对账会把别的任务全标成「远端不存在」。
 */
export const applyRemoteTaskDelta = (
  knownRemoteUuids: Set<string> | null,
  delta: { present?: string[]; gone?: string[] },
): Set<string> | null => {
  if (!knownRemoteUuids) return null;
  const next = new Set(knownRemoteUuids);
  delta.gone?.forEach((uuid) => next.delete(uuid));
  delta.present?.forEach((uuid) => next.add(uuid));
  return next;
};

/** `GET /messages` 的任务投影（worker 侧白名单，不含任何凭据）里用得上的字段。 */
export interface RemoteTaskProjection {
  uuid: string;
  status?: string;
  lastError: RemoteTaskLastError | null;
  clientTaskId?: string;
  messageType?: string;
  /** 排程方写的自由文本标签；即时对话的行是 'instant-chat'，定时任务是 'chat'。 */
  messageSubtype?: string;
  recurrenceType?: string;
  nextSendAt?: string;
  /** 远端行上的重试计数（旧 worker 不投影这字段 → undefined）。 */
  retryCount?: number;
}

/**
 * 拿远端全量投影跟本地清单对一次账，两个方向都走。
 *
 * **远端有、本地没有 → 补回来。** 会漏账的都是角色在 fire 里给自己排的那些：认领是
 * 随 push 带回来的，那条 push 推失败、或者被防穿帮闸吞掉，认领就跟着没了。于是任务在
 * D1 里照常到点触发，本地却列不出来、也取消不掉——用户唯一能清掉它的办法是关掉整个
 * 2.0 或者删角色。面板每次打开本来就拉一次全量投影，顺手接回来，零额外请求。
 *
 * **本地已有 → 同步远端算出来的下一次触发时刻。** 循环任务按角色所在时区的墙钟推进，
 * 本地拿固定周期乘出来的那个跨夏令时会偏一小时，显示得跟真正会响的时刻一致。
 */
export const reconcileTasksWithRemote = (
  local: ActiveMsg2TaskRecord[],
  remote: RemoteTaskProjection[],
): ActiveMsg2TaskRecord[] => {
  const byUuid = new Map(remote.map((r) => [r.uuid, r]));
  const known = new Set(local.map((t) => t.taskUuid));

  const synced = local.map((task) => {
    const row = byUuid.get(task.taskUuid);
    if (!row?.nextSendAt || row.nextSendAt === task.nextSendAt) return task;
    return { ...task, nextSendAt: row.nextSendAt };
  });

  const adopted = remote
    // 字段不全的行不补：宁可少一条，也别拿默认值凑一条跟远端对不上的记录出来。
    // 已经失败的行也不补：它不会再响，补进来就是清单上一条永远等不到的幽灵任务。
    // 即时对话的行同样不补：那是用户此刻正等着的一轮聊天，不是排程，进了清单会显示成
    // 「待触发的任务」，还可能被「取消全部」顺手掐掉。
    .filter((row) => (
      !known.has(row.uuid)
      && row.nextSendAt && row.recurrenceType && row.messageType
      && row.status !== 'failed'
      && row.messageSubtype !== AMSG_INSTANT_CHAT_SUBTYPE
    ))
    .map((row): ActiveMsg2TaskRecord => ({
      taskUuid: row.uuid,
      // 归属键是应用自己写进 metadata 的，投影里带回来；非 amsg2 建的任务没有，
      // 那就拿 uuid 当归属键——它一样是唯一的。
      clientTaskId: row.clientTaskId ?? row.uuid,
      mode: row.messageType as ActiveMsg2TaskRecord['mode'],
      firstSendTime: row.nextSendAt as string,
      nextSendAt: row.nextSendAt,
      recurrenceType: row.recurrenceType as ActiveMsg2Recurrence,
      // 远端投影没有防穿帮策略（那是应用写在 metadata 里的语义，投影不带）。
      // 补回来的都是角色自排的，那条路径恒为 expire。
      expirePolicy: 'expire',
      source: 'character',
      status: 'scheduled',
      createdAt: Date.now(),
    }));

  return adopted.length ? [...synced, ...adopted] : synced;
};

/**
 * 这条任务该不该标「远端不存在」。
 * 只对**还会响**的任务判定：已过点的一次性任务本来就该从远端消失，标它是噪音。
 */
export const isRemoteMissingTask = (
  task: ActiveMsg2TaskRecord,
  knownRemoteUuids: Set<string> | null,
  nowMs: number,
): boolean =>
  knownRemoteUuids !== null
  && isPendingTask(task, nowMs)
  && !knownRemoteUuids.has(task.taskUuid);

/**
 * 已经走完的一次性任务出清单。
 *
 * 「走完」= 过了触发点、远端底账里也没有这一行。worker 领走任务后就会删掉那行，
 * 所以底账里找不到它 = 这一次已经处理完了，本地留着只会让清单越积越长（一天测下来
 * 就能攒出十来条一模一样的「已触发」）。判定跟 describeTaskProgress 是同一把尺：
 * 那里写「已触发」的，正是这里清掉的。
 *
 * 两种情况一律留着：
 *   - 带 lastError 的（比如替换时远端取消失败，远端可能还会照发）——那行错误是用户
 *     唯一能看见的线索，自动清掉等于把问题藏起来；
 *   - 底账没拉到（null）——分不出「远端处理完了」和「压根没读到远端」，一条都不动。
 *
 * 循环任务永远还会响，isPendingTask 对它们恒真，不会被这里带走。
 */
export const pruneFiredTasks = (
  tasks: ActiveMsg2TaskRecord[],
  knownRemoteUuids: Set<string> | null,
  nowMs: number,
): ActiveMsg2TaskRecord[] => {
  if (knownRemoteUuids === null) return tasks;
  return tasks.filter((task) => Boolean(task.lastError)
    || isPendingTask(task, nowMs)
    || knownRemoteUuids.has(task.taskUuid));
};

/**
 * 排程 / 替换成功后把新记录并进清单。
 *
 * 替换失败时**保留旧记录并标错**，绝不静默丢掉：远端此时新旧并存，本地要是只留新的，
 * 旧任务就成了没有短 id、谁都取消不了的幽灵任务。面板和角色工具两条路都走这里，
 * 规则只有一份。
 */
export const applyScheduledTask = (
  tasks: ActiveMsg2TaskRecord[],
  record: ActiveMsg2TaskRecord,
  opts: { replaceTaskUuid?: string; replacedCancelFailed?: boolean },
  nowMs: number,
): ActiveMsg2TaskRecord[] => {
  const rest = opts.replacedCancelFailed
    ? tasks.map((t) => t.taskUuid === opts.replaceTaskUuid
      ? { ...t, lastError: REPLACE_CANCEL_FAILED_NOTE }
      : t)
    : tasks.filter((t) => t.taskUuid !== opts.replaceTaskUuid);
  return pruneStaleTasks([...rest, record], nowMs);
};

/**
 * 关闭主动消息后，清单里该留下谁 —— 只留「远端还活着」的两类：
 *   1. 取消失败的（attempted 过但 failed）；
 *   2. 取消期间才出现的（不在 attempted 里，比如角色刚在聊天里排的）——压根没被取消过，
 *      跟着一起清掉就又是远端照发、面板看不见的幽灵任务。
 * 其余（成功取消的）出清单。
 */
export const keepUncancelledTasks = (
  tasks: ActiveMsg2TaskRecord[],
  attemptedUuids: Set<string>,
  failedUuids: Set<string>,
  notes: { failed: string; appeared: string },
): ActiveMsg2TaskRecord[] =>
  tasks
    .filter((t) => failedUuids.has(t.taskUuid) || !attemptedUuids.has(t.taskUuid))
    .map((t) => ({
      ...t,
      lastError: failedUuids.has(t.taskUuid) ? notes.failed : notes.appeared,
    }));

/**
 * 过点超过 48h 的一次性任务出清单。
 * 这个 48h 是三条时间线里最长的一条：排程现状块只回看 40h（AMSG2_TASK_LOOKBACK_MS）、
 * 作废回执台账留 48h，所以任务一定活到「该不该给回执」判完之后才被清走。
 */
export const pruneStaleTasks = (
  tasks: ActiveMsg2TaskRecord[],
  nowMs: number,
): ActiveMsg2TaskRecord[] =>
  tasks.filter((t) => {
    if (t.recurrenceType !== 'none') return true;
    const fireAt = new Date(t.firstSendTime).getTime();
    return !Number.isFinite(fireAt) || fireAt > nowMs - 48 * 3600_000;
  });
