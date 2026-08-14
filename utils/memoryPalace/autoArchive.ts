import type { MemoryFragment } from '../../types';
import { DB } from '../db';
import { MemoryNodeDB } from './db';
import type { MemoryNode } from './types';
import {
    buildAutoArchiveFragments,
    getMemoryPalaceHighWaterMark,
    mergePalaceFragmentsIntoMemories,
    processNewMessages,
    type PipelineResult,
} from './pipeline';

/**
 * React 外的记忆后处理完成后，用这个事件把刚落进 IndexedDB 的传统记忆同步回 OSContext。
 * detail 只带增量，OSContext 会基于自己那份最新角色状态再 merge，避免整对象回灌覆盖其它字段。
 */
export const MEMORY_AUTO_ARCHIVE_SYNC_EVENT = 'memory-auto-archive-synced';

export type AutoArchiveFragment = NonNullable<PipelineResult['autoArchive']>['fragments'][number];

export interface MemoryAutoArchiveSyncDetail {
    charId: string;
    fragments: AutoArchiveFragment[];
    hideBeforeMessageId?: number;
}

const persistChains = new Map<string, Promise<unknown>>();

function enqueuePersist<T>(charId: string, task: () => Promise<T>): Promise<T> {
    const previous = persistChains.get(charId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    persistChains.set(charId, current);
    void current.finally(() => {
        if (persistChains.get(charId) === current) persistChains.delete(charId);
    }).catch(() => undefined);
    return current;
}

function dispatchSync(detail: MemoryAutoArchiveSyncDetail): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<MemoryAutoArchiveSyncDetail>(MEMORY_AUTO_ARCHIVE_SYNC_EVENT, { detail }));
}

function sameMemories(a: MemoryFragment[] | undefined, b: MemoryFragment[]): boolean {
    if (a === b) return true;
    if (!a || a.length !== b.length) return false;
    return a.every((item, index) => (
        item.id === b[index].id
        && item.date === b[index].date
        && item.mood === b[index].mood
        && item.summary === b[index].summary
    ));
}

/**
 * 把 processNewMessages 的自动归档建议真正写入角色档案。
 *
 * 过去这一步散落在 React 调用方：Push、彼方、家园等入口只接了宫殿写入，忘了接返回值，
 * 于是出现“宫殿有总结、神经链接没副本”。现在所有自动入口统一走本函数。
 */
export function persistAutoArchiveResult(
    charId: string,
    result: PipelineResult | null,
): Promise<{ fragments: number; changed: boolean }> {
    if (!result || result.skipReason === 'lock') {
        return Promise.resolve({ fragments: 0, changed: false });
    }

    return enqueuePersist(charId, async () => {
        const allCharacters = await DB.getAllCharacters();
        const character = allCharacters.find(item => item.id === charId);
        if (!character?.memoryPalaceEnabled || !character.autoArchiveEnabled) {
            return { fragments: 0, changed: false };
        }

        const fragments = result.autoArchive?.fragments || [];
        const currentMemories = character.memories || [];
        const nextMemories = fragments.length > 0
            ? mergePalaceFragmentsIntoMemories(currentMemories, fragments)
            : currentMemories;
        const currentHide = character.hideBeforeMessageId || 0;
        const nextHide = Math.max(
            currentHide,
            result.autoArchive?.hideBeforeMessageId || 0,
            getMemoryPalaceHighWaterMark(charId),
        );
        const memoriesChanged = !sameMemories(currentMemories, nextMemories);
        const hideChanged = nextHide > currentHide;
        if (!memoriesChanged && !hideChanged) {
            return { fragments: 0, changed: false };
        }

        await DB.saveCharacter({
            ...character,
            ...(memoriesChanged ? { memories: nextMemories } : {}),
            ...(hideChanged ? { hideBeforeMessageId: nextHide } : {}),
        });
        dispatchSync({
            charId,
            fragments: memoriesChanged ? fragments : [],
            hideBeforeMessageId: hideChanged ? nextHide : undefined,
        });
        return { fragments: fragments.length, changed: true };
    });
}

/** 自动总结的唯一常规入口：宫殿写入成功后，紧接着完成神经链接双写。 */
export async function processNewMessagesWithAutoArchive(
    ...args: Parameters<typeof processNewMessages>
): Promise<PipelineResult | null> {
    const result = await processNewMessages(...args);
    await persistAutoArchiveResult(args[1], result);
    return result;
}

const localDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * 为旧版本漏写的数据构造保守回填：
 * - 必须已经有过 palace 传统记忆，证明该角色原本确实在走双写；
 * - 只看聊天提取节点，排除群聊、消化衍生和事件盒总结；
 * - 只补最后一条 palace 记忆之后、且神经链接整天完全空白的日期。
 *
 * 这样可以修复“7 月 21 日后整段断掉”这类缺口，同时不重复搬运手动导入或旧迁移内容。
 */
export function buildConservativeRepairFragments(
    existing: MemoryFragment[],
    nodes: MemoryNode[],
): AutoArchiveFragment[] {
    const palaceDates = existing
        .filter(memory => memory.mood === 'palace' && /^\d{4}-\d{2}-\d{2}$/.test(memory.date))
        .map(memory => memory.date)
        .sort();
    const lastPalaceDate = palaceDates[palaceDates.length - 1];
    if (!lastPalaceDate) return [];

    const occupiedDates = new Set(existing.map(memory => memory.date));
    const candidates = nodes.filter(node => {
        if (node.origin !== 'extraction' || node.groupId || node.isBoxSummary || node.sourceId) return false;
        if (!node.content?.trim() || !Number.isFinite(node.createdAt)) return false;
        const date = localDate(node.createdAt);
        return date > lastPalaceDate && !occupiedDates.has(date);
    });
    return buildAutoArchiveFragments(candidates, 0)?.fragments || [];
}

/** 启动时跑一次的旧缺口修复；不调 LLM、不重做向量、不改宫殿水位线。 */
export function repairMissingAutoArchiveMemories(
    charId: string,
): Promise<{ fragments: number; changed: boolean }> {
    return enqueuePersist(charId, async () => {
        const [allCharacters, nodes] = await Promise.all([
            DB.getAllCharacters(),
            MemoryNodeDB.getByCharId(charId),
        ]);
        const character = allCharacters.find(item => item.id === charId);
        if (!character?.memoryPalaceEnabled || !character.autoArchiveEnabled) {
            return { fragments: 0, changed: false };
        }

        const fragments = buildConservativeRepairFragments(character.memories || [], nodes);
        if (fragments.length === 0) return { fragments: 0, changed: false };

        const nextMemories = mergePalaceFragmentsIntoMemories(character.memories || [], fragments);
        await DB.saveCharacter({ ...character, memories: nextMemories });
        dispatchSync({ charId, fragments });
        console.log(`[AutoArchiveRepair] ${character.name}: repaired ${fragments.length} missing day(s)`);
        return { fragments: fragments.length, changed: true };
    });
}
