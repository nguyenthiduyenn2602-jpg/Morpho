// 捏人器（彼方 / 520 共用的 chibi 捏脸系统）自定义部件的 base64 ⇄ Blob 桥。
//
// 部件（CustomCreatorPart.src / shadowSrc）历来是 base64 PNG 存进 cc_custom_parts store，
// PSD 整批导入一次能塞几十个，很吃 IndexedDB 配额。这里把「存储」改成 Blob（blobref 令牌），
// 而「消费」侧仍要 base64——因为部件要跨 iframe（character_creator.html）用 postMessage 注入，
// iframe 里直接 `<img src="${it.src}">`。所以：落库转令牌、读出转回 base64，iframe 契约不动。
//
// 内置素材不经这里：它们是 base64 内嵌在 character_creator.html 静态文件里，走 bundle / HTTP
// 缓存，不占 IndexedDB，无需也无法转。

import type { CustomCreatorPart } from '../types';
import { isBlobRef, migrateDataUrlToRef, resolveRefToDataUrl } from './blobRef';
import { DB } from './db';

/** 落库前：把 base64 的 src / shadowSrc 转成 blobref 令牌（已是令牌 / http 的原样保留）。 */
export async function creatorPartToBlobRefs(part: CustomCreatorPart): Promise<CustomCreatorPart> {
    const out: CustomCreatorPart = { ...part };
    if (out.src && out.src.startsWith('data:')) out.src = await migrateDataUrlToRef(out.src);
    if (out.shadowSrc && out.shadowSrc.startsWith('data:')) out.shadowSrc = await migrateDataUrlToRef(out.shadowSrc);
    return out;
}

/**
 * 读取供渲染 / 注入 iframe：返回 src / shadowSrc 已解析成 base64 的部件列表。
 * 顺手把仍是 base64 的存量部件惰性迁移成 Blob 令牌落库（存量省配额，只跑一次）。
 */
export async function loadCreatorPartsForRender(): Promise<CustomCreatorPart[]> {
    const parts = await DB.getCustomCreatorParts();
    const out: CustomCreatorPart[] = [];
    for (const p of parts) {
        let dbSrc = p.src;
        let dbShadow = p.shadowSrc;
        let migrated = false;
        // 存量 data: → 令牌（落库），迁移失败时保持原值不丢图
        if (dbSrc && dbSrc.startsWith('data:')) {
            const r = await migrateDataUrlToRef(dbSrc);
            if (isBlobRef(r)) { dbSrc = r; migrated = true; }
        }
        if (dbShadow && dbShadow.startsWith('data:')) {
            const r = await migrateDataUrlToRef(dbShadow);
            if (isBlobRef(r)) { dbShadow = r; migrated = true; }
        }
        if (migrated) {
            try { await DB.saveCustomCreatorPart({ ...p, src: dbSrc, shadowSrc: dbShadow }); } catch { /* ignore */ }
        }
        // 解析成 base64 供 <img> / iframe 用
        out.push({
            ...p,
            src: await resolveRefToDataUrl(dbSrc),
            shadowSrc: dbShadow ? await resolveRefToDataUrl(dbShadow) : undefined,
        });
    }
    return out;
}
