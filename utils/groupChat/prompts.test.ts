import { describe, it, expect } from 'vitest';
import { buildGroupHistoryBlock, buildRoundRobinInstruction, GROUP_HISTORY_GAP_THRESHOLD_MS } from './prompts';
import type { Message, CharacterProfile } from '../../types';

const char = (id: string, name: string): CharacterProfile => ({ id, name } as CharacterProfile);

const msg = (id: number, role: Message['role'], content: string, timestamp: number, charId = ''): Message =>
    ({ id, role, type: 'text', content, timestamp, charId } as Message);

describe('buildGroupHistoryBlock 时间跳变分隔行', () => {
    const chars = [char('c1', '小夏')];
    const base = Date.UTC(2026, 6, 1, 12, 0, 0);

    it('相邻消息隔得久时插一条"隔了约 N 天"的分隔行', () => {
        const msgs: Message[] = [
            msg(1, 'assistant', '在吗', base, 'c1'),
            // 3 天后用户回来发一句
            msg(2, 'user', '我回来了', base + 3 * 24 * 60 * 60 * 1000),
        ];
        const { text } = buildGroupHistoryBlock(msgs, chars, [], '用户');
        expect(text).toContain('约 3 天');
        expect(text).toContain('中间群里没人说话');
        // 分隔行应夹在两条消息之间
        expect(text.indexOf('小夏: 在吗')).toBeLessThan(text.indexOf('约 3 天'));
        expect(text.indexOf('约 3 天')).toBeLessThan(text.indexOf('用户: 我回来了'));
    });

    it('间隔在阈值以内不插分隔行', () => {
        const msgs: Message[] = [
            msg(1, 'assistant', '早', base, 'c1'),
            msg(2, 'user', '早呀', base + 60 * 1000),
        ];
        const { text } = buildGroupHistoryBlock(msgs, chars, [], '用户');
        expect(text).not.toContain('中间群里没人说话');
        expect(text).toBe('小夏: 早\n用户: 早呀');
    });

    it('阈值常量为 3 小时', () => {
        expect(GROUP_HISTORY_GAP_THRESHOLD_MS).toBe(3 * 60 * 60 * 1000);
    });
});

describe('buildRoundRobinInstruction 双轮圆桌', () => {
    const history = { text: '用户: 讨论一下方案', attachedImages: [], attachedImagesNote: '' };

    it('第一轮允许完整发言并限制最多 5 行', () => {
        const opening = buildRoundRobinInstruction('阿澜', history, '无', { slot: 'opening', maxLines: 5 });
        const reply = buildRoundRobinInstruction('小北', history, '无', { slot: 'reply', maxLines: 5 });
        expect(opening).toContain('第一轮第一个');
        expect(reply).toContain('第一轮第二个');
        expect(opening).toContain('最多 5 行');
        expect(opening).not.toContain('[[SKIP]]');
    });

    it('第二轮要求精简、允许跳过且不再使用点名接力', () => {
        const followup = buildRoundRobinInstruction('阿澜', history, '无', { slot: 'followup', maxLines: 3 });
        const closing = buildRoundRobinInstruction('小北', history, '无', { slot: 'closing', maxLines: 3 });
        expect(followup).toContain('第二轮短回应');
        expect(followup).toContain('[[SKIP]]');
        expect(followup).toContain('最多 3 行');
        expect(closing).toContain('第二轮最后一个');
        expect(closing).toContain('等待用户');
        expect(closing).toContain('不要输出 `[[TO: 名字]]`');
    });

    it('固定角色1在所有轮次都限制 1-3 个气泡、80 字以内', () => {
        const opening = buildRoundRobinInstruction('阿澜', history, '无', { slot: 'opening', maxLines: 3, maxChars: 80 });
        const followup = buildRoundRobinInstruction('阿澜', history, '无', { slot: 'followup', maxLines: 3, maxChars: 80 });
        expect(opening).toContain('目标 **1-3 行**');
        expect(opening).toContain('不得超过 80 个字符');
        expect(opening).toContain('表情包也单独计作一个气泡');
        expect(followup).toContain('不得超过 80 个字符');
    });
});
