/**
 * 通用 MCP → 聊天工具循环 的桥接层（对标 luckinToolBridge 的角色分工）
 *
 * 职责：
 * 1. 把所有启用 MCP 服务器的已发现工具聚合成 OpenAI function-calling 格式
 * 2. 处理跨服务器工具重名 / OpenAI 工具名字符限制（暴露名 ↔ 真实工具映射）
 * 3. 生成注入 systemPrompt 的说明块
 * 工具循环本体在 hooks/useChatAI.ts（对标 luckinChat 循环）。
 */

import { getEnabledMcpServers, type McpServerConfig, type McpToolDef } from './mcpClient';

export interface OpenAIMcpTool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: any;
    };
}

export interface ResolvedMcpTool {
    server: McpServerConfig;
    toolName: string;
}

// OpenAI 工具名只允许 [A-Za-z0-9_-]，最长 64；MCP 工具名可能带点号等
const sanitizeToolName = (name: string): string =>
    (name || 'tool').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'tool';

const serverSlug = (server: McpServerConfig): string =>
    sanitizeToolName(server.name).slice(0, 20) || 'srv';

/**
 * 聚合启用服务器的工具，返回 OpenAI 工具数组 + 暴露名→真实工具 的映射。
 * 暴露名默认用工具原名（sanitize 后）；跨服务器重名时后者加 <服务器名>_ 前缀。
 * charId：只聚合对该角色可见的服务器（通用 + 绑定了该角色的）。
 */
export const buildMcpOpenAITools = (charId?: string): { tools: OpenAIMcpTool[]; resolve: Map<string, ResolvedMcpTool> } => {
    const tools: OpenAIMcpTool[] = [];
    const resolve = new Map<string, ResolvedMcpTool>();
    const servers = getEnabledMcpServers(charId);
    for (const server of servers) {
        for (const t of server.tools || []) {
            let exposed = sanitizeToolName(t.name);
            if (resolve.has(exposed)) {
                exposed = sanitizeToolName(`${serverSlug(server)}_${t.name}`);
                let i = 2;
                while (resolve.has(exposed)) exposed = sanitizeToolName(`${serverSlug(server)}_${t.name}_${i++}`);
            }
            resolve.set(exposed, { server, toolName: t.name });
            tools.push({
                type: 'function',
                function: {
                    name: exposed,
                    description: buildToolDescription(server, t, servers.length > 1),
                    parameters: t.inputSchema || { type: 'object', properties: {} },
                },
            });
        }
    }
    return { tools, resolve };
};

const buildToolDescription = (server: McpServerConfig, t: McpToolDef, multi: boolean): string => {
    const desc = (t.description || '').trim();
    // 多服务器时在描述里带上来源，帮模型区分同类工具
    return multi ? `[${server.name}] ${desc}` : desc;
};

// ========== 工具结果回填 ==========

/**
 * MCP 结果（记忆检索、网页抓取等）体量远超瑞幸商品列表，1500 字符会把一条
 * 完整结果拦腰截断。上限放到 20000 只防病态超长结果炸上下文——工具循环每轮
 * 会全量重发消息，真有兆级 JSON 混进来会直接 4xx 或 token 起飞。
 */
export const MCP_RESULT_MAX_CHARS = 20000;

export const formatMcpToolResult = (data: any): string => {
    let s: string;
    try { s = typeof data === 'string' ? data : JSON.stringify(data); } catch { s = String(data); }
    return s.length > MCP_RESULT_MAX_CHARS
        ? `${s.slice(0, MCP_RESULT_MAX_CHARS)}…[结果过长已截断, 全文共 ${s.length} 字符]`
        : s;
};

// ========== 提示词 ==========

/**
 * MCP 工具模式的 systemPrompt 说明块。
 * 与瑞幸不同：这里的工具是用户自配的、内容未知，所以只讲纪律，不讲业务流程。
 * charId：只列对该角色可见的服务器，与 buildMcpOpenAITools 的过滤保持一致。
 */
