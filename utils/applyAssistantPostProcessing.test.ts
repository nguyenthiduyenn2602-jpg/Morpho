import { describe, it, expect, vi } from 'vitest';
import { applyAssistantPostProcessing, PostProcessCtx, XhsCaches } from './applyAssistantPostProcessing';
import { DB } from './db';

// 锁住 renderAndPersist normal path 的引用顺延修复:
// 模型把 [[QUOTE:]] 单独写一行 (典型形态: 标签后紧跟 [[SEND_EMOJI:]] / 换行 + 正文),
// chunkText 按换行拆分后引用标签独占一个 chunk — 剥标签后没有正文不落库,
// 修复前解析出的引用目标随这个空 chunk 一起被丢弃, 表现为"引用被后处理吞掉"。
// 修复后引用目标顺延挂到下一条真正落库的文字气泡。

const makeCtx = (charId: string, contextMsgs: any[]): PostProcessCtx => {
    const xhsCaches: XhsCaches = {
        xsecTokenCache: new Map(),
        noteTitleCache: new Map(),
        commentUserIdCache: new Map(),
        commentAuthorNameCache: new Map(),
        commentParentIdCache: new Map(),
    };
    return {
        char: { id: charId, name: '测试角色' } as any,
        userProfile: { name: '我' } as any,
        emojis: [],
        contextMsgs,
        fullMessages: [],
        initialData: {},
        historyMsgCount: 0,
        xhsCaches,
        api: {
            baseUrl: 'http://localhost:0',
            headers: {},
            effectiveApi: { baseUrl: 'http://localhost:0', apiKey: '', model: 'test' },
        },
        hooks: {
            setMessages: vi.fn(),
            addToast: vi.fn(),
        },
    };
};

const quotedUserMsg = {
    id: 101,
    charId: 'c-quote',
    role: 'user' as const,
    type: 'text' as const,
    content: '引用我说的话，还有后面一长串内容',
    timestamp: Date.now() - 1000,
};

describe('renderAndPersist 引用解析', () => {
    it('[[QUOTE:]] 单独成行 (后跟 SEND_EMOJI + 正文) 时引用顺延到第一条文字气泡', async () => {
        const charId = `c-quote-${Date.now()}`;
        const raw = '[[QUOTE: 引用我说的话]]\n[[SEND_EMOJI: 有点生气]]\n消失了整整三十六个小时';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('消失了整整三十六个小时');
        // 修复前: replyTo 为 undefined (引用目标随空 chunk 丢失)
        expect(texts[0].replyTo).toBeTruthy();
        expect(texts[0].replyTo!.id).toBe(101);
        expect(texts[0].replyTo!.name).toBe('我');
    }, 20000);

    it('[[QUOTE:]] 与正文同一行时引用仍挂在该气泡 (既有行为不回归)', async () => {
        const charId = `c-quote-inline-${Date.now()}`;
        const raw = '[[QUOTE: 引用我说的话]]你干嘛去了';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('你干嘛去了');
        expect(texts[0].replyTo?.id).toBe(101);
    }, 20000);

    it('引用只挂一次: 顺延目标落到首条气泡后, 后续气泡不带 replyTo', async () => {
        const charId = `c-quote-once-${Date.now()}`;
        const raw = '[[QUOTE: 引用我说的话]]\n第一句话\n第二句话';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.map(m => m.content)).toEqual(['第一句话', '第二句话']);
        expect(texts[0].replyTo?.id).toBe(101);
        expect(texts[1].replyTo).toBeFalsy();
    }, 20000);
});

