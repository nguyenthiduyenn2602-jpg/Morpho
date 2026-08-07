// 群聊 LLM 输出解析 —— 两层容错（家规：严格层失败后进宽松层，绝不静默丢整轮输出）。
// 纯函数、无副作用，便于 vitest 直测。

export interface DirectorAction {
    charId: string;
    content: string;
}

export interface QuotedBubbleLine {
    content: string;
    /** `[[QUOTE: …]]` applies to this bubble only. */
    quoteSnippet?: string;
}

/**
 * Split a member's multiline reply into bubbles while preserving every quote.
 * A marker binds to the next non-empty bubble and is always stripped, even if
 * its target cannot later be resolved.
 */
export function parseQuotedBubbleLines(raw: string): QuotedBubbleLine[] {
    const lines = String(raw ?? '').split(/(?:\r\n|\r|\n|\u2028|\u2029)+/);
    const result: QuotedBubbleLine[] = [];
    let pendingQuote: string | undefined;
    const quoteRe = /\[\[\s*QUOTE\s*[:：]\s*([\s\S]*?)\]\]/gi;

    for (const rawLine of lines) {
        const matches = [...rawLine.matchAll(quoteRe)];
        if (matches.length > 0) {
            pendingQuote = matches[matches.length - 1][1].trim() || undefined;
        }
        const content = rawLine.replace(quoteRe, '').trim();
        if (!content) continue;
        result.push({ content, ...(pendingQuote ? { quoteSnippet: pendingQuote } : {}) });
        pendingQuote = undefined;
    }
    return result;
}

/** 剥掉 markdown 代码围栏（```json / ```yaml / ``` 等），LLM 很爱裹这个 */
const stripFences = (raw: string): string =>
    String(raw ?? '')
        .replace(/```[a-zA-Z]*\r?\n?/g, '')
        .replace(/```/g, '')
        .trim();

/** 逐字段规整导演动作：charId 强转 string，content 非 string 时兜底转换，空的丢弃 */
const normalizeAction = (a: any): DirectorAction | null => {
    if (!a || typeof a !== 'object') return null;
    const charId = a.charId == null ? '' : String(a.charId).trim();
    const content = (typeof a.content === 'string' ? a.content : String(a.content ?? '')).trim();
    if (!charId || !content) return null;
    return { charId, content };
};

/**
 * 解析导演模式输出的 JSON 动作数组。
 * 第一层（严格）：剥围栏 → 截取最外层 [ ... ] → JSON.parse 整体。
 * 第二层（宽松）：正则逐个抠出含 "charId" 的对象逐个 parse，能救一个是一个。
 * 两层皆空时返回 []，由调用方决定是否提示用户。
 */
