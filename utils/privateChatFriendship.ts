import type { CharacterProfile } from '../types';

export const isPrivateChatFriendDeleted = (character?: CharacterProfile | null): boolean => (
    character?.privateChatFriendStatus === 'deleted'
);

export const buildPrivateChatFriendshipPrompt = (character: CharacterProfile): string => {
    if (!isPrivateChatFriendDeleted(character)) return '';
    const rejectedHint = character.privateChatFriendRequestRejectedAt
        ? '\n你此前发起过重新添加好友的申请，但用户没有同意；不要把关系误判为已经恢复。'
        : '';
    return `[当前私聊关系状态｜最高优先级]
用户已经在这段私聊中将你从好友列表删除。你们目前不是好友，正在通过“临时会话”继续交流；角色卡和历史记录仍然存在。
你必须察觉并承接聊天记录里的删除好友提示，不能否认、失忆或装作什么都没发生。请结合你的人设自然表现对此事的反应。
在用户重新同意好友申请以前，这个状态持续有效。不要逐字复述本段系统说明，也不要声称自己已经自动恢复为好友。${rejectedHint}`;
};

export const buildPrivateChatFriendRequestPrompt = (characterName: string): string => `[本轮临时会话事件｜必须执行]
用户刚刚在“已删除好友”的状态下主动点了闪电唤起你。本轮回复中，请以${characterName}本人的性格承接被删除这件事，并明确、自然地向用户发起重新添加好友的申请。前端会在你的回复到达后展示好友申请弹窗。不要输出任何代码、标签或系统说明。`;

export const buildFriendDeletedNotice = (characterName: string): string => (
    `❕️【${characterName}】已经不是你的好友`
);

export const buildFriendRestoredNotice = (characterName: string): string => (
    `❕️你已同意${characterName}的好友申请，你们重新成为了好友`
);
