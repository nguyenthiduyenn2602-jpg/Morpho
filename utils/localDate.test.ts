import { afterAll, describe, expect, it } from 'vitest';
import { addLocalDays, getCalendarDayDifference, getLocalDateKey, getLocalDayRange, getVirtualDayKey, parseLocalDateKey } from './localDate';

const originalTimeZone = process.env.TZ;

afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
});

describe('local calendar dates', () => {
    it.each([
        ['Asia/Shanghai', '2026-07-20T16:30:00.000Z', '2026-07-21'],
        ['Etc/GMT-12', '2026-07-20T12:30:00.000Z', '2026-07-21'],
        ['Pacific/Kiritimati', '2026-07-20T10:30:00.000Z', '2026-07-21'],
        ['Etc/GMT+12', '2026-07-21T12:30:00.000Z', '2026-07-21'],
    ])('uses the system date in %s', (timeZone, instant, expected) => {
        process.env.TZ = timeZone;
        expect(getLocalDateKey(new Date(instant))).toBe(expected);
    });

    it('changes at local midnight for China users', () => {
        process.env.TZ = 'Asia/Shanghai';
        expect(getLocalDateKey(new Date('2026-07-20T15:59:59.999Z'))).toBe('2026-07-20');
        expect(getLocalDateKey(new Date('2026-07-20T16:00:00.000Z'))).toBe('2026-07-21');
    });

    it('parses and adds date-only values as local calendar dates', () => {
        process.env.TZ = 'Asia/Shanghai';
        expect(parseLocalDateKey('2026-02-29')).toBeNull();
        expect(addLocalDays('2026-02-28', 1)).toBe('2026-03-01');
        expect(getCalendarDayDifference('2026-03-08', '2026-03-09')).toBe(1);
    });

    it('uses the next local midnight across DST instead of a fixed 24 hours', () => {
        process.env.TZ = 'America/New_York';
        const spring = getLocalDayRange('2026-03-08');
        const autumn = getLocalDayRange('2026-11-01');
        expect(spring && spring.end - spring.start).toBe(23 * 60 * 60 * 1000);
        expect(autumn && autumn.end - autumn.start).toBe(25 * 60 * 60 * 1000);
    });

    it('virtual day changes at 06:00 and handles month boundaries', () => {
        process.env.TZ = 'Asia/Shanghai';
        expect(getVirtualDayKey(new Date(2026, 2, 1, 5, 59))).toBe('2026-02-28');
        expect(getVirtualDayKey(new Date(2026, 2, 1, 6, 0))).toBe('2026-03-01');
    });

    it('does not mutate the supplied wall-clock date', () => {
        const input = new Date(2026, 6, 21, 3, 30);
        const before = input.getTime();
        expect(getVirtualDayKey(input)).toBe('2026-07-20');
        expect(input.getTime()).toBe(before);
    });
});
