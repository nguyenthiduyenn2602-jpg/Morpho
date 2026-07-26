import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    shouldRequestAmbient,
    landAmbientEventFromEval,
    buildAmbientEvalSection,
    AMBIENT_MIN_INTERVAL_MS,
} from './roomAmbient';
import { DB } from './db';
import type { CharacterProfile } from '../types';

vi.mock('./db', () => ({ DB: { saveMessage: vi.fn() } }));

const CHAR_ID = 'c_amb_test';
const KEY = `room_ambient_last_${CHAR_ID}`;
const char = (over: Partial<CharacterProfile> = {}): CharacterProfile =>
    ({ id: CHAR_ID, name: '阿澄', ...over } as CharacterProfile);

beforeEach(() => {
    localStorage.removeItem(KEY);
    vi.mocked(DB.saveMessage).mockClear().mockResolvedValue(1 as any);
});

describe('shouldRequestAmbient 双闸', () => {
    it('时间闸：距上条不足间隔 → false（概率闸不掷）', () => {
        localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), text: 'x' }));
        expect(shouldRequestAmbient(CHAR_ID, () => 0)).toBe(false);
    });

    it('过了时间闸 + 概率命中 → true', () => {
        localStorage.setItem(KEY, JSON.stringify({ ts: Date.now() - AMBIENT_MIN_INTERVAL_MS - 1, text: 'x' }));
        expect(shouldRequestAmbient(CHAR_ID, () => 0)).toBe(true);
    });

    it('过了时间闸 + 概率未中 → false', () => {
        expect(shouldRequestAmbient(CHAR_ID, () => 0.99)).toBe(false);
    });

    it('从无动态的角色只受概率闸约束', () => {
        expect(shouldRequestAmbient(CHAR_ID, () => 0)).toBe(true);
    });
});

describe('landAmbientEventFromEval', () => {
    it('无 ambientEvent / 空 text → false，不落卡', async () => {
        expect(await landAmbientEventFromEval({}, char())).toBe(false);
        expect(await landAmbientEventFromEval({ ambientEvent: { text: '  ' } }, char())).toBe(false);
        expect(DB.saveMessage).not.toHaveBeenCalled();
    });

    it('合法事件 → 落 room_card（content 进上下文）+ 写水位', async () => {
        const ok = await landAmbientEventFromEval(
            { ambientEvent: { text: '把飘窗那本书换成了新的一本', emoji: '📖' } },
            char(),
        );
        expect(ok).toBe(true);
        const msg = vi.mocked(DB.saveMessage).mock.calls[0][0] as any;
        expect(msg.type).toBe('room_card');
        expect(msg.content).toBe('[小屋动态] 阿澄把飘窗那本书换成了新的一本');
        expect(msg.metadata.text).toBe('把飘窗那本书换成了新的一本');
        // 水位写入 → 紧接着的时间闸应拦住
        expect(shouldRequestAmbient(CHAR_ID, () => 0)).toBe(false);
    });

    it('text 截断 60 字，emoji 限长', async () => {
        await landAmbientEventFromEval({ ambientEvent: { text: '长'.repeat(100), emoji: '📖✨🌙🏠🎈' } }, char());
        const msg = vi.mocked(DB.saveMessage).mock.calls[0][0] as any;
        expect(msg.metadata.text.length).toBe(60);
        expect(msg.metadata.emoji.length).toBeLessThanOrEqual(4);
    });

    it('saveMessage 抛错 → 静默 false（不影响情绪主链路）', async () => {
        vi.mocked(DB.saveMessage).mockRejectedValueOnce(new Error('boom'));
        expect(await landAmbientEventFromEval({ ambientEvent: { text: 'x' } }, char())).toBe(false);
    });
});

describe('buildAmbientEvalSection', () => {
    it('含物件名与上一条防重提示', () => {
        localStorage.setItem(KEY, JSON.stringify({ ts: 1, text: '上次那条' }));
        const c = char({ roomConfig: { items: [{ id: 'i1', name: '飘窗', type: 'furniture', image: '', x: 0, y: 0, scale: 1, rotation: 0, isInteractive: true }] } as any });
        const s = buildAmbientEvalSection(c);
        expect(s).toContain('飘窗');
        expect(s).toContain('上次那条');
        expect(s).toContain('省略整个 ambientEvent 字段');
    });
});