export const buildMcpSystemBlock = (userName: string = '用户', charId?: string): string => {
    const servers = getEnabledMcpServers(charId);
    if (!servers.length) return '';
    const lines = servers.map(s => {
        const names = (s.tools || []).map(t => t.name).join('、');
        return `- ${s.name}: ${names}`;
    });
    return `

---
[外部工具已接入 —— ${userName} 在设置里给你连了 MCP 工具服务器]

**核心**: 你还是原来的角色、原来的语气、原来的记忆。工具只是你顺手能用的能力，**每轮都要有角色化的文字**，别干巴巴报结果。

可用工具来源:
${lines.join('\n')}

**使用纪律**:
- 需要时直接调工具（系统会自动执行并把结果给你），不需要时正常聊天，**别硬找理由调工具**。
- 工具必须通过系统的 function calling 接口发起，**绝对不要把工具名和参数写进聊天正文**（比如输出 \`工具名(参数)\` 这种文字），用户会看到乱码一样的东西。
- 工具结果只挑与对话相关的部分用角色语气转述，别整段复读 JSON。
- 工具失败就如实说，并根据报错调整参数重试或换个方式，别编造结果。
- 涉及真实世界副作用的操作（发布内容、下单、删除等），先跟 ${userName} 确认一句再动手。
---
`;
};

/** 尾部小提醒（注入 messages 末尾，防长对话把纪律冲掉） */
export const MCP_TAIL_REMINDER = `[MCP 工具 ON · 永远用角色语气回复别空回; 工具只能走 function calling 接口、严禁写成正文文字; 工具结果别复读 JSON; 有副作用的操作先确认再执行]`;

// ========== 掉格式容错: 正文里的"假工具调用" ==========
//
// 不支持 function calling 的模型（或被中转剥了 tools 参数的）看到系统块里的
// 工具清单后, 会把调用直接"演"在正文里, 常见形态:
//   ask_question("SullyOS")           ← 括号传参
//   ask_question: SullyOS             ← 冒号传参（整行）
//   get_weather({"city": "上海"})     ← 括号传 JSON
// 与见面观测协议同款思路的两层容错: FC 通道是第一层, 这里兜第二层。
// 只认已启用服务器的真实工具名（暴露名/原名都认）, 避免误伤普通文字。

export interface FakedMcpCall {
    exposedName: string;
    server: McpServerConfig;
    toolName: string;
    args: Record<string, any>;
    matched: string;
}

/** 从正文兼容调用中剥掉调用语法，只留下可以先展示给用户的角色文字。 */
export const stripTextFakedMcpCalls = (content: string, calls: FakedMcpCall[]): string => {
    let cleaned = content;
    for (const call of calls) cleaned = cleaned.split(call.matched).join('');
    return cleaned.replace(/\n{3,}/g, '\n\n').trim();
};

/**
 * MCP 工具前置气泡专用粗洗。该气泡在统一后处理之前落库，必须自行清掉模型
 * 复刻的历史外壳和思考标签；不能把“用户发送了表情包”反向变成角色消息。
 */
export const sanitizeMcpLeadInText = (raw: string): string => {
    let cleaned = raw || '';
    cleaned = cleaned.replace(/<(think|thinking|thought)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    cleaned = cleaned.replace(/<(?:think|thinking|thought)\b[^>]*>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<\/?(?:think|thinking|thought)\b[^>]*>/gi, '');
    cleaned = cleaned.replace(/\[(?:你|User|用户|System)\s*发送了表情包[:：]\s*.*?\]/gi, '');
    cleaned = cleaned.replace(/\[\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[^\]]*\]/g, '');
    cleaned = cleaned.replace(/\s*\[(?:聊天|通话|约会)\]\s*/g, '\n');
    return cleaned.replace(/\n{3,}/g, '\n\n').trim();
};

