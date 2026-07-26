/**
 * 「家园」离线 tick 调度器。
 *
 * 与 VRScheduler 的"固定间隔"不同，家园按**每日时段**触发：
 * 凌晨（02:00 后）/ 早（09:00 后）/ 午（14:00 后）/ 晚（21:00 后），每个时段当天最多一轮。
 * 错过时段后回到前台会补火（和 VRScheduler 一样的 visibilitychange / focus /
 * 主线程轮询三重兜底），所以"早上没开 App，中午打开"会把早上那轮补上——
 * 这正是"我不看的时候世界慢慢走，我一看就加速"的体验。
 *
 * 时段判定按**每个世界自己的时区**（WorldProfile.timezone，不设=本机）：不然「东京家园的早上」
 * 会在本机凌晨触发，和世界钟（realNowSeg）对不上。日历日也一样按世界时区算，否则跨日的
 * fired 记录会在错误的时刻清零、当天配额被多烧一轮。
 *
 * 存储（localStorage，独立键，不与 vr_schedules / proactive 挤占）：
 *   - world_tick_slots: { [worldId]: { slots: slot[]; tz?: string } }（旧格式 slot[] 读时自动兼容）
 *   - world_tick_fired: { [worldId]: { date: 'YYYY-MM-DD', fired: slot[] } }
 */

import type { WorldProfile } from '../../types';
import { nowInTimeZone } from '../timezone';

export type WorldTickSlot = 'latenight' | 'morning' | 'noon' | 'evening';

const SLOTS_KEY = 'world_tick_slots';
const FIRED_KEY = 'world_tick_fired';
const MAIN_THREAD_CHECK_INTERVAL = 60_000;

/** 各时段的起火时刻（小时，世界当地时间）。latenight 按当天日历日的凌晨 2 点计。 */
const SLOT_HOUR: Record<WorldTickSlot, number> = { latenight: 2, morning: 9, noon: 14, evening: 21 };

/** 一个世界的调度项。tz 空 = 跟随本机。 */
type SlotEntry = { slots: WorldTickSlot[]; tz?: string };
/** 旧格式（值直接是 slot 数组）也要读得动——老用户的 localStorage 里就是它。 */
type SlotsMap = Record<string, SlotEntry | WorldTickSlot[]>;
type FiredMap = Record<string, { date: string; fired: WorldTickSlot[] }>;

/** 兼容读取：旧格式 slot[] → { slots }。 */
const normalizeEntry = (v: SlotEntry | WorldTickSlot[] | undefined): SlotEntry =>
    Array.isArray(v) ? { slots: v } : { slots: v?.slots || [], tz: v?.tz };

const sameSlots = (a: WorldTickSlot[], b: WorldTickSlot[]): boolean =>
    a.length === b.length && a.every(slot => b.includes(slot));

/**
 * 世界列表 → reconcile 的入参（三处调用点共用一份口径，避免漏传时区）。
 * 只收开了离线 tick 的世界；sim（虚拟时间）世界不跟世界时区，按本机时刻触发。
 */
export const toTickEntries = (worlds: WorldProfile[]): { worldId: string; slots: WorldTickSlot[]; tz?: string }[] =>
    worlds
        .filter(w => (w.offlineTickSlots?.length || 0) > 0)
        .map(w => ({
            worldId: w.id,
            slots: w.offlineTickSlots!,
            tz: (w.timeMode ?? 'real') === 'sim' ? undefined : w.timezone,
        }));

function load<T>(key: string): T {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' ? parsed : {}) as T;
    } catch {
        return {} as T;
    }
}