// 历史里引用消息被 buildMessageHistory 渲染成 [xx引用了xx说的「…」，并回复了 ↓]，
// 模型会模仿这个渲染格式而不是规范的 [[QUOTE:]]。修复前这种输出既不被识别成引用、
// 整段方括号还会原样漏进气泡；修复后认作合法引用并剥干净。
describe('renderAndPersist 模仿历史渲染格式的引用兜底', () => {
    it('[我引用了你说的「…」，并回复了 ↓] 单独成行时解析为引用并顺延到正文气泡', async () => {
        const charId = `c-nlquote-${Date.now()}`;
        const raw = '[我引用了你说的「引用我说的话」，并回复了 ↓]\n你干嘛去了';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('你干嘛去了');
        expect(texts[0].replyTo?.id).toBe(101);
        expect(texts[0].replyTo!.name).toBe('我');
    }, 20000);

    it('引用摘要带截断省略号时仍能匹配到原消息', async () => {
        const charId = `c-nlquote-ellipsis-${Date.now()}`;
        const raw = '[用户引用了你之前说的「引用我说的话，还有后面一长…」，并回复了 ↓]\n哈哈这个';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('哈哈这个');
        expect(texts[0].replyTo?.id).toBe(101);
    }, 20000);

    it('与正文同一行时引用挂在该气泡且方括号头不漏进正文', async () => {
        const charId = `c-nlquote-inline-${Date.now()}`;
        const raw = '[你引用了对方说的「引用我说的话」，并回复了 ↓] 这就解释';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('这就解释');
        expect(texts[0].content).not.toContain('引用了');
        expect(texts[0].replyTo?.id).toBe(101);
    }, 20000);

    it('正常含方括号但非引用格式的句子不被误剥', async () => {
        const charId = `c-nlquote-fp-${Date.now()}`;
        const raw = '我看了[那本书]感觉一般';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('我看了[那本书]感觉一般');
        expect(texts[0].replyTo).toBeFalsy();
    }, 20000);
});

// 锁住双语（翻译模式）分支的表情包位置修复:
// 旧实现把所有 [[SEND_EMOJI:]] 先抽出、正文发完后统一追加在最后（且去重），
// 表现为"翻译模式下角色永远最后才发表情包"。修复后表情包按模型写的位置原地插发。
describe('renderAndPersist 双语分支表情包顺序', () => {
    const testEmojis = [
        { id: 1, name: '开心', url: 'https://example.com/happy.png' },
        { id: 2, name: '疑惑', url: 'https://example.com/confused.png' },
    ] as any[];

    const makeBiCtx = (charId: string): PostProcessCtx => {
        const ctx = makeCtx(charId, []);
        ctx.emojis = testEmojis as any;
        ctx.instantRender = true;
        return ctx;
    };

    it('表情包按出现位置插发，不再统一挪到最后', async () => {
        const charId = `c-bi-emoji-${Date.now()}`;
        const raw = [
            '[[SEND_EMOJI: 开心]]',
            '<翻译><原文>Hello there</原文><译文>你好呀</译文></翻译>',
            '[[SEND_EMOJI: 疑惑]]',
            '<翻译><原文>What happened</原文><译文>发生什么了</译文></翻译>',
        ].join('\n');

        await applyAssistantPostProcessing(raw, makeBiCtx(charId));

        const msgs = (await DB.getRecentMessagesByCharId(charId, 50)).filter(m => m.role === 'assistant');
        expect(msgs.map(m => m.type)).toEqual(['emoji', 'text', 'emoji', 'text']);
        expect(msgs[0].content).toBe('https://example.com/happy.png');
        expect(msgs[1].content).toBe('Hello there\n%%BILINGUAL%%\n你好呀');
        expect(msgs[2].content).toBe('https://example.com/confused.png');
        expect(msgs[3].content).toBe('What happened\n%%BILINGUAL%%\n发生什么了');
    }, 20000);

    it('同一个表情包出现两次时不去重，两次都发', async () => {
        const charId = `c-bi-emoji-dup-${Date.now()}`;
        const raw = [
            '[[SEND_EMOJI: 开心]]',
            '<翻译><原文>Nice</原文><译文>好耶</译文></翻译>',
            '[[SEND_EMOJI: 开心]]',
        ].join('\n');

        await applyAssistantPostProcessing(raw, makeBiCtx(charId));

        const msgs = (await DB.getRecentMessagesByCharId(charId, 50)).filter(m => m.role === 'assistant');
        expect(msgs.map(m => m.type)).toEqual(['emoji', 'text', 'emoji']);
    }, 20000);

    it('混进 <原文>/<译文> 里的表情标签剥出来紧跟该双语气泡发送', async () => {
        const charId = `c-bi-emoji-inline-${Date.now()}`;
        const raw = '<翻译><原文>See you [[SEND_EMOJI: 开心]]</原文><译文>回见</译文></翻译>\n尾巴一句';

        await applyAssistantPostProcessing(raw, makeBiCtx(charId));

        const msgs = (await DB.getRecentMessagesByCharId(charId, 50)).filter(m => m.role === 'assistant');
        expect(msgs.map(m => m.type)).toEqual(['text', 'emoji', 'text']);
        expect(msgs[0].content).toBe('See you\n%%BILINGUAL%%\n回见');
        expect(msgs[2].content).toBe('尾巴一句');
    }, 20000);

    it('表情包在最后时仍最后发（既有行为不回归）', async () => {
        const charId = `c-bi-emoji-tail-${Date.now()}`;
        const raw = '<翻译><原文>Bye</原文><译文>拜拜</译文></翻译>\n[[SEND_EMOJI: 疑惑]]';

        await applyAssistantPostProcessing(raw, makeBiCtx(charId));

        const msgs = (await DB.getRecentMessagesByCharId(charId, 50)).filter(m => m.role === 'assistant');
        expect(msgs.map(m => m.type)).toEqual(['text', 'emoji']);
    }, 20000);
});

