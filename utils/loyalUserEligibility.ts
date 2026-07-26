import type { CharacterProfile, GuidebookSession, Message } from '../types';
import { DB } from './db';
import { MemoryNodeDB } from './memoryPalace/db';
import type { MemoryNode } from './memoryPalace/types';

/**
 * 忠实用户招募 · 一次性历史截面。
 *
 * 时间全部写明 +08:00，不能跟随设备所在时区。传统 MemoryFragment 只有日期、没有
 * 时分，因此截止日（7 月 20 日）整天不计；其它带 timestamp/createdAt 的数据精确计到 19:00。
 */
export const LOYAL_RECRUITMENT_CRITERIA_VERSION = '2026-07-20-v4';
export const LOYAL_RECRUITMENT_CUTOFF_ISO = '2026-07-20T19:00:00+08:00';
export const LOYAL_RECRUITMENT_RECENT_START_ISO = '2026-06-20T19:00:00+08:00';
export const LOYAL_RECRUITMENT_CUTOFF_AT = Date.parse(LOYAL_RECRUITMENT_CUTOFF_ISO);
export const LOYAL_RECRUITMENT_RECENT_START_AT = Date.parse(LOYAL_RECRUITMENT_RECENT_START_ISO);
export const LOYAL_RECRUITMENT_PASS_SCORE = 65;
export const LOYAL_RECRUITMENT_DEEP_MIN_CHARACTER_ACTIVE_DAYS = 3;
export const LOYAL_RECRUITMENT_DEEP_JULY_MEMORY_THRESHOLD = 3;
export const LOYAL_RECRUITMENT_DEEP_JUNE_MEMORY_THRESHOLD = 15;
export const LOYAL_RECRUITMENT_DEEP_TOTAL_MEMORY_THRESHOLD = 200;
export const LOYAL_RECRUITMENT_DEEP_PALACE_THRESHOLD = 20;

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHARACTER_ID = 'preset-sully-v2';
const CUTOFF_DAY_KEY = '2026-07-20';
const RECENT_START_DAY_KEY = '2026-06-20';
const CUTOFF_MONTH_KEY = '2026-07';
const JUNE_START_AT = Date.parse('2026-06-01T00:00:00+08:00');
const JULY_START_AT = Date.parse('2026-07-01T00:00:00+08:00');

const ELIGIBLE_USER_MESSAGE_TYPES = new Set([
    'text', 'voice', 'image', 'emoji', 'interaction',
]);

export interface LoyalEligibilitySnapshot {
    characters: CharacterProfile[];
    messages: Message[];
    guidebookSessions: GuidebookSession[];
    memoryNodes: MemoryNode[];
}
export interface LoyalEligibilityBreakdown {
    recentActivity: number;
    customCharacter: number;
    neuralMemory: number;
    memoryPalace: number;
}

export interface LoyalEligibilityMetrics {
    recentUserMessages: number;
    recentActiveDays: number;
    recentActiveWeeks: number;
    /** 任意单个角色在截止日前累计的最大活跃日数；旧封存结果可能没有此字段。 */
    maxPreCutoffCharacterActiveDays?: number;
    hasQualifiedCustomCharacter: boolean;
    memoryUnits: number;
    recentMemoryUnits: number;
    memorySpanDays: number;
    /** 只数有效的神经链接记忆条目，不把月度精炼总结算作一条记忆。 */
    neuralMemoryEntriesTotal?: number;
    neuralMemoryEntriesSinceJune?: number;
    neuralMemoryEntriesSinceJuly?: number;
    palaceNodes: number;
    recentPalaceNodes: number;
    palaceRooms: number;
}

export interface LoyalEligibilityResult {
    criteriaVersion: string;
    cutoffAt: number;
    hardGatePassed: boolean;
    deepUserChannelPassed: boolean;
    qualificationPath: 'standard' | 'deep' | null;
    passed: boolean;
    score: number;
    breakdown: LoyalEligibilityBreakdown;
    metrics: LoyalEligibilityMetrics;
}

type ReclassifiableEligibilityResult = Pick<
    LoyalEligibilityResult,
    'hardGatePassed' | 'score' | 'breakdown' | 'metrics'
>;

/**
 * 用已经封存的数字套用当前规则，不重新读取聊天或记忆数据。
 * 规则升级时用它迁移旧结果，仍然只认 7 月 20 日那次历史截面。
 */
