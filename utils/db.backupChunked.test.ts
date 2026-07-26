import { describe, it, expect, beforeEach } from 'vitest';
import { DB, openDB } from './db';

// fake-indexeddb 已通过 test-setup.ts 注入。
// 这组用例锁住 #1「游标分批读」(getStoreDataChunked) 的契约：分批读出的结果集必须与
// getRawStoreData 的整表 getAll 完全一致（条数、顺序、内容），且回调可以是 async、批边界
// 不漏不重。这是给 v2 流式导出当地基的回归守卫——读法换了但数据一条都不能少。

// gallery store keyPath 'id'，直接拿 raw 事务塞数据，避开上层方法的额外语义。
async function seedGallery(records: any[]): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('gallery', 'readwrite');
        const store = tx.objectStore('gallery');
        store.clear();
        for (const r of records) store.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function collectChunked(storeName: string, batchSize?: number): Promise<any[]> {
    const out: any[] = [];
    await DB.getStoreDataChunked(storeName, batch => { out.push(...batch); }, batchSize);
    return out;
}

beforeEach(async () => {
    await seedGallery([]);
});

describe('getStoreDataChunked（游标分批读）', () => {
    it('结果集与 getRawStoreData 的 getAll 完全一致（条数/顺序/内容）', async () => {
        // 乱序写入，验证两种读法都按主键升序、彼此一致
        const ids = [37, 5, 128, 1, 999, 64, 2, 500, 88, 7];
        await seedGallery(ids.map(id => ({ id, url: `img_${id}`, tag: id % 2 ? 'odd' : 'even' })));

        const viaGetAll = await DB.getRawStoreData('gallery');
        const viaCursor = await collectChunked('gallery', 4); // batchSize < 总数，强制多批

        expect(viaCursor).toHaveLength(viaGetAll.length);
        expect(viaCursor).toEqual(viaGetAll); // 逐条深比，顺序也必须一致
        // 主键升序：1,2,5,7,37,...
        expect(viaCursor.map((r: any) => r.id)).toEqual([1, 2, 5, 7, 37, 64, 88, 128, 500, 999]);
    });

    it('空表：onBatch 一次都不调，正常结束', async () => {
        let calls = 0;
        await DB.getStoreDataChunked('gallery', () => { calls++; });
        expect(calls).toBe(0);
    });

    it('批边界：总数正好是 batchSize 整数倍，不漏不重不多跑空批', async () => {
        await seedGallery(Array.from({ length: 200 }, (_, i) => ({ id: i + 1, url: `u${i}` })));
        const batches: number[] = [];
        await DB.getStoreDataChunked('gallery', batch => { batches.push(batch.length); }, 50);
        // 200 / 50 = 4 个满批，不该多出一个空批
        expect(batches).toEqual([50, 50, 50, 50]);
        const all = await collectChunked('gallery', 50);
        expect(all).toHaveLength(200);
        expect(new Set(all.map((r: any) => r.id)).size).toBe(200); // 无重复
    });

    it('batchSize 大于总数：一批读完', async () => {
        await seedGallery(Array.from({ length: 30 }, (_, i) => ({ id: i + 1 })));
        const batches: number[] = [];
        await DB.getStoreDataChunked('gallery', batch => { batches.push(batch.length); }, 200);
        expect(batches).toEqual([30]);
    });

    it('回调是 async（中途 await 让出主线程）也不丢数据、不报事务失活', async () => {
        await seedGallery(Array.from({ length: 120 }, (_, i) => ({ id: i + 1, url: `u${i}` })));
        const out: any[] = [];
        await DB.getStoreDataChunked('gallery', async batch => {
            await new Promise(r => setTimeout(r, 0)); // 跨过事务自动提交点
            out.push(...batch);
        }, 40);
        expect(out).toHaveLength(120);
        expect(out.map((r: any) => r.id)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    });

    it('store 不存在：直接返回，不抛错', async () => {
        await expect(
            DB.getStoreDataChunked('__nonexistent_store__', () => { throw new Error('不该被调用'); })
        ).resolves.toBeUndefined();
    });
});
