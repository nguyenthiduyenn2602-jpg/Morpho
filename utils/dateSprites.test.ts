import { describe, it, expect } from 'vitest';
import { pickDateFallbackSprite } from './dateSprites';

const KEYS = ['normal', 'happy', 'angry', 'sad', 'shy'];
const AVATAR = 'data:image/png;base64,AVATAR';

describe('pickDateFallbackSprite', () => {
    it('优先 normal / default', () => {
        expect(pickDateFallbackSprite({ normal: 'data:n', happy: 'data:h' }, KEYS, AVATAR)).toBe('data:n');
        expect(pickDateFallbackSprite({ default: 'data:d' }, KEYS, AVATAR)).toBe('data:d');
    });

    it('无 normal 时按见面情绪键兜底', () => {
        expect(pickDateFallbackSprite({ shy: 'data:s' }, KEYS, AVATAR)).toBe('data:s');
        expect(pickDateFallbackSprite({ excited: 'data:e' }, [...KEYS, 'excited'], AVATAR)).toBe('data:e');
    });

    it('只有 chibi（blobref 令牌）时回落到头像，绝不把令牌当 img src', () => {
        expect(pickDateFallbackSprite({ chibi: 'blobref:img_abc' }, KEYS, AVATAR)).toBe(AVATAR);
    });

    it('chibi 即使是 dataURL 也不当见面立绘用', () => {
        expect(pickDateFallbackSprite({ chibi: 'data:image/png;base64,CHIBI' }, KEYS, AVATAR)).toBe(AVATAR);
    });

    it('非 chibi 的杂项键、可直接渲染的值仍可兜底（保留旧行为）', () => {
        expect(pickDateFallbackSprite({ legacy_pose: 'https://img.example/a.png' }, KEYS, AVATAR)).toBe('https://img.example/a.png');
    });

    it('杂项键但值是 blobref 令牌 → 跳过，回落头像', () => {
        expect(pickDateFallbackSprite({ legacy_pose: 'blobref:img_xyz' }, KEYS, AVATAR)).toBe(AVATAR);
    });

    it('空 sprites / undefined → 头像；连头像都没有 → undefined', () => {
        expect(pickDateFallbackSprite({}, KEYS, AVATAR)).toBe(AVATAR);
        expect(pickDateFallbackSprite(undefined, KEYS, AVATAR)).toBe(AVATAR);
        expect(pickDateFallbackSprite(undefined, KEYS, undefined)).toBeUndefined();
    });
});
