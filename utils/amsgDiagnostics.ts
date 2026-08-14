// 主动消息 2.0 的「体检」判定：把 worker 的 GET /debug 回执翻成一排能直接看的结论，
// 以及把 fetch 抛出来的异常翻成一句知道该去改哪儿的话。
//
// 单独成叶子的原因有两个：
//   1. 这两件事都是纯函数（输入回执 / 异常，输出结论），能脱开浏览器单测，而它们要
//      守的恰恰是「坏了但界面看不出来」这一类问题——没有测试钉住，退化了没人会发现。
//   2. activeMsgClient 要用它，设置面板也要用它，放在任何一边都会让另一边反向依赖。
//
// worker 那侧的对应实现见 worker/amsg/src/index.ts 的 inspectWorkerEnv / inspectStorage /
// judgeTick，改动那三处的输出形状时这份要跟着走。

// ─── 失败归类（给使用统计分档用）───
//
// 「连接失败」在图上只有一格的话，地址填错、密钥对不上、D1 没绑、纯断网会长成一个样，
// 而这四种要修的引导完全不同。所以在**抛错的那一刻**按源码里写死的谓词挂一个代号，
// 上报只带这个代号。
//
// 报错原文（可能带 Worker 地址、push endpoint）一个字都不进上报——挂在这里的
// 永远是下面这个联合类型里的字面量之一，不是从异常对象上读出来的任何东西。
// 见 docs/analytics.md 「加新埋点的规矩」第 4 条。
export type AmsgFailKind =
  | '地址没填'
  | '打到网页了'
  | '鉴权失败'
  | '端点不存在'
  | '建表失败'
  | '配置缺失'
  | '网络失败'
  | '权限被拒'
  | '不支持推送'
  | 'worker没配VAPID'
  | '订阅失败'
  | '推送通道不通'
  | '端点僵尸'
  | '其他';

/** 从 Worker 地址里取一个能给人看的域名。取不到（没填 / 填了段不是 URL 的东西）返回空串。 */
export const readWorkerHost = (workerUrl: string | null | undefined): string => {
  const value = workerUrl?.trim();
  if (!value) return '';
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
};

const looksLikeHtmlFallbackError = (message: string) => (
  /HTML/i.test(message) ||
  message.includes(`Unexpected token '<'`) ||
  /<!doctype/i.test(message) ||
  /<html/i.test(message)
);

/**
 * 浏览器把「连不上」报成什么，各家不一样：Chrome/Firefox 是 TypeError: Failed to fetch，
 * Safari 是 TypeError: Load failed，旧 Firefox 还有 NetworkError when attempting to fetch。
 * 三种都得认，漏一种就有一批人只能看到光秃秃的英文。
 */
const looksLikeOfflineError = (message: string, name: string) => (
  name === 'TypeError' ||
  /failed to fetch/i.test(message) ||
  /load failed/i.test(message) ||
  /networkerror/i.test(message)
);

const looksLikeTimeoutError = (message: string, name: string) => (
  name === 'AbortError' ||
  name === 'TimeoutError' ||
  /timed? ?out/i.test(message) ||
  /aborted/i.test(message)
);

export interface AmsgFetchFailureDescription {
  /** 直接显示给用户的整句，含「这是哪一步、坏在哪、去改哪儿」。可能多行。 */
  message: string;
  /** 上报用的代号，永远是 AmsgFailKind 里的字面量。 */
  kind: AmsgFailKind;
}

/**
 * 把 fetch 抛出来的异常翻成人话。
 *
 * 存在的理由：这类异常的原文只有 "Failed to fetch" 五个字，既不说打的是哪儿，也不说
 * 是网络不通还是地址错了。社区里排查这一句花掉过好几天——先怀疑代理平台封号、再怀疑
 * worker 配置、最后才发现只是当时没连上 Cloudflare。所以在这儿一次把三件事说全：
 * 是哪一步、连的是哪个域名、可能的原因分别去哪儿改。
 *
 * 另外必须写明「这条路不通不影响到点推送」：推送是 Cloudflare 直接发给设备的，
 * 跟浏览器能不能连上 worker 是两条路。不写的话用户会以为主动消息整个废了。
 */
