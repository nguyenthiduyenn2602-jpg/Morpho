import { describe, it, expect } from 'vitest';
import { parseTheaterLines } from './theaterGenerator';

describe('parseTheaterLines', () => {
    it('解析标准「[氛围] 文本」行，emotion 与 text 分离', () => {
        const raw = `[🚪] 她推开玻璃门，冷气扑面。
[🎧] 耳机里随机到那首歌。
[😮‍💨] 「……算了。」她抹了把汗。`;
        const lines = parseTheaterLines(raw);
        expect(lines).toHaveLength(3);
        expect(lines[0]).toEqual({ emotion: '🚪', text: '她推开玻璃门，冷气扑面。' });
        expect(lines[2].emotion).toBe('😮‍💨');
        expect(lines[2].text).toBe('「……算了。」她抹了把汗。');
    });

    it('容忍全角方括号【】', () => {
        const lines = parseTheaterLines('【🙂】 她笑了一下。');
        expect(lines).toEqual([{ emotion: '🙂', text: '她笑了一下。' }]);
    });

    it('剥掉代码围栏并跳过空行 / 纯分隔行', () => {
        const raw = '```\n[😌] 第一拍。\n\n---\n[🥱] 第二拍。\n```';
        const lines = parseTheaterLines(raw);
        expect(lines).toEqual([
            { emotion: '😌', text: '第一拍。' },
            { emotion: '🥱', text: '第二拍。' },
        ]);
    });

    it('没带氛围标签的行也保留为纯文本（不丢内容）', () => {
        const lines = parseTheaterLines('她站在窗边发呆。');
        expect(lines).toEqual([{ text: '她站在窗边发呆。' }]);
    });

    it('空输入返回空数组', () => {
        expect(parseTheaterLines('')).toEqual([]);
        expect(parseTheaterLines('   \n  \n')).toEqual([]);
    });
});
