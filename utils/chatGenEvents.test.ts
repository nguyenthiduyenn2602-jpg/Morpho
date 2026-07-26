import { describe, it, expect } from 'vitest';
import {
    announceChatGen,
    CHAT_GEN_EVENTS,
    setChatViewSnapshot,
    getChatViewSnapshot,
} from './chatGenEvents';

// node 环境无 window —— 派发函数必须静默降级（生成闭包/评估函数在测试与
// SSR 环境也会被调用，不能因为广播而抛错拖垮主流程）。

describe('chatGenEvents', () => {
    it('无 window 时 announceChatGen 不抛错', () => {
        expect(() => announceChatGen(CHAT_GEN_EVENTS.replyStart, { charId: 'c1', charName: '小角色' })).not.toThrow();
    });

    it('视图快照 set/get 往返一致，无 window 也不抛错', () => {
        expect(() => setChatViewSnapshot(true, 'c1')).not.toThrow();
        expect(getChatViewSnapshot()).toEqual({ chatOpen: true, charId: 'c1' });
        setChatViewSnapshot(false, null);
        expect(getChatViewSnapshot()).toEqual({ chatOpen: false, charId: null });
    });

    it('事件名稳定（ChatBroadcast / OSContext / useChatAI 三方约定）', () => {
        expect(CHAT_GEN_EVENTS.replyStart).toBe('chat-gen-reply-start');
        expect(CHAT_GEN_EVENTS.replyEnd).toBe('chat-gen-reply-end');
        expect(CHAT_GEN_EVENTS.replyArrived).toBe('chat-gen-reply-arrived');
        expect(CHAT_GEN_EVENTS.emotionStart).toBe('chat-gen-emotion-start');
        expect(CHAT_GEN_EVENTS.emotionEnd).toBe('chat-gen-emotion-end');
    });
});
