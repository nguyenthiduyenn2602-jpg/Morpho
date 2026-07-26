import { describe, it, expect } from 'vitest';
import { assetMirrors, assetUrl, assetPathFromUrl, mirrorsForUrl } from './assetUrl';

describe('assetMirrors', () => {
    it('主源是 jsDelivr，末位兜底是 raw.githubusercontent', () => {
        const m = assetMirrors('img/MOON.png');
        expect(m[0]).toBe('https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/img/MOON.png');
        expect(m[m.length - 1]).toBe('https://raw.githubusercontent.com/qegj567-cloud/SullyOS-assets/main/img/MOON.png');
    });

    it('镜像跨多个独立网络，无重复', () => {
        const m = assetMirrors('bgm/POEM/A01.mp3');
        expect(m.length).toBeGreaterThanOrEqual(4);
        expect(new Set(m).size).toBe(m.length);
        expect(m.every(u => u.endsWith('bgm/POEM/A01.mp3'))).toBe(true);
    });

    it('吃掉路径前导斜杠，不产生 // ', () => {
        expect(assetMirrors('/img/x.png')[0]).toBe(assetMirrors('img/x.png')[0]);
    });

    it('assetUrl 就是主源', () => {
        expect(assetUrl('img/x.png')).toBe(assetMirrors('img/x.png')[0]);
    });
});

describe('assetPathFromUrl', () => {
    it('反解 jsDelivr @ref 链接', () => {
        expect(assetPathFromUrl('https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/img/MOON.png'))
            .toBe('img/MOON.png');
    });
    it('反解 raw.githubusercontent 链接', () => {
        expect(assetPathFromUrl('https://raw.githubusercontent.com/qegj567-cloud/SullyOS-assets/main/img/BOOK.png'))
            .toBe('img/BOOK.png');
    });
    it('反解 statically 链接', () => {
        expect(assetPathFromUrl('https://cdn.statically.io/gh/qegj567-cloud/SullyOS-assets/main/bgm/letter/1.mp3'))
            .toBe('bgm/letter/1.mp3');
    });
    it('反解带子目录的深路径', () => {
        expect(assetPathFromUrl('https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/img/DREAMS/a%20b.png'))
            .toBe('img/DREAMS/a%20b.png');
    });
    it('认不出的第三方图床返回 null', () => {
        expect(assetPathFromUrl('https://sharkpan.xyz/f/BZ3VSa/head.png')).toBeNull();
    });
});

describe('mirrorsForUrl', () => {
    it('已知素材 url 展开成完整镜像链', () => {
        const m = mirrorsForUrl('https://raw.githubusercontent.com/qegj567-cloud/SullyOS-assets/main/img/BOOK.png');
        expect(m[0]).toBe('https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/img/BOOK.png');
        expect(m.length).toBeGreaterThanOrEqual(4);
    });
    it('认不出的 url 原样单条返回（不误伤第三方图床）', () => {
        const u = 'https://sharkpan.xyz/f/BZ3VSa/head.png';
        expect(mirrorsForUrl(u)).toEqual([u]);
    });
});