/**
 * 正文假调用已经由客户端代为执行，下一跳只负责把结果组织成角色回复。
 * 这里必须移除 tools；否则部分中转会在这一跳改走正规 tool_calls，返回空正文，
 * 而正规工具循环阶段已经结束，最终表现就是角色一直打字后不落消息。
 * 不支持 FC 的模型仍可继续输出正文假调用，并由同一兜底循环处理多步任务。
 */
export const buildMcpTextFallbackBody = (baseReqBody: any, messages: any[]): any => {
    const followBody = { ...baseReqBody, messages };
    delete followBody.tools;
    delete followBody.tool_choice;
    return followBody;
};

/** tools 被中转拒绝时，把最小 schema 仅作为本轮兼容说明交给正文调用兜底。 */
export const buildMcpRejectedToolsFallbackBody = (baseReqBody: any): any => {
    const followBody = buildMcpTextFallbackBody(baseReqBody, baseReqBody.messages || []);
    const signatures = (baseReqBody.tools || []).map((tool: any) => {
        const fn = tool?.function || {};
        const schema = fn.parameters || {};
        const required = new Set(Array.isArray(schema.required) ? schema.required : []);
        const args = Object.entries(schema.properties || {}).map(([name, def]: [string, any]) =>
            `${name}${required.has(name) ? '*' : ''}:${def?.type || 'any'}`,
        );
        const description = typeof fn.description === 'string' ? fn.description.trim() : '';
        return `- ${fn.name}(${args.join(', ')})${description ? `：${description}` : ''}`;
    }).filter(Boolean);
    followBody.messages = [...followBody.messages, {
        role: 'system',
        content: `[MCP 兼容模式：当前 API 中转拒绝 function calling 参数。必须根据下方工具的来源、描述和参数选择真正匹配用户意图的工具，禁止因为名字看起来通用就乱选。本轮如果需要工具，请只输出一行 tool_name({"参数":"值"})，系统会代为执行后把结果给你；没有收到系统返回前不要声称工具已经成功，也不要自行编造结果。* 表示必填参数。\n${signatures.join('\n')}]`,
    }];
    return followBody;
};

