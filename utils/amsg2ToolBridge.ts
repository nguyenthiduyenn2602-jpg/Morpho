/**
 * amsg2ToolBridge — 把主动消息 2.0 的排程/取消/续期/查询暴露为 OpenAI function-calling 工具，
 * 让角色在对话中直接管理定时消息（"提醒我 8 点问好"→ LLM 调 schedule_active_message）。
 *
 * 工具定义注入 useChatAI 的 tools 数组；执行器在工具循环里分发。
 * 多任务：一个角色可同时挂多个任务，用短 id（taskUuid 前 8 位）定位。
 *
 * 防打转是这份文件的一部分职责：工具循环最多转 6 轮，模型一旦每轮都重复同一个 schedule，
 * 每一轮都会在远端实打实建一条任务。所以执行器自带软硬两层——回话末尾明说这一步做完了，
 * 同名同参的第二次直接打回。口径与 worker 的 fire 循环共用，见 utils/agenticToolFeedback.ts。
 */

import {
  ActiveMsg2CharacterConfig,
  ActiveMsg2TaskRecord,
  APIConfig,
  CharacterProfile,
  GroupProfile,
  RealtimeConfig,
  UserProfile,
} from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { buildDuplicateToolMessage, toolCallFingerprint, type ToolCallRecord } from './agenticToolFeedback';
import { trackEvent } from './analytics';
import {
  applyScheduledTask, currentOccurrenceMs, describeExpirePolicy, describeRecurrence,
  describeTaskMode, describeTaskProgress, findTaskByShortId, formatTaskTime,
  getPendingTasks, isPendingTask, pruneStaleTasks, resolveExpirePolicy, shortTaskId,
} from './amsg2Tasks';
import { resolveMaxUnansweredSends } from './amsgFirePack';
import { EXPIRE_POLICY_DESCRIPTION } from './amsgFireSchedule';
import { resolveCharTimeZone } from './timezone';

// ─── OpenAI tools schema ───

interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, any> };
}

