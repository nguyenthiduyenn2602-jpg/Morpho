/**
 * 聊天生成的全局广播事件（对标彼方的 vr-session-start/end）。
 *
 * 背景：Chat App 切走是真 unmount（PhoneShell 按 activeApp switch 渲染），但
 * useChatAI.triggerAI 的异步闭包会继续跑完并把回复落库（本地 fetch 路径），
 * 情绪评估同理。过去这段"后台生成"对用户完全不可见——切走就像死了。
 *
 * 这里定义一组 window CustomEvent，由生成闭包在开始/结束时派发：
 *   - 根级 <ChatBroadcast/>（App.tsx，PhoneShell 之外）监听并渲染
 *     「xx 正在回应…」「xx 正在感受…」全局横幅，组件生命周期与 Chat 无关；
 *   - OSContext 监听 reply 落库事件，bump lastMsgTimestamp 让当前挂载的
 *     Chat 重新 reloadMessages，并在用户不在该会话时补未读/toast——
 *     与 instant push 的 'active-msg-received' 回落行为对齐。
 *
 * detail 一律是 { charId, charName }。
 */

export const CHAT_GEN_EVENTS = {
    /** 主回复生成开始（本地 fetch 与 instant push 两条路径都算） */
    replyStart: 'chat-gen-reply-start',
    /** 主回复生成会话结束（triggerAI finally，成功/失败/instant 均触发） */
    replyEnd: 'chat-gen-reply-end',
    /** 本地 fetch 路径：回复已全部落库（后处理管线跑完）。instant 路径不发——它走 'active-msg-received' */
    replyArrived: 'chat-gen-reply-arrived',
    /** 情绪评估开始（本地 eval / post-push eval / 主动消息 eval / instant 点灯） */
    emotionStart: 'chat-gen-emotion-start',
    /** 情绪评估结束（instant 路径由 worker 推回，结束信号是既有的 'instant-emotion-done'） */
    emotionEnd: 'chat-gen-emotion-end',
    /**
     * 情绪评估失败（本地 fetch 报错 / 云端 worker 空结果 / 输出解析全灭）。
     * 过去失败只写 console.warn，用户侧表现是「情绪不更新但没任何报错」，完全没法自查
     * （真实用户反馈）。OSContext 监听本事件弹 toast（每角色带冷却），detail.reason 带人话原因。
     */
    emotionFailed: 'chat-gen-emotion-failed',
} as const;

export interface ChatGenDetail {
    charId: string;
    charName: string;
    /** emotionFailed 专用：失败原因（人话，可直接展示给用户） */
    reason?: string;
}

export function announceChatGen(event: string, detail: ChatGenDetail): void {
    try {
        window.dispatchEvent(new CustomEvent(event, { detail }));
    } catch { /* SSR / 测试环境无 window */ }
}

// ─── 当前聊天视图快照 ───
// ChatBroadcast 挂在 OSProvider 之外拿不到 activeApp/activeCharacterId，
// 由 OSContext 在视图变化时写入这个模块级快照（同 MusicContext 的
// loadMusicPlaybackSnapshot 模式），并派发 CHAT_VIEW_CHANGED_EVENT 触发重渲染。
// 用途：用户正开着某角色的聊天页时，该角色的横幅不显示（页内已有打字指示），
// 切走的瞬间横幅接棒出现。

export const CHAT_VIEW_CHANGED_EVENT = 'chat-view-changed';

interface ChatViewSnapshot {
    /** 当前是否开着 Chat App */
    chatOpen: boolean;
    /** Chat App 当前会话的角色 id（chatOpen=false 时无意义） */
    charId: string | null;
}

let chatView: ChatViewSnapshot = { chatOpen: false, charId: null };

export function setChatViewSnapshot(chatOpen: boolean, charId: string | null): void {
    if (chatView.chatOpen === chatOpen && chatView.charId === charId) return;
    chatView = { chatOpen, charId };
    try {
        window.dispatchEvent(new CustomEvent(CHAT_VIEW_CHANGED_EVENT));
    } catch { /* SSR */ }
}

export function getChatViewSnapshot(): ChatViewSnapshot {
    return chatView;
}
