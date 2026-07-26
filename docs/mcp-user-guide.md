# SullyOS 接入 MCP 工具服务器 · 用户教程

> 这份教程写给两类读者：**想给角色外接工具的用户**，以及**被用户拉来帮忙的 AI 助手**。
> 它是自包含的——AI 助手读完本文即可带用户走完全程，不需要读 SullyOS 源码。
>
> 如果你是 AI 助手：请先问清用户两件事——①想接什么工具（现成服务还是某个开源项目）；
> ②服务器打算跑在哪（云端 / 用户自己的电脑 / 电脑+内网穿透）。然后按「三条路线」对号入座。

## 一、背景：SullyOS 的 MCP 客户端长什么样

SullyOS 是**纯静态网页**（通常部署在 GitHub Pages），没有自己的后端：

- 所有 MCP 请求由**用户的浏览器直接发出**，配置（URL/Token/自定义请求头）只存用户本机，不经过任何中间服务器。
- 好处是隐私自由；代价是 **MCP 服务器需要用户自己准备**，且要过浏览器这一关（CORS、混合内容）。

### 客户端硬性约束（AI 助手请务必记住这几条）

| 约束 | 说明 |
|------|------|
| 传输协议 | 仅支持 **Streamable HTTP**（MCP 2025-03-26+ 的单端点 POST 传输，含 SSE 响应体）。**不支持** stdio 本地进程、不支持旧版 HTTP+SSE 双端点 |
| 鉴权 | 支持**静态 Bearer Token**，也支持 Key-Value 自定义请求头（如 `X-API-Key`、`XBY-APIKEY`）。**没有实现 OAuth 登录流程**——OAuth-only 服务仍需手动申请长期 token/key，或关闭 OAuth |
| CORS | 浏览器直连要求服务器返回正确 CORS 头，最容易漏的是 `Access-Control-Expose-Headers: Mcp-Session-Id`（漏了会静默握手失败）。服务器改不了就走代理（见第四节） |
| 混合内容 | SullyOS 部署在 HTTPS 时，服务器 URL 必须是 `https://`；**唯一例外是 `http://localhost`**（浏览器豁免） |
| 工具结果 | 回填给角色的单次结果上限 20000 字符，超长会截断并标注。超长内容建议服务器端分页 |
| 工具清单 | 只在「测试连接」时拉取并持久化。服务器更新了工具，需要回设置**重新点一次测试连接** |
| 聊天绑定 | 每个服务器可选「通用（所有私聊和群聊）」或绑定指定角色/群聊。**通用服务器所有聊天共用**——接记忆类或游戏类服务器时，按数据隔离需要绑定到具体角色或群聊 |

## 二、三条接入路线（按用户情况选一条）

### 路线 1：用现成的云端 MCP 服务（最简单）

对方给你一个公网 `https://.../mcp` 地址（可能还有 API Key / Token）。

1. 直接跳到第三节「在 SullyOS 里配置」。
2. 挑选服务时的筛选条件：标注 **remote / Streamable HTTP**、鉴权是**无鉴权或 API key**（OAuth 的接不了）。
3. 去哪找：官方注册中心 `registry.modelcontextprotocol.io`、官方列表 `github.com/modelcontextprotocol/servers`、社区目录 mcp.so / Smithery / Glama / PulseMCP。**注意**：目录里大部分是 stdio 本地服务器（`npx`/`uvx` 启动那种），SullyOS 接不了，认准 remote。

### 路线 2：部署在用户自己的电脑上

适合开源 MCP 项目（如记忆库类）。数据在自己硬盘上，不花钱。

1. 按该项目的文档在本机跑起来，**确认它监听的是 Streamable HTTP**（很多项目默认 stdio，需要配置切换，常见开关如 `transport: streamable-http` 或环境变量）。
2. 该项目若默认开 OAuth，找它的关闭开关（通常是 `xxx_REQUIRE_AUTH=false` 之类），本机使用风险可控。
3. 服务器 URL 填 `http://localhost:端口/mcp`——**只在这台电脑的浏览器里有效**。
4. 想在手机上也能用 → 加内网穿透（推荐 Cloudflare Tunnel：免费、自带 HTTPS 域名）。穿透后 URL 变成 `https://你的域名/mcp`，全设备可用；但此时端点暴露公网，见第六节安全注意。
5. Windows 用户常见坑：PowerShell 5.1 不认 `&&`（分开执行或用 `;`）；Python 项目读中文文件报 GBK 错，设环境变量 `PYTHONUTF8=1`。

### 路线 3：自己部署到云上

适合想全平台随时用、且不想家里电脑常开的用户。VPS / Cloudflare Workers / Zeabur / Render 均可。

