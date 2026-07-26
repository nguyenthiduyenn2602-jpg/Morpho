import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
    writeV2Backup, assembleV2Backup, shardFileName,
    BACKUP_FORMAT_VERSION, type BackupManifest, type ShardLimits,
} from './backupFormat';

// 这组用例锁住 v2 分片格式的「写 → 读」往返与各档校验。核心契约：
//   导入端拼出的 data 必须与导出端喂进去的 backupData 逐字段一致（数组照旧、非数组照旧），
//   这样它喂给原封不动的 importFullData 时，还原行为就和 v1 完全一样。
// 失败档（缺片 / 条数不符 / 版本不符 / 非数组 / 单条超大）必须在「拼数据之前/导出中途」
// 干净报错，绝不退回 RangeError、绝不静默少数据。

// 内存假 zip：同时实现 ZipFileWriter / ZipFileReader，支持文本与二进制（Uint8Array）。
class FakeFile {
    constructor(private content: string | Uint8Array) {}
    async(type: 'string'): Promise<string>;
    async(type: 'uint8array'): Promise<Uint8Array>;
    async(type: 'string' | 'uint8array'): Promise<string | Uint8Array> {
        if (type === 'uint8array') {
            return Promise.resolve(this.content instanceof Uint8Array ? this.content : new TextEncoder().encode(String(this.content)));
        }
        return Promise.resolve(typeof this.content === 'string' ? this.content : new TextDecoder().decode(this.content));
    }
}
class FakeZip {
    files = new Map<string, string | Uint8Array>();
    file(name: string): FakeFile | null;
    file(name: string, data: string | Uint8Array, options?: { base64?: boolean }): void;
    file(name: string, data?: string | Uint8Array): FakeFile | null | void {
        if (data === undefined) {
            if (!this.files.has(name)) return null;
            return new FakeFile(this.files.get(name)!);
        }
        this.files.set(name, data);
    }
}

const sampleBackup = () => ({
    // 非数组字段 → metadata.json
    timestamp: 123,
    version: 3,
    theme: { name: 'dark', wallpaper: 'assets/asset_1.png' },
    userProfile: { name: '楪', avatar: 'assets/asset_2.png' },
    lifeSimState: null,                 // 单例空 → null，仍要原样带回（v1 语义：清目标）
    apiConfig: undefined,               // undefined 字段 → JSON 丢弃，导入端拿不到（与 v1 一致）
    // 数组字段 → 分片
    messages: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }],
    galleryImages: [],                  // 空数组 → count 0、parts 0，导入端必须拼回 []
    memoryNodes: [{ id: 'n1' }],
});

