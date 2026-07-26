import { describe, it, expect } from 'vitest';
import { rewriteSharkpanUrls, SHARKPAN_ASSET_MAP } from './sharkpanAssetMigration';

const JSD = 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/';

describe('rewriteSharkpanUrls', () => {
    it('已知鲨盘链接改写成 bgm/SULLY 下的 jsDelivr', () => {
        expect(rewriteSharkpanUrls('https://sharkpan.xyz/f/pWg6HQ/night.png')).toBe(JSD + 'night.png');
        expect(rewriteSharkpanUrls('https://sharkpan.xyz/f/A3XeUZ/BED.png')).toBe(JSD + 'BED.png');
        expect(rewriteSharkpanUrls('https://sharkpan.xyz/f/xl8muX/VBl.png')).toBe(JSD + 'VBl.png');
    });

    it('深层嵌套（角色 JSON）里的多处链接一次全改', () => {
        const char = JSON.stringify({
            sprites: { normal: 'https://sharkpan.xyz/f/w3QQFq/01.png', chibi: 'https://sharkpan.xyz/f/oWZQF4/S2.png' },
            roomConfig: { wallImage: 'https://sharkpan.xyz/f/NdJyhv/b.png', items: [{ image: 'https://sharkpan.xyz/f/A3XeUZ/BED.png' }] },
        });
        const out = rewriteSharkpanUrls(char);
        expect(out).not.toContain('sharkpan.xyz');
        const parsed = JSON.parse(out);
        expect(parsed.sprites.normal).toBe(JSD + '01.png');
        expect(parsed.roomConfig.items[0].image).toBe(JSD + 'BED.png');
    });

    it('不碰未收录的链接：bank 背景 bg.png / head.png / 用户自传图', () => {
        const keep = 'https://sharkpan.xyz/f/5n1gSj/bg.png';
        expect(rewriteSharkpanUrls(keep)).toBe(keep);
        expect(rewriteSharkpanUrls('https://sharkpan.xyz/f/BZ3VSa/head.png')).toBe('https://sharkpan.xyz/f/BZ3VSa/head.png');
        expect(rewriteSharkpanUrls('https://i.example.com/my-custom.png')).toBe('https://i.example.com/my-custom.png');
    });

    it('无鲨盘链接原样返回', () => {
        expect(rewriteSharkpanUrls('hello world')).toBe('hello world');
        expect(rewriteSharkpanUrls('')).toBe('');
    });

    it('映射表覆盖 30 条（31 张去掉 bank bg），且都指向 bgm/SULLY', () => {
        expect(Object.keys(SHARKPAN_ASSET_MAP).length).toBe(30);
        expect(Object.values(SHARKPAN_ASSET_MAP).every(u => u.startsWith(JSD))).toBe(true);
        // 确保不含用户不迁的 bank 背景
        expect(Object.keys(SHARKPAN_ASSET_MAP)).not.toContain('https://sharkpan.xyz/f/5n1gSj/bg.png');
    });
});
