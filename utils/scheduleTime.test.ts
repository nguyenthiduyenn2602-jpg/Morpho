import { afterAll, describe, expect, it } from 'vitest';
import type { CharacterProfile, ScheduleSlot } from '../types';
import {
    getCurrentScheduleSlotIndex,
    getScheduleDateKey,
    getScheduleWallClock,
} from './scheduleTime';

const originalTimeZone = process.env.TZ;

afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
});

const losAngelesChar = {
    customTimezoneEnabled: true,
    customTimezone: 'America/Los_Angeles',
} as CharacterProfile;

const slots: ScheduleSlot[] = [
    { startTime: '08:00', activity: '早餐' },
    { startTime: '12:00', activity: '午餐' },
    { startTime: '18:00', activity: '晚饭' },
];

describe('character schedule clock', () => {
    it('uses the character wall clock for date, time and current-slot ordering', () => {
        process.env.TZ = 'Asia/Shanghai';
        const instant = new Date('2026-07-20T16:30:00.000Z');
        const wallClock = getScheduleWallClock(losAngelesChar, instant);

        expect(getScheduleDateKey(losAngelesChar, instant)).toBe('2026-07-20');
        expect([wallClock.getHours(), wallClock.getMinutes()]).toEqual([9, 30]);
        expect(getCurrentScheduleSlotIndex(slots, losAngelesChar, instant)).toBe(0);
    });

    it('falls back to the phone clock when custom timezone is disabled', () => {
        process.env.TZ = 'Asia/Shanghai';
        const instant = new Date('2026-07-20T16:30:00.000Z'); // 手机 7/21 00:30
        const disabled = {
            ...losAngelesChar,
            customTimezoneEnabled: false,
        };

        expect(getScheduleDateKey(disabled, instant)).toBe('2026-07-21');
        expect(getCurrentScheduleSlotIndex(slots, disabled, instant)).toBe(-1);
    });

    it('ignores malformed slot times instead of selecting them', () => {
        const instant = new Date('2026-07-20T16:30:00.000Z');
        expect(getCurrentScheduleSlotIndex([
            { startTime: 'not-a-time', activity: '坏数据' },
            ...slots,
        ], losAngelesChar, instant)).toBe(1);
    });
});
