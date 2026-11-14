import {beforeEach, expect, it, vi} from 'vitest';
beforeEach(() => { vi.resetModules(); localStorage.removeItem('morpho_update_2026_11_14_seen'); });
it('shows a new release once and preserves acknowledgment across reloads', async () => {
    let release = await import('./morphoRelease');
    expect(release.shouldShowMorphoRelease()).toBe(true);
    release.dismissMorphoRelease();
    expect(release.shouldShowMorphoRelease()).toBe(false);
    vi.resetModules(); release = await import('./morphoRelease');
    expect(release.shouldShowMorphoRelease()).toBe(false);
});
it('does not loop the popup if local storage is unavailable', async () => {
    const release = await import('./morphoRelease');
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {throw Error('quota');});
    try { release.dismissMorphoRelease(); expect(release.shouldShowMorphoRelease()).toBe(false); }
    finally { spy.mockRestore(); }
});
