import { describe, it, expect } from 'vitest';
import { normName, matchRealChar, clampAffinity, upsertContact, flipTranscript, parseTranscript, serializeTurns, appendLearned, topicText } from './relationshipChat';
import type { PhoneContact } from '../types';

describe('relationshipChat · 纯函数', () => {
    it('normName 去括号身份/空白/大小写', () => {
        expect(normName('阿哲 (社团学长)')).toBe('阿哲');
        expect(normName('  Alice  ')).toBe('alice');
        expect(normName('小明（前任）')).toBe('小明');
    });

    it('matchRealChar 精确 + 包含匹配', () => {
        const roster = [{ id: 'c1', name: '阿哲' }, { id: 'c2', name: 'Bella' }];
        expect(matchRealChar('阿哲', roster)).toBe('c1');
        expect(matchRealChar('阿哲 (学长)', roster)).toBe('c1');
        expect(matchRealChar('学长阿哲', roster)).toBe('c1'); // 包含
        expect(matchRealChar('bella', roster)).toBe('c2');
        expect(matchRealChar('陌生人', roster)).toBeUndefined();
        expect(matchRealChar('', roster)).toBeUndefined();
    });

    it('clampAffinity 钳制并取整到 -100..100', () => {
        expect(clampAffinity(150)).toBe(100);
        expect(clampAffinity(-150)).toBe(-100);
        expect(clampAffinity(12.6)).toBe(13);
        expect(clampAffinity(NaN)).toBe(0);
    });

    it('upsertContact 新增 / 合并不丢 id 与 createdAt', () => {
        const base: PhoneContact[] = [];
        const added = upsertContact(base, { name: '阿哲', kind: 'real', linkedCharId: 'c1', affinity: 30 });
        expect(added).toHaveLength(1);
        expect(added[0].id).toBeTruthy();
        expect(added[0].affinity).toBe(30);

        const origId = added[0].id;
        const origCreated = added[0].createdAt;
        const merged = upsertContact(added, { name: '阿哲 ', note: '欠我钱', affinity: 50 });
        expect(merged).toHaveLength(1); // 按名字归一去重
        expect(merged[0].id).toBe(origId);
        expect(merged[0].createdAt).toBe(origCreated);
        expect(merged[0].note).toBe('欠我钱');
        expect(merged[0].affinity).toBe(50);
    });

    it('upsertContact 好感钳制', () => {
        const r = upsertContact([], { name: 'X', affinity: 999 });
        expect(r[0].affinity).toBe(100);
    });

    it('flipTranscript 翻转我/对方视角', () => {
        const aDetail = '我: 在吗\n对方: 在的\n我: 借点钱';
        const flipped = flipTranscript(aDetail);
        expect(flipped).toBe('对方: 在吗\n我: 在的\n对方: 借点钱');
        // 翻两次回到原样
        expect(flipTranscript(flipped)).toBe(aDetail);
    });

    it('parseTranscript 多行消息的续行跟随上一条说话人（修复错位）', () => {
        const detail = '我: 第一句\n还有第二句\n对方: 收到\n好的';
        expect(parseTranscript(detail)).toEqual([
            { isMe: true, text: '第一句' },
            { isMe: true, text: '还有第二句' }, // 续行归「我」，不被误判给对方
            { isMe: false, text: '收到' },
            { isMe: false, text: '好的' },      // 续行归「对方」
        ]);
    });

    it('parseTranscript 续写可指定首行归属（修复 NPC 续写繁殖 char 的话）', () => {
        // 无前缀续写：上一句是 host(我)→下一句轮到对方，传 false，整段归对方
        expect(parseTranscript('收到\n好的', false)).toEqual([
            { isMe: false, text: '收到' }, { isMe: false, text: '好的' },
        ]);
        // 传 true → 归我
        expect(parseTranscript('在的\n稍等', true)).toEqual([
            { isMe: true, text: '在的' }, { isMe: true, text: '稍等' },
        ]);
        // 有显式前缀时前缀优先，default 只管首行无前缀的兜底
        expect(parseTranscript('对方: 嗯\n我: 好', true)).toEqual([
            { isMe: false, text: '嗯' }, { isMe: true, text: '好' },
        ]);
    });

    it('parseTranscript + serializeTurns 续写无损（修复续写覆盖/吞内容）', () => {
        const detail = '我: a\nb\n对方: c';
        // 旧逻辑会丢掉无前缀的「b」，导致续写时整段替换后内容变短；现在每行都补回前缀
        expect(serializeTurns(parseTranscript(detail))).toBe('我: a\n我: b\n对方: c');
    });

    it('flipTranscript 多行消息也整体翻转、补全前缀', () => {
        expect(flipTranscript('我: a\nb\n对方: c')).toBe('对方: a\n对方: b\n我: c');
    });

    it('appendLearned 累积/去重/限长', () => {
        expect(appendLearned('', '其实在读研')).toBe('其实在读研');
        expect(appendLearned('其实在读研', '欠房东两个月房租')).toBe('其实在读研\n欠房东两个月房租');
        // 完全相同的不重复加
        expect(appendLearned('其实在读研', '其实在读研')).toBe('其实在读研');
        // 空了解不改动已有
        expect(appendLearned('其实在读研', '  ')).toBe('其实在读研');
        // 超过上限只留最近 N 行
        const many = Array.from({ length: 10 }, (_, i) => `事${i}`).join('\n');
        const r = appendLearned(many, '新事', 8).split('\n');
        expect(r).toHaveLength(8);
        expect(r[r.length - 1]).toBe('新事');
        expect(r[0]).toBe('事3'); // 最早的事0~事2 被挤掉
    });

    it('topicText 拼接/过滤空/限最近 N 条', () => {
        expect(topicText(undefined)).toBe('');
        expect(topicText([])).toBe('');
        const box = [
            { id: '1', text: '聊了借钱', createdAt: 1 },
            { id: '2', text: '  ', createdAt: 2 },     // 空白过滤
            { id: '3', text: '和好了', createdAt: 3 },
        ];
        expect(topicText(box)).toBe('· 聊了借钱\n· 和好了');
        // 只取最近 N 条
        const many = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, text: `t${i}`, createdAt: i }));
        const out = topicText(many, 3).split('\n');
        expect(out).toEqual(['· t9', '· t10', '· t11']);
    });

    it('upsertContact 不用 undefined 抹掉已有字段，且保留已有非空备注', () => {
        const seed = upsertContact([], { name: '阿哲', kind: 'real', linkedCharId: 'c1', note: '欠我钱', identity: '同事', affinity: 30 });
        // 再次 upsert（如扫描/对话回填）不带 note/identity：不得清空
        const after = upsertContact(seed, { name: '阿哲', kind: 'real', affinity: 40 });
        expect(after[0].note).toBe('欠我钱');
        expect(after[0].identity).toBe('同事');
        expect(after[0].affinity).toBe(40);
        // 即便带了新的 note，也不覆盖用户已写的非空备注（显式编辑走 UI 不经此函数）
        const after2 = upsertContact(seed, { name: '阿哲', note: 'AI 瞎编的备注' });
        expect(after2[0].note).toBe('欠我钱');
    });

    it('upsertContact 不覆盖用户手动确认的备注名，包括明确留空', () => {
        const automatic = upsertContact([], { name: '小林', identity: '同事' });
        expect(upsertContact(automatic, { name: '小林', identity: '学长' })[0].identity).toBe('学长');

        const manual = upsertContact([], {
            name: '阿哲', kind: 'real', linkedCharId: 'c1', identity: '学长', identityManual: true,
        });
        const after = upsertContact(manual, { name: '阿哲', identity: '机主名字' });
        expect(after[0].identity).toBe('学长');
        expect(after[0].identityManual).toBe(true);

        const cleared = [{ ...manual[0], identity: undefined, identityManual: true }];
        const afterCleared = upsertContact(cleared, { name: '阿哲', identity: '同事' });
        expect(afterCleared[0].identity).toBeUndefined();
        expect(afterCleared[0].identityManual).toBe(true);
    });
});
