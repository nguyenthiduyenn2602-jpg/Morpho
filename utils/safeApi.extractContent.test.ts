import { describe, expect, it } from 'vitest';
import { extractContent } from './safeApi';

describe('extractContent', () => {
    it('extracts a normal OpenAI-compatible message', () => {
        expect(extractContent({ choices: [{ message: { content: '正文' } }] })).toBe('正文');
    });

    it('joins content blocks returned by Claude/Gemini-compatible gateways', () => {
        const data = {
            choices: [{
                message: {
                    content: [
                        { type: 'text', text: '{"title":"旅行"' },
                        { type: 'text', text: ',"summary":"大家决定去海边。"}' },
                    ],
                },
            }],
        };
        expect(extractContent(data)).toContain('"summary":"大家决定去海边。"');
    });

    it('falls back to reasoning_content when content is empty', () => {
        const data = {
            choices: [{ message: { content: '', reasoning_content: '{"summary":"整理完成。"}' } }],
        };
        expect(extractContent(data)).toBe('{"summary":"整理完成。"}');
    });

    it('accepts Gemini native candidate parts as a last-resort compatibility shape', () => {
        const data = {
            candidates: [{ content: { parts: [{ text: '{"summary":"候选正文。"}' }] } }],
        };
        expect(extractContent(data)).toBe('{"summary":"候选正文。"}');
    });

    it('strips hidden thinking blocks from the extracted answer', () => {
        const data = {
            choices: [{ message: { content: '<think>先分析</think>\n{"summary":"最终正文。"}' } }],
        };
        expect(extractContent(data)).toBe('{"summary":"最终正文。"}');
    });

    it('accepts gateways that wrap the completion in data', () => {
        const data = { data: { choices: [{ message: { content: '{"summary":"嵌套正文。"}' } }] } };
        expect(extractContent(data)).toBe('{"summary":"嵌套正文。"}');
    });

    it('accepts non-stream responses returned in delta or reasoning aliases', () => {
        expect(extractContent({ choices: [{ delta: { content: 'delta 正文' } }] })).toBe('delta 正文');
        expect(extractContent({ choices: [{ message: { content: '', reasoning: 'reasoning 正文' } }] })).toBe('reasoning 正文');
    });
});
