import { describe, it, expect, vi } from 'vitest';
import { extractImagesInPlace, deepCloneForExport, EXPORT_CHUNK_SIZE, sliceRanges } from './backupExport';

const IMG = 'data:image/png;base64,AAAA';

describe('extractImagesInPlace', () => {
    it('原地把 data:image 字符串换成 resolveImage 的返回值（不另起一棵树）', () => {
        const root = { a: IMG, nested: { b: IMG }, list: ['x', IMG] };
        const nestedRef = root.nested;
        extractImagesInPlace(root, () => 'assets/p.png');
        expect(root.a).toBe('assets/p.png');
        expect(root.nested.b).toBe('assets/p.png');
        expect(root.list[1]).toBe('assets/p.png');
        // 是原地改：对象引用没变
        expect(root.nested).toBe(nestedRef);
    });

    it('非 data:image 字符串和其它原始值原样保留', () => {
        const root = { keep: 'hello', n: 1, b: true, url: 'https://x/y.png' };
        extractImagesInPlace(root, () => 'assets/SHOULD_NOT_APPEAR.png');
        expect(root).toEqual({ keep: 'hello', n: 1, b: true, url: 'https://x/y.png' });
    });

    it('resolveImage 返回原值时（无法抽取的 data url）字符串保持不变', () => {
        const root = { a: IMG };
        extractImagesInPlace(root, (v) => v);
        expect(root.a).toBe(IMG);
    });

    it('共享子图只处理一次', () => {
        const shared = { img: IMG };
        const root = { left: shared, right: shared };
        const resolve = vi.fn(() => 'assets/p.png');
        extractImagesInPlace(root, resolve);
        // shared.img 这个 data url 只被解析一次
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(root.left.img).toBe('assets/p.png');
        expect(root.right).toBe(root.left);
    });

    it('遇到自引用循环抛出清楚的错误', () => {
        const a: any = { img: IMG };
        a.self = a;
        expect(() => extractImagesInPlace(a, () => 'assets/p.png')).toThrow(/循环引用/);
    });

    it('遇到多级循环（a→b→a）也抛错', () => {
        const a: any = {};
        const b: any = { back: a };
        a.next = b;
        expect(() => extractImagesInPlace(a, () => 'assets/p.png')).toThrow(/循环引用/);
    });

    it('根是数组时也能遍历', () => {
        const root: any[] = [IMG, { img: IMG }];
        extractImagesInPlace(root, () => 'assets/p.png');
        expect(root[0]).toBe('assets/p.png');
        expect(root[1].img).toBe('assets/p.png');
    });

    // 回归：QQ捏人工坊往整合导出/导入。抽取是全字段递归、无白名单，所以角色里
    // 深埋在 chibiStudio / vrState.chibi / specialMomentRecords 下的 data:image 都必须
    // 被抽走（换成 assets/*）。若日后有人给抽取加字段白名单，这条会红。
    it('角色的 chibiStudio / vrState.chibi / 520 记录里的图都会被递归抽取', () => {
        const char: any = {
            id: 'char-1',
            avatar: IMG,
            sprites: { chibi: IMG },
            vrState: { chibi: { img: IMG, state: { selected: { skin: 'skin_1' } } } },
            chibiStudio: {
                room: { state: { selected: { fronthair: 'f_1' } } },          // 纯 state 无图，原样保留
                like520: { img: IMG, state: { selected: {} } },                // 兜底大头贴
            },
            specialMomentRecords: {
                like520_2026: { customData: { charChibi: { dataUrl: IMG } } },
            },
        };
        extractImagesInPlace(char, () => 'assets/p.png');
        expect(char.avatar).toBe('assets/p.png');
        expect(char.sprites.chibi).toBe('assets/p.png');
        expect(char.vrState.chibi.img).toBe('assets/p.png');
        expect(char.chibiStudio.like520.img).toBe('assets/p.png');
        expect(char.specialMomentRecords.like520_2026.customData.charChibi.dataUrl).toBe('assets/p.png');
        // state（选件 JSON）不是图，不动
        expect(char.chibiStudio.room.state.selected.fronthair).toBe('f_1');
        expect(char.vrState.chibi.state.selected.skin).toBe('skin_1');
    });
});

describe('deepCloneForExport', () => {
    it('深拷贝后改副本不影响原对象', () => {
        const src = { theme: { wallpaper: IMG, nested: { x: 1 } } };
        const copy = deepCloneForExport(src);
        copy.theme.wallpaper = 'changed';
        copy.theme.nested.x = 999;
        expect(src.theme.wallpaper).toBe(IMG);
        expect(src.theme.nested.x).toBe(1);
    });
});

describe('sliceRanges / EXPORT_CHUNK_SIZE', () => {
    it('导出分片大小能被 3 整除（base64 拼接不插入中途补位）', () => {
        expect(EXPORT_CHUNK_SIZE % 3).toBe(0);
    });

    it('切出的区间连续且覆盖整段', () => {
        const ranges = sliceRanges(25, 10);
        expect(ranges).toEqual([[0, 10], [10, 20], [20, 25]]);
    });

    it('3 字节对齐的分片：各自 base64 后首尾相接，解码回来就是原始字节', () => {
        const bytes = new Uint8Array(50).map((_, i) => (i * 37) % 256);
        const concat = sliceRanges(bytes.length, 9) // 9 % 3 === 0
            .map(([s, e]) => Buffer.from(bytes.slice(s, e)).toString('base64'))
            .join('');
        const decoded = new Uint8Array(Buffer.from(concat, 'base64'));
        expect(Array.from(decoded)).toEqual(Array.from(bytes));
    });

    it('非 3 字节对齐的分片会在中途分片塞进 = 补位（这就是必须对齐的原因）', () => {
        const bytes = new Uint8Array(20).map((_, i) => i);
        const chunksB64 = sliceRanges(bytes.length, 10) // 10 % 3 !== 0
            .map(([s, e]) => Buffer.from(bytes.slice(s, e)).toString('base64'));
        // 非末尾分片带上了 '='，拼起来后整体就无法正确解码
        expect(chunksB64[0]).toContain('=');
    });
});
