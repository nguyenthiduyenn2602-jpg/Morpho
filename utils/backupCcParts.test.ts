import { describe, it, expect, beforeEach } from 'vitest';
import { DB, openDB } from './db';

// 捏脸自定义部件（cc_custom_parts）的备份往返回归。
//
// 部件 src/shadowSrc 是 data:image，media/full 导出时会被 extractImagesInPlace 抽进 zip，
// JSON 里只留 assets/*.png 路径。导入必须经 importFullData 的 beforeWrite 钩子把路径还原回
// base64。历史 bug：这一节 clearAndAdd 把 restoreAssets 传成 false → beforeWrite 早退不还原，
// 导入回来部件图裂成 assets/*.png 死链。此用例钉死「导入会对 cc 部件调用资产还原」。

async function seedStore(name: string, records: any[]): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(name, 'readwrite');
        const store = tx.objectStore(name);
        store.clear();
        for (const r of records) store.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

beforeEach(async () => {
    await seedStore('cc_custom_parts', []);
});

describe('cc_custom_parts 备份往返：图片资产还原', () => {
    it('导入时对部件调用 beforeWrite（restoreAssets=true），路径还原回 base64', async () => {
        // 模拟导出后的形态：src/shadowSrc 已被抽成 zip 路径（assets/*.png）
        const backupParts = [
            { id: 'fronthair_cc_1', categoryKey: 'fronthair', name: '云朵', tintable: true,
              src: 'assets/asset_1.png', shadowSrc: 'assets/asset_2.png', createdAt: 1 },
            { id: 'decor_cc_2', categoryKey: 'decor', name: '星星', tintable: false,
              src: 'assets/asset_3.png', createdAt: 2 },
        ];

        // beforeWrite 模拟 restoreAssetsInPlace：把 assets/*.png 路径换回 data:image。
        // 只有 restoreAssets=true 的 section 才会触发它——这正是回归点。
        const restored: string[] = [];
        const beforeWrite = async (root: any) => {
            const walk = (o: any) => {
                if (!o || typeof o !== 'object') return;
                for (const k of Object.keys(o)) {
                    const v = o[k];
                    if (typeof v === 'string' && v.startsWith('assets/')) {
                        restored.push(v);
                        o[k] = `data:image/png;base64,RESTORED(${v})`;
                    } else if (v && typeof v === 'object') walk(v);
                }
            };
            walk(root);
        };

        await DB.importFullData({ customCreatorParts: backupParts } as any, { beforeWrite } as any);

        // beforeWrite 被调到了，三张图路径都被还原（bug 版本：restored 为空）
        expect(restored.sort()).toEqual(['assets/asset_1.png', 'assets/asset_2.png', 'assets/asset_3.png']);

        // 落库的部件 src/shadowSrc 已是 data:image，不再是死链路径
        const stored = (await DB.getRawStoreData('cc_custom_parts')).sort((a: any, b: any) => a.createdAt - b.createdAt);
        expect(stored).toHaveLength(2);
        expect(stored[0].src).toContain('data:image/png;base64,RESTORED(assets/asset_1.png)');
        expect(stored[0].shadowSrc).toContain('data:image/png;base64,RESTORED(assets/asset_2.png)');
        expect(stored[1].src).toContain('data:image/png;base64,RESTORED(assets/asset_3.png)');
        expect(stored.some((p: any) => typeof p.src === 'string' && p.src.startsWith('assets/'))).toBe(false);
    });
});
