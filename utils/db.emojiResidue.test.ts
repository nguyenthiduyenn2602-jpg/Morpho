import { describe, it, expect } from 'vitest';
import { DB } from './db';

// 「幽灵表情包」残留清理（cleanupEmojiResidue）：
// 删角色不级联清理表情分类，只对已删角色可见的专属分类会卡在库里——
// 单聊面板被可见性过滤（看不到也删不掉），群聊面板/提示词却还能看到。
// 清理规则：绑定全失效的非系统分类连表情一起删；部分失效只剔除死 id；
// categoryId 悬空的无主表情删除；系统分类只清绑定、绝不删。
describe('cleanupEmojiResidue 幽灵表情包清理', () => {
  it('dryRun 只统计不落库；真跑后残留分类/表情被删、混合绑定被修复、健康数据不动', async () => {
    // char-a 还活着，char-b 已被删除
    await DB.saveEmojiCategory({ id: 'cat-alive', name: '活人专属', allowedCharacterIds: ['char-a'] });
    await DB.saveEmojiCategory({ id: 'cat-ghost', name: '幽灵专属', allowedCharacterIds: ['char-b'] });
    await DB.saveEmojiCategory({ id: 'cat-mixed', name: '混合绑定', allowedCharacterIds: ['char-a', 'char-b'] });
    await DB.saveEmojiCategory({ id: 'cat-public', name: '公开分类' });
    await DB.saveEmojiCategory({ id: 'cat-system', name: '系统分类', isSystem: true, allowedCharacterIds: ['char-b'] });

    await DB.saveEmoji('ghost-1', 'url-g1', 'cat-ghost');
    await DB.saveEmoji('ghost-2', 'url-g2', 'cat-ghost');
    await DB.saveEmoji('alive-1', 'url-a1', 'cat-alive');
    await DB.saveEmoji('public-1', 'url-p1', undefined);
    await DB.saveEmoji('dangling-1', 'url-d1', 'cat-gone'); // 分类早已不存在的无主表情

    // 1) dryRun：报告正确，但数据一个都不能少
    const scan = await DB.cleanupEmojiResidue(['char-a'], { dryRun: true });
    expect(scan.removedCategories.map(c => c.id)).toEqual(['cat-ghost']);
    expect(scan.fixedCategories.map(c => c.id).sort()).toEqual(['cat-mixed', 'cat-system']);
    expect(scan.removedEmojiCount).toBe(3); // ghost-1 + ghost-2 + dangling-1
    expect((await DB.getEmojis()).length).toBe(5);
    expect((await DB.getEmojiCategories()).length).toBe(5);

    // 2) 真跑
    const report = await DB.cleanupEmojiResidue(['char-a']);
    expect(report.removedCategories.map(c => c.id)).toEqual(['cat-ghost']);
    expect(report.removedEmojiCount).toBe(3);

    const cats = await DB.getEmojiCategories();
    expect(cats.find(c => c.id === 'cat-ghost')).toBeUndefined();
    // 混合绑定：只剔除已删角色，分类和表情保留
    expect(cats.find(c => c.id === 'cat-mixed')?.allowedCharacterIds).toEqual(['char-a']);
    // 系统分类：绑定全失效也不删，回落全员可见
    expect(cats.find(c => c.id === 'cat-system')?.allowedCharacterIds).toEqual([]);
    // 健康数据不动
    expect(cats.find(c => c.id === 'cat-alive')?.allowedCharacterIds).toEqual(['char-a']);
    expect(cats.find(c => c.id === 'cat-public')?.allowedCharacterIds).toBeUndefined();

    const emojiNames = (await DB.getEmojis()).map(e => e.name).sort();
    expect(emojiNames).toEqual(['alive-1', 'public-1']);

    // 3) 幂等：再跑一次应该什么都扫不到
    const again = await DB.cleanupEmojiResidue(['char-a']);
    expect(again.removedCategories).toEqual([]);
    expect(again.fixedCategories).toEqual([]);
    expect(again.removedEmojiCount).toBe(0);
  });
});