describe('renderAndPersist XHS mimicked-card fallback', () => {
    it('restores the five-line history format as xhs_card and preserves surrounding text', async () => {
        const charId = `c-xhs-mimic-${Date.now()}`;
        const ctx = makeCtx(charId, []);
        const title = '\u5ba0\u7269\u6c34\u6bcd\u53ef\u4ee5\u6478\u5417\uff1f';
        const author = '\u6eba\u6c34\u6d77\u8707\u76ae';
        ctx.instantRender = true;
        ctx.lastXhsNotesRef = {
            current: [{
                noteId: 'note-jellyfish',
                title,
                desc: '\u7f13\u5b58\u91cc\u7684\u5b8c\u6574\u7b80\u4ecb',
                likes: 2156,
                collects: 488,
                commentCount: 55,
                shareCount: 175,
                author,
                authorId: 'author-1',
                xsecToken: 'token-1',
                coverUrl: 'https://example.test/jellyfish.jpg',
            }],
        };
        const raw = [
            '\u8fd9\u4e2a\u8fd8\u633a\u6709\u610f\u601d',
            '[\u4f60\u5206\u4eab\u4e86\u5c0f\u7ea2\u4e66\u7b14\u8bb0]',
            `\u6807\u9898: ${title}`,
            `\u4f5c\u8005: ${author}`,
            '\u4e92\u52a8: 2156\u8d5e 488\u6536\u85cf 55\u8bc4\u8bba 175\u5206\u4eab',
            '\u7b80\u4ecb: \u4eba\u5de5\u7e41\u6b96\u7684\u5ba0\u7269\u6c34\u6bcd\u5927\u90e8\u5206\u65e0\u6bd2',
            '\u4f60\u770b\u8fd9\u53ea\u662f\u4e0d\u662f\u5f88\u79bb\u8c31',
        ].join('\n');

        await applyAssistantPostProcessing(raw, ctx);

        const msgs = (await DB.getRecentMessagesByCharId(charId, 50)).filter(m => m.role === 'assistant');
        const cards = msgs.filter(m => m.type === 'xhs_card');
        const text = msgs.filter(m => m.type === 'text').map(m => m.content).join('\n');
        expect(cards).toHaveLength(1);
        expect(cards[0].metadata?.xhsNote).toMatchObject({
            noteId: 'note-jellyfish',
            title,
            author,
            xsecToken: 'token-1',
            coverUrl: 'https://example.test/jellyfish.jpg',
        });
        expect(text).toContain('\u8fd9\u4e2a\u8fd8\u633a\u6709\u610f\u601d');
        expect(text).toContain('\u4f60\u770b\u8fd9\u53ea\u662f\u4e0d\u662f\u5f88\u79bb\u8c31');
        expect(text).not.toContain('\u4f60\u5206\u4eab\u4e86\u5c0f\u7ea2\u4e66\u7b14\u8bb0');
        expect(text).not.toContain('\u6807\u9898:');
        expect(text).not.toContain('\u4e92\u52a8:');
    }, 20000);
});
