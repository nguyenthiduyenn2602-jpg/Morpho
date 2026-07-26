import { describe, it, expect } from 'vitest';
import { normalizeTranslationTags, sanitizeForBubble, sanitizeForNotification, sanitizeIntoSegments } from './sanitize';

// applyAssistantPostProcessing Step 8 的严格双语判定/拆泡正则 (utils/applyAssistantPostProcessing.ts)。
// 自愈的目标就是让掉格式输出重新命中它 —— 这里用同一条正则做端到端断言。
const STEP8_RE = /<翻译>\s*<原文>[\s\S]*?<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/;
const CANON = (a: string, b: string) => `<翻译><原文>${a}</原文><译文>${b}</译文></翻译>`;

describe('normalizeTranslationTags', () => {
    it('无翻译标签的文本原样返回 (fast path)', () => {
        expect(normalizeTranslationTags('普通聊天文本，没有任何标签')).toBe('普通聊天文本，没有任何标签');
        expect(normalizeTranslationTags('原文和译文这两个词本身不该被动')).toBe('原文和译文这两个词本身不该被动');
    });

    it('规范块幂等：完整格式不被改坏', () => {
        const s = CANON('你好！', 'こんにちは！') + CANON('今天做什么？', '今日は何する？');
        expect(normalizeTranslationTags(s)).toBe(s);
    });

    // ─── 截图报告形态 ───

    it('尾部截断 `</译文` (少写 > 且丢 </翻译>) → 补全成规范块', () => {
        const s = '<翻译><原文>如果硬撑着一整天不睡，胃也会难受的。</原文><译文>丸一日無理して起きてたら、胃もキリキリ痛くなっちゃうよ。</译文';
        const out = normalizeTranslationTags(s);
        expect(out).toBe(CANON('如果硬撑着一整天不睡，胃也会难受的。', '丸一日無理して起きてたら、胃もキリキリ痛くなっちゃうよ。'));
        expect(STEP8_RE.test(out)).toBe(true);
    });

    it('全裸文本只剩孤儿 `</译文` 残尾 → 剥干净，正文保留', () => {
        const s = '如果硬撑着一整天不睡，胃也会难受的。\n丸一日無理して起きてたら、胃もキリキリ痛くなっちゃうよ。</译文';
        const out = normalizeTranslationTags(s);
        expect(out).not.toMatch(/[<＜]/);
        expect(out).toContain('胃也会难受的。');
        expect(out).toContain('痛くなっちゃうよ。');
    });

    // ─── 结构掉格式 ───

    it('缺外层 <翻译> 包裹 → 补齐', () => {
        const out = normalizeTranslationTags('<原文>你好！</原文>\n<译文>こんにちは！</译文>');
        expect(out).toBe(CANON('你好！', 'こんにちは！'));
    });

    it('缺 </翻译> 闭合 → 补齐', () => {
        const out = normalizeTranslationTags('<翻译><原文>你好！</原文><译文>こんにちは！</译文>');
        expect(out).toBe(CANON('你好！', 'こんにちは！'));
    });

    it('sibling 幻觉形态 <翻译>X</翻译><译文>Y</译文> → 规范块', () => {
        const out = normalizeTranslationTags('<翻译>你好！</翻译><译文>こんにちは！</译文>');
        expect(out).toBe(CANON('你好！', 'こんにちは！'));
    });

    it('译文块未闭合 (流截断) → 末尾补闭合再规范化', () => {
        const out = normalizeTranslationTags('<翻译><原文>你好！</原文><译文>こんにちは！');
        expect(out).toBe(CANON('你好！', 'こんにちは！'));
    });

    it('多句混合：规范块 + 掉格式块同现，各自修好', () => {
        const s = CANON('你好！', 'こんにちは！') + '\n<原文>今天做什么？</原文><译文>今日は何する？</译文';
        const out = normalizeTranslationTags(s);
        expect(out).toContain(CANON('你好！', 'こんにちは！'));
        expect(out).toContain(CANON('今天做什么？', '今日は何する？'));
    });

    // ─── 字形掉格式 ───

    it('全角尖括号 / 全角斜杠 / 标签内空格 → 规范半角', () => {
        const out = normalizeTranslationTags('＜翻译＞＜原文＞你好！＜／原文＞< 译文 >こんにちは！</ 译文 >＜/翻译＞');
        expect(out).toBe(CANON('你好！', 'こんにちは！'));
    });

    it('简繁互换 譯文/翻譯 → 规范简体', () => {
        const out = normalizeTranslationTags('<翻譯><原文>你好！</原文><譯文>こんにちは！</譯文></翻譯>');
        expect(out).toBe(CANON('你好！', 'こんにちは！'));
    });

    // ─── 兜底不变量 ───

    it('孤儿闭合 / 配不成对的标签一律剥除，绝不漏给用户', () => {
        expect(normalizeTranslationTags('前面</翻译>后面')).toBe('前面后面');
        // 配不成对的 <译文> 整块 = 重复的目标语内容，按 extractTranslationOriginal 既有策略丢弃
        expect(normalizeTranslationTags('只有译文块<译文>こんにちは！</译文>')).toBe('只有译文块');
    });

    it('规范多行块（标签间带换行）原样保留，不被压扁', () => {
        const s = '<翻译>\n<原文>Wait... seriously?</原文>\n<译文>等等…？</译文>\n</翻译>';
        expect(normalizeTranslationTags(s)).toBe(s);
    });

    it('自愈后不变量：除规范块外无任何翻译标签残留', () => {
        const messy = '碎片</译文\n<翻译>半个块<译文>訳</译文>\n＜原文 正文继续';
        const out = normalizeTranslationTags(messy);
        const rest = out.replace(/<翻译><原文>[\s\S]*?<\/原文><译文>[\s\S]*?<\/译文><\/翻译>/g, '');
        expect(rest).not.toMatch(/[<＜]\s*[/／]?\s*(?:翻[译譯]|原文|[译譯]文)/);
    });

    it('幂等：修复结果再跑一遍不变', () => {
        const once = normalizeTranslationTags('<原文>你好！</原文><译文>こんにちは！</译文');
        expect(normalizeTranslationTags(once)).toBe(once);
    });
});

describe('facade 集成', () => {
    it('sanitizeForBubble：掉格式输出修回 Step 8 可命中的规范块', () => {
        const out = sanitizeForBubble('<翻译><原文>早上好</原文><译文>おはよう</译文');
        expect(STEP8_RE.test(out)).toBe(true);
    });

    it('sanitizeForNotification：掉格式块也能提取原文进 banner', () => {
        const out = sanitizeForNotification('<原文>早上好</原文><译文>おはよう</译文>');
        expect(out).toBe('早上好');
    });

    it('sanitizeIntoSegments：修复后整块被 Phase 1.5 原子保护，banner 预览取原文', () => {
        const segs = sanitizeIntoSegments('<翻译><原文>早上好</原文><译文>おはよう</译文');
        expect(segs).toHaveLength(1);
        expect(STEP8_RE.test(segs[0].raw)).toBe(true);
        expect(segs[0].sanitized).toBe('早上好');
    });
});
