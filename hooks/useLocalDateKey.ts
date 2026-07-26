import { useEffect, useState } from 'react';
import { getLocalDateKey, msUntilNextLocalDay } from '../utils/localDate';
import { nowInTimeZone } from '../utils/timezone';

/**
 * Reactive calendar date. With a timeZone it follows that IANA zone; otherwise
 * it follows the device. The minute poll catches target-zone midnight and live
 * timezone changes even when their midnight differs from the device's.
 */
export function useLocalDateKey(timeZone?: string): string {
    const readDateKey = () => getLocalDateKey(nowInTimeZone(timeZone));
    const [dateKey, setDateKey] = useState(readDateKey);

    useEffect(() => {
        let midnightTimer: ReturnType<typeof setTimeout> | null = null;

        const refresh = () => {
            setDateKey(previous => {
                const next = readDateKey();
                return previous === next ? previous : next;
            });
            scheduleMidnight();
        };

        const scheduleMidnight = () => {
            if (midnightTimer) clearTimeout(midnightTimer);
            midnightTimer = setTimeout(refresh, msUntilNextLocalDay());
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') refresh();
        };

        refresh();
        const timezonePoll = window.setInterval(refresh, 60_000);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            if (midnightTimer) clearTimeout(midnightTimer);
            window.clearInterval(timezonePoll);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [timeZone]);

    return dateKey;
}
