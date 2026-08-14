/**
 * InstantPushSunsetEvent.tsx
 * Instant Push 下线通知弹窗。
 *
 * 聊天上云这条路现在由「主动消息 2.0 · 即时对话」接管：它覆盖了 Instant Push 的全部
 * 能力，部署还从「手动复制 bundle 去粘贴」变成填一枚 Cloudflare Token 一键装好。
 * 2026-08-27 起 Instant Push 不再维护，这个弹窗负责在此之前把还开着它的人捞去迁移。
 *
 * 只对**当前开着** Instant Push 的用户弹；没配、配了没开的人完全不受打扰。
 * 每天最多弹一次：关掉只记当天的日期 key，第二天照弹，直到用户自己把 Instant Push
 * 关掉为止——这是下线通知，没有「永久别再提醒」这个选项。
 */

import React from 'react';
import { loadInstantConfig } from '../utils/instantPushClient';
import { getLocalDateKey } from '../utils/localDate';
import { trackEvent } from '../utils/analytics';

/** Instant Push 停止维护的日子。文案里所有出现的日期都从这里来，别各写各的。 */
export const INSTANT_PUSH_SUNSET_DATE = '2026-08-27';

/** 迁移教程（Discord 频道）。 */
export const INSTANT_PUSH_MIGRATION_GUIDE_URL =
  'https://discord.com/channels/1487742660314923100/1535999029090066512';

/** 记「今天已经弹过了」的日期 key，取值形如 2026-08-13。 */
const SUNSET_NOTICE_SHOWN_KEY = 'sullyos_instant_push_sunset_seen_date';

/**
 * 是否要弹下线通知：
 *  - 只对现在真开着 Instant Push 的人弹（没配 / 配了没开的人不打扰）
 *  - 今天已经弹过就不再弹，第二天重新开始
 */
export const shouldShowInstantPushSunsetNotice = (): boolean => {
  try {
    if (!loadInstantConfig().enabled) return false;
    return localStorage.getItem(SUNSET_NOTICE_SHOWN_KEY) !== getLocalDateKey();
  } catch {
    return false;
  }
};

/** 标记「今天弹过了」。用户点任何按钮关掉弹窗都走这里。 */
export const markInstantPushSunsetNoticeShown = (): void => {
  try {
    localStorage.setItem(SUNSET_NOTICE_SHOWN_KEY, getLocalDateKey());
  } catch { /* ignore */ }
};

interface InstantPushSunsetPopupProps {
  onClose: () => void;
}

export const InstantPushSunsetPopup: React.FC<InstantPushSunsetPopupProps> = ({ onClose }) => {
  React.useEffect(() => {
    trackEvent('弹出 Instant Push 下线通知');
  }, []);

  const dismiss = () => {
    markInstantPushSunsetNoticeShown();
    onClose();
  };

  const handleOpenGuide = () => {
    trackEvent('打开 Instant Push 迁移教程');
    window.open(INSTANT_PUSH_MIGRATION_GUIDE_URL, '_blank', 'noopener,noreferrer');
    dismiss();
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
        <div className="pt-7 pb-3 px-6 text-center">
          <img
            src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4e6.png"
            alt="instant push sunset"
            className="w-10 h-10 mx-auto mb-2"
          />
          <h2 className="text-lg font-extrabold text-slate-800">Instant Push 要下线了</h2>
          <p className="text-[11px] text-slate-400 mt-1">{INSTANT_PUSH_SUNSET_DATE} 起不再维护</p>
        </div>

        <div className="px-6 pb-4 space-y-3">
          <div className="bg-gradient-to-br from-amber-50 to-rose-50 border border-amber-100 rounded-2xl p-4 space-y-2">
            <p className="text-[13px] text-slate-700 leading-relaxed">
              聊天上云这条路交给<strong>主动消息 2.0 · 即时对话</strong>了。它能做的事把
              Instant Push 全包住，还多出一截：
            </p>
            <ul className="text-[12px] text-slate-600 leading-relaxed list-disc pl-5 space-y-1">
              <li>
                <strong>部署简单得多</strong>：填一枚 Cloudflare Token 点一下就装好后端，
                不用再复制 bundle 代码去粘贴，也不用自己盯着 Worker 版本手动更新。
              </li>
              <li>
                <strong>聊天照样上云</strong>：发完就能退出，回复在云端生成好推给你；
                当时没收到的，下次上线自动补回来。
              </li>
              <li>
                <strong>还有 Instant Push 没有的</strong>：定时主动消息、云端跑 MCP 工具、
                天气热搜节日感知。
              </li>
            </ul>
            <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
              迁过去不用动聊天记录和角色，跟着下面的教程配一遍就行。
              {INSTANT_PUSH_SUNSET_DATE} 之后 Instant Push 这条路不再维护。
            </p>
          </div>
        </div>

        <div className="px-6 pb-7 pt-2 space-y-2">
          <button
            onClick={handleOpenGuide}
            className="w-full py-3.5 font-bold rounded-2xl text-sm transition-transform active:scale-95 bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-lg shadow-amber-200"
          >
            看迁移教程 →
          </button>
          <button
            onClick={dismiss}
            className="w-full py-2.5 text-slate-400 font-medium text-[12px]"
          >
            知道了（今天不再提醒）
          </button>
        </div>
      </div>
    </div>
  );
};

interface InstantPushSunsetControllerProps {
  onClose: () => void;
}

export const InstantPushSunsetController: React.FC<InstantPushSunsetControllerProps> = ({ onClose }) => {
  return <InstantPushSunsetPopup onClose={onClose} />;
};
