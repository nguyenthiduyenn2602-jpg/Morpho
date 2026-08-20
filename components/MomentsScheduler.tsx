import React, { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import {
    backfillCount,
    computeNextMomentAt,
    generateRoleMoment,
    loadMomentsSettings,
    saveMomentsSettings,
} from '../utils/moments';

const LOCK_KEY = 'morpho_moments_scheduler_lock_v1';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const acquireLock = (): boolean => {
    try {
        const now = Date.now();
        const current = Number(localStorage.getItem(LOCK_KEY) || 0);
        if (current > now) return false;
        localStorage.setItem(LOCK_KEY, String(now + 12 * 60 * 1000));
        return true;
    } catch { return true; }
};

const releaseLock = () => {
    try { localStorage.removeItem(LOCK_KEY); } catch { /* ignore */ }
};

const notify = async (text: string, openMoments: () => void) => {
    if (Capacitor.isNativePlatform()) {
        try {
            const status = await LocalNotifications.checkPermissions();
            if (status.display === 'granted') {
                await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2_000_000_000), title: '朋友圈', body: text, schedule: { at: new Date(Date.now() + 350) } }] });
                return;
            }
        } catch { /* fall through */ }
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        try {
            const notification = new Notification('朋友圈', { body: text, icon: './icons/icon-192.webp', tag: 'morpho-moments' });
            notification.onclick = () => { window.focus(); openMoments(); notification.close(); };
        } catch { /* toast below is the final fallback */ }
    }
};

/**
 * 第一版本地调度器：常驻 PhoneShell，不依赖朋友圈 App 是否打开。
 * 页面关闭期间不硬保活；下次打开 Morpho 时按离线时长补 1—5 条，时间均匀错开，
 * 全部成功后只报一条合并通知。
 */
const MomentsScheduler: React.FC = () => {
    const { isDataLoaded, characters, userProfile, apiConfig, addToast, openApp } = useOS();
    const running = useRef(false);
    const latest = useRef({ characters, userProfile, apiConfig });
    latest.current = { characters, userProfile, apiConfig };

    useEffect(() => {
        if (!isDataLoaded) return;
        let cancelled = false;

        const run = async () => {
            if (cancelled || running.current || !acquireLock()) return;
            running.current = true;
            try {
                let settings = await loadMomentsSettings();
                if (!settings.autoPublishEnabled || !settings.invitedCharIds.length) return;
                const eligible = latest.current.characters.filter(c => settings.invitedCharIds.includes(c.id));
                if (!eligible.length) return;
                const now = Date.now();
                if (!settings.lastAutoRunAt) {
                    settings = { ...settings, lastAutoRunAt: now, nextAutoAt: computeNextMomentAt(settings, now) };
                    await saveMomentsSettings(settings);
                    return;
                }
                const missed = backfillCount(settings, now);
                const due = !settings.nextAutoAt || now >= settings.nextAutoAt;
                const count = Math.min(5, Math.max(due ? 1 : 0, missed));
                if (!count) return;

                const start = Math.max(settings.lastAutoRunAt, now - 4 * 24 * 3_600_000);
                const authors: string[] = [];
                const newPostIds: string[] = [];
                for (let i = 0; i < count; i++) {
                    if (cancelled) break;
                    // 不把补发挤在同一分钟：历史时间均匀铺开，并留少量随机偏移。
                    const fraction = (i + 1) / (count + 1);
                    const base = start + (now - start) * fraction;
                    const spread = Math.min(40 * 60_000, Math.max(2 * 60_000, (now - start) / Math.max(4, count * 3)));
                    const createdAt = Math.min(now - 20_000, Math.round(base + (Math.random() - 0.5) * spread));
                    const result = await generateRoleMoment({
                        characters: latest.current.characters,
                        userProfile: latest.current.userProfile,
                        apiConfig: latest.current.apiConfig,
                        settings,
                        createdAt,
                    });
                    authors.push(result.author.name);
                    newPostIds.push(result.post.id);
                }
                if (!newPostIds.length) return;
                settings = {
                    ...settings,
                    lastAutoRunAt: now,
                    nextAutoAt: computeNextMomentAt(settings, now),
                    unreadPostIds: [...new Set([...settings.unreadPostIds, ...newPostIds])].slice(-80),
                };
                await saveMomentsSettings(settings);
                const unique = [...new Set(authors)];
                const text = unique.length === 1 ? `${unique[0]}发了朋友圈` : `${unique.slice(0, 2).join('、')}${unique.length > 2 ? `等${unique.length}人` : ''}发了朋友圈`;
                addToast(text, 'info');
                await notify(text, () => openApp(AppID.Moments));
            } catch (err: any) {
                console.warn('[Moments] 自动发布失败', err);
                addToast(`朋友圈自动发布暂停：${err?.message || '生成失败'}`, 'error');
            } finally {
                running.current = false;
                releaseLock();
            }
        };

        run();
        const timer = window.setInterval(run, CHECK_INTERVAL_MS);
        const settingsChanged = () => { window.setTimeout(run, 300); };
        window.addEventListener('moments-settings-updated', settingsChanged);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.removeEventListener('moments-settings-updated', settingsChanged);
        };
    }, [isDataLoaded]);

    return null;
};

export default MomentsScheduler;
