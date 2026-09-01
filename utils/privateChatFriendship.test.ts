import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import {
    buildFriendDeletedNotice,
    buildPrivateChatFriendRequestPrompt,
    buildPrivateChatFriendshipPrompt,
    isPrivateChatFriendDeleted,
} from './privateChatFriendship';

const character = (status?: CharacterProfile['privateChatFriendStatus']) => ({
    id: 'c1',
    name: '苏郁',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    updatedAt: 0,
    privateChatFriendStatus: status,
} as CharacterProfile);

describe('private chat friendship', () => {
    it('only marks an explicitly deleted relationship as deleted', () => {
        expect(isPrivateChatFriendDeleted(character())).toBe(false);
        expect(isPrivateChatFriendDeleted(character('friend'))).toBe(false);
        expect(isPrivateChatFriendDeleted(character('deleted'))).toBe(true);
    });

    it('injects the temporary-session fact without pretending the card was deleted', () => {
        const prompt = buildPrivateChatFriendshipPrompt(character('deleted'));
        expect(prompt).toContain('临时会话');
        expect(prompt).toContain('角色卡和历史记录仍然存在');
        expect(buildPrivateChatFriendshipPrompt(character())).toBe('');
    });

    it('builds the visible notice and lightning-triggered friend request instruction', () => {
        expect(buildFriendDeletedNotice('苏郁')).toBe('❕️【苏郁】已经不是你的好友');
        expect(buildPrivateChatFriendRequestPrompt('苏郁')).toContain('重新添加好友');
    });
});