export const describeAmsgFetchFailure = (
  error: unknown,
  phase: string,
  workerUrl?: string | null,
): AmsgFetchFailureDescription => {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error');
  const name = error instanceof Error ? error.name : '';
  const host = readWorkerHost(workerUrl);
  const where = host ? `（${host}）` : '';

  if (looksLikeHtmlFallbackError(raw)) {
    return {
      kind: '打到网页了',
      message: `主动消息 2.0 的${phase}请求没有打到 Worker${where}，而是拿到了一个网页。请确认设置里填的是你部署好的 amsg Worker 地址，不是某个网页地址。`,
    };
  }

  if (looksLikeTimeoutError(raw, name)) {
    return {
      kind: '网络失败',
      message: `主动消息 2.0 的${phase}请求等太久，超时了${where}。多半是当前网络到 Cloudflare 很慢或中途被掐断，稍后重试即可；一直这样的话，用设置面板里的「Deno 门面」换一条线路。\n到点的主动消息推送不走这条路，不受影响。`,
    };
  }

  if (looksLikeOfflineError(raw, name)) {
    return {
      kind: '网络失败',
      message: `连不上你的 Worker${where}，${phase}没能完成。\n这一步是这台设备直接去连 Cloudflare，常见原因有三个：当前网络到 Cloudflare 不通（换个网络，或用设置面板里的「Deno 门面」套一层）、Worker 地址填错了、Worker 已经被删掉了。\n到点的主动消息推送是 Cloudflare 直接发给设备的，不走这条路，所以照常收得到。`,
    };
  }

  return { kind: '其他', message: `主动消息 2.0 的${phase}请求失败：${raw}` };
};

// ─── /debug 回执 → 一排看得懂的结论 ───

/** worker 自检里「能跑但有一块是哑的」那类提醒。 */
export interface AmsgConfigWarning { code: string; message: string }

/**
 * 表结构自查没跑成时，worker 给出的归类代号（worker/amsg/src/index.ts 的
 * classifySchemaProbeError；改那边的档位这份要跟着走）。
 *
 * 分档全是为了「用户该做什么」：unsupported 点一下更新就好，denied 是后端自己的
 * 毛病、点什么都没用，timeout 再体检一次多半就过。
 */
export type AmsgSchemaProbeError = 'unsupported' | 'denied' | 'timeout' | 'other';

/** GET /debug 回执里用得上的那部分（worker/amsg/src/index.ts）。 */
export interface AmsgDebugReport {
  config: { ok: boolean; missing: string[]; message: string; warnings: AmsgConfigWarning[] };
  storage: {
    reachable: boolean;
    /** null = worker 查不了这一项（不等于「齐了」）。老 worker 只报 boolean。 */
    schemaReady?: boolean | null;
    /** 上面那项查不了时是为什么。缺字段 = 老 worker 不报这一项，只能笼统说一句。 */
    schemaError?: AmsgSchemaProbeError | null;
    missingTables?: string[];
    missingColumns?: string[];
    pushSubscriptionRegistered?: boolean;
    /**
     * 推送到底推没推出去。三态由 parseAmsgDebugReport 收敛，**认下来的回执里一定有值**
     * ——界面不用猜「缺字段」是什么意思。可选只是为了让「库根本读不到」那种桩不用凑
     * 一个没有意义的值；那种时候上面几行早就红了，压根走不到这一项。
     */
    pushDelivery?: AmsgPushDeliveryProbe;
    pendingTasks?: number;
    overdueTasks?: number;
    oldestOverdueMinutes?: number | null;
    error?: string;
  };
  /** cron 在不在按时处理任务。unknown = 手上没有待发任务，无从判断。 */
  tick: 'unknown' | 'idle' | 'healthy' | 'stalled';
  server: { version: string | null; featureCount: number } | null;
  vapidPublicKey: string | null;
}

/**
 * 认一份 /debug 回执，形状对不上返回 null。
 *
 * 宽容不了的地方在于：没有这个端点的 worker 回什么的都有（404 的 JSON、Cloudflare 的
 * 错误页、代理塞回来的一段 HTML）。只看 success 就采信的话，会把一台好 worker 判成
 * 「哪儿都是红的」——那比不体检还糟，用户照着提示改哪儿都改不对。
 */
