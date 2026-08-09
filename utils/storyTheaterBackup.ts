export const STORY_THEATER_APPEARANCE_STORAGE_KEY = 'sully_story_theater_appearance_v1';

export function exportStoryTheaterAppearanceSetting(): string | undefined {
    try {
        const value = localStorage.getItem(STORY_THEATER_APPEARANCE_STORAGE_KEY);
        return value || undefined;
    } catch {
        return undefined;
    }
}

export function restoreStoryTheaterAppearanceSetting(value: unknown): boolean {
    if (typeof value !== 'string' || !value) return false;
    try {
        const parsed = JSON.parse(value);
        if (
            !parsed
            || (parsed.color !== 'light' && parsed.color !== 'dark')
            || (parsed.decor !== 'plain' && parsed.decor !== 'cinema')
        ) {
            return false;
        }
        localStorage.setItem(STORY_THEATER_APPEARANCE_STORAGE_KEY, value);
        return true;
    } catch {
        return false;
    }
}
