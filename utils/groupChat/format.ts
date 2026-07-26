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
    if (/^(data:|https?:\/\/)/i.test(rawText.trim())) return '[媒体]';
    return rawText;
}
