import { safeResponseJson } from '../safeApi';
import { callMcpTool, getMcpUseNativeTools } from '../mcpClient';
import {
    buildMcpOpenAITools,
    buildMcpRejectedToolsFallbackBody,
    buildMcpSystemBlock,
    buildMcpTextFallbackBody,
    extractTextFakedMcpCalls,
    formatMcpToolResult,
    shouldRetryMcpWithoutTools,
} from '../mcpToolBridge';
import { buildToolResultMessage, normalizeToolCallsForCompat } from '../toolCallCompat';

interface GroupMcpCompletionOptions {
    url: string;
    headers: HeadersInit;
    body: Record<string, any>;
    groupId: string;
    userName: string;
    signal?: AbortSignal;
    onStatus?: (status: string) => void;
}

const mergeUsage = (total: Record<string, number>, usage: any) => {
    if (!usage) return;
    for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
        if (typeof usage[key] === 'number') total[key] = (total[key] || 0) + usage[key];
    }
};

/**
 * 群聊专用的通用 MCP completion：在群聊原有提示词外只增加工具注入、客户端
 * tools/call 循环和正文兼容兜底，最终仍返回标准 chat/completions 响应。
 */
export async function completeGroupChatWithMcp(options: GroupMcpCompletionOptions): Promise<any> {
    const { tools, resolve } = buildMcpOpenAITools(options.groupId);
    const usageTotal: Record<string, number> = {};

    const request = async (body: Record<string, any>): Promise<any> => {
        const response = await fetch(options.url, {
            method: 'POST',
            headers: options.headers,
            body: JSON.stringify(body),
            signal: options.signal,
        });
        if (!response.ok) {
            const preview = await response.text().catch(() => '');
            throw new Error(`API 返回 ${response.status}${preview ? `: ${preview.slice(0, 160)}` : ''}`);
        }
        const data = await safeResponseJson(response);
        mergeUsage(usageTotal, data.usage);
        return data;
    };

    // 没有对本群可见的服务器时完全沿用群聊原请求。
    if (!tools.length) return request(options.body);

    const systemBlock = buildMcpSystemBlock(options.userName, options.groupId);
    const baseBody: Record<string, any> = {
        ...options.body,
        messages: [
            ...(systemBlock ? [{ role: 'system', content: systemBlock }] : []),
            ...(options.body.messages || []),
        ],
    };
    const nativeBody: Record<string, any> = {
        ...baseBody,
        tools: [...(baseBody.tools || []), ...tools],
        tool_choice: baseBody.tool_choice || 'auto',
    };
    let requestBody: Record<string, any> = getMcpUseNativeTools()
        ? nativeBody
        : buildMcpRejectedToolsFallbackBody(nativeBody);
    let data: any;
    try {
        data = await request(requestBody);
    } catch (error) {
        if (!requestBody.tools?.length || !shouldRetryMcpWithoutTools(error)) throw error;
        requestBody = buildMcpRejectedToolsFallbackBody(nativeBody);
        data = await request(requestBody);
    }

    let conversationMessages = [...(requestBody.messages || [])];

    // 正规 function calling：保留 tools，允许游戏/主持类 MCP 连续多步调用。
    for (let iteration = 0; iteration < 6; iteration++) {
        const toolCalls = normalizeToolCallsForCompat(
            data.choices?.[0]?.message?.tool_calls,
            `group_${iteration}`,
        );
        if (!toolCalls.length) break;
        conversationMessages.push({
            role: 'assistant',
            content: data.choices[0].message.content || '(调用工具中)',
            tool_calls: toolCalls,
        });
        for (const toolCall of toolCalls) {
            const exposedName = toolCall.function?.name || '';
            const hit = resolve.get(exposedName);
            let args: Record<string, any> = {};
            try {
                const raw = toolCall.function?.arguments ?? toolCall.arguments;
                args = typeof raw === 'string' ? (raw ? JSON.parse(raw) : {}) : (raw || {});
            } catch { /* 交给工具返回错误，不中断整轮群聊 */ }

            if (!hit) {
                conversationMessages.push(buildToolResultMessage(
                    toolCall,
                    `未知工具 ${exposedName}，只能使用系统提供的工具。`,
                ));
                continue;
            }
            options.onStatus?.(`正在调用 MCP 工具：${exposedName}…`);
            const result = await callMcpTool(hit.server, hit.toolName, args);
            conversationMessages.push(buildToolResultMessage(
                toolCall,
                result.success
                    ? `工具 ${exposedName} 成功。结果: ${formatMcpToolResult(result.data)}`
                    : `工具 ${exposedName} 失败: ${result.error}`,
            ));
        }
        options.onStatus?.('正在整理 MCP 工具结果…');
        data = await request({ ...nativeBody, messages: conversationMessages });
    }

    // 不支持 tools 的模型/中转：识别正文调用，代执行后让模型重新产出群聊格式。
    const executed = new Set<string>();
    for (let iteration = 0; iteration < 3; iteration++) {
        const content = String(data.choices?.[0]?.message?.content || '');
        const calls = extractTextFakedMcpCalls(content, resolve)
            .filter(call => {
                const signature = `${call.exposedName}|${JSON.stringify(call.args)}`;
                if (executed.has(signature)) return false;
                executed.add(signature);
                return true;
            })
            .slice(0, 3);
        if (!calls.length) break;

        options.onStatus?.(`正在调用 MCP 工具：${calls.map(call => call.exposedName).join('、')}…`);
        const results: string[] = [];
        for (const call of calls) {
            const result = await callMcpTool(call.server, call.toolName, call.args);
            results.push(result.success
                ? `工具 ${call.exposedName} 成功。结果: ${formatMcpToolResult(result.data)}`
                : `工具 ${call.exposedName} 失败: ${result.error}`);
        }
        conversationMessages.push({ role: 'assistant', content });
        conversationMessages.push({
            role: 'user',
            content: `[系统消息：工具调用已经执行。\n${results.join('\n')}\n请基于结果继续完成原群聊任务，严格恢复原本要求的输出格式，不要再把工具调用写进正文。]`,
        });
        options.onStatus?.('正在整理 MCP 工具结果…');
        data = await request(buildMcpTextFallbackBody(baseBody, conversationMessages));
    }

    if (Object.keys(usageTotal).length) data.usage = { ...(data.usage || {}), ...usageTotal };
    options.onStatus?.('');
    return data;
}
