// worker/amsg/src/instantChat.test.ts
//
// 即时对话这条路上最要命的是「顺序」和「失败就别落任务」：云端状态没传上去却把任务
// 建了，到点那条 fire 会拿上一轮的上下文答这一轮的话——不报错、不重试，用户只会觉得
// 角色突然听不懂人话。下面每条都对着一种具体的坏法。
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  applyInstantNotificationPolicy,
  buildInstantTimelyBlock,
  handleInstantChat,
  isInstantChatTask,
} from './instantChat';

const USER_ID = '3637dae1-1461-4444-a747-34e406f67acc';
const TASK_UUID = '7a1f0b4c-2c9d-4a3e-8b21-9f0f3c5d7e11';

/** 客户端预加密的信封（内容不重要，形状要对）。 */
const envelope = (tag: string) => ({ iv: `iv-${tag}`, authTag: `tag-${tag}`, encryptedData: `data-${tag}` });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

/** 记下每一次内部转发，顺序本身就是要钉的东西。 */
const makeUpstream = (opts: {
  clientState?: { status: number; body?: unknown };
  scheduleMessage?: { status: number; body?: unknown };
} = {}) => {
  const calls: Array<{ method: string; path: string; search: string; headers: Record<string, string>; body: string }> = [];
  const reply = (spec: { status: number; body?: unknown } | undefined, fallback: unknown) =>
    json(spec?.status ?? 200, spec?.body ?? fallback);
  const upstream = {
    fetch: vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      calls.push({
        method: request.method.toUpperCase(),
        path: url.pathname,
        search: url.search,
        headers: Object.fromEntries(request.headers),
        body: await request.text(),
      });
      if (url.pathname.endsWith('/client-state')) {
        return reply(opts.clientState, { success: true, data: { upserted: 3, skipped: 0 } });
      }
      if (url.pathname.endsWith('/schedule-message')) {
        return reply(opts.scheduleMessage, { success: true, data: { uuid: TASK_UUID, id: 42 } });
      }
      return json(404, { success: false });
    }),
  };
  return { upstream, calls, paths: () => calls.map((c) => `${c.method} ${c.path}`) };
};

/**
 * INSTANT_TICK 绑定的替身。记下叫醒了哪个实例、传了哪个 uuid。
 *
 * `kick` 只负责给 DO 记下 uuid、设 alarm，真正的生成在 alarm 里跑（另一次 invocation，
 * 走 upstream.runTask），所以这条路上根本碰不到 upstream 的执行入口——那是 DO 侧的事，
 * 见 index.ts 的 InstantTickDO。
 */
const makeTick = (opts: { kick?: () => Promise<unknown> } = {}) => {
  const kicks: Array<{ instance: string; uuid: string }> = [];
  return {
    kicks,
    INSTANT_TICK: {
      idFromName: (name: string) => ({ name }),
      get: (id: { name: string }) => ({
        kick: async (uuid: string) => {
          kicks.push({ instance: id.name, uuid });
          return opts.kick ? opts.kick() : undefined;
        },
      }),
    },
  };
};

const post = (
  body: unknown,
  opts: { headers?: Record<string, string>; url?: string } = {},
) => new Request(opts.url ?? 'https://w.example/instant-chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-User-Id': USER_ID, ...(opts.headers ?? {}) },
  body: JSON.stringify(body),
});

const validBody = (extra: Record<string, unknown> = {}) => ({
  statePayload: envelope('state'),
  taskPayload: envelope('task'),
  ...extra,
});

/** 默认参数跑一次。重试梯子清零：钉的是「重了几次」，不是「等了多久」。 */
const run = (args: {
  request: Request;
  env?: Record<string, unknown>;
  upstream: ReturnType<typeof makeUpstream>['upstream'];
  /** 不传就用一个正常工作的替身；要测「Worker 是旧的」显式传 null。 */
  tick?: ReturnType<typeof makeTick> | null;
}) => handleInstantChat({
  request: args.request,
  env: {
    ...(args.tick === null ? {} : { INSTANT_TICK: (args.tick ?? makeTick()).INSTANT_TICK }),
    ...(args.env ?? {}),
  } as any,
  upstream: args.upstream as any,
  json,
  stateBackoffMs: [0, 0, 0],
});

