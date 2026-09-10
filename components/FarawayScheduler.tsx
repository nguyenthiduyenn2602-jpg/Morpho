import React, { useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import {
    deliverTravelCard,
    finishJourneyIfDue,
    loadFarawayState,
    saveFarawayState,
} from '../utils/farawayTravel';

const CHECK_INTERVAL_MS = 60_000;

/**
 * 远方有信的本地补偿调度器。
 * 页面关闭时不伪装后台常驻；重新打开 Morpho 后，会把到点但未送达的卡片补进私聊。
 * 中途消息若已经交给主动消息 2.0，则只登记完成，避免本地与云端重复发送。
 */
const FarawayScheduler: React.FC = () => {
    const { isDataLoaded, addToast } = useOS();
    const running = useRef(false);

    useEffect(() => {
        if (!isDataLoaded) return;
        let cancelled = false;

        const run = async () => {
            if (cancelled || running.current) return;
            running.current = true;
            try {
                let state = loadFarawayState();
                const journey = state.journey;
                if (!journey) return;
                const now = Date.now();
                let changed = false;
                let delivered = 0;

                const events = [...journey.events];
                for (let index = 0; index < events.length; index += 1) {
                    const event = events[index];
                    if (event.deliveredAt || event.dueAt > now) continue;
                    if (event.kind === 'mid' && event.cloudScheduled) {
                        events[index] = { ...event, deliveredAt: now };
                        changed = true;
                        continue;
                    }
                    await deliverTravelCard(journey, event);
                    events[index] = { ...event, deliveredAt: Date.now() };
                    changed = true;
                    delivered += 1;
                }

                if (changed) state = { ...state, journey: { ...journey, events } };
                const completed = finishJourneyIfDue(state, now);
                if (completed !== state) {
                    state = completed;
                    changed = true;
                }
                if (changed) saveFarawayState(state);
                if (delivered) addToast(`${journey.charName}从远方捎来了消息`, 'info');
            } catch (error) {
                console.warn('[Faraway] 本地旅行消息补偿失败', error);
            } finally {
                running.current = false;
            }
        };

        run();
        const timer = window.setInterval(run, CHECK_INTERVAL_MS);
        const onVisible = () => { if (!document.hidden) void run(); };
        window.addEventListener('focus', run);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.removeEventListener('focus', run);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [isDataLoaded, addToast]);

    return null;
};

export default FarawayScheduler;
