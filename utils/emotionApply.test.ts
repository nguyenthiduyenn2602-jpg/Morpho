/**
 * 情绪评估输出解析容错 — parseEmotionEvalOutput / applyEmotionEvalRaw / extractAssistantText.
 *
 * 背景: 情绪 buff 依赖副 API 返回一段 JSON, 模型 (尤其 Claude 系) 偶发输出:
 * 围栏包裹 / 前后夹闲聊 / 字符串里裸引号裸换行 / 尾逗号 / max_tokens 截断半截 JSON。
 * 旧实现任一环节失败就整体返回 null → buff/意识流静默蒸发 (「情绪 buff 不输出内容」)。
 * 这里锁住修复链 + 字段级抢救的行为。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const saveCharacter = vi.fn(async (_char: any) => {});
vi.mock('./db', () => ({ DB: { saveCharacter: (c: any) => saveCharacter(c) } }));

import { parseEmotionEvalOutput, applyEmotionEvalRaw, extractAssistantText } from './emotionApply';

const makeChar = (extra: any = {}): any => ({
    id: 'char-1',
    name: '测试角色',
    activeBuffs: [{ id: 'buff_old', name: 'old_feeling', label: '旧情绪', intensity: 2 }],
    buffInjection: '### 旧注入',
    ...extra,
});

const VALID = {
    changed: true,
    buffs: [
        { id: 'buff_a', name: 'anxiety', label: '焦虑', intensity: 4, emoji: '⚠️', color: '#ef4444', description: 'desc' },
    ],
    injection: '### [当前情绪底色]\n焦虑 强度: ●●●●',
    innerState: '她还没回消息……',
};

beforeEach(() => {
    saveCharacter.mockClear();
});

describe('parseEmotionEvalOutput — 正常形态', () => {
    it('裸 JSON', () => {
        const r = parseEmotionEvalOutput(JSON.stringify(VALID));
        expect(r?.changed).toBe(true);
        expect(r?.buffs?.[0]?.label).toBe('焦虑');
        expect(r?.innerState).toBe('她还没回消息……');
        expect(r?.salvaged).toBeUndefined();
    });

    it('```json 围栏包裹', () => {
        const r = parseEmotionEvalOutput('```json\n' + JSON.stringify(VALID) + '\n```');
        expect(r?.injection).toContain('当前情绪底色');
    });

    it('裸 ``` 围栏 (没写 json 标签)', () => {
        const r = parseEmotionEvalOutput('```\n' + JSON.stringify(VALID) + '\n```');
        expect(r?.buffs?.length).toBe(1);
    });

    it('前后夹闲聊文字 (后缀含 } 也不误吞)', () => {
        const raw = `好的，我来分析角色的情绪状态：\n${JSON.stringify(VALID)}\n以上就是分析结果 {希望有帮助}`;
        const r = parseEmotionEvalOutput(raw);
        expect(r?.changed).toBe(true);
        expect(r?.innerState).toBe('她还没回消息……');
    });

    it('changed 为字符串 "true" 也认', () => {
        const r = parseEmotionEvalOutput(JSON.stringify({ ...VALID, changed: 'true' }));
        expect(r?.changed).toBe(true);
    });
});

describe('parseEmotionEvalOutput — 格式劣化修复', () => {
    it('字符串值里的裸英文双引号 (prompt 示例学坏的经典 case)', () => {
        const raw = `{
  "changed": true,
  "buffs": [{"id": "b1", "name": "waiting", "label": "患得患失", "intensity": 3}],
  "injection": "现在这个沉默不是"没事了"，是"还在疼"。",
  "innerState": "但我想要的是一个字，一个"嗯"都好。"
}`;
        const r = parseEmotionEvalOutput(raw);
        expect(r?.changed).toBe(true);
        expect(r?.innerState).toContain('嗯');
        expect(r?.injection).toContain('没事了');
    });

    it('字符串值里的真实换行 / 制表符', () => {
        const raw = `{"changed": true, "buffs": [], "injection": "第一行\n第二行\t缩进", "innerState": "内心\n独白"}`;
        const r = parseEmotionEvalOutput(raw);
        expect(r?.injection).toBe('第一行\n第二行\t缩进');
        expect(r?.innerState).toBe('内心\n独白');
    });

    it('尾逗号', () => {
        const raw = `{"changed": true, "buffs": [{"name": "a", "label": "甲", "intensity": 2},], "injection": "x", "innerState": "y",}`;
        const r = parseEmotionEvalOutput(raw);
        expect(r?.buffs?.length).toBe(1);
    });

    it('max_tokens 截断: innerState 字符串写到一半戛然而止', () => {
        const full = JSON.stringify({ changed: true, buffs: VALID.buffs, injection: VALID.injection, innerState: '她到底是睡着了还是在疼' });
        const truncated = full.slice(0, full.lastIndexOf('在疼') + 2); // 引号和大括号全丢
        const r = parseEmotionEvalOutput(truncated);
        expect(r?.changed).toBe(true);
        expect(r?.buffs?.length).toBe(1);
        expect(r?.injection).toContain('当前情绪底色');
        expect(r?.innerState).toContain('睡着');
    });

    it('围栏也被截断 (```json 开了没闭合)', () => {
        const full = '```json\n' + JSON.stringify(VALID);
        const r = parseEmotionEvalOutput(full.slice(0, full.length - 8));
        expect(r?.changed).toBe(true);
        expect(r?.buffs?.length).toBe(1);
    });

    it('字段级抢救: JSON 烂到修不好, 仍抠出 innerState / injection', () => {
        // buffs 数组中间烂掉 (裸引号+截断+错括号), 整体 parse 必然失败
        const raw = `{"changed": true, "buffs": [{"name": : broken!!], "injection": "### 注入内容", "innerState": "抢救出来的独白"`;
        const r = parseEmotionEvalOutput(raw);
        expect(r?.salvaged).toBe(true);
        expect(r?.injection).toBe('### 注入内容');
        expect(r?.innerState).toBe('抢救出来的独白');
    });

    it('彻底没有 JSON → null', () => {
        expect(parseEmotionEvalOutput('抱歉，我无法完成这个分析。')).toBeNull();
        expect(parseEmotionEvalOutput('')).toBeNull();
    });
});

describe('applyEmotionEvalRaw — 落库语义', () => {
    it('changed=true 完整结果 → 保存 + 返回 innerState', async () => {
        const char = makeChar();
        const inner = await applyEmotionEvalRaw(JSON.stringify(VALID), char);
        expect(inner).toBe('她还没回消息……');
        expect(saveCharacter).toHaveBeenCalledTimes(1);
        const saved = saveCharacter.mock.calls[0][0];
        expect(saved.activeBuffs[0].label).toBe('焦虑');
        expect(saved.activeBuffs[0].intensity).toBe(3); // 4 被钳到上限 3
        expect(saved.buffInjection).toContain('当前情绪底色');
    });

    it('changed=false → 不动 buff, 只返回 innerState', async () => {
        const inner = await applyEmotionEvalRaw(
            JSON.stringify({ changed: false, innerState: '平稳的独白' }),
            makeChar(),
        );
        expect(inner).toBe('平稳的独白');
        expect(saveCharacter).not.toHaveBeenCalled();
    });

    it('changed=true 但 buffs/injection 全缺 → 不清空已有情绪状态', async () => {
        const inner = await applyEmotionEvalRaw(
            JSON.stringify({ changed: true, innerState: '只有独白' }),
            makeChar(),
        );
        expect(inner).toBe('只有独白');
        expect(saveCharacter).not.toHaveBeenCalled();
    });

    it('抢救场景: 只抠出 injection → 保留旧 buffs, 换新 injection', async () => {
        const raw = `{"changed": true, "buffs": [{"name": : broken!!], "injection": "### 新注入", "innerState": "独白"`;
        const inner = await applyEmotionEvalRaw(raw, makeChar());
        expect(inner).toBe('独白');
        expect(saveCharacter).toHaveBeenCalledTimes(1);
        const saved = saveCharacter.mock.calls[0][0];
        expect(saved.activeBuffs[0].id).toBe('buff_old'); // 旧 buff 保住
        expect(saved.buffInjection).toBe('### 新注入');
    });

    it('buff 缺 name 用 id 兜底、缺 label 用 name 兜底, 不再整条丢弃', async () => {
        const raw = JSON.stringify({
            changed: true,
            buffs: [
                { id: 'buff_x', label: '只有中文标签', intensity: 2 },
                { name: 'only_name', intensity: 2 },
                { intensity: 2 }, // 两者全缺才丢
            ],
            injection: 'x',
        });
        await applyEmotionEvalRaw(raw, makeChar());
        const saved = saveCharacter.mock.calls[0][0];
        expect(saved.activeBuffs.length).toBe(2);
        expect(saved.activeBuffs[0].name).toBe('buff_x');
        expect(saved.activeBuffs[1].label).toBe('only_name');
    });

    it('解析彻底失败 → null 且不动 DB', async () => {
        const inner = await applyEmotionEvalRaw('模型拒绝了输出', makeChar());
        expect(inner).toBeNull();
        expect(saveCharacter).not.toHaveBeenCalled();
    });
});

describe('extractAssistantText — 响应形态兜底', () => {
    it('普通字符串 content', () => {
        expect(extractAssistantText({ content: 'hello' })).toBe('hello');
    });

    it('分块数组 content', () => {
        expect(extractAssistantText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb');
    });

    it('content 为空时回退 reasoning_content', () => {
        expect(extractAssistantText({ content: '', reasoning_content: '{"changed":false}' })).toBe('{"changed":false}');
    });

    it('全空 → 空字符串', () => {
        expect(extractAssistantText({ content: '' })).toBe('');
        expect(extractAssistantText(null)).toBe('');
    });
});

describe('applyEmotionEvalRaw — 失败可见性 (chat-gen-emotion-failed)', () => {
    // 评估失败过去只写 console.warn，用户侧「情绪不更新但没报错」没法自查（真实反馈）。
    // 锁住：解析全灭时必须派发失败事件（OSContext 监听弹 toast）。
    it('解析全灭 → 派发 chat-gen-emotion-failed，detail 带 charId/reason', async () => {
        const dispatched: any[] = [];
        (globalThis as any).window = {
            dispatchEvent: (e: any) => { dispatched.push(e); return true; },
        };
        try {
            const inner = await applyEmotionEvalRaw('完全不是 JSON 的输出', makeChar());
            expect(inner).toBeNull();
            const failed = dispatched.find((e) => e.type === 'chat-gen-emotion-failed');
            expect(failed).toBeTruthy();
            expect(failed.detail.charId).toBe('char-1');
            expect(failed.detail.charName).toBe('测试角色');
            expect(typeof failed.detail.reason).toBe('string');
        } finally {
            delete (globalThis as any).window;
        }
    });

    it('解析成功（即使 salvage）不派发失败事件', async () => {
        const dispatched: any[] = [];
        (globalThis as any).window = {
            dispatchEvent: (e: any) => { dispatched.push(e); return true; },
        };
        try {
            await applyEmotionEvalRaw(JSON.stringify(VALID), makeChar());
            expect(dispatched.some((e) => e.type === 'chat-gen-emotion-failed')).toBe(false);
            // 正常路径照旧广播 emotion-updated
            expect(dispatched.some((e) => e.type === 'emotion-updated')).toBe(true);
        } finally {
            delete (globalThis as any).window;
        }
    });
});
