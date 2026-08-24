import { describe, expect, it } from 'vitest';
import {
    buildNovelAiPayload,
    buildNovelAiPrompt,
    extractNovelAiDirective,
    novelAiGenerateEndpoint,
} from './novelAiImageGeneration';

describe('novelAiImageGeneration', () => {
    it('normalizes a base URL and a full generation endpoint', () => {
        expect(novelAiGenerateEndpoint('https://image.novelai.net/')).toBe('https://image.novelai.net/ai/generate-image');
        expect(novelAiGenerateEndpoint('https://proxy.example/ai/generate-image')).toBe('https://proxy.example/ai/generate-image');
    });

    it('merges prompt layers in order and removes duplicate tags', () => {
        const prompt = buildNovelAiPrompt({
            enabled: true,
            qualityTags: 'masterpiece, high quality',
            styleTags: 'artist:test, cinematic lighting',
            characterTags: '1boy, black hair, cinematic lighting',
        }, { prompt: 'black hair, sitting, warm light', selfie: false });
        expect(prompt).toBe('masterpiece, high quality, artist:test, cinematic lighting, 1boy, black hair, sitting, warm light');
    });

    it('parses and strips the hidden NAI control block', () => {
        const parsed = extractNovelAiDirective('先给你看。\n[[GENERATE_NAI_IMAGE]]\n{"prompt":"1boy, selfie","selfie":true}\n[[/GENERATE_NAI_IMAGE]]');
        expect(parsed.cleaned).toBe('先给你看。');
        expect(parsed.directive).toEqual({ prompt: '1boy, selfie', selfie: true });
    });

    it('builds the v4-compatible NovelAI payload', () => {
        const payload = buildNovelAiPayload({
            baseUrl: 'https://image.novelai.net', apiKey: 'token', model: 'nai-diffusion-4-5-full',
            width: 832, height: 1216, sampler: 'k_euler_ancestral', steps: 28, scale: 5,
            qualityToggle: true,
        }, { enabled: true, characterTags: '1boy, black hair' }, { prompt: 'office, sitting', selfie: false }, 123);
        expect(payload.model).toBe('nai-diffusion-4-5-full');
        expect(payload.parameters.seed).toBe(123);
        expect(payload.parameters.v4_prompt.caption.base_caption).toContain('office');
        expect(payload.parameters.v4_negative_prompt.caption.base_caption).toContain('lowres');
    });
});
