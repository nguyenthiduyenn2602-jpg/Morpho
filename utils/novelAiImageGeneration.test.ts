import { describe, expect, it } from 'vitest';
import {
    buildNovelAiPayload,
    buildNovelAiPrompt,
    extractNovelAiDirective,
    extractNovelAiModelIds,
    novelAiGenerateEndpoint,
    novelAiModelsEndpoint,
} from './novelAiImageGeneration';

describe('novelAiImageGeneration', () => {
    it('normalizes a base URL and a full generation endpoint', () => {
        expect(novelAiGenerateEndpoint('https://image.novelai.net/')).toBe('https://image.novelai.net/ai/generate-image');
        expect(novelAiGenerateEndpoint('https://proxy.example/ai/generate-image')).toBe('https://proxy.example/ai/generate-image');
        expect(novelAiGenerateEndpoint('https://std.loliyc.com/api/generate')).toBe('https://std.loliyc.com/novelai');
        expect(novelAiModelsEndpoint('https://std.loliyc.com/api/generate')).toBe('https://std.loliyc.com/v1/models');
    });

    it('parses OpenAI-compatible and simple model lists', () => {
        expect(extractNovelAiModelIds({ data: [{ id: 'nai-b' }, { id: 'nai-a' }] })).toEqual(['nai-a', 'nai-b']);
        expect(extractNovelAiModelIds({ models: ['nai-a'] })).toEqual(['nai-a']);
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

    it('injects user anchors only when the selected frame actually includes the user', () => {
        const config = { enabled: true, characterTags: '1boy, black hair', userTags: '1girl, blonde hair' };
        const solo = buildNovelAiPrompt(config, { prompt: 'office, sitting', selfie: false, includeUser: false });
        const together = buildNovelAiPrompt(config, { prompt: 'office, sitting together', selfie: false, includeUser: true });
        expect(solo).not.toContain('blonde hair');
        expect(together).toContain('1girl, blonde hair');
    });

    it('parses and strips the hidden NAI control block', () => {
        const parsed = extractNovelAiDirective('先给你看。\n[[GENERATE_NAI_IMAGE]]\n{"prompt":"1boy, selfie","selfie":true}\n[[/GENERATE_NAI_IMAGE]]');
        expect(parsed.cleaned).toBe('先给你看。');
        expect(parsed.directive).toEqual({ prompt: '1boy, selfie', selfie: true, includeUser: false });
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

    it('sends worldbook-style character prompts through native V4 captions and coordinates', () => {
        const payload = buildNovelAiPayload({
            baseUrl: 'https://image.novelai.net', apiKey: 'token', model: 'nai-diffusion-4-5-full',
            width: 1216, height: 832, sampler: 'k_euler_ancestral', steps: 28, scale: 5,
            qualityToggle: true,
        }, { enabled: true, styleTags: 'artist:test' }, {
            prompt: '1girl, 1boy, office, night, medium wide shot',
            selfie: false,
            characterPrompts: [
                { prompt: '1girl, blonde hair, white shirt, {target#hug}', negative: 'black hair', center: { x: 0.3, y: 0.5 } },
                { prompt: '1boy, black hair, black suit, {source#hug}', negative: 'blonde hair', center: { x: 0.7, y: 0.5 } },
            ],
        }, 123);
        expect(payload.parameters.use_coords).toBe(true);
        expect(payload.parameters.characterPrompts).toHaveLength(2);
        expect(payload.parameters.v4_prompt.use_coords).toBe(true);
        expect(payload.input).toBe('very aesthetic, masterpiece, high quality, absurdres, artist:test, 1girl, 1boy, office, night, medium wide shot');
        expect(payload.parameters.v4_prompt.caption.base_caption).toContain('office');
        expect(payload.parameters.v4_prompt.caption.base_caption).not.toContain('blonde hair');
        expect(payload.parameters.v4_prompt.caption.char_captions[0]).toEqual({
            centers: [{ x: 0.3, y: 0.5 }],
            char_caption: '1girl, blonde hair, white shirt, {target#hug}',
        });
        expect(payload.parameters.v4_negative_prompt.caption.char_captions[1].char_caption).toBe('blonde hair');
    });

    it('cleans HTML spaces and a pasted trailing slash from negative tags', () => {
        const payload = buildNovelAiPayload({
            baseUrl: 'https://image.novelai.net', apiKey: 'token', model: 'nai-diffusion-4-5-full',
            width: 832, height: 1216, sampler: 'k_euler_ancestral', steps: 28, scale: 5,
            qualityToggle: true,
        }, { enabled: true, negativeTags: 'text,&#x20; logo, colored inner hair\\' }, { prompt: 'portrait', selfie: false }, 123);
        expect(payload.parameters.negative_prompt).toBe('text, logo, colored inner hair');
    });

    it('injects an optional reference image into the NovelAI payload', () => {
        const payload = buildNovelAiPayload({
            baseUrl: 'https://image.novelai.net', apiKey: 'token', model: 'nai-diffusion-4-5-full',
            width: 832, height: 1216, sampler: 'k_euler_ancestral', steps: 28, scale: 5,
            qualityToggle: true,
        }, { enabled: true, characterTags: '1boy', referenceStrength: 0.72 }, { prompt: 'portrait', selfie: false }, 123, 'AAAA');
        expect(payload.parameters.reference_image_multiple).toEqual(['AAAA']);
        expect(payload.parameters.reference_information_extracted_multiple).toEqual([1]);
        expect(payload.parameters.reference_strength_multiple).toEqual([0.72]);
    });
});
