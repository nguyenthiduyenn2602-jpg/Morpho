export const MORPHO_RELEASE = {
    id: 'morpho-2026-11-14', date: '2026.11.14',
    title: '让心事有回音，让故事有画面',
    subtitle: 'Morpho 热线上线 · 见面剧情配图优化',
    seenKey: 'morpho_update_2026_11_14_seen',
    path: 'updates/morpho-2026-11-14.html',
};
let dismissedInSession = false;
export function shouldShowMorphoRelease(): boolean {
    if (dismissedInSession) return false;
    try { return localStorage.getItem(MORPHO_RELEASE.seenKey) !== '1'; } catch { return true; }
}
export function dismissMorphoRelease(): void {
    dismissedInSession = true;
    try { localStorage.setItem(MORPHO_RELEASE.seenKey, '1'); } catch { /* session guard prevents repeated popups */ }
}
