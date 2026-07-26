import { describe, it, expect } from 'vitest';
import { clampBubblePos, clampExpandedBottom, resolveInsets, resolveSafeTopInset } from './floatingBallBounds';

// 设备模型：竖屏 iPhone，父容器 390×800，顶部刘海 44、底部 home 条 34。
const parentW = 390;
const parentH = 800;
const insetTop = 44;
const insetBottom = 34;
const bubble = 40;
const pad = 8;

describe('clampBubblePos（折叠小球）', () => {
  it('拖到底部时停在 home 条上方，不被手势条挡住', () => {
    const { y } = clampBubblePos(0, 9999, { parentW, parentH, insetTop, insetBottom });
    // 旧逻辑（不减 insetBottom）会停在 752，球底正好压进 home 条区域；现在应停在更上方
    expect(y).toBe(parentH - bubble - pad - insetBottom); // 718
  });

  it('拖到顶部时停在刘海下方，不钻进刘海', () => {
    const { y } = clampBubblePos(0, -9999, { parentW, parentH, insetTop, insetBottom });
    expect(y).toBe(pad + insetTop); // 52，而非旧的 8
  });

  it('横向仍只留 EDGE_PAD（竖屏无左右安全区）', () => {
    expect(clampBubblePos(-100, 100, { parentW, parentH, insetTop, insetBottom }).x).toBe(pad);
    expect(clampBubblePos(9999, 100, { parentW, parentH, insetTop, insetBottom }).x).toBe(parentW - bubble - pad);
  });

  it('无安全区设备退化为纯物理边界', () => {
    const { x, y } = clampBubblePos(9999, 9999, { parentW, parentH, insetTop: 0, insetBottom: 0 });
    expect(x).toBe(parentW - bubble - pad);
    expect(y).toBe(parentH - bubble - pad);
  });
});

describe('clampExpandedBottom（展开条）', () => {
  const selfH = 60;

  it('向下拖到底时离 home 条至少留出安全区 + 间距', () => {
    const b = clampExpandedBottom(0, { parentH, selfH, insetTop, insetBottom });
    expect(b).toBe(pad + insetBottom); // 42，而非旧的 8
  });

  it('向上拖到顶时条顶不钻进刘海', () => {
    const b = clampExpandedBottom(9999, { parentH, selfH, insetTop, insetBottom });
    expect(b).toBe(parentH - selfH - pad - insetTop); // 688，而非旧的 732
  });
});

describe('resolveInsets（安全区合成）', () => {
  it('已迁移 App：外壳 paddingTop 为 0，仍用真机刘海兜底，球不进刘海', () => {
    // 回归守卫：若有人把顶部改成只读 paddingTop，已迁移 App 会重新钻进刘海，这条会挂
    expect(resolveInsets({ padTop: 0, padBottom: 0, safeTop: 44 }).insetTop).toBe(44);
  });

  it('未迁移 App：paddingTop 已是刘海高度，取它', () => {
    expect(resolveInsets({ padTop: 44, padBottom: 34, safeTop: 44 }).insetTop).toBe(44);
  });

  it('顶部取 padding 与真机刘海的较大值', () => {
    expect(resolveInsets({ padTop: 50, padBottom: 0, safeTop: 44 }).insetTop).toBe(50);
    expect(resolveInsets({ padTop: 20, padBottom: 0, safeTop: 44 }).insetTop).toBe(44);
  });

  it('底部只取 paddingBottom，不叠加真机 safe-bottom（避免已迁移 App 多让）', () => {
    expect(resolveInsets({ padTop: 0, padBottom: 0, safeTop: 44 }).insetBottom).toBe(0);
    expect(resolveInsets({ padTop: 0, padBottom: 34, safeTop: 44 }).insetBottom).toBe(34);
  });
});

describe('resolveSafeTopInset（顶部安全区来源）', () => {
  it('iOS standalone 冷启动：raw probe 为 0 时复用 CSS 变量兜底', () => {
    expect(resolveSafeTopInset({
      standaloneSafeTop: 44,
      probedSafeTop: 0,
      isIOSStandalone: true,
    })).toBe(44);
  });

  it('CSS 变量还没初始化且 raw probe 仍为 0 时，iOS standalone 继续兜 44px', () => {
    expect(resolveSafeTopInset({
      standaloneSafeTop: 0,
      probedSafeTop: 0,
      isIOSStandalone: true,
    })).toBe(44);
  });

  it('非 iOS standalone 没有安全区读数时保持 0', () => {
    expect(resolveSafeTopInset({
      standaloneSafeTop: 0,
      probedSafeTop: 0,
      isIOSStandalone: false,
    })).toBe(0);
  });
});