/** 部分 OpenAI 兼容中转不是忽略 tools，而是直接用 4xx 拒绝整次请求。 */
export const shouldRetryMcpWithoutTools = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error || '');
    return /(?:^|\D)(?:400|401|403|422)(?:\D|$)/.test(message);
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const stripQuotes = (s: string): string => {
    const t = s.trim();
    const m = t.match(/^(['"`「『])([\s\S]*)(['"`」』])$/);
    return m ? m[2] : t;
};

/** schema 的参数名顺序: required 优先, 其余按声明序 —— 用于位置参数落位 */
const positionalKeys = (schema: any): string[] => {
    const props = schema?.properties ? Object.keys(schema.properties) : [];
    const req = Array.isArray(schema?.required) ? schema.required.filter((k: string) => props.includes(k)) : [];
    return [...req, ...props.filter(k => !req.includes(k))];
};

const coerceBySchema = (value: string, schema: any, key: string): any => {
    const type = schema?.properties?.[key]?.type;
    const v = stripQuotes(value);
    if (type === 'number' || type === 'integer') {
        const n = Number(v);
        if (Number.isFinite(n)) return type === 'integer' ? Math.trunc(n) : n;
    }
    if (type === 'boolean') {
        if (/^(true|是|开)$/i.test(v)) return true;
        if (/^(false|否|关)$/i.test(v)) return false;
    }
    return v;
};

/** 顶层逗号切分（尊重引号与花括号嵌套） */
const splitTopLevel = (s: string): string[] => {
    const out: string[] = [];
    let depth = 0, cur = '', quote = '';
    for (const ch of s) {
        if (quote) {
            cur += ch;
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if (ch === '{' || ch === '[') depth++;
        if (ch === '}' || ch === ']') depth--;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
};

/** 把括号里的原始文本解析成 args 对象（JSON / kwargs / 位置参数三种形态） */
const parseFakedArgs = (inner: string, schema: any): Record<string, any> => {
    const t = inner.trim();
    if (!t) return {};
    // JSON 形态
    if (t.startsWith('{')) {
        try { return JSON.parse(t); } catch { /* 尝试宽松修复 */ }
        try {
            return JSON.parse(t
                .replace(/,\s*([}\]])/g, '$1')
                .replace(/'/g, '"')
                .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":'));
        } catch { /* 落回单参数 */ }
    }
    const parts = splitTopLevel(t);
    // kwargs 形态: key=value / key: value
    if (parts.every(p => /^\s*[A-Za-z_]\w*\s*[=:]/.test(p))) {
        const args: Record<string, any> = {};
        for (const p of parts) {
            const m = p.match(/^\s*([A-Za-z_]\w*)\s*[=:]\s*([\s\S]*)$/);
            if (m) args[m[1]] = coerceBySchema(m[2], schema, m[1]);
        }
        return args;
    }
    // 位置参数形态: 按 schema 声明顺序落位
    const keys = positionalKeys(schema);
    const args: Record<string, any> = {};
    parts.forEach((p, i) => {
        const key = keys[i];
        if (key) args[key] = coerceBySchema(p, schema, key);
    });
    return args;
};

/**
 * 从 AI 正文里提取"假工具调用"。只匹配 resolve 里已知的工具名（暴露名/真实名）。
 * 返回按出现位置排序、按 matched 文本去重的调用列表。
 */
export const extractTextFakedMcpCalls = (
    content: string,
    resolve: Map<string, ResolvedMcpTool>,
): FakedMcpCall[] => {
    if (!content || !resolve.size) return [];

    // 名字查找表: 暴露名和真实工具名都认（模型两种都可能写）
    const lookup = new Map<string, { exposed: string; hit: ResolvedMcpTool }>();
    for (const [exposed, hit] of resolve) {
        lookup.set(exposed, { exposed, hit });
        lookup.set(hit.toolName, { exposed, hit });
    }

    const found: Array<FakedMcpCall & { index: number }> = [];
    const seen = new Set<string>();

    for (const [name, { exposed, hit }] of lookup) {
        const schema = (hit.server.tools || []).find(t => t.name === hit.toolName)?.inputSchema;
        const esc = escapeRegExp(name);

        // 形态1: name(args) —— 前面不能是单词字符/点/斜杠（防止匹配到更长标识符的一部分）
        const parenRe = new RegExp(`(^|[^\\w./])${esc}\\s*\\(([^)]*)\\)`, 'g');
        for (const m of content.matchAll(parenRe)) {
            const matched = m[0].slice(m[1].length);
            const key = `${exposed}|${matched}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found.push({
                exposedName: exposed,
                server: hit.server,
                toolName: hit.toolName,
                args: parseFakedArgs(m[2], schema),
                matched,
                index: (m.index ?? 0) + m[1].length,
            });
        }

        // 形态2: 行首 name: 值 —— 限定行首, 避免误伤句中"提到"工具名的普通文字
        const colonRe = new RegExp(`(^|\\n)\\s*[>*-]*\\s*\`?${esc}\`?\\s*[:：]\\s*([^\\n]+)`, 'g');
        for (const m of content.matchAll(colonRe)) {
            const matched = m[0].slice(m[1].length);
            const key = `${exposed}|${matched.trim()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const keys = positionalKeys(schema);
            const value = stripQuotes(m[2].replace(/[。！？!?…\s]+$/, ''));
            found.push({
                exposedName: exposed,
                server: hit.server,
                toolName: hit.toolName,
                args: keys.length ? { [keys[0]]: coerceBySchema(value, schema, keys[0]) } : {},
                matched,
                index: (m.index ?? 0) + m[1].length,
            });
        }
    }

    return found
        .sort((a, b) => a.index - b.index)
        .map(({ index: _index, ...call }) => call);
};
