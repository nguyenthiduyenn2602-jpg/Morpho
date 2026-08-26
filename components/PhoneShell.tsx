


import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { IMPORT_IN_PROGRESS_KEY, useOS } from '../context/OSContext';
import StatusBar from './os/StatusBar';
import Launcher from '../apps/Launcher';

// 按需懒加载各 App —— 切到对应 App 时才下载/解析其代码块，首屏只加载 Launcher 与外壳，
// 大体积 App（MemoryPalace / VRWorld / Songwriting 等）不再压在主包里。
// 默认导出直接 lazy；命名导出（SpecialMomentsApp）用 .then 适配成 { default }。
// Launcher 保持静态导入：桌面常驻、需要秒开，不走懒加载。
//
// lazyApp：在 lazy 之外把 import 工厂挂到 .preload 上，使各 chunk 可被「预取」。
// 桌面就绪后空闲时按优先级后台预热（见下方 useEffect），真正打开 App 时代码已在内存，
// React.lazy 几乎同步解析 —— 过场层几乎不再出现，从根本上消除「每次进 App 都要加载」。
type PreloadableLazy = React.LazyExoticComponent<React.ComponentType<any>> & { preload: () => Promise<unknown> };
const lazyApp = (factory: () => Promise<{ default: React.ComponentType<any> }>): PreloadableLazy => {
  const Comp = lazy(factory) as PreloadableLazy;
  Comp.preload = factory;
  return Comp;
};

// 预热 React.lazy 的「负载」本身：不仅下载模块，还把 lazy 内部状态推进到 resolved，
// 使首次渲染该 App 时不再 suspend —— 杜绝切换瞬间露出外壳粉紫底色（深色 App 上尤其扎眼）的那一帧闪烁。
// _payload / _init 为 React.lazy 内部结构（本项目锁定 React 18，形态稳定）；带防御，取不到则退化为仅预热 Vite 模块。
// 注意：仅解析负载、不挂载组件，因此不会触发各 App 的副作用/数据读取。
const LAZY_UNINITIALIZED = -1;
const LAZY_PENDING = 0;
const LAZY_REJECTED = 2;
const warmLazy = (Comp: PreloadableLazy): void => {
  try {
    const payload: any = (Comp as any)?._payload;
    const init: any = (Comp as any)?._init;
    if (!payload || typeof init !== 'function' || payload._status !== LAZY_UNINITIALIZED) {
      Comp.preload(); // 已在加载/已加载，或拿不到内部结构 → 仅预热 Vite 模块
      return;
    }
    init(payload); // 触发下载 + 解析负载
    // 关键防护：若空闲预取阶段加载失败，把负载复位为「未初始化」，避免该 App 被永久钉死为错误态；
    // 真正打开时按 React 正常流程重试（再失败才交给错误边界），与预取前行为一致。
    const thenable = payload._result;
    if (payload._status === LAZY_PENDING && thenable && typeof thenable.then === 'function') {
      thenable.then(undefined, () => {
        if (payload._status === LAZY_REJECTED) {
          payload._status = LAZY_UNINITIALIZED;
          payload._result = Comp.preload; // 还原工厂，供 React 重新调用
        }
      });
    }
  } catch {
    try { Comp.preload(); } catch { /* ignore */ }
  }
};

const Settings = lazyApp(() => import('../apps/Settings'));
const UserApp = lazyApp(() => import('../apps/UserApp'));
const Character = lazyApp(() => import('../apps/Character'));
const Chat = lazyApp(() => import('../apps/Chat'));
const GroupChat = lazyApp(() => import('../apps/GroupChat'));
const MomentsApp = lazyApp(() => import('../apps/MomentsApp'));
const MihuiApp = lazyApp(() => import('../apps/MihuiApp'));
const ThemeMaker = lazyApp(() => import('../apps/ThemeMaker'));
const Gallery = lazyApp(() => import('../apps/Gallery'));
const FAQApp = lazyApp(() => import('../apps/FAQApp'));
const WorldbookApp = lazyApp(() => import('../apps/WorldbookApp'));
const BrowserApp = lazyApp(() => import('../apps/BrowserApp'));
const CallApp = lazyApp(() => import('../apps/CallApp'));
const DateApp = lazyApp(() => import('../apps/DateApp'));
const VoiceDesignerApp = lazyApp(() => import('../apps/VoiceDesignerApp'));
const MemoryPalaceApp = lazyApp(() => import('../apps/MemoryPalaceApp'));
const HandbookApp = lazyApp(() => import('../apps/HandbookApp'));
const QQBridge = lazyApp(() => import('../apps/QQBridge'));
const CharCreatorDevApp = lazyApp(() => import('../apps/CharCreatorDevApp'));

// 预取优先级：高频/常驻 App 先预热，其余随后；逐个在空闲时触发，避免与交互抢主线程/带宽。
const APP_PRELOAD_ORDER: PreloadableLazy[] = [
  Chat, Character, GroupChat, MomentsApp, MihuiApp, Settings, UserApp, CallApp, DateApp, Gallery, WorldbookApp, MemoryPalaceApp, HandbookApp, FAQApp, BrowserApp, VoiceDesignerApp, ThemeMaker, QQBridge, CharCreatorDevApp,
];

const ROLE_ENTRY_PRELOAD_ORDER: PreloadableLazy[] = [
  Character,
  CallApp,
  DateApp,
];

// AppID → 懒加载组件，供「按下即预取」连 React.lazy 负载一起解析（消除切换瞬间露底色的闪烁）。
// AppID 由下方 import 引入，ES 模块提升后全模块可用。
const APP_BY_ID: Partial<Record<AppID, PreloadableLazy>> = {
  [AppID.Settings]: Settings, [AppID.User]: UserApp, [AppID.Character]: Character, [AppID.Chat]: Chat, [AppID.Date]: DateApp, [AppID.Moments]: MomentsApp, [AppID.Mihui]: MihuiApp,
};
// 注入负载预热器：AppIcon 的 pointerdown → preloadApp(id) → 这里 warmLazy，连 React.lazy 负载一起解析。
setAppPayloadWarmer((id: AppID) => { const c = APP_BY_ID[id]; if (c) warmLazy(c); });

