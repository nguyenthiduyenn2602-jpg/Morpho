/**
 * Memory Palace — 检索查询源消息清洗
 *
 * retrieveMemories 的 query 构建曾直接吃原始 Message.content。问题：
 * 聊天里发的图片 content 是整段 base64 data URI（Chat.tsx 的
 * processImage → handleSendText(base64, 'image')，动辄几万字符）——
 * pipeline 的 URL_RE 只剥 http(s) URL，`data:image/...;base64,...` 会
 * 原样切进 spike / sub-spike / rerank / context 多路 query：
 *   - 语义上是纯噪声，稀释真实意图的召回
 *   - 体积上把 Embedding 批量请求的 token 总量顶爆——硅基流动等服务商
 *     直接 400 code 20015 "The parameter is invalid"（「测试连接」单条
 *     短文本正常、一给角色发消息就报错的典型根因）
 *
 * 入库管线早就用 isMessageSemanticallyRelevant 过滤了（pipeline.ts 的
 * processNewMessages），检索管线是漏网的——这里补齐。
 */

import type { Message } from '../../types';
import { isMessageSemanticallyRelevant, normalizeMessageContent } from '../messageFormat';

/**
 * data URI（base64 内嵌资源）。URL_RE 只剥 http(s)，这类要单独剥——
 * 除了 image 消息本体，用户在文本里粘贴、卡片 metadata 泄漏进 content
 * 的 data URI 也一并兜住。base64 体内无空白，\S* 能整段吃掉。
 */
const DATA_URI_RE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+[;,]\S*/gi;

/**
 * 把原始消息列表清洗成「可以安全参与检索 query 构建」的列表：
 *
 * 1. 丢掉无语义消息（image/emoji、无转写的纯音频及空消息）—— 与入库口径一致
 *    有配套文字的 voice 会转成「语音转写」继续参与检索
 * 2. 卡片/系统类消息经 normalizeMessageContent 翻成可读文本
 *    （music_card 的 content 可能是占位符、score_card 可能是 JSON）
 * 3. 剥离所有 data URI；剥完变空的消息一并丢掉
 *
 * 纯函数，不碰 IDB / 网络。text 消息内容不变时保留原对象引用。
 */
export function sanitizeQuerySourceMessages(
    messages: Message[],
    charName?: string,
    userName?: string,
): Message[] {
    const out: Message[] = [];
    for (const m of messages) {
        if (!isMessageSemanticallyRelevant(m)) continue;
        const type = m.type as string | undefined;
        const raw = (!type || type === 'text')
            ? (m.content || '')
            : normalizeMessageContent(m, charName || '', userName || 'TA');
        const cleaned = raw.replace(DATA_URI_RE, ' ');
        if (!cleaned.trim()) continue;
        out.push(cleaned === m.content ? m : { ...m, content: cleaned });
    }
    return out;
}
