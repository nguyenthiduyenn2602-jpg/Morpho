import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildImageGenerationDecisionPrompt,
    extractImageGenerationDirective,
    imageApiSignature,
    isExplicitImageRequest,
    isImageApiVerified,
    normalizeImageApiBase,
    pollMxApiImageTask,
} from './imageGeneration';

describe('imageGeneration', () => {
    afterEach(() => vi.restoreAllMocks());

    it('normalizes MXAPI root and endpoint URLs to the site base', () => {
        expect(normalizeImageApiBase('https://open.mxapi.org')).toBe('https://open.mxapi.org');
        expect(normalizeImageApiBase('https://open.mxapi.org/api/v2/')).toBe('https://open.mxapi.org');
        expect(normalizeImageApiBase('https://open.mxapi.org/api/v2/gpt-image-2')).toBe('https://open.mxapi.org');
    });

    it('extracts and strips a generation control block', () => {
        const raw = '不要显示这句\n[[GENERATE_IMAGE]]\n{"prompt":"窗边的自然光自拍","selfie":true}\n[[/GENERATE_IMAGE]]';
        expect(extractImageGenerationDirective(raw)).toEqual({
            directive: { prompt: '窗边的自然光自拍', selfie: true },
            cleaned: '不要显示这句',
        });
    });

    it('treats malformed controls as non-executable and still strips them', () => {
        const parsed = extractImageGenerationDirective('[[GENERATE_IMAGE]]oops[[/GENERATE_IMAGE]]');
        expect(parsed.directive).toBeNull();
        expect(parsed.cleaned).toBe('');
    });

    it('recognizes explicit image requests without matching ordinary image discussion', () => {
        expect(isExplicitImageRequest('拍张自拍给我看看')).toBe(true);
        expect(isExplicitImageRequest('让我看看你现在的样子')).toBe(true);
        expect(isExplicitImageRequest('这张照片拍得挺好')).toBe(false);
    });

    it('invalidates the connection light when credentials change', () => {
        const base = { baseUrl: 'https://open.mxapi.org', apiKey: 'secret', channel: 'default' as const };
        const verified = { ...base, verifiedAt: Date.now(), verifiedSignature: imageApiSignature(base) };
        expect(isImageApiVerified(verified)).toBe(true);
        expect(isImageApiVerified({ ...verified, channel: 'official' })).toBe(false);
    });

    it('injects the real user name instead of a literal worldbook macro', () => {
        const prompt = buildImageGenerationDecisionPrompt(
            { id: 'c1', name: '角色', imageGeneration: { enabled: true }, memories: [] } as any,
            { name: '沈欢' } as any,
        );
        expect(prompt).toContain('沈欢');
        expect(prompt).not.toContain('{{user}}');
        expect(prompt).toContain('必须使用');
        expect(prompt).toContain('先以角色当前的语气自然回复');
        expect(prompt).toContain('回复末尾附加');
    });

    it('polls an MXAPI task until the generated image URL is ready', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { status: 'processing' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                code: 200,
                data: { status: 'completed', result: { images: ['https://cdn.example/result.png'] } },
            }), { status: 200 }));

        await expect(pollMxApiImageTask('https://open.mxapi.org', 'key', 'task 1', {
            intervalMs: 0,
            maxAttempts: 2,
        })).resolves.toBe('https://cdn.example/result.png');
        expect(fetchMock).toHaveBeenLastCalledWith(
            'https://open.mxapi.org/api/v2/gpt-image/task?task_id=task%201',
            { headers: { Authorization: 'Bearer key' } },
        );
    });

    it('surfaces the MXAPI task error instead of polling forever', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
            code: 200,
            data: { status: 'failed', error_msg: '上游生成失败' },
        }), { status: 200 }));
        await expect(pollMxApiImageTask('https://open.mxapi.org', 'key', 'bad', {
            intervalMs: 0,
            maxAttempts: 1,
        })).rejects.toThrow('上游生成失败');
    });
});
