import { describe, it, expect } from 'vitest';
import { sanitizeQuerySourceMessages } from './querySanitizer';
import type { Message } from '../../types';

// 这组测试守护「检索 query 源必须是干净文本」这条契约：
// 图片消息的 content 是整段 base64 data URI（几万字符），一旦漏进
// spike / rerank / context query，会把 Embedding 批量请求顶爆
// （硅基流动 400 code 20015）。入库管线早有同口径过滤，检索这层不能再漏。

const msg = (partial: Partial<Message>): Message => ({
    id: 1,
    charId: 'c1',
    role: 'user',
    type: 'text',
    content: '',
    timestamp: 1000,
    ...partial,
} as Message);

describe('sanitizeQuerySourceMessages', () => {
    it('纯文本消息原样保留（同一对象引用，不做无谓拷贝）', () => {
        const m = msg({ content: '今天我要回家看家人啦' });
        const out = sanitizeQuerySourceMessages([m]);
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(m);
    });

    it('图片消息（content = base64 data URI）整条丢弃', () => {
        const image = msg({ type: 'image', content: `data:image/jpeg;base64,${'A'.repeat(50000)}` });
        const out = sanitizeQuerySourceMessages([msg({ content: '你看这张图' }), image]);
        expect(out).toHaveLength(1);
        expect(out[0].content).toBe('你看这张图');
    });

    it('表情包 / 无转写的纯音频资源整条丢弃', () => {
        const out = sanitizeQuerySourceMessages([
            msg({ type: 'emoji', content: 'https://img.host/sticker.png' }),
            msg({ type: 'voice', content: 'blob:xxx' }),
            msg({ content: '晚安' }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].content).toBe('晚安');
    });

    it('有配套文字的语音按转写内容参与记忆检索', () => {
        const out = sanitizeQuerySourceMessages([
            msg({ type: 'voice', content: '今天下班路上看见了一只很像你的猫' }),
            msg({
                type: 'voice',
                content: 'blob:voice-audio',
                metadata: { transcript: '别忘了明天一起去看电影' },
            }),
        ]);

        expect(out).toHaveLength(2);
        expect(out[0].content).toContain('今天下班路上看见了一只很像你的猫');
        expect(out[1].content).toContain('别忘了明天一起去看电影');
        expect(out.every(item => item.content.startsWith('[语音转写]'))).toBe(true);
    });

    it('文本里粘贴的 data URI 被剥掉，其余文字保留', () => {
        const m = msg({ content: `看看这个 data:image/png;base64,${'B'.repeat(8000)} 好看吗` });
        const out = sanitizeQuerySourceMessages([m]);
        expect(out).toHaveLength(1);
        expect(out[0].content).not.toContain('base64');
        expect(out[0].content).toContain('看看这个');
        expect(out[0].content).toContain('好看吗');
        expect(out[0].content.length).toBeLessThan(50);
    });

    it('文本内容剥完 data URI 后为空 → 整条丢弃', () => {
        const m = msg({ content: 'data:image/webp;base64,CCCC' });
        expect(sanitizeQuerySourceMessages([m])).toHaveLength(0);
    });

    it('卡片类消息翻成可读文本参与检索（不再是占位符/JSON）', () => {
        const music = msg({
            type: 'music_card',
            role: 'assistant',
            content: '[音乐卡片]',
            metadata: { song: { name: '海底', artists: '一支榴莲' }, intent: 'join' },
        });
        const out = sanitizeQuerySourceMessages([music], '阿汐', '小鱼');
        expect(out).toHaveLength(1);
        expect(out[0].content).toContain('海底');
        expect(out[0].content).toContain('阿汐');
    });

    it('正文为空但 metadata 有内容的卡片仍参与统计与记忆上下文', () => {
        const xhs = msg({
            type: 'xhs_card',
            content: '',
            metadata: {
                xhsNote: {
                    title: '今天遇到一只很亲人的小猫',
                    desc: '它一路跟着我走到了地铁口。',
                    author: '路边观察员',
                },
            },
        });
        const out = sanitizeQuerySourceMessages([xhs], '阿澄', '小鱼');
        expect(out).toHaveLength(1);
        expect(out[0].content).toContain('今天遇到一只很亲人的小猫');
        expect(out[0].content).toContain('它一路跟着我走到了地铁口');
    });

    it('空消息丢弃；没有 type 字段的合成消息按文本处理', () => {
        const out = sanitizeQuerySourceMessages([
            msg({ content: '   ' }),
            { role: 'user', content: '合成消息' } as any,
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].content).toBe('合成消息');
    });
});
