import React, { useEffect, useState } from 'react';
import { CHAT_GEN_EVENTS, CHAT_VIEW_CHANGED_EVENT, getChatViewSnapshot } from '../utils/chatGenEvents';

/**
 * 聊天生成全局横幅（对标彼方的 VRBroadcast，App 根级挂载）。
 *
 * 监听 useChatAI / evaluateEmotionBackground 派发的 chat-gen-* 事件，显示
 * 「xx 正在回应…」「xx 正在感受…」。生成闭包在 Chat 卸载后继续跑，事件照发，
 * 所以用户切走 Chat 也能看到生成还活着；点横幅跳回该角色的聊天页
 * （复用 OSContext 已有的 'active-msg-open' 监听）。
 *
 * 抑制规则：用户正开着该角色的聊天页时不显示（页内已有打字/情绪指示灯），
 * 切走的瞬间由 CHAT_VIEW_CHANGED_EVENT 触发重渲染、横幅接棒。
 *
 * 结束信号都在 finally 里派发，正常不会漏；TTL 只是兜底（instant 情绪评估的
 * 'instant-emotion-done' 可能因 worker 被杀/推送丢失而永不到达）。
 */

type GenKind = 'reply' | 'emotion';
interface GenEntry { kind: GenKind; charId: string; charName: string; startedAt: number; }

// 兜底过期：主回复对齐 instant 300s 超时 + 本地重试余量；情绪评估对齐 hook 内 90s 安全网
const TTL_MS: Record<GenKind, number> = { reply: 6 * 60_000, emotion: 2 * 60_000 };

const LABEL: Record<GenKind, string> = { reply: '正在回应', emotion: '正在感受' };

const ChatBroadcast: React.FC = () => {
    const [entries, setEntries] = useState<GenEntry[]>([]);
    const [, setViewTick] = useState(0);

    useEffect(() => {
        const add = (kind: GenKind) => (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string; charName?: string };
            if (!d?.charId) return;
            setEntries(prev => prev.some(x => x.kind === kind && x.charId === d.charId)
                ? prev
                : [...prev, { kind, charId: d.charId!, charName: d.charName || '', startedAt: Date.now() }]);
        };
        const remove = (kind: GenKind) => (e: Event) => {
            const id = (e as CustomEvent).detail?.charId;
            if (!id) return;
            setEntries(prev => {
                const next = prev.filter(x => !(x.kind === kind && x.charId === id));
                return next.length === prev.length ? prev : next;
            });
        };
        const onReplyStart = add('reply');
        const onReplyEnd = remove('reply');
        const onEmotionStart = add('emotion');
        const onEmotionEnd = remove('emotion');
        const onView = () => setViewTick(n => n + 1);
        window.addEventListener(CHAT_GEN_EVENTS.replyStart, onReplyStart);
        window.addEventListener(CHAT_GEN_EVENTS.replyEnd, onReplyEnd);
        window.addEventListener(CHAT_GEN_EVENTS.emotionStart, onEmotionStart);
        window.addEventListener(CHAT_GEN_EVENTS.emotionEnd, onEmotionEnd);
        // instant 模式情绪评估在 worker 跑，结束信号是 activeMsgRuntime 的既有事件
        window.addEventListener('instant-emotion-done', onEmotionEnd);
        window.addEventListener(CHAT_VIEW_CHANGED_EVENT, onView);
        const sweeper = setInterval(() => {
            const now = Date.now();
            setEntries(prev => {
                const next = prev.filter(x => now - x.startedAt < TTL_MS[x.kind]);
                return next.length === prev.length ? prev : next;
            });
        }, 15_000);
        return () => {
            window.removeEventListener(CHAT_GEN_EVENTS.replyStart, onReplyStart);
            window.removeEventListener(CHAT_GEN_EVENTS.replyEnd, onReplyEnd);
            window.removeEventListener(CHAT_GEN_EVENTS.emotionStart, onEmotionStart);
            window.removeEventListener(CHAT_GEN_EVENTS.emotionEnd, onEmotionEnd);
            window.removeEventListener('instant-emotion-done', onEmotionEnd);
            window.removeEventListener(CHAT_VIEW_CHANGED_EVENT, onView);
            clearInterval(sweeper);
        };
    }, []);

    const view = getChatViewSnapshot();
    const visible = entries.filter(x => !(view.chatOpen && view.charId === x.charId));
    if (visible.length === 0) return null;
    // 回复优先于情绪展示（同角色两个都在跑时"正在回应"信息量更大）
    const cur = [...visible].sort((a, b) =>
        (a.kind === b.kind ? a.startedAt - b.startedAt : (a.kind === 'reply' ? 1 : -1))
    )[visible.length - 1];
    const extra = visible.length > 1 ? ` 等 ${visible.length} 项` : '';

    const jump = () => {
        try {
            window.dispatchEvent(new CustomEvent('active-msg-open', { detail: { charId: cur.charId } }));
        } catch { /* ignore */ }
    };

    return (
        <div className="fixed left-1/2 -translate-x-1/2 z-[999]"
            style={{ top: 'calc(var(--safe-top) + 44px)' }}>
            <style>{`@keyframes chatbcin{from{opacity:0;transform:translateY(-14px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
                     @keyframes chatbcdot{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}`}</style>
            <button type="button" onClick={jump}
                className="relative flex items-center gap-2.5 pl-3 pr-3.5 py-1.5 rounded-full overflow-hidden backdrop-blur-xl cursor-pointer"
                style={{
                    animation: 'chatbcin .45s cubic-bezier(.2,.9,.3,1.2)',
                    background: 'linear-gradient(100deg, rgba(20,36,32,.85), rgba(12,22,20,.85))',
                    border: '1px solid rgba(160,230,200,.28)',
                    boxShadow: '0 10px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(190,240,215,.16), 0 0 18px rgba(110,220,170,.15)',
                }}>
                <span className="relative text-[12px] opacity-85" style={{ filter: 'drop-shadow(0 0 5px rgba(140,235,190,.6))' }}>
                    {cur.kind === 'reply' ? '💬' : '🫧'}
                </span>
                <span className="relative text-[11px] tracking-[0.04em] text-white/90 whitespace-nowrap font-light">
                    <span className="text-emerald-200/90 font-normal">{cur.charName}</span>{extra} {LABEL[cur.kind]}
                </span>
                <span className="relative flex gap-1">
                    {[0, 1, 2].map(i => (
                        <span key={i} className="w-1 h-1 rounded-full bg-emerald-100/80"
                            style={{ animation: 'chatbcdot 1.2s infinite', animationDelay: `${i * 0.2}s` }} />
                    ))}
                </span>
            </button>
        </div>
    );
};

export default ChatBroadcast;
