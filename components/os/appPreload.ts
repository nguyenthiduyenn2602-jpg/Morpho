import { AppID } from '../../types';
import { isIOSStandaloneWebApp } from '../../utils/iosStandalone';

// AppID → 该 App 代码块的 import 工厂（路径相对本文件 components/os/）。
// 与 PhoneShell 的 lazy 定义指向同一批模块；Vite 按模块 URL 去重，
// 「按下即预取」与「空闲预取/懒加载」共用同一份 chunk，绝不重复下载。
// 新增 App 时若忘记在此登记，仅会少一次按下预取优化，不影响功能（打开时照常懒加载）。
const importers: Partial<Record<AppID, () => Promise<unknown>>> = {
  [AppID.Settings]: () => import('../../apps/Settings'),
  [AppID.Character]: () => import('../../apps/Character'),
  [AppID.Chat]: () => import('../../apps/Chat'),
  [AppID.GroupChat]: () => import('../../apps/GroupChat'),
  [AppID.ThemeMaker]: () => import('../../apps/ThemeMaker'),
  [AppID.Gallery]: () => import('../../apps/Gallery'),
  [AppID.FAQ]: () => import('../../apps/FAQApp'),
  [AppID.Worldbook]: () => import('../../apps/WorldbookApp'),
  [AppID.Browser]: () => import('../../apps/BrowserApp'),
  [AppID.Call]: () => import('../../apps/CallApp'),
  [AppID.VoiceDesigner]: () => import('../../apps/VoiceDesignerApp'),
  [AppID.MemoryPalace]: () => import('../../apps/MemoryPalaceApp'),
  [AppID.Handbook]: () => import('../../apps/HandbookApp'),
  [AppID.QQBridge]: () => import('../../apps/QQBridge'),
  [AppID.CharCreatorDev]: () => import('../../apps/CharCreatorDevApp'),
};

// 已发起预取的 App（去重，避免同一图标多次 pointerdown 重复触发）。
const requested = new Set<AppID>();

const IOS_STANDALONE_SAFE_PRELOAD_APPS = new Set<AppID>([
  AppID.Character,
  AppID.Call,
  ]);

// 负载预热挂钩：由 PhoneShell 注入，按 AppID 解析对应 React.lazy 的负载本身
// （不仅下载模块），使首次打开不再 suspend、无切换瞬间露底色的闪烁。
// 解耦放这里是为了让 AppIcon（pointerdown）也能触发，而无需直接依赖 PhoneShell 的 lazy 定义。
let payloadWarmer: ((id: AppID) => void) | null = null;
export const setAppPayloadWarmer = (fn: (id: AppID) => void): void => { payloadWarmer = fn; };

/**
 * 「按下即预取」：手指刚按到图标（pointerdown，早于 tap 完成约 100ms）即预热该 App。
 * 兜住「开机后空闲预取还没轮到、用户就抢先点了某个冷门 App」的极端情况。
 * 优先走负载预热（连 React.lazy 负载一起解析 → 无闪烁）；未注入时退化为仅预热 Vite 模块。
 */
export const preloadApp = (id: AppID): void => {
  if (isIOSStandaloneWebApp() && !IOS_STANDALONE_SAFE_PRELOAD_APPS.has(id)) return;
  if (requested.has(id)) return;
  requested.add(id);
  if (payloadWarmer) { payloadWarmer(id); return; }
  const factory = importers[id];
  if (factory) Promise.resolve(factory()).catch(() => { requested.delete(id); });
  else requested.delete(id);
};