export const parseAmsgDebugReport = (body: unknown): AmsgDebugReport | null => {
  const data = (body as { success?: unknown; data?: Record<string, any> } | null)?.data;
  if (!data || typeof data !== 'object') return null;
  const config = data.config;
  const storage = data.storage;
  if (typeof config?.ok !== 'boolean' || !Array.isArray(config.missing)) return null;
  if (typeof storage?.reachable !== 'boolean') return null;

  return {
    config: {
      ok: config.ok,
      missing: config.missing.filter((item: unknown): item is string => typeof item === 'string'),
      message: typeof config.message === 'string' ? config.message : '',
      warnings: Array.isArray(config.warnings)
        ? config.warnings.filter((item: any) => typeof item?.code === 'string' && typeof item?.message === 'string')
        : [],
    },
    storage: { ...storage, pushDelivery: normalizePushDeliveryProbe(storage.pushDelivery) },
    tick: ['idle', 'healthy', 'stalled'].includes(data.tick) ? data.tick : 'unknown',
    server: data.server && typeof data.server === 'object'
      ? { version: data.server.version ?? null, featureCount: Number(data.server.featureCount) || 0 }
      : null,
    vapidPublicKey: typeof data.vapidPublicKey === 'string' ? data.vapidPublicKey : null,
  };
};

// ─── 推送服务说「这条订阅已经没了」───
//
// 这是「登记状态全绿、到点一条都不来」的最后一块拼图。浏览器手里有订阅、Worker 上
// 也登记着同一条 endpoint——两边都自洽，但那条 endpoint 在推送服务（FCM/Mozilla/
// Apple）那侧早就作废了，推过去只会换回一个 410。这件事只有推送服务知道，前端和
// Worker 自己都查不出来。
//
// 事实由上游 amsg-server 产生并结构化保存（投递失败时把推送服务回的状态码写进任务的
// last_error），Worker 的 /debug 把它读出来，这份文件只负责把它翻成红绿灯和人话。
// 状态码怎么认在 worker/amsg/src/index.ts，那儿离数据最近。

/** 认出来的那一次「订阅已失效」。 */
export interface AmsgPushGoneFailure {
  /** 推送服务回的状态码：410 = 已注销/过期，404 = 端点根本不存在。 */
  status: number;
  /** 这次失败记录的时刻（epoch 毫秒）。 */
  atMs: number;
}

/**
 * 「推送投递情况」这一项的三种结局。
 *
 * `probed: false` 的两档都**不是**「没问题」：`unsupported` 是这台 Worker 上跑的后端
 * 还不查这一项（老 bundle），`failed` 是查了没查成。界面必须照实说查不了——在唯一能
 * 拆穿「全绿但一条不来」的地方给假绿灯，比没有这项检查更糟。
 */
export type AmsgPushDeliveryProbe =
  | { probed: false; reason: 'unsupported' | 'failed' }
  | { probed: true; gone: AmsgPushGoneFailure | null; registeredAtMs: number | null };

/** 认出 /debug 回执里那一段的形状。缺字段 = 老 bundle 不报这一项。 */
const normalizePushDeliveryProbe = (raw: unknown): AmsgPushDeliveryProbe => {
  if (raw === undefined) return { probed: false, reason: 'unsupported' };
  // worker 查不成时显式回 null（老库还没有 last_error 列、查询被拒）。
  if (!raw || typeof raw !== 'object') return { probed: false, reason: 'failed' };
  const value = raw as { gone?: any; registeredAtMs?: unknown };
  const status = Number(value.gone?.status);
  const atMs = Number(value.gone?.atMs);
  return {
    probed: true,
    gone: Number.isFinite(status) && Number.isFinite(atMs) ? { status, atMs } : null,
    registeredAtMs: Number.isFinite(Number(value.registeredAtMs)) ? Number(value.registeredAtMs) : null,
  };
};

/** 一行体检结论的严重程度。bad = 现在就是坏的，warn = 能跑但有一块是哑的。 */
export type AmsgDiagnosticLevel = 'ok' | 'warn' | 'bad' | 'unknown';