export const AMSG2_TOOLS: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'schedule_active_message',
      description: [
        '创建定时主动消息：到指定时间后，你（角色）会根据最新聊天上下文自动生成并推送一条消息给用户。',
        '重要：send_at 是 worker 开始生成消息的请求时间，不是最终送达时间（中间有推理延迟，通常 10-30 秒）。',
        '如果要"卡点"送达（比如整点），建议提前 1 分钟。',
        '推荐使用 mode=auto：角色根据最新聊天内容自动决定说什么，后续聊天会自动同步至上下文。',
        'mode=prompted：给角色一个提示方向（如"问问对方吃了没"），角色围绕这个方向生成。',
        '每个角色最多同时挂 5 个任务；到点作废与否由 expire_policy 决定。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          send_at: {
            type: 'string',
            // 只教裸墙钟：角色照着自己那边的钟写，系统按角色时区还原成绝对时刻
            // （跟 worker 到点解析 send_at 同一份规则）。教它写 +08:00 这种偏移的话，
            // 纽约角色会照抄示例里的东八区，说出来的「明早九点」实际差一个时差。
            description: '开始生成消息的时间，写你本地的墙钟时间，格式 YYYY-MM-DDTHH:mm:ss（如 2026-07-20T20:00:00），不要带时区后缀。必须晚于当前时间。',
          },
          mode: {
            type: 'string',
            enum: ['auto', 'prompted'],
            description: '生成模式。auto=根据最新聊天自动生成（推荐）；prompted=围绕 prompt_hint 方向生成。默认 auto。',
          },
          prompt_hint: {
            type: 'string',
            description: '仅 mode=prompted 时有效。给角色的提示方向，如"问问对方晚饭吃了没"。',
          },
          recurrence: {
            type: 'string',
            enum: ['none', 'daily', 'weekly'],
            description: '重复类型。none=一次性（默认）；daily=每天同一时间；weekly=每周同一天同一时间。',
          },
          expire_policy: {
            type: 'string',
            enum: ['expire', 'force'],
            // 与 fire 侧共用一份：同一个策略在两个入口说两套话，角色的选择会跟着入口漂。
            description: EXPIRE_POLICY_DESCRIPTION,
          },
        },
        required: ['send_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_active_message',
      description: '取消当前角色的一个定时主动消息任务。多个任务并存时必须用 task_id（排程现状/任务列表里的短 id）指定；只有一个待触发任务时可省略。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '要取消的任务短 id（8 位）。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renew_active_message',
      description: [
        '给一个任务续期：只换触发时间，沿用原有模式与提示方向（含已作废的任务）。',
        '一次性任务 = 整条改到新时间；循环任务 = 只给这一次补发一条一次性任务，原来的每天/每周节奏和编号都不动。',
        '想改的是循环任务本身的时间，或者想说的内容、方向已经变了，都不要用 renew，改用 cancel_active_message + schedule_active_message 重新创建。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          send_at: { type: 'string', description: '新的触发时间，写你本地的墙钟时间，格式 YYYY-MM-DDTHH:mm:ss，不带时区后缀。必须晚于当前时间。' },
          task_id: { type: 'string', description: '要续期的任务短 id（8 位）。只有一个任务时可省略。' },
        },
        required: ['send_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_active_messages',
      description: '查看当前角色的定时主动消息任务列表（短 id、时间、模式、状态）。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export const AMSG2_TOOL_NAMES = new Set(AMSG2_TOOLS.map((t) => t.function.name));

// ─── 执行器 ───

export interface Amsg2ToolDeps {
  char: CharacterProfile;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  apiConfig: APIConfig;
  /** 读本轮最新的任务清单配置。只由 createAmsg2ToolSession 提供，别自己拼。 */
  getConfig: () => ActiveMsg2CharacterConfig | undefined;
  /** 写回任务清单：刷新 getConfig 的来源，同时落 React state / DB。 */
  setConfig: (config: ActiveMsg2CharacterConfig) => void;
  /** 本轮已经真跑过的调用（同名同参）。executeAmsg2Tool 自己维护，调用方只管传下去。 */
  seenCalls: ToolCallRecord[];
}

/**
 * 建一轮工具循环要用的 deps，一轮生成建一次、放在工具循环外面。
 *
 * 任务清单不从 char 上读写：char 是生成开始时的那份快照，updateCharacter 只更 React
 * state、不回写它。所以角色一轮里连建两条任务时，第二次会读着空清单把第一条覆盖掉
 * （「建俩只显示一个」）。这里用一个本轮局部变量兜住最新 config，schedule / cancel /
 * renew / list 全部只经 getConfig / setConfig 走，累加就一定对——也不用去就地改
 * React state 里的角色对象。
 */
export const createAmsg2ToolSession = (base: {
  char: CharacterProfile;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  apiConfig: APIConfig;
  updateCharacter: (charId: string, updates: Partial<CharacterProfile>) => void;
}): Amsg2ToolDeps => {
  let liveConfig = base.char.activeMsg2Config;
  return {
    char: base.char,
    userProfile: base.userProfile,
    groups: base.groups,
    realtimeConfig: base.realtimeConfig,
    apiConfig: base.apiConfig,
    seenCalls: [],
    getConfig: () => liveConfig,
    setConfig: (config) => {
      liveConfig = config;
      base.updateCharacter(base.char.id, { activeMsg2Config: config });
    },
  };
};

/**
 * 会改动任务清单的那几个工具：跑一次就是远端多一条 / 少一条任务，所以要防打转。
 *
 * list 不在里面——同一轮里排完再查，清单本来就该变，拦掉的话角色拿到的是「结果就在
 * 上面」但上面那份已经过时了。
 */
const MUTATING_TOOLS = new Set([
  'schedule_active_message',
  'cancel_active_message',
  'renew_active_message',
]);

/**
 * 每次工具跑完都补的收尾话（软的那层，硬的那层是下面的指纹拦截）。
 *
 * 只回一句「已创建 [xxx]」的话，模型看不出这一步已经结束了：工具循环最多转 6 轮，
 * 常驻提示词里但凡有一句「需要时直接调工具」，它每轮都会照做，一路把同一条任务排到
 * 撞上限为止（现场：一句「等会找我」排出 5 条一模一样的）。措辞跟 worker 的 fire
 * 循环共用一套口径，见 utils/agenticToolFeedback.ts。
 */
const TOOL_FOLLOW_UP = [
  '[系统: 这一次调用已经处理完了，结果就在上面。同样的调用不要再来一遍——',
  '现在把要对用户说的话写出来，或者用一个还没用过的工具。',
  '前面已经说出去的内容不要重写，接着往下写就行。]',
].join('\n');

export const executeAmsg2Tool = async (
  toolName: string,
  args: Record<string, any>,
  deps: Amsg2ToolDeps,
): Promise<string> => {
  const mutating = MUTATING_TOOLS.has(toolName);
  // 同名同参第二次直接打回，一次网络请求都不发。上面那段软提示挡不住时靠它兜底，
  // 与 worker 的 fire 循环同一道闸。只拦**完全一样**的调用——换时间、换方向照常放行，
  // 多轮能力一点不减。
  const fingerprint = mutating ? toolCallFingerprint(toolName, args) : '';
  if (mutating && deps.seenCalls.some((r) => r.fingerprint === fingerprint)) {
    return buildDuplicateToolMessage(toolName);
  }
  try {
    const result = await (() => {
      switch (toolName) {
        case 'schedule_active_message':
          return handleSchedule(args, deps);
        case 'cancel_active_message':
          return handleCancel(args, deps);
        case 'renew_active_message':
          return handleRenew(args, deps);
        case 'list_active_messages':
          return handleList(deps);
        default:
          return Promise.resolve(`未知工具 ${toolName}。`);
      }
    })();
    // 记账放在跑完之后：抛错的那次等于没跑成（远端没建出东西），把它记下来的话，
    // 角色连一次原样重试的机会都没有。
    if (mutating) deps.seenCalls.push({ name: toolName, fingerprint });
    return mutating ? `${result}\n${TOOL_FOLLOW_UP}` : result;
  } catch (e: any) {
    return `操作失败：${e?.message || String(e)}`;
  }
};

/** tasks 已归一化成数组的 config，下面的 handler 直接 `config.tasks` 即可。 */
type LoadedConfig = ActiveMsg2CharacterConfig & { tasks: ActiveMsg2TaskRecord[] };

/** 读本轮最新 config（含本轮前面几次工具调用刚写进去的任务）。 */
const readConfig = (deps: Amsg2ToolDeps): LoadedConfig => {
  const config = deps.getConfig();
  return { enabled: true, ...config, tasks: config?.tasks ?? [] };
};

/** 任务清单落盘：顺手清过点 48h 的一次性任务。 */
const persistTasks = (
  deps: Amsg2ToolDeps,
  config: ActiveMsg2CharacterConfig,
  tasks: ActiveMsg2TaskRecord[],
) => {
  // enabled 原样保留：工具只在角色开着 2.0 时才注入（见 isAmsg2EnabledForChar），
  // 这里再强写 true 就成了「一次工具调用替用户把关掉的功能重新打开」。
  deps.setConfig({
    ...config,
    tasks: pruneStaleTasks(tasks, Date.now()),
    lastSyncedAt: Date.now(),
    lastError: undefined,
  });
};

async function handleSchedule(args: Record<string, any>, deps: Amsg2ToolDeps): Promise<string> {
  const { char, userProfile, groups, realtimeConfig, apiConfig } = deps;
  const config = readConfig(deps);
  // 连发上限·本地排程闸（与 worker fire 侧 runFireScheduleTool 的 unanswered_limit
  // 对齐）：挂着的自排任务到点各消耗一条连发额度，本地排到超限的那几条会被到点兜底闸
  // 静默 skip——角色在正文里承诺了「等下再来找你」，到点却凭空蒸发。在这里带回喂打回，
  // 让模型当场改口。本地轮次用户刚开口（连发计数已清零），所以只数还没响的自排任务；
  // 面板里用户亲手排的（source!=='character'）不占额度，与 worker 侧同一口径。
  // 改期/补当次（__replaceTaskUuid / __makeupForTaskUuid）不新占额度，放行。
  if (!args.__replaceTaskUuid && !args.__makeupForTaskUuid) {
    const unansweredLimit = resolveMaxUnansweredSends(char.activeMsg2Config?.maxUnansweredSends);
    const plannedSelfSends = config.tasks
      .filter((t) => t.source === 'character' && isPendingTask(t, Date.now()))
      .length;
    if (plannedSelfSends + 1 > unansweredLimit) {
      return `对方还没回复，这期间你已经排了 ${plannedSelfSends} 条后续，用户设置的连发上限是 ${unansweredLimit} 条——这次别排了，等 ta 回复再说。`;
    }
  }
  // 回话里的时间按角色的钟写：到点 worker 渲染排程清单用的也是角色时区，两边对不上的话
  // 纽约角色刚排的那条，在下一轮的排程现状里会显示成差一个时差的另一个时刻。
  const charTz = resolveCharTimeZone(char);
  const mode = (args.mode === 'prompted' ? 'prompted' : 'auto') as 'auto' | 'prompted';
  const recurrence = (['daily', 'weekly'].includes(args.recurrence) ? args.recurrence : 'none') as 'none' | 'daily' | 'weekly';
  const expirePolicy = resolveExpirePolicy(mode, args.expire_policy === 'force' ? 'force' : 'expire');
  const taskInput = {
    mode, firstSendTime: args.send_at, recurrenceType: recurrence,
    promptHint: args.prompt_hint || undefined,
    expirePolicy,
  };

  const result = await ActiveMsgClient.scheduleCharacterTask({
    // selfScheduled：角色自己排的要带标记进任务 metadata——连发上限的到点兜底闸只拦
    // 带它的任务，用户在面板里亲手排的不带、不受限（面板走的是同一个入口但不传这个）。
    char, config, task: { ...taskInput, selfScheduled: true },
    replaceTaskUuid: args.__replaceTaskUuid,   // renew 内部复用，LLM 不感知
    userProfile, groups, realtimeConfig, apiConfig,
  });

  const record: ActiveMsg2TaskRecord = {
    taskUuid: result.uuid,
    clientTaskId: result.clientTaskId,
    ...taskInput,
    // send_at 是角色那边的墙钟，落盘存排程接口折好的绝对时刻。存原串的话，本地读它的地方
    // （面板卡片、待触发判定、下面这句回话）一律 new Date() 按设备时区解析，异国角色差一个时差。
    firstSendTime: result.firstSendAt,
    anchorLastUserMsgAt: result.anchorMs,
    source: 'character',
    status: 'scheduled',
    createdAt: Date.now(),
  };
  // 并清单的规则（替换成功才移除旧记录；远端取消失败则保留旧记录并标错，短 id 还在、
  // 角色和用户都还能再取消一次）与设置面板共用 applyScheduledTask。
  persistTasks(deps, config, applyScheduledTask(
    config.tasks,
    record,
    { replaceTaskUuid: args.__replaceTaskUuid, replacedCancelFailed: result.replacedCancelFailed },
    Date.now(),
  ));

  // 只报枚举构成（模式/频率都是写死的取值集合）。内容、时间、编号一概不带。
  // 这份文件只在浏览器聊天侧运行（不进 amsg worker bundle），引 analytics 安全。
  trackEvent('排程定时消息', {
    mode,
    recurrence,
    source: 'character',
    isEdit: args.__replaceTaskUuid ? 'yes' : 'no',
  });

  const recurrenceDesc = recurrence === 'none' ? '' : `（${describeRecurrence(recurrence)}重复）`;
  // 续期/替换走的是「先建新的再取消旧的」，编号必然换一个。不说清楚的话，角色刚用
  // 旧编号续了期，却收到一句「已创建 [另一个编号]」，下一轮还会拿旧编号来操作。
  const oldShortId = args.__replaceTaskUuid ? shortTaskId(args.__replaceTaskUuid) : '';
  // 循环任务的续期是「补当次」，原序列一条没动——不点明的话，角色会以为自己刚把
  // 每天的早安整体挪走了，下一轮又去把「原来那条」取消一遍。
  const makeupForShortId = args.__makeupForTaskUuid ? shortTaskId(args.__makeupForTaskUuid) : '';
  const head = makeupForShortId
    ? `已为 [${makeupForShortId}] 的这一次补上一条一次性任务 [${shortTaskId(result.uuid)}]，[${makeupForShortId}] 原来的重复节奏不变。`
    : !oldShortId
      ? `定时主动消息已创建 [${shortTaskId(result.uuid)}]。`
      : result.replacedCancelFailed
        ? `新任务 [${shortTaskId(result.uuid)}] 已创建，但原任务 [${oldShortId}] 远端取消失败、可能仍会触发，请再取消一次。`
        : `原任务 [${oldShortId}] 已换成 [${shortTaskId(result.uuid)}]（改期是重建，编号会变）。`;
  // 回话里的时间用折好的绝对时刻按角色时区渲染。拿 args.send_at 原串渲染会折两次
  // （先被 new Date 按设备解析，再换算到角色时区），角色刚排完就把时间说错。
  return `${head}将在 ${formatTaskTime(result.firstSendAt, charTz)} 开始生成${recurrenceDesc}。`
    + `模式：${describeTaskMode(record)}，策略：${describeExpirePolicy(expirePolicy)}。`;
}

/** 按 task_id 参数（或"只有一个就选它"）解出目标任务；解不出返回给 LLM 的提示文案。 */
const resolveTargetTask = (
  config: LoadedConfig,
  taskIdArg: unknown,
): { task?: ActiveMsg2TaskRecord; error?: string } => {
  const tasks = config.tasks;
  if (typeof taskIdArg === 'string' && taskIdArg.trim()) {
    const task = findTaskByShortId(tasks, taskIdArg.trim());
    return task ? { task } : { error: `没有找到短 id 为 ${taskIdArg} 的任务，请先用 list_active_messages 查看。` };
  }
  const pending = getPendingTasks(config, Date.now());
  if (pending.length === 1) return { task: pending[0] };
  if (pending.length === 0 && tasks.length === 1) return { task: tasks[0] };
  return { error: '当前有多个任务，请带 task_id（短 id）指定要操作哪一个。' };
};

async function handleCancel(args: Record<string, any>, deps: Amsg2ToolDeps): Promise<string> {
  const config = readConfig(deps);
  if (!config.tasks.length) return '当前角色没有排程中的主动消息任务。';
  const { task, error } = resolveTargetTask(config, args.task_id);
  if (!task) return error!;

  try {
    await ActiveMsgClient.cancelTask(task.taskUuid);
  } catch (e) {
    // 远端取消失败绝不静默移除本地记录（Codex #4）——否则远端 recurring 照发、
    // 本地却没了短 id，用户再也无法通过工具取消。
    console.warn('[amsg2ToolBridge] cancel remote task failed（保留本地记录待重试）', e);
    persistTasks(deps, config, config.tasks.map((t) =>
      t.taskUuid === task.taskUuid ? { ...t, lastError: '远端取消失败，任务可能仍会触发' } : t));
    return `取消任务 [${shortTaskId(task.taskUuid)}] 失败（远端未确认），稍后可重试。`;
  }
  persistTasks(deps, config, config.tasks.filter((t) => t.taskUuid !== task.taskUuid));
  return `已取消任务 [${shortTaskId(task.taskUuid)}]。`;
}

async function handleRenew(args: Record<string, any>, deps: Amsg2ToolDeps): Promise<string> {
  const config = readConfig(deps);
  if (!config.tasks.length) return '当前角色没有可续期的任务，请用 schedule_active_message 新建。';
  const { task, error } = resolveTargetTask(config, args.task_id);
  if (!task) return error!;
  if (task.mode === 'fixed') return '固定消息任务请在设置面板调整。';
  // 循环任务的续期只补当次：整条改期的话，一条「每天 9:00 的早安」被角色顺手续到
  // 11:00「晚点补上」，从明天起就永久变成 11:00 了，编号还跟着换一个。所以这里改成
  // 建一条一次性的补发任务，原序列原样留着继续按自己的节奏响。
  const isRecurring = task.recurrenceType !== 'none';
  // 一次性任务照旧复用 schedule 的替换语义（旧任务已被 worker 删掉时 cancel 失败只 warn）。
  // 内容/方向要变就不该走这里——工具描述已引导 cancel + 重建。
  return handleSchedule({
    send_at: args.send_at,
    mode: task.mode,
    prompt_hint: task.promptHint,
    recurrence: isRecurring ? 'none' : task.recurrenceType,
    expire_policy: task.expirePolicy,
    ...(isRecurring
      ? { __makeupForTaskUuid: task.taskUuid }
      : { __replaceTaskUuid: task.taskUuid }),
  }, deps);
}

async function handleList(deps: Amsg2ToolDeps): Promise<string> {
  const config = readConfig(deps);
  const charTz = resolveCharTimeZone(deps.char);
  const tasks = config.tasks;
  if (!tasks.length) return '当前角色没有任何定时主动消息任务。';
  const now = Date.now();
  const lines = tasks.map((t) => {
    // 工具侧没有远端底账，进度只能给中性的那档；时间按周期推到「下一次」，
    // 否则角色查到一条每天的任务显示的是好几天前，会当成已经过去的。
    const state = describeTaskProgress(t, null, now);
    return `- [${shortTaskId(t.taskUuid)}] ${formatTaskTime(currentOccurrenceMs(t, now) ?? t.firstSendTime, charTz)} ${describeRecurrence(t.recurrenceType)}`
      + ` · ${describeTaskMode(t)} · ${describeExpirePolicy(t.expirePolicy)} · ${state}`
      + `${t.lastError ? ` · ⚠ ${t.lastError}` : ''}`;
  });
  return `当前角色的任务列表：\n${lines.join('\n')}`;
}

export const isAmsg2GlobalReady = async (): Promise<boolean> => {
  try {
    const config = await ActiveMsgStore.getGlobalConfig();
    return !!config.workerUrl?.trim();
  } catch {
    return false;
  }
};
