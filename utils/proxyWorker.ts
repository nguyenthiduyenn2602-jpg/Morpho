/**
 * 主代理 Worker 地址 —— 中心配置（单一可信源）
 *
 * SullyOS 一票联网能力都通过同一个 Cloudflare Worker 代理转发，源码全在
 * `worker/index.js`（单文件，可一键搬到自己的 Cloudflare 账号）。涉及：
 *   - 联网搜索 / 实时新闻热榜（Brave）       → /search /news
 *   - WebDAV 云备份代理                       → /webdav
 *   - GitHub 云备份代理（GFW 下走代理）       → /github
 *   - Notion 集成                             → /notion/*
 *   - 飞书多维表格集成                        → /feishu/*
 *   - 麦当劳 / 瑞幸 点单 MCP                   → /mcp/mcd /mcp/luckin
 *
 * 默认指向作者部署的公共实例。如果作者哪天不再维护、或你想完全自托管，
 * 把自己部署的 worker 地址填进「设置 → 网络代理 (Worker)」即可，
 * 以上全部能力会自动切到你的实例，无需改任何代码。
 *
 * 注意：网易云音乐（MusicContext）和小红书 Lite 各自在自己的 App / 设置里有
 * 独立的 worker 地址输入框，走各自的持久化，不受这里影响。
 */

export const DEFAULT_PROXY_WORKER = 'https://sullymeow.ccwu.cc';

const LS_KEY = 'sully_proxy_worker_url_v1';

// 已死/弃用的历史公共实例域名。老用户 localStorage 里如果还存着这些，
// 读出来时自动当成"用的是默认"，回落到 DEFAULT_PROXY_WORKER（与
// MusicContext 的迁移逻辑一致：都指向同一个 worker，行为相同）。
//   - sully-n.qegj567.workers.dev：最早的 workers.dev 默认域名（国内超时）
//   - sullymeow.ccwu213.cc：旧公共自定义域名，注册已过期、DNS 无法解析（2026-07 起）
const STALE_HOSTS = [/sully-n\.qegj567\.workers\.dev/i, /sullymeow\.ccwu213\.cc/i];

const normalize = (url: string): string => url.trim().replace(/\/+$/, '');

/**
 * 读取当前生效的主代理 worker 地址（已去尾斜杠）。懒读 localStorage，
 * 用户在设置里改完、新发起的请求立刻生效，无需刷新页面。
 */
export const getProxyWorkerUrl = (): string => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PROXY_WORKER;
    const url = normalize(raw);
    if (!/^https?:\/\//i.test(url)) return DEFAULT_PROXY_WORKER;
    if (STALE_HOSTS.some((re) => re.test(url))) return DEFAULT_PROXY_WORKER;
    return url;
  } catch {
    return DEFAULT_PROXY_WORKER;
  }
};

/**
 * 写入自定义 worker 地址。传空、或传的就是默认地址 → 清掉本地存储（回到默认）。
 * 非法地址（不以 http(s):// 开头）直接忽略，由调用方负责校验提示。
 * 写入成功后广播一个自定义事件，让"启动时快照配置"的消费者（如音乐播放器）能实时跟随。
 */
export const setProxyWorkerUrl = (url: string): void => {
  try {
    const trimmed = normalize(url || '');
    if (!trimmed || trimmed === DEFAULT_PROXY_WORKER) {
      localStorage.removeItem(LS_KEY);
      notifyProxyWorkerChanged();
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) return;
    localStorage.setItem(LS_KEY, trimmed);
    notifyProxyWorkerChanged();
  } catch {
    /* localStorage 不可用就当默认处理 */
  }
};

/**
 * 中心 Worker 地址变更事件。同一标签页内改 localStorage 不会触发原生 'storage' 事件，
 * 所以用这个自定义事件通知那些"只在挂载时读一次配置"的模块（目前是音乐播放器）实时刷新。
 */
export const PROXY_WORKER_CHANGED_EVENT = 'sully:proxy-worker-changed';
const notifyProxyWorkerChanged = (): void => {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(PROXY_WORKER_CHANGED_EVENT));
    }
  } catch {
    /* 非浏览器环境（测试 / SSR）忽略 */
  }
};

/** 当前是否在用自定义（非默认）worker。用于设置页提示文案。 */
export const isCustomProxyWorker = (): boolean => getProxyWorkerUrl() !== DEFAULT_PROXY_WORKER;

/**
 * 把指向已死历史实例的 url 改写到当前生效的 worker（保留路径和 query）；
 * 其余地址原样返回。给音乐播放器 / 小红书等「独立持久化 worker 地址」的
 * 模块做存量迁移用——它们各自存的地址不走上面的 LS_KEY，得在自己的读取层调这个。
 */
export const rewriteStaleWorkerUrl = (url: string): string => {
  if (typeof url !== 'string' || !url || !STALE_HOSTS.some((re) => re.test(url))) return url;
  const base = getProxyWorkerUrl();
  try {
    const u = new URL(url);
    return `${base}${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  } catch {
    return base;
  }
};
