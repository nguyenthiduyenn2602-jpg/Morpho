import { describe, it, expect } from 'vitest';
import { DB } from './db';
import { isBlobRef } from './blobRef';
import { creatorPartToBlobRefs, loadCreatorPartsForRender } from './creatorPartsBlob';
import type { CustomCreatorPart } from '../types';

// 捏人器自定义部件 base64 ⇄ Blob 桥：落库转令牌、读出转回 base64、存量惰性迁移。

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('creatorPartToBlobRefs（落库转令牌）', () => {
    it('base64 的 src / shadowSrc 转成 blobref 令牌，其它字段不动', async () => {
        const part: CustomCreatorPart = {
            id: 'fronthair_cc_test1', categoryKey: 'fronthair', name: '测试前发',
            src: TINY_PNG, shadowSrc: TINY_PNG, tintable: true, createdAt: 123,
        };
        const stored = await creatorPartToBlobRefs(part);
        expect(isBlobRef(stored.src)).toBe(true);
        expect(isBlobRef(stored.shadowSrc!)).toBe(true);
        expect(stored.id).toBe('fronthair_cc_test1');
        expect(stored.tintable).toBe(true);
        expect(stored.categoryKey).toBe('fronthair');
    });

    it('http / 已是令牌的值原样保留', async () => {
        const part: CustomCreatorPart = {
            id: 'x', categoryKey: 'skin', name: 's', src: 'https://a.com/b.png', createdAt: 0,
        };
        const stored = await creatorPartToBlobRefs(part);
        expect(stored.src).toBe('https://a.com/b.png');
    });
});

describe('loadCreatorPartsForRender（读出转回 base64 + 存量迁移）', () => {
    it('库里存令牌 → 读出解析成 base64；存量 data: 惰性迁移成令牌', async () => {
        // 先塞一个「令牌形态」的部件
        const stored = await creatorPartToBlobRefs({
            id: 'eyes_cc_a', categoryKey: 'eyes', name: '眼', src: TINY_PNG, createdAt: 1,
        });
        await DB.saveCustomCreatorPart(stored);
        // 再塞一个「存量 base64 形态」的旧部件
        await DB.saveCustomCreatorPart({
            id: 'mouth_cc_b', categoryKey: 'mouth', name: '嘴', src: TINY_PNG, createdAt: 2,
        });

        const rendered = await loadCreatorPartsForRender();
        const a = rendered.find(p => p.id === 'eyes_cc_a')!;
        const b = rendered.find(p => p.id === 'mouth_cc_b')!;
        // 读出的都是可直接 <img> 的 base64
        expect(a.src).toBe(TINY_PNG);
        expect(b.src).toBe(TINY_PNG);

        // 存量旧部件应已在库里被迁成令牌
        const raw = await DB.getCustomCreatorParts();
        const rawB = raw.find(p => p.id === 'mouth_cc_b')!;
        expect(isBlobRef(rawB.src)).toBe(true);
    });
});
