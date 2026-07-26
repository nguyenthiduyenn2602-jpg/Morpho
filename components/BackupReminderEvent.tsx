/**
 * BackupReminderEvent.tsx
 * 「该备份啦」提醒弹窗。
 *
 * 糯米机是 local-first：所有数据只躺在你这台设备的浏览器里，没有云端副本。
 * 隔一段时间（默认 7 天，可在设置里改 1~30 天）没导出，就温柔弹一次提醒。
 *
 * 显隐判定在 utils/backupReminder.ts；这里只管长得好看 + 两个出口：
 *  - 去备份：跳到「设置 → 备份与恢复」
 *  - 知道了：记一次提醒时间，进入冷却，下个间隔到了才会再弹
 */

import React from 'react';
import { daysSinceLastBackup, getBackupReminderState } from '../utils/backupReminder';

interface BackupReminderPopupProps {
    /** 「知道了 / 稍后」——外层会 markBackupReminderShown 并关闭 */
    onDismiss: () => void;
    /** 「去备份」——外层跳设置备份区并关闭 */
    onGoBackup: () => void;
}

export const BackupReminderPopup: React.FC<BackupReminderPopupProps> = ({ onDismiss, onGoBackup }) => {
    const days = daysSinceLastBackup();
    const interval = getBackupReminderState().intervalDays;
    // 顶部那句"多久没备份了"——从未备份 vs 已过 N 天，说人话。
    const gapLine = days == null
        ? '你还没有导出过备份'
        : `距离上次备份已经过去 ${days} 天`;

    return (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onDismiss} />
            <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
                {/* 顶部渐变头图 + 盾牌图标 */}
                <div className="relative pt-8 pb-5 px-6 text-center bg-gradient-to-br from-rose-400 via-orange-300 to-amber-300">
                    <div className="w-16 h-16 mx-auto mb-3 rounded-3xl bg-white/25 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/40 shadow-lg">
                        <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-white" aria-hidden="true">
                            <path d="M12 2.5 5 5.2v5.3c0 4.2 2.9 8.1 7 9.2 4.1-1.1 7-5 7-9.2V5.2L12 2.5Z"
                                stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                            <path d="m9.2 12 2 2 3.6-3.8" stroke="currentColor" strokeWidth="1.7"
                                strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-extrabold text-white drop-shadow-sm">该备份啦</h2>
                    <p className="text-[12px] text-white/90 mt-1 font-medium">{gapLine}</p>
                </div>

                {/* 正文 */}
                <div className="px-6 pt-5 pb-2 space-y-3">
                    <div className="bg-gradient-to-br from-rose-50 to-orange-50 border border-rose-100 rounded-2xl p-4 space-y-2.5">
                        <p className="text-[13px] text-slate-700 leading-relaxed">
                            <strong>您本周没有进行备份，请注意。</strong>
                        </p>
                        <p className="text-[12.5px] text-slate-600 leading-relaxed">
                            糯米机的数据完全掌握在<strong className="text-rose-500">您自己手中</strong>——
                            角色、聊天记录、记忆、设置全都只存在这台设备的浏览器里，我们看不到、也帮不了你找回。
                        </p>
                        <p className="text-[12.5px] text-slate-600 leading-relaxed">
                            一旦清理浏览器缓存、卸载重装、换手机，或者遇到系统抽风，
                            <strong className="text-rose-500">没有备份就意味着这些全部丢失，无法恢复</strong>。
                        </p>
                        <p className="text-[12px] text-slate-500 leading-relaxed">
                            请养成定期导出的习惯，把 ZIP 存到网盘 / 电脑 / 云备份，给自己留条后路 💛
                        </p>
                    </div>
                    <p className="text-[10.5px] text-slate-400 text-center leading-relaxed">
                        当前每 {interval} 天提醒一次，可在「设置 → 备份与恢复」里调整频率
                    </p>
                </div>

                {/* 按钮 */}
                <div className="px-6 pb-7 pt-3 space-y-2">
                    <button
                        onClick={onGoBackup}
                        className="w-full py-3.5 font-bold rounded-2xl text-sm text-white bg-gradient-to-r from-rose-500 to-orange-500 shadow-lg shadow-rose-200 active:scale-95 transition-transform"
                    >
                        立即备份
                    </button>
                    <button
                        onClick={onDismiss}
                        className="w-full py-2.5 text-slate-400 font-medium text-[12px] active:scale-95 transition-transform"
                    >
                        知道了，稍后再说
                    </button>
                </div>
            </div>
        </div>
    );
};

interface BackupReminderControllerProps {
    onDismiss: () => void;
    onGoBackup: () => void;
}

export const BackupReminderController: React.FC<BackupReminderControllerProps> = (props) => {
    return <BackupReminderPopup {...props} />;
};
