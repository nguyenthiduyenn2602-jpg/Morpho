/**
 * 设置页「推送订阅状态」面板的文案层：把 BrowserPushState 这份读数翻译成用户能看懂
 * 的一行行字。纯函数、不碰 DOM，好让判定逻辑能被单测钉住——面板本身是 .tsx，跑不进
 * 这个仓库的 node 测试环境。
 */

import type { BrowserPushState, SubscribeFailureKind } from './pushSubscribeShared';

/** 这几类失败换多少次重试都是同一个结果，问题在设备/浏览器本身。 */
const DEVICE_LEVEL_FAILURES: SubscribeFailureKind[] = ['channel-unreachable', 'unsupported'];

/**
 * 失败记录还算不算数：手上已经有一条活订阅，说明后来建成了，旧记录留着只会误导。
 * subscribeWithRetry 成功时本来就会清盘，这里是防守——万一订阅是别的路径建起来的
 * （换了浏览器、SW 自愈重订），记录不会被清，但它显然已经过期了。
 */
export const hasLiveFailure = (state: BrowserPushState): boolean =>
  Boolean(state.lastSubscribeFailure) && (!state.endpoint || state.endpointDead);

/** 当前生效的失败分类，没有（或已过期）是 null。 */
export const liveFailureKind = (state: BrowserPushState): SubscribeFailureKind | null =>
  hasLiveFailure(state) ? state.lastSubscribeFailure!.kind : null;

export const describePermission = (permission: BrowserPushState['permission']): string => {
  if (permission === 'granted') return '已授权';
  if (permission === 'denied') return '已拒绝（要去浏览器的站点设置里手动打开）';
  if (permission === 'default') return '还没决定';
  return '不可用';
};

export const describeServiceWorker = (state: BrowserPushState): string => {
  if (state.swState === 'none') return '未注册';
  const scope = state.swScope || '?';
  return state.swState === 'activated' ? `已激活（scope: ${scope}）` : `${state.swState}（scope: ${scope}）`;
};

export const describeSubscription = (state: BrowserPushState): string => {
  if (!state.endpoint) return '不存在';
  return state.endpointDead ? '已被浏览器吊销' : '已建立';
};

/**
 * 「浏览器支持」这一行。
 *
 * 这行以前只答「接口齐不齐」，于是没装谷歌服务的国行安卓机上会显示「是」——接口确实
 * 齐（Chromium 把 PushManager 编译进去了），但底下根本没有推送通道，用户看到的就是
 * 「支持=是、权限=已授权、SW=已激活，订阅就是建不出来」，完全无从下手。能力检测查不
 * 出这种情况（查的是 JS 接口在不在），实际试过一次才知道，所以这里把订阅失败的结论
 * 也算进来。
 */
export const describeSupport = (state: BrowserPushState): string => {
  if (state.capacitorNative) return '否（现在跑在 App 里）';
  if (!state.supported) return '否（浏览器缺少推送相关接口）';
  const failure = liveFailureKind(state);
  if (failure === 'channel-unreachable') return '接口齐全，但连不上推送服务器';
  if (failure === 'unsupported') return '否（浏览器自称支持，实际建不出订阅）';
  return '是';
};

/** 「浏览器支持」这行要不要标红。 */
export const isSupportBad = (state: BrowserPushState): boolean => {
  if (!state.supported || state.capacitorNative) return true;
  const failure = liveFailureKind(state);
  return failure !== null && DEVICE_LEVEL_FAILURES.includes(failure);
};

/** 「3 分钟前」这种。刚发生的失败和上周留下的记录，排查价值差很远。 */
export const describeElapsed = (at: number, now: number = Date.now()): string => {
  if (!at) return '';
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
};
