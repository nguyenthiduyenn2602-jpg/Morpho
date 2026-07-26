/**
 * 全局 API 调用记录（给 设置 → API 调用记录 页面用）。
 *
 * 设计：项目里 LLM 调用分两类——走 `utils/safeApi.ts` 的 `safeFetchJson` 的，和
 * 各 App 自己写的裸 `fetch`（TRPG / 自习室 / 群聊 / 日记…）。为了一个都不漏，记录点
 * 放在 `OSContext` 里那个全局 `fetch` monkey-patch 上：所有 `/chat/completions`
 * （含 safeFetchJson 内部 fetch）都经过它，统一调 `recordApiCall`，不重复计。
 *
 * 「时间 / 哪个 API / 哪个模型 / token」从请求体 + 响应里自动解析；「哪个 App / 哪个
 * 角色 / 具体用途」靠两条来源：
 *   1. 显式 meta —— safeFetchJson 调用点通过第 5 个参数传，挂到 RequestInit 的
 *      `__sullyMeta` 上由拦截器读取（精确，含 purpose）。
 *   2. 环境兜底 ambientMeta —— OSContext 在切 App / 角色时写入「当前在哪个 App、
 *      当前角色」，裸 fetch 没有显式 meta 时用它兜底标 App / 角色。
 *
 * 只保留近 5 天，超期在 DB 层写入时丢弃。recordApiCall 是 best-effort：任何异常都
 * 吞掉，绝不影响主请求链路。
 */

/** 调用方可补充的语义信息（哪个 App / 角色 / 用途）。能填多少填多少。 */
export interface ApiCallMeta {
    /** AppID 字符串，如 'chat' / 'lifesim'，可空 */
    appId?: string;
    /** App 显示名，如 '消息' / '记忆宫殿'，列表里直接展示这个 */
    appName?: string;
    /** 角色 id，可空 */
    charId?: string;
    /** 角色名，可空 */
    charName?: string;
    /** 具体用途，如 '聊天回复' / '情绪评估' / '记忆提取'，可空 */
    purpose?: string;
}

/** 落库的一条记录。 */
export interface ApiCallLogEntry extends ApiCallMeta {
    id: string;
    /** 调用发起（实际是响应回来）时间戳 ms */
    timestamp: number;
    /** 命中的预设名；匹配不到时回退成 baseUrl 的 host */
    presetName: string;
    baseUrl: string;
    model: string;
    /**
     * 响应侧自报的模型（response.model）——实际服务这次请求的后端身份。
     * 中转的渠道名（如 `[千岛-自营]xxx`）只锁"店面"，上游内部降级/轮询时对外模型名
     * 不变，但后端会在响应里自报真身（如 `[逆-V]xxx-c`）。请求名 ≠ 自报名时，
     * 这个字段就是"被换后端了"的直接证据。拿不到（响应无 model 字段）则空。
     */
    backendModel?: string;
    /** HTTP 状态码（成功 / 失败均记，失败时可能是最后一次的状态） */
    status?: number;
    /** 请求是否成功拿到 JSON */
    ok: boolean;
    /** 输入 token（prompt_tokens），来自响应 usage，拿不到则空 */
    promptTokens?: number;
    /** 输出 token（completion_tokens） */
    completionTokens?: number;
    /** 总 token（total_tokens） */
    totalTokens?: number;
    /** 请求从发起到响应 / 报错的耗时 ms（NetworkError 类失败时 = 等了多久才断） */
    durationMs?: number;
    /**
     * 输入构成统计（每块的名字 + 字符数），回答「prompt_tokens 为什么这么大」。
     * 只存统计不存原文（原文一条就几十 KB，5 天日志会撑爆存储）；在响应回来后的
     * fire-and-forget 记录路径里扫一遍请求体算出，不占请求主链路。
     */
    promptBreakdown?: PromptBlockStat[];
}

/** 输入构成里的一块：system prompt 的一个 ### 段落，或聚合后的聊天历史。 */
export interface PromptBlockStat {
    /** 块名：### 标题 / [System: …] 行 / 无标题时取首行摘要；历史消息聚合成「聊天历史·×N」 */
    label: string;
    /** 该块字符数（含标题行与换行） */
    chars: number;
}

const PRESETS_STORAGE_KEY = 'os_api_presets';

