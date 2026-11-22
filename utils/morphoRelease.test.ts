import {beforeEach, expect, it, vi} from 'vitest';
import { MORPHO_RELEASE, MORPHO_RELEASE_HISTORY } from './morphoRelease';

beforeEach(() => {
    vi.resetModules();
    for (const { seenKey } of MORPHO_RELEASE_HISTORY) localStorage.removeItem(seenKey);
});
it('shows a new release once and preserves acknowledgment across reloads', async () => {
    localStorage.setItem(MORPHO_RELEASE_HISTORY[1].seenKey, '1');
    let release = await import('./morphoRelease');
    expect(release.shouldShowMorphoRelease()).toBe(true);
    release.dismissMorphoRelease();
    expect(localStorage.getItem(MORPHO_RELEASE.seenKey)).toBe('1');
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
