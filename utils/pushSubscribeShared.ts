/**
 * Shared Web Push subscribe helpers used by the Instant Push, Proactive Push
 * and 主动消息 2.0 paths. All of them hit the same browser race / encoding
 * quirks; this file is the single source of truth so a future browser-quirk
 * patch lands in one place instead of three.
 *
 * 同时也是「浏览器这一侧推送现状」的唯一读法（readBrowserPushState 及它下面那
 * 几个 detect*）——设置页的状态面板拿它显示，各层不用各写一份厂商判定。
 */

// unsubscribe() resolve 后 Chromium 内部 PushMessagingAppIdentifier 把当前
// 订阅标成 removed-sentinel; 这段时间里紧接着的 subscribe() 会直接吐
// `permanently-removed.invalid` 哨兵, 而不是去 FCM 拿新端点. 等一会再试就好.
// 桌面 Chrome ~ 300ms 够, 移动端 / iOS PWA 给 800ms 起步, 失败再线性退避.
export const SUBSCRIBE_SETTLE_MS = 800;
/** 总尝试次数 (含首次), 不是"重试次数". 当前: 1 次首试 + 2 次重试 = 3 次. */
export const SUBSCRIBE_ATTEMPTS_MAX = 3;

/** Convert base64url string to Uint8Array<ArrayBuffer> (for VAPID applicationServerKey). */
export function b64uToBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (b64u.length % 4)) % 4);
  const bin = atob(padded);
  // 显式拿 ArrayBuffer 而不是默认 ArrayBufferLike, 否则 PushManager.subscribe 在
  // 严格 TS lib (ArrayBufferView<ArrayBuffer>) 下会判 SharedArrayBuffer 不兼容.
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * True if a subscription's endpoint is a Chrome-internal "permanently
 * removed" sentinel.  Browsers occasionally revoke subscriptions due to
 * long inactivity, abuse signals, or the site being visited too rarely;
 * `getSubscription()` then returns an object whose endpoint URL is
 * `https://permanently-removed.invalid/...`.  `.invalid` is an RFC 2606
 * reserved TLD that never resolves, so any push send would fail with a
 * generic upstream error (which Cloudflare Workers wraps as HTTP 530).
 */
export function isDeadPushEndpoint(endpoint: string | null | undefined): boolean {
  if (!endpoint) return false;
  return endpoint.includes('permanently-removed.invalid');
}

/**
 * Web Push 三件套能力检测: Service Worker / PushManager / Notification。
 * 全齐返回 null; 缺任何一个返回可直接展示给用户的原因文案。
 *
 * 为什么要细分: X浏览器 / Via 这类 WebView 壳浏览器常见「SW 能注册成功但没有
 * PushManager / Notification」(2026-07 用户实测: 诊断里 sw: active、notif:
 * unsupported, 却被报"不支持 Service Worker") —— 笼统文案会把用户引去查 SW /
 * 重装 PWA, 实际是内核没有 Web Push 能力, 只能换浏览器。Notification 也必须
 * 在这里查掉: 只查 PushManager 的话, 后续 `Notification.permission` 在没有该
 * API 的环境会直接 ReferenceError。
 */
export function describePushCapabilityGap(): string | null {
  const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const pushSupported = typeof window !== 'undefined' && 'PushManager' in window;
  const notifSupported = typeof Notification !== 'undefined';
  if (swSupported && pushSupported && notifSupported) return null;
  const missing = [
    !swSupported ? 'Service Worker' : '',
    !pushSupported ? 'Push API' : '',
    !notifSupported ? '系统通知接口 (Notification)' : '',
  ].filter(Boolean).join('、');
  return `当前浏览器缺少 ${missing}，内核没有网页推送能力（X浏览器 / Via 等 WebView 壳浏览器的通病）—— 请换 Chrome / Edge / Firefox 等完整内核浏览器`;
}

