// 气泡主题解析 —— 从 apps/Chat.tsx 抽出的共享逻辑（私聊/群聊共用）。
// presets 作参数传入，避免 utils → components 反向依赖。
import { ChatTheme } from '../../types';

/**
 * 按主题 id 解析出完整 ChatTheme：custom 优先 → preset → default 兜底；
 * legacy/导入主题可能缺 user 或 ai 侧（直接用会让 MessageItem 读
 * styleConfig.borderRadius 崩掉），用 default 对应侧补全。
 */
export function resolveChatTheme(
    themeId: string | undefined,
    customThemes: ChatTheme[],
    presets: Record<string, ChatTheme>,
    fallbackId: string = 'default',
): ChatTheme {
    const fallback = presets[fallbackId];
    const id = themeId || fallbackId;
    const found = customThemes.find(t => t.id === id) || presets[id] || fallback;
    return {
        ...found,
        user: { ...fallback.user, ...(found.user || {}) },
        ai: { ...fallback.ai, ...(found.ai || {}) },
    };
}
