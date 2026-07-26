/**
 * 老用户数据里的鲨盘（sharkpan）图链接一次性改写成 jsDelivr。
 *
 * 背景：Sully 的表情包、家园情绪立绘、小屋家具、见面皮肤等默认素材原先挂在 sharkpan 图床
 * （不稳定、常拉不到）。源码常量已改为素材仓库 jsDelivr 路径，但【已经装过】的用户 IndexedDB
 * 里存的仍是老鲨盘链接——只改源码只能救新用户。这里在启动时把这些库存链接就地改写，救现有用户。
 *
 * 只替换【精确匹配】的已知鲨盘 URL（下表 30 条），绝不碰用户自己上传的图；
 * bank 背景图（bg.png）用户选择不迁、head.png 已单独处理，都不在表内。
 */

import { DB } from './db';

const BASE = 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/';

// 鲨盘完整 URL -> jsDelivr 完整 URL（文件名保持不变，与源码常量一致）。
export const SHARKPAN_ASSET_MAP: Record<string, string> = Object.fromEntries(
    [
        ['https://sharkpan.xyz/f/pWg6HQ/night.png', 'night.png'],
        ['https://sharkpan.xyz/f/75wvuj/w.png', 'w.png'],
        ['https://sharkpan.xyz/f/MK77Ia/see.png', 'see.png'],
        ['https://sharkpan.xyz/f/3WwMHe/fight.png', 'fight.png'],
        ['https://sharkpan.xyz/f/5nwxCj/an.png', 'an.png'],
        ['https://sharkpan.xyz/f/ylWpfN/sDN.png', 'sDN.png'],
        ['https://sharkpan.xyz/f/QdnaU6/sorry.png', 'sorry.png'],
        ['https://sharkpan.xyz/f/5nrJsj/wait.png', 'wait.png'],
        ['https://sharkpan.xyz/f/w3QQFq/01.png', '01.png'],
        ['https://sharkpan.xyz/f/MKg7ta/02.png', '02.png'],
        ['https://sharkpan.xyz/f/3WnMce/03.png', '03.png'],
        ['https://sharkpan.xyz/f/5n1xSj/04.png', '04.png'],
        ['https://sharkpan.xyz/f/kdwet6/05.png', '05.png'],
        ['https://sharkpan.xyz/f/oWZQF4/S2.png', 'S2.png'],
        ['https://sharkpan.xyz/f/A3XeUZ/BED.png', 'BED.png'],
        ['https://sharkpan.xyz/f/G5n3Ul/DNZ.png', 'DNZ.png'],
        ['https://sharkpan.xyz/f/zlpWS5/SG.png', 'SG.png'],
        ['https://sharkpan.xyz/f/85K5ij/DDB.png', 'DDB.png'],
        ['https://sharkpan.xyz/f/75Nvsj/LJT.png', 'LJT.png'],
        ['https://sharkpan.xyz/f/NdJyhv/b.png', 'b.png'],
        ['https://sharkpan.xyz/f/m3adhW/Vha.png', 'Vha.png'],
        ['https://sharkpan.xyz/f/BZgDfa/Vsad.png', 'Vsad.png'],
        ['https://sharkpan.xyz/f/4rzdtj/VNormal.png', 'VNormal.png'],
        ['https://sharkpan.xyz/f/NdlVfv/VAn.png', 'VAn.png'],
        ['https://sharkpan.xyz/f/VyontY/Vshy.png', 'Vshy.png'],
        ['https://sharkpan.xyz/f/xl8muX/VBl.png', 'VBl.png'],
        ['https://sharkpan.xyz/f/dDzLi8/001.png', '001.png'],
        ['https://sharkpan.xyz/f/lmD6Tx/002.png', '002.png'],
        ['https://sharkpan.xyz/f/gXayCw/XT.png', 'XT.png'],
        ['https://sharkpan.xyz/f/2WzAFQ/CAFE.png', 'CAFE.png'],
    ].map(([old, name]) => [old, BASE + name]),
);

/** 把字符串里所有已知鲨盘链接替换成 jsDelivr。无已知链接则原样返回（省掉无谓改写）。 */
export function rewriteSharkpanUrls(s: string): string {
    if (!s.includes('sharkpan.xyz')) return s;
    let out = s;
    for (const [oldUrl, newUrl] of Object.entries(SHARKPAN_ASSET_MAP)) {
        if (out.includes(oldUrl)) out = out.split(oldUrl).join(newUrl);
    }
    return out;
}

const MIGRATION_FLAG = 'sharkpan_assets_migrated_v1';

/**
 * 启动时调用一次：把表情包 + 角色（立绘/家具/见面皮肤，可能深层嵌套）里存的鲨盘链接
 * 改写成 jsDelivr。幂等；跑成功后打标记跳过后续启动。任何异常吞掉，绝不阻断启动。
 */
export async function migrateSharkpanAssets(): Promise<void> {
    try { if (localStorage.getItem(MIGRATION_FLAG) === '1') return; } catch { /* localStorage 不可用：照跑 */ }

    try {
        // 表情包：逐行改 url（keyPath=name，saveEmoji 同名覆盖）
        const emojis = await DB.getRawStoreData('emojis');
        for (const e of emojis) {
            if (e && typeof e.url === 'string' && e.url.includes('sharkpan.xyz')) {
                const nu = rewriteSharkpanUrls(e.url);
                if (nu !== e.url) await DB.saveEmoji(e.name, nu, e.categoryId);
            }
        }

        // 角色：整体序列化后深层替换（立绘 sprites / 小屋 roomConfig / 见面 dateSkinSets 都能一网打尽）
        const chars = await DB.getAllCharacters();
        for (const c of chars) {
            const s = JSON.stringify(c);
            if (!s.includes('sharkpan.xyz')) continue;
            const ns = rewriteSharkpanUrls(s);
            if (ns !== s) await DB.saveCharacter(JSON.parse(ns));
        }

        try { localStorage.setItem(MIGRATION_FLAG, '1'); } catch { /* ignore */ }
    } catch (err) {
        console.warn('[migrateSharkpanAssets] 迁移失败（不影响启动，下次再试）', err);
    }
}
