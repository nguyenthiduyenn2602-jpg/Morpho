import { afterEach, describe, expect, it, vi } from 'vitest';
import { backfillCount, buildMomentsUserContent, callMomentsDirector, DEFAULT_MOMENTS_SETTINGS, formatMomentsRecentMessage, momentSimilarity } from './moments';

afterEach(() => vi.unstubAllGlobals());

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

    it('朋友圈近期上下文会保留走了没的旅行小卡', () => {
        expect(formatMomentsRecentMessage({
            role: 'assistant',
            type: 'travel_card',
            content: '西安来信\n城墙下的风很大。',
            metadata: { travelCard: { title: '西安来信', body: '城墙下的风很大。', destination: '西安' } },
        })).toContain('【走了没·旅行小卡】地点：西安；西安来信；城墙下的风很大。');
        expect(formatMomentsRecentMessage({ role: 'assistant', type: 'social_card', content: '旧朋友圈' })).toBe('');
    });

    it('正常返回时只调用一次完整上下文，并收紧不必要的输出上限', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: '{"content":"晚风很好","location":"阳台","likedBy":[],"comments":[]}' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await callMomentsDirector(
            { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
            '完整上下文', [], '精简上下文',
        );

        expect(result.content).toBe('晚风很好');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.max_tokens).toBe(1800);
        expect(body.messages[1].content).toBe('完整上下文');
    });

    it('HTTP 200 但输出为零时，用精简上下文自动重试一次', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{ message: { content: '' }, finish_reason: 'length' }],
                usage: { prompt_tokens: 15815, completion_tokens: 0 },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{ message: { content: '{"content":"重试成功","location":"家里","likedBy":[],"comments":[]}' }, finish_reason: 'stop' }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await callMomentsDirector(
            { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
            '完整上下文', [], '精简上下文',
        );

        expect(result.content).toBe('重试成功');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(retryBody.max_tokens).toBe(1400);
        expect(retryBody.messages[1].content).toBe('精简上下文');
    });

    it('首轮只返回半截 JSON 时也会使用精简上下文重试', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{ message: { content: '{"content":"写到一半"' }, finish_reason: 'length' }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{ message: { content: '{"content":"完整结果","location":"书房","likedBy":[],"comments":[]}' }, finish_reason: 'stop' }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await callMomentsDirector(
            { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
            '完整上下文', [], '精简上下文',
        );

        expect(result.content).toBe('完整结果');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('明确的安全拦截不伪装成截断重试', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(callMomentsDirector(
            { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
            '完整上下文', [], '精简上下文',
        )).rejects.toThrow('content_filter');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