/**
 * 环境上下文（兜底用）：很多 App 走的是裸 fetch，调用点无法/来不及传 meta。
 * OSContext 会在切换 App / 角色时把「当前在哪个 App、当前角色是谁」写到这里，
 * 全局 fetch 拦截器记录裸 fetch 调用时拿它当兜底标签。
 * 注意：safeFetchJson 传了显式 meta 的调用以显式 meta 为准，不用兜底（避免后台
 * 任务被误标成用户当前所在的 App）。
 */
let ambientMeta: ApiCallMeta = {};

export function setApiCallAmbientContext(meta: ApiCallMeta): void {
    ambientMeta = meta || {};
}

/** Snapshot the current fallback context when a request starts. */
export function getApiCallAmbientContext(): ApiCallMeta {
    return { ...ambientMeta };
}

function hasMeta(meta?: ApiCallMeta): boolean {
    return !!meta && Object.values(meta).some((v) => v != null && v !== '');
}

function stripTrailingSlash(s: string): string {
    return s.replace(/\/+$/, '');
}

/** 把 `https://host/v1/chat/completions` 还原成 `https://host/v1`（预设里存的 baseUrl 形态）。 */
function deriveBaseUrl(url: string): string {
    return stripTrailingSlash(url.replace(/\/chat\/completions\/?$/i, ''));
}

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/**
 * 模型名的"核心名"：剥掉渠道标签（[方括号]、(半角圆括号)、（全角圆括号））、
 * 去空白、统一小写。用于判断「请求名 vs 后端自报名」是不是同一个模型——
 * `(按次)gemini-3.1-pro-preview` 和 `gemini-3.1-pro-preview` 是同一个（只是渠道标签），
 * `gemini-3.1-pro-preview` 和 `gemini-3.1-pro-preview-c` 才是真的换了后端。
 */
/**
 * 已知模型家族开头（gemini-…/gpt-…/claude-…）。渠道前缀的花样穷举不完，
 * 但家族名是个短且稳定的清单——把它当锚点：名字开头若不是家族名、且剥掉
 * 一段裸前缀（`gcli-` / `vertex-ai/`）后就是，则认定那段是渠道标签。
 * 这样「两头贴了不同裸前缀」（gcli-X vs vertex-X）也能对上核心名。
 */
const MODEL_FAMILY_RE = /^(gemini|gemma|gpt|chatgpt|o\d|claude|deepseek|qwen|qwq|glm|llama|grok|kimi|moonshot|mistral|mixtral|doubao|hunyuan|minimax|ernie|command|nova|phi)[-_.\d]/i;

function stripBareChannelPrefixes(s: string): string {
    let cur = s;
    // 最多剥 3 层（渠道套渠道），每刀都必须让剩余部分以已知家族名开头才算数
    for (let i = 0; i < 3; i++) {
        if (MODEL_FAMILY_RE.test(cur)) return cur;
        // 非贪婪取最短首段：'chatgpt-4o' 不会被误劈成 'chatgpt-4o' + …
        const m = cur.match(/^[a-z0-9_.]{1,24}?[-/](.+)$/i);
        if (!m || !MODEL_FAMILY_RE.test(m[1])) return cur;
        cur = m[1];
    }
    return cur;
}

export function coreModelName(m: string): string {
    const stripped = (m || '')
        .replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）/g, '')
        .replace(/\s+/g, '')
        .toLowerCase();
    return stripBareChannelPrefixes(stripped);
}

/**
 * 「请求的模型」和「后端自报的模型」是否应视为同一个（＝不该报琥珀 ⚠️）。
 *
 * 贩子的渠道标签格式穷举不完（[方括号]、(按次)、gcli- 裸前缀…），所以不枚举格式，
 * 改用方向性判定——核心名归一后：
 *   - 完全相等 → 同一个
 *   - 一方是另一方**去掉开头一截**的结果（endsWith）→ 同一个。
 *     覆盖两个方向：请求带渠道前缀（gcli-X ↔ X）、后端带路径/前缀（X ↔ models/X）。
 *     「开头多一截」只是运营商贴标签，不改变模型本体。
 *   - 其余（尤其**尾巴多一截**：X ↔ X-c / X-lite）→ 不同。缩水变体都长在尾巴上，
 *     这正是要抓的降级信号，绝不放行。
 * 短名（<8 字符）不做 endsWith 宽容，防止病态短串误匹配。
 */
