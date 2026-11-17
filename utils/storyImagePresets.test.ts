import { beforeEach, describe, expect, it } from 'vitest';
import { rememberStoryImagePreset, restoreStoryImagePreset, STORY_IMAGE_PRESETS_KEY, loadStoryImagePresets, saveStoryImagePreset, deleteStoryImagePreset, applyStoryImagePreset } from './storyImagePresets';
const config = { enabled: true, width: 1216, height: 832, styleTags: 'artist:one', negativeTags: 'blur', userAnchor: 'blue eyes', characterAnchors: {a: 'black hair', b: ''}, directorApiEnabled: true, directorApi: {baseUrl:'https://api.test',apiKey:'secret',model:'director'} };
beforeEach(() => localStorage.removeItem(STORY_IMAGE_PRESETS_KEY));
describe('named illustration presets', () => {
    it('persists an independent snapshot without API credentials or toggles', () => {
        const input = {...config,characterAnchors:{...config.characterAnchors}};
        saveStoryImagePreset('  watercolor  ',input);
        input.characterAnchors.a = 'changed';
        const [preset] = loadStoryImagePresets();
        expect(preset.name).toBe('watercolor');
        expect(preset.config.characterAnchors.a).toBe('black hair');
        expect(JSON.stringify(preset)).not.toContain('secret');
        expect(preset.config).not.toHaveProperty('enabled');
    });
    it('matches actors by ID, preserves unmatched people and API settings, and honors deliberately empty prompts', () => {
        const [preset] = saveStoryImagePreset('one',config);
        const draft = {...config,characterAnchors:{b:'old',c:'silver hair'}};
        const result = applyStoryImagePreset(draft,preset,['b','c']);
        expect(result.characterAnchors).toEqual({b:'',c:'silver hair'});
        expect(result.directorApi).toEqual(config.directorApi);
        expect(result.enabled).toBe(true);
        expect(draft.characterAnchors.b).toBe('old');
    });
    it('rejects duplicate/empty names, supports rename and update without adding duplicates', () => {
        expect(() => saveStoryImagePreset(' ',config)).toThrow();
        const [first] = saveStoryImagePreset('one',config);
        expect(() => saveStoryImagePreset('one',config)).toThrow();
        saveStoryImagePreset('renamed',{...config,styleTags:'new style'},first.id);
        expect(loadStoryImagePresets()).toHaveLength(1);
        expect(loadStoryImagePresets()[0].config.styleTags).toBe('new style');
        expect(loadStoryImagePresets()[0].name).toBe('renamed');
        expect(deleteStoryImagePreset(first.id)).toEqual([]);
        expect(loadStoryImagePresets()).toEqual([]);
    });
    it('does not overwrite damaged stored data', () => {
        localStorage.setItem(STORY_IMAGE_PRESETS_KEY,'broken');
        expect(() => saveStoryImagePreset('one',config)).toThrow();
        expect(localStorage.getItem(STORY_IMAGE_PRESETS_KEY)).toBe('broken');
    });
});

describe('preset picker restoration', () => {
    it('restores a saved name on reopen and keeps stories independent', () => {
        const [preset] = saveStoryImagePreset('morning', config);
        rememberStoryImagePreset('story-one', preset.id);
        expect(restoreStoryImagePreset('story-one', loadStoryImagePresets())?.name).toBe('morning');
        expect(restoreStoryImagePreset('story-two', loadStoryImagePresets())).toBeUndefined();
        saveStoryImagePreset('renamed', config, preset.id);
        expect(restoreStoryImagePreset('story-one', loadStoryImagePresets())?.name).toBe('renamed');
        deleteStoryImagePreset(preset.id);
        expect(restoreStoryImagePreset('story-one', loadStoryImagePresets())).toBeUndefined();
    });
    it('keeps an explicitly cleared picker empty', () => {
        const [preset] = saveStoryImagePreset('evening', config);
        rememberStoryImagePreset('story-clear', preset.id);
        rememberStoryImagePreset('story-clear', '');
        expect(restoreStoryImagePreset('story-clear', loadStoryImagePresets())).toBeUndefined();
    });
});
