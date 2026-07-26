import { describe, expect, it } from 'vitest';
import { buildToolResultMessage, normalizeToolCallsForCompat } from './toolCallCompat';

describe('tool call compatibility', () => {
    it('为 Gemini 的空调用 ID 生成稳定 ID，并把工具名放回结果消息', () => {
        const calls = normalizeToolCallsForCompat([{
            id: '',
            type: 'function',
            function: { name: 'lover_connect', arguments: '{}' },
        }], 'mcp_0');

        expect(calls[0].id).toBe('call_mcp_0_lover_connect_0');

        const result = buildToolResultMessage(calls[0], '{"ok":true}');
        expect(result).toEqual({
            role: 'tool',
            name: 'lover_connect',
            tool_call_id: calls[0].id,
            content: '{"ok":true}',
        });
    });

    it('保留有效调用 ID，并避免并行调用出现重复 ID', () => {
        const calls = normalizeToolCallsForCompat([
            { id: 'call-1', function: { name: 'first_tool', arguments: '{}' } },
            { id: 'call-1', function: { name: 'second_tool', arguments: '{}' } },
        ], 'mcp_1');

        expect(calls[0].id).toBe('call-1');
        expect(calls[1].id).toBe('call_mcp_1_second_tool_1');
    });
});
