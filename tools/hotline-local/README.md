# Morpho 热线本地收发验证
仅用于本机虚构材料测试。第一版仅收文字，拒绝所有附件。
设置 HOTLINE_ADMIN_PASSWORD（16字符以上）和 HOTLINE_DATA_DIR（前端根目录之外）后运行 node tools/hotline-local/server.mjs。
服务监听127.0.0.1:5187，后台 /admin，投稿 /api/submissions。允许本地预览来源 http://127.0.0.1:5186。
运行 node tools/hotline-local/check.mjs 验证文字与背景字段、附件拒绝、必填年龄及同意、来源校验、私有后台、已读和重启持久化。当前预览已改接真实云端；运行此工具不会改变预览的目标地址。