export function reclassifyLoyalEligibilityResult(
    result: ReclassifiableEligibilityResult,
): LoyalEligibilityResult {
    const standardPassed = result.hardGatePassed && result.score >= LOYAL_RECRUITMENT_PASS_SCORE;
    // v1/v2 没有按角色累计历史活跃日；迁移时用已封存的近期活跃日作保守兼容证据。
    const characterActiveDays = result.metrics.maxPreCutoffCharacterActiveDays
        ?? result.metrics.recentActiveDays;
    const hasCurrentMemoryEntryMetrics = typeof result.metrics.neuralMemoryEntriesTotal === 'number'
        && typeof result.metrics.neuralMemoryEntriesSinceJune === 'number'
        && typeof result.metrics.neuralMemoryEntriesSinceJuly === 'number';
    const neuralMemoryConditionPassed = hasCurrentMemoryEntryMetrics
        ? result.metrics.neuralMemoryEntriesSinceJuly! >= LOYAL_RECRUITMENT_DEEP_JULY_MEMORY_THRESHOLD
            || result.metrics.neuralMemoryEntriesSinceJune! >= LOYAL_RECRUITMENT_DEEP_JUNE_MEMORY_THRESHOLD
            || result.metrics.neuralMemoryEntriesTotal! >= LOYAL_RECRUITMENT_DEEP_TOTAL_MEMORY_THRESHOLD
        // v1-v3 没有 6/1、7/1 两个分段计数；用封存的 6/20 后记忆量作宽松兼容，仍不重读新数据。
        : result.metrics.recentMemoryUnits >= LOYAL_RECRUITMENT_DEEP_JULY_MEMORY_THRESHOLD
            || result.metrics.memoryUnits >= LOYAL_RECRUITMENT_DEEP_TOTAL_MEMORY_THRESHOLD;
    const deepUserChannelPassed = result.metrics.hasQualifiedCustomCharacter && (
        characterActiveDays >= LOYAL_RECRUITMENT_DEEP_MIN_CHARACTER_ACTIVE_DAYS
        || neuralMemoryConditionPassed
        || result.metrics.palaceNodes > LOYAL_RECRUITMENT_DEEP_PALACE_THRESHOLD
    );

    return {
        ...result,
        criteriaVersion: LOYAL_RECRUITMENT_CRITERIA_VERSION,
        cutoffAt: LOYAL_RECRUITMENT_CUTOFF_AT,
        deepUserChannelPassed,
        qualificationPath: standardPassed ? 'standard' : deepUserChannelPassed ? 'deep' : null,
        passed: standardPassed || deepUserChannelPassed,
    };
}

interface DatedMemoryUnit {
    at: number;
    units: number;
    recent: boolean;
    isMemoryEntry: boolean;
}

