/**
 * 采样参数兼容层
 *
 * 背景：部分较新的模型已经废弃了 temperature / top_p / top_k 采样参数，请求里带上
 * 就直接 400。典型报错（OpenRouter 透传 Azure/Anthropic）：
 *   {"type":"invalid_request_error","message":"temperature is deprecated for this model."}
 *
 * 已知会因此 400 的模型：
 *   - Claude：Opus 4.7 / 4.8（及以上）、Sonnet 5（及以上）、Fable 5 / Mythos 5
 *   - OpenAI：gpt-5 系
 *   （o1/o3/o4 等推理模型也只接受默认 temperature，靠下面第 2 层兜底覆盖）
 *
 * 关键点：OpenRouter 会把 `anthropic/claude-opus-4.8` 路由到 Azure / Anthropic，
 * 这些 provider 同样拒收 temperature，所以「换 API / 换 OR」都没用——根因是**模型本身
 * 不收这个参数**，跟 key、上文长度、格式都无关。
 *
 * 兼容策略（在 fetch 统一出口做，覆盖全部 /chat/completions 调用点）：
 *   1) 发送前：识别到会废弃采样参数的模型，主动摘掉 temperature/top_p/top_k；
 *   2) 收到 400 且报文点名采样参数「deprecated / not supported」时，摘掉后重试一次。
 * 第 2 层是兜底：即便模型名没被第 1 层清单覆盖，也能自愈。
 */

const SAMPLING_KEYS = ['temperature', 'top_p', 'top_k'] as const;

/**
 * 该模型是否已废弃采样参数（带上会 400）。
 * model 为空 / 非字符串 / 未知时返回 false —— 默认保持原样，不误伤仍需要 temperature 的模型。
 */
export function modelRejectsSamplingParams(model: unknown): boolean {
    if (typeof model !== 'string' || !model) return false;
    const m = model.toLowerCase();

    // Claude 系：版本号里的分隔符可能是 . 或 -（claude-opus-4.8 / claude-opus-4-8 都有）
    if (/opus[-.\s]?4[-.\s]?(7|8|9)\b/.test(m)) return true;   // Opus 4.7 / 4.8 / 4.9
    if (/opus[-.\s]?(?:[5-9]|\d\d)\b/.test(m)) return true;    // Opus 5 及以上
    if (/sonnet[-.\s]?(?:[5-9]|\d\d)\b/.test(m)) return true;  // Sonnet 5 及以上
    if (/\b(?:fable|mythos)[-.\s]?\d/.test(m)) return true;    // Fable / Mythos

    // OpenAI gpt-5 系（gpt-5 / gpt-5-mini / gpt5 等）
    if (/\bgpt-?5/.test(m)) return true;

    return false;
}

/**
 * 从请求体里摘掉采样参数（就地修改）；返回是否真的删掉了东西。
 */
export function stripSamplingParams(body: Record<string, any>): boolean {
    if (!body || typeof body !== 'object') return false;
    let changed = false;
    for (const k of SAMPLING_KEYS) {
        if (k in body && body[k] !== undefined) {
            delete body[k];
            changed = true;
        }
    }
    return changed;
}

/**
 * 400 报文是否在抱怨采样参数（temperature / top_p / top_k 被废弃 / 不支持）。
 * 用来决定要不要摘掉采样参数重试一次。
 */
export function isSamplingParamError(responseText: string): boolean {
    if (!responseText) return false;
    const t = responseText.toLowerCase();
    const mentionsParam = /temperature|top_p|top_k/.test(t);
    const mentionsReject = /deprecat|not supported|unsupported|no longer supported|not allowed|isn'?t supported|not permitted|unexpected/.test(t);
    return mentionsParam && mentionsReject;
}
