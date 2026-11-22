const PREVIOUS_MORPHO_RELEASE = {
    id: 'morpho-2026-11-14', date: '2026.11.14',
    title: '让心事有回音，让故事有画面',
    subtitle: 'Morpho 热线上线 · 见面剧情配图优化',
    seenKey: 'morpho_update_2026_11_14_seen',
    path: 'updates/morpho-2026-11-14.html',
};

export const MORPHO_RELEASE = {
    id: 'morpho-2026-11-22', date: '2026.11.22',
    title: '吃了吗 2.0',
    subtitle: '私聊饮食卡片 · 确认后扣库存',
    seenKey: 'morpho_update_2026_11_22_seen',
    path: 'updates/morpho-2026-11-22.html',
};

export const MORPHO_RELEASE_HISTORY = [MORPHO_RELEASE, PREVIOUS_MORPHO_RELEASE];

let dismissedInSession = false;
export function shouldShowMorphoRelease(): boolean {
    if (dismissedInSession) return false;
    try { return localStorage.getItem(MORPHO_RELEASE.seenKey) !== '1'; } catch { return true; }
}
export function dismissMorphoRelease(): void {
    dismissedInSession = true;
    try { localStorage.setItem(MORPHO_RELEASE.seenKey, '1'); } catch { /* session guard prevents repeated popups */ }
}
