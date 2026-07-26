import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import { flattenImageContentParts } from './chatRequestPayload';

// 锁住「彼方/家园等独立 API 场景把历史图片压平成纯文本」的修复。
//
// 链路: 用户在聊天里发过图 → buildMessageHistory 把该条构造成
//   content: [{type:'text',...}, {type:'image_url',...}]
// → 彼方/家园复用同一份历史发给自己配置的 API。目标模型若不支持视觉
// (DeepSeek 等), 对 image_url 直接 400: "unknown variant `image_url`,
// expected `text`"。修复后这两条路径经 flattenImageContentParts 压平,
// 只保留 text 部分 (自带 [User sent an image] 占位), 与 buildMessageHistory
// 的"图片数据已丢失"分支产出同形。

const char = { id: 'c1', name: '小角色' } as any;
const userProfile = { name: '我' } as any;

const t0 = Date.now() - 60_000;
const makeHistory = () => ([
    { id: 1, charId: 'c1', role: 'user', type: 'image', content: 'data:image/jpeg;base64,AAAA', timestamp: t0 },
    { id: 2, charId: 'c1', role: 'user', type: 'text', content: '看看这张图', timestamp: t0 + 1000 },
] as any[]);

describe('flattenImageContentParts', () => {
    it('把 image_url 多模态消息压平成纯文本, 保留 text 占位', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory(makeHistory(), 10, char, userProfile, []);
        // 前置确认: 有图片数据时 buildMessageHistory 确实产出数组 content (bug 的源头)
        const imgMsg = apiMessages.find((m: any) => Array.isArray(m.content));
        expect(imgMsg).toBeTruthy();

        const flat = flattenImageContentParts(apiMessages);
        for (const m of flat) {
            expect(typeof m.content).toBe('string');
        }
        const flatImg = flat[apiMessages.indexOf(imgMsg!)];
        expect(flatImg.content).toContain('[User sent an image]');
        expect(flatImg.content).not.toContain('data:image');
    });

    it('纯文本消息原样返回 (引用同一对象, 不误伤)', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory(makeHistory(), 10, char, userProfile, []);
        const flat = flattenImageContentParts(apiMessages);
        const textIdx = apiMessages.findIndex((m: any) => typeof m.content === 'string');
        expect(flat[textIdx]).toBe(apiMessages[textIdx]);
        expect(flat[textIdx].content).toContain('看看这张图');
    });

    it('没有 text 部分的数组 content 兜底为 [图片]', () => {
        const flat = flattenImageContentParts([
            { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,BBBB' } }] },
        ]);
        expect(flat[0].content).toBe('[图片]');
    });
});
