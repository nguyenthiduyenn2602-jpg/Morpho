// 桌面皮肤本机偏好的备份/恢复（随 设置→导出 一起走）。
// 涉及：电子宠物(tamagotchi) / 手游风(mobilegame) 的界面配色方案 + 看板 banner。
// 这些偏好存在 localStorage，不挂在角色上，早期导出清单里没有——补齐后才能跨设备迁移。
//
// 看板图（tama_board_img）是个特例：它是 blobref 令牌，指向本机 blob_assets。
// 令牌换设备就失效，所以导出时解析回 data URL 内嵌进备份，导入时再落成本机 blob。
// 与壁纸的可移植策略同源（见 utils/blobRef.ts / OSContext 导出管线）。

import { isBlobRef, getBlobForRef, blobToDataUrl, migrateDataUrlToRef } from './blobRef';

// 纯字符串偏好键（原样带走）
const PLAIN_KEYS = [
    'tama_style_v2',   // 电子宠物：界面风格方案 {hue,dark,gold,mute}
    'mg_style_v1',     // 手游风：界面配色方案
    'tama_board_fg',   // 看板文字色（空=自动）
    'tama_accent_hue', // 旧版单色相偏好（迁移用，带上无害）
];
const BOARD_IMG_KEY = 'tama_board_img'; // 看板 banner 图（blobref 令牌 / data: / http）

/**
 * 导出：读齐本机偏好。
 * @param includeImage 是否内嵌看板图（false=纯文本备份，跳过大图，只带配色偏好）。
 *   看板图是 blobref 令牌，令牌换设备失效，故 true 时解析回 data URL；图床 http 链接原样带。
 * 无内容返回 undefined。
 */
export async function exportDesktopSkinLocal(includeImage = true): Promise<Record<string, string> | undefined> {
    const rec: Record<string, string> = {};
    try {
        for (const k of PLAIN_KEYS) {
            const v = localStorage.getItem(k);
            if (v != null) rec[k] = v;
        }
        const img = includeImage ? localStorage.getItem(BOARD_IMG_KEY) : null;
        if (img) {
            if (isBlobRef(img)) {
                const blob = await getBlobForRef(img);
                if (blob) rec[BOARD_IMG_KEY] = await blobToDataUrl(blob);
                // 解析不到（图已丢）就不带，避免导出一个恢复端认不得的死令牌
            } else {
                rec[BOARD_IMG_KEY] = img; // 旧 data: / 图床 http，原样可移植
            }
        }
    } catch { /* 私密模式等读盘失败：能带多少带多少 */ }
    return Object.keys(rec).length > 0 ? rec : undefined;
}

/** 导入：写回本机偏好；看板图若是 data URL 则落成本机 blob，字段换成新令牌。 */
export async function importDesktopSkinLocal(rec?: Record<string, string> | null): Promise<void> {
    if (!rec) return;
    try {
        for (const k of PLAIN_KEYS) {
            if (typeof rec[k] === 'string') localStorage.setItem(k, rec[k]);
        }
        const img = rec[BOARD_IMG_KEY];
        if (typeof img === 'string' && img) {
            // data URL → 本机 blob（换设备后令牌重建）；http/已是令牌则原样写
            const stored = img.startsWith('data:') ? await migrateDataUrlToRef(img) : img;
            localStorage.setItem(BOARD_IMG_KEY, stored);
        }
    } catch { /* 写盘失败无妨，用默认皮肤 */ }
}