/**
 * 订阅建不出来时，是卡在哪一类。面板据此决定「浏览器支持」那行怎么写，
 * 各推送层据此挂自己的失败代号。
 *
 * 'channel-unreachable' 是最难自己看出来的一类：浏览器接口全在、权限也给了，
 * 但底下那条通往推送服务商的路不通。Chromium 系（Chrome / Edge）安卓版的网页
 * 推送是转交系统里的谷歌服务（GMS）去注册的，国行安卓机默认不装 GMS，于是
 * 能力检测全绿、subscribe() 必挂。
 */
export type SubscribeFailureKind =
  | 'channel-unreachable'
  | 'unsupported'
  | 'permission'
  | 'state'
  | 'zombie'
  | 'unknown';

export interface SubscribeFailure {
  kind: SubscribeFailureKind;
  /** 可直接展示给用户的整句。 */
  text: string;
  /** 失败发生的时刻（epoch ms）。面板拿它说「多久之前试的」，避免展示陈年旧账。 */
  at: number;
}

const LAST_SUBSCRIBE_FAILURE_KEY = 'push_last_subscribe_failure_v1';

/**
 * 记下 / 读出 / 清掉「最近一次订阅失败」。
 *
 * 为什么要落盘：失败原文以前只走 toast，一闪而过，用户回头想看就没了——而这类
 * 失败恰恰是最需要照着原文排查的。落盘之后设置页的面板能把它固定显示出来。
 *
 * 三条推送链路（主动消息 2.0 / Instant Push / Proactive Push）共用这一份记录，
 * 因为底下调的是同一个 `pushManager.subscribe()`，失败原因是设备级的、不分链路。
 *
 * 写在 subscribeWithRetry 里面而不是各调用方：调用方漏写一处，那条路径的失败就
 * 又变回一闪而过。localStorage 在 Service Worker 里不存在，所以带 typeof 守卫。
 */
export function rememberSubscribeFailure(failure: SubscribeFailure): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LAST_SUBSCRIBE_FAILURE_KEY, JSON.stringify(failure));
  } catch { /* 存不下就算了，诊断信息没到丢了要拦流程的地步 */ }
}

export function readSubscribeFailure(): SubscribeFailure | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LAST_SUBSCRIBE_FAILURE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.text !== 'string' || typeof parsed.kind !== 'string') return null;
    return { kind: parsed.kind, text: parsed.text, at: typeof parsed.at === 'number' ? parsed.at : 0 };
  } catch {
    return null;
  }
}

export function clearSubscribeFailure(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LAST_SUBSCRIBE_FAILURE_KEY);
  } catch { /* 同上 */ }
}

/**
 * 从订阅端点认出推送厂商。端点域名是各厂商写死的，认不出就说「未识别厂商」，
 * 不猜。设置页拿它显示「推送通道」那一行——用户排障时第一句话往往是「我用的
 * Chrome」，能直接对上 Google FCM 就省一轮来回。
 */
export function detectPushChannel(endpoint: string | null | undefined): string {
  if (!endpoint) return '未知';
  if (/fcm\.googleapis\.com|android\.googleapis\.com/i.test(endpoint)) return 'Google FCM (Chrome / Edge / 安卓)';
  if (/updates\.push\.services\.mozilla\.com/i.test(endpoint)) return 'Mozilla autopush (Firefox)';
  if (/notify\.windows\.com|wns2/i.test(endpoint)) return 'Windows WNS (Edge)';
  if (/web\.push\.apple\.com/i.test(endpoint)) return 'Apple APNs (Safari / iOS PWA)';
  return '未识别厂商';
}

/**
 * 页面是不是跑在 Capacitor 打包的原生壳里（安卓/iOS 的 WebView），而不是普通
 * 浏览器标签页。探全局而不 import `@capacitor/core`，这个文件才能继续被 SW
 * 侧的打包 tree-shake 掉。
 */
export function detectCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    try { return !!cap.isNativePlatform(); } catch { /* ignore */ }
  }
  // 老版本 Capacitor 没有 isNativePlatform，退回读 platform。
  return cap.platform === 'android' || cap.platform === 'ios';
}

