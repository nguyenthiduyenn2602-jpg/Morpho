/**
 * 即时对话（instant chat）的客户端这一半。
 *
 * 一轮聊天在这条路上的样子：按下发送 → 一个 POST 上云（受理即 202）→ 界面挂着
 * 「正在输入…」→ 云端跑完把回复推回来 → 收件箱同一条管线入库、指示灯灭。
 * 客户端发完那一刻就自由了，切后台、杀进程都行。
 *
 * 这份模块管五件事：
 *   1. 开关（唯一门槛在设置页，运行时只读这一份存下来的配置）；
 *   2. 「这一轮还欠着一条回复」的待收记录——它得**扛得住重启**，不然重开 App
 *      指示灯就没了，用户以为消息丢了；
 *   3. 「这一轮还欠着哪几条作废回执」的台账：回执随 chat 段上了云，但要等回复真的
 *      落库才销账，云端整轮失败时它们得退回未告知、下轮重注；
 *   4. 推送丢了的兜底：拉服务端消息账本，把还没收下的塞回收件箱走原路入库；
 *   5. 收尾：云端点名说这条任务已经失败（或那行已经没了）时，先拉一次账本，
 *      还是没有才算这一轮失败、允许重发。等了多久本身不构成结论。
 *
 * 刻意不在这里 flush 收件箱：flushInboxToChat 住在 activeMsgRuntime，那边反过来要用
 * 这里的记录，互相 import 会成环。所以这里只管「写进收件箱」，冲刷由调用方接着做。
 */

