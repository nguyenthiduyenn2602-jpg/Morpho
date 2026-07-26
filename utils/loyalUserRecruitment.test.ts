import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOYAL_RECRUITMENT_CRITERIA_VERSION } from './loyalUserEligibility';
import {
    LOYAL_RECRUITMENT_ATTEMPT_KEY,
    readLoyalRecruitmentAttempt,
    resetLoyalRecruitmentForTesting,
    submitQualifiedQQ,
} from './loyalUserRecruitment';

const LEGACY_ATTEMPT_KEY = 'sullyos_loyal_recruitment_2026-07-20-v1';
const LEGACY_V2_ATTEMPT_KEY = 'sullyos_loyal_recruitment_2026-07-20-v2';
const LEGACY_V3_ATTEMPT_KEY = 'sullyos_loyal_recruitment_2026-07-20-v3';

function legacyFailedAttempt(activeDays = 2, palaceNodes = 1147, recentMemoryUnits = 5) {
    return {
        status: 'failed',
        criteriaVersion: '2026-07-20-v1',
        evaluatedAt: 1_721_466_000_000,
        evaluation: {
            criteriaVersion: '2026-07-20-v1',
            cutoffAt: 1_721_466_000_000,
            hardGatePassed: false,
            passed: false,
            score: 59,
            breakdown: {
                recentActivity: 11,
                customCharacter: 15,
                neuralMemory: 23,
                memoryPalace: 10,
            },
            metrics: {
                recentUserMessages: 35,
                recentActiveDays: activeDays,
                recentActiveWeeks: 1,
                hasQualifiedCustomCharacter: true,
                memoryUnits: 15,
                recentMemoryUnits,
                memorySpanDays: 120,
                palaceNodes,
                recentPalaceNodes: 20,
                palaceRooms: 3,
            },
        },
    };
}

describe('忠实用户招募规则升级', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.unstubAllGlobals());

    it('只用旧版已封存摘要将深度用户升级为待填 QQ，不重新读取业务数据', () => {
        localStorage.setItem(LEGACY_ATTEMPT_KEY, JSON.stringify(legacyFailedAttempt()));

        const attempt = readLoyalRecruitmentAttempt();

        expect(attempt?.status).toBe('qualified_pending_qq');
        expect(attempt?.criteriaVersion).toBe(LOYAL_RECRUITMENT_CRITERIA_VERSION);
        expect(attempt?.evaluation?.qualificationPath).toBe('deep');
        expect(attempt?.evaluation?.passed).toBe(true);
        expect(localStorage.getItem(LOYAL_RECRUITMENT_ATTEMPT_KEY)).toBeNull();
    });

    it('旧结果没有满足任何一个固定条件时仍保持失败', () => {
        localStorage.setItem(LEGACY_ATTEMPT_KEY, JSON.stringify(legacyFailedAttempt(1, 0, 0)));

        const attempt = readLoyalRecruitmentAttempt();

        expect(attempt?.status).toBe('failed');
        expect(attempt?.evaluation?.qualificationPath).toBeNull();
        expect(attempt?.evaluation?.passed).toBe(false);
    });

    it('测试重置同时清除当前版与旧版封存状态', () => {
        localStorage.setItem(LEGACY_ATTEMPT_KEY, '{}');
        localStorage.setItem(LEGACY_V2_ATTEMPT_KEY, '{}');
        localStorage.setItem(LEGACY_V3_ATTEMPT_KEY, '{}');
        localStorage.setItem(LOYAL_RECRUITMENT_ATTEMPT_KEY, '{}');

        resetLoyalRecruitmentForTesting();

        expect(localStorage.getItem(LEGACY_ATTEMPT_KEY)).toBeNull();
        expect(localStorage.getItem(LEGACY_V2_ATTEMPT_KEY)).toBeNull();
        expect(localStorage.getItem(LEGACY_V3_ATTEMPT_KEY)).toBeNull();
        expect(localStorage.getItem(LOYAL_RECRUITMENT_ATTEMPT_KEY)).toBeNull();
    });

    it('将服务端未分配结果归一化为不含群信息的最终结果', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            ok: true,
            allocated: false,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })));

        const result = await submitQualifiedQQ('123456789');

        expect(result).toEqual({
            granted: false,
            registered: false,
            group: '',
            password: '',
        });
    });
});
