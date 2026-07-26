import { describe, expect, it } from 'vitest';
import {
    LEGACY_DEFAULT_WALLPAPER,
    isLegacyDefaultWallpaper,
    shouldPreserveLegacyDefaultWallpaper,
} from './wallpaperCompat';

describe('isLegacyDefaultWallpaper', () => {
    it('识别旧版十六进制粉绿默认渐变', () => {
        expect(isLegacyDefaultWallpaper(LEGACY_DEFAULT_WALLPAPER)).toBe(true);
    });

    it('识别浏览器规范化后的 rgb() 版本', () => {
        expect(isLegacyDefaultWallpaper('linear-gradient(135deg, rgb(255, 222, 233) 0%, rgb(181, 255, 252) 100%)')).toBe(true);
    });

    it('不把其它用户渐变当成旧默认', () => {
        expect(isLegacyDefaultWallpaper('linear-gradient(135deg, #ffdede, #b5fffc)')).toBe(false);
        expect(isLegacyDefaultWallpaper('linear-gradient(180deg, #FFDEE9, #B5FFFC)')).toBe(false);
    });

    it('只为用户主动选择的怀旧版保留旧默认壁纸', () => {
        expect(shouldPreserveLegacyDefaultWallpaper(LEGACY_DEFAULT_WALLPAPER, 'nostalgia')).toBe(true);
        expect(shouldPreserveLegacyDefaultWallpaper(LEGACY_DEFAULT_WALLPAPER, 'paper')).toBe(false);
        expect(shouldPreserveLegacyDefaultWallpaper(LEGACY_DEFAULT_WALLPAPER)).toBe(false);
    });
});