import { Like520Controller, shouldShowLike520Popup } from './Like520Event';
import { UpdateNotificationController, shouldShowUpdateNotification } from './UpdateNotificationEvent';
import { WorkerUpdateReminderController, shouldShowWorkerUpdateReminder, rearmWorkerUpdateReminder } from './WorkerUpdateReminderEvent';
import { InstantPushSunsetController, shouldShowInstantPushSunsetNotice } from './InstantPushSunsetEvent';
import { loadInstantConfig, probeInstantWorkerVersion } from '../utils/instantPushClient';
import { BackupReminderController } from './BackupReminderEvent';
import { shouldShowBackupReminder, markBackupReminderShown } from '../utils/backupReminder';
import { formatBytes } from '../utils/format';
import { AppID } from '../types';
import { shellHandlesSafeArea } from '../utils/safeAreaApps';
import { App as CapApp } from '@capacitor/app';
import { StatusBar as CapStatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { isIOSStandaloneWebApp, isStatusBarHidden } from '../utils/iosStandalone';
import AppErrorBoundary from './os/AppErrorBoundary';
import MomentsScheduler from './MomentsScheduler';
import GlobalMiniPlayer from './os/GlobalMiniPlayer';
import PersonaSimIndicator from './os/PersonaSimIndicator';
import DreamSimIndicator from './os/DreamSimIndicator';
import ErrorDialog from './os/ErrorDialog';
import BootSequence from './os/BootSequence';
import { setAppPayloadWarmer } from './os/appPreload';

/*
// Internal Error Boundary Component
class AppErrorBoundary extends Component<{ children: React.ReactNode, onCloseApp: () => void, resetKey: string }, { hasError: boolean, error: Error | null, copyLabel: string }> {
    private copyLabelTimer: number | null = null;

    constructor(props: { children: React.ReactNode, onCloseApp: () => void, resetKey: string }) {
        super(props);
        this.state = { hasError: false, error: null, copyLabel: '复制报错信息' };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("App Crash:", error, errorInfo);
    }

    // Reset error state only when the active app changes.
    componentDidUpdate(prevProps: { children: React.ReactNode, onCloseApp: () => void, resetKey: string }) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
            this.setState({ hasError: false, error: null, copyLabel: '复制报错信息' });
        }
    }

    componentWillUnmount() {
        if (this.copyLabelTimer) window.clearTimeout(this.copyLabelTimer);
    }

    private updateCopyLabel = (label: string) => {
        if (this.copyLabelTimer) window.clearTimeout(this.copyLabelTimer);
        this.setState({ copyLabel: label });
        this.copyLabelTimer = window.setTimeout(() => {
            this.setState({ copyLabel: '复制报错信息' });
            this.copyLabelTimer = null;
        }, 1800);
    };

    private handleCopy = async () => {
        const errText = this.state.error?.stack || this.state.error?.message || 'Unknown Error';

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(errText);
                this.updateCopyLabel('已复制');
                return;
            }
        } catch {
            // Fall through to legacy copy path.
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = errText;
            textarea.setAttribute('readonly', 'true');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.pointerEvents = 'none';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (copied) {
                this.updateCopyLabel('已复制');
                return;
            }
        } catch {
            // Fall through to prompt fallback.
        }

        window.prompt('请手动复制报错信息', errText);
        this.updateCopyLabel('请手动复制');
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center space-y-4">
                    <img src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f635.png" alt="error" className="w-10 h-10" />
                    <h2 className="text-lg font-bold">应用运行错误</h2>
                    <p className="text-xs text-slate-400 font-mono bg-black/30 p-3 rounded max-w-full overflow-auto max-h-40 select-text break-all whitespace-pre-wrap">
                        {this.state.error?.message || 'Unknown Error'}
                    </p>
                    <button
                        onClick={() => {
                            const errText = this.state.error?.message || 'Unknown Error';
                            navigator.clipboard?.writeText(errText).then(() => {}).catch(() => {});
                        }}
                        className="px-4 py-2 bg-slate-700 rounded-full text-xs active:scale-95 transition-transform"
                    >
                        复制错误信息
                    </button>
                    <button
                        onClick={() => { this.setState({ hasError: false }); this.props.onCloseApp(); }}
                        className="px-6 py-3 bg-red-600 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform"
                    >
                        返回桌面
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
*/

const DISCLAIMER_KEY = 'sullyos_disclaimer_accepted';

type ImportRecoveryMarker = {
  startedAt?: number;
  updatedAt?: number;
  phase?: string;
  source?: string;
  sourceSize?: number;
  current?: string;
  currentFile?: string;
  currentFileSize?: number;
  assetDone?: number;
  assetTotal?: number;
  itemDone?: number;
  itemTotal?: number;
  error?: string;
};

const getPendingImportMarker = (): ImportRecoveryMarker | null => {
  try {
    const raw = localStorage.getItem(IMPORT_IN_PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as ImportRecoveryMarker) : null;
  } catch {
    return null;
  }
};

const getImportPhaseLabel = (phase?: string) => {
  switch (phase) {
    case 'parsing': return '解析备份文件';
    case 'assets': return '恢复备份素材';
    case 'database': return '写入数据库';
    case 'settings': return '恢复系统设置';
    case 'error': return '导入报错';
    default: return '导入流程';
  }
};



const DisclaimerPopup: React.FC<{ onAccept: () => void }> = ({ onAccept }) => (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5 animate-fade-in">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
    <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="pt-7 pb-3 px-6 text-center">
        <img src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4e2.png" alt="announcement" className="w-8 h-8 mb-2" />
        <h2 className="text-lg font-extrabold text-slate-800">免责声明</h2>
        <p className="text-[11px] text-slate-400 mt-1">Disclaimer · Morpho</p>
      </div>

      {/* Content */}
      <div className="px-6 pb-4 max-h-[55vh] overflow-y-auto no-scrollbar space-y-3">
        <p className="text-[13px] text-slate-600 leading-relaxed">
          本项目「Morpho」是一个<strong className="text-slate-800">完全开源、免费</strong>的软件，仅供个人学习、研究与技术交流使用。
        </p>
        <ul className="text-[12px] text-slate-500 leading-relaxed space-y-1.5 list-none">
          <li className="flex gap-2"><span className="shrink-0">•</span><span>本软件不提供任何明示或暗示的担保，作者不对使用本软件产生的任何后果承担责任。</span></li>
          <li className="flex gap-2"><span className="shrink-0">•</span><span>用户应自行承担使用本软件的一切风险，包括但不限于数据丢失、设备损坏等。</span></li>
          <li className="flex gap-2"><span className="shrink-0">•</span><span>本软件生成的任何 AI 内容均不代表作者立场，用户需自行判断内容的准确性与合规性。</span></li>
          <li className="flex gap-2"><span className="shrink-0">•</span><span>禁止将本软件用于任何违反当地法律法规的用途。</span></li>
        </ul>

        {/* Highlighted warning */}
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 mt-3">
          <p className="text-[13px] font-bold text-red-600 text-center leading-relaxed">
            本程序完全免费！<br />
            如果您是通过<span className="underline decoration-2 decoration-red-400">付费购买</span>获得此程序的，说明您已被倒卖欺骗。<br />
            请向售卖者维权追责！
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 pb-7 pt-2">
        <button
          onClick={onAccept}
          className="w-full py-3.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 active:scale-95 transition-transform text-sm"
        >
          我已知悉，继续使用
        </button>
      </div>
    </div>
  </div>
);

const ImportRecoveryPopup: React.FC<{
  marker: ImportRecoveryMarker | null;
  onLater: () => void;
  onReimport: () => void;
}> = ({ marker, onLater, onReimport }) => {
  if (!marker) return null;

  const phaseLabel = getImportPhaseLabel(marker.phase);
  const startedAt = marker.startedAt
    ? new Date(marker.startedAt).toLocaleString('zh-CN')
    : '';
  const updatedAt = marker.updatedAt
    ? new Date(marker.updatedAt).toLocaleString('zh-CN')
    : '';
  const sourceSize = formatBytes(marker.sourceSize);
  const currentFileSize = formatBytes(marker.currentFileSize);
  const hasAssetProgress = typeof marker.assetTotal === 'number' && marker.assetTotal > 0;
  const hasItemProgress = typeof marker.itemTotal === 'number' && marker.itemTotal > 0;
  const hasError = !!marker.error;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
        <div className="pt-7 pb-3 px-6 text-center">
          <h2 className="text-lg font-extrabold text-slate-800">{hasError ? '上次导入失败了' : '上次导入被中断了'}</h2>
          <p className="text-[11px] text-slate-400 mt-1">{hasError ? '错误信息已记录在本机' : '数据还没有完整恢复'}</p>
        </div>

        <div className="px-6 pb-4 space-y-3 max-h-[58vh] overflow-y-auto no-scrollbar">
          <p className="text-[13px] text-slate-600 leading-relaxed">
            {hasError
              ? '系统检测到上一次导入过程中发生了错误。请重新导入同一个备份文件，避免数据只恢复了一半。'
              : '系统检测到上一次导入没有走到完成步骤，可能是浏览器或系统在导入过程中强制重启了。请重新导入同一个备份文件，避免数据只恢复了一半。'}
          </p>
          {hasError && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-[12px] text-red-700 leading-relaxed whitespace-pre-wrap break-words select-text">
              {marker.error}
            </div>
          )}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[12px] text-amber-700 leading-relaxed">
            <div>中断阶段：{phaseLabel}</div>
            {marker.current && <div>当前部分：{marker.current}</div>}
            {hasItemProgress && <div>条目进度：{marker.itemDone || 0}/{marker.itemTotal}</div>}
            {hasAssetProgress && <div>素材进度：{marker.assetDone || 0}/{marker.assetTotal}</div>}
            {marker.currentFile && (
              <div className="break-all">当前文件：{marker.currentFile}{currentFileSize ? ` · ${currentFileSize}` : ''}</div>
            )}
            {startedAt && <div>开始时间：{startedAt}</div>}
            {updatedAt && <div>最后进度：{updatedAt}</div>}
            {marker.source && <div className="break-all">备份文件：{marker.source}{sourceSize ? ` · ${sourceSize}` : ''}</div>}
          </div>
        </div>

        <div className="px-6 pb-7 pt-2 grid grid-cols-2 gap-3">
          <button
            onClick={onLater}
            className="py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:scale-95 transition-transform text-sm"
          >
            稍后再说
          </button>
          <button
            onClick={onReimport}
            className="py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-200 active:scale-95 transition-transform text-sm"
          >
            去重新导入
          </button>
        </div>
      </div>
    </div>
  );
};

