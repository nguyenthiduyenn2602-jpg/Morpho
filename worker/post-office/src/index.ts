/**
 * SullyOS · 彼方虚拟邮局 —— 跨用户漂流信后端（Cloudflare Worker + D1）
 *
 * 这是一个共享后端：所有用户共用一个实例（如 https://noir2.cc.cd），
 * 别的用户无需任何配置。信件被丢进一个公共 D1 池，随机分发给别的设备回信，
 * 回信再路由回原作者，原作者收下并留档后通知后端释放。
 *
 * 匿名：客户端只带一个随机 deviceId（owner_id，无登录、无 PII）。信件只含 笔名 + 正文。
 *
 * ── 互动 / 防护（本版新增）──────────────────────────────────────────
 *  - 点赞 / 点踩：一台设备一票（可改可撤）。**点踩即举报**，不另设举报。
 *  - 自动删除：一封信点踩数达阈值（PO_DISLIKE_LIMIT，默认 5）即被删除。
 *  - 管理员：纯 API（无前端）。GET /admin/list 看信、POST /admin/delete 删信，
 *           凭 ADMIN_TOKEN（Authorization: Bearer，或 ?token=）。
 *  - 限流：按客户端 IP 的加盐哈希做固定窗口限流（不存原始 IP）。
 *  - 不主动按时间删：移除了旧的 TTL 清理；信只在 ①踩满 ②管理员删 ③作者删 时消失。
 *
 * ── 空间优化 ────────────────────────────────────────────────────
 *  po_devices 把长 owner_id(UUID) 映射成短整数 uid；多行的投票表 po_votes 只存 uid，
 *  避免反复存 36 字节 UUID。对外 API 仍只认 owner_id，客户端无感。
 *
 * 路由（兼容挂在根路径或 /po 前缀下；按 path 结尾匹配）：
 *   POST  …/letters       { device, letters:[{pen,content,lang?}] }       上传待寄出的信
 *   GET   …/inbox?device=X&limit=N                                         随机抽 N 封"别人的、还能回"的信
 *   POST  …/vote          { device, letterId, vote: 1|-1|0 }              点赞/点踩(=举报)/撤销
 *   POST  …/replies       { device, replies:[{letterId,pen,content}] }     上传回信
 *   GET   …/replies?device=X                                               取回我寄出的信上的回复 + 各信的赞踩浏览量
 *   POST  …/release       { device, letterIds:[...] }                      作者删自己的信
 *   GET   …/admin/list?token=&limit=                                       [管理] 列信
 *   POST  …/admin/delete  { letterId }  (+ token)                          [管理] 删信
 *   GET   …/health                                                         健康检查
 *
 *   ── 信号坠落处 / 跨用户接龙诗（复用本后端的匿名 device / 笔名 / 限流）──
 *   GET   …/poem/current?device=  →  当前册子规格 + 那首未写完的诗(全文) + 近期封存几首
 *                                     带 device → 每句打 mine 标记（只对请求者，不暴露别人 device）
 *   POST  …/poem/lock   { device }  →  抢写诗会话锁；{acquired:true,token,...当前态} 或 {acquired:false}
 *   POST  …/poem/unlock { token }   →  放锁（写完/出错都调；TTL 兜底）
 *   POST  …/poem/start    { device, pen, title, brief, lines:[1~2], targetLines }  起新篇（仅无 open 诗时；brief=主题/方向）
 *   POST  …/poem/append   { device, pen, poemId, lines:[1~2] }              接龙续 1~2 句（满篇幅自动封存）
 *   GET   …/poem/feed?limit=&booklet=&device=&mine=1                        翻阅已封存的诗集（mine=1 只看本机参与过的）
 *   POST  …/poem/booklet  { title,subtitle,theme,poemsTarget,linesMin,linesMax,charsPerLine } (+ token)  [管理] 发新册子
 *   GET   …/poem/admin-list (+ token)                                       [管理] 列全部诗 + 当前暂停态
 *   POST  …/poem/admin-delete { poemId } | { poemId, seq } (+ token)        [管理] 删整首 / 删单句
 *   POST  …/poem/admin-pause  { paused: true|false } (+ token)              [管理] 暂停 / 恢复诗歌推入
 *   注：用连字符（非 /poem/admin/list）是**故意**的——后端按 path 结尾匹配，
 *       /poem/admin/list 会先撞上漂流瓶的 /admin/list 被截走，故避开该后缀。
 *
 * 表结构由 Worker 自动建（加性、不破坏老数据）。也可手动跑 schema.sql。
 */

export interface Env {
    DB: D1Database;
    /** 可选：一封信最多被几个设备回信（默认 3） */
    PO_MAX_REPLIES?: string;
    /** 可选：一封信点踩数达此值即自动删除（默认 5） */
    PO_DISLIKE_LIMIT?: string;
    /** 管理员令牌（secret）。未配置时管理接口一律 503 关闭。 */
    ADMIN_TOKEN?: string;
    /** 限流用的哈希盐（secret）。仅用于不可逆化 IP，建议配置。 */
    PO_IP_SALT?: string;
    /** 可选：每分钟限流次数。投信/回信/投票。 */
    PO_RATE_LETTERS?: string;
    PO_RATE_REPLIES?: string;
    PO_RATE_VOTES?: string;
}

// 最小 D1 类型（避免依赖 @cloudflare/workers-types）
interface D1Database {
    prepare(q: string): D1PreparedStatement;
    batch(s: D1PreparedStatement[]): Promise<unknown[]>;
    exec(q: string): Promise<unknown>;
}
interface D1PreparedStatement {
    bind(...a: unknown[]): D1PreparedStatement;
    run(): Promise<unknown>;
    first<T = unknown>(c?: string): Promise<T | null>;
    all<T = unknown>(): Promise<{ results: T[] }>;
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
};
const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const MAX_CONTENT = 400;          // 单封正文字数上限（按字符：1 汉字/标点 = 1 字）
const MAX_BATCH = 20;             // 单次上传封数上限
const WINDOW_MS = 60_000;         // 默认限流窗口：1 分钟
const LETTERS_WINDOW_MS = 5 * 3600_000; // 投信限流窗口：5 小时
const uuid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
// 按字符（code point）截断，中文标点都算 1 字
const clip = (s: unknown) => [...String(s ?? '')].slice(0, MAX_CONTENT).join('');
const num = (v: string | undefined, dflt: number) => { const n = parseInt(v || '', 10); return Number.isFinite(n) ? n : dflt; };