import { ActiveMsg2InboxMessage, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../types';
import { ActiveMsgClient, type AmsgOutboxEntry, type InstantChatProbeOutcome } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { trackEvent } from './analytics';
import { cloudApiCallLogId, recordCloudApiCall, settleCloudApiCall } from './apiCallLog';
import { announceEmotionDone } from './chatGenEvents';
import { DB } from './db';
import type { AmsgEmotionEvalSpec } from '../worker/amsg/src/emotionEval';

const HEADER = '[AmsgInstantChat]';

/** 还欠着回复时，前台每隔这么久去云端点名问一次任务状态。不到明确报错不放弃。 */
export const INSTANT_CHAT_STATUS_CHECK_INTERVAL_MS = 60_000;

/** 待收记录的落盘位置。存 localStorage 而不是内存：重启后指示灯要还在。 */
export const AMSG_INSTANT_CHAT_PENDING_LS_KEY = 'amsg2_instant_chat_pending';

/** 待收记录变动时广播；Chat 界面据此点亮/熄灭「正在输入…」。detail 只带 charId。 */
export const AMSG_INSTANT_CHAT_PENDING_EVENT = 'amsg-instant-chat-pending';

export interface AmsgInstantChatPending {
  charId: string;
  /** 这一轮在云端那条任务的 uuid；连发下一条时用它顶掉未认领的这条。 */
  uuid: string;
  /** 受理时刻（epoch ms），排查时看「这一轮等了多久」用。 */
  acceptedAt: number;
  /** 角色名快照（全局横幅显示用）。必填：唯一写入方恒定带上（角色名为空就是空串）。 */
  charName: string;
}

type PendingMap = Record<string, AmsgInstantChatPending>;

const readPendingMap = (): PendingMap => {
  try {
    const parsed = JSON.parse(localStorage.getItem(AMSG_INSTANT_CHAT_PENDING_LS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: PendingMap = {};
    for (const [charId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = value as Partial<AmsgInstantChatPending> | null;
      if (record && typeof record.uuid === 'string' && typeof record.acceptedAt === 'number') {
        // charName 的形状防御是「防 localStorage 损坏/手改」，不是兼容什么旧记录——
        // 这个 key 与写入方同一次发布上线，缺名就按空串补齐。
        result[charId] = {
          charId,
          uuid: record.uuid,
          acceptedAt: record.acceptedAt,
          charName: typeof record.charName === 'string' ? record.charName : '',
        };
      }
    }
    return result;
  } catch {
    return {};
  }
};

const writePendingMap = (map: PendingMap) => {
  // 存储满 / 隐私模式写不进去就算了：指示灯没了比整轮聊天挂掉好。
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(AMSG_INSTANT_CHAT_PENDING_LS_KEY);
    else localStorage.setItem(AMSG_INSTANT_CHAT_PENDING_LS_KEY, JSON.stringify(map));
  } catch { /* 见上 */ }
};

const announcePendingChanged = (charId: string) => {
  try {
    window.dispatchEvent(new CustomEvent(AMSG_INSTANT_CHAT_PENDING_EVENT, { detail: { charId } }));
  } catch { /* SSR / 单测环境没有 window */ }
};

/** 这个角色此刻还欠着一条云端回复吗（没有 = null）。 */
export const getInstantChatPending = (charId: string): AmsgInstantChatPending | null =>
  readPendingMap()[charId] ?? null;

export const listInstantChatPendings = (): AmsgInstantChatPending[] => Object.values(readPendingMap());

/** 受理成功后记一笔。同角色只留最新一条——顶替之后旧 uuid 已经没人认领了。 */
export const setInstantChatPending = (
  charId: string,
  uuid: string,
  acceptedAt = Date.now(),
  charName = '',
): void => {
  const map = readPendingMap();
  map[charId] = { charId, uuid, acceptedAt, charName };
  writePendingMap(map);
  announcePendingChanged(charId);
};

/** 回复到了（或这一轮判定失败）→ 销账。没有记录时是幂等 no-op。 */
export const clearInstantChatPending = (charId: string): boolean => {
  const map = readPendingMap();
  if (!map[charId]) return false;
  delete map[charId];
  writePendingMap(map);
  announcePendingChanged(charId);
  return true;
};

// ─── 随这一轮上云的作废回执 ───

/**
 * 防穿帮闸作废掉的任务，要在下一轮聊天里告诉角色一声（「那条任务没了」）。这些回执
 * 随即时对话的 chat 段冻进云端那一轮，但**回复真的落库之前不能销账**：云端整轮失败
 * （模型空输出被判 skip-push、fire 重试打光）时回执不会重来，角色永远不知道自己许下
 * 的那件事已经作废，既不会续期也不会解释。
 *
 * 所以这里只是个「这一轮欠着哪几条回执」的台账，落 localStorage（跨得过刷新，
 * 云端那一轮本来就可能横跨一次重启）。真正销账（写 notifiedAt）由落库那一侧点名调
 * settleInstantChatExpiredNotices；判定失败走 discard，回执退回未告知、下轮重注。
 */
export const AMSG_INSTANT_CHAT_STAGED_NOTICES_LS_KEY = 'amsg2_instant_chat_staged_notices';

interface StagedNotices {
  charId: string;
  /** 这些回执跟着云端哪一轮走的。销账时对不上就不动——那是上一轮的账。 */
  uuid: string;
  ids: string[];
}

type StagedNoticesMap = Record<string, StagedNotices>;

const readStagedNotices = (): StagedNoticesMap => {
  try {
    const parsed = JSON.parse(localStorage.getItem(AMSG_INSTANT_CHAT_STAGED_NOTICES_LS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: StagedNoticesMap = {};
    for (const [charId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = value as Partial<StagedNotices> | null;
      if (record && typeof record.uuid === 'string' && Array.isArray(record.ids)) {
        const ids = record.ids.filter((id): id is string => typeof id === 'string' && !!id);
        if (ids.length) result[charId] = { charId, uuid: record.uuid, ids };
      }
    }
    return result;
  } catch {
    return {};
  }
};

const writeStagedNotices = (map: StagedNoticesMap) => {
  // 写不进去（存储满 / 隐私模式）就当这一轮没记：回执会在下一轮重新注入，不会丢。
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(AMSG_INSTANT_CHAT_STAGED_NOTICES_LS_KEY);
    else localStorage.setItem(AMSG_INSTANT_CHAT_STAGED_NOTICES_LS_KEY, JSON.stringify(map));
  } catch { /* 见上 */ }
};

/**
 * 记一笔「这几条回执跟着 uuid 这一轮上云了，还没销账」。同角色只留最新一轮：
 * 连发时新那一轮会把老回执连同新的一起重新注入（它们还没被标记告知过）。
 */
export const stageInstantChatExpiredNotices = (charId: string, uuid: string, ids: string[]): void => {
  const kept = ids.filter(Boolean);
  const map = readStagedNotices();
  if (kept.length === 0) delete map[charId];
  else map[charId] = { charId, uuid, ids: kept };
  writeStagedNotices(map);
};

/** 这个角色此刻欠着哪一轮的哪几条回执（没有 = null）。排查和测试用。 */
export const getStagedInstantChatExpiredNotices = (charId: string): StagedNotices | null =>
  readStagedNotices()[charId] ?? null;

/** 从台账里取出并删掉这一轮的记录；uuid 对不上（已经是新一轮了）返回空数组、不动记录。 */
const popStagedNotices = (charId: string, uuid?: string): string[] => {
  const map = readStagedNotices();
  const record = map[charId];
  if (!record) return [];
  if (uuid && record.uuid !== uuid) return [];
  delete map[charId];
  writeStagedNotices(map);
  return record.ids;
};

/**
 * 这一轮的回复真的落库了 → 把随它上云的作废回执销账（写 notifiedAt，下轮不再注入）。
 *
 * **由落库那一侧调**：即时对话的回复是走推送、经收件箱冲刷管线进 DB 的，销账时机只有
 * 那边知道（activeMsgRuntime 认末段到齐、销掉待收记录的同一处）。uuid 传这一轮的
 * taskUuid，对不上就什么都不做——那是上一轮的账，销掉等于把新一轮的回执也吞了。
 *
 * 返回真正销掉的 id（没有可销的返回空数组）。写库失败只 warn：台账已经取走，
 * 最坏情况是这几条回执下轮再说一遍，比反复销不掉卡住整条路强。
 */
export const settleInstantChatExpiredNotices = async (charId: string, uuid?: string): Promise<string[]> => {
  const ids = popStagedNotices(charId, uuid);
  if (ids.length === 0) return [];
  try {
    await ActiveMsgStore.markExpiredNoticesNotified(charId, ids);
  } catch (error) {
    console.warn(`${HEADER} 作废回执销账失败（下一轮会再说一遍）`, { charId, ids, error });
  }
  return ids;
};

/** 这一轮没成 → 台账作废、回执退回「未告知」，下一轮重新注入（回执不丢）。 */
export const discardInstantChatExpiredNotices = (charId: string, uuid?: string): string[] =>
  popStagedNotices(charId, uuid);

// ─── 开关 ───

/**
 * ready=false 时卡在哪一道。三档不是「用户没开」，调用方要分开收场：
 *   config-unreadable  这一刻问不出来（明确报错等重发，绝不悄悄退回本地）
 *   worker-outdated    问到了，那台 Worker 确实跑不动（退回本地生成，提示去更新 Worker）
 *   worker-unreachable 这一刻够不着云端（退回本地生成，但别叫人去更新——多半是网络）
 *
 * 后两档都得留痕：用户的主观意愿是「上云」，实际走的却是本地，不留痕就是一次静默分流。
 */
export type InstantChatReadinessReason =
  | 'disabled'
  | 'char-disabled'
  | 'no-worker-url'
  | 'worker-outdated'
  | 'worker-unreachable'
  | 'config-unreadable';

export interface InstantChatReadiness {
  ready: boolean;
  reason?: InstantChatReadinessReason;
}

// ─── 存量说「跑不动」时的现探 ───
//
// 存量是粘的：一旦写成 false，只有下一次探测成功才翻得回来，而探测原本只挂在握手
// （一次会话一次）和打开设置页两处。用户不进设置页，就会一直卡在本地生成。
//
// 所以这里补一次**懒重探**：只有存量已经是 false 时才探，且带冷却。成本压得很准——
// 状态正常的人一次额外请求都不加，只有已经降级的人付这点延迟，而他们本来就在走一条
// 对自己未必通的本地路径，拿 0.4 秒换回云端完全值得。

/** 存量已经是 false 时，最多每隔这么久现探一次，看能不能翻回来。 */
export const INSTANT_CHAT_REPROBE_COOLDOWN_MS = 30_000;

/** 现探卡这么久还没回话就算了，这一轮照常走本地——绝不把用户按在发送键上干等。 */
export const INSTANT_CHAT_REPROBE_TIMEOUT_MS = 3_000;

let lastReprobeAt = 0;
/** 上一次现探问到了什么。冷却期内沿用它，别让同一段时间里的消息报出忽左忽右的原因。 */
let lastReprobeOutcome: InstantChatProbeOutcome = 'unknown';
/** 同一刻好几条消息一起进来时共用同一次探测，别打出一串并发的 /config-check。 */
let reprobeInFlight: Promise<InstantChatProbeOutcome> | null = null;

/**
 * 把冷却清零，让下一条消息立刻重探。
 * 网络刚恢复时调（online 事件），换 Worker / 改配置的地方也可以调。
 */
export const resetInstantChatReprobeCooldown = (): void => { lastReprobeAt = 0; };

// 切代理节点不会触发 online，所以这个监听只是「便宜的加速」，不是恢复的唯一指望——
// 真正兜底的是上面那道冷却到期后的现探。
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', resetInstantChatReprobeCooldown);
}

/**
 * 现探一次，返回这次问到了什么。冷却期内不探，沿用上一次的结论。
 */
const reprobeInstantChatSupport = async (): Promise<InstantChatProbeOutcome> => {
  if (reprobeInFlight) return reprobeInFlight;
  if (Date.now() - lastReprobeAt < INSTANT_CHAT_REPROBE_COOLDOWN_MS) return lastReprobeOutcome;
  lastReprobeAt = Date.now();
  const task = (async () => {
    try {
      const result = await ActiveMsgClient.probeInstantChatSupportDetailed({
        timeoutMs: INSTANT_CHAT_REPROBE_TIMEOUT_MS,
      });
      return result.outcome;
    } catch {
      return 'unknown' as const;
    }
  })();
  reprobeInFlight = task;
  try {
    lastReprobeOutcome = await task;
    return lastReprobeOutcome;
  } finally {
    reprobeInFlight = null;
  }
};

/**
 * 即时对话此刻走不走得通，外加「走不通是因为什么」。
 *
 * 门槛四道：角色没单独关（传了 char 才查）、设置页开了、那台 Worker 跑得动、Worker
 * 地址填着。
 *
 * 「跑得动」平时读的是**存量**（config.instantChatSupported），由 probeInstantChatSupport
 * 在握手和打开设置页时刷新。走存量是为了省 RTT：状态正常的人一条消息都不该多花一次
 * 网络往返。undefined = 还没探过，放行——那一档说明我们不知道，不是知道它不行。
 *
 * 只有存量已经是 false（= 上一次明确探到跑不动）时，这里才补一次现探，看能不能翻回来，
 * 详见 reprobeInstantChatSupport。额外开销精确落在已经降级的那批人身上，而他们本来就在
 * 走一条对自己未必通的本地路径。
 *
 * 为什么这道门非要有：跑不动的 Worker 上这条路是**发一条挂一条**（老 bundle 被 waitUntil
 * 砍在 30 秒，新 bundle 少了起跳器则直接 503），而开关还写着「已开启」。让位给本地生成
 * 顶多是少一个后台能力，比让用户对着「正在输入」干等强。
 *
 * 配置读不出来（IndexedDB 被别的标签页 versionchange 卡住、iOS 存储压力…）单独成一档：
 * 它不等于「用户没开」。当成没开的话这一轮会悄悄退回本地直连生成——用户按完发送随手
 * 锁屏，本地 fetch 被系统掐掉，回来时既没有回复也没有报错，设置页还写着「已开启」。
 * 所以这里就地 warn 一声，调用方按这个 reason 单独收场（useChatAI 里这一档会留一条
 * trace，并且明确报错等用户重发，不发起本地生成）。
 */
export const resolveInstantChatReadiness = async (
  char?: Pick<CharacterProfile, 'activeMsg2Config'>,
): Promise<InstantChatReadiness> => {
  // 角色自己关了 → 这一轮回到本地前台生成。这是用户的主动选择，跟「全局没开」同一
  // 待遇：静默走本地，不 warn 不留 trace。undefined = 跟随全局默认开，只认显式 false；
  // 全局配置都不用读——读出什么这一轮都不上云。
  if (char?.activeMsg2Config?.instantChatEnabled === false) {
    return { ready: false, reason: 'char-disabled' };
  }
  let config: Awaited<ReturnType<typeof ActiveMsgStore.getGlobalConfig>>;
  try {
    config = await ActiveMsgStore.getGlobalConfig();
  } catch (error) {
    console.warn(`${HEADER} 全局配置读不出来，这一轮判断不了即时对话开没开（按走不通处理，但这不是「没开」）`, error);
    return { ready: false, reason: 'config-unreadable' };
  }
  if (!config.instantChatEnabled) return { ready: false, reason: 'disabled' };
  // 地址排在能力前面：没填地址时那份能力位多半是上一台 Worker 留下的存量，
  // 报「Worker 太旧」会把人指去点一个根本没连上的东西。
  if (!config.workerUrl?.trim()) return { ready: false, reason: 'no-worker-url' };
  // 开着、地址也在，但存量说那台 Worker 上这条路是坏的。
  //
  // 先现探一次再下结论：这份 false 可能是**旧版本**在一次网络抖动里写下的误判（那会儿
  // 「探不到」和「探到不行」共用一个 false），也可能是用户当时真的还没更新 Worker。
  // 不重探的话，前者要一直等到用户碰巧打开设置页才纠正得过来。
  if (config.instantChatSupported === false) {
    const outcome = await reprobeInstantChatSupport();
    if (outcome === 'supported') {
      console.info(`${HEADER} 重探到那台 Worker 现在跑得动即时对话（存量是过期结论），这一轮照常上云`);
      return { ready: true };
    }
    // 静默让位正是「静默分流」那个老坑，所以两档都就地 warn 一声，调用方还会额外留一条
    // trace——用户至少查得到「为什么开了却走本地」。两档的去向不同，别混：
    if (outcome === 'unsupported') {
      console.warn(`${HEADER} 开关是开的，但那台 Worker 跑不动即时对话（缺起跳器或还是旧 bundle）：这一轮本地生成。去设置页点「更新 Worker」`);
      return { ready: false, reason: 'worker-outdated' };
    }
    // 够不着云端时别叫人去更新 Worker——他多半点不动，而且问题也不在那儿。
    console.warn(`${HEADER} 开关是开的，但这一刻够不着云端（问不出新结论）：这一轮本地生成，连上了会自己回到云端`);
    return { ready: false, reason: 'worker-unreachable' };
  }
  return { ready: true };
};

/** 只关心「走不走得通」的调用点用这个（设置页的互斥门）。要区分原因走上面那个。 */
export const isInstantChatReady = async (): Promise<boolean> =>
  (await resolveInstantChatReadiness()).ready;

// ─── 「这一轮走的哪条路」广播给界面 ───
//
// 开关写着「已开启」、消息却在本地生成，这中间的落差过去只留在 console 和观察窗里，
// 普通用户查不到——他能看到的只有一条读不懂的网络报错。所以每一轮都把结论播出去，
// 由输入框上方那条小提示接住。

/** detail 是 InstantChatRouteDetail。每一轮都发，包括「这一轮回到云端了」。 */
export const AMSG_INSTANT_CHAT_ROUTE_EVENT = 'amsg-instant-chat-route';

export interface InstantChatRouteDetail {
  charId: string;
  /** null = 这一轮走的云端（界面上把提示收起来）；否则是让位给本地生成的原因。 */
  reason: InstantChatReadinessReason | null;
}

export const announceInstantChatRoute = (detail: InstantChatRouteDetail): void => {
  try {
    window.dispatchEvent(new CustomEvent(AMSG_INSTANT_CHAT_ROUTE_EVENT, { detail }));
  } catch { /* SSR / 测试环境无 window */ }
};

// ─── 发这一轮 ───

// POST /instant-chat 在飞（发出到 202 之间）的角色。待收记录要等 202 才写，而挂起
// fire_pack 常规上传的那道挡板（amsgStateSync）原本只认待收记录——慢网上传几 MB 的
// 那几秒里，别处打脏触发的常规包（没有 chat 段）可能晚于 POST 内部那次 client-state
// 写入落地，把带 chat 段的包盖掉，worker 到点只会硬失败。所以从按下发送那一刻起就
// 占位，挡板认「占位或待收」，202 后由待收记录接棒，失败则释放。
const inFlightSends = new Set<string>();

/** POST /instant-chat 正在飞（还没等到 202/失败）吗。amsgStateSync 的挂起挡板用。 */
export const isInstantChatSendInFlight = (charId: string): boolean => inFlightSends.has(charId);

export interface InstantChatSendResult {
  ok: boolean;
  uuid?: string;
  /** 失败时给用户看的整句（已经是能照着做的话）。 */
  error?: string;
}

/**
 * 把这一轮交给云端。**只有 202 才算发出去**，别的一律 ok:false，由调用方明确报错、
 * 允许重发，绝不悄悄退回本地生成。
 *
 * 连发两条时带上一条还没销账的 uuid：包装层会尽力取消那条未认领的任务，两句话合成
 * 一次回复。上一条已经在跑了（取消不掉）也不影响这一条，最多两句相近的回复。
 */
export const sendInstantChatTurn = async (params: {
  char: CharacterProfile;
  chatMessages: Array<{ role: string; content: unknown }>;
  /** 本地生成这一轮会用的凭据（effectiveApi），云端必须用同一份。 */
  api: { baseUrl: string; apiKey: string; model: string };
  /** 本地这一轮会发的采样温度；开思考时本地不发温度，这里也就不传。 */
  temperature?: number;
  maxTokens?: number;
  /**
   * 本地这一轮会额外塞进请求体的字段（现在只有思考链那三件：thinking /
   * reasoning_effort / extra_body，见 useChatAI 的 shouldSendThinkingParams 分支）。
   * 原样带给 worker 展开——云端发出去的请求体必须和本地一字不差，不然开思考的
   * 角色一开即时对话心象卡片就静默消失。不传就是本地也不发。
   */
  extraBody?: Record<string, unknown>;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  /**
   * 这一轮的情绪评估，一起交给云端跑（提示词模板 + 副 API 凭据）。
   * 不传就是这一轮不评估（角色没开情绪评估 / 本轮跳过）。
   */
  emotionEval?: AmsgEmotionEvalSpec;
}): Promise<InstantChatSendResult> => {
  const supersedes = getInstantChatPending(params.char.id);
  inFlightSends.add(params.char.id);
  // 这一轮在「API 调用记录」里的那一笔：本地这条路只经手一个 POST，真正的模型请求
  // 是云端发的，日志的全局拦截器够不着——不在这儿记，用户就会看到聊天从记录里消失。
  // meta 跟本地生成那条路对齐（useChatAI 传给 safeFetchJson 的那份），两条路在列表里
  // 长得一样，只多一个云端标记。
  const logMeta = {
    appName: '消息',
    charId: params.char.id,
    charName: params.char.name,
    purpose: '聊天回复',
  };
  try {
    const { uuid } = await ActiveMsgClient.sendInstantChat({
      char: params.char,
      chatMessages: params.chatMessages,
      api: params.api,
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
      ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
      ...(params.extraBody ? { extraBody: params.extraBody } : {}),
      userProfile: params.userProfile,
      groups: params.groups,
      realtimeConfig: params.realtimeConfig,
      ...(params.emotionEval ? { emotionEval: params.emotionEval } : {}),
      ...(supersedes ? { supersedesUuid: supersedes.uuid } : {}),
    });
    // 先记待收再释放占位（finally），挡板的两个信号无缝交接，不留「都不认」的空窗。
    setInstantChatPending(params.char.id, uuid, Date.now(), params.char.name);
    recordCloudApiCall({
      id: cloudApiCallLogId(uuid),
      route: 'cloud-instant-chat',
      baseUrl: params.api.baseUrl,
      model: params.api.model,
      messages: params.chatMessages,
      meta: logMeta,
    });
    // 顶掉的那一轮也得收尾：客户端从这一刻起不再等它的回复了（云端把两句合成一次回，
    // 它已经在跑的情况下顶不掉，但那份回复也认不回这条记录）。不收的话它会一直写着
    // 「云端生成中」，直到 5 天后被裁掉。
    if (supersedes) {
      settleCloudApiCall({ id: cloudApiCallLogId(supersedes.uuid), ok: true, superseded: true });
    }
    return { ok: true, uuid };
  } catch (error: any) {
    // 只报失败、只有事件名（跟送达端那几条同一条口径）：失败原因里带着 HTTP 状态和
    // 上游报文，不进上报。用户侧同一时刻已经有明确的报错提示，这里只记「发生过」。
    trackEvent('即时对话发送失败');
    // 没交上去的这一轮同样进记录：界面上那句报错关掉就没了，而日志里留得住——
    // 交不上去往往跟这次要发的东西有多大有关，输入构成就在这条记录里。
    recordCloudApiCall({
      id: `cloud-send-failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      route: 'cloud-instant-chat',
      baseUrl: params.api.baseUrl,
      model: params.api.model,
      messages: params.chatMessages,
      meta: logMeta,
      sendFailed: true,
    });
    return { ok: false, error: error?.message || String(error) };
  } finally {
    inFlightSends.delete(params.char.id);
  }
};

/**
 * 这一轮回来了 → 把「API 调用记录」里那笔挂着的补完。
 *
 * `metadata` 是这一轮**最后一条**推送带回来的那份：云端把用量（`amsgUsage`）和工具
 * 痕迹（`amsgToolTrace`）都挂在末条上。补收路径拿到的是同一份（账本存的就是推送信封
 * 的副本），所以推送丢了也照样补得上。
 *
 * 云端回传的用量只有**最后一次**模型调用那一份——带工具的一轮会连着调好几次模型，
 * 中间几次的数在云端就没留下。跑过工具就把这笔标成「只算末轮」，让用户知道这个数字
 * 偏小，别拿它去跟账单对齐。
 */
export const settleInstantChatApiLog = (uuid: string, metadata?: Record<string, any> | null): void => {
  const num = (value: unknown): number | undefined =>
    (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const usage = metadata?.amsgUsage;
  const toolTrace = metadata?.amsgToolTrace;
  settleCloudApiCall({
    id: cloudApiCallLogId(uuid),
    ok: true,
    promptTokens: num(usage?.promptTokens),
    completionTokens: num(usage?.completionTokens),
    tokensPartial: Array.isArray(toolTrace) && toolTrace.length > 0,
  });
};

// ─── 推送丢了的兜底：拉服务端消息账本 ───

/**
 * 推送信封 → 收件箱记录。
 *
 * 字段映射必须和 SW 收到真推送时写的那一份一致（worker/sw-keep-alive.ts 的
 * saveContentToInbox），否则同一条消息经两条路进来会长得不一样：时间戳口径、
 * 多段等齐守卫、防穿帮闸读的全是这些字段。
 */
export const outboxPushToInbox = (
  payload: Record<string, any>,
  receivedAt: number,
): ActiveMsg2InboxMessage | null => {
  const charId = payload?.metadata?.charId;
  if (typeof charId !== 'string' || !charId) return null;
  const body = String(payload?.message || payload?.body || '').trim();
  const notificationBody = typeof payload?.notification?.body === 'string'
    ? payload.notification.body.trim()
    : '';
  const parsedSentAt = payload?.timestamp ? new Date(payload.timestamp).getTime() : NaN;
  return {
    messageId: String(payload?.messageId || `${charId}-outbox-${receivedAt}`),
    charId,
    charName: payload?.contactName || payload?.metadata?.charName || '主动消息',
    body,
    previewBody: notificationBody || body,
    avatarUrl: payload?.avatarUrl,
    source: payload?.source,
    messageType: payload?.messageType,
    messageSubtype: payload?.messageSubtype,
    taskId: payload?.taskId ?? null,
    taskUuid: payload?.taskUuid ?? null,
    recurrenceType: payload?.recurrenceType ?? null,
    occurrenceMs: payload?.occurrenceMs ?? null,
    metadata: {
      ...(payload?.metadata || {}),
      sessionId: payload?.sessionId,
      messageIndex: payload?.messageIndex,
      totalMessages: payload?.totalMessages,
      // 走到这里 = 真推送没送到、从云端副本捡回来的。销账那边靠它决定要不要顺手
      // 取消还挂在重试队列里的任务行（正常送达的路没这个标记，一个多余请求不发）。
      // SW 那份映射（saveContentToInbox）刻意没有这个键：它只在补收路径为真。
      amsgOutboxBackfill: true,
    },
    sentAt: Number.isFinite(parsedSentAt) ? parsedSentAt : receivedAt,
    receivedAt,
  };
};

/**
 * 补收的时效窗口：比这更早落账的条目不再往聊天流里放，直接销账。
 *
 * 两个理由。一是**噪音**：隔了一天才补上来的「早上好」既尴尬又打断当下的对话，
 * 而这条路本来是为「推送刚刚丢了」准备的，正常补收都在几十秒到几分钟内完成。
 * 二是**接上账本这一刻的存量**：账本从建表起就在攒行，而客户端是这一版才开始销账的，
 * 头一次拉会把历史积压一次性倒出来——不掐时效的话，那些早就落过库的老消息会因为
 * 超出近史去重的查询窗口而重新上屏。
 */
export const OUTBOX_BACKFILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface OutboxDrainResult {
  /** 写进收件箱、等着冲刷落库的条数。 */
  written: number;
  /** 不走聊天流、当场就能销账的 messageId（太老的、不进聊天流的那几类）。 */
  ackNow: string[];
  /** 这一趟从账本上读到的全部条目。调用方按轮次下结论时要看它。 */
  entries: AmsgOutboxEntry[];
}

/**
 * 「这台设备已经接上服务端账本」的标记。
 *
 * 账本是服务端从建表那一刻起就在攒的，而销账是客户端这一版才有的能力。所以**第一次**
 * 拉账本时上面躺着的并不是「我丢了的消息」，而是这套机制生效之前积累下来的存量——
 * 当成补收放进聊天流的话，用户会被自己这段时间收过的消息重放一遍（定时问候、多段
 * 回复全部再来一次）。时效窗口挡不住这一档：存量的年龄本来就在窗口之内。
 *
 * 所以首次接管那一趟只做一件事：**存量整批销账，一条都不往聊天流里放**。销干净了才
 * 记这个标记，下一趟起才按正常补收处理。
 */
export const AMSG_OUTBOX_ADOPTED_LS_KEY = 'amsg2_outbox_adopted_v1';

const hasAdoptedOutbox = (): boolean => {
  try {
    return !!localStorage.getItem(AMSG_OUTBOX_ADOPTED_LS_KEY);
  } catch {
    // 存储读不出来（隐私模式 / 存储关停）时按**已接管**处理：这一档下标记永远也写不
    // 进去，当成未接管的话每一趟都会把当趟条目整批销掉，补收就永久失效了——推送真丢
    // 的时候一条都补不回来，比偶尔多倒一次存量严重得多。
    return true;
  }
};

const markOutboxAdopted = (): void => {
  try {
    localStorage.setItem(AMSG_OUTBOX_ADOPTED_LS_KEY, JSON.stringify({ at: Date.now() }));
  } catch { /* 写不进去就下次再接管一遍，反正存量已经销掉了 */ }
};

/**
 * 首次接管：账本上的存量整批销账、不进聊天流。
 *
 * 唯一的例外是用户**此刻正等着的那几轮**（taskUuid 跟待收记录对得上）：那是刚刚发生
 * 的事，不是历史积压，照常走补收放进聊天流——否则第一次接管恰好赶上用户发消息时，
 * 那一轮的回复会被当存量销掉，用户等来的是一句「回复没能取回」。
 *
 * 销账成功才记标记。没销干净就这一趟什么都不做、也不记标记：没销掉的条目下次还会
 * 拉回来，那时仍按接管处理。反过来（先记标记再销账）一旦销账失败，剩下的存量下一趟
 * 就会被当成补收倒进聊天流，正是这里要防的那件事。
 */
const adoptOutboxBacklog = async (entries: AmsgOutboxEntry[]): Promise<OutboxDrainResult> => {
  const awaitedUuids = new Set(listInstantChatPendings().map((pending) => pending.uuid));
  const isAwaited = (entry: AmsgOutboxEntry) => !!entry.taskUuid && awaitedUuids.has(entry.taskUuid);
  const backlogIds = entries.filter((entry) => !isAwaited(entry)).map((entry) => entry.messageId);

  if (backlogIds.length > 0) {
    try {
      await ActiveMsgClient.ackOutboxMessages(backlogIds);
    } catch (error) {
      console.warn(`${HEADER} 账本存量没销干净，这一趟先不接管（下次重来）`, error);
      return { written: 0, ackNow: [], entries };
    }
  }
  markOutboxAdopted();
  console.log(`${HEADER} 第一次接上云端账本：存量 ${backlogIds.length} 条直接销账，不往聊天流里放`);

  const { written, ackNow } = await backfillOutboxEntries(entries.filter(isAwaited));
  return { written, ackNow, entries };
};

/**
 * 把账本条目写回收件箱走原路入库。
 *
 * 只有正文类（`content` 与情绪结果）才往收件箱里放。思维链、工具请求、错误通知
 * 这几类补收回来已经没有意义：思维链要挂在正文上、工具请求那头的云端早就收工了、
 * 隔了一阵子的报错弹出来只会让人摸不着头脑。它们照样要销账，不然每次拉都拉回来。
 */
const backfillOutboxEntries = async (
  entries: AmsgOutboxEntry[],
): Promise<Omit<OutboxDrainResult, 'entries'>> => {
  const now = Date.now();
  const ackNow: string[] = [];
  let written = 0;

  for (const entry of entries) {
    const push = entry.push || {};
    const kind = typeof push.messageKind === 'string' ? push.messageKind : 'content';
    if (kind !== 'content' && kind !== 'emotion_update') {
      ackNow.push(entry.messageId);
      continue;
    }
    if (entry.createdAt > 0 && now - entry.createdAt > OUTBOX_BACKFILL_MAX_AGE_MS) {
      ackNow.push(entry.messageId);
      continue;
    }
    const message = outboxPushToInbox(push, now);
    if (!message) {
      // 连角色都认不出来（信封缺 metadata.charId），留着也没人能处理。
      ackNow.push(entry.messageId);
      continue;
    }
    // 情绪结果在 SW 那侧是单独一条写法，这里显式对齐：冲刷管线靠这个字段分流，
    // 认不出来就会被当成一条正文气泡渲染出去。
    if (kind === 'emotion_update') message.messageType = 'emotion_update';
    try {
      await ActiveMsgStore.saveInboxMessage(message);
      written += 1;
    } catch (error) {
      // 写不进去就**不销账**，下次拉回来再试。
      console.warn(`${HEADER} 补收写入收件箱失败（账没销，下次再来）`, { messageId: entry.messageId, error });
    }
  }

  if (written > 0) console.log(`${HEADER} 从云端账本补收 ${written} 条（推送多半是丢了）`);
  return { written, ackNow };
};

/**
 * 拉一次服务端消息账本，把还没收下的写回收件箱走原路入库。
 *
 * 跟以前那套「本地比对着猜哪些没收到」的关键差别：**账本是服务端记的事实**，
 * 客户端不再需要拿最近几条聊天记录去反推。读失败照常抛——「没读成」和「读到了、
 * 里面确实没有」是两个结论，调用方要拿它下判决时只能认后者。
 *
 * 头一次拉走的是另一条路（见 adoptOutboxBacklog）：那一趟账本上装的是存量，不是
 * 「我丢了的消息」。
 *
 * 调用方拿到 written > 0 之后要自己 flush 一次收件箱（见文件头注：不在这里 flush
 * 是为了避免和 activeMsgRuntime 成环）。
 */
export const drainOutbox = async (
  options?: {
    /**
     * 头一趟也把存量当「我丢了的消息」补收（默认 false = 走 adoptOutboxBacklog 整批销账）。
     *
     * 只给用户手点的那次补收用：自动路径分不清存量里哪些是真丢的、哪些是当时收到了只是
     * 客户端还不会销账，倒出来就是重放；而用户是察觉到「消息没来」才去点那个按钮的，
     * 这个判断他自己做得了。按补收处理之后照样记下接管标记，后面回到自动路径。
     */
    treatBacklogAsMissed?: boolean;
  },
): Promise<OutboxDrainResult> => {
  const entries = await ActiveMsgClient.listOutboxEntries();
  if (!hasAdoptedOutbox()) {
    if (!options?.treatBacklogAsMissed) return await adoptOutboxBacklog(entries);
    markOutboxAdopted();
  }
  const { written, ackNow } = await backfillOutboxEntries(entries);
  return { written, ackNow, entries };
};

/**
 * 这一轮收尾成「没等到回复」：销账 + 在聊天流里留一条说明。
 *
 * 只在云端给了明确结论之后调（任务行已失败 / 行没了而 outbox 里也没有），所以这里
 * 不再去 cancel 那条任务——失败的行不会再跑，没了的行也没什么可取消的。
 *
 * `uuid` 是这个结论说的是哪一轮，**必传**：从查到结论到落这条说明之间隔着网络往返
 * （查失败原因要去云端点名读一份 chat_fail 留痕），这期间用户完全可能
 * 又发了一条，待收记录已经换成新的 uuid 了。不认 uuid 就动手的话，销掉的是新那一轮
 * 的账——「正在输入」当场熄灭，聊天流里还多一条它其实没失败的说明。对不上就直接走人，
 * 让新那一轮自己走完它的判定。
 *
 * `reason` 是云端记下的失败原因（有就带给用户看）。沿用本地路径失败时那条系统消息的
 * 形态（`[…]` 的方括号系统消息），用户能直接看到发生了什么、也知道可以重发。
 * 写库失败只 warn——指示灯该灭还是得灭。
 */
export const failInstantChatPending = async (
  charId: string,
  uuid: string,
  reason?: string,
): Promise<void> => {
  if (getInstantChatPending(charId)?.uuid !== uuid) return;
  if (!clearInstantChatPending(charId)) return;
  // 这一轮随 chat 段上云的作废回执跟着作废：没销账 = 还是「未告知」，下一轮会重新
  // 注入。销掉的话角色永远不知道那条任务被作废过，聊天里许下的承诺就这么没了。
  discardInstantChatExpiredNotices(charId, uuid);
  // 「情绪更新中」那盏灯也在这里熄。
  //
  // 平时它的熄灭信号搭在最后一条回复的推送上（metadata.amsgEmotionDone，见
  // activeMsgRuntime 收侧）。可这一轮要是一条推送都没有——模型空输出/纯拒答被 worker
  // 判成 skip-push，或者整条 fire 硬失败——那个信号永远不会到，灯只能干等十来分钟的
  // 安全网（useChatAI 的 cloudEvalTimeoutMs，按 worker fire 上限推导），中途还会弹一句
  // 「worker 可能是旧版」的误导提示。云端已经点名说这一轮没成，就是最确定的熄灯时机。
  //
  // 派在写库之前：写库失败只 warn，灯不该被它连累（同上面那句注释的口径）。
  announceEmotionDone(charId);
  // 只报失败、只有事件名：云端点名说这一轮没成（或回复取不回来）。这一格涨起来说明
  // 云端生成或推送链路在掉队，比用户来报「一直在输入」早得多。
  trackEvent('即时对话云端任务失败');
  // 「API 调用记录」里那笔挂着的也收尾，否则它会一直写着「云端生成中」直到被裁掉。
  settleCloudApiCall({ id: cloudApiCallLogId(uuid), ok: false });
  try {
    await DB.saveMessage({
      charId,
      role: 'system',
      type: 'text',
      content: reason
        ? `[即时对话没能完成：${reason}。可以重新发一次。]`
        : '[即时对话没能完成：云端已处理这条消息，但回复没能取回（推送和云端副本都没拿到）。可以重新发一次。]',
    });
    window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId } }));
  } catch (error) {
    console.warn(`${HEADER} 失败说明写入失败`, { charId, error });
  }
};
