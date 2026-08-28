import { Message } from '../../types';

/**
 * 群聊日志行里一条消息的文本表示——非文本类型用占位符。
 * image 的 content 是 base64（processImage 压的 JPEG）、emoji 是图床 URL，
 * 都不能内联进 prompt：base64 会把上下文撑爆，URL 是纯噪声。
 */
export function messageLogText(m: Message, stickerName?: (url: string) => string): string {
    const rawText = typeof m.content === 'string' ? m.content : '';
    if (m.type === 'image') return '[图片]';
    if (m.type === 'emoji') return `[表情包: ${stickerName ? stickerName(rawText.trim()) : '表情'}]`;
    if (m.type === 'transfer') {
        if (m.metadata?.packetReceipt) return m.metadata.packetReceipt === 'claimed' ? '[领取红包]' : '[退回红包]';
        if (m.metadata?.packet) return `[发红包: ${m.metadata.totalAmount}]`;
        return `[发红包: ${m.metadata?.amount ?? ''}]`;
    }
    if (m.type === 'xhs_card') {
        const note: any = m.metadata?.xhsNote || {};
        const title = String(note.title || rawText || '').trim();
        const author = String(note.author || '').trim();
        const desc = String(note.desc || '').trim();
        const comments = Array.isArray(note.comments) ? note.comments : [];
        const head = `[小红书笔记]${title ? `《${title}》` : ''}${author ? `（作者：${author}）` : ''}`;
        const commentText = comments.length
            ? `\n评论区：\n${comments.slice(0, 15).map((comment: any) => `· ${comment?.author || '匿名'}：${comment?.content || ''}`).join('\n')}`
            : '';
        if (desc) return `${head}\n笔记正文：\n${desc}${commentText}`;
        if (title) return `${head}\n（只获取到标题，没有抓到正文或图片内容，请勿假装看过。）`;
        return `${head}\n（笔记内容未能获取。）`;
    }
    if (m.type === 'webpage_card') {
        const webpage: any = m.metadata?.webpage || {};
        const title = String(webpage.title || rawText || '网页').trim();
        const url = String(webpage.finalUrl || webpage.url || '').trim();
        const video = webpage.video;
        if (video) {
            const platform = video.platformLabel || video.platform || '视频平台';
            const kind = video.contentType === 'image' ? '图文' : '视频';
            const author = video.authorName ? `（作者：${video.authorName}）` : '';
            return [
                `[视频分享] ${platform}${kind}《${title}》${author}`,
                url ? `链接：${url}` : '',
                '（只能读取标题、作者和热度数据，看不到实际画面或声音，请勿假装看过。）',
            ].filter(Boolean).join('\n');
        }
        const bodyRaw = String(webpage.content || webpage.excerpt || '').trim();
        const body = bodyRaw.length > 1500 ? `${bodyRaw.slice(0, 1500)}…（正文过长已截断）` : bodyRaw;
        const head = `[网页分享]《${title}》${url ? `\n链接：${url}` : ''}`;
        return body
            ? `${head}\n网页正文：\n${body}`
            : `${head}\n（网页正文未能抓取，只能看到标题和链接，请勿假装读过。）`;
    }
    if (/^(data:|https?:\/\/)/i.test(rawText.trim())) return '[媒体]';
    return rawText;
}