export interface AmsgDiagnosticRow {
  key: string;
  label: string;
  level: AmsgDiagnosticLevel;
  /** 一句话：坏在哪、去哪儿改。ok 的行写现状即可。 */
  detail: string;
}

/** 拉体检的结果。连不上时带上已经翻成人话的原因，那本身就是第一行结论。 */
export type AmsgDiagnosticsProbe =
  | { reachable: true; report: AmsgDebugReport }
  | { reachable: false; reason: string; /** 旧 worker 没有这个端点，不是坏了 */ unsupported?: boolean };

export interface AmsgDiagnosticsInput {
  probe: AmsgDiagnosticsProbe;
  /** 这台设备的浏览器有没有推送订阅（本地事实，worker 那侧看不到）。 */
  localPushSubscribed?: boolean;
  /** 把 epoch 毫秒写成给人看的时间；不传按本机习惯格式化（单测注入固定格式用）。 */
  formatTime?: (atMs: number) => string;
}

const defaultFormatTime = (atMs: number): string => new Date(atMs).toLocaleString();

/** 「重置订阅」在哪儿、点了会发生什么。几处文案共用一句，别各写各的。 */
export const PUSH_RESET_HINT = '去设置页的「推送订阅状态」点「重置订阅」重建一条——它会退订、重订、再覆盖登记回 Worker，点一次就够。';

const WORKER_TOO_OLD_HINT = '这台 Worker 上跑的后端还不查「推送有没有真的送出去」，所以「到点了但一条都不来」这种坏法它看不出来。点上面的「更新 Worker」换成新版就能查了。';

export interface AmsgPushDeliveryVerdict {
  level: 'bad' | 'warn';
  /** 发生了什么。几处共用，不带「去哪儿修」。 */
  what: string;
  /** 体检那一行的完整说法：发生了什么 + 该去哪儿点哪个按钮。 */
  detail: string;
}

/**
 * 上一次推送到底有没有被推送服务判成「订阅失效」，以及那笔账现在还算不算数。
 * 没问题（查过了、没发生过 / 是重置之前的旧账）返回 null。
 *
 * 体检的「这台设备」和设置页的推送订阅面板共用这一份判定：两处各写一套的话，
 * 用户会看到一个红一个绿，而这正是他唯一能拿来判断该不该重置订阅的依据。
 *
 * @param formatTime 把 epoch 毫秒写成给人看的时间；不传按本机习惯格式化。
 */
export const judgePushDeliveryFailure = (
  probe: AmsgPushDeliveryProbe | null | undefined,
  formatTime: (atMs: number) => string = defaultFormatTime,
): AmsgPushDeliveryVerdict | null => {
  if (!probe) return null;

  // 查不了不是「没问题」。报 warn 而不是红：这时并没有任何证据说明推送坏了，
  // 但也绝不能给绿灯——它恰恰是唯一能拆穿「全绿但一条不来」的那一项。
  if (!probe.probed) {
    const what = probe.reason === 'unsupported'
      ? '这次没查「推送有没有真的送出去」'
      : '「推送有没有真的送出去」这一项没查成（后端读不到任务的失败记录）';
    return {
      level: 'warn',
      what,
      detail: probe.reason === 'unsupported' ? WORKER_TOO_OLD_HINT : `${what}。到点却收不到消息的话，${PUSH_RESET_HINT}`,
    };
  }

  const { gone, registeredAtMs } = probe;
  if (!gone) return null;

  const when = formatTime(gone.atMs);
  const what = `${when} 那次推送被推送服务退回来了，理由是「这条订阅已经失效」（${gone.status}）`;

  // 登记时刻问不到就没法分辨新旧账。报 warn 不报红：重置过订阅的人不该被一条
  // 永远消不掉的红灯追着跑，但也不能给绿灯——那正是这条要拆穿的假象。
  if (registeredAtMs == null) {
    const uncertain = '这次问不到 Worker 上那行订阅是什么时候登记的，没法确认它是不是重置之前的旧账';
    return {
      level: 'warn',
      what: `${what}。${uncertain}`,
      detail: `${what}。${uncertain}；最近没重置过的话，${PUSH_RESET_HINT}`,
    };
  }

  // 那之后订阅换过一条了：这笔是上一条订阅的旧账，服务端只在失败时写、成功不会清。
  if (gone.atMs <= registeredAtMs) return null;

  const stillBroken = `${what}，而 Worker 上登记的还是它——到点的消息全都推不出去`;
  return { level: 'bad', what: stillBroken, detail: `${stillBroken}。${PUSH_RESET_HINT}` };
};