export function isSameCoreModel(requested: string, backend: string): boolean {
    const a = coreModelName(requested);
    const b = coreModelName(backend);
    if (!a || !b) return true;   // 有一方空：无从比较，不报警
    if (a === b) return true;
    const shorter = a.length < b.length ? a : b;
    if (shorter.length < 8) return false;
    return a.endsWith(b) || b.endsWith(a);
}

/** 从请求体里抠出 model 字段（body 可能是 JSON 字符串或对象）。 */
function extractModel(body: unknown): string {
    if (!body) return '';
    let parsed: any = body;
    if (typeof body === 'string') {
        try { parsed = JSON.parse(body); } catch { return ''; }
    }
    return typeof parsed?.model === 'string' ? parsed.model : '';
}

/**
 * 用 baseUrl + model 在用户保存的预设里反查预设名（截图里的「奇异果 / 铃兰 / 千岛2」那些）。
 * 预设结构见 types.ts ApiPreset：{ id, name, config: { baseUrl, apiKey, model } }。
 * 匹配不到（比如用的是没存成预设的临时配置）就回退成 host。
 */
function resolvePresetName(baseUrl: string, model: string): string {
    try {
        if (typeof localStorage === 'undefined') return hostOf(baseUrl);
        const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
        if (!raw) return hostOf(baseUrl);
        const presets = JSON.parse(raw);
        if (!Array.isArray(presets)) return hostOf(baseUrl);
        const normBase = stripTrailingSlash(baseUrl);
        // 优先 baseUrl + model 都对上；退而求其次只对 baseUrl
        const exact = presets.find((p: any) =>
            stripTrailingSlash(p?.config?.baseUrl || '') === normBase &&
            (p?.config?.model || '') === model);
        if (exact?.name) return exact.name;
        const byBase = presets.find((p: any) =>
            stripTrailingSlash(p?.config?.baseUrl || '') === normBase);
        if (byBase?.name) return byBase.name;
        return hostOf(baseUrl);
    } catch {
        return hostOf(baseUrl);
    }
}

/**
 * 记录一次 API 调用。fire-and-forget，绝不 throw / 阻塞主链路。
 * 在 safeFetchJson 里对 `/chat/completions` 的成功与失败都会调用。
 */
/** 从 OpenAI 兼容响应里抠 usage（各家代理大多遵循这个字段）。 */
function extractUsage(response: unknown): { prompt?: number; completion?: number; total?: number } {
    const usage = (response as any)?.usage;
    if (!usage || typeof usage !== 'object') return {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return {
        prompt: num(usage.prompt_tokens),
        completion: num(usage.completion_tokens),
        total: num(usage.total_tokens),
    };
}

/**
 * SSE 流式响应文本的兜底解析：扫 `data: {...}` 行，抠后端自报 model（首个非空）
 * 和 usage（取最后一个非空，OpenAI 约定 usage 在末尾 chunk）。
 * 拦截器 clone 出的流式响应 JSON.parse 必然失败，之前流式调用在记录里
 * 既没有 token 数也没有后端身份——这里补上。
 */
export function scanSseForLog(text: string): { model?: string; usage?: unknown } {
    let model: string | undefined;
    let usage: unknown;
    for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk: any;
        try { chunk = JSON.parse(payload); } catch { continue; }
        if (!model && typeof chunk?.model === 'string' && chunk.model) model = chunk.model;
        if (chunk?.usage && typeof chunk.usage === 'object') usage = chunk.usage;
    }
    return { model, usage };
}

// ── 输入构成统计（promptBreakdown） ──────────────────────────────────────

/** 多模态 content 摊平成可计数文本（图片按占位符计，与 emotion eval 的展平口径一致）。 */
function contentToText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((part: any) => {
            if (part?.type === 'text') return part.text || '';
            if (part?.type === 'image_url') return '[图片]';
            return '';
        }).filter(Boolean).join(' ');
    }
    if (content == null) return '';
    try { return JSON.stringify(content) ?? ''; } catch { return String(content); }
}

const BLOCK_LABEL_MAX = 40;

