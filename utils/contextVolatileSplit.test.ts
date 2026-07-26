import { describe, it, expect } from 'vitest';
import { ContextBuilder } from './context';

// 锁住「稳定/易变分层」拆分的守恒性:
//   buildCoreContext(deferVolatile) + buildVolatileCoreState ＝ 原 buildCoreContext 的全部信息。
// 三块易变内容（分钟级时间 / 记忆宫殿召回 / 情绪 buff）必须且只能出现在 volatile 侧 ——
// 出现在 stable 侧会打断中转的 prompt 前缀缓存（TTFT 优化失效）；两侧都没有则是信息丢失。

const makeChar = () => ({
    id: 'c1',
    name: '测试角色',
    systemPrompt: '你是测试角色。',
    timeAwarenessEnabled: true,
    memoryPalaceEnabled: true,
    memoryPalaceInjection: '### 记忆宫殿召回\n- 【召回片段】上周一起看了流星雨',
    scheduleFeatureEnabled: true,
    emotionConfig: { enabled: true },
    buffInjection: '### [当前情绪底色]\n【测试buff】甜蜜的期待 强度: ●●●○○',
    activeBuffs: [],
} as any);

const user = { name: '测试用户', bio: '' } as any;

describe('buildCoreContext deferVolatile 分层', () => {
    it('默认（不传 layout）：时间/召回/buff 都在 core 里，行为与旧版一致', () => {
        const core = ContextBuilder.buildCoreContext(makeChar(), user, true);
        expect(core).toContain('### 当前时间 (Now)');
        expect(core).toContain('【召回片段】');
        expect(core).toContain('【测试buff】');
    });

    it('deferVolatile：三块易变内容从 core 移除', () => {
        const core = ContextBuilder.buildCoreContext(makeChar(), user, true, undefined, undefined, undefined, { deferVolatile: true });
        expect(core).not.toContain('### 当前时间 (Now)');
        expect(core).not.toContain('【召回片段】');
        expect(core).not.toContain('【测试buff】');
        // 稳定内容仍在
        expect(core).toContain('你是测试角色。');
        expect(core).toContain('### 记忆系统 (Memory Bank)');
    });

    it('buildVolatileCoreState 恰好补齐三块，顺序为 时间→召回→buff', () => {
        const volatile = ContextBuilder.buildVolatileCoreState(makeChar(), { includeDetailedMemories: true });
        const iTime = volatile.indexOf('### 当前时间 (Now)');
        const iPalace = volatile.indexOf('【召回片段】');
        const iBuff = volatile.indexOf('【测试buff】');
        expect(iTime).toBeGreaterThanOrEqual(0);
        expect(iPalace).toBeGreaterThan(iTime);
        expect(iBuff).toBeGreaterThan(iPalace);
    });

    it('各开关关闭时 volatile 对应块也不输出（与旧版内联判定一致）', () => {
        const char = makeChar();
        char.timeAwarenessEnabled = false;
        char.memoryPalaceEnabled = false;     // 宫殿总开关关 → 残留 injection 不得注入
        char.emotionConfig = { enabled: false };
        const volatile = ContextBuilder.buildVolatileCoreState(char, { includeDetailedMemories: true });
        expect(volatile).not.toContain('### 当前时间 (Now)');
        expect(volatile).not.toContain('【召回片段】');
        expect(volatile).not.toContain('【测试buff】');
    });

    it('includeDetailedMemories=false 时 volatile 不含宫殿召回（对齐旧版 5b 判定）', () => {
        const volatile = ContextBuilder.buildVolatileCoreState(makeChar(), { includeDetailedMemories: false });
        expect(volatile).not.toContain('【召回片段】');
        expect(volatile).toContain('### 当前时间 (Now)');
    });
});
