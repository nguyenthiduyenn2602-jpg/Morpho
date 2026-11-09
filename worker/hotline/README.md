# Morpho 热线：纯文字云端收件箱

第一版仅收文字，不接收图片、视频或文件。使用 Workers + 独立 D1，无 R2、邮件或 AI 调用。不会读取角色、聊天记录或相册。

## 已部署（2026-11-06）
- 服务：https://morpho-hotline.nguyenthiduyenn2602.workers.dev
- 投稿：POST /api/submissions
- 私人收件箱：/admin（需管理员口令）
- D1：morpho-hotline，绑定 DB；真实 ID 见 wrangler.toml。
- 手机桌面入口已接入，名称 Morpho热线；内页为大壮法律热线。
- 正式配置仅允许生产 GitHub Pages 来源，移除本地预览投稿来源。

## 数据与访问
必填标题、正文、年龄、性别、职业；可选问题和回信邮箱。必须主动勾选投稿说明，包含 AI 辅助整理及去标识化公开使用说明。正文最多6000字符，请求总量上限64KB，服务端拒绝附件。
管理员口令和限流密钥通过 secret binding 保存，不进入前端。会话1小时过期，Cookie 为 Secure/HttpOnly/SameSite=Strict；后台写入校验同源。文字按 textContent 展示。
每来源10分钟12次投稿请求，全局每天200次；登录10分钟8次。IP 仅生成每日轮换 HMAC 限流键，不保存原始 IP；平台自身可能另有日志。每日定时清理过期限流和会话。
相同编号及内容重试不重复保存，冲突内容返回409。失败写入可重试；硬中断遗留 pending 必须人工核实后恢复。
后台每页30封，支持翻页、已读和退出。没有自动审核或自动删除来信。保存期限、人工删除和总容量上限仍需后续完善；请求限流不是费用硬上限。

## 验证
本地 Node 验证：node tools/hotline-local/check.mjs。
Worker 本地验证：使用 Wrangler 初始化 schema.sql，配置忽略的 .dev.vars（ADMIN_SECRET、RATE_SECRET 均随机32字符以上；LOCAL_TEST=true；ALLOWED_ORIGIN=http://127.0.0.1:5186），端口5188启动后运行 node worker/hotline/check.mjs。
云端已验证：虚构文字投稿保存及逐字读取、回执、重复重试、内容冲突、拒绝附件、同意检查、CORS、未登录401、安全会话、CSRF、退出失效。保留一封明确标注的联调测试来信供人工查看。

## 后续部署
使用 Wrangler 登录本账户，确认数据库绑定后运行 wrangler deploy --config worker/hotline/wrangler.toml。两个 secret 已在云端配置，不要打印、提交或嵌入前端。
此次本机 Wrangler 打包受目录读取权限限制，使用官方 Worker 上传接口部署同一份源码：将 admin.html 作为字符串内嵌，并通过 esbuild transform 校验语法。数据库和定时器保持上述配置。
.dev.vars 和 .wrangler 不提交。云端服务部署与 GitHub Pages 发布是两件事。
