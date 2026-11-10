import { describe, it, expect } from 'vitest';
import { upgradeChatBodyToStream, assembleUpgradedResponse, streamRequiredRetryBody, requiresStreamingTransport } from './streamUpgrade';

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


describe('GG streaming transport preserves multimodal inputs', () => {
    it('targets only the tested GG endpoint and model', () => {
        expect(requiresStreamingTransport('https://gcli.ggchan.dev/v1/chat/completions', 'a-gemini-4-argon')).toBe(true);
        expect(requiresStreamingTransport('https://gcli.ggchan.dev.evil.test/v1/chat/completions', 'a-gemini-4-argon')).toBe(false);
        expect(requiresStreamingTransport('https://other.test/v1/chat/completions', 'a-gemini-4-argon')).toBe(false);
        expect(requiresStreamingTransport('https://gcli.ggchan.dev/v1/chat/completions', 'other')).toBe(false);
    });
    it('changes only stream, retaining images, native files, text and tools', () => {
        const body = { model: 'a-gemini-4-argon', stream: false, messages: [{role:'user', content:[
            {type:'text',text:'look'}, {type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}},
            {type:'file',file:{filename:'doc.pdf',file_data:'BBBB'}}
        ]}], tools: [] };
        expect(JSON.parse(upgradeChatBodyToStream(JSON.stringify(body), false)!)).toEqual({...body,stream:true});
        expect(body.stream).toBe(false);
    });
    it('does not downgrade already streaming requests or files_not_supported errors', () => {
        expect(upgradeChatBodyToStream('{"stream":true}',false)).toBeNull();
        expect(streamRequiredRetryBody('{"stream":true}', '{"error":{"code":"files_not_supported"}}')).toBeNull();
    });
});