function save(key: string, value: object) {
    if (Object.keys(value).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
}

/** 某世界当地的「今天」与「现在几点」。tz 空 = 本机。 */
const localNow = (tz?: string) => {
    const d = nowInTimeZone(tz);
    return {
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        hour: d.getHours(),
    };
};

let triggerCallback: ((worldId: string, trigger: 'observe' | 'tick') => void | Promise<void>) | null = null;
let visibilityListener: (() => void) | null = null;
let focusListener: (() => void) | null = null;
let mainThreadTimer: ReturnType<typeof setInterval> | null = null;

function checkDue() {
    if (!triggerCallback) return;
    const slotsMap = load<SlotsMap>(SLOTS_KEY);
    const firedMap = load<FiredMap>(FIRED_KEY);
    let changed = false;

    for (const [worldId, raw] of Object.entries(slotsMap)) {
        const { slots, tz } = normalizeEntry(raw);
        if (slots.length === 0) continue;
        // 时段/日历日按这个世界自己的时区判定
        const { date, hour } = localNow(tz);
        let rec = firedMap[worldId];
        if (!rec || rec.date !== date) {
            rec = { date, fired: [] };
            firedMap[worldId] = rec;
            changed = true;
        }
        for (const slot of slots) {
            if (rec.fired.includes(slot)) continue;
            if (hour < SLOT_HOUR[slot]) continue;
            rec.fired.push(slot);
            changed = true;
            void triggerCallback(worldId, 'tick');
            // 一次 check 每个世界最多补一轮：链式 N 角色调用很贵，
            // 错过的多个时段隔分钟级轮询逐个补，不在同一瞬间叠加触发。
            break;
        }
    }
    if (changed) save(FIRED_KEY, firedMap);
}

function handleVisibility() {
    if (document.visibilityState !== 'visible') return;
    checkDue();
}

function attachListeners() {
    detachListeners();
    visibilityListener = handleVisibility;
    document.addEventListener('visibilitychange', visibilityListener);
    focusListener = checkDue;
    window.addEventListener('focus', focusListener);
    if (!mainThreadTimer) mainThreadTimer = setInterval(checkDue, MAIN_THREAD_CHECK_INTERVAL);
}

function detachListeners() {
    if (visibilityListener) {
        document.removeEventListener('visibilitychange', visibilityListener);
        visibilityListener = null;
    }
    if (focusListener) {
        window.removeEventListener('focus', focusListener);
        focusListener = null;
    }
    if (mainThreadTimer) {
        clearInterval(mainThreadTimer);
        mainThreadTimer = null;
    }
}

export const WorldScheduler = {
    /** 注册触发回调（应用启动时调一次）。 */
    onTrigger(callback: (worldId: string, trigger: 'observe' | 'tick') => void | Promise<void>) {
        triggerCallback = callback;
        if (Object.keys(load<SlotsMap>(SLOTS_KEY)).length > 0) {
            attachListeners();
            checkDue();
        }
    },

    /**
     * 以世界配置为准重建调度表。
     * 调度表存 localStorage 不随备份迁移，世界配置（offlineTickSlots）存 IndexedDB
     * 随备份走——和 VRScheduler.reconcile 同样的对账逻辑。
     * 注意：新加入调度的世界，"今天已经过去的时段"视为已耗尽，不补火——
     * 避免用户刚配置完就瞬间连烧几轮 LLM 调用。
     */
    reconcile(active: { worldId: string; slots: WorldTickSlot[]; tz?: string }[]) {
        const previousSlotsMap = load<SlotsMap>(SLOTS_KEY);
        const slotsMap: SlotsMap = {};
        const firedMap = load<FiredMap>(FIRED_KEY);
        let firedChanged = false;

        for (const a of active) {
            if (a.slots.length === 0) continue;
            slotsMap[a.worldId] = { slots: a.slots, tz: a.tz };
            // "今天已经过去的时段"按该世界当地时间算——换了时区的世界跟着一起挪
            const { date, hour } = localNow(a.tz);
            const previousRaw = previousSlotsMap[a.worldId];
            const previous = normalizeEntry(previousRaw);
            const configChanged = previousRaw === undefined
                || previous.tz !== a.tz
                || !sameSlots(previous.slots, a.slots);
            // 同一日内换时区也必须重算：例如东京 21 点切到洛杉矶 5 点，东京已经
            // fired 的 evening 在洛杉矶仍是未来，不能继续占着配额；反向切换则要
            // 把新时区已经过去的时段标为耗尽，避免配置一保存就补火。
            if (!firedMap[a.worldId] || firedMap[a.worldId].date !== date || configChanged) {
                firedMap[a.worldId] = { date, fired: a.slots.filter(s => hour >= SLOT_HOUR[s]) };
                firedChanged = true;
            }
        }
        for (const id of Object.keys(firedMap)) {
            if (!slotsMap[id]) {
                delete firedMap[id];
                firedChanged = true;
            }
        }

        save(SLOTS_KEY, slotsMap);
        if (firedChanged) save(FIRED_KEY, firedMap);
        if (Object.keys(slotsMap).length > 0) attachListeners();
        else detachListeners();
    },

    /** 立刻触发一轮"观测"（UI 推进按钮用），不占用当日 tick 配额。 */
    triggerNow(worldId: string) {
        if (triggerCallback) void triggerCallback(worldId, 'observe');
    },
};
