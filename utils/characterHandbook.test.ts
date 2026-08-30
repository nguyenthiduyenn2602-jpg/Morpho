import { describe, expect, it } from 'vitest';
import {
    DEFAULT_HANDBOOK_CHIBI_PRESET,
    parseCharacterHandbookDiaryResponse,
    resolveHandbookChibiPreset,
} from './characterHandbook';

describe('parseCharacterHandbookDiaryResponse', () => {
    it('parses the structured diary JSON returned by the global API', () => {
        const result = parseCharacterHandbookDiaryResponse(`\`\`\`json
        {"mood":"轻松","paragraphs":[{"runs":[{"text":"今天聊了很久。","style":"highlight"}]}]}
        \`\`\``);

        expect(result.mood).toBe('轻松');
        expect(result.paragraphs[0].runs[0]).toEqual({ text: '今天聊了很久。', style: 'highlight' });
    });

    it('accepts nested diary objects and plain paragraph strings', () => {
        const result = parseCharacterHandbookDiaryResponse(JSON.stringify({
            diary: { mood: '安稳', paragraphs: ['第一段。', '第二段。'] },
        }));

        expect(result.paragraphs).toHaveLength(2);
        expect(result.paragraphs[1].runs[0].text).toBe('第二段。');
    });

    it('keeps usable plain text when a compatible API ignores the JSON request', () => {
        const result = parseCharacterHandbookDiaryResponse('今天没有发生太多事情。\n\n不过聊天的时候还是笑了。');

        expect(result.mood).toBe('平静');
        expect(result.paragraphs).toHaveLength(2);
    });

    it('applies marks from the compact paragraph schema', () => {
        const result = parseCharacterHandbookDiaryResponse(JSON.stringify({
            mood: '惦记',
            paragraphs: ['今天还是记住了那句话。', '晚饭很好吃。'],
            marks: [{ text: '那句话', style: 'highlight' }],
        }));

        expect(result.paragraphs[0].runs).toContainEqual({ text: '那句话', style: 'highlight' });
        expect(result.paragraphs[1].runs.map(run => run.text).join('')).toBe('晚饭很好吃。');
    });

    it('salvages text fields from a truncated legacy JSON response without rendering JSON source', () => {
        const broken = '{"mood":"操心又无奈","paragraphs":[{"runs":[{"text":"这包租公当得真像全职保姆了。","style":"normal"},{"text":"真当那破肠胃是铁打的","style":"strike"},{"text":"昨晚刚吃完麻辣烫，今天又塞一堆牛筋丸。","style":';
        const result = parseCharacterHandbookDiaryResponse(broken);
        const rendered = result.paragraphs.flatMap(paragraph => paragraph.runs).map(run => run.text).join('');

        expect(result.mood).toBe('操心又无奈');
        expect(rendered).toContain('这包租公当得真像全职保姆了。');
        expect(rendered).toContain('昨晚刚吃完麻辣烫');
        expect(rendered).not.toContain('{"mood"');
        expect(result.paragraphs.flatMap(paragraph => paragraph.runs)).toContainEqual({ text: '真当那破肠胃是铁打的', style: 'strike' });
    });
});

describe('handbook chibi preset', () => {
    it('uses the locked Morpho preset by default', () => {
        const preset = resolveHandbookChibiPreset({
            selectedPresetId: DEFAULT_HANDBOOK_CHIBI_PRESET.id,
            customPresets: [],
        });

        expect(preset.name).toBe('Morpho特调q版');
        expect(preset.styleTags).toContain('artist:horuhara');
        expect(preset.negativeTags).toContain('too many fingers');
        expect(preset.scale).toBe(6.5);
        expect(preset.steps).toBe(24);
    });

    it('resolves a separately created custom preset without changing the built-in', () => {
        const custom = { ...DEFAULT_HANDBOOK_CHIBI_PRESET, id: 'custom', name: '我的Q版', builtIn: false, scale: 7 };
        const preset = resolveHandbookChibiPreset({ selectedPresetId: custom.id, customPresets: [custom] });

        expect(preset.name).toBe('我的Q版');
        expect(preset.scale).toBe(7);
        expect(DEFAULT_HANDBOOK_CHIBI_PRESET.scale).toBe(6.5);
    });
});
