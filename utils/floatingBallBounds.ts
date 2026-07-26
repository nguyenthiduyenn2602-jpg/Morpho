/**
 * 全局悬浮球（GlobalMiniPlayer）的拖拽边界计算。
 *
 * 抽成纯函数是为了能脱离 DOM 单测：把「球不能拖进 safe area（刘海 / home 条）」这条
 * 行为钉住，防止以后又退回成只按物理容器尺寸 clamp。
 *
 * 坐标系：父容器（PhoneShell 的外壳 div）的 padding box，原点在左上。
 *  - insetTop    顶部要让出的高度（刘海 / 状态栏），= max(父容器 paddingTop, env safe-top)
 *  - insetBottom 底部要让出的高度（home 手势条），= 父容器 paddingBottom
 *    （未迁移 App 外壳用 paddingBottom 让位安全区；已迁移 App 外壳已把底边收回安全区内，paddingBottom 为 0）
 */

export const DEFAULT_BUBBLE_SIZE = 40;
export const DEFAULT_EDGE_PAD = 8;
export const IOS_STANDALONE_TOP_FALLBACK = 44;

const clampRange = (value: number, lo: number, hi: number): number =>
  Math.min(Math.max(value, lo), Math.max(lo, hi));

export interface BubbleBoundsInput {
  parentW: number;
  parentH: number;
  insetTop: number;
  insetBottom: number;
  bubble?: number;
  pad?: number;
}

/** 折叠小球（left/top 定位）：横向只留 EDGE_PAD，纵向额外让出 safe area。 */
export const clampBubblePos = (
  x: number,
  y: number,
  { parentW, parentH, insetTop, insetBottom, bubble = DEFAULT_BUBBLE_SIZE, pad = DEFAULT_EDGE_PAD }: BubbleBoundsInput,
): { x: number; y: number } => ({
  x: clampRange(x, pad, parentW - bubble - pad),
  y: clampRange(y, pad + insetTop, parentH - bubble - pad - insetBottom),
});

export interface ExpandedBoundsInput {
  parentH: number;
  selfH: number;
  insetTop: number;
  insetBottom: number;
  pad?: number;
}

/** 展开条（bottom 定位）：bottom 是距父容器底边的距离，越大越靠上。 */
export const clampExpandedBottom = (
  bottom: number,
  { parentH, selfH, insetTop, insetBottom, pad = DEFAULT_EDGE_PAD }: ExpandedBoundsInput,
): number =>
  clampRange(bottom, pad + insetBottom, parentH - selfH - pad - insetTop);

export interface RawInsets {
  padTop: number;
  padBottom: number;
  safeTop: number;
}

export interface SafeTopInsetInput {
  standaloneSafeTop: number;
  probedSafeTop: number;
  isIOSStandalone: boolean;
  fallback?: number;
}

/**
 * 顶部安全区的来源优先级：
 * 1. :root 上的 --standalone-safe-area-top（iosStandalone.ts 已带 iOS 冷启动 44px 兜底）
 * 2. 当前 env/probe 读数
 * 3. iOS standalone 下最后再兜 44px，防止变量还没初始化时先拖进刘海
 */
export const resolveSafeTopInset = ({
  standaloneSafeTop,
  probedSafeTop,
  isIOSStandalone,
  fallback = IOS_STANDALONE_TOP_FALLBACK,
}: SafeTopInsetInput): number => {
  if (standaloneSafeTop > 0) return standaloneSafeTop;
  if (probedSafeTop > 0) return probedSafeTop;
  return isIOSStandalone ? fallback : 0;
};

/**
 * 把外壳 padding 与真机刘海合成球要让出的安全区高度。
 * 顶部取两者较大：未迁移 App 的 paddingTop 已是刘海高度；已迁移 App paddingTop 为 0，靠真机 safe-top 兜底——
 * 两种 App 都不会让球钻进刘海。
 * 底部只取 paddingBottom：未迁移 App 即安全区高度，已迁移 App 外壳已把底边收回安全区内（为 0）；
 * 不叠加真机 safe-bottom（否则已迁移 App 会多让一截、球停得偏高）。
 */
export const resolveInsets = ({ padTop, padBottom, safeTop }: RawInsets): { insetTop: number; insetBottom: number } => ({
  insetTop: Math.max(padTop, safeTop),
  insetBottom: padBottom,
});
