/**
 * amsg worker 版本比较（设置页「重新粘贴部署」探测用）。
 *
 * 为什么 features 探测不够：amsg-server 2.6.0 的 next.4 / next.5 / next.6 三版
 * SERVER_FEATURES 清单完全相同（六项都在），而本波依赖的能力上游大多没发独立
 * feature flag——GET /messages 的 charId/clientTaskId 投影、onBeforeFire 的
 * { skip: true } 出口（next.5 起）、任务占位租约（next.6 起）、hook 的 writeState
 * 与 Web Push 大小护栏（next.7 起）。旧粘贴部署只查 features 会被误判为最新：
 * 防穿帮闸在 worker 侧静默不存在、任务列表全部误标「远端不存在」、长任务被相邻
 * cron tick 重复触发。只能再比 serverVersion。
 *
 * 比较语义按 semver + 数字化 prerelease：
 *   2.6.0-next.4 < 2.6.0-next.5 < 2.6.0-next.10 < 2.6.0 < 2.6.1-next.1
 * 解析不了的版本串（上游改格式等）视为「不达标」——宁可多亮一次「重新部署」，
 * 也不静默降级（与 capabilities 探测的设计初衷一致）。
 */

interface ParsedVersion {
  main: [number, number, number];
  /** null = 正式版（高于同主版本号的任何 prerelease）。 */
  pre: Array<string | number> | null;
}

const parseVersion = (value: string): ParsedVersion | null => {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?\s*$/.exec(value || '');
  if (!m) return null;
  return {
    main: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : null,
  };
};

/** a<b → -1，a==b → 0，a>b → 1；任一侧解析失败 → null。 */
export const compareAmsgServerVersions = (a: string, b: string): number | null => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.main[i] !== pb.main[i]) return pa.main[i] < pb.main[i] ? -1 : 1;
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1; // 前缀相同时段数少的更低（semver 规则）
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = typeof x === 'number';
    const yNum = typeof y === 'number';
    if (xNum && yNum) return (x as number) < (y as number) ? -1 : 1;
    if (xNum !== yNum) return xNum ? -1 : 1; // 数字段低于字母段（semver 规则）
    return (x as string) < (y as string) ? -1 : 1;
  }
  return 0;
};

export const isAmsgServerVersionAtLeast = (
  version: string | undefined | null,
  floor: string,
): boolean => {
  const cmp = compareAmsgServerVersions(version ?? '', floor);
  return cmp != null && cmp >= 0;
};
