import { describe, expect, it } from 'vitest';
import { mergeSystemMessages } from './systemMessageMerge';

describe('mergeSystemMessages', () => {
    it('三段式请求：稳定前缀 + 易变尾段 + 提醒条合并成开头一条，历史顺序不动', () => {
        const messages = [
            { role: 'system', content: '稳定前缀' },
            { role: 'user', content: '你好' },
            { role: 'assistant', content: '嗨' },
            { role: 'system', content: '易变尾段' },
            { role: 'system', content: '[MCP 提醒]' },
        ];
        const merged = mergeSystemMessages(messages);
        expect(merged).toEqual([
            { role: 'system', content: '稳定前缀\n\n易变尾段\n\n[MCP 提醒]' },
            { role: 'user', content: '你好' },
            { role: 'assistant', content: '嗨' },
        ]);
        // 原数组不被改动
        expect(messages).toHaveLength(5);
    });

    it('只有一条 system 时原样返回（同一引用，不重建）', () => {
        const messages = [
            { role: 'system', content: '唯一 system' },
            { role: 'user', content: 'hi' },
        ];
        expect(mergeSystemMessages(messages)).toBe(messages);
    });

    it('没有 system 时原样返回', () => {
        const messages = [{ role: 'user', content: 'hi' }];
        expect(mergeSystemMessages(messages)).toBe(messages);
    });

    it('空白 system 段被丢弃，不产生多余空行', () => {
        const messages = [
            { role: 'system', content: 'A' },
            { role: 'system', content: '   ' },
            { role: 'system', content: 'B' },
        ];
        expect(mergeSystemMessages(messages)[0].content).toBe('A\n\nB');
    });
});
