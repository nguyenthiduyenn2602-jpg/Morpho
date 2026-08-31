import { describe, expect, it } from 'vitest';
import {
    affinityDelta,
    affinityStage,
    buildMihuiFamiliarContinuity,
    buildMihuiFamiliarMemorySummary,
    buildMihuiRevealLine,
    buildMihuiCharacterCard,
    clampAffinity,
    DEFAULT_MIHUI_PREFERENCES,
    extractJsonObject,
    mihuiMessageSummary,
    normalizeMihuiReply,
    normalizePersona,
    pickMihuiFamiliar,
    removeMihuiMessage,
    replaceMihuiMessage,
} from './mihui';

describe('mihui core', () => {
    it('extracts fenced or surrounded json', () => {
        expect(extractJsonObject('说明 {"name":"阿青","age":28} 结束').name).toBe('阿青');
        expect(extractJsonObject('```json\n{"name":"小林"}\n```').name).toBe('小林');
    });

    it('repairs a persona json truncated inside its last string field', () => {
        const parsed = extractJsonObject('{"name":"阿青","age":28,"occupation":"摄影师","background":"周末喜欢去郊区拍');
        expect(parsed.name).toBe('阿青');
        expect(parsed.occupation).toBe('摄影师');
        expect(parsed.background).toBe('周末喜欢去郊区拍');
    });

    it('unwraps common persona response envelopes', () => {
        expect(extractJsonObject('{"persona":{"name":"小林","age":31}}').name).toBe('小林');
    });

    it('keeps generated people adult and inside preference range', () => {
        const p = normalizePersona({ name: 'A', age: 12 }, { ...DEFAULT_MIHUI_PREFERENCES, ageMin: 24, ageMax: 32 });
        expect(p.age).toBe(24);
        expect(p.greeting.length).toBeGreaterThan(0);
    });

    it('normalizes new bubble arrays and keeps at most three bubbles', () => {
        expect(normalizeMihuiReply('{"bubbles":["第一句","第二句","第三句","第四句"],"signal":"warm"}')).toEqual({
            bubbles: ['第一句', '第二句', '第三句'],
            signal: 'warm',
        });
    });

    it('keeps old single reply responses compatible and splits long chat naturally', () => {
        const result = normalizeMihuiReply({ reply: '刚下班。路上有点堵。你吃饭了吗？', signal: 'neutral' });
        expect(result.bubbles.length).toBeGreaterThanOrEqual(1);
        expect(result.bubbles.length).toBeLessThanOrEqual(3);
        expect(result.bubbles.join('')).toBe('刚下班。路上有点堵。你吃饭了吗？');
    });

    it('normalizes optional AI location, transfer and transfer decision cards', () => {
        const result = normalizeMihuiReply({
            bubbles: ['我把位置发你。'], signal: 'warm',
            location: { name: '梧桐咖啡馆', address: '二楼靠窗' },
            transfer: { amount: 52.1314, note: '打车费' },
            transferAction: 'accept',
        });
        expect(result.location).toEqual({ name: '梧桐咖啡馆', address: '二楼靠窗' });
        expect(result.transfer).toEqual({ amount: 52.13, note: '打车费' });
        expect(result.transferAction).toBe('accept');
        expect(normalizeMihuiReply({ bubbles: ['不用。'], transfer: { amount: -1 }, transferAction: 'ignore' }).transfer).toBeUndefined();
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
        expect(mihuiMessageSummary({ id: 't1', role: 'assistant', type: 'transfer', content: '[转账]', transfer: { amount: 88, note: '夜宵', status: 'pending' }, timestamp: 1 })).toContain('¥88');
        expect(mihuiMessageSummary({ id: 't2', role: 'user', type: 'transfer', content: '[转账回执]', transfer: { amount: 88, status: 'accepted', receipt: true }, timestamp: 1 })).toContain('已接收');
    });

    it('only lets quick match hit a familiar on the one-third branch', () => {
        const characters = [
            { id: 'a', name: '苏郁', avatar: '', description: '毒舌', systemPrompt: '腹黑', memories: [] },
            { id: 'b', name: '秦少川', avatar: '', description: '冷静', systemPrompt: '寡言', memories: [] },
        ] as any;
        expect(pickMihuiFamiliar(characters, [], () => 0.7)).toBeUndefined();
        const draws = [0.1, 0];
        expect(pickMihuiFamiliar(characters, [], () => draws.shift() ?? 0)?.id).toBe('a');
    });

    it('reduces the chance of immediately matching the same familiar again', () => {
        const characters = [
            { id: 'a', name: '苏郁', avatar: '', description: '', systemPrompt: '', memories: [] },
            { id: 'b', name: '秦少川', avatar: '', description: '', systemPrompt: '', memories: [] },
        ] as any;
        const sessions = [{ id: 's1', familiar: { characterId: 'a' } }] as any;
        const draws = [0.1, 0.5];
        expect(pickMihuiFamiliar(characters, sessions, () => draws.shift() ?? 0)?.id).toBe('b');
    });

    it('creates a local personality-flavoured reveal line without another API call', () => {
        expect(buildMihuiRevealLine({ name: '苏郁', description: '毒舌又腹黑', systemPrompt: '', memories: [] } as any)).toContain('胆子不小');
        expect(buildMihuiRevealLine({ name: '秦少川', description: '冷静寡言', systemPrompt: '', memories: [] } as any)).toContain('不瞒你了');
    });

    it('carries long-term memories and archived private chat into a familiar match', () => {
        const continuity = buildMihuiFamiliarContinuity({
            id: 'a', name: '苏郁', memories: [{ id: 'mem-1', date: '2026-08-31', summary: '答应陪用户去夜市', mood: '期待' }],
        } as any, [
            { id: 1, charId: 'a', role: 'user', type: 'text', content: '别忘了我们约好的夜市', timestamp: 1 },
            { id: 2, charId: 'a', role: 'assistant', type: 'text', content: '记得。', timestamp: 2 },
        ] as any);
        expect(continuity).toContain('答应陪用户去夜市');
        expect(continuity).toContain('用户：别忘了我们约好的夜市');
        expect(continuity).toContain('苏郁：记得。');
    });

    it('writes a live familiar memory that forbids pretending to be a real stranger', () => {
        const summary = buildMihuiFamiliarMemorySummary({
            id: 's1', affinity: 20, createdAt: 1, updatedAt: 2,
            persona: { name: '林默', age: 29, gender: '男性', occupation: '编辑', city: '北京', appearance: '', personality: '', socialStyle: '', relationshipIntent: '', background: '', greeting: '' },
            familiar: { characterId: 'a', realName: '苏郁', description: '', systemPrompt: '' },
            messages: [{ id: 'm1', role: 'user', content: '你是不是认识我', timestamp: 1 }],
        }, '苏郁', '小眠');
        expect(summary).toContain('不要把用户当陌生人');
        expect(summary).toContain('不要明确否认你们认识');
        expect(summary).toContain('小眠：你是不是认识我');
    });
});
