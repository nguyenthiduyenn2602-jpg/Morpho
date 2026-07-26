type ToolCallLike = {
    id?: unknown;
    type?: unknown;
    function?: {
        name?: unknown;
        arguments?: unknown;
        [key: string]: unknown;
    };
    [key: string]: unknown;
};

const safeFragment = (value: string): string =>
    value.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 48) || 'tool';

/**
 * Gemini 的 OpenAI 兼容层偶尔会返回空 tool_call.id；结果回填时又要求
 * function_response.name 非空。先把本轮调用规范化，确保 assistant.tool_calls
 * 和后续 role=tool 消息使用同一组稳定 id/name。
 */
export function normalizeToolCallsForCompat(toolCalls: unknown, scope = 'tool'): any[] {
    if (!Array.isArray(toolCalls)) return [];

    const seenIds = new Set<string>();
    const safeScope = safeFragment(scope);

    return toolCalls.map((rawCall: ToolCallLike, index: number) => {
        const rawName = typeof rawCall?.function?.name === 'string'
            ? rawCall.function.name.trim()
            : '';
        const name = rawName || 'unknown_tool';
        const rawId = typeof rawCall?.id === 'string' ? rawCall.id.trim() : '';
        let id = rawId;

        if (!id || seenIds.has(id)) {
            id = `call_${safeScope}_${safeFragment(name)}_${index}`;
        }
        seenIds.add(id);

        return {
            ...rawCall,
            id,
            type: rawCall?.type || 'function',
            function: {
                ...(rawCall?.function || {}),
                name,
            },
        };
    });
}

export function buildToolResultMessage(toolCall: ToolCallLike, content: string): {
    role: 'tool';
    name: string;
    tool_call_id: string;
    content: string;
} {
    const name = typeof toolCall?.function?.name === 'string' && toolCall.function.name.trim()
        ? toolCall.function.name.trim()
        : 'unknown_tool';
    const toolCallId = typeof toolCall?.id === 'string' && toolCall.id.trim()
        ? toolCall.id.trim()
        : `call_result_${safeFragment(name)}`;

    return {
        role: 'tool',
        name,
        tool_call_id: toolCallId,
        content,
    };
}
