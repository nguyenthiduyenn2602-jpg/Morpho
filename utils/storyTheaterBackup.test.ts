import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { assembleV2Backup, writeV2Backup } from './backupFormat';
import { exportStoryTheaterAppearanceSetting, restoreStoryTheaterAppearanceSetting, STORY_THEATER_APPEARANCE_STORAGE_KEY } from './storyTheaterBackup';

describe('story theater local settings backup', () => {
    it('exports the saved appearance value', () => {
        localStorage.setItem(STORY_THEATER_APPEARANCE_STORAGE_KEY, '{"color":"dark","decor":"cinema"}');
        expect(exportStoryTheaterAppearanceSetting()).toBe('{"color":"dark","decor":"cinema"}');
    });

    it('restores a valid appearance value', () => {
        const raw = '{"color":"light","decor":"plain"}';
        expect(restoreStoryTheaterAppearanceSetting(raw)).toBe(true);
        expect(localStorage.getItem(STORY_THEATER_APPEARANCE_STORAGE_KEY)).toBe(raw);
    });

    it('does not overwrite the current value with invalid backup data', () => {
        localStorage.setItem(STORY_THEATER_APPEARANCE_STORAGE_KEY, '{"color":"dark","decor":"plain"}');
        expect(restoreStoryTheaterAppearanceSetting('{"color":"unknown","decor":"plain"}')).toBe(false);
        expect(localStorage.getItem(STORY_THEATER_APPEARANCE_STORAGE_KEY)).toBe('{"color":"dark","decor":"plain"}');
        expect(restoreStoryTheaterAppearanceSetting(undefined)).toBe(false);
        expect(localStorage.getItem(STORY_THEATER_APPEARANCE_STORAGE_KEY)).toBe('{"color":"dark","decor":"plain"}');
    });

    it('survives the real v2 ZIP container round-trip', async () => {
        const raw = '{"color":"dark","decor":"cinema"}';
        const zip = new JSZip();
        const manifest = await writeV2Backup(zip as any, { storyTheaterAppearance: raw }, { mode: 'full' });
        const archive = await zip.generateAsync({ type: 'uint8array' });
        const loaded = await JSZip.loadAsync(archive);
        const data = await assembleV2Backup(loaded as any, manifest);
        localStorage.removeItem(STORY_THEATER_APPEARANCE_STORAGE_KEY);
        expect(restoreStoryTheaterAppearanceSetting(data.storyTheaterAppearance)).toBe(true);
        expect(exportStoryTheaterAppearanceSetting()).toBe(raw);
    });
});
