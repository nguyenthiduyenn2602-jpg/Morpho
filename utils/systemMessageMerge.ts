/**
 * 把请求里的多条 role:system 合并成开头一条（dev-debug 排障用）。
 *
 * SullyOS 的聊天请求默认是三段式：[稳定 system, ...历史, 易变 system]（外加双语 /
 * MCP 提醒条也可能是 system）。正规 OpenAI→Claude 兼容层会正确归并多条 system，
 * 但社区逆向的适配层可能在处理历史之后的 system 时重复拼接前文，导致 prompt_tokens
 * 异常膨胀。这个纯函数配合 devDebug 的 mergeSystemMessages 开关做 A/B 对照：
 * 合并后计费骤降 → 中转适配层问题坐实；不变 → 是计量（tokenizer）口径问题。
 *
 * 语义代价（所以只做临时开关、默认关）：易变尾段本该贴着生成点注入以获得 recency
 * 注意力，合并进头部会削弱这一设计，且改变稳定前缀 → 前缀缓存整体失效。
 */

export interface ChatMessageLike {
    role: string;
    content: any;
}

/**
 * 所有 system 的内容按出现顺序用空行拼接，放到开头一条；非 system 消息保持相对顺序。
 * 只有 0/1 条 system 时原样返回（不做无谓的数组重建）。
 */
export function mergeSystemMessages<T extends ChatMessageLike>(messages: T[]): T[] {
    const systems = messages.filter(m => m.role === 'system');
    if (systems.length <= 1) return messages;
    const merged = systems
        .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
        .filter(part => part && part.trim())
        .join('\n\n');
    const rest = messages.filter(m => m.role !== 'system');
    return [{ ...systems[0], content: merged }, ...rest];
}
