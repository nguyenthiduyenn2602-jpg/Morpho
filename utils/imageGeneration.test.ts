import { describe, expect, it } from 'vitest';
import {
    buildImageGenerationDecisionPrompt,
    extractImageGenerationDirective,
    imageApiSignature,
    isExplicitImageRequest,
    isImageApiVerified,
    normalizeImageApiBase,
} from './imageGeneration';

describe('imageGeneration', () => {
    it('normalizes root and endpoint URLs to an OpenAI-compatible v1 base', () => {
        expect(normalizeImageApiBase('https://api.denxio.com')).toBe('https://api.denxio.com/v1');
        expect(normalizeImageApiBase('https://api.denxio.com/v1/')).toBe('https://api.denxio.com/v1');
        expect(normalizeImageApiBase('https://api.denxio.com/v1/images/edits')).toBe('https://api.denxio.com/v1');
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
        const base = { baseUrl: 'https://api.denxio.com', apiKey: 'secret', model: 'gpt-image-2' };
        const verified = { ...base, verifiedAt: Date.now(), verifiedSignature: imageApiSignature(base) };
        expect(isImageApiVerified(verified)).toBe(true);
        expect(isImageApiVerified({ ...verified, model: 'another-model' })).toBe(false);
    });

    it('injects the real user name instead of a literal worldbook macro', () => {
        const prompt = buildImageGenerationDecisionPrompt(
            { id: 'c1', name: '角色', imageGeneration: { enabled: true }, memories: [] } as any,
            { name: '沈欢' } as any,
        );
        expect(prompt).toContain('沈欢');
        expect(prompt).not.toContain('{{user}}');
        expect(prompt).toContain('必须使用');
    });
});