describe('backupFormat v2 往返', () => {
    it('写 → 读：每个字段与原 backupData 逐字段一致（数组照旧、非数组照旧）', async () => {
        const zip = new FakeZip();
        const src = sampleBackup();
        const manifest = await writeV2Backup(zip, { ...src, messages: [...src.messages], galleryImages: [], memoryNodes: [...src.memoryNodes] }, { mode: 'full', createdAt: 999, assetCount: 2 });

        expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
        expect(manifest.mode).toBe('full');
        expect(manifest.assetCount).toBe(2);
        // 数组字段都进了 manifest.stores（含空数组 count 0）
        expect(manifest.stores.messages).toEqual({ parts: 1, count: 3 });
        expect(manifest.stores.galleryImages).toEqual({ parts: 0, count: 0 });
        expect(manifest.stores.memoryNodes).toEqual({ parts: 1, count: 1 });
        // 非数组字段不进 stores
        expect(manifest.stores.theme).toBeUndefined();
        expect(manifest.stores.userProfile).toBeUndefined();

        const data = await assembleV2Backup(zip, manifest);
        expect(data.messages).toEqual(src.messages);
        expect(data.galleryImages).toEqual([]);              // 空数组拼回 []，不是 undefined
        expect(data.memoryNodes).toEqual(src.memoryNodes);
        expect(data.theme).toEqual(src.theme);
        expect(data.userProfile).toEqual(src.userProfile);
        expect(data.lifeSimState).toBe(null);                // null 原样带回
        expect('apiConfig' in data).toBe(false);             // undefined 字段被 JSON 丢弃，导入端没有
        expect(data.timestamp).toBe(123);
    });

    it('大数组按 maxItems 分多片，拼回顺序不乱、不漏不重', async () => {
        const zip = new FakeZip();
        const messages = Array.from({ length: 23 }, (_, i) => ({ id: i, body: `m${i}` }));
        const limits: ShardLimits = { maxLen: 1 << 30, maxItems: 5, hardMaxLen: 1 << 30 };
        const manifest = await writeV2Backup(zip, { messages: [...messages] }, { limits });

        expect(manifest.stores.messages.parts).toBe(5); // 23/5 → 5 片（5,5,5,5,3）
        expect(manifest.stores.messages.count).toBe(23);
        // 每片文件都在
        for (let p = 0; p < 5; p++) expect(zip.files.has(shardFileName('messages', p))).toBe(true);

        const data = await assembleV2Backup(zip, manifest);
        expect(data.messages).toEqual(messages); // 顺序 + 内容完全一致
    });

    it('单条超软上限：该条独占一片（Finding 5），仍能完整往返', async () => {
        const zip = new FakeZip();
        const big = { id: 'big', blob: 'x'.repeat(2000) };
        const items = [{ id: 'a' }, big, { id: 'c' }];
        // maxLen 设 1000：big 条 ~2000 长度，独占一片；前后小条各自成片
        const limits: ShardLimits = { maxLen: 1000, maxItems: 9999, hardMaxLen: 1 << 30 };
        const manifest = await writeV2Backup(zip, { messages: items }, { limits });
        const data = await assembleV2Backup(zip, manifest);
        expect(data.messages).toEqual(items);
        expect(manifest.stores.messages.count).toBe(3);
        expect(manifest.stores.messages.parts).toBeGreaterThanOrEqual(2);
    });

    it('数组含 undefined 空洞：count 记实际写入数，不让被跳过的空洞触发条数误判 abort（G1）', async () => {
        const zip = new FakeZip();
        // JSON.stringify(undefined) === undefined，导出时该元素被跳过
        const arr = [{ id: 1 }, undefined, { id: 3 }];
        const manifest = await writeV2Backup(zip, { messages: arr }, {});
        // count 必须是「实际写入的 2 条」而非 arr.length(3)，否则导入端条数自洽校验会误判损坏
        expect(manifest.stores.messages.count).toBe(2);
        const data = await assembleV2Backup(zip, manifest); // 旧写法（count=3）会在这里抛 count-mismatch
        expect(data.messages).toEqual([{ id: 1 }, { id: 3 }]);
    });

    it('单条超硬上限：干净报错中止，不退回 RangeError', async () => {
        const zip = new FakeZip();
        const limits: ShardLimits = { maxLen: 100, maxItems: 10, hardMaxLen: 500 };
        await expect(
            writeV2Backup(zip, { messages: [{ id: 'x', blob: 'y'.repeat(1000) }] }, { limits })
        ).rejects.toThrow(/单条记录过大/);
        // 没写出 manifest（中途抛错）
        expect(zip.files.has('manifest.json')).toBe(false);
    });
});

describe('backupFormat v2 校验档（写库前 abort，DB 未动）', () => {
    it('缺分片文件 → abort', async () => {
        const zip = new FakeZip();
        const manifest = await writeV2Backup(zip, { messages: [{ id: 1 }, { id: 2 }] }, {});
        zip.files.delete(shardFileName('messages', 0)); // 人为删掉一片
        await expect(assembleV2Backup(zip, manifest)).rejects.toThrow(/没有|找不到|中止导入/);
    });

    it('条数与 manifest 不符 → abort', async () => {
        const zip = new FakeZip();
        const manifest = await writeV2Backup(zip, { messages: [{ id: 1 }, { id: 2 }] }, {});
        const tampered: BackupManifest = { ...manifest, stores: { ...manifest.stores, messages: { parts: 1, count: 99 } } };
        await expect(assembleV2Backup(zip, tampered)).rejects.toThrow(/对不上|中止导入/);
    });

    it('formatVersion 不是 2（如未来 v3）→ abort，不拿 v2 parser 硬解', async () => {
        const zip = new FakeZip();
        const manifest = await writeV2Backup(zip, { messages: [{ id: 1 }] }, {});
        const v3: BackupManifest = { ...manifest, formatVersion: 3 };
        await expect(assembleV2Backup(zip, v3)).rejects.toThrow(/不支持的备份格式版本/);
    });

    it('分片内容不是数组 → abort', async () => {
        const zip = new FakeZip();
        zip.file('metadata.json', '{}');
        zip.file(shardFileName('messages', 0), '{"not":"an array"}');
        const manifest: BackupManifest = { formatVersion: 2, stores: { messages: { parts: 1, count: 1 } } };
        await expect(assembleV2Backup(zip, manifest)).rejects.toThrow(/不是数组/);
    });

    it('缺 metadata.json → abort', async () => {
        const zip = new FakeZip();
        const manifest: BackupManifest = { formatVersion: 2, stores: {} };
        await expect(assembleV2Backup(zip, manifest)).rejects.toThrow(/metadata\.json/);
    });
});

