import { describe, it, expect } from 'vitest';
import { DigestReportDB } from './db';
import { DIGEST_REPORT_KEEP } from './types';
import type { DigestReport } from './types';

function report(i: number, charId = 'char_dr_test'): DigestReport {
    return {
        id: `dr_test_${charId}_${i}`,
        charId,
        createdAt: 1_700_000_000_000 + i * 60_000,
        trigger: i % 2 === 0 ? 'auto' : 'manual',
        examined: [{ label: '阁楼困惑', items: [`困惑 ${i}`] }],
        outcomes: [],
        plateSubmissions: [{ label: '提交给门牌「TA的事」', items: [`事实 ${i}`] }],
        plateUpdated: ['user_room'],
    };
}

describe('DigestReportDB — 消化日志存取与修剪', () => {
    it('按时间倒序返回，最新在前', async () => {
        const charId = 'char_dr_order';
        for (const i of [2, 0, 1]) {
            await DigestReportDB.save(report(i, charId));
        }
        const list = await DigestReportDB.getByCharId(charId);
        expect(list.map(r => r.id)).toEqual([
            `dr_test_${charId}_2`, `dr_test_${charId}_1`, `dr_test_${charId}_0`,
        ]);
    });

    it(`每角色只保留最近 ${DIGEST_REPORT_KEEP} 条，旧的被修剪`, async () => {
        const charId = 'char_dr_prune';
        const total = DIGEST_REPORT_KEEP + 5;
        for (let i = 0; i < total; i++) {
            await DigestReportDB.save(report(i, charId));
        }
        const list = await DigestReportDB.getByCharId(charId);
        expect(list).toHaveLength(DIGEST_REPORT_KEEP);
        // 最旧的 5 条被剪掉，最新的一条还在
        expect(list[0].id).toBe(`dr_test_${charId}_${total - 1}`);
        expect(list.some(r => r.id === `dr_test_${charId}_0`)).toBe(false);
        expect(list.some(r => r.id === `dr_test_${charId}_4`)).toBe(false);
        expect(list.some(r => r.id === `dr_test_${charId}_5`)).toBe(true);
    });

    it('修剪只影响本角色，不动其他角色的日志', async () => {
        const a = 'char_dr_a';
        const b = 'char_dr_b';
        await DigestReportDB.save(report(0, b));
        for (let i = 0; i < DIGEST_REPORT_KEEP + 3; i++) {
            await DigestReportDB.save(report(i, a));
        }
        expect(await DigestReportDB.getByCharId(b)).toHaveLength(1);
        expect(await DigestReportDB.getByCharId(a)).toHaveLength(DIGEST_REPORT_KEEP);
    });
});
