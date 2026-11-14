import type { StoryTheaterImageConfig } from '../types';
export const STORY_IMAGE_PRESETS_KEY = 'os_story_image_presets_v1';
export interface StoryImagePreset {
    id: string; name: string; updatedAt: number;
    config: Pick<StoryTheaterImageConfig, 'styleTags' | 'negativeTags' | 'userAnchor' | 'characterAnchors' | 'width' | 'height'>;
}
export function snapshotStoryImageConfig(config: StoryTheaterImageConfig): StoryImagePreset['config'] {
    return { styleTags: config.styleTags || '', negativeTags: config.negativeTags || '', userAnchor: config.userAnchor || '',
        characterAnchors: { ...config.characterAnchors }, width: config.width, height: config.height };
}
export function loadStoryImagePresets(): StoryImagePreset[] {
    const raw = localStorage.getItem(STORY_IMAGE_PRESETS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string'
        || !p.config || !Number.isFinite(p.config.width) || !Number.isFinite(p.config.height)
        || !p.config.characterAnchors || typeof p.config.characterAnchors !== 'object'
        || Object.values(p.config.characterAnchors).some(value => typeof value !== 'string')
        || ['styleTags','negativeTags','userAnchor'].some(key => p.config[key] !== undefined && typeof p.config[key] !== 'string'))) {
        throw new Error('配图预设数据无法读取，请先检查备份；未覆盖原有数据');
    }
    return list;
}
export function saveStoryImagePreset(name: string, config: StoryTheaterImageConfig, updateId?: string): StoryImagePreset[] {
    const cleanName = name.trim();
    if (!cleanName) throw new Error('请给配图预设起个名字');
    if (cleanName.length > 60) throw new Error('预设名称最多 60 个字');
    const list = loadStoryImagePresets();
    if (updateId && !list.some(p => p.id === updateId)) throw new Error('预设已不存在，请另存为新预设');
    if (list.some(p => p.name === cleanName && p.id !== updateId)) throw new Error('已有同名预设，请换一个名字或选择后更新');
    const preset: StoryImagePreset = { id: updateId || crypto.randomUUID(), name: cleanName, updatedAt: Date.now(), config: snapshotStoryImageConfig(config) };
    const next = updateId ? list.map(p => p.id === updateId ? preset : p) : [...list, preset];
    localStorage.setItem(STORY_IMAGE_PRESETS_KEY, JSON.stringify(next));
    return next;
}
export function deleteStoryImagePreset(id: string): StoryImagePreset[] {
    const next = loadStoryImagePresets().filter(p => p.id !== id);
    localStorage.setItem(STORY_IMAGE_PRESETS_KEY, JSON.stringify(next));
    return next;
}
export function applyStoryImagePreset(draft: StoryTheaterImageConfig, preset: StoryImagePreset, actorIds: string[]): StoryTheaterImageConfig {
    const characterAnchors = { ...draft.characterAnchors };
    for (const id of actorIds) {
        if (Object.prototype.hasOwnProperty.call(preset.config.characterAnchors, id)) characterAnchors[id] = preset.config.characterAnchors[id];
    }
    return { ...draft, ...preset.config, characterAnchors, imageCount: 1 };
}