// 向量二进制旁路：构造 Float32 字节拼成的 bin + 索引，喂给 writeV2Backup 的 vectors 选项。
function makeVectorPayload(vecs: Array<{ memoryId: string; charId: string; values: number[]; model?: string }>) {
    const index: any[] = [];
    const parts: Uint8Array[] = [];
    let offset = 0;
    for (const v of vecs) {
        const f32 = new Float32Array(v.values);
        const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
        parts.push(bytes);
        index.push({ memoryId: v.memoryId, charId: v.charId, dimensions: f32.length, model: v.model, byteOffset: offset, byteLength: bytes.byteLength });
        offset += bytes.byteLength;
    }
    const bin = new Uint8Array(offset);
    let p = 0;
    for (const part of parts) { bin.set(part, p); p += part.byteLength; }
    return { bin, index };
}

describe('backupFormat v2 向量二进制旁路', () => {
    it('向量写 bin → 读回：逐值一致、维度保留、每条 vector 是独立 buffer 的 Uint8Array', async () => {
        const zip = new FakeZip();
        const payload = makeVectorPayload([
            { memoryId: 'm1', charId: 'c1', values: [0.1, 0.2, 0.3, 0.4], model: 'embed-test' },
            { memoryId: 'm2', charId: 'c1', values: [1, 2, 3, 4] },
            { memoryId: 'm3', charId: 'c2', values: [-0.5, 0.5, -0.25, 0.25] },
        ]);
        const manifest = await writeV2Backup(zip, { memoryNodes: [{ id: 'm1' }] }, { vectors: payload });
        expect(manifest.vectors).toEqual({ count: 3, byteLength: 3 * 4 * 4 });
        // 向量不进 stores（走旁路）
        expect(manifest.stores.memoryVectors).toBeUndefined();

        const data = await assembleV2Backup(zip, manifest);
        expect(data.memoryVectors).toHaveLength(3);
        const v1 = data.memoryVectors[0];
        expect(v1.memoryId).toBe('m1');
        expect(v1.charId).toBe('c1');
        expect(v1.model).toBe('embed-test');
        expect(v1.dimensions).toBe(4);
        // vector 是 Uint8Array，且 buffer 紧贴自己的 byteLength（证明是 slice 独立 buffer，不是整 bin 的 subarray 视图）
        expect(v1.vector).toBeInstanceOf(Uint8Array);
        expect(v1.vector.byteLength).toBe(16);
        expect(v1.vector.buffer.byteLength).toBe(16);
        // 逐值还原
        const back = new Float32Array(v1.vector.buffer, v1.vector.byteOffset, v1.vector.byteLength >>> 2);
        expect(Array.from(back)).toEqual([
            expect.closeTo(0.1, 6), expect.closeTo(0.2, 6), expect.closeTo(0.3, 6), expect.closeTo(0.4, 6),
        ]);
        // 第二条整数值精确
        const back2 = new Float32Array(data.memoryVectors[1].vector.buffer, data.memoryVectors[1].vector.byteOffset, 4);
        expect(Array.from(back2)).toEqual([1, 2, 3, 4]);
    });

    it('向量 byteLength 与维度对不上 → abort', async () => {
        const zip = new FakeZip();
        const payload = makeVectorPayload([{ memoryId: 'm1', charId: 'c1', values: [1, 2, 3, 4] }]);
        payload.index[0].dimensions = 5; // 谎称 5 维但只有 16 字节（4 维）
        const manifest = await writeV2Backup(zip, {}, { vectors: payload });
        await expect(assembleV2Backup(zip, manifest)).rejects.toThrow(/维度对不上|中止导入/);
    });

    it('向量条数与 manifest 不符 → abort', async () => {
        const zip = new FakeZip();
        const payload = makeVectorPayload([{ memoryId: 'm1', charId: 'c1', values: [1, 2, 3, 4] }]);
        const manifest = await writeV2Backup(zip, {}, { vectors: payload });
        const tampered: BackupManifest = { ...manifest, vectors: { count: 99, byteLength: manifest.vectors!.byteLength } };
        await expect(assembleV2Backup(zip, tampered)).rejects.toThrow(/向量条数.*不符|中止导入/);
    });

    it('向量 bin 字节数与 manifest 不符 → abort', async () => {
        const zip = new FakeZip();
        const payload = makeVectorPayload([{ memoryId: 'm1', charId: 'c1', values: [1, 2, 3, 4] }]);
        const manifest = await writeV2Backup(zip, {}, { vectors: payload });
        const tampered: BackupManifest = { ...manifest, vectors: { count: 1, byteLength: 9999 } };
        await expect(assembleV2Backup(zip, tampered)).rejects.toThrow(/bin 字节数.*不符|中止导入/);
    });

    it('声明了向量但缺 bin 文件 → abort', async () => {
        const zip = new FakeZip();
        const payload = makeVectorPayload([{ memoryId: 'm1', charId: 'c1', values: [1, 2, 3, 4] }]);
        const manifest = await writeV2Backup(zip, {}, { vectors: payload });
        zip.files.delete('stores/memory_vectors.bin');
        await expect(assembleV2Backup(zip, manifest)).rejects.toThrow(/缺 index\/bin|中止导入/);
    });

    // codex 二审 finding：坏 byteOffset 会被 slice 钳制成空/截断字节、组装却照样过 → 写库前必须挡住
    it('向量 byteOffset 越过 bin 末尾 → abort（不被 slice 静默钳制）', async () => {
        const zip = new FakeZip();
        const payload = makeVectorPayload([
            { memoryId: 'm1', charId: 'c1', values: [1, 2, 3, 4] },
            { memoryId: 'm2', charId: 'c1', values: [5, 6, 7, 8] },
        ]);
        payload.index[1].byteOffset = payload.bin.byteLength; // 指到 bin 末尾之外
        const manifest = await writeV2Backup(zip, {}, { vectors: payload });
        await expect(assembleV2Backup(zip, manifest)).rejects.toThrow(/越过 bin 末尾|中止导入/);
    });

    it('向量 byteOffset 为负数 → abort', async () => {
        const zip = new FakeZip();
        const payload = makeVectorPayload([{ memoryId: 'm1', charId: 'c1', values: [1, 2, 3, 4] }]);
        payload.index[0].byteOffset = -4;
        const manifest = await writeV2Backup(zip, {}, { vectors: payload });
        await expect(assembleV2Backup(zip, manifest)).rejects.toThrow(/偏移\/长度\/维度非法|中止导入/);
    });
});

