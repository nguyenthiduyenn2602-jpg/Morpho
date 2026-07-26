import { describe, it, expect } from 'vitest';
import { buildMemberTimeline } from './timeline';
import { Message } from '../../types';

const msg = (over: Partial<Message>): Message => ({
    id: 1,
    charId: 'c1',
    role: 'assistant',
    type: 'text',
    content: '内容',
    timestamp: 0,
    ...over,
} as Message);

const resolveSpeaker = (m: Message) => (m.charId === 'c1' ? '小夏' : '未知');

describe('buildMemberTimeline', () => {
    it('私聊和群聊按时间戳合并升序，带来源标签', () => {
        const privateMsgs = [
            msg({ id: 1, role: 'user', content: '今天好累', timestamp: 1000 }),
            msg({ id: 2, role: 'assistant', content: '早点睡', timestamp: 2000 }),
        ];
        const groupMsgs = [
            msg({ id: 3, role: 'assistant', groupId: 'g1', content: '早啊！', timestamp: 1500 }),
        ];
        const lines = buildMemberTimeline({ privateMsgs, groupMsgs, cap: 40, resolveSpeaker }).split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('[私聊]');
        expect(lines[0]).toContain('用户: 今天好累');
        expect(lines[1]).toContain('[群聊]');
        expect(lines[1]).toContain('小夏: 早啊！');
        expect(lines[2]).toContain('[私聊]');
        expect(lines[2]).toContain('我: 早点睡');
    });

    it('cap 生效：合并后只留时间最近的 N 条', () => {
        const privateMsgs = Array.from({ length: 10 }, (_, i) =>
            msg({ id: i, role: 'user', content: `p${i}`, timestamp: i * 100 }));
        const groupMsgs = Array.from({ length: 10 }, (_, i) =>
            msg({ id: 100 + i, groupId: 'g1', content: `g${i}`, timestamp: i * 100 + 50 }));
        const lines = buildMemberTimeline({ privateMsgs, groupMsgs, cap: 5, resolveSpeaker }).split('\n');
        expect(lines).toHaveLength(5);
        // 末 5 条应是时间最大的：g7(750) p8(800) g8(850) p9(900) g9(950)
        expect(lines[4]).toContain('g9');
        expect(lines[0]).toContain('g7');
    });

    it('非文本消息用占位符，base64 不会出现在时间线里', () => {
        const groupMsgs = [
            msg({ id: 1, groupId: 'g1', type: 'image', content: 'data:image/jpeg;base64,AAAA', timestamp: 100 }),
            msg({ id: 2, groupId: 'g1', type: 'transfer', content: '[红包] 88 Credits', metadata: { amount: '88' }, timestamp: 200 }),
        ];
        const text = buildMemberTimeline({ privateMsgs: [], groupMsgs, cap: 40, resolveSpeaker });
        expect(text).not.toContain('base64');
        expect(text).toContain('[图片]');
        expect(text).toContain('[发红包: 88]');
    });

    it('超长正文截断到 80 字并加省略号', () => {
        const long = '啊'.repeat(120);
        const privateMsgs = [msg({ id: 1, role: 'user', content: long, timestamp: 100 })];
        const line = buildMemberTimeline({ privateMsgs, groupMsgs: [], cap: 40, resolveSpeaker });
        expect(line).toContain('啊'.repeat(80) + '…');
        expect(line).not.toContain('啊'.repeat(81));
    });

    it('空输入返回空串', () => {
        expect(buildMemberTimeline({ privateMsgs: [], groupMsgs: [], cap: 40, resolveSpeaker })).toBe('');
    });
});
