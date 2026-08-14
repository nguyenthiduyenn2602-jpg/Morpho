/**
 * amsg 的 Deno 门面 —— 给 Cloudflare worker 换一个国内能直连的地址。
 *
 * 主动消息的 worker 跑在 Cloudflare 上，默认地址是 `*.workers.dev`，这个域名
 * 在国内连不上。这份脚本部署到 Deno Deploy 之后会拿到一个 `*.deno.net` 地址，
 * 它只做一件事：把收到的请求原样转给你自己的 Cloudflare worker，再把响应原样
 * 送回来。业务逻辑、D1 数据库、Cron 定时任务全都还留在 Cloudflare，这一层不存
 * 任何数据、不认任何业务端点。
 *
 * 怎么用：
 *   1. 打开 console.deno.com，点右上角「New Playground」
 *   2. 把这份文件整个贴进去
 *   3. 改下面 `UPSTREAM` 那一行，填你自己的 Cloudflare worker 地址
 *   4. 部署后拿到的 `https://xxx.deno.net` 地址，填进 SullyOS
 *      「设置 → 主动消息 → Worker 地址」，替换原来的 workers.dev 地址
 *
 * 两件值得先知道的事：
 *   - 推送不走这条路。Cloudflare worker 是直接把消息发给 FCM / APNs 的，
 *     跟浏览器怎么访问 worker 是两条独立的路。所以这层挂了不影响收消息，
 *     只影响你打开设置面板改配置。
 *   - 设置页里「去 Cloudflare 控制台」那个链接靠 workers.dev 域名反推 worker
 *     名字，换成 deno.net 之后会退化成跳 worker 列表页，得自己再点一下。
 */

/**
 * 你自己的 Cloudflare amsg worker 地址（就是原来填在 SullyOS 设置里的那个）。
 * 不想把地址写在代码里的话，可以留空不动，改在 Deno 的 Settings → Environment
 * Variables 里加一个 `AMSG_UPSTREAM`，那边的值优先。
 */
const UPSTREAM = 'https://sullyos-amsg.你的账号.workers.dev';

/**
 * 代理自己的自检端点，跟上游无关。部署完直接在浏览器打开它，能看到 JSON 就说明
 * 这一层活着、上游地址也填对了。amsg 的端点都是 `/init-tenant` 这种单词形式，
 * 不会跟双下划线开头的路径撞车。
 */
const HEALTH_PATH = '/__proxy-health';

/**
 * 改完这份脚本请顺手把这里 +1。自检端点会把它报出来，是唯一能确认
 * 「Playground 里跑的到底是哪一版」的办法 —— 版本号不动的话，
 * 贴没贴成功、部署有没有生效，全靠猜。
 */
const PROXY_REVISION = 'amsg-deno-proxy-v2';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

/**
 * 转发响应时必须摘掉的头。
 *
 * 前四个是逐跳（hop-by-hop）头：只描述「这一段 TCP 连接」，跨代理带过去没有意义。
 * `content-encoding` / `content-length` 是更要命的一对 —— fetch 拿到 gzip 响应时
 * 会自动解压，但这两个头描述的还是压缩前的状态。原样带回浏览器的话，浏览器会拿
 * 已经解开的 body 再解一次压，直接读失败。摘掉之后 Deno Deploy 出口会按浏览器的
 * accept-encoding 重新压一遍，端到端的压缩收益不会丢。
 */
const STRIPPED_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
];

/** 上游地址：环境变量优先，都没有就用文件顶上那个常量。统一去掉尾斜杠。 */
const resolveUpstream = (): string =>
  (Deno.env.get('AMSG_UPSTREAM') || UPSTREAM).trim().replace(/\/+$/, '');

/** 占位符没改就算没配 —— 与其闷头往一个不存在的域名转发，不如直接说清楚。 */
export const isConfigured = (upstream: string): boolean =>
  /^https?:\/\//i.test(upstream) && !upstream.includes('你的账号');

