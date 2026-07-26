/**
 * 整合回忆长度兜底（纯逻辑，无外部依赖，便于单测）。
 *
 * content 超过硬上限时：
 *   1. 先用 recompress 让模型二次压缩；压到硬上限内就采用（不丢信息、无「……」）。
 *   2. 二次压缩失败 / 压完仍超 → 取更短的那份做基底，硬截断 +「……」保证绝对有界。
 *
 * recompress 由调用方注入（真实路径是 LLM 调用），单测时换成假实现即可不碰网络。
 */
export async function enforceSummaryLengthBudget(
    content: string,
    recompress: (text: string) => Promise<string | null>,
    hardMaxChars: number,
): Promise<string> {
    if (content.length <= hardMaxChars) return content;
    const recompressed = await recompress(content);
    if (recompressed && recompressed.length <= hardMaxChars) return recompressed;
    const base = recompressed && recompressed.length < content.length ? recompressed : content;
    return base.slice(0, hardMaxChars) + '……';
}