// App 懒加载占位：关键是「延迟出现」。chunk 命中缓存/快速加载只需几十毫秒，这种时长用户
// 本就无感——但 Suspense fallback 会立刻渲染，占位一闪反而把无感瞬切变成能被看见的打断
// （loading spinner 闪烁反模式）。所以前 ~220ms 一律渲染空（无感），只有真的慢才浮现。
// 刻意「零动画开销」：之前那套呼吸/涟漪/上升微尘的持续动画在 iOS 上会引起卡顿，且预热命中后
// 这屏几乎不出现 —— 收益小、代价大。现在只一次性淡入一个静态柔光点（无 infinite 动画），
// 透明底让外壳虚化壁纸透出来。真卡住（>7s）才换成可点的刷新/返回兜底。
const AppLoadingFallback: React.FC<{ onReturn?: () => void }> = ({ onReturn }) => {
  const [show, setShow] = useState(false);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 220);
    // 卡死逃生口：iOS standalone PWA 从后台恢复 / 弱网时，动态 import 可能既不 resolve 也不 reject，
    // Suspense 会永远停在这一屏（不报错 → 错误边界不触发 → 不会自动刷新），用户狂点中心光点却毫无反应。
    // 超过 STALL_MS 仍未加载完 → 把「看着像按钮其实不是」的光点换成真正可点的「刷新/返回」按钮，
    // 既明确告诉用户该点哪里，又把静默卡死变成一键可恢复。只动占位 UI，不碰 import 逻辑。
    const stall = setTimeout(() => setStalled(true), 7000);
    return () => { clearTimeout(t); clearTimeout(stall); };
  }, []);
  if (stalled) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900/95 text-white p-6 text-center space-y-4" style={{ animation: 'appLoadIn 320ms ease-out both' }}>
        <style>{`@keyframes appLoadIn{from{opacity:0}to{opacity:1}}`}</style>
        <h2 className="text-base font-bold">加载有点慢…</h2>
        <p className="text-xs text-slate-300 max-w-xs leading-relaxed">
          这个发光的圆点是加载动画，不是按钮——点它不会有反应。常见于刚更新版本或网络瞬断，刷新一次即可恢复。
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full px-6 py-3 bg-red-600 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform"
          >
            刷新恢复
          </button>
          {onReturn && (
            <button
              type="button"
              onClick={onReturn}
              className="w-full px-4 py-2 bg-slate-700 rounded-full text-xs font-bold active:scale-95 transition-transform"
            >
              返回桌面
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!show) return null;
  // 静态柔光点：仅一次性淡入，之后无任何持续动画（零运行时开销），透明底透出壁纸。
  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent" style={{ animation: 'appLoadIn 280ms ease-out both' }}>
      <style>{`@keyframes appLoadIn{from{opacity:0}to{opacity:1}}`}</style>
      <div className="relative" style={{ width: 72, height: 72 }}>
        {/* 静态柔光 */}
        <div className="absolute inset-0" style={{ borderRadius: '9999px', filter: 'blur(8px)', background: 'radial-gradient(circle, hsla(var(--primary-hue),75%,72%,0.42) 0%, hsla(var(--primary-hue),70%,60%,0.10) 50%, transparent 70%)' }} />
        {/* 静态内核 */}
        <div className="absolute" style={{ left: '50%', top: '50%', width: 10, height: 10, transform: 'translate(-50%,-50%)', borderRadius: '9999px', background: 'radial-gradient(circle, #fff, hsla(var(--primary-hue),80%,75%,0.6) 60%, transparent)', boxShadow: '0 0 10px hsla(var(--primary-hue),80%,75%,0.6)' }} />
      </div>
    </div>
  );
};

