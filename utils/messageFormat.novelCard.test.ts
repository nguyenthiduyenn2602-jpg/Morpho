import { describe, it, expect } from 'vitest';
import { normalizeMessageContent } from './messageFormat';
import { ChatPrompts } from './chatPrompts';

// 锁住「笔友会历史章节转发到聊天后，角色在上下文里读得到书」这条链路。
//
// novel_card 的 content 只是占位（[笔友会小说]《书名》…），真正的章节归档在
// metadata.novel 里。上下文 / 归档 / palace 都靠 normalizeMessageContent 把它
// 翻成完整文本——漏翻的话角色只看到占位符，等于没转发。
// 另外钉住共创者 / 非共创者两种视角的措辞：共创者要知道"这书有你一份"，
// 旁观者不能被诱导成"我也写过"。

const novelMeta = {
    novel: {
        bookTitle: '雾中灯塔',
        subtitle: '第一卷',
        bookSummary: '一座只在雾天出现的灯塔。',
        userName: '我',
        collaboratorNames: ['小笔友', '路人乙'],
        chapters: [
            { index: 1, summary: '守塔人捡到了一封没有署名的信。' },
            { index: 3, summary: '信的笔迹和守塔人自己的一模一样。' },
        ],
        count: 2,
    },
};

const baseMsg = {
    id: 1,
    charId: 'c1',
    role: 'user',
    type: 'novel_card',
    content: '[笔友会小说]《雾中灯塔》2 章归档',
    timestamp: Date.now(),
    metadata: novelMeta,
} as any;

describe('normalizeMessageContent novel_card 脱水', () => {
    it('共创者视角: 带书名 + 全部章节总结 + "你是执笔人之一"', () => {
        const text = normalizeMessageContent(baseMsg, '小笔友', '我');
        expect(text).toContain('《雾中灯塔》');
        expect(text).toContain('执笔人之一');
        expect(text).toContain('守塔人捡到了一封没有署名的信');
        expect(text).toContain('第3章总结');
        expect(text).toContain('一座只在雾天出现的灯塔');
        // 其他共创者也要出现（"还有路人乙"），别把合著者写丢
        expect(text).toContain('路人乙');
    });

    it('非共创者视角: 明确"没有参与创作", 不冒认执笔', () => {
        const text = normalizeMessageContent(baseMsg, '圈外角色', '我');
        expect(text).toContain('《雾中灯塔》');
        expect(text).toContain('没有参与创作');
        expect(text).not.toContain('执笔人之一');
        // 章节内容照样可读——分享的意义就是让 ta 读到
        expect(text).toContain('信的笔迹和守塔人自己的一模一样');
    });

    it('metadata 缺失时兜底为占位, 不抛错', () => {
        const broken = { ...baseMsg, metadata: {} };
        expect(normalizeMessageContent(broken, '小笔友', '我')).toBe('[笔友会小说章节]');
    });
});

describe('buildMessageHistory 私聊上下文里 novel_card 完整可读', () => {
    it('角色上下文里带出章节归档全文, 不是光秃秃的占位 (退化即挂)', () => {
        const char = { id: 'c1', name: '小笔友' } as any;
        const userProfile = { name: '我' } as any;
        const history = [{ ...baseMsg, timestamp: Date.now() - 60_000 }];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);
        const userMsg = apiMessages.find((m: any) => m.role === 'user');
        const content = userMsg!.content as string;
        expect(content).toContain('笔友会');
        expect(content).toContain('守塔人捡到了一封没有署名的信');
        expect(content).toContain('执笔人之一');
    });
});