const DB_MISSING_HINT = 'Worker 没有绑定 D1 数据库。多半是部署第一步填完 Database ID 之后没点那个「Add」就直接 Deploy 了。回 Cloudflare 的 Settings → Bindings 加一条 D1 database，变量名填大写的 DB。';
const MASTER_KEY_MISSING_HINT = 'Worker 上没有 AMSG_MASTER_KEY。去 Settings → Variables and secrets 添加，类型一定要选 Secret——选成 Text 的话下次部署就会消失。';
const SCHEMA_STALE_HINT = '换过 Worker 版本后，已经存在的表不会自己长出新列，定时任务每分钟都会因为读不到它们而挂掉（界面上一切正常，就是一条都不发）。点上面的「重新连接并验证」补一次。';

/**
 * 表结构没查成时，各档分别该跟用户说什么。
 *
 * 每一句都要落到「要不要紧 + 该做什么」上。以前这里只有一句「查不了，不知道」——
 * 原因躺在 Cloudflare 日志里，用户看不到，隔着屏幕也问不出来，只能一路猜。
 */
const SCHEMA_PROBE_HINTS: Record<AmsgSchemaProbeError, string> = {
  denied: '查表结构时被数据库挡了一道：Cloudflare 在库里放了一张自己的内部表，不让 Worker 读，自查就断在那儿了。表齐没齐这次没查出来，但主动消息的收发不受影响。等后端更新到修好这处的版本就会自己恢复。',
  unsupported: '这台 Worker 上跑的后端代码还没有「查自己表结构」这个本事，齐没齐问不出来。点上面的「更新 Worker」换成新版就能查了。',
  timeout: '查表结构时数据库没在时限内回话，这次没查出来。多半是 D1 刚被唤醒（隔几小时的头一次请求常这样），过一会儿再体检一次通常就好了。',
  other: '这台 Worker 查不了自己的表结构，齐没齐不知道。要是主动消息到点不响，先点一次上面的「重新连接并验证」把表补齐。',
};

/**
 * 把体检结果排成一列，顺序就是「该先修哪个」。
 *
 * 每一行只回答一个问题，且都是靠自己能改的：连不连得上 → 库绑没绑 → 密钥有没有 →
 * 表建没建全 → 推送凭据配没配 → 这台设备登记了没 → 定时任务在不在跑。
 * 前面的行是坏的时候，后面那些查不出结论的一律报 unknown，不假装绿。
 */
