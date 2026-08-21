import { describe, expect, it } from 'vitest';
import { backfillCount, buildMomentsUserContent, DEFAULT_MOMENTS_SETTINGS, momentSimilarity } from './moments';

describe('朋友圈去重与补发策略', () => {
    it('能识别近似换词重发，也不会误伤不同生活片段', () => {
        expect(momentSimilarity('下班路上买了一杯冰美式，今天热死了。', '下班路上买杯冰美式，今天真的热死。')).toBeGreaterThan(0.65);
        expect(momentSimilarity('下班路上买了一杯冰美式。', '凌晨还在改合同，甲方终于回消息了。')).toBeLessThan(0.3);
    });

    it('离线越久补发越多，但始终有限流', () => {
        const now = Date.now();
        const base = { ...DEFAULT_MOMENTS_SETTINGS, minIntervalHours: 8 };
        expect(backfillCount({ ...base, lastAutoRunAt: now - 2 * 3_600_000 }, now)).toBe(0);
        expect(backfillCount({ ...base, lastAutoRunAt: now - 12 * 3_600_000 }, now)).toBe(1);
        expect(backfillCount({ ...base, lastAutoRunAt: now - 48 * 3_600_000 }, now)).toBeGreaterThanOrEqual(2);
        expect(backfillCount({ ...base, lastAutoRunAt: now - 30 * 24 * 3_600_000 }, now)).toBeLessThanOrEqual(5);
    });

    it('用户带图发布时把图片和文字放进同一条多模态消息', () => {
        expect(buildMomentsUserContent('看看今天的云', [])).toBe('看看今天的云');
        expect(buildMomentsUserContent('看看今天的云', ['data:image/jpeg;base64,AAAA'])).toEqual([
            { type: 'text', text: '看看今天的云' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
        ]);
    });
});
