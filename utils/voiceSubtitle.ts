import { Message } from '../types';

/**
 * 字幕对齐模式（外语语音）下，中文字幕和 <语音> 块会被 chunkText 拆成同一回合里的
 * 不同气泡：字幕是独立的文字气泡，语音消息本身标签外往往没有中文。
 *
 * 以前语音条的中文翻译 (originalText) 只看「标签外的文字」，看不到就发一次 LLM
 * 请求把外语翻回中文——请求一失败翻译就永远空着（「外语语音没翻译」）。
 *
 * 这个 helper 从同一批 assistant 消息里把字幕直接收回来当翻译：确定性、零成本、
 * 内容还和用户看到的字幕逐字一致。收不到（或对不齐）再让调用方走 LLM 兜底。
 *
 * ⚠️ 前提是模型真的遵守了字幕对齐格式。模型不守格式时（标签外是独立闲聊短句、
 * 语音里是另一段话），把兄弟气泡当翻译就会显示成驴唇不对马嘴的中文（真实翻车
 * 报告：转文字面板显示同回合的「等我一下」而不是语音的翻译）。所以收之前必须
 * 做结构校验，对不上一律返回 ''（宁可多花一次 LLM 调用，也不能展示错误内容）：
 *  - 中文气泡数 == 语音内容的分段数（字幕对齐 prompt 要求逐段对应，chunkText
 *    按换行分气泡、语音内容按换行分段，两边应当数目一致）
 *  - 中外文字符量比例合理（4 个字的「等我一下」配 300 字符的英文独白一眼假）
 *
 * 其余约束：
 *  - 只收 msg 所在的连续 assistant 批次（前后扩展，遇到非 assistant 停）
 *  - 批次里除 msg 外还有别的语音消息 → 字幕归属含糊，返回 ''
 *  - 只收 type==='text' 且不含语音标签的气泡；emoji / 卡片等跳过
 *  - 双语气泡只取 %%BILINGUAL%% 之前的「选」语言半边（那才是字幕面）
 */
type MsgLike = Pick<Message, 'id' | 'role' | 'type' | 'content'>;

/** 收集同批次兄弟气泡文本 + 语音标签内文（不做对齐校验）。ambiguous=同批有第二条语音。 */
function collectParts(messages: MsgLike[], msgId: number): { parts: string[]; inner: string; ambiguous: boolean } {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return { parts: [], inner: '', ambiguous: false };

    // 语音内容（配对提取；未闭合的历史坏数据取标签后全部）
    const voiceContent = messages[idx].content || '';
    const inner = (
        voiceContent.match(/<[语語]音[^>]*>([\s\S]*?)<\/\s*[语語]音\s*>/)?.[1]
        ?? voiceContent.match(/<[语語]音[^>]*>([\s\S]*)$/)?.[1]
        ?? ''
    ).trim();

    let start = idx;
    let end = idx;
    while (start > 0 && messages[start - 1].role === 'assistant') start--;
    while (end < messages.length - 1 && messages[end + 1].role === 'assistant') end++;

    const VOICE_OPEN_RE = /<[语語]音[^>]*>/;
    const parts: string[] = [];
    for (let i = start; i <= end; i++) {
        const m = messages[i];
        if (i === idx) continue;
        if (m.type !== 'text') continue;
        if (VOICE_OPEN_RE.test(m.content || '')) return { parts: [], inner, ambiguous: true };
        const half = (m.content || '').split(/%%BILINGUAL%%/i)[0].trim();
        if (half) parts.push(half);
    }
    return { parts, inner, ambiguous: false };
}

export function collectVoiceBatchSubtitle(messages: MsgLike[], msgId: number): string {
    const { parts, inner, ambiguous } = collectParts(messages, msgId);
    if (ambiguous || !inner || !parts.length) return '';

    // ── 结构对齐校验：对不上说明标签外不是字幕，走 LLM 兜底 ──
    const foreignSegs = inner.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (parts.length !== foreignSegs.length) return '';
    const zhLen = parts.join('').replace(/\s/g, '').length;
    const fLen = inner.replace(/\s/g, '').length;
    if (zhLen * 6 < fLen || fLen * 6 < zhLen) return '';

    // 兜个上限，防极端长回合把翻译面板撑爆
    return parts.join('\n').slice(0, 2000);
}

/**
 * 毒数据自检：2026-07-02 ~ 07-04 之间的版本收字幕**不做对齐校验**，模型不守字幕
 * 格式时把同回合的闲聊短句当翻译持久化了。回灌语音数据时用这个函数认出这种
 * 存量脏翻译（存的值 == 旧逻辑的产物，且新校验判定不是字幕），认出来就清掉。
 */
export function isPoisonedVoiceSubtitle(messages: MsgLike[], msgId: number, storedOriginalText: string): boolean {
    if (!storedOriginalText) return false;
    const { parts, ambiguous } = collectParts(messages, msgId);
    if (ambiguous || !parts.length) return false;
    const legacyJoin = parts.join('\n').slice(0, 2000); // 旧逻辑（无校验）的输出
    if (storedOriginalText !== legacyJoin) return false; // 不是旧逻辑写的（LLM 翻译/标签外文字），不动
    return collectVoiceBatchSubtitle(messages, msgId) !== legacyJoin; // 新校验不认可 → 毒数据
}
