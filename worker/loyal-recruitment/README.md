# 忠实用户一次性招募 Worker

独立的 Cloudflare Worker + D1 服务。它不与 Post Office 或彼方活动共享 Worker、数据库、
路由或 secrets。客户端本地完成资格判定，本服务只登记通过者的 QQ 与登记时间。

## 部署

```bash
cd worker/loyal-recruitment
wrangler d1 create sullyos-loyal-recruitment
# 把返回的 database_id 写入 wrangler.toml
wrangler secret put GROUP_PASSWORD
wrangler secret put ADMIN_TOKEN
wrangler secret put RECRUIT_IP_SALT
wrangler deploy
```

Worker 会自动创建表，也可以手动执行 `schema.sql`。建议把
`noir2.cc.cd/recruit/*` 单独路由到本 Worker；前端默认请求
`https://noir2.cc.cd/recruit`。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 查看 D1 是否可用、群密码和管理员令牌是否已配置 |
| POST | `/submit` | 登记通过者 QQ，成功后返回群号和密码 |
| GET | `/admin` | 管理员网页：输入 `ADMIN_TOKEN` 后查看名单并下载 CSV |
| GET | `/admin-list?limit=500` | Bearer `ADMIN_TOKEN` 导出登记名单 |

`/submit` 只接受固定的 `criteriaVersion` 和截止时间，但这两项只校验、不入库。默认按不可逆 IP 哈希限制每小时
20 次提交；原始 IP 不入库。响应均带 `Cache-Control: no-store`。

## 配置

| 名字 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `GROUP_ID` | var | `892128017` | 通过后显示的群号 |
| `RATE_SUBMITS` | var | `20` | 每 IP 每小时提交上限 |
| `GROUP_PASSWORD` | secret | — | 通过后显示的入群密码 |
| `ADMIN_TOKEN` | secret | — | 导出 QQ 名单的管理员令牌 |
| `RECRUIT_IP_SALT` | secret | — | 限流 IP 哈希盐 |

密码不要写入仓库。管理员可在浏览器直接打开
`https://noir2.cc.cd/recruit/admin`，输入 `ADMIN_TOKEN` 后查看名单或下载 CSV。令牌只保留在当前页面内存中，
不会写入 URL 或浏览器存储。

命令行导出仍然可用：

```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "https://noir2.cc.cd/recruit/admin-list?limit=5000"
```
