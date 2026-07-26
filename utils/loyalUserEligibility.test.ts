import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import type { MemoryNode, MemoryRoom } from './memoryPalace/types';
import {
    evaluateLoyalUserEligibility,
    LOYAL_RECRUITMENT_CUTOFF_AT,
    LOYAL_RECRUITMENT_RECENT_START_AT,
    type LoyalEligibilitySnapshot,
} from './loyalUserEligibility';

const DAY = 86_400_000;

function character(id: string, memories: CharacterProfile['memories'] = [], refinedMemories?: Record<string, string>): CharacterProfile {
    return {
        id,
        name: id,
        avatar: '',
        description: '',
        systemPrompt: '',
        memories,
        refinedMemories,
    };
}

function userMessages(dayOffsets: number[], perDay: number, charId = 'preset-sully-v2'): Message[] {
    let id = 1;
    return dayOffsets.flatMap(offset => Array.from({ length: perDay }, (_, index) => ({
        id: id++,
        charId,
        role: 'user' as const,
        type: 'text' as const,
        content: `message-${offset}-${index}`,
        timestamp: LOYAL_RECRUITMENT_RECENT_START_AT + offset * DAY + 3_600_000,
    })));
}

function node(id: string, room: MemoryRoom, createdAt: number, extra: Partial<MemoryNode> = {}): MemoryNode {
    return {
        id,
        charId: 'preset-sully-v2',
        content: id,
        room,
        tags: [],
        importance: 5,
        mood: 'neutral',
        embedded: true,
        createdAt,
        lastAccessedAt: createdAt,
        accessCount: 0,
        origin: 'extraction',
        ...extra,
    };
}

function snapshot(overrides: Partial<LoyalEligibilitySnapshot> = {}): LoyalEligibilitySnapshot {
    return {
        characters: [character('preset-sully-v2')],
        messages: [],
        guidebookSessions: [],
        memoryNodes: [],
        ...overrides,
    };
}