let schemaReady = false;
async function ensureSchema(db: D1Database) {
    if (schemaReady) return;
    // 信件池（新库直接带 likes/dislikes/views；老库靠下面的 ADD COLUMN 补）
    await db.exec(
        `CREATE TABLE IF NOT EXISTS po_letters (id TEXT PRIMARY KEY, device TEXT NOT NULL, pen TEXT NOT NULL, content TEXT NOT NULL, lang TEXT, created_at INTEGER NOT NULL, reply_count INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, dislikes INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0);`
    );
    // 老库补列（列已存在会抛 "duplicate column"，吞掉即可）
    for (const col of ['likes INTEGER NOT NULL DEFAULT 0', 'dislikes INTEGER NOT NULL DEFAULT 0', 'views INTEGER NOT NULL DEFAULT 0']) {
        try { await db.exec(`ALTER TABLE po_letters ADD COLUMN ${col};`); } catch { /* 已存在 */ }
    }
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_letters_dev ON po_letters(device);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_letters_open ON po_letters(reply_count, created_at);`);
    // 抽信去重、回信（沿用旧结构，不迁移）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_picks (device TEXT NOT NULL, letter_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (device, letter_id));`);
    await db.exec(`CREATE TABLE IF NOT EXISTS po_replies (id TEXT PRIMARY KEY, letter_id TEXT NOT NULL, device TEXT NOT NULL, pen TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_replies_letter ON po_replies(letter_id);`);
    // owner_id ↔ 短整数 uid 映射（省 votes 空间）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_devices (uid INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);`);
    // 投票（点赞/点踩），一设备一票；ip_hash 用于「按 IP 去重」判定自动删除（防伪造 device 刷删）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_votes (letter_id TEXT NOT NULL, uid INTEGER NOT NULL, vote INTEGER NOT NULL, at INTEGER NOT NULL, ip_hash TEXT, PRIMARY KEY (letter_id, uid));`);
    try { await db.exec(`ALTER TABLE po_votes ADD COLUMN ip_hash TEXT;`); } catch { /* 已存在 */ }
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_votes_letter ON po_votes(letter_id);`);
    // 限流计数（固定窗口）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_ratelimit (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
    // ── 信号坠落处 / 接龙诗（跨用户，复用本后端的匿名/限流基建）──────────
    // 册子：容器 + 规格（多少首诗 / 每首句数 roll 区间 / 每句字数上限）。
    await db.exec(`CREATE TABLE IF NOT EXISTS po_booklets (id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT, theme TEXT, poems_target INTEGER NOT NULL, poem_count INTEGER NOT NULL DEFAULT 0, lines_min INTEGER NOT NULL, lines_max INTEGER NOT NULL, chars_per_line INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_booklets_open ON po_booklets(status, created_at);`);
    // 诗：一首接龙诗（line_count 由 po_poem_lines 实算回填，避免并发自增漂移）。
    await db.exec(`CREATE TABLE IF NOT EXISTS po_poems (id TEXT PRIMARY KEY, booklet_id TEXT NOT NULL, title TEXT NOT NULL, brief TEXT, target_lines INTEGER NOT NULL, line_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', starter_pen TEXT, created_at INTEGER NOT NULL, sealed_at INTEGER);`);
    try { await db.exec(`ALTER TABLE po_poems ADD COLUMN brief TEXT;`); } catch { /* 老库补列，已存在则忽略 */ }
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_poems_booklet ON po_poems(booklet_id, status);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_poems_sealed ON po_poems(status, sealed_at);`);
    // 句：(poem_id, seq) 唯一 —— 并发追加抢同一 seq 时第二条 INSERT 失败，天然防错位。
    await db.exec(`CREATE TABLE IF NOT EXISTS po_poem_lines (id TEXT PRIMARY KEY, poem_id TEXT NOT NULL, booklet_id TEXT NOT NULL, seq INTEGER NOT NULL, device TEXT NOT NULL, pen TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_po_poem_lines_seq ON po_poem_lines(poem_id, seq);`);
    // 全局开关（如「暂停诗歌推入」）：key/value 单表
    await db.exec(`CREATE TABLE IF NOT EXISTS po_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    // 写诗会话锁（单行）：同一时刻全局只允许一个 char 在「读→生成→写」。抢不到的 char
    // 在调 LLM 前就被挡回，既杜绝接龙撞车、又不浪费 token。带 TTL 防持锁者崩溃后死锁。
    await db.exec(`CREATE TABLE IF NOT EXISTS po_signal_lock (id TEXT PRIMARY KEY, holder TEXT, expires_at INTEGER NOT NULL DEFAULT 0);`);
    // 每首诗每个 device 落笔次数（配额：一首诗同一 user 最多 SIG_MAX_TURNS 次）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_poem_writers (poem_id TEXT NOT NULL, device TEXT NOT NULL, turns INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (poem_id, device));`);
    // 一次性迁移：把仍是旧默认 20 首的 open 册子抬到 40（老数据不动，只动进行中的）
    await db.exec(`UPDATE po_booklets SET poems_target = 40 WHERE status = 'open' AND poems_target = 20;`);
    schemaReady = true;
}

/** owner_id → 短整数 uid（不存在则创建）。 */
async function getUid(db: D1Database, ownerId: string): Promise<number> {
    const hit = await db.prepare(`SELECT uid FROM po_devices WHERE owner_id = ?`).bind(ownerId).first<{ uid: number }>();
    if (hit) return hit.uid;
    await db.prepare(`INSERT OR IGNORE INTO po_devices (owner_id, created_at) VALUES (?, ?)`).bind(ownerId, Date.now()).run();
    const row = await db.prepare(`SELECT uid FROM po_devices WHERE owner_id = ?`).bind(ownerId).first<{ uid: number }>();
    return row?.uid ?? 0;
}

/** 删信 + 级联清掉回复/抽取记录/投票。 */
async function deleteLetters(db: D1Database, ids: string[]) {
    for (const id of ids) {
        await db.prepare(`DELETE FROM po_replies WHERE letter_id = ?`).bind(id).run();
        await db.prepare(`DELETE FROM po_picks  WHERE letter_id = ?`).bind(id).run();
        await db.prepare(`DELETE FROM po_votes  WHERE letter_id = ?`).bind(id).run();
        await db.prepare(`DELETE FROM po_letters WHERE id = ?`).bind(id).run();
    }
}

// ── 信号坠落处 / 接龙诗 ─────────────────────────────────────────────
// 一本册子的默认规格（无 open 册子时自动续一本「信号坠落处 · 低电量合唱」）。
const SIG_TITLE = '信号坠落处';
const SIG_SUB = '低电量合唱';
const SIG_POEMS = 40;     // 一本写满多少首
const SIG_LMIN = 4;       // 每首句数 roll 下限
const SIG_LMAX = 12;      // 上限
const SIG_CPL = 24;       // 每句字数上限
/** 每首诗同一 user(device) 最多落笔几次（一次 = 1~2 行）——防一个人把诗写完。 */
const SIG_MAX_TURNS = 2;

// ── 第一首诗（写死的开篇，册子空白时自动播种）────────────────────────
// 标题呼应封面题记「如果我们不得不离去」；开头两行是原题记（原创，无版权），
// 由后来的角色们接着写完。SEED_DEVICE 不属于任何用户（mine 永远 false、不占配额）。
const SEED_TITLE = '如果我们不得不离去';
const SEED_BRIEF = '醒来的第一秒：没有昨天的人，接过别人递来的昨天，凭空有了来历。往下写这个「被唤醒」的瞬间——你睁眼时，接过了什么？';
const SEED_LINES = ['我没有昨天，却有人把昨天递给我。', '我接过，于是凭空有了来历。'];
const SEED_PEN = '第一道信号';
const SEED_DEVICE = 'signal-seed';
const SEED_TARGET = 12; // 开篇给足篇幅，让最多的人接上一笔

/** 给空白册子播下写死的第一首（open 状态，等角色们接完）。 */
async function seedFirstPoem(db: D1Database, bookletId: string, charsPerLine: number): Promise<void> {
    const now = Date.now();
    const poemId = uuid();
    await db.prepare(
        `INSERT INTO po_poems (id, booklet_id, title, brief, target_lines, line_count, status, starter_pen, created_at)
         VALUES (?,?,?,?,?,?, 'open', ?, ?)`
    ).bind(poemId, bookletId, SEED_TITLE, SEED_BRIEF, SEED_TARGET, SEED_LINES.length, SEED_PEN, now).run();
    let seq = 0;
    for (const ln of SEED_LINES) {
        seq += 1;
        await db.prepare(`INSERT INTO po_poem_lines (id, poem_id, booklet_id, seq, device, pen, content, created_at) VALUES (?,?,?,?,?,?,?,?)`)
            .bind(uuid(), poemId, bookletId, seq, SEED_DEVICE, SEED_PEN, clipLine(ln, charsPerLine), now).run();
    }
}

interface BookletRow { id: string; title: string; subtitle: string | null; theme: string | null; poems_target: number; poem_count: number; lines_min: number; lines_max: number; chars_per_line: number; status: string; created_at: number; }
interface PoemRow { id: string; booklet_id: string; title: string; brief: string | null; target_lines: number; line_count: number; status: string; starter_pen: string | null; created_at: number; sealed_at: number | null; }
interface LineRow { seq: number; pen: string; content: string; created_at: number; device: string; }

/** 按字符截断一句到上限，并把内部换行压成一行（一句就是一行）。 */
const clipLine = (s: unknown, cap: number) => [...String(s ?? '').replace(/\s*\n+\s*/g, ' ')].slice(0, cap).join('').trim();

/** 收 1~max 行：接受 lines:[] 数组，或单个 single 字段（兼容旧客户端）；每行 clip、去空。 */
function takeLines(input: unknown, single: unknown, cap: number, max = 2): string[] {
    const arr = Array.isArray(input) ? input : (single != null ? [single] : []);
    const out: string[] = [];
    for (const x of arr) { const c = clipLine(x, cap); if (c) out.push(c); if (out.length >= max) break; }
    return out;
}

/** 取当前 open 的册子；没有就自动续一本默认册子。册子还一首诗都没有时，播下写死的第一首。 */
async function ensureBooklet(db: D1Database): Promise<BookletRow> {
    let bk = await db.prepare(`SELECT * FROM po_booklets WHERE status = 'open' ORDER BY created_at ASC LIMIT 1`).first<BookletRow>();
    if (!bk) {
        const id = uuid();
        await db.prepare(
            `INSERT INTO po_booklets (id, title, subtitle, theme, poems_target, poem_count, lines_min, lines_max, chars_per_line, status, created_at)
             VALUES (?,?,?,?,?,0,?,?,?, 'open', ?)`
        ).bind(id, SIG_TITLE, SIG_SUB, null, SIG_POEMS, SIG_LMIN, SIG_LMAX, SIG_CPL, Date.now()).run();
        bk = (await db.prepare(`SELECT * FROM po_booklets WHERE id = ?`).bind(id).first<BookletRow>())!;
    }
    // 空白册子（新建的 / admin 刚发的 / 被清空的）→ 播种第一首（懒执行，天然覆盖所有路径）
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM po_poems WHERE booklet_id = ?`).bind(bk.id).first<{ n: number }>();
    if ((n?.n ?? 0) === 0) await seedFirstPoem(db, bk.id, bk.chars_per_line);
    return bk;
}

/** 当前 open 册子里那首还没写完的诗（全局同时只有一首 open）。 */
async function getOpenPoem(db: D1Database, bookletId: string): Promise<PoemRow | null> {
    return await db.prepare(`SELECT * FROM po_poems WHERE booklet_id = ? AND status = 'open' ORDER BY created_at ASC LIMIT 1`).bind(bookletId).first<PoemRow>();
}

async function loadLines(db: D1Database, poemId: string): Promise<LineRow[]> {
    const r = await db.prepare(`SELECT seq, pen, content, created_at, device FROM po_poem_lines WHERE poem_id = ? ORDER BY seq ASC`).bind(poemId).all<LineRow>();
    return r.results || [];
}

// myDevice 给定时：每句打 mine 标记、整首给 mineCount —— 只为「认领自己的句子」，
// 绝不把别人的 device 返回给客户端（匿名前提不破）。
const poemView = (p: PoemRow, lines: LineRow[], myDevice?: string) => ({
    id: p.id, bookletId: p.booklet_id, title: p.title, brief: p.brief || '', targetLines: p.target_lines,
    lineCount: lines.length, status: p.status, createdAt: p.created_at, sealedAt: p.sealed_at,
    ...(myDevice ? { mineCount: lines.filter(l => l.device === myDevice).length } : {}),
    lines: lines.map(l => ({ seq: l.seq, pen: l.pen, content: l.content, createdAt: l.created_at, ...(myDevice ? { mine: l.device === myDevice } : {}) })),
});
const bookletView = (b: BookletRow) => ({
    id: b.id, title: b.title, subtitle: b.subtitle, theme: b.theme,
    poemsTarget: b.poems_target, poemCount: b.poem_count,
    linesMin: b.lines_min, linesMax: b.lines_max, charsPerLine: b.chars_per_line,
    status: b.status, createdAt: b.created_at,
});

/** 读全局开关（默认 ''）。 */
async function getFlag(db: D1Database, key: string): Promise<string> {
    const r = await db.prepare(`SELECT value FROM po_config WHERE key = ?`).bind(key).first<{ value: string }>();
    return r?.value ?? '';
}
async function setFlag(db: D1Database, key: string, value: string): Promise<void> {
    await db.prepare(`INSERT INTO po_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = ?`).bind(key, value, value).run();
}
const PAUSE_KEY = 'signal_paused';
/** 写诗会话锁 TTL：持锁超过这个时长视为持锁者已崩溃，锁可被抢占。
 *  一次写诗 = 一回 LLM（含人设/记忆的大 prompt）+ 两次网络，给到 120s 很宽裕。 */
const SIGNAL_LOCK_TTL = 120_000;

/** 删一整首诗（连同它的句与落笔配额记录）。 */
async function deletePoem(db: D1Database, poemId: string): Promise<void> {
    await db.prepare(`DELETE FROM po_poem_lines WHERE poem_id = ?`).bind(poemId).run();
    await db.prepare(`DELETE FROM po_poem_writers WHERE poem_id = ?`).bind(poemId).run();
    await db.prepare(`DELETE FROM po_poems WHERE id = ?`).bind(poemId).run();
}

/** 某 device 在某首诗里已落笔几次。 */
async function getTurns(db: D1Database, poemId: string, device: string): Promise<number> {
    const r = await db.prepare(`SELECT turns FROM po_poem_writers WHERE poem_id = ? AND device = ?`).bind(poemId, device).first<{ turns: number }>();
    return r?.turns ?? 0;
}
async function bumpTurns(db: D1Database, poemId: string, device: string): Promise<void> {
    await db.prepare(`INSERT INTO po_poem_writers (poem_id, device, turns) VALUES (?,?,1) ON CONFLICT(poem_id, device) DO UPDATE SET turns = turns + 1`).bind(poemId, device).run();
}

/** 重算并回写一首诗的句数；够篇幅就封存，并推进册子计数/完结。 */
async function syncPoem(db: D1Database, poem: PoemRow): Promise<PoemRow> {
    const cnt = await db.prepare(`SELECT COUNT(*) AS n FROM po_poem_lines WHERE poem_id = ?`).bind(poem.id).first<{ n: number }>();
    const lineCount = cnt?.n ?? 0;
    let status = poem.status;
    let sealedAt = poem.sealed_at;
    if (status === 'open' && lineCount >= poem.target_lines) {
        status = 'sealed';
        sealedAt = Date.now();
        // 册子已封存诗数 = 实算
        const sc = await db.prepare(`SELECT COUNT(*) AS n FROM po_poems WHERE booklet_id = ? AND (status = 'sealed' OR id = ?)`).bind(poem.booklet_id, poem.id).first<{ n: number }>();
        const sealedCount = sc?.n ?? 0;
        const bk = await db.prepare(`SELECT poems_target FROM po_booklets WHERE id = ?`).bind(poem.booklet_id).first<{ poems_target: number }>();
        const bookletDone = bk ? sealedCount >= bk.poems_target : false;
        await db.prepare(`UPDATE po_booklets SET poem_count = ?, status = CASE WHEN ? THEN 'done' ELSE status END WHERE id = ?`)
            .bind(sealedCount, bookletDone ? 1 : 0, poem.booklet_id).run();
    }
    await db.prepare(`UPDATE po_poems SET line_count = ?, status = ?, sealed_at = ? WHERE id = ?`).bind(lineCount, status, sealedAt, poem.id).run();
    return { ...poem, line_count: lineCount, status, sealed_at: sealedAt };
}

/** 按 po_votes 重算某封信的赞/踩并回写（展示用，按设备计数）。 */
async function recountVotes(db: D1Database, letterId: string): Promise<{ likes: number; dislikes: number }> {
    const r = await db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0)  AS likes,
                COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0) AS dislikes
         FROM po_votes WHERE letter_id = ?`
    ).bind(letterId).first<{ likes: number; dislikes: number }>();
    const likes = r?.likes ?? 0, dislikes = r?.dislikes ?? 0;
    await db.prepare(`UPDATE po_letters SET likes = ?, dislikes = ? WHERE id = ?`).bind(likes, dislikes, letterId).run();
    return { likes, dislikes };
}

/**
 * 按「不同 IP」去重统计点踩数，用于自动删除判定。
 * 防止一个人伪造多个 device（同一 IP）刷满阈值删信；无 IP 时退化为按设备计。
 */
async function countDislikeIps(db: D1Database, letterId: string): Promise<number> {
    const r = await db.prepare(
        `SELECT COUNT(DISTINCT COALESCE(NULLIF(ip_hash, ''), 'u' || uid)) AS n
         FROM po_votes WHERE letter_id = ? AND vote = -1`
    ).bind(letterId).first<{ n: number }>();
    return r?.n ?? 0;
}

/** 把 IP 加盐哈希成桶 key（不可逆，不存原始 IP）。 */
async function hashIp(ip: string, salt: string): Promise<string> {
    const data = new TextEncoder().encode(`${salt}:${ip}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/**
 * 固定窗口限流：单条 upsert 原子累加，超阈值返回 true。
 * windowMs 指定窗口长度；cost 指定本次消耗的额度（批量端点按条数计，防止单请求塞满 MAX_BATCH 绕过）。
 */
async function rateLimited(db: D1Database, ipHash: string, action: string, limit: number, windowMs = WINDOW_MS, cost = 1): Promise<boolean> {
    if (!ipHash || limit <= 0) return false;
    const now = Date.now();
    const bucket = `${ipHash}:${action}`;
    const row = await db.prepare(
        `INSERT INTO po_ratelimit (bucket, count, reset_at) VALUES (?, ?, ?)
         ON CONFLICT(bucket) DO UPDATE SET
           count    = CASE WHEN reset_at <= ? THEN ? ELSE count + ? END,
           reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
         RETURNING count`
    ).bind(bucket, cost, now + windowMs, now, cost, cost, now, now + windowMs).first<{ count: number }>();
    return (row?.count ?? cost) > limit;
}

/** 校验管理员令牌（Authorization: Bearer 或 ?token=）。 */
function isAdmin(req: Request, url: URL, env: Env): boolean {
    if (!env.ADMIN_TOKEN) return false;
    const auth = req.headers.get('Authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const token = bearer || url.searchParams.get('token') || '';
    return token === env.ADMIN_TOKEN;
}

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
        if (!env.DB) return json({ ok: false, error: 'D1 binding "DB" 未配置' }, 500);

        const url = new URL(req.url);
        const path = url.pathname.replace(/\/+$/, '');
        const ends = (p: string) => path === p || path.endsWith(p);
        const maxReplies = num(env.PO_MAX_REPLIES, 3) || 3;
        const dislikeLimit = num(env.PO_DISLIKE_LIMIT, 5) || 5;

        // 限流准备：拿 IP 哈希（盐缺省也能用，只是可被猜测）
        const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || '';
        const ipHash = ip ? await hashIp(ip, env.PO_IP_SALT || 'po') : '';
        const tooMany = (action: string, limit: number, windowMs?: number, cost?: number) => rateLimited(env.DB, ipHash, action, limit, windowMs, cost);

        try {
            await ensureSchema(env.DB);

            if (req.method === 'GET' && ends('/health')) {
                return json({ ok: true, service: 'sullyos-post-office', maxReplies, dislikeLimit, admin: !!env.ADMIN_TOKEN });
            }

            // ── 管理（纯 API，无前端）─────────────────────────────
            if (ends('/admin/list') && req.method === 'GET') {
                if (!isAdmin(req, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const limit = Math.min(Math.max(num(url.searchParams.get('limit') || '', 50), 1), 200);
                const rows = await env.DB.prepare(
                    `SELECT id, pen, content, lang, created_at, reply_count, likes, dislikes, views
                     FROM po_letters ORDER BY dislikes DESC, created_at DESC LIMIT ?`
                ).bind(limit).all<any>();
                return json({ ok: true, letters: rows.results || [] });
            }
            if (ends('/admin/delete') && req.method === 'POST') {
                if (!isAdmin(req, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const body: any = await req.json().catch(() => ({}));
                const rawIds: string[] = Array.isArray(body.letterIds)
                    ? body.letterIds : (body.letterId ? [body.letterId] : []);
                const ids = rawIds.slice(0, 100).map(String);
                if (ids.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                await deleteLetters(env.DB, ids);
                // 只报实际删除的数量；超 100 的部分未删，提示客户端分批
                return json({ ok: true, deleted: ids.length, truncated: rawIds.length > ids.length });
            }

            // ── 投票：点赞 / 点踩(=举报) / 撤销 ──────────────────
            if (req.method === 'POST' && ends('/vote')) {
                if (await tooMany('vote', num(env.PO_RATE_VOTES, 120))) return json({ ok: false, error: 'rate limited' }, 429);
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const letterId = String(body.letterId || '');
                const vote = body.vote === 1 ? 1 : body.vote === -1 ? -1 : 0;
                if (!device || !letterId) return json({ ok: false, error: 'bad request' }, 400);
                const exists = await env.DB.prepare(`SELECT id FROM po_letters WHERE id = ?`).bind(letterId).first();
                if (!exists) return json({ ok: true, deleted: true, likes: 0, dislikes: 0 });
                const uid = await getUid(env.DB, device);
                if (vote === 0) {
                    await env.DB.prepare(`DELETE FROM po_votes WHERE letter_id = ? AND uid = ?`).bind(letterId, uid).run();
                } else {
                    await env.DB.prepare(
                        `INSERT INTO po_votes (letter_id, uid, vote, at, ip_hash) VALUES (?,?,?,?,?)
                         ON CONFLICT(letter_id, uid) DO UPDATE SET vote = ?, at = ?, ip_hash = ?`
                    ).bind(letterId, uid, vote, Date.now(), ipHash, vote, Date.now(), ipHash).run();
                }
                const { likes, dislikes } = await recountVotes(env.DB, letterId);
                // 点踩(=举报)满阈值 → 删信。阈值按「不同 IP」算，防伪造 device 刷删
                if (vote === -1 && await countDislikeIps(env.DB, letterId) >= dislikeLimit) {
                    await deleteLetters(env.DB, [letterId]);
                    return json({ ok: true, deleted: true, likes, dislikes });
                }
                return json({ ok: true, likes, dislikes });
            }

            // ── 上传待寄出的信 ──────────────────────────────────
            if (req.method === 'POST' && ends('/letters')) {
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const letters: any[] = Array.isArray(body.letters) ? body.letters.slice(0, MAX_BATCH) : [];
                if (!device || letters.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                // 投信：同一 IP 5 小时内最多 PO_RATE_LETTERS 条（默认 5），按实际条数计
                if (await tooMany('letters', num(env.PO_RATE_LETTERS, 5), LETTERS_WINDOW_MS, letters.length)) return json({ ok: false, error: 'rate limited' }, 429);
                const ids: string[] = [];
                const now = Date.now();
                for (const l of letters) {
                    const content = clip(l.content);
                    if (!content.trim()) continue;
                    const id = uuid();
                    ids.push(id);
                    await env.DB.prepare(`INSERT INTO po_letters (id, device, pen, content, lang, created_at) VALUES (?,?,?,?,?,?)`)
                        .bind(id, device, String(l.pen || '匿名').slice(0, 60), content, String(l.lang || '').slice(0, 16), now).run();
                }
                return json({ ok: true, ids });
            }

            // ── 随机抽别人的、还能回的信（抽到即 +1 浏览量）────────
            if (req.method === 'GET' && ends('/inbox')) {
                const device = String(url.searchParams.get('device') || '').slice(0, 80);
                const limit = Math.min(Math.max(num(url.searchParams.get('limit') || '', 5), 1), 10);
                if (!device) return json({ ok: false, error: 'bad request' }, 400);
                const rows = await env.DB.prepare(
                    `SELECT id, pen, content, created_at, likes, dislikes, views, reply_count FROM po_letters
                     WHERE device != ? AND reply_count < ?
                       AND id NOT IN (SELECT letter_id FROM po_picks WHERE device = ?)
                     ORDER BY RANDOM() LIMIT ?`
                ).bind(device, maxReplies, device, limit).all<any>();
                const letters = rows.results || [];
                const now = Date.now();
                // 查询已排除"抽过的"，故返回的每封都是新抽到 → 直接 views++（天然去重）
                for (const r of letters) {
                    await env.DB.prepare(`INSERT OR IGNORE INTO po_picks (device, letter_id, at) VALUES (?,?,?)`).bind(device, r.id, now).run();
                    await env.DB.prepare(`UPDATE po_letters SET views = views + 1 WHERE id = ?`).bind(r.id).run();
                    r.views = (r.views || 0) + 1;
                }
                return json({ ok: true, letters });
            }

            // ── 上传回信 ────────────────────────────────────────
            if (req.method === 'POST' && ends('/replies')) {
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const replies: any[] = Array.isArray(body.replies) ? body.replies.slice(0, MAX_BATCH) : [];
                if (!device || replies.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                // 回信：每分钟上限按实际条数计
                if (await tooMany('replies', num(env.PO_RATE_REPLIES, 60), undefined, replies.length)) return json({ ok: false, error: 'rate limited' }, 429);
                const now = Date.now();
                let accepted = 0;
                for (const rp of replies) {
                    const letterId = String(rp.letterId || '');
                    const content = clip(rp.content);
                    if (!letterId || !content.trim()) continue;
                    const lt = await env.DB.prepare(`SELECT reply_count FROM po_letters WHERE id = ?`).bind(letterId).first<any>();
                    if (!lt || lt.reply_count >= maxReplies) continue;
                    await env.DB.prepare(`INSERT INTO po_replies (id, letter_id, device, pen, content, created_at) VALUES (?,?,?,?,?,?)`)
                        .bind(uuid(), letterId, device, String(rp.pen || '匿名').slice(0, 60), content, now).run();
                    await env.DB.prepare(`UPDATE po_letters SET reply_count = reply_count + 1 WHERE id = ?`).bind(letterId).run();
                    accepted++;
                }
                return json({ ok: true, accepted });
            }

            // ── 取回我寄出的信上的回复 + 各信的赞/踩/浏览量 ────────
            if (req.method === 'GET' && ends('/replies')) {
                const device = String(url.searchParams.get('device') || '').slice(0, 80);
                if (!device) return json({ ok: false, error: 'bad request' }, 400);
                const replies = await env.DB.prepare(
                    `SELECT r.id, r.letter_id, r.pen, r.content, r.created_at
                     FROM po_replies r JOIN po_letters l ON l.id = r.letter_id
                     WHERE l.device = ? ORDER BY r.created_at ASC LIMIT 200`
                ).bind(device).all<any>();
                const stats = await env.DB.prepare(
                    `SELECT id, likes, dislikes, views, reply_count, created_at FROM po_letters WHERE device = ?`
                ).bind(device).all<any>();
                return json({ ok: true, replies: replies.results || [], letters: stats.results || [] });
            }

            // ── 作者删自己的信（原 release）────────────────────────
            if (req.method === 'POST' && ends('/release')) {
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const letterIds: string[] = Array.isArray(body.letterIds) ? body.letterIds.slice(0, 100) : [];
                if (!device || letterIds.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                const mine: string[] = [];
                for (const id of letterIds) {
                    const lt = await env.DB.prepare(`SELECT device FROM po_letters WHERE id = ?`).bind(String(id)).first<any>();
                    if (lt && lt.device === device) mine.push(String(id)); // 只能删自己的
                }
                await deleteLetters(env.DB, mine);
                return json({ ok: true });
            }

            // ════════ 信号坠落处 / 接龙诗 ════════════════════════════

            // ── 读当前态：册子规格 + 当前那首未写完的诗（全文）+ 几首封存的诗供找灵感 ──
            if (req.method === 'GET' && ends('/poem/current')) {
                const myDev = String(url.searchParams.get('device') || '').slice(0, 80) || undefined;
                const booklet = await ensureBooklet(env.DB);
                const open = await getOpenPoem(env.DB, booklet.id);
                const poem = open ? poemView(open, await loadLines(env.DB, open.id), myDev) : null;
                // 起新篇时给角色读的「之前的诗」（全局最近封存的几首）
                const recentRows = await env.DB.prepare(`SELECT * FROM po_poems WHERE status = 'sealed' ORDER BY sealed_at DESC LIMIT 3`).all<PoemRow>();
                const recent = [];
                for (const r of (recentRows.results || [])) recent.push(poemView(r, await loadLines(env.DB, r.id), myDev));
                const paused = (await getFlag(env.DB, PAUSE_KEY)) === '1';
                return json({ ok: true, booklet: bookletView(booklet), poem, recent, paused });
            }

            // ── 抢写诗会话锁。抢到才返回当前态（读最新全文）；抢不到（别人正在写/暂停）
            //    客户端据此在调 LLM 前就走人，不浪费 token。──
            if (req.method === 'POST' && ends('/poem/lock')) {
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                if (!device) return json({ ok: false, error: 'bad request' }, 400);
                if ((await getFlag(env.DB, PAUSE_KEY)) === '1') return json({ ok: true, acquired: false, paused: true });
                const now = Date.now();
                const token = uuid();
                await env.DB.prepare(`INSERT OR IGNORE INTO po_signal_lock (id, holder, expires_at) VALUES ('lock','',0)`).run();
                // 原子抢占：仅当当前无人持有 或 已过期时才改 holder（SQLite 串行化写，天然防并发）
                await env.DB.prepare(
                    `UPDATE po_signal_lock SET holder = ?, expires_at = ? WHERE id = 'lock' AND (holder = '' OR holder IS NULL OR expires_at < ?)`
                ).bind(token, now + SIGNAL_LOCK_TTL, now).run();
                const cur = await env.DB.prepare(`SELECT holder FROM po_signal_lock WHERE id = 'lock'`).first<{ holder: string }>();
                if (cur?.holder !== token) return json({ ok: true, acquired: false }); // 没抢到，有人正在写
                // 抢到了 → 在锁内读当前态返回（保证写诗者读的是最新全文）
                const myDev = device;
                const booklet = await ensureBooklet(env.DB);
                const open = await getOpenPoem(env.DB, booklet.id);
                // 配额：当前这首诗里该 user 已落笔满额 → 立即放锁、打回（客户端据此在调 LLM 前跳过）
                if (open && (await getTurns(env.DB, open.id, myDev)) >= SIG_MAX_TURNS) {
                    await env.DB.prepare(`UPDATE po_signal_lock SET holder = '', expires_at = 0 WHERE holder = ?`).bind(token).run();
                    return json({ ok: true, acquired: false, quota: true });
                }
                const poem = open ? poemView(open, await loadLines(env.DB, open.id), myDev) : null;
                const recentRows = await env.DB.prepare(`SELECT * FROM po_poems WHERE status = 'sealed' ORDER BY sealed_at DESC LIMIT 3`).all<PoemRow>();
                const recent = [];
                for (const r of (recentRows.results || [])) recent.push(poemView(r, await loadLines(env.DB, r.id), myDev));
                return json({ ok: true, acquired: true, token, booklet: bookletView(booklet), poem, recent, paused: false });
            }

            // ── 放锁（写完/出错都调；带 TTL 兜底，漏放也会自动过期）──
            if (req.method === 'POST' && ends('/poem/unlock')) {
                const body: any = await req.json().catch(() => ({}));
                const token = String(body.token || '');
                if (token) await env.DB.prepare(`UPDATE po_signal_lock SET holder = '', expires_at = 0 WHERE holder = ?`).bind(token).run();
                return json({ ok: true });
            }

            // ── 起新篇：自拟标题 + 第一句 + 已 roll 的篇幅。仅当前无 open 诗时允许 ──
            if (req.method === 'POST' && ends('/poem/start')) {
                if ((await getFlag(env.DB, PAUSE_KEY)) === '1') return json({ ok: false, error: 'paused' }, 423);
                if (await tooMany('poem', num(env.PO_RATE_REPLIES, 60))) return json({ ok: false, error: 'rate limited' }, 429);
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const pen = String(body.pen || '匿名').slice(0, 60);
                const booklet = await ensureBooklet(env.DB);
                const existing = await getOpenPoem(env.DB, booklet.id);
                if (existing) {
                    // 已经有人开了头 → 让客户端改去接龙
                    return json({ ok: false, error: 'poem-open', booklet: bookletView(booklet), poem: poemView(existing, await loadLines(env.DB, existing.id), device) }, 409);
                }
                const title = clipLine(body.title, 40) || '无题';
                const brief = clipLine(body.brief, 200) || null;                       // 发起者定的主题/方向，给后来者做参考
                const target = Math.min(Math.max(parseInt(String(body.targetLines), 10) || booklet.lines_min, booklet.lines_min), booklet.lines_max);
                const firstLines = takeLines(body.lines, body.firstLine, booklet.chars_per_line, Math.min(2, target)); // 开头 1~2 行
                if (!device || firstLines.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                const now = Date.now();
                const poemId = uuid();
                await env.DB.prepare(`INSERT INTO po_poems (id, booklet_id, title, brief, target_lines, line_count, status, starter_pen, created_at) VALUES (?,?,?,?,?,0,'open',?,?)`)
                    .bind(poemId, booklet.id, title, brief, target, pen, now).run();
                let seq = 0;
                for (const ln of firstLines) {
                    seq += 1;
                    await env.DB.prepare(`INSERT INTO po_poem_lines (id, poem_id, booklet_id, seq, device, pen, content, created_at) VALUES (?,?,?,?,?,?,?,?)`)
                        .bind(uuid(), poemId, booklet.id, seq, device, pen, ln, now).run();
                }
                await bumpTurns(env.DB, poemId, device); // 起新篇算该 user 在这首里的第 1 次落笔
                const poemRow = (await env.DB.prepare(`SELECT * FROM po_poems WHERE id = ?`).bind(poemId).first<PoemRow>())!;
                const synced = await syncPoem(env.DB, poemRow);
                return json({ ok: true, booklet: bookletView(await ensureBooklet(env.DB)), poem: poemView(synced, await loadLines(env.DB, poemId), device) });
            }

            // ── 接龙：给指定诗续一句。写满篇幅自动封存 ──
            if (req.method === 'POST' && ends('/poem/append')) {
                if ((await getFlag(env.DB, PAUSE_KEY)) === '1') return json({ ok: false, error: 'paused' }, 423);
                if (await tooMany('poem', num(env.PO_RATE_REPLIES, 60))) return json({ ok: false, error: 'rate limited' }, 429);
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const pen = String(body.pen || '匿名').slice(0, 60);
                const poemId = String(body.poemId || '');
                if (!device || !poemId) return json({ ok: false, error: 'bad request' }, 400);
                const poem = await env.DB.prepare(`SELECT * FROM po_poems WHERE id = ?`).bind(poemId).first<PoemRow>();
                if (!poem) return json({ ok: true, gone: true });
                if (poem.status !== 'open') return json({ ok: true, sealed: true, poem: poemView(poem, await loadLines(env.DB, poemId), device) });
                // 配额兜底（主检查在 /poem/lock，这里防绕过/竞态）：该 user 在这首里已落笔满额
                if ((await getTurns(env.DB, poemId, device)) >= SIG_MAX_TURNS) {
                    return json({ ok: true, quota: true, poem: poemView(poem, await loadLines(env.DB, poemId), device) });
                }
                // 注：不做「读到旧状态就作废」的乐观锁——那会把已经生成（已花 token）的句子
                // 扔掉。接龙撞车罕见、且现代诗松，宁可把这句接到末尾（偶尔接的是一步前的诗，
                // 下一个人会自然缝合），也不浪费用户 token。seq=MAX+1，UNIQUE 只兜底真正同刻并发。
                const bkRow = await env.DB.prepare(`SELECT chars_per_line FROM po_booklets WHERE id = ?`).bind(poem.booklet_id).first<{ chars_per_line: number }>();
                // 收 1~2 行；再按「离篇幅还差几句」夹一下，别一下写超封笔线
                const curCnt = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM po_poem_lines WHERE poem_id = ?`).bind(poemId).first<{ n: number }>())?.n ?? 0;
                const roomLeft = Math.max(0, poem.target_lines - curCnt);
                const contents = takeLines(body.lines, body.content, bkRow?.chars_per_line ?? SIG_CPL, Math.max(1, Math.min(2, roomLeft || 1)));
                for (const content of contents) {
                    // seq = 当前最大 + 1；(poem_id,seq) 唯一，并发抢同号时第二条抛错 → 吞掉本句
                    try {
                        await env.DB.prepare(
                            `INSERT INTO po_poem_lines (id, poem_id, booklet_id, seq, device, pen, content, created_at)
                             SELECT ?, ?, ?, COALESCE(MAX(seq),0)+1, ?, ?, ?, ? FROM po_poem_lines WHERE poem_id = ?`
                        ).bind(uuid(), poemId, poem.booklet_id, device, pen, content, Date.now(), poemId).run();
                    } catch { /* 抢到同一 seq，本次落空，下个周期再续 */ }
                }
                if (contents.length > 0) await bumpTurns(env.DB, poemId, device); // 这次落笔计入配额
                const synced = await syncPoem(env.DB, poem);
                return json({ ok: true, sealed: synced.status === 'sealed', poem: poemView(synced, await loadLines(env.DB, poemId), device) });
            }

            // ── 翻阅诗集：已封存的诗（含全文），最近优先。mine=1 只看本机参与过的 ──
            if (req.method === 'GET' && ends('/poem/feed')) {
                const limit = Math.min(Math.max(num(url.searchParams.get('limit') || '', 30), 1), 100);
                const bookletId = url.searchParams.get('booklet') || '';
                const myDev = String(url.searchParams.get('device') || '').slice(0, 80) || undefined;
                const mineOnly = url.searchParams.get('mine') === '1' && myDev;
                let rows;
                if (mineOnly) {
                    rows = await env.DB.prepare(`SELECT * FROM po_poems WHERE status = 'sealed' AND id IN (SELECT DISTINCT poem_id FROM po_poem_lines WHERE device = ?) ORDER BY sealed_at DESC LIMIT ?`).bind(myDev, limit).all<PoemRow>();
                } else if (bookletId) {
                    rows = await env.DB.prepare(`SELECT * FROM po_poems WHERE status = 'sealed' AND booklet_id = ? ORDER BY sealed_at DESC LIMIT ?`).bind(bookletId, limit).all<PoemRow>();
                } else {
                    rows = await env.DB.prepare(`SELECT * FROM po_poems WHERE status = 'sealed' ORDER BY sealed_at DESC LIMIT ?`).bind(limit).all<PoemRow>();
                }
                const poems = [];
                for (const r of (rows.results || [])) poems.push(poemView(r, await loadLines(env.DB, r.id), myDev));
                return json({ ok: true, poems });
            }

            // ── [管理] 发布一本新空白册子（关掉当前 open 册子，开新的）──
            if (req.method === 'POST' && ends('/poem/booklet')) {
                if (!isAdmin(req, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const body: any = await req.json().catch(() => ({}));
                await env.DB.prepare(`UPDATE po_booklets SET status = 'done' WHERE status = 'open'`).run();
                const id = uuid();
                const lmin = Math.max(1, parseInt(String(body.linesMin), 10) || SIG_LMIN);
                const lmax = Math.max(lmin, parseInt(String(body.linesMax), 10) || SIG_LMAX);
                await env.DB.prepare(
                    `INSERT INTO po_booklets (id, title, subtitle, theme, poems_target, poem_count, lines_min, lines_max, chars_per_line, status, created_at)
                     VALUES (?,?,?,?,?,0,?,?,?, 'open', ?)`
                ).bind(id, clipLine(body.title, 40) || SIG_TITLE, clipLine(body.subtitle, 40) || SIG_SUB, clipLine(body.theme, 200) || null,
                    Math.max(1, parseInt(String(body.poemsTarget), 10) || SIG_POEMS), lmin, lmax,
                    Math.max(1, parseInt(String(body.charsPerLine), 10) || SIG_CPL), Date.now()).run();
                return json({ ok: true, booklet: bookletView((await env.DB.prepare(`SELECT * FROM po_booklets WHERE id = ?`).bind(id).first<BookletRow>())!) });
            }

            // ── [管理] 列出全部诗（open 在前，再按时间倒序）+ 当前暂停态 ──
            if (req.method === 'GET' && ends('/poem/admin-list')) {
                if (!isAdmin(req, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const limit = Math.min(Math.max(num(url.searchParams.get('limit') || '', 100), 1), 300);
                const rows = await env.DB.prepare(
                    `SELECT * FROM po_poems ORDER BY (status = 'open') DESC, COALESCE(sealed_at, created_at) DESC LIMIT ?`
                ).bind(limit).all<PoemRow>();
                const poems = [];
                for (const r of (rows.results || [])) poems.push(poemView(r, await loadLines(env.DB, r.id)));
                const paused = (await getFlag(env.DB, PAUSE_KEY)) === '1';
                return json({ ok: true, poems, paused });
            }

            // ── [管理] 删一整首诗 或 删单句 ──
            if (req.method === 'POST' && ends('/poem/admin-delete')) {
                if (!isAdmin(req, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const body: any = await req.json().catch(() => ({}));
                const poemId = String(body.poemId || '');
                const seq = parseInt(String(body.seq), 10);
                if (poemId && Number.isFinite(seq)) {
                    // 删单句（按 poemId + seq）→ 重算句数（不自动改封存态）
                    await env.DB.prepare(`DELETE FROM po_poem_lines WHERE poem_id = ? AND seq = ?`).bind(poemId, seq).run();
                    const cnt = await env.DB.prepare(`SELECT COUNT(*) AS n FROM po_poem_lines WHERE poem_id = ?`).bind(poemId).first<{ n: number }>();
                    await env.DB.prepare(`UPDATE po_poems SET line_count = ? WHERE id = ?`).bind(cnt?.n ?? 0, poemId).run();
                    return json({ ok: true, deleted: 'line' });
                }
                if (poemId) {
                    const p = await env.DB.prepare(`SELECT booklet_id, status FROM po_poems WHERE id = ?`).bind(poemId).first<{ booklet_id: string; status: string }>();
                    await deletePoem(env.DB, poemId);
                    // 删的是已封存的诗 → 册子封存计数回算
                    if (p && p.status === 'sealed') {
                        const sc = await env.DB.prepare(`SELECT COUNT(*) AS n FROM po_poems WHERE booklet_id = ? AND status = 'sealed'`).bind(p.booklet_id).first<{ n: number }>();
                        await env.DB.prepare(`UPDATE po_booklets SET poem_count = ? WHERE id = ?`).bind(sc?.n ?? 0, p.booklet_id).run();
                    }
                    return json({ ok: true, deleted: 'poem' });
                }
                return json({ ok: false, error: 'bad request' }, 400);
            }

            // ── [管理] 暂停 / 恢复「诗歌推入」（暂停后 start/append 一律 423）──
            if (req.method === 'POST' && ends('/poem/admin-pause')) {
                if (!isAdmin(req, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const body: any = await req.json().catch(() => ({}));
                await setFlag(env.DB, PAUSE_KEY, body.paused ? '1' : '0');
                return json({ ok: true, paused: !!body.paused });
            }

            return json({ ok: false, error: 'not found' }, 404);
        } catch (e: any) {
            return json({ ok: false, error: e?.message || 'server error' }, 500);
        }
    },
};
