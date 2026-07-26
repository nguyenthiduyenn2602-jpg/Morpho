import React from 'react';

/**
 * HTML 卡片渲染（私聊 MessageItem 与群聊 GroupMessageItem 共用）。
 * 沙盒 iframe：禁用脚本 / 表单提交 / 弹窗，避免任意 HTML 越权访问父页面。
 * srcDoc 用一个全宽中心化的 wrapper, 让 270px 的卡片在 iframe 里居中、背景透明。
 * body>* 强制清掉最外层元素的 box-shadow/filter: 模型经常给卡片外层加柔和阴影,
 * 但 iframe 只比卡片宽一点 + 外层 overflow-hidden, 阴影会被裁成一圈"若隐若现的
 * 假边框"贴在卡片周围 —— 聊天里卡片约定是直接贴在聊天背景上、无背景无边框,
 * 这里在渲染端兜底 (对已落库的旧卡片同样生效), 提示词端同步不再教模型加外层阴影。
 */
const HtmlCard: React.FC<{ html: string }> = ({ html }) => {
    const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#334155;}body{display:flex;justify-content:center;padding:0;}*{box-sizing:border-box;}img{max-width:100%;}body>*{box-shadow:none!important;filter:none!important;}</style></head><body>${html}</body></html>`;
    return (
        <div className="rounded-[18px] overflow-hidden bg-transparent max-w-[280px]">
            <iframe
                title="html-card"
                srcDoc={srcDoc}
                // allow-same-origin: 让父页面能读 contentDocument 自动调高度
                // 故意不给 allow-scripts / allow-forms / allow-popups —
                // AI 输出里的 <script> 不会执行, 表单 / 弹窗 / 顶层跳转 也都被拦。
                sandbox="allow-same-origin"
                referrerPolicy="no-referrer"
                className="block w-[280px] min-h-[120px] border-0 bg-transparent"
                style={{ height: 200 }}
                onLoad={(e) => {
                    try {
                        const f = e.currentTarget as HTMLIFrameElement & { __htmlCardRO?: ResizeObserver };
                        const doc = f.contentDocument;
                        if (!doc || !doc.body) return;
                        // 量内容真实高度并把 iframe 调成等高，避免内部滚动。
                        // 上限放宽到 2400，足够长卡片完整展开；真正超长的才会兜底滚动。
                        const fit = () => {
                            try {
                                const root = doc.documentElement;
                                const body = doc.body;
                                const natural = Math.max(
                                    body.scrollHeight, body.offsetHeight,
                                    root ? root.scrollHeight : 0,
                                );
                                const h = Math.min(2400, Math.max(60, natural + 4));
                                f.style.height = h + 'px';
                            } catch { /* 同源读不到时静默 */ }
                        };
                        fit();
                        // 交互卡片（:checked 展开 / 折叠）、动画、字体晚到都会改变高度，
                        // 用 ResizeObserver 持续跟随，让高度始终自适应而不是只量一次。
                        f.__htmlCardRO?.disconnect();
                        if (typeof ResizeObserver !== 'undefined') {
                            const ro = new ResizeObserver(() => fit());
                            ro.observe(doc.body);
                            if (doc.documentElement) ro.observe(doc.documentElement);
                            f.__htmlCardRO = ro;
                        }
                    } catch { /* 同源也读不到时静默 */ }
                }}
            />
        </div>
    );
};

export default HtmlCard;