/**
 * 在 iOS Safari 里、但没走「添加到主屏幕」的 PWA 启动。iOS 的 Web Push 只在
 * 主屏 PWA 里可用，这种情况得先引导用户装到主屏，光讲权限没用。
 */
export function detectIosNeedsPwa(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  if (!isIos) return false;
  // iOS 老的 navigator.standalone 和 display-mode 媒体查询，任一为真都算已装主屏。
  const standalone =
    (navigator as any).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return !standalone;
}

/** 浏览器这一侧的推送现状。跟具体哪台 worker 无关，各推送层都能拿去显示。 */
export interface BrowserPushState {
  /** Web Push 三件套齐不齐（SW / Push API / Notification）。 */
  supported: boolean;
  /** 缺件时的整句说明，齐了是 null。取自 describePushCapabilityGap。 */
  capabilityGap: string | null;
  permission: NotificationPermission | 'unavailable';
  /** 已注册 SW 的 scope，没注册是 null。 */
  swScope: string | null;
  /** 'activated' | 'installing' | 'waiting' | 'redundant' | 'none' */
  swState: string;
  /** 当前浏览器订阅的端点，没订阅是 null。 */
  endpoint: string | null;
  /** 端点是不是 `permanently-removed.invalid` 僵尸哨兵。 */
  endpointDead: boolean;
  /** 推送厂商，见 detectPushChannel。 */
  channel: string;
  iosNeedsPwa: boolean;
  capacitorNative: boolean;
  /**
   * 最近一次订阅失败的记录，没失败过是 null。
   *
   * 这是判断「接口都在但这台设备实际推不了」的**唯一**可靠依据：能力检测查的是
   * JS 接口在不在，而 Chromium 的 PushManager 是编译进去的，跟底下有没有推送通道
   * 无关，所以没 GMS 的安卓机能力检测照样全绿。只有真的试过一次才知道。
   */
  lastSubscribeFailure: SubscribeFailure | null;
}

/**
 * 读一次浏览器侧的推送现状，给设置页的状态面板用。
 *
 * 全程只读、不请求权限、不建订阅、不碰任何 worker——面板刷新会反复调它，带副作用
 * 的话用户点一下「刷新」就可能被弹权限框。探测中途抛错按「读不到」处理，让面板
 * 显示得出「未注册 / 不存在」，比整块空着强。
 */
export async function readBrowserPushState(): Promise<BrowserPushState> {
  const capabilityGap = describePushCapabilityGap();
  const supported = capabilityGap === null;
  const permission: BrowserPushState['permission'] =
    typeof Notification === 'undefined' ? 'unavailable' : Notification.permission;

  let swScope: string | null = null;
  let swState = 'none';
  let endpoint: string | null = null;
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        swScope = reg.scope;
        const worker = reg.active || reg.waiting || reg.installing;
        swState = worker ? worker.state : 'none';
        // 壳浏览器可能有 SW 却没有 PushManager，这里不能无条件点下去。
        const sub = await reg.pushManager?.getSubscription();
        endpoint = sub?.endpoint || null;
      }
    } catch { /* 读不到就维持默认值 */ }
  }

  return {
    supported,
    capabilityGap,
    permission,
    swScope,
    swState,
    endpoint,
    endpointDead: isDeadPushEndpoint(endpoint),
    channel: detectPushChannel(endpoint),
    iosNeedsPwa: detectIosNeedsPwa(),
    capacitorNative: detectCapacitorNative(),
    lastSubscribeFailure: readSubscribeFailure(),
  };
}

/**
 * Translate the browser's raw subscribe() rejection into a Chinese,
 * end-user-actionable hint.  The common cases on Android phones without
 * Google Play Services (or in third-party Chromium-based browsers that
 * advertise `PushManager` but route through FCM internally) are
 * `AbortError` / generic network errors when the FCM endpoint cannot be
 * reached.  We surface those distinctly so the user knows it's not a
 * permission issue.
 */