export const buildAmsgDiagnosticRows = (input: AmsgDiagnosticsInput): AmsgDiagnosticRow[] => {
  const { probe, localPushSubscribed } = input;

  if (!probe.reachable) {
    const unknownRest = (key: string, label: string): AmsgDiagnosticRow => ({
      key, label, level: 'unknown', detail: '连上 Worker 之后才能查。',
    });
    return [
      {
        key: 'reachable',
        label: 'Worker 可达',
        level: probe.unsupported ? 'warn' : 'bad',
        detail: probe.reason,
      },
      unknownRest('database', '数据库绑定'),
      unknownRest('masterKey', '主密钥'),
      unknownRest('schema', '数据表'),
      unknownRest('pushCredential', '推送凭据'),
      unknownRest('pushDevice', '这台设备'),
      unknownRest('tick', '定时任务'),
    ];
  }

  const { config, storage, tick } = probe.report;
  const rows: AmsgDiagnosticRow[] = [];

  rows.push({
    key: 'reachable',
    label: 'Worker 可达',
    level: 'ok',
    detail: probe.report.server?.version ? `后端版本 ${probe.report.server.version}` : '连得上。',
  });

  const dbMissing = config.missing.includes('DB');
  rows.push({
    key: 'database',
    label: '数据库绑定',
    level: dbMissing ? 'bad' : 'ok',
    detail: dbMissing ? DB_MISSING_HINT : '已绑定 D1。',
  });

  const masterKeyMissing = config.missing.includes('AMSG_MASTER_KEY');
  const masterKeyFormat = config.warnings.find((item) => item.code === 'MASTER_KEY_FORMAT');
  rows.push({
    key: 'masterKey',
    label: '主密钥',
    level: masterKeyMissing ? 'bad' : masterKeyFormat ? 'warn' : 'ok',
    detail: masterKeyMissing ? MASTER_KEY_MISSING_HINT : masterKeyFormat?.message || '已配置。',
  });

  // 库都没绑的话，下面这些查出来必然是「什么都没有」，报红会把人往错的方向引。
  if (dbMissing || !storage.reachable) {
    rows.push({
      key: 'schema',
      label: '数据表',
      level: dbMissing ? 'unknown' : 'bad',
      detail: dbMissing
        ? '先把 D1 绑上再看这一项。'
        : `连得上 Worker，但读不了它的数据库${storage.error ? `（${storage.error}）` : ''}。`,
    });
  } else if (storage.schemaReady === null) {
    // Worker 连得上、库也读得到，但它比对不出表结构（比如那句查询本身被拒了）。
    // 这一档过去混在「正常」里——而这一项存在的全部意义就是查出表结构漂移，
    // 漂移时 cron 每分钟静默失败、界面处处正常，这里再给一个假绿灯就彻底没人能发现了。
    rows.push({
      key: 'schema',
      label: '数据表',
      level: 'unknown',
      detail: SCHEMA_PROBE_HINTS[storage.schemaError || 'other'],
    });
  } else {
    const missingTables = storage.missingTables || [];
    const missingColumns = storage.missingColumns || [];
    const schemaBad = missingTables.length > 0 || missingColumns.length > 0;
    // 明说了不够用（false）却一项都没点到名 = 自查本身没跑成，而主表确实不在：库还是空的。
    // 只数这两个数组的话，一个一张表都没建的空库会显示成全绿——一键部署完还没点连接时
    // 正好是这个组合（表没建 + 自查被内部表拒掉）。
    const emptyDatabase = storage.schemaReady === false && !schemaBad;
    rows.push({
      key: 'schema',
      label: '数据表',
      level: schemaBad || emptyDatabase ? 'bad' : 'ok',
      detail: emptyDatabase
        ? '库里还一张表都没有。点上面的「重新连接并验证」建一次。'
        : missingTables.length
          ? `缺表：${missingTables.join('、')}。点上面的「重新连接并验证」会自动建好（可能要点两次）。`
          : missingColumns.length
            ? `表结构是旧的，缺列：${missingColumns.join('、')}。${SCHEMA_STALE_HINT}`
            : '表和列都齐了。',
    });
  }

  const vapidWarning = config.warnings.find((item) => item.code === 'VAPID_MISSING');
  rows.push({
    key: 'pushCredential',
    label: '推送凭据',
    level: vapidWarning ? 'bad' : 'ok',
    // 这是最难自己查出来的一种坏法：任务建得成、界面全绿，到点一条都推不出去。
    detail: vapidWarning ? vapidWarning.message : 'VAPID 已配齐。',
  });

  const remoteRegistered = storage.pushSubscriptionRegistered === true;
  // 两边都登记着，也不等于推得出去：那条 endpoint 可能在推送服务那侧早就作废了。
  // 只有投递结果知道这件事，登记状态是绿的时候更要看它——「全绿但一条不来」就是
  // 这么来的。云端压根没登记时不看这个：那时该修的是上一层，说两件事只会分散注意力。
  const deliveryVerdict = remoteRegistered
    ? judgePushDeliveryFailure(storage.pushDelivery, input.formatTime)
    : null;
  rows.push({
    key: 'pushDevice',
    label: '这台设备',
    level: !localPushSubscribed ? 'bad' : !remoteRegistered ? 'bad' : deliveryVerdict?.level || 'ok',
    detail: !localPushSubscribed
      ? '这台设备还没订阅推送，点下面的「开启通知与推送」。'
      : !remoteRegistered
        ? '浏览器订阅好了，但 Worker 上没有登记收件设备——到点的消息发不出去。点下面的「开启通知与推送」补登记一次。'
        : deliveryVerdict?.detail
          || '浏览器已订阅，Worker 上也登记了收件设备，最近一次推送也没被退回来。换设备或换浏览器之后要在新的那台上再点一次「开启通知与推送」。',
  });

  const overdue = storage.overdueTasks || 0;
  const stalledMinutes = storage.oldestOverdueMinutes ?? null;
  rows.push({
    key: 'tick',
    label: '定时任务',
    level: tick === 'stalled' ? 'bad' : tick === 'unknown' ? 'unknown' : 'ok',
    detail: tick === 'stalled'
      ? `有 ${overdue} 条任务到点${stalledMinutes === null ? '' : ` ${stalledMinutes} 分钟`}还没发出去。定时触发器可能没在跑，或者每分钟那一跳在报错——去 Cloudflare 的 Workers → 你的 Worker → Observability 看日志。`
      : tick === 'healthy'
        ? `${storage.pendingTasks ?? 0} 条待发任务，都在按时处理。`
        : tick === 'idle'
          ? '现在没有待发任务。'
          : '手上没有待发任务，暂时看不出定时器在不在跑。',
  });

  return rows;
};

