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
            <p className="morpho-release-intro">给现实中的你一封来信，<br />也给故事里的你们，多一点色彩。</p><div className="morpho-release-cards mt-5 space-y-4 text-sm leading-6">
                <div><h3 className="font-bold">✉ Morpho 热线 · 写给大壮</h3><p className="mt-1 text-slate-600">法律疑问、不舒服的规则，或生活中的小困扰，都可以写成一封来信。首版支持免费文字投稿，可自愿留下邮箱等待回信。</p></div>
                <div><h3 className="font-bold">🎨 见面剧情 · 配图更顺手</h3><p className="mt-1 text-slate-600">生图导演可以单独配置 API，复用预设、搜索模型、测试连接。画师串、人物提示词、负面词和画幅，也能命名保存、跨剧情载入。</p></div>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">热线投稿可能由 AI 辅助整理，并在隐去可识别信息后用于公开讨论；不保证逐一回复。提交前请阅读栏目说明。</p>
            <button type="button" onClick={view} className="morpho-release-primary mt-5 w-full rounded-2xl py-3 text-sm font-bold text-white">查看完整更新说明</button>
            <button type="button" onClick={close} className="mt-2 w-full py-3 text-xs text-slate-500">知道啦，继续使用</button>
            <p className="mt-1 text-center text-[10px] text-slate-400">这份小更新，留在使用帮助里等你回看</p>
        </section>
    </div>;
};
export const UpdateNotificationController = UpdateNotificationPopup;