describe('POST /instant-chat — 鉴权', () => {
  it('配了口令而请求没带 → 401，而且一个字节的云端状态都不写', async () => {
    const { upstream, calls } = makeUpstream();
    const response = await run({
      request: post(validBody()),
      env: { AMSG_SERVER_TOKEN: 'secret' },
      upstream,
    });
    expect(response.status).toBe(401);
    // 回归守卫：没有这道门的话，转发出去的 PUT /client-state 会先把状态写进库，
    // 上游那边才 401——一个没通过鉴权的请求已经改了库里的数据。
    expect(calls).toHaveLength(0);
  });

  it('口令不对 → 401，同样不转发', async () => {
    const { upstream, calls } = makeUpstream();
    const response = await run({
      request: post(validBody(), { headers: { 'X-Client-Token': 'wrong' } }),
      env: { AMSG_SERVER_TOKEN: 'secret' },
      upstream,
    });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('口令对得上 → 放行，并把它原样带给上游（上游是权威，还要再验一次）', async () => {
    const { upstream, calls } = makeUpstream();
    const response = await run({
      request: post(validBody(), { headers: { 'X-Client-Token': 'secret' } }),
      env: { AMSG_SERVER_TOKEN: 'secret' },
      upstream,
    });
    expect(response.status).toBe(202);
    expect(calls.every((c) => c.headers['x-client-token'] === 'secret')).toBe(true);
  });

  it('没配口令 → 不校验（跟上游同一套判据）', async () => {
    const { upstream } = makeUpstream();
    expect((await run({ request: post(validBody()), upstream })).status).toBe(202);
  });

  it('缺 X-User-Id / 不是 UUID v4 → 400，不转发', async () => {
    const { upstream, calls } = makeUpstream();
    const noUser = new Request('https://w.example/instant-chat', {
      method: 'POST', body: JSON.stringify(validBody()),
    });
    expect((await run({ request: noUser, upstream })).status).toBe(400);
    const badUser = post(validBody(), { headers: { 'X-User-Id': 'not-a-uuid' } });
    expect((await run({ request: badUser, upstream })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('POST /instant-chat — 请求体', () => {
  it('不是 JSON 对象 → 400', async () => {
    const { upstream, calls } = makeUpstream();
    const bad = new Request('https://w.example/instant-chat', {
      method: 'POST', headers: { 'X-User-Id': USER_ID }, body: 'not json',
    });
    const response = await run({ request: bad, upstream });
    expect(response.status).toBe(400);
    expect((await response.json() as any).error.code).toBe('INVALID_JSON');
    expect(calls).toHaveLength(0);
  });

  it('两个信封形状不对 → 400，且在任何转发之前就挡住', async () => {
    const { upstream, calls } = makeUpstream();
    const noState = await run({ request: post({ taskPayload: envelope('t') }), upstream });
    expect(noState.status).toBe(400);
    expect((await noState.json() as any).error.code).toBe('INVALID_STATE_PAYLOAD');

    // taskPayload 不合格时同样一次都不转发——否则状态先写进去了，任务却建不成，
    // 云端留下一份「用户已经说了这句」而角色永远不会回。
    const noTask = await run({ request: post({ statePayload: envelope('s') }), upstream });
    expect(noTask.status).toBe(400);
    expect((await noTask.json() as any).error.code).toBe('INVALID_TASK_PAYLOAD');
    expect(calls).toHaveLength(0);
  });
});

describe('POST /instant-chat — 严格顺序与失败传播', () => {
  it('顺序：先传云端状态，再建任务', async () => {
    const { upstream, paths } = makeUpstream();
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(202);
    expect(paths()).toEqual(['PUT /client-state', 'POST /schedule-message']);
  });

  it('云端状态失败 → 原样把状态码报回去，而且**绝不建任务**', async () => {
    const { upstream, paths } = makeUpstream({
      clientState: { status: 400, body: { success: false, error: { code: 'TOO_MANY_STATE_ENTRIES' } } },
    });
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INSTANT_CHAT_STATE_FAILED');
    expect(body.error.step).toBe('client-state');
    expect(body.error.upstream.error.code).toBe('TOO_MANY_STATE_ENTRIES');
    // 回归守卫：这一步失败还往下建任务的话，到点那条 fire 会拿上一轮的上下文答这一轮。
    expect(paths()).toEqual(['PUT /client-state']);
  });

  // HTTP ok ≠ 都写进去了：上游按 updatedAt 条件写，被拦的条目在成功体 skippedEntries 里
  // 点名。fire_pack 被拦（设备时钟回拨过）还落任务的话，fire 会拿旧 chat 段答话——用户
  // 拿着 202 白等一轮甚至收到答非所问，且无任何报错。
  it('client-state 200 但 fire_pack 被条件写拦下 → 409 INSTANT_CHAT_STATE_STALE，绝不建任务', async () => {
    const { upstream, paths } = makeUpstream({
      clientState: {
        status: 200,
        body: {
          success: true,
          data: { upserted: 2, skippedEntries: [{ namespace: 'amsg:char:c1', key: 'fire_pack' }] },
        },
      },
    });
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(409);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INSTANT_CHAT_STATE_STALE');
    expect(body.error.step).toBe('client-state');
    expect(paths()).toEqual(['PUT /client-state']);
  });

  it('client-state 200、被拦的只是别的条目（非 fire_pack）→ 照常受理', async () => {
    const { upstream } = makeUpstream({
      clientState: {
        status: 200,
        body: {
          success: true,
          data: { upserted: 2, skippedEntries: [{ namespace: 'amsg:char:c1', key: 'chat_presence' }] },
        },
      },
    });
    expect((await run({ request: post(validBody()), upstream })).status).toBe(202);
  });

  it('建任务失败 → 报 schedule-message 那一步，不假装受理', async () => {
    const { upstream } = makeUpstream({
      scheduleMessage: { status: 409, body: { success: false, error: { code: 'PUSH_SUBSCRIPTION_MISSING' } } },
    });
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(409);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INSTANT_CHAT_TASK_FAILED');
    expect(body.error.step).toBe('schedule-message');
  });

  it('上游回了 200 却没给 uuid → 502（跟不上这一轮，宁可让客户端重发）', async () => {
    const { upstream } = makeUpstream({ scheduleMessage: { status: 200, body: { success: true, data: {} } } });
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(502);
    expect((await response.json() as any).error.code).toBe('INSTANT_CHAT_TASK_UUID_MISSING');
  });

  it('转发带全套加密头：上游照常解密 + 鉴权，包装层不碰用户密钥', async () => {
    const { upstream, calls } = makeUpstream();
    await run({ request: post(validBody()), upstream });
    const state = calls.find((c) => c.path.endsWith('/client-state'))!;
    expect(state.headers['x-user-id']).toBe(USER_ID);
    expect(state.headers['x-payload-encrypted']).toBe('true');
    expect(state.headers['x-encryption-version']).toBe('1');
    // 信封原样搬运，不重新包一层
    expect(JSON.parse(state.body)).toEqual(envelope('state'));
    const task = calls.find((c) => c.path.endsWith('/schedule-message'))!;
    expect(JSON.parse(task.body)).toEqual(envelope('task'));
  });

  it('worker 挂在子路径下时，内部转发跟着挂载点走（上游按后缀匹配）', async () => {
    const { upstream, calls } = makeUpstream();
    await run({
      request: post(validBody(), { url: 'https://w.example/amsg/instant-chat' }),
      upstream,
    });
    expect(calls.map((c) => c.path)).toEqual(['/amsg/client-state', '/amsg/schedule-message']);
  });

  it('202 的形状是 { status: "accepted", uuid }', async () => {
    const { upstream } = makeUpstream();
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'accepted', uuid: TASK_UUID });
  });
});

// 上游 500 的 message 是一句写死的「服务器内部错误」，用户照着它什么也做不了。
// 真实原因（缺表、D1 超时……）由 amsg-server 2.6.0-next.16 起放在 error.cause 里，
// 这里必须原样端到客户端面前——否则他看到的还是那句什么都没说的话。
describe('POST /instant-chat — 把上游 error.cause 里那句真话带回去', () => {
  /** 上游抛异常时的真实响应：泛型 message + 带真因的 cause。 */
  const throwsInside = (
    status = 500,
    cause: Record<string, unknown> | null = {
      stage: 'request',
      name: 'Error',
      message: 'D1_ERROR: no such table: message_outbox',
      code: 'D1_ERROR',
    },
  ) => ({
    status,
    body: {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误', ...(cause ? { cause } : {}) },
    },
  });

  it('client-state 那步：真实原因随 upstreamLog 回给客户端', async () => {
    const { upstream } = makeUpstream({ clientState: throwsInside() } as any);
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INSTANT_CHAT_STATE_FAILED');
    expect(body.error.upstreamLog).toBe('D1_ERROR: no such table: message_outbox');
  });

  it('schedule-message 那步同理', async () => {
    const { upstream } = makeUpstream({ scheduleMessage: throwsInside() } as any);
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INSTANT_CHAT_TASK_FAILED');
    expect(body.error.upstreamLog).toBe('D1_ERROR: no such table: message_outbox');
  });

  it('code 不是 message 前缀时两个都带上（光一句 message 看不出是哪类错）', async () => {
    const { upstream } = makeUpstream({
      clientState: throwsInside(500, {
        stage: 'request', name: 'Error', message: '写不进去', code: 'STORAGE_FAILED',
      }),
    } as any);
    const response = await run({ request: post(validBody()), upstream });
    expect((await response.json() as any).error.upstreamLog).toBe('STORAGE_FAILED: 写不进去');
  });

  it('没有 code 时退回 name', async () => {
    const { upstream } = makeUpstream({
      clientState: throwsInside(500, { stage: 'request', name: 'TypeError', message: '炸了' }),
    } as any);
    const response = await run({ request: post(validBody()), upstream });
    expect((await response.json() as any).error.upstreamLog).toBe('TypeError: 炸了');
  });

  // 4xx 是上游自己判出来的业务错，正文里已经写清了原因；再缀一段内部细节只会让人更迷惑。
  it('4xx 不带 upstreamLog：那不是抛出来的异常，正文本身就是原因', async () => {
    const { upstream } = makeUpstream({
      clientState: { status: 400, body: { success: false, error: { code: 'TOO_MANY_STATE_ENTRIES' } } },
    } as any);
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(400);
    expect((await response.json() as any).error.upstreamLog).toBeUndefined();
  });

  it('上游没给 cause 就不带（老 worker 不会多出一截空白）', async () => {
    const { upstream } = makeUpstream({ clientState: throwsInside(500, null) } as any);
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(500);
    expect((await response.json() as any).error.upstreamLog).toBeUndefined();
  });

  /**
   * 回归守卫：拿真因这件事不许再回去改全局 console。
   *
   * 这段历史值得留一句：上游早先不回 cause，只把真因写进自己的 console.error，
   * 于是这里曾经永久 patch 全局 console.error 去偷听。那是会影响整个 isolate 的副作用，
   * 而且和任何并发请求都在抢同一个全局对象。真因现在由上游随响应体给，
   * 谁都不该再动 console。
   */
  it('不碰全局 console.error（真因来自响应体，不是偷听日志）', async () => {
    const original = console.error;
    const { upstream } = makeUpstream({ clientState: throwsInside() } as any);
    await run({ request: post(validBody()), upstream });
    expect(console.error).toBe(original);
  });
});

// D1 偶尔会把一次写直接判超时（`… object to be reset`），而这一步是整条链上最大的一次写
// （三十多 KB 的 fire_pack）。什么时候来没量出规律（2026-08-09 的观测记在 instantChat.ts
// 那段注释里），而客户端只 POST 一次 /instant-chat，它自己那把重试梯子够不着里面这一跳。
describe('POST /instant-chat — 云端状态那一步遇到 5xx 会重试', () => {
  /** 前 n 次回 5xx，之后回正常成功体。 */
  const flakyClientState = (failures: number) => {
    let seen = 0;
    const upstream = {
      fetch: vi.fn(async (request: Request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/client-state')) {
          seen += 1;
          if (seen <= failures) {
            return json(500, {
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: '服务器内部错误',
                cause: { stage: 'request', name: 'Error', message: 'D1_ERROR: … object to be reset.' },
              },
            });
          }
          return json(200, { success: true, data: { upserted: 3, skipped: 0 } });
        }
        if (path.endsWith('/schedule-message')) return json(200, { success: true, data: { uuid: TASK_UUID } });
        return json(404, { success: false });
      }),
    };
    return { upstream, attempts: () => seen };
  };

  it('第一次超时、第二次写进去 → 照常受理，用户完全无感', async () => {
    const { upstream, attempts } = flakyClientState(1);
    const response = await run({ request: post(validBody()), upstream: upstream as any });
    expect(response.status).toBe(202);
    expect(attempts()).toBe(2);
  });

  it('梯子走完还是 5xx → 才报失败，且真实原因照样带着', async () => {
    const { upstream, attempts } = flakyClientState(99);
    const response = await run({ request: post(validBody()), upstream: upstream as any });
    expect(response.status).toBe(500);
    expect(attempts()).toBe(3);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INSTANT_CHAT_STATE_FAILED');
    expect(body.error.upstreamLog).toContain('object to be reset');
  });

  // 4xx 是上游判出来的业务错（体积超限、时间戳不合法……），重试多少次都是同一个答案，
  // 白等三次还让用户多盯 1.6 秒的「正在输入」。
  it('4xx 不重试，立刻打回', async () => {
    const { upstream, calls } = makeUpstream({
      clientState: { status: 400, body: { success: false, error: { code: 'TOO_MANY_STATE_ENTRIES' } } },
    });
    expect((await run({ request: post(validBody()), upstream })).status).toBe(400);
    expect(calls.filter((c) => c.path.endsWith('/client-state'))).toHaveLength(1);
  });

  it('一次就成的正常轮次只转发一次（别把重试变成常态）', async () => {
    const { upstream, calls } = makeUpstream();
    expect((await run({ request: post(validBody()), upstream })).status).toBe(202);
    expect(calls.filter((c) => c.path.endsWith('/client-state'))).toHaveLength(1);
  });
});

describe('POST /instant-chat — 只有两次内部转发', () => {
  // 顶替上一条不再是包装层的事：supersedesUuid 在加密的任务体里，
  // 上游建新任务的同一事务里取消旧的。包装层多发一条 DELETE 才是回归。
  it('状态在前、建任务在后，没有第三个请求', async () => {
    const { upstream, paths } = makeUpstream();
    await run({ request: post(validBody()), upstream });
    expect(paths()).toEqual(['PUT /client-state', 'POST /schedule-message']);
  });
});

describe('POST /instant-chat — 立即起跳', () => {
  /**
   * 实例名就是任务 uuid：一条任务一个 DO 实例，几条聊天同时在跑才不会互相排队。
   * DO 的 alarm 是一实例一个，共用实例就意味着共用那一个 alarm、只能挨个来。
   */
  it('回完 202 之前叫醒 DO，实例名和 uuid 都是这条任务的', async () => {
    const { upstream } = makeUpstream();
    const tick = makeTick();
    const response = await run({ request: post(validBody()), upstream, tick });

    expect(response.status).toBe(202);
    expect(tick.kicks).toEqual([{ instance: TASK_UUID, uuid: TASK_UUID }]);
  });

  /**
   * 回归守卫：这一跳绝不能再挂回 ctx.waitUntil。
   *
   * waitUntil 的墙钟上限是硬性的 30 秒（从响应发出或客户端断开起算），而一轮带工具
   * 循环的生成动辄几十秒——挂上去就必被砍在半路，日志里只留一条
   * 「waitUntil() tasks did not complete」，用户那边表现为「一直等不到回复」。
   * 生成必须跑在 DO 的 alarm 里（独立 invocation，15 分钟），所以受理这一步只该叫醒
   * DO：`InstantChatUpstream` 只声明了 fetch，压根没有能把生成拉进当前请求的入口。
   */
  it('受理时只发两个转发请求，不碰任何执行入口', async () => {
    const { upstream, paths } = makeUpstream();
    const response = await run({ request: post(validBody()), upstream });
    expect(response.status).toBe(202);
    expect(paths()).toEqual(['PUT /client-state', 'POST /schedule-message']);
  });

  it('叫醒失败不影响已经回出去的 202（任务已落库，cron 每分钟还会来捡）', async () => {
    const { upstream } = makeUpstream();
    const tick = makeTick({ kick: () => Promise.reject(new Error('kick boom')) });
    const response = await run({ request: post(validBody()), upstream, tick });
    expect(response.status).toBe(202);
  });

  /**
   * 回归守卫：老版本 Worker（没有 INSTANT_TICK 绑定）必须明说「去更新」。
   *
   * 这里刻意不退回 cron 兜底然后照回 202：那条路上没有为即时对话放宽的超时，用户会
   * 对着「正在输入」等很久甚至等不到，而界面上没有任何线索告诉他该做什么。
   */
  it('没有 INSTANT_TICK 绑定 → 503 且点名要更新 Worker', async () => {
    const { upstream } = makeUpstream();
    const response = await run({ request: post(validBody()), upstream, tick: null });

    expect(response.status).toBe(503);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INSTANT_CHAT_WORKER_OUTDATED');
    expect(body.error.message).toContain('更新 Worker');
    // 任务本身是建成了的，uuid 要带回去，别让客户端以为整轮没发生过。
    expect(body.error.uuid).toBe(TASK_UUID);
  });
});

describe('isInstantChatTask', () => {
  it('只认显式为 true 的那个标记', () => {
    expect(isInstantChatTask({ amsgInstantChat: true })).toBe(true);
    expect(isInstantChatTask({ amsgInstantChat: 'true' })).toBe(false);
    expect(isInstantChatTask({ charId: 'c' })).toBe(false);
    expect(isInstantChatTask(undefined)).toBe(false);
  });
});

describe('buildInstantTimelyBlock', () => {
  const base = {
    nowMs: Date.UTC(2026, 7, 1, 0, 0),
    tz: { tzId: 'Asia/Shanghai' },
    userTzId: 'Asia/Shanghai',
    targetName: '小明',
    timeAwarenessEnabled: true,
  };

  it('写清「现在几点」，用的是角色自己的时区', () => {
    const block = buildInstantTimelyBlock({ ...base, blocks: [] });
    expect(block).toContain('2026年8月1日 周六 早晨 08:00');
  });

  it('有时差时补一行「对方那边几点」，同时区不补（一份提示词里两个钟会打架）', () => {
    expect(buildInstantTimelyBlock({ ...base, userTzId: 'America/New_York', blocks: [] }))
      .toContain('对方所在时区参考');
    expect(buildInstantTimelyBlock({ ...base, blocks: [] })).not.toContain('对方所在时区参考');
  });

  // 关了时间感知的架空角色在前台连今天几号都读不到，云端这条路也不能偷偷报时。
  // 一个开关两套行为的话，同一个角色在聊天里说不出日期、在即时对话里却精确到分钟。
  it('关了时间感知就一个钟都不给（其余块照常拼）', () => {
    const block = buildInstantTimelyBlock({
      ...base,
      userTzId: 'America/New_York',
      timeAwarenessEnabled: false,
      blocks: ['\n\n【热搜】\n- 某某'],
    });
    expect(block).not.toContain('现在是');
    expect(block).not.toContain('2026年8月1日');
    expect(block).not.toContain('对方所在时区参考');
    expect(block).toContain('【此刻的系统信息·仅你可见】');
    expect(block).toContain('【热搜】');
  });

  // 时间感知关着、其余几块又都是空的：这一块没有任何内容可说，整块都不该有。
  // 留一行光秃秃的标题挂在对话末尾，模型只会当成没说完的乱码。
  it('没时间也没别的可说 → 整块返回空串（调用方据此一条都不追加）', () => {
    expect(buildInstantTimelyBlock({
      ...base, timeAwarenessEnabled: false, blocks: ['', '  ', '\n\n'],
    })).toBe('');
    // 时间感知开着时不受影响：报时本身就是内容
    expect(buildInstantTimelyBlock({ ...base, blocks: [] })).toContain('现在是');
  });

  it('空块整块跳过（拉不到实时世界时不能留一行空标题）', () => {
    const block = buildInstantTimelyBlock({ ...base, blocks: ['', '  ', '\n\n【热搜】\n- 某某'] });
    expect(block).toContain('【热搜】');
    expect(block.split('\n').filter((l) => l.trim() === '【】')).toHaveLength(0);
    expect(block.endsWith('- 某某')).toBe(true);
  });
});

describe('applyInstantNotificationPolicy', () => {
  // 用户正盯着聊天窗口等这条回复，锁屏横幅在这时候弹出来纯属打扰（页面自己会把消息上屏）；
  // 窗口不可见时又必须弹，不然「发完就自由了」这件事没人来叫他。表态写在载荷里，
  // 真正的判定由 SW 的 shouldRenderNotification 按窗口可见性做。
  it('标 when-hidden：前台可见时 SW 不弹系统通知，不可见照弹', () => {
    const push = applyInstantNotificationPolicy(
      { message: 'hi', notification: { title: '来自 Nyah', body: 'hi' } });
    expect(push.notification).toEqual({ title: '来自 Nyah', body: 'hi', show: 'when-hidden' });
  });

  it('载荷本来没有 notification 就不凭空造一个（造出来只会弹一条空白横幅）', () => {
    const push = applyInstantNotificationPolicy({ message: 'hi' });
    expect(push).not.toHaveProperty('notification');
    // 形状不对的也当没有，别把它塞进一个对象里
    expect(applyInstantNotificationPolicy({ message: 'hi', notification: null }).notification).toBeNull();
  });

  // 信封的其余部分（messageId / sessionId / 段号 / 任务身份）全交给库去补。这里多写一份
  // 就是多一处会跟库漂掉的副本，而账本里存的本来就是库发出去的那一份。
  it('除通知策略外一个字段都不添（正文 / metadata 原样保留）', () => {
    const push = applyInstantNotificationPolicy({ message: 'hi', metadata: { directives: [1] } });
    expect(push).toEqual({ message: 'hi', metadata: { directives: [1] } });
  });
});
