import { describe, it, expect } from 'vitest';
import { planBuiltinPartsPack, safePartSlug, type BuiltinPackItem } from './builtinPartsPack';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PAYLOAD = PNG.split(',')[1];

describe('safePartSlug', () => {
    it('保留字母数字/中文/连字符，其余折下划线，空回落 part', () => {
        expect(safePartSlug('刘海 A')).toBe('刘海_A');
        expect(safePartSlug('a/b:c')).toBe('a_b_c');
        expect(safePartSlug('')).toBe('part');
        expect(safePartSlug('   ')).toBe('part');
    });
});

describe('planBuiltinPartsPack', () => {
    it('data: 图抽成 parts/<id>.png，清单 src 写相对路径；含投影', () => {
        const items: BuiltinPackItem[] = [
            { categoryKey: 'fronthair', name: '刘海', src: PNG, shadowSrc: PNG, tintable: true },
        ];
        const { manifest, files, skipped } = planBuiltinPartsPack(items);
        expect(skipped).toBe(0);
        expect(manifest).toHaveLength(1);
        expect(manifest[0].id).toBe('fronthair_刘海');
        expect(manifest[0].src).toBe('parts/fronthair_刘海.png');
        expect(manifest[0].shadowSrc).toBe('parts/fronthair_刘海_shadow.png');
        expect(manifest[0].tintable).toBe(true);
        // 两个文件：图 + 投影，base64 只含负载
        expect(files).toHaveLength(2);
        expect(files.find(f => f.path === 'parts/fronthair_刘海.png')!.base64).toBe(PAYLOAD);
        expect(files.find(f => f.path === 'parts/fronthair_刘海_shadow.png')!.base64).toBe(PAYLOAD);
    });

    it('重名自动 _2/_3，id 与文件名唯一', () => {
        const items: BuiltinPackItem[] = [
            { categoryKey: 'eyes', name: '大眼', src: PNG },
            { categoryKey: 'eyes', name: '大眼', src: PNG },
            { categoryKey: 'eyes', name: '大眼', src: PNG },
        ];
        const { manifest, files } = planBuiltinPartsPack(items);
        const ids = manifest.map(m => m.id);
        expect(ids).toEqual(['eyes_大眼', 'eyes_大眼_2', 'eyes_大眼_3']);
        expect(new Set(files.map(f => f.path)).size).toBe(3); // 无覆盖
    });

    it('http URL 原样保留、不落文件；缺类目的跳过', () => {
        const items: BuiltinPackItem[] = [
            { categoryKey: 'skin', name: '远程', src: 'https://a.com/s.png' },
            { categoryKey: null, name: '没类目', src: PNG },
        ];
        const { manifest, files, skipped } = planBuiltinPartsPack(items);
        expect(skipped).toBe(1);
        expect(manifest).toHaveLength(1);
        expect(manifest[0].src).toBe('https://a.com/s.png');
        expect(files).toHaveLength(0);
    });
});