// FakeZip 只验逻辑，验不到真 JSZip 的二进制编码 + generateAsync/loadAsync 实际行为。
// 这条用真 JSZip 跑完整往返，钉死「bin 直写 Uint8Array、读回 async('uint8array') 字节无损」。
describe('backupFormat v2 真实 JSZip 二进制往返', () => {
    it('真 JSZip：写 bin + 分片 + metadata → generateAsync → loadAsync → 读 manifest → 完整还原', async () => {
        const zip = new JSZip();
        const payload = makeVectorPayload([
            { memoryId: 'm1', charId: 'c1', values: [0.1, 0.2, 0.3, 0.4], model: 'e' },
            { memoryId: 'm2', charId: 'c2', values: [1, 2, 3, 4] },
        ]);
        await writeV2Backup(zip as any, {
            messages: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }],
            theme: { name: 'dark' },
        }, { vectors: payload, mode: 'full' });

        // 真正打包成字节，再原样解回来（模拟落盘 → 重新导入）
        const bytes = await zip.generateAsync({ type: 'uint8array' });
        const loaded = await JSZip.loadAsync(bytes);
        // manifest 从 zip 里读（不是用内存里的），走和导入端一模一样的路径
        const manifest = JSON.parse(await loaded.file('manifest.json')!.async('string'));
        const data = await assembleV2Backup(loaded as any, manifest);

        expect(data.messages).toEqual([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
        expect(data.theme).toEqual({ name: 'dark' });
        expect(data.memoryVectors).toHaveLength(2);
        expect(data.memoryVectors[0].vector).toBeInstanceOf(Uint8Array);
        expect(data.memoryVectors[0].vector.byteLength).toBe(16);
        const back = new Float32Array(data.memoryVectors[0].vector.buffer, data.memoryVectors[0].vector.byteOffset, 4);
        expect(Array.from(back)).toEqual([
            expect.closeTo(0.1, 6), expect.closeTo(0.2, 6), expect.closeTo(0.3, 6), expect.closeTo(0.4, 6),
        ]);
        const back2 = new Float32Array(data.memoryVectors[1].vector.buffer, data.memoryVectors[1].vector.byteOffset, 4);
        expect(Array.from(back2)).toEqual([1, 2, 3, 4]);
    });
});
