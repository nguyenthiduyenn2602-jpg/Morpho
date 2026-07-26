/**
 * SullyOS MCP CORS 代理 — 部署到「你自己的」Cloudflare 账号
 *
 * 作用：浏览器直连远程 MCP 服务器时经常被 CORS 拦住（读不到 Mcp-Session-Id
 * 响应头，MCP 握手直接失败）。这个 Worker 做透明转发并补上正确的 CORS 头。
 *
 * 部署（二选一）：
 *   A. Cloudflare Dashboard → Workers → Create → 粘贴本文件 → Deploy
 *   B. 本目录下执行 `wrangler deploy`
 *
 * 用法：在 SullyOS 设置的 MCP 服务器「代理 URL」里填你的 Worker 地址，
 *      例如 https://mcp-proxy.<你的子域>.workers.dev
 *      前端会以 <代理URL>?target=<MCP服务器URL> 的形式转发请求。
 *
 * 可选加固（强烈建议，防止别人白嫖你的 Worker 流量）：
 *   在 Worker 的环境变量里设置 PROXY_KEY=<随机字符串>，
 *   然后在 SullyOS 设置的「代理密钥」里填同一个值。
 */

const FORWARD_REQUEST_HEADERS = [
    'content-type',
    'accept',
    'authorization',
    'mcp-session-id',
    'mcp-protocol-version',
    'last-event-id',
];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, X-Proxy-Key, X-MCP-Forward-Headers',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
    'Access-Control-Max-Age': '86400',
};

function corsJson(status, obj) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

function isPrivateIpv4(host) {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127);
}

// 只允许公网 http/https 目标，禁止把 Worker 当内网探针用
function blockedTargetReason(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return 'target 不是合法 URL'; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '只允许 http/https';
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const blocked = host === 'localhost'
        || host.endsWith('.localhost')
        || host.endsWith('.local')
        || host.endsWith('.internal')
        || host === '::1'
        || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')
        || isPrivateIpv4(host);
    return blocked ? '不允许代理内网/本机地址' : null;
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            const headers = new Headers(CORS_HEADERS);
            const requestedHeaders = request.headers.get('access-control-request-headers');
            if (requestedHeaders) headers.set('Access-Control-Allow-Headers', requestedHeaders);
            return new Response(null, { status: 204, headers });
        }

        if (env.PROXY_KEY) {
            const key = request.headers.get('x-proxy-key') || '';
            if (key !== env.PROXY_KEY) return corsJson(403, { error: '代理密钥错误（X-Proxy-Key）' });
        }

        const target = new URL(request.url).searchParams.get('target');
        if (!target) return corsJson(400, { error: '缺少 ?target=<MCP服务器URL> 参数' });
        const blocked = blockedTargetReason(target);
        if (blocked) return corsJson(400, { error: blocked });

        const fwdHeaders = new Headers();
        for (const name of FORWARD_REQUEST_HEADERS) {
            const v = request.headers.get(name);
            if (v) fwdHeaders.set(name, v);
        }
        const blockedForwardHeaders = new Set([
            'host', 'connection', 'content-length', 'transfer-encoding', 'upgrade',
            'x-proxy-key', 'x-mcp-forward-headers',
        ]);
        const customHeaderNames = (request.headers.get('x-mcp-forward-headers') || '')
            .split(',').map(name => name.trim()).filter(Boolean);
        for (const name of customHeaderNames) {
            if (blockedForwardHeaders.has(name.toLowerCase())) continue;
            const value = request.headers.get(name);
            if (value) fwdHeaders.set(name, value);
        }

        let upstream;
        try {
            upstream = await fetch(target, {
                method: request.method,
                headers: fwdHeaders,
                body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
            });
        } catch (e) {
            return corsJson(502, { error: `转发失败: ${e.message}` });
        }

        // 透传响应（含 SSE 流），补 CORS 头
        const respHeaders = new Headers(CORS_HEADERS);
        for (const name of ['content-type', 'mcp-session-id', 'www-authenticate', 'cache-control']) {
            const v = upstream.headers.get(name);
            if (v) respHeaders.set(name, v);
        }
        return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    },
};
