/**
 * backupReminder.ts
 * 「该备份啦」提醒的纯逻辑 + localStorage 持久化。
 *
 * 背景：糯米机（SullyOS）是 local-first，全部数据只在用户自己的浏览器 IndexedDB 里，
 * 清缓存 / 换设备 / 崩溃就全没了。所以隔一段时间没导出就温柔提醒一次。
 *
 * 设计：自包含模块（不进 OSContext 那坨大 interface），对齐 WorkerUpdateReminderEvent 的写法。
 *  - 频率用户可在「设置 → 备份」里改，1~30 天，默认 7 天。
 *  - markBackupDone(): 任何一次成功导出/云备份后调用，推进 lastBackupAt 并清掉提醒态。
 *  - shouldShowBackupReminder(): PhoneShell 用它决定弹不弹。
 *  - 纯函数都接受可注入的 now，方便 vitest 直测。
 */

const KEY = 'sullyos_backup_reminder';
const DAY_MS = 24 * 60 * 60 * 1000;

export const BACKUP_REMINDER_MIN_DAYS = 1;
export const BACKUP_REMINDER_MAX_DAYS = 30;
export const BACKUP_REMINDER_DEFAULT_DAYS = 7;

export interface BackupReminderState {
    /** 提醒间隔（天），1~30 */
    intervalDays: number;
    /** 上次成功备份的时间戳（ms）；0 = 从未备份 */
    lastBackupAt: number;
    /** 上次弹过提醒的时间戳（ms）；0 = 从未提醒（提醒后进入一个间隔的冷却，避免天天弹） */
    lastRemindedAt: number;
    /** 首次见到此设备的时间戳（ms）；从未备份时用它当"多久没备份"的起算点，避免新用户一装就被念叨 */
    firstSeenAt: number;
}

export const clampReminderDays = (n: number): number => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return BACKUP_REMINDER_DEFAULT_DAYS;
    return Math.min(BACKUP_REMINDER_MAX_DAYS, Math.max(BACKUP_REMINDER_MIN_DAYS, v));
};

const persist = (s: BackupReminderState): void => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 隐私模式等：存不了就算了 */ }
};

/**
 * 读当前状态；缺字段用默认补齐。首次读取（firstSeenAt 为 0）时把它锚到 now 并回写，
 * 这样"从未备份"的用户也有个合理的起算点，不会一进 App 就被提醒。
 */
export function getBackupReminderState(now: number = Date.now()): BackupReminderState {
    let raw: Partial<BackupReminderState> = {};
    try {
        const s = localStorage.getItem(KEY);
        if (s) raw = JSON.parse(s) as Partial<BackupReminderState>;
    } catch { /* 坏 JSON 当空处理 */ }

    const state: BackupReminderState = {
        intervalDays: clampReminderDays(raw.intervalDays ?? BACKUP_REMINDER_DEFAULT_DAYS),
        lastBackupAt: Number(raw.lastBackupAt) || 0,
        lastRemindedAt: Number(raw.lastRemindedAt) || 0,
        firstSeenAt: Number(raw.firstSeenAt) || 0,
    };
    if (state.firstSeenAt === 0) {
        state.firstSeenAt = now;
        persist(state);
    }
    return state;
}

/** 设置提醒频率（天），返回落库后的新状态。 */
export function setBackupReminderIntervalDays(days: number, now: number = Date.now()): BackupReminderState {
    const next = { ...getBackupReminderState(now), intervalDays: clampReminderDays(days) };
    persist(next);
    return next;
}

/** 一次成功备份后调用：推进 lastBackupAt，并清掉提醒冷却（下次到点重新算）。 */
export function markBackupDone(now: number = Date.now()): void {
    persist({ ...getBackupReminderState(now), lastBackupAt: now, lastRemindedAt: 0 });
}

/** 弹过提醒后调用：记下时间，进入一个间隔的冷却，避免反复弹。 */
export function markBackupReminderShown(now: number = Date.now()): void {
    persist({ ...getBackupReminderState(now), lastRemindedAt: now });
}

/**
 * 是否该弹提醒：
 *  - 距上次备份（从未备份则距首见）已超过 intervalDays，且
 *  - 距上次提醒也已超过 intervalDays（提醒冷却；备份成功会把它清 0，于是自然不再弹）。
 */
export function shouldShowBackupReminder(now: number = Date.now()): boolean {
    const st = getBackupReminderState(now);
    const intervalMs = st.intervalDays * DAY_MS;
    const backupAnchor = st.lastBackupAt > 0 ? st.lastBackupAt : st.firstSeenAt;
    if (now - backupAnchor < intervalMs) return false;
    if (now - st.lastRemindedAt < intervalMs) return false;
    return true;
}

/** 距上次备份过了几天（向下取整）；从未备份返回 null。给弹窗文案用。 */
export function daysSinceLastBackup(now: number = Date.now()): number | null {
    const st = getBackupReminderState(now);
    if (st.lastBackupAt <= 0) return null;
    return Math.max(0, Math.floor((now - st.lastBackupAt) / DAY_MS));
}
