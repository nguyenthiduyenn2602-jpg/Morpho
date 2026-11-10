import { describe, it, expect } from 'vitest';
import { upgradeChatBodyToStream, assembleUpgradedResponse, streamRequiredRetryBody, filesUnsupportedRetryBody } from './streamUpgrade';

// 透明流式升级：请求体改写 + SSE 响应拼回 JSON。
// 关键不变量：调用方拿到的最终 JSON 与不升级时结构等价（choices/usage/model）。

describe('upgradeChatBodyToStream', () => {
    it('stream:false → 升级为 stream:true + include_usage，其余字段不动', () => {
        const out = upgradeChatBodyToStream(JSON.stringify({ model: 'm', messages: [], stream: false, max_tokens: 8000 }));
        const parsed = JSON.parse(out!);
        expect(parsed.stream).toBe(true);
        expect(parsed.stream_options).toEqual({ include_usage: true });
        expect(parsed.max_tokens).toBe(8000);
    });

    it('缺省 stream → 同样升级', () => {
        const out = upgradeChatBodyToStream(JSON.stringify({ model: 'm', messages: [] }));
        expect(JSON.parse(out!).stream).toBe(true);
    });

    it('已是 stream:true（聊天主路径等自行开流的调用）→ 不碰，返回 null', () => {
        expect(upgradeChatBodyToStream(JSON.stringify({ model: 'm', stream: true }))).toBeNull();
    });

    it('非 JSON / 非对象 body → 返回 null 原样放行', () => {
        expect(upgradeChatBodyToStream('not-json')).toBeNull();
        expect(upgradeChatBodyToStream('[1,2]')).toBeNull();
    });
});

describe('assembleUpgradedResponse', () => {
    it('SSE 响应 → 拼回标准 chat.completion JSON', async () => {
        const sse = [
            'data: {"id":"c1","model":"real-backend","choices":[{"delta":{"role":"assistant","content":"你好"}}]}',
            'data: {"choices":[{"delta":{"content":"呀"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
            'data: [DONE]',
            '',
        ].join('\n');
        const upstream = new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        const out = await assembleUpgradedResponse(upstream);
        expect(out.headers.get('content-type')).toContain('application/json');
        const data = await out.json();
        expect(data.choices[0].message.content).toBe('你好呀');
        expect(data.model).toBe('real-backend');
        expect(data.usage.total_tokens).toBe(12);
    });

    it('OpenRouter 心跳先于 data 时仍拼回标准 JSON', async () => {
        const sse = [
            ': OPENROUTER PROCESSING',
            '',
            'data: {"id":"c2","choices":[{"delta":{"content":"心跳后"}}]}',
            'data: {"choices":[{"delta":{"content":"正常"}}]}',
            'data: [DONE]',
            '',
        ].join('\n');
        const upstream = new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        const out = await assembleUpgradedResponse(upstream);
        const data = await out.json();
        expect(data.choices[0].message.content).toBe('心跳后正常');
    });

    it('代理无视 stream 返回整包 JSON → 原文透传（重新包装）', async () => {
        const json = JSON.stringify({ choices: [{ message: { content: '整包' } }] });
        const upstream = new Response(json, { status: 200, headers: { 'Content-Type': 'application/json' } });
        const out = await assembleUpgradedResponse(upstream);
        expect((await out.json()).choices[0].message.content).toBe('整包');
    });
});

describe('stream-required compatibility', () => {
    const error = JSON.stringify({ error: { code: 'stream_required' } });
    it('preserves messages and options, without adding optional stream_options', () => {
        const body = { model: 'a-gemini-4-argon', messages: [{ role: 'user', content: 'hello' }], stream: false, temperature: 0.85 };
        expect(JSON.parse(streamRequiredRetryBody(JSON.stringify(body), error)!)).toEqual({ ...body, stream: true });
    });
    it('does not retry streaming requests or unrelated errors', () => {
        expect(streamRequiredRetryBody('{"stream":true}', error)).toBeNull();
        expect(streamRequiredRetryBody('{}', '{"error":{"code":"content_filter"}}')).toBeNull();
        expect(streamRequiredRetryBody('{}', 'invalid')).toBeNull();
        expect(streamRequiredRetryBody('[]', error)).toBeNull();
    });
    it('preserves media and tools rather than silently discarding them', () => {
        const body = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] }], tools: [{ type: 'function' }] };
        expect(JSON.parse(streamRequiredRetryBody(JSON.stringify(body), error)!)).toEqual({ ...body, stream: true });
    });
});

describe('files-not-supported compatibility', () => {
    const error = JSON.stringify({ error: { code: 'files_not_supported' } });
    it('retains history, extracted text, model and tools, without mutating local content', () => {
        const body = { model: 'm', tools: [], messages: [
            { role: 'system', content: 'persona' },
            { role: 'user', content: [{ type: 'text', text: 'document text' }, { type: 'file', file: { file_data: 'SECRET_BINARY' } }, { type: 'image_url', image_url: { url: 'SECRET_IMAGE' } }] }
        ] };
        const original = JSON.stringify(body);
        const result = filesUnsupportedRetryBody(original,error)!;
        const parsed = JSON.parse(result);
        expect(parsed.stream).toBe(true);
        expect(parsed.messages).toHaveLength(2);
        expect(parsed.messages[0]).toEqual(body.messages[0]);
        expect(parsed.messages[1].content).toContain('document text');
        expect(parsed.messages[1].content).toContain('不能声称');
        expect(result).not.toContain('SECRET_');
        expect(parsed.tools).toEqual([]);
        expect(JSON.stringify(body)).toBe(original);
        expect(filesUnsupportedRetryBody(result,error)).toBeNull();
    });
    it('flattens text-only arrays and ignores unrelated errors or invalid bodies', () => {
        const body=JSON.stringify({messages:[{role:'user',content:[{type:'text',text:'one'},{type:'text',text:'two'}]}]});
        expect(JSON.parse(filesUnsupportedRetryBody(body,error)!).messages[0].content).toBe('one\ntwo');
        expect(filesUnsupportedRetryBody(body,'{"error":{"code":"content_filter"}}')).toBeNull();
        expect(filesUnsupportedRetryBody('{}',error)).toBeNull();
        expect(filesUnsupportedRetryBody('bad',error)).toBeNull();
    });
});