/** 把进来的请求改写成打给上游的请求：换掉 host，路径和查询串原样保留。 */
export const buildUpstreamRequest = (request: Request, upstream: string): Request => {
  const incoming = new URL(request.url);
  const target = new URL(upstream);
  // 上游地址允许带路径前缀（少见但合法），拼接时不要把它吃掉。
  target.pathname = `${target.pathname.replace(/\/+$/, '')}${incoming.pathname}`;
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  // host 交给 fetch 按目标地址自己填，否则上游会收到 deno.net 的 host。
  headers.delete('host');
  // 压缩协商也交给 fetch 自己做，别把浏览器那份原样转过去。
  //
  // 浏览器会要 zstd，上游就用 zstd 压着回来；而 fetch 只自动解开它自己协商的那几种
  // （gzip / deflate / br），zstd 不在内，body 于是还是压缩态。下面 relayResponse 又
  // 按「已经解开了」把 content-encoding 摘掉，出口便拿这坨压缩字节当明文再压一层，
  // 浏览器解完外层拿到的还是压缩数据 —— 页面上就是一片乱码。
  //
  // 删掉之后 fetch 用自己认得的编码去协商、拿回明文，摘头才名副其实，
  // 出口再按浏览器的 accept-encoding 重新压一遍，端到端的压缩收益一点不少。
  headers.delete('accept-encoding');

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit = {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // 上游返回 3xx 时不要自动跟过去，原样交给浏览器判断。
    redirect: 'manual',
  };
  // 流式转发请求体（配置上云可能不小）时，fetch 标准要求显式声明 duplex。
  // TS 的 RequestInit 还没收录这个字段，所以在这里单独挂上去。
  if (hasBody) (init as { duplex?: string }).duplex = 'half';

  return new Request(target.toString(), init);
};

/** 原样回传上游响应，只摘掉那些跨代理会出问题的头。 */
export const relayResponse = (upstreamResponse: Response): Response => {
  const headers = new Headers(upstreamResponse.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) headers.delete(name);
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
};

/**
 * 代理层自己造的响应（自检、错误回执）必须带 CORS 头。
 *
 * 不带的话，上游连不上、地址没配这类错误在浏览器里全部显示成
 * 「No 'Access-Control-Allow-Origin' header is present」—— 真正的原因连同
 * 状态码一起被挡在外面，排查的人只能看见一个跟病因毫不相干的 CORS 报错。
 * 转发回来的响应不用管，CF 那边自带 CORS 头。
 */
const SELF_RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: SELF_RESPONSE_HEADERS,
  });

/** 抽出来是为了能在测试里直接调，不必真起一个服务。 */
export const handleRequest = async (request: Request): Promise<Response> => {
  const upstream = resolveUpstream();
  const pathname = new URL(request.url).pathname;

  if (pathname === HEALTH_PATH) {
    return json(
      {
        ok: isConfigured(upstream),
        revision: PROXY_REVISION,
        upstream: isConfigured(upstream) ? upstream : null,
        hint: isConfigured(upstream)
          ? '这一层活着。把当前 deno.net 地址填进 SullyOS 的主动消息设置即可。'
          : '还没填上游地址：改脚本里的 UPSTREAM 常量，或加一个 AMSG_UPSTREAM 环境变量。',
      },
      isConfigured(upstream) ? 200 : 503,
    );
  }

  if (!isConfigured(upstream)) {
    return json({ error: `代理没配上游地址，打开 ${HEALTH_PATH} 看说明。` }, 503);
  }

  try {
    return relayResponse(await fetch(buildUpstreamRequest(request, upstream)));
  } catch (error) {
    // 上游连不上（地址填错、Cloudflare 那边挂了）时给个能看懂的回执，
    // 别让前端只拿到一个没有上下文的 500。
    return json(
      {
        error: '连不上 Cloudflare worker',
        upstream,
        detail: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }
};

Deno.serve(handleRequest);