/** 一排结论里最严重的那一档，用来给面板定基调。 */
export const summarizeAmsgDiagnostics = (rows: AmsgDiagnosticRow[]): AmsgDiagnosticLevel => {
  if (rows.some((row) => row.level === 'bad')) return 'bad';
  if (rows.some((row) => row.level === 'warn')) return 'warn';
  if (rows.some((row) => row.level === 'unknown')) return 'unknown';
  return 'ok';
};

// ─── 即时对话：开不了的话卡在哪一道 ───

/**
 * 即时对话四道门里最先没过的那一道。
 *
 * 代号写死在这儿，设置页拿它选提示文案、使用统计拿它当属性——**两处共用同一个判定**。
 * 各算各的话，黄字说的和上报里的早晚各说各话，而这条路上的每一次分歧都只能靠用户
 * 自己来报（他看到的是「开关点不动」，我们看到的是「没人开」）。
 */
export type InstantChatBlocker = '没连上Worker' | '没开推送' | 'Worker太旧' | '与InstantPush冲突';

export interface InstantChatGateInput {
  /** 连接并验证成功过（全局配置的 initializedAt）。 */
  connected: boolean;
  /** 这台设备订阅了推送。 */
  pushSubscribed: boolean;
  /** 这台 Worker 认 `POST /instant-chat`（GET /config-check 的 instantChat 标志）。 */
  workerSupportsInstantChat: boolean;
  /** Instant Push 那条路也配齐开着。 */
  instantPushOn: boolean;
}

/**
 * 按「先补哪个」的顺序返回第一道没过的门，四道全过返回 null。
 *
 * 顺序不是随便排的：没连上就谈不上推送，没推送权限就算发得出去也收不回来，
 * Worker 太旧则端点根本不存在，最后才是两条发送路只能留一条。
 */
export const resolveInstantChatBlocker = (input: InstantChatGateInput): InstantChatBlocker | null => {
  if (!input.connected) return '没连上Worker';
  if (!input.pushSubscribed) return '没开推送';
  if (!input.workerSupportsInstantChat) return 'Worker太旧';
  if (input.instantPushOn) return '与InstantPush冲突';
  return null;
};

/** 每道门对应的那句话（设置页开关下面的黄字）。 */
export const INSTANT_CHAT_BLOCKER_HINTS: Record<InstantChatBlocker, string> = {
  '没连上Worker': '先在上面把 Worker 连上。',
  '没开推送': '先开启通知与推送：回复是靠推送送回来的，没有权限就变成发得出、收不到。',
  'Worker太旧': 'Worker 上跑的代码还起不了这条路（缺起跳器，或者还是旧版）。点上面的「更新 Worker」，更新完这里会自己恢复。开着也不会走云端——那台 Worker 上是发一条挂一条，这段时间聊天先在本地生成。',
  '与InstantPush冲突': 'Instant Push 也开着，两条发送路只能留一条。上面那张黄色卡片里可以把它关掉。',
};
