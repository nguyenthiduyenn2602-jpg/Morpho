/**
 * 云端情绪评估的共用内核：占位符还原 + 副 API 请求 + 失败文案（先打码后截断）。
 *
 * 两个 worker（amsg 的即时对话路径、instant-push 的 Instant 路径）吃的是前端同一个
 * `buildEmotionEvalPrompt(..., includeContext=false, ...)` 模板，还原与请求逻辑必须
 * **逐字同款**——过去是两份手工同步的副本，d92231a 给报错加 apiKey 打码时只落了一份，
 * 另一份就把副 API key 随 push 带出去了。收敛到这一份叶子后，改哪条规则两边一起动。
 *
 * 零浏览器 / 零 worker 运行时依赖（两个 worker bundle 都会把这份代码打进去）。
 */

/** 副 API 凭据（没单独配就是主 API 那一份）。 */
export interface EmotionEvalApi { baseUrl: string; apiKey: string; model: string }

export const EMOTION_EVAL_SYSTEM_SLOT = '__EMOTION_EVAL_SYSTEM_PROMPT__';
export const EMOTION_EVAL_HISTORY_SLOT = '__EMOTION_EVAL_HISTORY__';

/** 单次评估请求的上限；副 API 卡住的话，主流程不该跟着一起被扣在这儿。 */
export const EMOTION_EVAL_TIMEOUT_MS = 120_000;

/**
 * 消息 content → 一行文本。结构化分段（带图片的消息）拍平成「文字 [图片]」。
 * 与本地 buildEmotionEvalPrompt 的 recentLines 同款：用空格连接、空段丢掉。
 */
export const flattenEvalContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (part?.type === 'text'
        ? (part.text || '')
        : (part?.type === 'image_url' ? '[图片]' : '')))
      .filter(Boolean)
      .join(' ');
  }
  return '';
};

/**
 * 把模板里的两个占位符用本次请求的消息还原掉。
 *
 * - `messages[0]`（role=system）= 本地的 mainSystemPrompt
 * - `messages[1..]` = 本地的 cleanedApiMessages，拼成 `[用户]: …` / `[角色名]: …` / `[系统]: …`
 *
 * 用函数式 replacer：system prompt 和对话里出现 `$&`、`$1` 这类字符时，
 * String.replace 会把它们当成替换模式解析，评估看到的就不是原话了。
 */
export const restoreEvalPrompt = (
  template: string,
  chatMessages: Array<{ role: string; content: unknown }>,
  charName: string,
): string => {
  const messages = Array.isArray(chatMessages) ? chatMessages : [];
  let systemPromptText = '';
  let conversation = messages;
  if (messages.length > 0 && messages[0]?.role === 'system') {
    systemPromptText = flattenEvalContent(messages[0].content);
    conversation = messages.slice(1);
  }
  const recentLines = conversation
    .map((m) => {
      const role = m.role === 'user' ? '用户' : (m.role === 'assistant' ? charName : '系统');
      return `[${role}]: ${flattenEvalContent(m.content)}`;
    })
    .join('\n');
  return String(template)
    .replace(EMOTION_EVAL_SYSTEM_SLOT, () => systemPromptText)
    .replace(EMOTION_EVAL_HISTORY_SLOT, () => recentLines);
};

/** 报错正文最多带回这么长——够定位是限流还是鉴权就行，不是日志转发通道。 */
export const ERROR_SNIPPET_MAX = 120;

/**
 * 「先打码、后截断」的唯一出口：所有会随 push 出门的失败文案（HTTP 分支、catch 分支）
 * 都要过这里。打码在截断之前——先截的话，切口正好落在 key 中间时整串就查不到 key，
 * 半截凭据原样带出去。个别中转会把整个请求（含 Authorization 头）回显在错误页里。
 */
export const maskAndSnip = (text: string, apiKey: string): string => {
  let snippet = text.replace(/\s+/g, ' ').trim();
  if (apiKey && snippet.includes(apiKey)) snippet = snippet.split(apiKey).join('***');
  return snippet.slice(0, ERROR_SNIPPET_MAX);
};

/** 一次评估的结局：拿到原文，或者一句能给用户看的短失败原因。 */
export interface EmotionEvalOutcome {
  /** 评估模型的输出原文；没跑出来时为 null。 */
  raw: string | null;
  /** 没跑出来的原因（人话、一句话）；成功时为 null。 */
  error: string | null;
}

/**
 * 发一次评估请求并解析输出。promptContent 传 restoreEvalPrompt 还原好的整段。
 * 失败绝不抛：给一句已打码的短原因（它最终要走 push 出门，凭据绝不进 push 是红线）。
 */
export const requestEmotionEval = async (
  api: EmotionEvalApi,
  promptContent: string,
  timeoutMs: number = EMOTION_EVAL_TIMEOUT_MS,
): Promise<EmotionEvalOutcome> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseUrl = String(api.baseUrl).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.apiKey || 'sk-none'}`,
      },
      body: JSON.stringify({
        model: api.model,
        messages: [{ role: 'user', content: promptContent }],
        temperature: 0.85,
        // 显式给足输出额度：部分中转不传 max_tokens 时默认很小，评估输出很长，
        // 会被截成半截 JSON。
        max_tokens: 8000,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 正文可能是 HTML 错误页，截一小段够定位即可。
      let body = '';
      try { body = await res.text(); } catch { /* 读不出正文就只报状态码 */ }
      console.warn('[emotion-eval] 副 API 拒了这次评估（主流程不受影响）', res.status);
      const snippet = maskAndSnip(body, api.apiKey);
      return { raw: null, error: `副 API HTTP ${res.status}${snippet ? `：${snippet}` : ''}` };
    }
    const data = await res.json() as any;
    // 个别中转把全部输出塞进 reasoning_content 而 content 留空——与客户端
    // utils/emotionApply.ts 的 extractAssistantText 同一套兜底。
    const message = data?.choices?.[0]?.message;
    const raw = flattenEvalContent(message?.content)
      || (typeof message?.reasoning_content === 'string' ? message.reasoning_content : '');
    if (!raw.trim()) {
      return {
        raw: null,
        error: `评估模型没有输出内容（finish_reason: ${data?.choices?.[0]?.finish_reason ?? '?'}）`,
      };
    }
    return { raw, error: null };
  } catch (error) {
    console.warn('[emotion-eval] 评估失败（主流程不受影响）', error);
    // 只带异常名/消息，不带栈：这句要走 push 出门，短一点、也别把内部路径抖出去。
    // 异常消息同样过打码：fetch 异常一般不含请求头，但 URL 解析类错误会回显传入的
    // 地址，用户把 key 拼在 baseUrl 里时不打码就漏了。
    const reason = controller.signal.aborted
      ? `评估超时（${Math.round(timeoutMs / 1000)} 秒没回来）`
      : `评估请求没发出去：${maskAndSnip(error instanceof Error ? error.message : String(error), api.apiKey)}`;
    return { raw: null, error: reason };
  } finally {
    clearTimeout(timer);
  }
};
