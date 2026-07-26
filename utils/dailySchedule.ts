import { CharacterProfile, DailySchedule } from '../types';
import { DB } from './db';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone, resolveCharTimeZone } from './timezone';

/**
 * Load a schedule for the requested calendar timezone (device time by default).
 *
 * Older builds keyed schedules by UTC date or by the phone's date. If the target
 * key is absent, a legacy record is reused only when its generatedAt belongs to
 * today in the requested timezone. Historical records are deliberately untouched.
 */
export async function getLocalDailySchedule(
    charId: string,
    at: Date = new Date(),
    timeZone?: string,
): Promise<DailySchedule | null> {
    const localKey = getLocalDateKey(nowInTimeZone(timeZone, at));
    const current = await DB.getDailySchedule(charId, localKey);
    if (current) return current;

    // 兼容两类旧 key：
    // 1) 更早版本按 UTC 日写入；
    // 2) 角色时区支持接入前按手机日写入。
    // 只有 generatedAt 在角色当地确实属于“今天”时才迁移，历史日程绝不挪动。
    const legacyKeys = [
        getLocalDateKey(at),
        at.toISOString().slice(0, 10),
    ].filter((key, index, all) => key !== localKey && all.indexOf(key) === index);

    for (const legacyKey of legacyKeys) {
        const legacy = await DB.getDailySchedule(charId, legacyKey);
        if (!legacy || !Number.isFinite(legacy.generatedAt)) continue;
        const generatedWallClock = nowInTimeZone(timeZone, new Date(legacy.generatedAt));
        if (getLocalDateKey(generatedWallClock) !== localKey) continue;

        const migrated: DailySchedule = {
            ...legacy,
            id: `${charId}_${localKey}`,
            charId,
            date: localKey,
        };
        await DB.saveDailySchedule(migrated);
        return migrated;
    }
    return null;
}

/** 按角色自己的日历日读取日程；未开启自定义时区时保持原本的手机时间行为。 */
export function getDailyScheduleForChar(
    char: Pick<CharacterProfile, 'id' | 'customTimezoneEnabled' | 'customTimezone'>,
    at: Date = new Date(),
): Promise<DailySchedule | null> {
    return getLocalDailySchedule(char.id, at, resolveCharTimeZone(char));
}