function beijingDayKey(timestamp: number): string {
    return new Date(timestamp + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 返回以周一为起点的北京时间自然周标识。 */
function beijingWeekKey(timestamp: number): string {
    const localDayNumber = Math.floor((timestamp + BEIJING_OFFSET_MS) / DAY_MS);
    // 1970-01-01 是周四；+3 后对 7 取模，可得周一为 0 的 weekday。
    const weekdayFromMonday = ((localDayNumber + 3) % 7 + 7) % 7;
    return String(localDayNumber - weekdayFromMonday);
}

function normalizeFullDate(value: string): string | null {
    const match = String(value || '').trim().match(/(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function normalizeMonth(value: string): string | null {
    const match = String(value || '').trim().match(/(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`;
}

function atBeijingNoon(dayKey: string): number {
    return Date.parse(`${dayKey}T12:00:00+08:00`);
}

function monthMidpointAt(monthKey: string): number {
    return Date.parse(`${monthKey}-15T12:00:00+08:00`);
}

function collectTraditionalMemoryUnits(characters: CharacterProfile[]): DatedMemoryUnit[] {
    const units: DatedMemoryUnit[] = [];

    for (const char of characters) {
        for (const memory of char.memories || []) {
            const dayKey = normalizeFullDate(memory.date);
            // date-only 无法区分截止日 19 点前后：排除截止日整天以及未来日期。
            if (!dayKey || dayKey >= CUTOFF_DAY_KEY) continue;
            units.push({
                at: atBeijingNoon(dayKey),
                units: 1,
                isMemoryEntry: true,
                // 起始日同样没有时分，保守排除 6 月 20 日整天。
                recent: dayKey > RECENT_START_DAY_KEY && dayKey < CUTOFF_DAY_KEY,
            });
        }

        for (const key of Object.keys(char.refinedMemories || {})) {
            const monthKey = normalizeMonth(key);
            // 2026-07 月度总结无法证明在 7/20 19:00 前形成，故从本轮排除。
            if (!monthKey || monthKey >= CUTOFF_MONTH_KEY) continue;
            units.push({
                at: monthMidpointAt(monthKey),
                units: 2,
                recent: monthKey === '2026-06',
                isMemoryEntry: false,
            });
        }
    }

    return units;
}

function scoreActiveDays(days: number): number {
    if (days >= 11) return 20;
    if (days >= 7) return 16;
    if (days >= 4) return 12;
    if (days >= 2) return 6;
    return 0;
}

function scoreActiveWeeks(weeks: number): number {
    if (weeks >= 4) return 15;
    if (weeks === 3) return 10;
    if (weeks === 2) return 5;
    return 0;
}

function scoreRecentMessages(messages: number): number {
    if (messages >= 150) return 15;
    if (messages >= 60) return 10;
    if (messages >= 20) return 5;
    return 0;
}

function scoreMemorySpan(days: number, hasMemory: boolean): number {
    if (!hasMemory) return 0;
    if (days >= 90) return 10;
    if (days >= 30) return 8;
    if (days >= 14) return 5;
    return 2;
}

function scoreMemoryUnits(units: number): number {
    if (units >= 12) return 10;
    if (units >= 6) return 9;
    if (units >= 3) return 6;
    if (units >= 1) return 3;
    return 0;
}

function scoreRecentMemoryUnits(units: number): number {
    if (units >= 4) return 5;
    if (units >= 2) return 3;
    if (units >= 1) return 2;
    return 0;
}

function scorePalaceNodes(nodes: number): number {
    if (nodes >= 40) return 7;
    if (nodes >= 15) return 5;
    if (nodes >= 5) return 3;
    if (nodes >= 1) return 1;
    return 0;
}

function scorePalaceRooms(rooms: number): number {
    if (rooms >= 3) return 2;
    if (rooms >= 2) return 1;
    return 0;
}

function isEligibleUserMessage(message: Message): boolean {
    if (message.role !== 'user') return false;
    if (!ELIGIBLE_USER_MESSAGE_TYPES.has(String(message.type))) return false;
    return typeof message.content === 'string' && message.content.trim().length > 0;
}

function getMaxPreCutoffCharacterActiveDays(messages: Message[]): number {
    const perCharacter = new Map<string, Map<string, number>>();
    for (const message of messages) {
        if (message.timestamp > LOYAL_RECRUITMENT_CUTOFF_AT || !isEligibleUserMessage(message)) continue;
        const charId = String(message.charId || '');
        if (!charId) continue;
        const day = beijingDayKey(message.timestamp);
        const perDay = perCharacter.get(charId) || new Map<string, number>();
        perDay.set(day, (perDay.get(day) || 0) + 1);
        perCharacter.set(charId, perDay);
    }

    let maxDays = 0;
    for (const perDay of perCharacter.values()) {
        const activeDays = [...perDay.values()].filter(count => count >= 3).length;
        maxDays = Math.max(maxDays, activeDays);
    }
    return maxDays;
}

function hasPreCutoffCharacterEvidence(
    char: CharacterProfile,
    messages: Message[],
    nodes: MemoryNode[],
    sessions: GuidebookSession[],
): boolean {
    if (messages.some(message => message.charId === char.id && message.timestamp <= LOYAL_RECRUITMENT_CUTOFF_AT)) return true;
    if ((char.memories || []).some(memory => {
        const dayKey = normalizeFullDate(memory.date);
        return !!dayKey && dayKey < CUTOFF_DAY_KEY;
    })) return true;
    if (Object.keys(char.refinedMemories || {}).some(key => {
        const monthKey = normalizeMonth(key);
        return !!monthKey && monthKey < CUTOFF_MONTH_KEY;
    })) return true;
    if (nodes.some(node => node.charId === char.id && node.createdAt <= LOYAL_RECRUITMENT_CUTOFF_AT)) return true;
    if (sessions.some(session => session.charId === char.id && (
        session.createdAt <= LOYAL_RECRUITMENT_CUTOFF_AT
        || session.rounds.some(round => round.timestamp <= LOYAL_RECRUITMENT_CUTOFF_AT)
    ))) return true;
    if ((char.phoneState?.records || []).some(record => record.timestamp <= LOYAL_RECRUITMENT_CUTOFF_AT)) return true;
    if ((char.phoneState?.contacts || []).some(contact => contact.createdAt <= LOYAL_RECRUITMENT_CUTOFF_AT)) return true;
    return false;
}

export function evaluateLoyalUserEligibility(snapshot: LoyalEligibilitySnapshot): LoyalEligibilityResult {
    const recentMessages = snapshot.messages.filter(message => (
        message.timestamp >= LOYAL_RECRUITMENT_RECENT_START_AT
        && message.timestamp <= LOYAL_RECRUITMENT_CUTOFF_AT
        && isEligibleUserMessage(message)
    ));

    const messagesPerDay = new Map<string, number>();
    for (const message of recentMessages) {
        const day = beijingDayKey(message.timestamp);
        messagesPerDay.set(day, (messagesPerDay.get(day) || 0) + 1);
    }
    const activeDayKeys = [...messagesPerDay.entries()]
        .filter(([, count]) => count >= 3)
        .map(([day]) => day);
    const activeWeeks = new Set(activeDayKeys.map(day => beijingWeekKey(atBeijingNoon(day))));
    const maxPreCutoffCharacterActiveDays = getMaxPreCutoffCharacterActiveDays(snapshot.messages);

    const recentActivity = Math.min(50,
        scoreActiveDays(activeDayKeys.length)
        + scoreActiveWeeks(activeWeeks.size)
        + scoreRecentMessages(recentMessages.length),
    );
    const hardGatePassed = activeDayKeys.length >= 4
        && activeWeeks.size >= 2
        && recentMessages.length >= 20;

    const validPalaceNodes = snapshot.memoryNodes.filter(node => (
        node.createdAt <= LOYAL_RECRUITMENT_CUTOFF_AT
        && !node.isBoxSummary
        && node.origin !== 'digestion'
        && node.origin !== 'system'
    ));
    const recentPalaceNodes = validPalaceNodes.filter(node => node.createdAt >= LOYAL_RECRUITMENT_RECENT_START_AT);
    const palaceRooms = new Set(validPalaceNodes.map(node => node.room));
    const memoryPalace = Math.min(10,
        scorePalaceNodes(validPalaceNodes.length)
        + scorePalaceRooms(palaceRooms.size)
        + (recentPalaceNodes.length > 0 ? 1 : 0),
    );

    const hasQualifiedCustomCharacter = snapshot.characters.some(char => (
        char.id !== DEFAULT_CHARACTER_ID
        && hasPreCutoffCharacterEvidence(char, snapshot.messages, snapshot.memoryNodes, snapshot.guidebookSessions)
    ));
    const customCharacter = hasQualifiedCustomCharacter ? 15 : 0;

    const datedMemoryUnits = collectTraditionalMemoryUnits(snapshot.characters);
    const memoryUnits = datedMemoryUnits.reduce((sum, item) => sum + item.units, 0);
    const recentMemoryUnits = datedMemoryUnits
        .filter(item => item.recent)
        .reduce((sum, item) => sum + item.units, 0);
    const neuralMemoryEntryTimes = datedMemoryUnits
        .filter(item => item.isMemoryEntry)
        .map(item => item.at);
    const neuralMemoryEntriesTotal = neuralMemoryEntryTimes.length;
    const neuralMemoryEntriesSinceJune = neuralMemoryEntryTimes.filter(at => at >= JUNE_START_AT).length;
    const neuralMemoryEntriesSinceJuly = neuralMemoryEntryTimes.filter(at => at >= JULY_START_AT).length;
    const memoryTimes = datedMemoryUnits.map(item => item.at);
    const memorySpanDays = memoryTimes.length > 0
        ? Math.max(0, Math.floor((Math.max(...memoryTimes) - Math.min(...memoryTimes)) / DAY_MS))
        : 0;
    const neuralMemory = Math.min(25,
        scoreMemorySpan(memorySpanDays, datedMemoryUnits.length > 0)
        + scoreMemoryUnits(memoryUnits)
        + scoreRecentMemoryUnits(recentMemoryUnits),
    );

    const breakdown: LoyalEligibilityBreakdown = {
        recentActivity,
        customCharacter,
        neuralMemory,
        memoryPalace,
    };
    const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

    return reclassifyLoyalEligibilityResult({
        hardGatePassed,
        score,
        breakdown,
        metrics: {
            recentUserMessages: recentMessages.length,
            recentActiveDays: activeDayKeys.length,
            recentActiveWeeks: activeWeeks.size,
            maxPreCutoffCharacterActiveDays,
            hasQualifiedCustomCharacter,
            memoryUnits,
            recentMemoryUnits,
            memorySpanDays,
            neuralMemoryEntriesTotal,
            neuralMemoryEntriesSinceJune,
            neuralMemoryEntriesSinceJuly,
            palaceNodes: validPalaceNodes.length,
            recentPalaceNodes: recentPalaceNodes.length,
            palaceRooms: palaceRooms.size,
        },
    });
}

/** 一次性读取本机完整历史并生成截面；任一读取失败都会抛出，由 UI 视为技术失败、不消耗机会。 */
export async function collectAndEvaluateLoyalUserEligibility(): Promise<LoyalEligibilityResult> {
    const [characters, messages, guidebookSessions] = await Promise.all([
        DB.getAllCharacters(),
        DB.getRawStoreData('messages') as Promise<Message[]>,
        DB.getAllGuidebookSessions(),
    ]);
    const nodeLists = await Promise.all(characters.map(char => MemoryNodeDB.getByCharId(char.id)));
    return evaluateLoyalUserEligibility({
        characters,
        messages,
        guidebookSessions,
        memoryNodes: nodeLists.flat(),
    });
}