export function explainSubscribeError(e: unknown): Omit<SubscribeFailure, 'at'> {
  const err = e as { name?: string; message?: string } | null;
  const name = err?.name || '';
  const msg = err?.message || String(e || '未知错误');
  if (name === 'NotAllowedError') {
    return {
      kind: 'permission',
      text: '浏览器拒绝创建订阅（NotAllowedError）——通常是站点权限被拦截或处于隐身模式',
    };
  }
  if (name === 'NotSupportedError') {
    return {
      kind: 'unsupported',
      text: '当前浏览器不支持网页推送——常见于手机自带的精简浏览器，或没装谷歌服务的国行安卓机上的 Chrome / Edge。同一台手机上可以换 Firefox 试试（它的推送不经过谷歌），或者用电脑',
    };
  }
  if (name === 'AbortError' || /push service|FCM|network/i.test(msg)) {
    return {
      kind: 'channel-unreachable',
      text: '连不上推送服务器——浏览器接口都在，但底下那条通往推送服务商的路走不通。Chrome / Edge 的网页推送要转交系统里的谷歌服务（GMS）去注册，国行安卓机（华为 / 小米 / OPPO / vivo）出厂就不带 GMS，装了也还得连得上谷歌的服务器。同一台手机上换 Firefox 最有希望（它走 Mozilla 自己的推送服务器，完全不碰谷歌），或者换电脑',
    };
  }
  if (name === 'InvalidStateError') {
    return {
      kind: 'state',
      text: '订阅状态冲突（InvalidStateError）——可能旧订阅没清干净，刷新页面或再点一次「重置订阅」',
    };
  }
  return { kind: 'unknown', text: `订阅创建失败（${name || 'Error'}：${msg}）` };
}

/**
 * Subscribe with retry on zombie sentinel.  Wait between attempts is linear:
 * 800ms before attempt #2, 1600ms before attempt #3.  No wait before the
 * first attempt — caller is responsible for any required settle delay after
 * its own unsubscribe().
 */
export async function subscribeWithRetry(
  reg: ServiceWorkerRegistration,
  vapidPublicKey: string,
  logPrefix: string,
): Promise<{ sub: PushSubscription | null; failure?: SubscribeFailure }> {
  // 成败都要落一次盘：失败留原因给面板显示，成功清掉上一次的，否则修好之后面板
  // 还挂着一条陈年失败，比不显示更误导。
  const fail = (partial: Omit<SubscribeFailure, 'at'>) => {
    const failure: SubscribeFailure = { ...partial, at: Date.now() };
    rememberSubscribeFailure(failure);
    return { sub: null, failure };
  };

  for (let attempt = 0; attempt < SUBSCRIBE_ATTEMPTS_MAX; attempt++) {
    let sub: PushSubscription;
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64uToBytes(vapidPublicKey),
      });
    } catch (e) {
      console.warn(`${logPrefix} pushManager.subscribe failed`, e);
      return fail(explainSubscribeError(e));
    }
    if (!isDeadPushEndpoint(sub.endpoint)) {
      clearSubscribeFailure();
      return { sub };
    }
    try { await sub.unsubscribe(); } catch (e) {
      // 如果连 unsubscribe 都抛, 下一次 subscribe() 大概率还是同一个 zombie,
      // 但仍然兜底重试 (重试上限挡着不会死循环).
      console.warn(`${logPrefix} unsubscribe of zombie endpoint threw`, e);
    }
    const isLast = attempt === SUBSCRIBE_ATTEMPTS_MAX - 1;
    if (!isLast) {
      const wait = SUBSCRIBE_SETTLE_MS * (attempt + 1);
      console.warn(`${logPrefix} subscribe() returned zombie endpoint; retry #${attempt + 1} after ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  return fail({
    kind: 'zombie',
    text: `浏览器持续返回 permanently-removed.invalid（已尝试 ${SUBSCRIBE_ATTEMPTS_MAX} 次）— 可能是由于站点参与度 (Site Engagement) 过低或浏览器内部数据残留导致。请尝试清理站点数据后重试，或更换设备/浏览器`,
  });
}
