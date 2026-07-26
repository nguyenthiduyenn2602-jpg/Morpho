/**
 * SullyOS · 忠实用户一次性招募（Cloudflare Worker + 独立 D1）
 *
 * 资格在用户本机计算。本服务只接收通过者的 QQ、固定规则版本、固定截止时间和
 * 截止时间；不接收聊天、角色、记忆或评分明细。
 *
 * 路由兼容挂在根路径或 /recruit 前缀：
 *   GET  …/health
 *   POST …/submit       { qq, criteriaVersion, cutoffAt }
 *   GET  …/admin        管理员网页（输入 ADMIN_TOKEN 后查看或下载 CSV）
 *   GET  …/admin-list   Authorization: Bearer <ADMIN_TOKEN>
 */

export interface Env {
    DB: D1Database;
    /** 普通 var：检测通过后显示的群号。 */
    GROUP_ID?: string;
    /** secret：检测通过后显示的入群密码。 */
    GROUP_PASSWORD?: string;
    /** secret：管理员导出 QQ 名单时使用。 */
    ADMIN_TOKEN?: string;
    /** secret：将客户端 IP 不可逆化后再用于限流。 */
    RECRUIT_IP_SALT?: string;
    /** 普通 var：每 IP 每小时提交上限，默认 20。 */
    RATE_SUBMITS?: string;
}

interface D1Database {
    prepare(query: string): D1PreparedStatement;
    exec(query: string): Promise<unknown>;
}

interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run(): Promise<unknown>;
    first<T = unknown>(): Promise<T | null>;
    all<T = unknown>(): Promise<{ results: T[] }>;
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
};

const RESPONSE_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS,
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: RESPONSE_HEADERS,
});

