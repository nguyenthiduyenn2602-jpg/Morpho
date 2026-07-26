import { Message } from '../../types';
import { messageLogText } from './format';

export const DEFAULT_MEMBER_TIMELINE_CAP = 40;

/** 时间线单行正文的截断长度——比旧版"50 字"宽松，保住情绪细节又不至于撑爆 prompt */
const LINE_MAX_CHARS = 80;

const truncate = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max)}…` : text;

const formatTime = (ts: number): string => {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
};

export interface MemberTimelineOptions {
    /** 该成员的私聊消息（建议 DB.getRecentMessagesByCharId(id, cap, true) 取最近 cap 条） */
    privateMsgs: Message[];
    /** 群聊消息（当前群，内存里已有的即可） */
    groupMsgs: Message[];
    /** 合并排序后取末 N 条 */
    cap: number;
    /** 群消息说话人解析：charId → 显示名（user 角色不经过它） */
    resolveSpeaker: (m: Message) => string;
    /** 表情包 URL → 名称（占位符用） */
    stickerName?: (url: string) => string;
}

/**
 * 构建某成员的"私聊 + 群聊合并时间线"——按时间戳升序、带来源标签。
 * 这是群聊里角色感情与私聊衔接的关键：旧版只带"最后 10 条私聊 × 截断 50 字"
 * 且与群历史隔离，角色看不到两条线的先后关系。
 *
 * 输出形如：
 *   [私聊][07-10 22:14] 用户: 今天好累……
 *   [私聊][07-10 22:15] 我: 那早点睡，别刷手机了
 *   [群聊][07-11 09:02] 小夏: 早啊！
 */
export function buildMemberTimeline(opts: MemberTimelineOptions): string {
    const { privateMsgs, groupMsgs, cap, resolveSpeaker, stickerName } = opts;

    const tagged = [
        ...privateMsgs.slice(-cap).map(m => ({ m, isGroup: false })),
        ...groupMsgs.slice(-cap).map(m => ({ m, isGroup: true })),
    ];
    tagged.sort((a, b) => a.m.timestamp - b.m.timestamp);

    return tagged
        .slice(-cap)
        .map(({ m, isGroup }) => {
            const tag = isGroup ? '[群聊]' : '[私聊]';
            // 私聊行的"我"= 该成员本人；群聊行用真名，成员才能分清谁说的
            const speaker = m.role === 'user' ? '用户' : (isGroup ? resolveSpeaker(m) : '我');
            const text = truncate(messageLogText(m, stickerName), LINE_MAX_CHARS);
            return `${tag}[${formatTime(m.timestamp)}] ${speaker}: ${text}`;
        })
        .join('\n');
}