/** 行是块头？返回块名（`## / ### 标题` 或 `[System: …]`），否则 null。 */
const matchBlockHeader = (line: string): string | null => {
    const m = line.match(/^\s*#{2,3}\s+(.+?)\s*$/) || line.match(/^\s*(\[System:[^\]]*\])/);
    return m ? m[1].trim() : null;
};

/**
 * 计算哪些行是有效的 ``` 围栏开合线。围栏必须**成对**才生效：用户数据（记忆
 * 摘要等）里落单的半个 ``` 会把围栏状态永久翻转，后面所有块头全被吞进上一块
 * （实测：62K 的「记忆系统」行吞掉了对话历史+评估框架）。奇数个时最后一个不算。
 */
function fenceToggleLines(lines: string[]): Set<number> {
    const indices: number[] = [];
    lines.forEach((line, i) => { if (/^\s*```/.test(line)) indices.push(i); });
    if (indices.length % 2 === 1) indices.pop();
    return new Set(indices);
}

/**
 * 把一条 system 消息按块头切开。``` 围栏内的行不算块头——行为规范里的日记
 * 示例（`## 今天的小确幸` 等）都在代码块里，不加围栏感知会被误切成独立块。
 * 一个块头都没有的短消息（双语 / MCP 尾部提醒等）整条算一块，取首行当名字。
 */
function splitSystemBlocks(text: string): PromptBlockStat[] {
    const out: PromptBlockStat[] = [];
    let label = '（开头·未分块部分）';
    let chars = 0;
    let sawHeader = false;
    let inFence = false;
    const lines = text.split('\n');
    const fenceAt = fenceToggleLines(lines);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (fenceAt.has(i)) inFence = !inFence;
        const header = inFence ? null : matchBlockHeader(line);
        if (header) {
            if (chars > 0) out.push({ label, chars });
            label = header.slice(0, BLOCK_LABEL_MAX);
            chars = line.length + 1;
            sawHeader = true;
        } else {
            chars += line.length + 1;
        }
    }
    if (chars > 0) out.push({ label, chars });
    if (!sawHeader && out.length === 1) {
        const firstLine = text.trimStart().split('\n', 1)[0] || '(空 system)';
        out[0] = { ...out[0], label: firstLine.slice(0, BLOCK_LABEL_MAX) };
    }
    return out;
}

/**
 * 已知的「写死的固定骨架」块名前缀（规则/格式/钢印类，内容不随用户数据变化）。
 * 构成面板的展示层把命中的块合并成一行「固定提示词」，突出真正能优化的数据块。
 * 新增固定提示词块时记得把块头加进来（漏加只是显示散一点，无功能影响）。
 */
const FIXED_PROMPT_LABEL_PREFIXES = [
    '聊天 App 行为规范',
    '表达底线',
    '🎤 语音消息功能',
    '关于对方的表达',
    '最后，回到你自己',
    '【音乐互动工具】',
    '关于《彼方》',
    '[MCP 工具 ON',
    '[Reminder:',
    // 思考链提示词（thinkingChainPrompt.ts）的章节头
    '语言铁律',
    '你不是在演',
    '起点:你本来在干嘛',
    '同时被激活的多个东西',
    '别急着安慰',
    '别造谣',
    '温度:脑内比嘴上更吵',
    'Thinking 写法总则',
];

export const isFixedPromptBlockLabel = (label: string): boolean =>
    FIXED_PROMPT_LABEL_PREFIXES.some(prefix => label.startsWith(prefix));

const MAX_BREAKDOWN_BLOCKS = 48;

/**
 * 从 chat/completions 请求体算输入构成。解析不了 / 没有 messages 时返回 undefined。
 * system 逐块统计，历史消息按角色聚合（用户只关心"内置注入哪块肥"，不关心第几条历史）。
 */
export function buildPromptBreakdown(body: unknown): PromptBlockStat[] | undefined {
    try {
        let parsed: any = body;
        if (typeof body === 'string') {
            try { parsed = JSON.parse(body); } catch { return undefined; }
        }
        const messages = parsed?.messages;
        if (!Array.isArray(messages) || messages.length === 0) return undefined;

        const out: PromptBlockStat[] = [];
        let userChars = 0, userCount = 0, asstChars = 0, asstCount = 0, otherChars = 0, otherCount = 0;
        // 情绪评估等路径把「完整 system prompt + 展平历史 + 任务说明」整个打包成一条
        // user 消息发送——不拆的话构成面板只会显示「用户消息 ×1 · 100%」，看不出内里。
        // 巨型且含多个块头的 user 消息按 system 同款规则拆块；普通聊天消息不受影响。
        const HUGE_USER_MSG_SPLIT_CHARS = 8000;
        const countBlockHeaders = (text: string): number => {
            let n = 0, inFence = false;
            const lines = text.split('\n');
            const fenceAt = fenceToggleLines(lines);
            for (let i = 0; i < lines.length; i++) {
                if (fenceAt.has(i)) inFence = !inFence;
                if (!inFence && matchBlockHeader(lines[i])) n++;
            }
            return n;
        };
        for (const msg of messages) {
            const text = contentToText(msg?.content);
            if (msg?.role === 'system') {
                out.push(...splitSystemBlocks(text));
            } else if (msg?.role === 'user') {
                if (text.length > HUGE_USER_MSG_SPLIT_CHARS && countBlockHeaders(text) >= 2) {
                    out.push(...splitSystemBlocks(text));
                } else {
                    userChars += text.length; userCount++;
                }
            } else if (msg?.role === 'assistant') {
                asstChars += text.length; asstCount++;
            } else {
                otherChars += text.length; otherCount++;
            }
        }
        if (userCount) {
            // 记忆提取/日程生成/查手机等大量调用点是「单条 user 提示词」形态——
            // 标成"聊天历史"纯属误导，改用首行摘要让人一眼看出是什么任务。
            const soloPrompt = messages.length === 1 && userCount === 1;
            const firstLine = soloPrompt
                ? (contentToText(messages[0]?.content).trimStart().split('\n', 1)[0] || '').slice(0, BLOCK_LABEL_MAX)
                : '';
            out.push(soloPrompt
                ? { label: `提示词整体「${firstLine}」`, chars: userChars }
                : { label: `聊天历史·用户消息 ×${userCount}`, chars: userChars });
        }
        if (asstCount) out.push({ label: `聊天历史·角色消息 ×${asstCount}`, chars: asstChars });
        if (otherCount) out.push({ label: `其他消息（tool 等）×${otherCount}`, chars: otherChars });
        if (out.length === 0) return undefined;

        // 限容：病态多块时合并尾巴，保证单条记录体积可控
        if (out.length > MAX_BREAKDOWN_BLOCKS) {
            const head = out.slice(0, MAX_BREAKDOWN_BLOCKS - 1);
            const restChars = out.slice(MAX_BREAKDOWN_BLOCKS - 1).reduce((sum, b) => sum + b.chars, 0);
            head.push({ label: `（其余 ${out.length - (MAX_BREAKDOWN_BLOCKS - 1)} 块合计）`, chars: restChars });
            return head;
        }
        return out;
    } catch {
        return undefined;
    }
}

export function recordApiCall(input: {
    url: string;
    body?: unknown;
    status?: number;
    ok: boolean;
    response?: unknown;
    /** 响应原始文本（JSON.parse 失败时传入，供 SSE 兜底解析 model / usage） */
    responseText?: string;
    meta?: ApiCallMeta;
    durationMs?: number;
}): void {
    try {
        const baseUrl = deriveBaseUrl(input.url);
        const model = extractModel(input.body);
        // 显式 meta 优先（safeFetchJson 各调用点传的精确信息）；没有就用环境兜底（裸 fetch）。
        const meta = hasMeta(input.meta) ? input.meta! : ambientMeta;
        // 整包 JSON 直接读；流式响应（response 为空但有原始文本）走 SSE 兜底扫描
        let responseForExtract: unknown = input.response;
        let backendModel: string | undefined =
            typeof (input.response as any)?.model === 'string' && (input.response as any).model
                ? (input.response as any).model : undefined;
        if (input.response === undefined && typeof input.responseText === 'string' && input.responseText.trimStart().startsWith('data:')) {
            const scanned = scanSseForLog(input.responseText);
            backendModel = scanned.model;
            if (scanned.usage) responseForExtract = { usage: scanned.usage };
        }
        const usage = extractUsage(responseForExtract);
        const entry: ApiCallLogEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            presetName: resolvePresetName(baseUrl, model),
            baseUrl,
            model,
            backendModel,
            status: input.status,
            ok: input.ok,
            promptTokens: usage.prompt,
            completionTokens: usage.completion,
            totalTokens: usage.total,
            durationMs: input.durationMs,
            promptBreakdown: buildPromptBreakdown(input.body),
            appId: meta.appId,
            appName: meta.appName,
            charId: meta.charId,
            charName: meta.charName,
            purpose: meta.purpose,
        };
        // 动态 import 避开 safeApi ↔ db 的潜在加载顺序问题；写库失败静默吞掉。
        import('./db')
            .then(({ DB }) => DB.appendApiCallLog(entry))
            .catch(() => {});
    } catch {
        // best-effort：任何异常都不影响主请求
    }
}
