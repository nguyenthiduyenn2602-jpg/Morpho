import { describe, expect, it } from 'vitest';
import { parseCharacterHandbookDiaryResponse } from './characterHandbook';

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
});
