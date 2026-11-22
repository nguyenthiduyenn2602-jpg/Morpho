import './MorphoUpdateNotice.css';
import { MORPHO_RELEASE, shouldShowMorphoRelease, dismissMorphoRelease } from '../utils/morphoRelease';
/**
 * UpdateNotificationEvent.tsx
 * 版本更新强制提醒弹窗 (2026.5.25 小更新)
 *
 * 所有尚未确认过本次弹窗的用户，打开后都会被强制接到一次，
 * 点击"查看更新"后会跳转到使用帮助 App 的对应更新日志页。
 */

import React from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';

// 历史 key —— 保留, 让老用户的"已看过"状态延续到本月新弹窗判断里
export const UPDATE_NOTIFICATION_KEY = 'sullyos_update_2026_04_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05 = 'sullyos_update_2026_05_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05_10 = 'sullyos_update_2026_05_10_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05_17 = 'sullyos_update_2026_05_17_seen';
// 历史 key —— 5.25 情绪 buff 也接入 Instant Push
export const UPDATE_NOTIFICATION_KEY_2026_05_25 = 'sullyos_update_2026_05_25_seen';
// 历史 key —— 6.5 「彼方」上线
export const UPDATE_NOTIFICATION_KEY_2026_06_05 = 'sullyos_update_2026_06_05_seen';
// 历史 key —— 6.14 「家园」上线 · 小屋翻新 + 瑞幸咖啡
export const UPDATE_NOTIFICATION_KEY_2026_06_14 = 'sullyos_update_2026_06_14_seen';
// 历史 key —— 6.21 「查手机」翻新 + 人格模拟 · 手游风外观 · 小红书分享
export const UPDATE_NOTIFICATION_KEY_2026_06_21 = 'sullyos_update_2026_06_21_seen';
// 历史 key —— 6.26 梦境盲盒 · 联系人模式 · char 的小手机 · 见面状态栏 · 时间感知归位 · 鱼声 TTS
export const UPDATE_NOTIFICATION_KEY_2026_06_26 = 'sullyos_update_2026_06_26_seen';
// 本次更新 key —— 7.10 生活统计 · 全服写诗 · 画风重构 · 角色分组 · 记忆宫殿门牌 等
export const UPDATE_NOTIFICATION_KEY_2026_07_10 = 'sullyos_update_2026_07_10_seen';

export const FAQ_TARGET_SECTION_KEY = 'sullyos_faq_target_section';
export const CHANGELOG_2026_04 = 'changelog-2026-04';
export const CHANGELOG_2026_05 = 'changelog-2026-05';
export const CHANGELOG_2026_05_10 = 'changelog-2026-05-10';
export const CHANGELOG_2026_05_17 = 'changelog-2026-05-17';
export const CHANGELOG_2026_05_27 = 'changelog-2026-05-27';
export const CHANGELOG_2026_06_05 = 'changelog-2026-06-05';
export const CHANGELOG_2026_06_14 = 'changelog-2026-06-14';
export const CHANGELOG_2026_06_21 = 'changelog-2026-06-21';
export const CHANGELOG_2026_06_26 = 'changelog-2026-06-26';
export const CHANGELOG_2026_07_10 = 'changelog-2026-07-10';


export const shouldShowUpdateNotification = shouldShowMorphoRelease;
export const UpdateNotificationPopup: React.FC<{onClose: () => void}> = ({onClose}) => {
    const {openApp} = useOS();
    const close = () => { dismissMorphoRelease(); onClose(); };
    const view = () => {
        try { sessionStorage.setItem(FAQ_TARGET_SECTION_KEY, MORPHO_RELEASE.id); } catch { /* help still opens */ }
        close(); openApp(AppID.FAQ);
    };
    return <div className="morpho-release-overlay fixed inset-0 z-[9998] flex items-center justify-center p-5">
        <section role="dialog" aria-modal="true" aria-labelledby="morpho-release-title" className="morpho-release-sheet w-full max-w-sm max-h-[85dvh] overflow-y-auto rounded-3xl p-6 text-slate-800">
            <div className="morpho-release-stamp" aria-hidden="true">🦋</div><p className="text-xs font-bold tracking-widest morpho-release-kicker">MORPHO · {MORPHO_RELEASE.date}</p>
            <h2 id="morpho-release-title" className="mt-3 text-xl font-bold">{MORPHO_RELEASE.title}</h2>
            <p className="morpho-release-intro">天冷了，今天想吃点什么？</p>
            <div className="morpho-release-cards mt-5 space-y-4 text-sm leading-6">
                <div>
                    <h3 className="font-bold">🍲 吃了什么，私聊里说一声</h3>
                    <p className="mt-1 text-slate-600">授权一位角色后，吃过的东西匹配到冰箱库存，他会在下一轮回复开头发「饮食」卡片。点确认才扣库存。外卖和顺手买的零食照常聊。</p>
                </div>
                <div>
                    <h3 className="font-bold">🧺 入库手动记，花销归记账本</h3>
                    <p className="mt-1 text-slate-600">新买的食材目前仍要在冰箱里手动添加。两边各记各的，饮食卡片不会触发记账。</p>
                </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">肉类、水饺、意面等建议按「份」入库。水果按「个」或「份」都可以，拜托角色记录时，尽量用和冰箱里一样的量词。</p>
            <p className="mt-2 text-xs leading-5 font-bold morpho-release-kicker">祝你在冬日健康饮食。❄️</p>
            <button type="button" onClick={view} className="morpho-release-primary mt-5 w-full rounded-2xl py-3 text-sm font-bold text-white">查看完整更新说明</button>
            <button type="button" onClick={close} className="mt-2 w-full py-3 text-xs text-slate-500">知道啦，继续使用</button>
            <p className="mt-1 text-center text-[10px] text-slate-400">这份小更新，留在使用帮助里等你回看</p>
        </section>
    </div>;
};
export const UpdateNotificationController = UpdateNotificationPopup;