const PhoneShell: React.FC = () => {
  const { theme, isLocked, unlock, activeApp, closeApp, openApp, virtualTime, isDataLoaded, toasts, unreadMessages, characters, handleBack, suspendedCall, resumeCall, activeCharacterId, errorDialog, dismissError } = useOS();
  const useIOSStandaloneLayout = isIOSStandaloneWebApp();

  // 顶部时钟/电量条是否隐藏（外观「隐藏顶部时间栏」开关 + 平台默认：iOS 全屏 PWA 系统已有状态栏，默认隐藏避免双显）。
  // 隐藏时把 --chrome-top 退化成 --safe-top，让用 chrome-top 让位的顶栏（交换日记/彼方/剧场）不再为已隐藏的状态栏多留 1.5rem。
  const statusBarHidden = isStatusBarHidden(theme.hideStatusBar);
  useEffect(() => {
    document.documentElement.classList.toggle('sully-statusbar-hidden', statusBarHidden);
  }, [statusBarHidden]);

  // 冷启动「世界入场」是否已结束。结束前由 BootSequence 接管整屏（同时取代旧的黑屏 spinner）。
  const [bootDone, setBootDone] = useState(false);

  // 从根本上消除「每次进 App 都要加载」：数据一就绪就在后台按优先级逐个预热各 App 的代码块。
  // 关键：不等开机动画（bootDone）结束就开始 —— 否则用户在开机那 ~2 秒内点开 Chat 时 chunk 还没热，
  // 会现下载+解析 300KB+，首次进聊天卡好几秒。预热与开机动画并行（只下载/解析负载、不挂载、无副作用）。
  // 逐个、空闲触发（requestIdleCallback），不与首屏交互抢主线程/带宽。
  useEffect(() => {
    if (!isDataLoaded) return;
    ROLE_ENTRY_PRELOAD_ORDER.forEach(warmLazy);
  }, [isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;
    if (useIOSStandaloneLayout) return;
    let cancelled = false;
    let idx = 0;
    const ric: (cb: () => void) => number = (window as any).requestIdleCallback
      ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 1500 })
      : (cb) => window.setTimeout(cb, 200);
    const step = () => {
      if (cancelled || idx >= APP_PRELOAD_ORDER.length) return;
      warmLazy(APP_PRELOAD_ORDER[idx++]); // 下载 chunk + 解析 React.lazy 负载 → 首次打开不再 suspend、无底色闪烁
      if (!cancelled) ric(step);
    };
    const startId = window.setTimeout(() => ric(step), 150); // 让首帧先绘制一拍，随即开始（含开机动画期间）
    return () => { cancelled = true; window.clearTimeout(startId); };
  }, [isDataLoaded, useIOSStandaloneLayout]);

  // Disclaimer popup for first-time users
  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    try {
      return !localStorage.getItem(DISCLAIMER_KEY);
    } catch {
      return true;
    }
  });

  const handleAcceptDisclaimer = () => {
    try {
      localStorage.setItem(DISCLAIMER_KEY, Date.now().toString());
    } catch { /* ignore */ }
    setShowDisclaimer(false);
  };

  const [importRecoveryMarker, setImportRecoveryMarker] = useState<ImportRecoveryMarker | null>(() => {
    try {
      if (!localStorage.getItem(DISCLAIMER_KEY)) return null;
      return getPendingImportMarker();
    } catch {
      return null;
    }
  });
  const [importRecoveryDismissed, setImportRecoveryDismissed] = useState(false);
  const showImportRecoveryPrompt = !!importRecoveryMarker;

  useEffect(() => {
    if (showDisclaimer || importRecoveryDismissed || importRecoveryMarker) return;
    const marker = getPendingImportMarker();
    if (marker) setImportRecoveryMarker(marker);
  }, [showDisclaimer, importRecoveryDismissed, importRecoveryMarker]);

  const handleReimportFromRecovery = () => {
    setImportRecoveryDismissed(true);
    setImportRecoveryMarker(null);
    openApp(AppID.Settings);
  };

  // 「致用户的一封信」已下线：常量置 false，保留变量让下面弹窗链的条件继续成立（恒真/恒不显示）。
  const showAuthorLetter = false;

  // Version update popup (2026-04) — forced once per user who hasn't seen it yet
  const [showUpdateNotification, setShowUpdateNotification] = useState(() => {
    try {
      return !!(localStorage.getItem(DISCLAIMER_KEY)) && shouldShowUpdateNotification();
    } catch { return false; }
  });

  useEffect(() => {
    if (!showDisclaimer && !showImportRecoveryPrompt && !showAuthorLetter && !showUpdateNotification) {
      if (shouldShowUpdateNotification()) {
        setShowUpdateNotification(true);
      }
    }
  }, [showDisclaimer, showImportRecoveryPrompt, showAuthorLetter, showUpdateNotification]);

  // 520 特别活动弹窗（2026-05-20 当天，且没被 dismiss / completed）
  // 一次性：用户点过任何按钮就标记 dismissed，下次刷新不再出现；
  // API 配置改成弹窗内嵌，配完直接进活动，不再需要把弹窗暂存让位给 Settings。
  const [showLike520Popup, setShowLike520Popup] = useState(false);
  useEffect(() => {
    if (showDisclaimer || showImportRecoveryPrompt || showAuthorLetter || showUpdateNotification) return;
    if (!isDataLoaded) return;
    if (shouldShowLike520Popup()) setShowLike520Popup(true);
  }, [showDisclaimer, showImportRecoveryPrompt, showAuthorLetter, showUpdateNotification, isDataLoaded]);

  // Instant Push 下线提醒：只对仍在使用旧功能的人显示，每天最多一次。
  const [showInstantPushSunset, setShowInstantPushSunset] = useState(false);
  useEffect(() => {
    if (showDisclaimer || showImportRecoveryPrompt || showAuthorLetter || showUpdateNotification || showLike520Popup) return;
    if (!isDataLoaded) return;
    if (shouldShowInstantPushSunsetNotice()) setShowInstantPushSunset(true);
  }, [showDisclaimer, showImportRecoveryPrompt, showAuthorLetter, showUpdateNotification, showLike520Popup, isDataLoaded]);

  // Worker 后端更新提醒 — 只对启用了 Instant Push 的用户弹，且当前 worker 版本未确认过
  const [showWorkerUpdateReminder, setShowWorkerUpdateReminder] = useState(false);
  useEffect(() => {
    if (showDisclaimer || showImportRecoveryPrompt || showAuthorLetter || showUpdateNotification || showLike520Popup || showInstantPushSunset) return;
    if (!isDataLoaded) return;
    if (shouldShowWorkerUpdateReminder()) setShowWorkerUpdateReminder(true);
  }, [showDisclaimer, showImportRecoveryPrompt, showAuthorLetter, showUpdateNotification, showLike520Popup, showInstantPushSunset, isDataLoaded]);

  // 部署漂移自检：启动后异步 GET {workerUrl}/version（每 24h 最多一次）。
  // 常量比对只能发现「前端更新了」，发现不了「用户 seen 过但实际没部署 / 部署的是更老的包」——
  // 前端托管自动更新、worker 停在用户上次贴代码那天，这种漂移正是 instant 各类
  // 「时灵时不灵」反馈的温床。确认 worker 有应答且版本不对（reachable && !ok）才重新
  // 武装提醒；网络不通/没配不算数，贪睡窗口照常生效，不会轰炸。
  useEffect(() => {
    if (!isDataLoaded) return;
    const cfg = loadInstantConfig();
    if (!cfg.enabled || !cfg.workerUrl) return;
    const PROBE_AT_KEY = 'sullyos_worker_version_probe_at';
    try {
      const last = Number(localStorage.getItem(PROBE_AT_KEY) || 0);
      if (Date.now() - last < 86_400_000) return;
    } catch { /* ignore */ }
    void probeInstantWorkerVersion(cfg).then((r) => {
      try { localStorage.setItem(PROBE_AT_KEY, String(Date.now())); } catch { /* ignore */ }
      if (!r.ok && r.reachable) {
        rearmWorkerUpdateReminder();
        if (shouldShowWorkerUpdateReminder()) setShowWorkerUpdateReminder(true);
      }
    }).catch(() => { /* 探测失败不打扰 */ });
  }, [isDataLoaded]);

  // 「该备份啦」提醒 — local-first 数据只在本机，隔 N 天（默认 7，可在设置里改）没导出就弹一次
  const [showBackupReminder, setShowBackupReminder] = useState(false);
  useEffect(() => {
    if (showDisclaimer || showImportRecoveryPrompt || showAuthorLetter || showUpdateNotification || showLike520Popup || showInstantPushSunset || showWorkerUpdateReminder) return;
    if (!isDataLoaded || isLocked) return;
    if (shouldShowBackupReminder()) setShowBackupReminder(true);
  }, [showDisclaimer, showImportRecoveryPrompt, showAuthorLetter, showUpdateNotification, showLike520Popup, showInstantPushSunset, showWorkerUpdateReminder, isDataLoaded, isLocked]);

  const dismissBackupReminder = () => {
    markBackupReminderShown();
    setShowBackupReminder(false);
  };
  const goBackupFromReminder = () => {
    markBackupReminderShown();
    setShowBackupReminder(false);
    openApp(AppID.Settings);
  };

  // Capacitor Native Handling
  useEffect(() => {
    const initNative = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                await CapStatusBar.setOverlaysWebView({ overlay: true });
                await CapStatusBar.hide();
                await CapStatusBar.setStyle({ style: StatusBarStyle.Dark });

                const permStatus = await LocalNotifications.checkPermissions();
                if (permStatus.display !== 'granted') {
                    await LocalNotifications.requestPermissions();
                }
            } catch (e) {
                console.error("Native init failed", e);
            }
        }
    };
    initNative();

    // Handle Android Hardware Back Button
    const setupBackButton = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                await CapApp.removeAllListeners();
                CapApp.addListener('backButton', ({ canGoBack }) => {
                    if (isLocked) {
                        CapApp.exitApp();
                    } else {
                        handleBack(); // Delegate to OSContext logic
                    }
                });
            } catch (e) { console.log('Back button listener setup failed'); }
        }
    };

    setupBackButton();

    return () => {
        if (Capacitor.isNativePlatform()) {
            CapApp.removeAllListeners().catch(() => {});
        }
    };
  }, [activeApp, isLocked, closeApp, handleBack]);

  // Force scroll to top when app changes to prevent "push up" glitches on iOS
  useEffect(() => {
      window.scrollTo(0, 0);
  }, [activeApp]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const wallpaper = theme.wallpaper;
    const backgroundValue = !wallpaper
      ? '#0f1115'
      : (wallpaper.startsWith('http') || wallpaper.startsWith('data:') || wallpaper.startsWith('blob:'))
        ? `url(${wallpaper})`
        : wallpaper;

    [document.documentElement, document.body].forEach((element) => {
      element.style.background = backgroundValue;
      element.style.backgroundPosition = 'center';
      element.style.backgroundSize = 'cover';
      element.style.backgroundRepeat = 'no-repeat';
    });
  }, [theme.wallpaper]);

  // 冷启动：先放「世界入场」cinematic（数据没就绪时它持续呼吸等待，绝不出现 spinner）。
  // BootSequence 在「数据就绪 + 停留够时长」后推进退场，再交还控制权给下方的锁屏/桌面。
  if (!bootDone) {
    return <BootSequence dataReady={isDataLoaded} wallpaper={theme.wallpaper} onDone={() => setBootDone(true)} />;
  }

  // 兜底：理论上 bootDone 时数据已就绪；万一未就绪（极端慢）退化为最简静态深色屏，不闪 spinner。
  if (!isDataLoaded) {
    return <div className="w-full h-full" style={{ background: '#05060f' }} />;
  }

  const getBgStyle = (wp: string) => {
      const isUrl = wp.startsWith('http') || wp.startsWith('data:') || wp.startsWith('blob:');
      return isUrl ? `url(${wp})` : wp;
  };

  const bgImageValue = getBgStyle(theme.wallpaper);
  const lockBgImageValue = getBgStyle(theme.lockWallpaper || theme.wallpaper);
  const contentColor = theme.contentColor || '#ffffff';
  const acnhSkin = theme.skin === 'animalcrossing'; // 动森彩蛋：锁屏换暖色草地点缀

  if (isLocked) {
    const unreadCount = Object.values(unreadMessages).reduce((a,b) => a+b, 0);
    const unreadCharId = Object.keys(unreadMessages)[0];
    const unreadChar = unreadCharId ? characters.find(c => c.id === unreadCharId) : null;

        return (
      <div 
        onClick={() => {
            // Only ask once when permission is still undecided; don't keep poking blocked/denied browsers.
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
            unlock();
        }}
        className="relative w-full h-full bg-cover bg-center cursor-pointer overflow-hidden group font-light select-none overscroll-none"
        style={{ backgroundImage: lockBgImageValue, color: contentColor, animation: 'lockReveal 600ms ease-out both' }}
      >
        {/* 锁屏柔和淡入：与开机「世界入场」退场衔接；body 背景本就是壁纸，故是无缝融入而非硬切。 */}
        <style>{`@keyframes lockReveal{from{opacity:0}to{opacity:1}}`}</style>
        {acnhSkin ? (
            <div className="absolute inset-0 transition-all duration-700 group-hover:opacity-0"
                 style={{ background: 'linear-gradient(180deg, rgba(188,231,245,0.25) 0%, rgba(255,247,176,0.15) 45%, rgba(124,186,76,0.28) 100%)' }} />
        ) : (
            <div className="absolute inset-0 bg-black/5 backdrop-blur-sm transition-all group-hover:backdrop-blur-none group-hover:bg-transparent duration-700" />
        )}

        {/* 动森彩蛋：锁屏飘叶 */}
        {acnhSkin && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <svg viewBox="0 0 100 100" className="absolute w-14 h-14 opacity-80 -rotate-[25deg]" style={{ left: '10%', top: '12%' }}><path d="M50 8 C78 20 88 50 78 82 C74 92 60 96 50 92 C40 96 26 92 22 82 C12 50 22 20 50 8Z" fill="#9ED25F"/><path d="M50 14 L50 88" stroke="#5c8a30" strokeWidth="3" fill="none" opacity="0.5"/></svg>
                <svg viewBox="0 0 100 100" className="absolute w-12 h-12 opacity-75 rotate-[30deg] scale-x-[-1]" style={{ right: '12%', top: '20%' }}><path d="M50 8 C78 20 88 50 78 82 C74 92 60 96 50 92 C40 96 26 92 22 82 C12 50 22 20 50 8Z" fill="#7CBA4C"/><path d="M50 14 L50 88" stroke="#4d7a2a" strokeWidth="3" fill="none" opacity="0.5"/></svg>
                <svg viewBox="0 0 100 100" className="absolute w-16 h-16 opacity-70 rotate-[12deg]" style={{ left: '16%', bottom: '14%' }}><path d="M50 8 C78 20 88 50 78 82 C74 92 60 96 50 92 C40 96 26 92 22 82 C12 50 22 20 50 8Z" fill="#5FAE6E"/><path d="M50 14 L50 88" stroke="#356b3f" strokeWidth="3" fill="none" opacity="0.5"/></svg>
            </div>
        )}

        <div className="absolute top-24 w-full text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">
           <div className="text-8xl tracking-tighter opacity-95 font-bold">
             {virtualTime.hours.toString().padStart(2,'0')}<span className="animate-pulse">:</span>{virtualTime.minutes.toString().padStart(2,'0')}
           </div>
           {acnhSkin ? (
               <div className="text-lg tracking-widest opacity-90 mt-2 text-xs font-bold flex items-center justify-center gap-1.5">
                   <span>🍃</span><span>无人岛生活</span><span>🍃</span>
               </div>
           ) : (
               <div className="text-lg tracking-widest opacity-90 mt-2 uppercase text-xs font-bold">Morpho</div>
           )}
        </div>

        {unreadCount > 0 && (
            <div className="absolute top-[40%] left-4 right-4 animate-slide-up">
                <div className="bg-white/20 backdrop-blur-md rounded-2xl p-4 shadow-lg border border-white/10 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-green-500 flex items-center justify-center text-white shrink-0 shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M4.804 21.644A6.707 6.707 0 0 0 6 21.75a6.721 6.721 0 0 0 3.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 0 1-.814 1.686.75.75 0 0 0 .44 1.223ZM8.25 10.875a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25ZM10.875 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Zm4.875-1.125a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Z" clipRule="evenodd" /></svg>
                    </div>
                    <div className="flex-1 min-w-0 text-white text-left">
                        <div className="font-bold text-sm flex justify-between">
                            <span>{unreadChar ? unreadChar.name : 'Message'}</span>
                            <span className="text-[10px] opacity-70">刚刚</span>
                        </div>
                        <div className="text-xs opacity-90 truncate">
                            {unreadCount > 1 ? `收到 ${unreadCount} 条新消息` : '发来了一条新消息'}
                        </div>
                    </div>
                </div>
            </div>
        )}

        <div className="absolute bottom-12 w-full flex flex-col items-center gap-3 animate-pulse opacity-80 drop-shadow-md">
          <div className="w-1 h-8 rounded-full bg-gradient-to-b from-transparent to-current"></div>
          <span className="text-[10px] tracking-widest uppercase font-semibold">Tap to Unlock</span>
        </div>
      </div>
    );
  }

  const renderApp = () => {
    switch (activeApp) {
      case AppID.Settings: return <Settings />;
      case AppID.User: return <UserApp />;
      case AppID.Character: return <Character />;
      case AppID.Chat: return <Chat />;
      case AppID.GroupChat: return <GroupChat />; 
      case AppID.Moments: return <MomentsApp />;
      case AppID.Mihui: return <MihuiApp />;
      case AppID.ThemeMaker: return <ThemeMaker />;
      case AppID.Gallery: return <Gallery />;
      case AppID.FAQ: return <FAQApp />; 
      case AppID.Worldbook: return <WorldbookApp />;
      case AppID.Browser: return <BrowserApp />;
      case AppID.Call: return <CallApp />;
      case AppID.Date: return <DateApp />;
      case AppID.VoiceDesigner: return <VoiceDesignerApp />;
      case AppID.MemoryPalace: return <MemoryPalaceApp />;
      case AppID.Handbook: return <HandbookApp />;
      case AppID.QQBridge: return <QQBridge />;
      case AppID.CharCreatorDev: return <CharCreatorDevApp />;
      case AppID.Launcher:
      default: return <Launcher />;
    }
  };

  // 安全区策略（方案 B）：自理名单里的 App 已全屏铺底、自己给控件让位，外壳不再加 padding；
  // 其余尚未迁移、靠外壳兜底的 App，仍由外壳用单一来源变量 --safe-* 统一让出安全区，避免顶栏怼进状态栏。
  // 自理名单见 utils/safeAreaApps.ts（迁移一个 App = 把它加进名单 + 顶栏用 --chrome-top 自己让位）。
  // TODO(safe-area-A): 把剩余「未迁移」App 逐个改为自理安全区后，移除外壳这层兜底，实现全屏无色条。
  const shellPadsSafeArea = shellHandlesSafeArea(activeApp);

  return (
    <div className="relative w-full h-full overflow-hidden bg-gradient-to-br from-pink-200 via-purple-200 to-indigo-200 text-slate-900 font-sans select-none overscroll-none">
       {/* Optimized Background Layer */}
       {/* 壁纸底层：进 App 时只柔和虚化/压暗作背景，不再做缩放「过场」——
          进 App 的过渡感统一交给 App 容器的淡入（见下方 animate-fade-in 包裹层）。 */}
       <div
         className="absolute inset-0 bg-cover bg-center transition-all duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
         style={{
             backgroundImage: bgImageValue,
             filter: activeApp !== AppID.Launcher ? 'blur(10px)' : 'none',
             opacity: activeApp !== AppID.Launcher ? 0.6 : 1,
             backfaceVisibility: 'hidden',
             contain: useIOSStandaloneLayout ? undefined : 'strict'
         }}
       />
       
       <div className={`absolute inset-0 transition-all duration-500 ${activeApp === AppID.Launcher ? 'bg-transparent' : 'bg-white/50 backdrop-blur-3xl'}`} />
       
       {/* 外壳安全区两种策略：
          - 未迁移 App：外壳铺满 body（含 --app-height 多出的 +safe-bottom 溢出区），用 padding 让位安全区，
            内容只画到可见 viewport 内，home 条上方留出 safe-bottom 视觉间隙。
          - 已迁移 App（彼方/聊天/群聊/桌面）：自理安全区。外壳直接把底边收回到可见 viewport
            （bottom = --standalone-safe-area-bottom），不让那多出来的 34px 把 App 底部控件压到 home 条上。 */}
      <div
        className="sully-shell-content absolute top-0 left-0 right-0 z-10 overflow-hidden bg-transparent overscroll-none flex flex-col"
        style={
          shellPadsSafeArea
            ? { bottom: 0, paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }
            : { bottom: 'var(--standalone-safe-area-bottom, 0px)' }
        }
      >
        <MomentsScheduler />
          {/* App Container */}
          <div className="flex-1 relative overflow-hidden" style={{ contain: useIOSStandaloneLayout ? undefined : 'layout style paint' }}>
            <AppErrorBoundary onCloseApp={closeApp} resetKey={`${activeApp}:${activeCharacterId || 'none'}`}>
              <Suspense fallback={<AppLoadingFallback onReturn={closeApp} />}>
                {/* 统一「淡入」过渡：每次切换 App 时 key 变化 → 重新挂载并淡入，
                    让所有 App 都像个人档案那样「渐变进去」，而非瞬间咚一下。
                    关键：只动 opacity、不做 scale/translate —— 否则会把整棵（常含大量头像图片的）
                    App 子树栅格化进 transform 图层，角色列表类 App 首帧会卡顿一下（停顿一秒）。
                    时长也压短，进重 App 时不至于多等。 */}
                <div key={activeApp} className="w-full h-full" style={{ animation: 'appEnterFade 200ms ease-out both' }}>
                  <style>{`@keyframes appEnterFade{from{opacity:0}to{opacity:1}}`}</style>
                  {renderApp()}
                </div>
              </Suspense>
            </AppErrorBoundary>
          </div>

          {/* Overlays: Status Bar (Top) —— 常驻渲染：时钟/电量条由开关+平台默认决定显隐（StatusBar 内部 isStatusBarHidden），
              错误指示器、系统调试终端与开关无关、始终在。 */}
          <StatusBar />
          
          {/* Overlays: Suspended Call Bar */}
          {suspendedCall && activeApp !== AppID.Call && (
            <button
              onClick={resumeCall}
              className="absolute top-7 left-0 w-full z-[55] flex items-center justify-center gap-2 bg-emerald-500 text-white text-xs font-bold py-1.5 animate-pulse cursor-pointer active:bg-emerald-600 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <span>通话中 · {suspendedCall.charName}</span>
              <span className="opacity-70">点击返回</span>
            </button>
          )}

          {/* Overlays: Global Mini Player (when music is playing in background) */}
          <GlobalMiniPlayer />

          {/* Overlays: 人格模拟生成全局指示条 */}
          <PersonaSimIndicator />

          {/* Overlays: 梦境生成全局指示条 */}
          <DreamSimIndicator />

          {/* Overlays: Toasts (Top) */}
          <div className="absolute top-12 left-0 w-full flex flex-col items-center gap-2 pointer-events-none z-[60]">
              {toasts.map(toast => (
                 <div key={toast.id} className="animate-fade-in bg-white/95 backdrop-blur-xl px-4 py-3 rounded-2xl shadow-xl border border-black/5 flex items-center gap-3 max-w-[85%] ring-1 ring-white/20">
                     {toast.type === 'success' && <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0"></div>}
                     {toast.type === 'error' && <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0"></div>}
                     {toast.type === 'info' && <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"></div>}
                     <span className="text-xs font-bold text-slate-800 truncate leading-none">{toast.message}</span>
                 </div>
              ))}
           </div>
       </div>

       {/* Global error dialog (长报错走它, 替代单行 toast) */}
       <ErrorDialog
         isOpen={!!errorDialog}
         title={errorDialog?.title ?? ''}
         details={errorDialog?.details ?? ''}
         onClose={dismissError}
       />

       {/* First-time disclaimer popup */}
       {showDisclaimer && <DisclaimerPopup onAccept={handleAcceptDisclaimer} />}

       {/* Interrupted import recovery reminder */}
       {!showDisclaimer && showImportRecoveryPrompt && (
         <ImportRecoveryPopup
           marker={importRecoveryMarker}
           onLater={() => { setImportRecoveryDismissed(true); setImportRecoveryMarker(null); }}
           onReimport={handleReimportFromRecovery}
         />
       )}

       {/* Version update popup (2026-04) — forced until acknowledged */}
       {!showDisclaimer && !showImportRecoveryPrompt && !showAuthorLetter && showUpdateNotification && (
         <UpdateNotificationController onClose={() => setShowUpdateNotification(false)} />
       )}

       {/* 520 特别活动弹窗（2026-05-20 当天，一次性） */}
       {!showDisclaimer && !showImportRecoveryPrompt && !showAuthorLetter && !showUpdateNotification && showLike520Popup && (
         <Like520Controller
           onClose={() => setShowLike520Popup(false)}
         />
       )}

       {!showDisclaimer && !showImportRecoveryPrompt && !showAuthorLetter && !showUpdateNotification && !showLike520Popup && showInstantPushSunset && (
         <InstantPushSunsetController onClose={() => setShowInstantPushSunset(false)} />
       )}

       {/* Worker 后端更新提醒（仅启用 Instant Push 的用户，每个 worker 版本一次） */}
       {!showDisclaimer && !showImportRecoveryPrompt && !showAuthorLetter && !showUpdateNotification && !showLike520Popup && !showInstantPushSunset && showWorkerUpdateReminder && (
         <WorkerUpdateReminderController
           onClose={() => setShowWorkerUpdateReminder(false)}
         />
       )}

       {/* 「该备份啦」提醒（local-first 数据只在本机，隔 N 天没导出弹一次） */}
       {!showDisclaimer && !showImportRecoveryPrompt && !showAuthorLetter && !showUpdateNotification && !showLike520Popup && !showInstantPushSunset && !showWorkerUpdateReminder && showBackupReminder && (
         <BackupReminderController
           onDismiss={dismissBackupReminder}
           onGoBackup={goBackupFromReminder}
         />
       )}
    </div>
  );
};

export default PhoneShell;