const ADMIN_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>进群名额登记 · 管理员导出</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: #f6f1eb; background: #11100f; }
    main { width: min(880px, calc(100% - 32px)); margin: 0 auto; padding: 64px 0; }
    header { margin-bottom: 34px; }
    .eyebrow { margin: 0 0 10px; color: #bd9f78; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 0; font: 500 clamp(28px, 5vw, 44px)/1.1 Georgia, serif; }
    .intro { max-width: 620px; margin: 14px 0 0; color: #aaa29a; line-height: 1.7; }
    .panel { border: 1px solid #332f2b; border-radius: 18px; background: #191715; overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,.28); }
    form, .toolbar { display: flex; gap: 10px; padding: 18px; }
    input { min-width: 0; flex: 1; border: 1px solid #3b3732; border-radius: 11px; padding: 12px 14px; color: inherit; background: #12110f; font: inherit; outline: none; }
    input:focus { border-color: #9e805c; box-shadow: 0 0 0 3px rgba(158,128,92,.14); }
    button { border: 0; border-radius: 11px; padding: 12px 17px; color: #15120f; background: #d4b58d; font: 650 14px/1 inherit; cursor: pointer; }
    button:hover { background: #e1c59f; }
    button:disabled { cursor: wait; opacity: .58; }
    .secondary { color: #e7ded3; background: #302b26; }
    .secondary:hover { background: #3a342e; }
    #status { min-height: 22px; margin: 0; padding: 0 18px 18px; color: #aaa29a; font-size: 13px; }
    #status.error { color: #ef9b91; }
    #results[hidden] { display: none; }
    .toolbar { align-items: center; justify-content: space-between; border-top: 1px solid #332f2b; }
    #count { color: #c8beb3; font-size: 14px; }
    .table-wrap { max-height: 58vh; overflow: auto; border-top: 1px solid #332f2b; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 13px 18px; border-bottom: 1px solid #2b2824; text-align: left; white-space: nowrap; }
    th { position: sticky; top: 0; color: #918981; background: #191715; font-size: 12px; font-weight: 600; letter-spacing: .06em; }
    td { color: #e6ded5; font-size: 14px; }
    td:first-child { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    @media (max-width: 560px) { main { padding: 32px 0; } form { flex-direction: column; } .toolbar { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">SullyOS · Private</p>
      <h1>进群名额登记</h1>
      <p class="intro">输入第三个 Worker 的管理员令牌即可查看名单。令牌只用于本次请求，不会写入网址或浏览器存储。</p>
    </header>
    <section class="panel">
      <form id="login">
        <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="ADMIN_TOKEN" aria-label="管理员令牌" required>
        <button id="load" type="submit">查看名单</button>
      </form>
      <p id="status" role="status" aria-live="polite">尚未读取数据</p>
      <div id="results" hidden>
        <div class="toolbar">
          <span id="count"></span>
          <button id="download" class="secondary" type="button">下载 CSV</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>QQ 号</th><th>登记时间（北京时间）</th></tr></thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </div>
    </section>
  </main>
  <script>
    (() => {
      const form = document.querySelector('#login');
      const tokenInput = document.querySelector('#token');
      const loadButton = document.querySelector('#load');
      const status = document.querySelector('#status');
      const results = document.querySelector('#results');
      const count = document.querySelector('#count');
      const tbody = document.querySelector('#rows');
      const download = document.querySelector('#download');
      let candidates = [];

      const endpoint = location.pathname.replace(/\\/admin\\/?$/, '') + '/admin-list?limit=5000';
      const formatTime = value => new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date(Number(value)));

      const setStatus = (message, isError = false) => {
        status.textContent = message;
        status.classList.toggle('error', isError);
      };

      const render = () => {
        tbody.replaceChildren();
        for (const item of candidates) {
          const row = document.createElement('tr');
          const qq = document.createElement('td');
          const time = document.createElement('td');
          qq.textContent = String(item.qq || '');
          time.textContent = formatTime(item.submitted_at);
          row.append(qq, time);
          tbody.append(row);
        }
        count.textContent = '共 ' + candidates.length + ' 条登记记录';
        results.hidden = false;
      };

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const token = tokenInput.value;
        if (!token) return;
        loadButton.disabled = true;
        results.hidden = true;
        setStatus('正在读取……');
        try {
          const response = await fetch(endpoint, {
            headers: { Authorization: 'Bearer ' + token },
            cache: 'no-store',
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(response.status === 401 ? '令牌不正确，或 Worker 尚未设置 ADMIN_TOKEN。' : (payload.error || '读取失败'));
          }
          candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
          render();
          setStatus(candidates.length ? '名单已读取。' : '目前还没有登记记录。');
        } catch (error) {
          candidates = [];
          setStatus(error instanceof Error ? error.message : '读取失败，请稍后重试。', true);
        } finally {
          loadButton.disabled = false;
        }
      });

      download.addEventListener('click', () => {
        const escapeCell = value => '"' + String(value).replace(/"/g, '""') + '"';
        const lines = [['QQ号', '登记时间（北京时间）'], ...candidates.map(item => [item.qq, formatTime(item.submitted_at)])];
        const csv = '\\uFEFF' + lines.map(line => line.map(escapeCell).join(',')).join('\\r\\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = 'sullyos-recruitment-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(href);
      });
    })();
  </script>
</body>
</html>`;

const adminPage = () => new Response(ADMIN_PAGE, {
    headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
    },
});

const CRITERIA_VERSIONS = new Set(['2026-07-20-v1', '2026-07-20-v2', '2026-07-20-v3', '2026-07-20-v4']);
const CUTOFF_AT = Date.parse('2026-07-20T19:00:00+08:00');
const RATE_WINDOW_MS = 60 * 60_000;
const DEFAULT_GROUP_ID = '892128017';

const numberOr = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

let schemaReady = false;

async function ensureSchema(db: D1Database): Promise<void> {
    if (schemaReady) return;
    await db.exec(`CREATE TABLE IF NOT EXISTS recruit_candidates (qq TEXT PRIMARY KEY, submitted_at INTEGER NOT NULL);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_recruit_submitted ON recruit_candidates(submitted_at);`);
    await db.exec(`CREATE TABLE IF NOT EXISTS recruit_ratelimit (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
    schemaReady = true;
}

async function hashIp(ip: string, salt: string): Promise<string> {
    const bytes = new TextEncoder().encode(`${salt}:${ip}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function isRateLimited(db: D1Database, ipHash: string, limit: number): Promise<boolean> {
    if (!ipHash || limit <= 0) return false;
    const now = Date.now();
    const row = await db.prepare(
        `INSERT INTO recruit_ratelimit (bucket, count, reset_at) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET
           count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
           reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
         RETURNING count`
    ).bind(ipHash, now + RATE_WINDOW_MS, now, now, now + RATE_WINDOW_MS).first<{ count: number }>();
    return (row?.count || 1) > limit;
}

function isAdmin(request: Request, env: Env): boolean {
    if (!env.ADMIN_TOKEN) return false;
    const auth = request.headers.get('Authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return bearer === env.ADMIN_TOKEN;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
        if (!env.DB) return json({ ok: false, error: 'D1 binding "DB" not configured' }, 500);

        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '');
        const ends = (suffix: string) => path === suffix || path.endsWith(suffix);

        try {
            await ensureSchema(env.DB);

            if (request.method === 'GET' && ends('/health')) {
                return json({
                    ok: true,
                    service: 'sullyos-loyal-recruitment',
                    configured: !!env.GROUP_PASSWORD,
                    admin: !!env.ADMIN_TOKEN,
                });
            }

            if (request.method === 'GET' && ends('/admin')) {
                return adminPage();
            }

            if (request.method === 'POST' && ends('/submit')) {
                if (!env.GROUP_PASSWORD) return json({ ok: false, error: 'recruitment not configured' }, 503);

                const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
                const ipHash = ip ? await hashIp(ip, env.RECRUIT_IP_SALT || 'loyal-recruitment') : '';
                if (await isRateLimited(env.DB, ipHash, numberOr(env.RATE_SUBMITS, 20))) {
                    return json({ ok: false, error: 'rate limited' }, 429);
                }

                const body = await request.json().catch(() => ({})) as Record<string, unknown>;
                const qq = String(body.qq || '').replace(/\s+/g, '');
                const criteriaVersion = String(body.criteriaVersion || '').slice(0, 60);
                const cutoffAt = Number(body.cutoffAt);

                if (!/^[1-9]\d{4,11}$/.test(qq)) return json({ ok: false, error: 'invalid qq' }, 400);
                if (!CRITERIA_VERSIONS.has(criteriaVersion) || cutoffAt !== CUTOFF_AT) {
                    return json({ ok: false, error: 'criteria mismatch' }, 409);
                }

                const existing = await env.DB.prepare('SELECT qq FROM recruit_candidates WHERE qq = ?').bind(qq).first();
                if (!existing) {
                    await env.DB.prepare(
                        'INSERT OR IGNORE INTO recruit_candidates (qq, submitted_at) VALUES (?,?)'
                    ).bind(qq, Date.now()).run();
                }

                return json({
                    ok: true,
                    registered: true,
                    duplicate: !!existing,
                    group: String(env.GROUP_ID || DEFAULT_GROUP_ID),
                    password: env.GROUP_PASSWORD,
                });
            }

            if (request.method === 'GET' && ends('/admin-list')) {
                if (!isAdmin(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const limit = Math.min(Math.max(numberOr(url.searchParams.get('limit') || '', 500), 1), 5000);
                const rows = await env.DB.prepare(
                    'SELECT qq, submitted_at FROM recruit_candidates ORDER BY submitted_at ASC LIMIT ?'
                ).bind(limit).all();
                return json({ ok: true, candidates: rows.results || [] });
            }

            return json({ ok: false, error: 'not found' }, 404);
        } catch (error) {
            console.error('[loyal-recruitment]', error);
            return json({ ok: false, error: error instanceof Error ? error.message : 'internal error' }, 500);
        }
    },
};
