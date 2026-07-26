import { describe, it, expect } from 'vitest';
import {
    EVENT_BOX_SUMMARY_TARGET_MIN_CHARS,
    EVENT_BOX_SUMMARY_TARGET_MAX_CHARS,
    EVENT_BOX_SUMMARY_HARD_MAX_CHARS,
} from './types';
import { enforceSummaryLengthBudget } from './summaryLengthBudget';

describe('EventBox summary 字数预算', () => {
    it('目标区间下界小于上界', () => {
        expect(EVENT_BOX_SUMMARY_TARGET_MIN_CHARS).toBeLessThan(EVENT_BOX_SUMMARY_TARGET_MAX_CHARS);
    });

    // 回归守卫：硬截断线必须高于目标上界，给「模型数不准字数」留缓冲。
    // 若砍线 ≤ 目标上界，模型瞄着目标上界写、稍微超一点就会被硬截断拼上「……」——
    // 这正是整合回忆末尾省略号的根因。砍线和目标上界不能一起往下压到同一个值。
    it('硬截断线高于目标上界（留缓冲，避免模型稍超就被砍出「……」）', () => {
        expect(EVENT_BOX_SUMMARY_HARD_MAX_CHARS).toBeGreaterThan(EVENT_BOX_SUMMARY_TARGET_MAX_CHARS);
    });
});

describe('enforceSummaryLengthBudget — 超限二次压缩兜底', () => {
    const HARD = 900;
    const ELLIPSIS = '……';

    it('未超限：原样返回，且不触发二次压缩', async () => {
        const text = 'a'.repeat(500);
        let called = false;
        const out = await enforceSummaryLengthBudget(text, async () => { called = true; return null; }, HARD);
        expect(out).toBe(text);
        expect(called).toBe(false);
    });

    it('超限 + 二次压缩达标：采用压缩结果，不留省略号', async () => {
        const text = 'a'.repeat(1000);
        const out = await enforceSummaryLengthBudget(text, async () => 'b'.repeat(600), HARD);
        expect(out).toBe('b'.repeat(600));
        expect(out.endsWith(ELLIPSIS)).toBe(false);
    });

    it('超限 + 二次压缩后仍超：取更短者做基底，硬截断兜底', async () => {
        const text = 'a'.repeat(1000);
        // 二次压缩压到 950，仍 > 900 → 用 950 这份做基底截断
        const out = await enforceSummaryLengthBudget(text, async () => 'b'.repeat(950), HARD);
        expect(out.startsWith('b'.repeat(HARD))).toBe(true);
        expect(out.endsWith(ELLIPSIS)).toBe(true);
        expect(out.length).toBe(HARD + ELLIPSIS.length);
    });

    it('超限 + 二次压缩失败(null)：回退硬截断原文', async () => {
        const text = 'a'.repeat(1000);
        const out = await enforceSummaryLengthBudget(text, async () => null, HARD);
        expect(out).toBe('a'.repeat(HARD) + ELLIPSIS);
    });
});