export function parseDirectorActions(raw: string): DirectorAction[] {
    const text = stripFences(raw);
    if (!text) return [];

    const first = text.indexOf('[');
    const last = text.lastIndexOf(']');
    if (first !== -1 && last > first) {
        try {
            const arr = JSON.parse(text.substring(first, last + 1));
            if (Array.isArray(arr)) {
                const normalized = arr.map(normalizeAction).filter((a): a is DirectorAction => a !== null);
                if (normalized.length > 0) return normalized;
            }
        } catch { /* 掉进第二层 */ }
    }

    const objMatches = text.match(/\{[^{}]*?["']charId["'][\s\S]*?\}/g) || [];
    const rescued: DirectorAction[] = [];
    for (const m of objMatches) {
        try {
            const action = normalizeAction(JSON.parse(m));
            if (action) rescued.push(action);
        } catch { /* 这个对象坏了，跳过它救别的 */ }
    }
    return rescued;
}

/**
 * [[SKIP]] 输出剥离：常规发言位不教这个标记（轮到谁谁就得说点什么），
 * 但「圆桌接力」的 callback 位会显式教它——被点名者有权不理。
 * 模型吐出 [[SKIP]] 或空内容，剥净后没剩正文 = 本轮跳过该成员。
 */
export function stripSkipMarker(raw: string): { skipped: boolean; content: string } {
    const content = stripFences(raw).replace(/\[\[\s*SKIP\s*\]\]/gi, '').trim();
    return { skipped: content === '', content };
}

export interface HandoffParsed {
    /** 被点名者的名字（未点名 = null）；还需经 matchHandoffName 落到真实成员上 */
    target: string | null;
    /** 剥净标记后的正文 */
    content: string;
}

/**
 * 名字规整：模型爱把点名写成 `[[TO: @小北]]`、`[[TO: 「小北」]]`、`[[TO: 小北。]]`，
 * 这里把 @ 前缀、各式引号和尾部标点削掉，只留干净名字。
 */
const normalizeHandoffName = (raw: string): string =>
    String(raw ?? '')
        .trim()
        .replace(/^[@＠]+/, '')
        .replace(/^["'“”‘’「」『』《》\s]+|["'“”‘’「」『』《》\s]+$/g, '')
        .replace(/[。，,.!！?？;；:：、~～]+$/, '')
        .trim();

/**
 * 解析「圆桌接力」点名标记 [[TO: 名字]]。
 *
 * 只认第一个标记——模型偶尔会一口气点两个人，多余的一律无视（回合上界由调度层锁死，
 * 但这里也不给它多塞的机会）。标记必须剥干净：不剥的话它会作为独立一行进 DB，
 * 群里就会冒出一个写着 `[[TO: 小北]]` 的气泡。
 *
 * 名字限死 40 字符且不跨行，避免模型输出没闭合的 `[[TO:` 时把后面整段正文吞掉。
 */
export function parseHandoff(raw: string): HandoffParsed {
    const text = String(raw ?? '');
    const first = text.match(/\[\[\s*TO\s*[:：]\s*([^\]\n]{1,40}?)\s*\]\]/i);
    const name = first ? normalizeHandoffName(first[1]) : '';
    const content = text
        .replace(/\[\[\s*TO\s*[:：]\s*[^\]\n]{0,40}?\s*\]\]/gi, '')
        .replace(/[ \t]+$/gm, '')   // 标记在行尾时留下的尾随空格
        .replace(/\n{3,}/g, '\n\n') // 标记独占一行时留下的空行
        .trim();
    return { target: name || null, content };
}

/**
 * 把 [[TO:]] 里的名字落到真实成员上。三层匹配，逐层放宽：
 * 精确 → 忽略大小写与空格 → 互相包含（模型写"小北北"或只写"北"都能兜住）。
 * 匹配不到返回 null —— 宁可不接力，也不能点错人。
 */
export function matchHandoffName<T extends { id: string; name: string }>(
    target: string | null,
    candidates: T[],
): T | null {
    const q = normalizeHandoffName(target ?? '');
    if (!q || candidates.length === 0) return null;

    const exact = candidates.find(c => c.name === q);
    if (exact) return exact;

    const fold = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const folded = fold(q);
    const ci = candidates.find(c => fold(c.name) === folded);
    if (ci) return ci;

    // 包含匹配容易误伤（"北"既像"北极星"又像"小北"），只在唯一命中时才认
    const loose = candidates.filter(c => {
        const n = fold(c.name);
        return n.includes(folded) || folded.includes(n);
    });
    return loose.length === 1 ? loose[0] : null;
}

/**
 * 气泡行数上限截断：提示词给的是"目标行数"，但模型经常不听，一激动能吐十几行刷屏。
 * 下限不管——少说两句本来就自然，多说一堆才出戏。
 *
 * 空行不计数（只是排版），超限后连同尾部空行一起丢弃。
 * 含 [html] 卡片时整段放行：HTML 是多行结构，按行砍会把卡片拦腰截成一堆碎标签。
 */
export function clampBubbleLines(content: string, maxLines = 8): string {
    const text = String(content ?? '');
    if (!text) return '';
    if (/\[html/i.test(text)) return text;

    const lines = text.split('\n');
    const kept: string[] = [];
    let spoken = 0;
    for (const line of lines) {
        if (line.trim() === '') {
            if (spoken > 0 && spoken < maxLines) kept.push(line);
            continue;
        }
        if (spoken >= maxLines) break;
        kept.push(line);
        spoken++;
    }
    return kept.join('\n').trim();
}

export interface GroupTopicBoxParsed {
    title: string;
    summary: string;
}

/**
 * 解析「群公共话题盒」总结输出：提示词要求模型只吐 {"title","summary"} 的 JSON，
 * 但实际返回常常掉格式（summary 里带裸换行 / 未转义引号、外面裹一层 ```json、
 * 推理模型先来一段 <think>…</think>）。旧版 parseTopicBoxResponse 只做严格 JSON.parse，
 * 一旦 parse 失败就整轮报「总结格式无法解析」并抛错——而这会让
 * archivedThroughMessageId 永远推进不了，热区以前的消息越堆越多（用户实测卡到 649 条），
 * 归档队列被一条坏输出永久堵死。这里按家规做三层容错，宁可给个粗糙总结也绝不卡住队列。
 *
 * 第一层（严格）：剥围栏 / <think> 后，整体 or 最外层 {…} 直接 JSON.parse。
 * 第二层（宽松）：JSON 坏在字符串里的裸换行——直接正则抠 title / summary 字段值（允许含换行）。
 * 第三层（兜底）：模型压根没给结构，只要有实质文本，整段当 summary 用（截断防超长）。
 * 三层皆空返回 null，由调用方决定是否提示用户。
 */
export function parseGroupTopicBox(raw: string): GroupTopicBoxParsed | null {
    const text = String(raw ?? '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '') // 推理模型的思考块，会把 JSON 冲垮
        .replace(/```[a-zA-Z]*\r?\n?/g, '')
        .replace(/```/g, '')
        .trim();
    if (!text) return null;

    const fromObj = (p: any): GroupTopicBoxParsed | null => {
        if (!p || typeof p !== 'object') return null;
        const summary = p.summary == null ? '' : String(p.summary).trim();
        if (!summary) return null;
        const title = p.title == null ? '' : String(p.title).trim();
        return { title: title || '一段群聊回忆', summary };
    };

    // 第一层：整体 JSON，或截取最外层 {…} 再 parse
    try {
        const hit = fromObj(JSON.parse(text));
        if (hit) return hit;
    } catch { /* 掉进下一层 */ }
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
        try {
            const hit = fromObj(JSON.parse(text.slice(braceStart, braceEnd + 1)));
            if (hit) return hit;
        } catch { /* 掉进下一层 */ }
    }

    // 第二层：JSON 结构坏了，直接抠字段值（[\s\S] 容忍值里的裸换行）。
    // summary 抠到闭合引号后紧跟的 , / } / 文末为止。
    const summaryMatch = text.match(/["']?summary["']?\s*[:：]\s*["']([\s\S]*?)["']\s*(?:[,，}]|$)/i);
    if (summaryMatch && summaryMatch[1].trim()) {
        const titleMatch = text.match(/["']?title["']?\s*[:：]\s*["']([\s\S]*?)["']\s*(?:[,，}]|$)/i);
        return {
            title: (titleMatch?.[1] || '').trim() || '一段群聊回忆',
            summary: summaryMatch[1].trim(),
        };
    }

    // 第三层：完全没结构，但有实质文本——整段当总结用，好过永久卡死归档队列
    const plain = text.replace(/^[{[]+/, '').replace(/[}\]]+$/, '').trim();
    if (plain.length >= 10) {
        return { title: '一段群聊回忆', summary: plain.length > 800 ? `${plain.slice(0, 800)}…` : plain };
    }
    return null;
}

/**
 * 解析群总结输出里的 summary 字段。
 * 第一层（严格）：剥围栏后匹配 `summary:` + 引号闭合配对（或裸值取到文末）。
 * 第二层（宽松）：剥 `summary:` 前缀、剥首尾引号，取全文 trim——
 * 模型没按 YAML 输出时，整段就当总结正文用。
 */
export function parseSummaryYaml(raw: string): string {
    const text = stripFences(raw);
    if (!text) return '';

    const quoted = text.match(/(?:^|\n)\s*summary\s*[:：]\s*(["'])([\s\S]*?)\1\s*(?:\n|$)/i);
    if (quoted && quoted[2].trim()) return quoted[2].trim();

    const bare = text.match(/(?:^|\n)\s*summary\s*[:：]\s*([\s\S]+)$/i);
    const candidate = bare ? bare[1] : text;
    return candidate
        .replace(/^summary\s*[:：]\s*/i, '')
        .trim()
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .trim();
}