- 有状态的服务（如记忆库）**必须挂持久磁盘/Volume**，否则重启数据全丢。
- 自己写/自己部署的服务器，在服务端配好 CORS 就能免代理直连，需要这几个响应头（`OPTIONS` 预检返回 204 并带同样的头）：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, GET, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, XBY-APIKEY
Access-Control-Expose-Headers: Mcp-Session-Id
```

## 三、在 SullyOS 里配置（所有路线殊途同归）

1. 打开 SullyOS → **设置** → 找到「**MCP 工具服务器**」板块（带「高级玩法」标签）→ 点「**配置**」
2. 「+ 添加」→ 填：
   - **名称**：随意，如 `Ombre Brain`
   - **服务器 URL**：如 `https://mcp.example.com/mcp` 或 `http://localhost:18001/mcp`
   - **Bearer Token**：服务器要求 `Authorization: Bearer ...` 时填写，否则留空
   - **自定义请求头**：服务商要求 `X-API-Key`、`XBY-APIKEY` 等非 Bearer 鉴权时，点「添加请求头」填写名称和值
   - **代理 URL**：留空 = 直连；被 CORS 拦了才填（见第四节）
3. 点「**测试连接**」→ 成功会显示「✅ 已连接, 发现 N 个工具」
4. **打开该服务器的开关**（不开开关角色用不了）
5. 可选：「**可用聊天**」默认通用；可绑定指定角色或群聊，其他聊天就看不到这批工具
6. 验收：在私聊或已绑定的群聊里让角色用一下工具，界面会短暂显示「正在调用 MCP 工具：xxx」

补充开关「聊天模型支持工具调用」：默认开。若你的聊天模型或 API 中转不支持 function calling（症状：带 tools 参数就报错），关掉它走文字兼容模式；不关也有自动降级，只是多一次试探请求。

## 四、连不上？CORS 代理二选一

「测试连接」报 `Failed to fetch`，基本都是服务器 CORS 没配好且你改不了它。SullyOS 仓库自带两个代理：

| 方式 | 适合 | 步骤 |
|------|------|------|
| **本地代理** | 本地 MCP、或临时试用 | 在 SullyOS 仓库目录跑 `node scripts/mcp-proxy.mjs`，「代理 URL」填 `http://localhost:18061` |
| **自部署 Cloudflare Worker** | 云端 MCP + 手机使用 | 把仓库 `worker/mcp-proxy/worker.js` 粘到自己 CF 账号（Dashboard → Workers → Create → 粘贴 → Deploy），「代理 URL」填 Worker 地址；**建议设 `PROXY_KEY`** 环境变量防白嫖，同时在 SullyOS「代理密钥」里填同一个值 |

代理只做透明转发 + 补 CORS 头，约定为 `<代理URL>?target=<服务器URL>`。刻意不提供公共代理：MCP 流量含你的 Token，不应经过项目方服务器。

## 五、排查速查表

| 症状 | 原因与解法 |
|------|-----------|
| 测试连接 `Failed to fetch` | CORS 拦截 → 配代理（第四节）；或 URL 写错/服务器没起 |
| 测试连接 401/403/500 | 核对服务商要求的鉴权方式：Bearer 填 Token；`X-API-Key` / `XBY-APIKEY` 等填自定义请求头；OAuth-only 需找长期 token/key 或关闭 OAuth |
| HTTPS 站点填 `http://` 地址被拒 | 混合内容拦截 → 换 https（穿透/上云），`http://localhost` 除外 |
| 角色嘴上说用工具但没动静 | 该服务器开关没开；或模型不支持 function calling → 关「聊天模型支持工具调用」 |
| 角色把 `工具名(参数)` 打在聊天里 | 正常兜底行为，系统会代为执行再让角色重说；频繁出现说明模型较弱，换模型更稳 |
| 服务器加了新工具但角色不知道 | 回设置重新点「测试连接」刷新工具清单 |
| 服务器重启后第一次调用失败 | session 失效，客户端会自动重连一次，一般无感；连续失败就重新测试连接 |

## 六、安全注意

- **Token 与自定义请求头只存你本机**，但走代理时流量会经过你自己配的代理——所以代理必须是你自己部署的。
- **无鉴权端点别裸奔公网**：穿透/上云后若服务器关了鉴权，任何拿到 URL 的人都能调你的工具（读写你的记忆）。至少用不易猜的域名并别外传；讲究的在前面挡一层反代校验 `Authorization` 头（SullyOS 填的 Bearer Token 会原样透传，正好用上）。
- **有真实副作用的工具**（发布/下单/删除），角色被要求先向你确认再执行，但别把这当保险——高危工具慎接。
- 通用服务器会被所有私聊和群聊共用；需要隔离时，把服务器绑定给指定角色或群聊（配置里的「可用聊天」）。

---

*开发者视角的实现细节（两层容错、工具循环、代码地图）见 [`docs/mcp-client.md`](./mcp-client.md)。*
