import { describe, expect, it } from 'vitest';
import {
    affinityDelta,
    affinityStage,
    buildMihuiCharacterCard,
    clampAffinity,
    DEFAULT_MIHUI_PREFERENCES,
    extractJsonObject,
    mihuiMessageSummary,
    normalizePersona,
    removeMihuiMessage,
    replaceMihuiMessage,
} from './mihui';

describe('mihui core', () => {
    it('extracts fenced or surrounded json', () => {
        expect(extractJsonObject('说明 {"name":"阿青","age":28} 结束').name).toBe('阿青');
        expect(extractJsonObject('```json\n{"name":"小林"}\n```').name).toBe('小林');
    });

    it('keeps generated people adult and inside preference range', () => {
        const p = normalizePersona({ name: 'A', age: 12 }, { ...DEFAULT_MIHUI_PREFERENCES, ageMin: 24, ageMax: 32 });
        expect(p.age).toBe(24);
        expect(p.greeting.length).toBeGreaterThan(0);
    });

    it('uses deterministic bounded affinity', () => {
        expect(affinityDelta('warm', '认真写了很长的一段回复，并且主动问了对方最近过得怎么样')).toBe(4);
        expect(clampAffinity(108)).toBe(100);
        expect(affinityStage(78)).toBe('心动');
    });

    it('exports a standard card without session id', () => {
        const card = buildMihuiCharacterCard({
            id: 's1', affinity: 100, createdAt: 1, updatedAt: 2,
            persona: { name: '林岑', age: 29, gender: '男性', occupation: '编辑', city: '北京', appearance: '黑发', personality: '安静', socialStyle: '慢热', relationshipIntent: '认真了解', background: '住在东城', greeting: '你好' },
            messages: [{ id: 'm1', role: 'user', content: '周末去看展吗', timestamp: 1 }],
        });
        expect(card.type).toBe('sully_character_card');
        expect(card.name).toBe('林岑');
        expect((card as any).id).toBeUndefined();
    });

    it('keeps affinity unchanged when deleting or regenerating messages', () => {
        const session = {
            id: 's1', affinity: 73, createdAt: 1, updatedAt: 2,
            persona: { name: '林岑', age: 29, gender: '男性', occupation: '编辑', city: '北京', appearance: '黑发', personality: '安静', socialStyle: '慢热', relationshipIntent: '认真了解', background: '住在东城', greeting: '你好' },
            messages: [
                { id: 'u1', role: 'user' as const, content: '今晚有空吗', timestamp: 1 },
                { id: 'a1', role: 'assistant' as const, content: '有。', timestamp: 2 },
            ],
        };
        const replaced = replaceMihuiMessage(session, 'a1', { ...session.messages[1], content: '刚忙完，你呢？' });
        expect(replaced.affinity).toBe(73);
        expect(replaced.messages[1].content).toBe('刚忙完，你呢？');
        const removed = removeMihuiMessage(replaced, 'u1');
        expect(removed.affinity).toBe(73);
        expect(removed.messages.map(message => message.id)).toEqual(['a1']);
    });

    it('summarizes media without leaking image base64 into memories', () => {
        expect(mihuiMessageSummary({ id: 'p1', role: 'user', type: 'image', content: 'data:image/jpeg;base64,very-long', timestamp: 1 })).toBe('[分享照片]');
        expect(mihuiMessageSummary({ id: 'l1', role: 'user', type: 'location', content: '国贸', location: { name: '国贸三期' }, timestamp: 1 })).toBe('[分享位置：国贸三期]');
    });
});
