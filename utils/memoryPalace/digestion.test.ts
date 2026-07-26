import { describe, it, expect } from 'vitest';
import { runCognitiveDigestion, incrementDigestRound, getDigestRoundCount } from './digestion';

// fake-indexeddb + localStorage stub 由 test-setup.ts 注入。
// 回归守卫：消化的"无材料早退"分支必须归零轮数计数器。
// 此前它漏掉 resetDigestRounds → 计数器卡在 ≥50 → 之后每一轮聊天都重触发
// 自动消化（挂上门牌整理后 = 每轮弹浮窗 + 每轮烧一次 LLM）。
// 空库上早退发生在任何 LLM 调用之前（回填也因 totalLines=0 直接返回），测试不碰网络。

describe('认知消化 — 轮数计数器', () => {
    it('无材料早退分支也必须归零计数器（防每轮重触发自动消化）', async () => {
        const charId = 'char_digest_counter_test';
        // 模拟聊到第 50 轮：计数器达到自动消化阈值
        let shouldDigest = false;
        for (let i = 0; i < 50; i++) shouldDigest = incrementDigestRound(charId);
        expect(shouldDigest).toBe(true);
        expect(getDigestRoundCount(charId)).toBe(50);

        // 空库 → 走早退分支（在任何 LLM 调用之前返回）
        const result = await runCognitiveDigestion(
            charId, '测试角色', '人设', { baseUrl: 'http://invalid.test', apiKey: 'k', model: 'm' },
        );
        expect(result).not.toBeNull();

        // 关键断言：计数器归零，下一轮 increment 后是 1 而不是 51
        expect(getDigestRoundCount(charId)).toBe(0);
        expect(incrementDigestRound(charId)).toBe(false);
    });

    it('进场即归零：消化一开始计数器就清零，进行中的新轮次计入下一个50', async () => {
        const charId = 'char_digest_entry_reset';
        for (let i = 0; i < 50; i++) incrementDigestRound(charId);

        const run = runCognitiveDigestion(
            charId, '测试角色', '人设', { baseUrl: 'http://invalid.test', apiKey: 'k', model: 'm' },
        );
        // 消化刚启动（未 await 完成），计数器已经是 0——
        // 这期间来的新聊天轮 increment 到 1/2/3…不会再次触发
        expect(getDigestRoundCount(charId)).toBe(0);
        expect(incrementDigestRound(charId)).toBe(false);
        await run;
    });

    it('并发锁：同一角色的第二个消化直接返回 null，不重复跑', async () => {
        const charId = 'char_digest_lock_test';
        const first = runCognitiveDigestion(
            charId, '测试角色', '人设', { baseUrl: 'http://invalid.test', apiKey: 'k', model: 'm' },
        );
        const second = await runCognitiveDigestion(
            charId, '测试角色', '人设', { baseUrl: 'http://invalid.test', apiKey: 'k', model: 'm' },
        );
        expect(second).toBeNull();
        expect(await first).not.toBeNull();
        // 锁释放后可以再跑
        const third = await runCognitiveDigestion(
            charId, '测试角色', '人设', { baseUrl: 'http://invalid.test', apiKey: 'k', model: 'm' },
        );
        expect(third).not.toBeNull();
    });
});
