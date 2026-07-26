import { describe, it, expect } from 'vitest';
import { safeResponseJson } from './safeApi';

// 流式响应必须把 delta.tool_calls 分片拼回完整 tool_calls,
// 否则开 stream 的工具模式（瑞幸/MCP）会静默丢掉全部工具调用
describe('parseSseToCompletion: tool_calls 分片重组', () => {
    const sse = (lines: any[]) => new Response(
        lines.map(l => `data: ${JSON.stringify(l)}`).join('\n\n') + '\n\ndata: [DONE]\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

    it('name 在首片、arguments 逐片拼接、按 index 分组', async () => {
        const data = await safeResponseJson(sse([
            { id: 'x', choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"上海"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]));
        const tc = data.choices[0].message.tool_calls;
        expect(tc).toHaveLength(1);
        expect(tc[0].id).toBe('call_1');
        expect(tc[0].function.name).toBe('get_weather');
        expect(JSON.parse(tc[0].function.arguments)).toEqual({ city: '上海' });
    });

    it('纯文本流不带 tool_calls 字段（不影响旧行为）', async () => {
        const data = await safeResponseJson(sse([
            { id: 'y', choices: [{ delta: { role: 'assistant', content: '你好' } }] },
            { choices: [{ delta: { content: '呀' }, finish_reason: 'stop' }] },
        ]));
        expect(data.choices[0].message.content).toBe('你好呀');
        expect(data.choices[0].message.tool_calls).toBeUndefined();
    });
});
