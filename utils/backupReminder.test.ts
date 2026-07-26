import { describe, it, expect, beforeEach } from 'vitest';
import {
    getBackupReminderState,
    setBackupReminderIntervalDays,
    markBackupDone,
    markBackupReminderShown,
    shouldShowBackupReminder,
    daysSinceLastBackup,
    clampReminderDays,
    BACKUP_REMINDER_DEFAULT_DAYS,
} from './backupReminder';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000; // 固定基准时间，避开 Date.now()

beforeEach(() => {
    localStorage.clear();
});

describe('clampReminderDays', () => {
    it('夹在 1~30，取整，非法值回默认', () => {
        expect(clampReminderDays(0)).toBe(1);
        expect(clampReminderDays(999)).toBe(30);
        expect(clampReminderDays(7.6)).toBe(8);
        expect(clampReminderDays(NaN)).toBe(BACKUP_REMINDER_DEFAULT_DAYS);
    });
});

describe('getBackupReminderState', () => {
    it('首次读取锚定 firstSeenAt 并回写，默认间隔 7 天', () => {
        const st = getBackupReminderState(T0);
        expect(st.intervalDays).toBe(BACKUP_REMINDER_DEFAULT_DAYS);
        expect(st.firstSeenAt).toBe(T0);
        expect(st.lastBackupAt).toBe(0);
        // 回写后再读，firstSeenAt 不再随 now 变
        expect(getBackupReminderState(T0 + 5 * DAY).firstSeenAt).toBe(T0);
    });
});

describe('shouldShowBackupReminder', () => {
    it('新用户刚进来（未到间隔）不弹', () => {
        getBackupReminderState(T0); // 锚 firstSeenAt = T0
        expect(shouldShowBackupReminder(T0 + 3 * DAY)).toBe(false);
    });

    it('从未备份且超过间隔 → 弹', () => {
        getBackupReminderState(T0);
        expect(shouldShowBackupReminder(T0 + 8 * DAY)).toBe(true);
    });

    it('弹过之后进入一个间隔的冷却，不再连弹', () => {
        getBackupReminderState(T0);
        expect(shouldShowBackupReminder(T0 + 8 * DAY)).toBe(true);
        markBackupReminderShown(T0 + 8 * DAY);
        expect(shouldShowBackupReminder(T0 + 9 * DAY)).toBe(false); // 冷却中
        expect(shouldShowBackupReminder(T0 + 16 * DAY)).toBe(true);  // 又过了一个间隔
    });

    it('备份成功后不再弹，且清掉提醒冷却', () => {
        getBackupReminderState(T0);
        markBackupReminderShown(T0 + 8 * DAY);
        markBackupDone(T0 + 9 * DAY);
        expect(getBackupReminderState().lastRemindedAt).toBe(0);
        expect(shouldShowBackupReminder(T0 + 10 * DAY)).toBe(false);
        // 距上次备份再次超过间隔才会重新弹
        expect(shouldShowBackupReminder(T0 + 17 * DAY)).toBe(true);
    });

    it('间隔可调：设成 1 天后隔天就弹', () => {
        getBackupReminderState(T0);
        setBackupReminderIntervalDays(1, T0);
        expect(shouldShowBackupReminder(T0 + 12 * 60 * 60 * 1000)).toBe(false); // 半天
        expect(shouldShowBackupReminder(T0 + 1.5 * DAY)).toBe(true);
    });
});

describe('daysSinceLastBackup', () => {
    it('从未备份返回 null', () => {
        getBackupReminderState(T0);
        expect(daysSinceLastBackup(T0 + 3 * DAY)).toBeNull();
    });
    it('备份后按天数向下取整', () => {
        markBackupDone(T0);
        expect(daysSinceLastBackup(T0 + 3.9 * DAY)).toBe(3);
    });
});
