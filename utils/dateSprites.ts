// 见面模式（DateApp）立绘兜底选择。
//
// 背景：char.sprites 是个混装袋——除了见面情绪立绘（normal/happy/…/自定义），还装着
// 小小窝的房间立绘 sprites['chibi']。7.10 更新后，小小窝上传 / QQ捏人工坊写入的 chibi
// 是 `blobref:<id>` 令牌（见 utils/blobRef.ts），不能直接当 <img src> 用。
// 老的兜底写法 `Object.values(sprites)[0]` 会在头像之前捞到它 → 没传见面立绘、
// 一直靠头像显示的角色，见面模式直接裂图。
//
// 这里统一兜底顺序：normal/default → 见面情绪键 → 其它可直接渲染的 sprite
// （跳过 chibi 键与一切 blobref 令牌）→ 头像。
import { isBlobRef } from './blobRef';

export function pickDateFallbackSprite(
    sprites: Record<string, string> | undefined | null,
    dateEmotionKeys: string[],
    avatar?: string,
): string | undefined {
    const s = sprites || {};
    const direct = s['normal'] || s['default'];
    if (direct && !isBlobRef(direct)) return direct;
    const emoKey = dateEmotionKeys.find(k => s[k] && !isBlobRef(s[k]));
    if (emoKey) return s[emoKey];
    const stray = Object.entries(s).find(([k, v]) => v && k !== 'chibi' && !isBlobRef(v));
    if (stray) return stray[1];
    return avatar;
}
