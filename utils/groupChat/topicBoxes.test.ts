import { describe, expect, it } from 'vitest';
import type { GroupProfile, Message } from '../../types';
import {
    buildGroupTopicPrompt,
    buildGroupTopicContext,
    GROUP_TOPIC_HOT_ZONE,
    groupTopicPendingCount,
    makeGroupTopicBox,
    planGroupTopicBatch,
} from './topicBoxes';

const messages = (count: number): Message[] => Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    charId: i % 2 ? 'a' : 'user',
    groupId: 'g1',
    role: i % 2 ? 'assistant' : 'user',
    type: 'text',
    content: `消息${i + 1}`,
    timestamp: 1_700_000_000_000 + i,
}));

const group: GroupProfile = { id: 'g1', name: '测试群', members: ['a', 'b'], createdAt: 1 };

describe('群公共话题盒批处理', () => {
    it('始终保留最近 200 条，热区以前满 100 条后处理前 85%', () => {
        const all = messages(300);
        const plan = planGroupTopicBatch(all, 0, false);
        expect(GROUP_TOPIC_HOT_ZONE).toBe(200);
        expect(plan?.pendingCount).toBe(100);
        expect(plan?.messages).toHaveLength(85);
        expect(plan?.messages[0].id).toBe(1);
        expect(plan?.messages.at(-1)?.id).toBe(85);
    });

    it('公共游标推进后不会重复处理已经成盒的消息', () => {
        const all = messages(400);
        expect(groupTopicPendingCount(all, 120)).toBe(80);
        expect(planGroupTopicBatch(all, 120, false)).toBeNull();
        expect(planGroupTopicBatch(all, 120, true)?.messages[0].id).toBe(121);
    });

    it('话题盒上下文只包含共享总结，不展开旧原文', () => {
        const batch = messages(3);
        const box = makeGroupTopicBox(group, batch, '一起聊旅行', 'A和B商量了周末出行。');
        const text = buildGroupTopicContext({ ...group, topicBoxes: [box] });
        expect(text).toContain('公共话题盒');
        expect(text).toContain('一起聊旅行');
        expect(text).toContain('A和B商量了周末出行');
        expect(text).not.toContain('消息1');
    });

    it('内置总结提示词包含全体成员语义资料，不依赖私聊归档风格', () => {
        const chars: any[] = [
            { id: 'a', name: 'A', description: '冷静', systemPrompt: '说话简洁', worldview: '现代', writerPersona: '克制', refinedMemories: { core: '认识B' } },
            { id: 'b', name: 'B', description: '活泼', systemPrompt: '爱开玩笑', memories: [] },
        ];
        const prompt = buildGroupTopicPrompt(group, messages(2), chars, '用户');
        expect(prompt).toContain('全体成员资料');
        expect(prompt).toContain('说话简洁');
        expect(prompt).toContain('爱开玩笑');
        expect(prompt).toContain('客观视角');
    });
});
