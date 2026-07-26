import { describe, it, expect } from 'vitest';
import { modelRejectsSamplingParams, stripSamplingParams, isSamplingParamError } from './samplingParamCompat';

describe('modelRejectsSamplingParams', () => {
    it('识别会废弃采样参数的模型（带上 temperature 会 400）', () => {
        const reject = [
            'anthropic/claude-opus-4.8',
            'claude-opus-4-8',
            'claude-opus-4.7',
            'anthropic/claude-opus-4-7',
            'claude-sonnet-5',
            'anthropic/claude-sonnet-5',
            'claude-fable-5',
            'claude-mythos-5',
            'openai/gpt-5',
            'gpt-5-mini',
            'claude-opus-4-8-fast',
        ];
        for (const m of reject) {
            expect(modelRejectsSamplingParams(m), m).toBe(true);
        }
    });

    it('对仍接受 temperature 的模型返回 false（不误伤）', () => {
        const keep = [
            'claude-opus-4-6',
            'anthropic/claude-opus-4.6',
            'claude-opus-4-5',
            'claude-sonnet-4-6',
            'claude-sonnet-4-5',
            'claude-haiku-4-5',
            'gpt-4o',
            'gpt-4-turbo',
            'deepseek-chat',
            'gemini-2.0-flash',
            '',
            undefined,
            null,
        ];
        for (const m of keep) {
            expect(modelRejectsSamplingParams(m as any), String(m)).toBe(false);
        }
    });
});

describe('stripSamplingParams', () => {
    it('摘掉 temperature/top_p/top_k 并报告有改动', () => {
        const body: any = { model: 'x', messages: [], temperature: 0.85, top_p: 0.9, top_k: 40, max_tokens: 100 };
        expect(stripSamplingParams(body)).toBe(true);
        expect('temperature' in body).toBe(false);
        expect('top_p' in body).toBe(false);
        expect('top_k' in body).toBe(false);
        expect(body.max_tokens).toBe(100); // 其它字段保留
    });

    it('没有采样参数时返回 false', () => {
        expect(stripSamplingParams({ model: 'x', messages: [] })).toBe(false);
    });
});

describe('isSamplingParamError', () => {
    it('命中 provider 的 temperature 废弃报文', () => {
        expect(isSamplingParamError('temperature is deprecated for this model.')).toBe(true);
        expect(isSamplingParamError('{"error":{"message":"temperature is not supported"}}')).toBe(true);
        expect(isSamplingParamError('top_p is no longer supported on this model')).toBe(true);
    });

    it('对无关 400 报文不误判', () => {
        expect(isSamplingParamError('prompt is too long: 10494')).toBe(false);
        expect(isSamplingParamError('invalid api key')).toBe(false);
        expect(isSamplingParamError('')).toBe(false);
    });
});
