import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import { DB } from './db';
import { setCharNameRegistry, getCharNameById } from './charNameRegistry';

// 群聊背景注入的发言人标注：之前所有角色发言（包括收到注入的角色自己）都被匿名成
// "Member"，私聊被问起群里的事时角色分不清谁说了什么、认不出自己的发言。
// 修复后：user 显示用户名，注入对象自己的发言标「你（名字）」，其他成员经
// charNameRegistry 解析出真实名字，查不到的兜底「群友」。

const charA = { id: 'char-a', name: '阿一' } as any;
const userProfile = { name: '条条' } as any;
const groups = [{ id: 'g-test', name: '深夜茶话会', members: ['char-a', 'char-b'] }] as any;

describe('群聊背景注入 · 发言人真实标注', () => {
    it('charNameRegistry 基本行为', () => {
        setCharNameRegistry([{ id: 'x', name: '小明' }]);
        expect(getCharNameById('x')).toBe('小明');
        expect(getCharNameById('missing')).toBeNull();
        expect(getCharNameById(null)).toBeNull();
    });

    it('注入块标注：用户名 / 你（自己） / 真实成员名 / 未知兜底群友', async () => {
        setCharNameRegistry([
            { id: 'char-a', name: '阿一' },
            { id: 'char-b', name: '阿二' },
        ]);
        await DB.saveMessage({ charId: 'user', groupId: 'g-test', role: 'user', type: 'text', content: '今晚吃火锅吗' } as any);
        await DB.saveMessage({ charId: 'char-a', groupId: 'g-test', role: 'assistant', type: 'text', content: '我要毛肚' } as any);
        await DB.saveMessage({ charId: 'char-b', groupId: 'g-test', role: 'assistant', type: 'text', content: '加宽粉' } as any);
        await DB.saveMessage({ charId: 'char-ghost', groupId: 'g-test', role: 'assistant', type: 'text', content: '幽灵发言' } as any);

        const parts = await ChatPrompts.buildSystemPromptParts(
            charA, userProfile, groups, [], [], [],
        );
        const injected = parts.volatileState;

        expect(injected).toContain('你亲历的近期群聊');
        expect(injected).toContain('条条: 今晚吃火锅吗');
        expect(injected).toContain('你（阿一）: 我要毛肚');
        expect(injected).toContain('阿二: 加宽粉');
        expect(injected).toContain('群友: 幽灵发言');
        expect(injected).not.toContain('Member');
    });
});
