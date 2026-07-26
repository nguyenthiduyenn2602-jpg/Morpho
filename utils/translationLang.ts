export const TRANSLATION_LANG_PRESETS = ['中文', 'English', '日本語', '한국어', 'Français', 'Español'];

export const TRANSLATION_LANG_MAX_LENGTH = 40;

/**
 * Custom language labels are interpolated into the bilingual system prompt.
 * Keep them as short labels, not markup or prompt fragments.
 */
export function normalizeTranslationLangLabel(input: string | null | undefined): string {
  return String(input ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>{}\[\]`"'\\|#$%^*]/g, '')
    .replace(/[;；:：!?！？。]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TRANSLATION_LANG_MAX_LENGTH)
    .trim();
}

export function isTranslationLangPreset(lang: string | null | undefined): boolean {
  return !!lang && TRANSLATION_LANG_PRESETS.includes(lang);
}