describe('忠实用户一次性资格检测', () => {
    it('高活跃 + 截止日前有证据的非默认角色可在没有记忆宫殿时通过', () => {
        const messages = userMessages([1, 2, 8, 9, 15, 16, 22, 23, 25, 26, 27], 14, 'char-custom');
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2'), character('char-custom')],
            messages,
        }));

        expect(result.hardGatePassed).toBe(true);
        expect(result.breakdown.recentActivity).toBe(50);
        expect(result.breakdown.customCharacter).toBe(15);
        expect(result.breakdown.memoryPalace).toBe(0);
        expect(result.score).toBe(65);
        expect(result.qualificationPath).toBe('standard');
        expect(result.passed).toBe(true);
    });

    it('有非默认角色时，任意单个角色在截止日前累计三个活跃日即可走深度通道', () => {
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [
                character('preset-sully-v2'),
                character('char-custom', [{ id: 'evidence', date: '2026-05-01', summary: 'used' }]),
            ],
            messages: userMessages([-120, -60, -10], 3, 'preset-sully-v2'),
        }));

        expect(result.metrics.recentUserMessages).toBe(0);
        expect(result.metrics.maxPreCutoffCharacterActiveDays).toBe(3);
        expect(result.hardGatePassed).toBe(false);
        expect(result.deepUserChannelPassed).toBe(true);
        expect(result.qualificationPath).toBe('deep');
        expect(result.passed).toBe(true);
    });

    it('有非默认角色时，七月以来三条有效神经链接记忆即可走深度通道', () => {
        const memories: CharacterProfile['memories'] = ['2026-07-01', '2026-07-10', '2026-07-19']
            .map((date, index) => ({ id: `m-${index}`, date, summary: `memory-${index}` }));
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2'), character('char-custom', memories)],
        }));

        expect(result.metrics.neuralMemoryEntriesSinceJuly).toBe(3);
        expect(result.metrics.neuralMemoryEntriesSinceJune).toBe(3);
        expect(result.deepUserChannelPassed).toBe(true);
        expect(result.qualificationPath).toBe('deep');
    });

    it('有非默认角色时，六月以来十五条有效神经链接记忆即可走深度通道', () => {
        const memories: CharacterProfile['memories'] = Array.from({ length: 15 }, (_, index) => ({
            id: `m-${index}`,
            date: `2026-06-${String(index + 1).padStart(2, '0')}`,
            summary: `memory-${index}`,
        }));
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2'), character('char-custom', memories)],
        }));

        expect(result.metrics.neuralMemoryEntriesSinceJuly).toBe(0);
        expect(result.metrics.neuralMemoryEntriesSinceJune).toBe(15);
        expect(result.deepUserChannelPassed).toBe(true);
        expect(result.qualificationPath).toBe('deep');
    });

    it('有非默认角色时，截止日前累计二百条有效神经链接记忆即可走深度通道', () => {
        const memories: CharacterProfile['memories'] = Array.from({ length: 200 }, (_, index) => ({
            id: `m-${index}`,
            date: '2026-05-01',
            summary: `memory-${index}`,
        }));
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2'), character('char-custom', memories)],
        }));

        expect(result.metrics.neuralMemoryEntriesTotal).toBe(200);
        expect(result.deepUserChannelPassed).toBe(true);
        expect(result.qualificationPath).toBe('deep');
    });

    it('神经链接三档条件都必须达到边界，二条七月、十四条六月和不足二百总量不会通过', () => {
        const june = Array.from({ length: 12 }, (_, index) => ({
            id: `june-${index}`,
            date: `2026-06-${String(index + 1).padStart(2, '0')}`,
            summary: `june-${index}`,
        }));
        const july = ['2026-07-01', '2026-07-19'].map((date, index) => ({
            id: `july-${index}`,
            date,
            summary: `july-${index}`,
        }));
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2'), character('char-custom', [...june, ...july])],
        }));

        expect(result.metrics.neuralMemoryEntriesSinceJuly).toBe(2);
        expect(result.metrics.neuralMemoryEntriesSinceJune).toBe(14);
        expect(result.metrics.neuralMemoryEntriesTotal).toBe(14);
        expect(result.deepUserChannelPassed).toBe(false);
        expect(result.passed).toBe(false);
    });

    it('有非默认角色时，记忆宫殿有效节点超过二十即可走深度通道', () => {
        const nodes = Array.from({ length: 21 }, (_, index) => node(
            `n-${index}`,
            'living_room',
            LOYAL_RECRUITMENT_CUTOFF_AT - (index + 1) * DAY,
        ));
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [
                character('preset-sully-v2'),
                character('char-custom', [{ id: 'evidence', date: '2026-05-01', summary: 'used' }]),
            ],
            memoryNodes: nodes,
        }));

        expect(result.metrics.palaceNodes).toBe(21);
        expect(result.deepUserChannelPassed).toBe(true);
        expect(result.qualificationPath).toBe('deep');
    });

    it('没有非默认角色时，即使记忆宫殿超过二十也不进入深度通道', () => {
        const nodes = Array.from({ length: 21 }, (_, index) => node(
            `n-${index}`,
            'living_room',
            LOYAL_RECRUITMENT_CUTOFF_AT - (index + 1) * DAY,
        ));
        const result = evaluateLoyalUserEligibility(snapshot({ memoryNodes: nodes }));

        expect(result.metrics.hasQualifiedCustomCharacter).toBe(false);
        expect(result.deepUserChannelPassed).toBe(false);
        expect(result.passed).toBe(false);
    });

    it('三个角色各活跃一天不能冒充任意单个角色活跃三天', () => {
        const messages = [
            ...userMessages([-30], 3, 'preset-sully-v2'),
            ...userMessages([-20], 3, 'char-a'),
            ...userMessages([-10], 3, 'char-b'),
        ];
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2'), character('char-a'), character('char-b')],
            messages,
        }));

        expect(result.metrics.maxPreCutoffCharacterActiveDays).toBe(1);
        expect(result.deepUserChannelPassed).toBe(false);
        expect(result.passed).toBe(false);
    });

    it('一天内集中刷消息无法跨过最近一个月活跃硬门槛', () => {
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2'), character('char-custom')],
            messages: userMessages([10], 200, 'char-custom'),
        }));

        expect(result.metrics.recentUserMessages).toBe(200);
        expect(result.metrics.recentActiveDays).toBe(1);
        expect(result.hardGatePassed).toBe(false);
        expect(result.deepUserChannelPassed).toBe(false);
        expect(result.passed).toBe(false);
    });

    it('截止时间后的消息和角色证据完全不计', () => {
        const afterCutoff: Message[] = Array.from({ length: 200 }, (_, index) => ({
            id: index + 1,
            charId: 'char-late',
            role: 'user',
            type: 'text',
            content: 'late',
            timestamp: LOYAL_RECRUITMENT_CUTOFF_AT + 1 + index,
        }));
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2'), character('char-late')],
            messages: afterCutoff,
        }));

        expect(result.metrics.recentUserMessages).toBe(0);
        expect(result.metrics.hasQualifiedCustomCharacter).toBe(false);
        expect(result.score).toBe(0);
    });

    it('传统记忆排除 7 月 20 日 date-only 数据和 2026 年 7 月精炼总结', () => {
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2', [
                { id: 'late-day', date: '2026-07-20', summary: '无法判断 19 点前后' },
            ], {
                '2026-07': '无法判断 19 点前后',
            })],
        }));

        expect(result.metrics.memoryUnits).toBe(0);
        expect(result.breakdown.neuralMemory).toBe(0);
    });

    it('神经链接记忆同时按跨度、积累量和最近活跃计分', () => {
        const result = evaluateLoyalUserEligibility(snapshot({
            characters: [character('preset-sully-v2', [
                { id: 'm1', date: '2026-03-01', summary: 'old' },
                { id: 'm2', date: '2026-06-21', summary: 'recent' },
                { id: 'm3', date: '2026-06-25', summary: 'recent' },
                { id: 'm4', date: '2026-07-01', summary: 'recent' },
                { id: 'm5', date: '2026-07-08', summary: 'recent' },
                { id: 'm6', date: '2026-07-19', summary: 'recent' },
            ])],
        }));

        expect(result.metrics.memoryUnits).toBe(6);
        expect(result.metrics.recentMemoryUnits).toBe(5);
        expect(result.metrics.memorySpanDays).toBeGreaterThanOrEqual(90);
        expect(result.breakdown.neuralMemory).toBe(24); // 10 跨度 + 9 积累 + 5 近期
    });

    it('记忆宫殿只奖励原始有效节点，排除总结、消化和系统派生节点', () => {
        const rooms: MemoryRoom[] = ['living_room', 'bedroom', 'study'];
        const valid = Array.from({ length: 15 }, (_, index) => node(
            `n-${index}`,
            rooms[index % rooms.length],
            LOYAL_RECRUITMENT_CUTOFF_AT - (index + 1) * DAY,
        ));
        const ignored = [
            node('summary', 'living_room', LOYAL_RECRUITMENT_CUTOFF_AT - DAY, { isBoxSummary: true }),
            node('digestion', 'bedroom', LOYAL_RECRUITMENT_CUTOFF_AT - DAY, { origin: 'digestion' }),
            node('system', 'study', LOYAL_RECRUITMENT_CUTOFF_AT - DAY, { origin: 'system' }),
            node('future', 'attic', LOYAL_RECRUITMENT_CUTOFF_AT + DAY),
        ];
        const result = evaluateLoyalUserEligibility(snapshot({ memoryNodes: [...valid, ...ignored] }));

        expect(result.metrics.palaceNodes).toBe(15);
        expect(result.metrics.palaceRooms).toBe(3);
        expect(result.breakdown.memoryPalace).toBe(8); // 5 节点 + 2 房间 + 1 近期
    });
});
