// 图片 Blob 引用层（base64 → Blob 迁移的核心）。
//
// 背景：本项目图片历来以 base64 data URL 直接存进 IndexedDB / CharacterProfile。base64 比
// 原始二进制大 ~33%，且作为 JS 字符串常驻内存（React state / <img src> 里都拖着整段），
// 壁纸、小屋（RoomApp）这类大图尤其吃配额和内存。
//
// 方案：图片二进制存进 blob_assets store（IndexedDB 原生支持 Blob），字段里只存一个短
// 令牌 `blobref:<id>`。这样：
//   · 字段仍是 string —— CharacterProfile / 各 store 记录仍可 JSON 安全序列化、结构化克隆；
//   · 渲染时把令牌解析成 objectURL（URL.createObjectURL）喂给 <img>/CSS 背景，并管好回收；
//   · 备份导出前把令牌解析回 data URL，复用既有「data:image → zip assets/*」抽取管线，
//     备份格式与可移植性完全不变（见 context/OSContext.tsx 导出/导入）。
//
// 兼容：旧值（`data:...` / `http(s)://...` / CSS 渐变字符串）一律原样透传，永远能渲染；
// 惰性迁移由各消费方（壁纸加载、进入小屋）在读到 data: 时顺手 put 成 Blob 完成。

import { useEffect, useState } from 'react';
import { DB } from './db';
import type { AppearancePreset } from '../types';

export const BLOBREF_PREFIX = 'blobref:';

// 用带品牌的 string 子类型做类型守卫：正分支收窄成 BlobRef，负分支仍保留 string
// （若直接用 `v is string`，对本就是 string 的入参，否定分支会被收窄成 never）。
export type BlobRef = string & { readonly __blobRef: unique symbol };

/** 是否是 blobref 令牌。 */
export const isBlobRef = (v: unknown): v is BlobRef =>
    typeof v === 'string' && v.startsWith(BLOBREF_PREFIX);

const idOfRef = (ref: string): string => ref.slice(BLOBREF_PREFIX.length);

let seq = 0;
const genId = (): string =>
    `img_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** 把 Blob 存进 blob_assets，返回 `blobref:<id>` 令牌。 */
export async function putImageBlob(blob: Blob): Promise<string> {
    const id = genId();
    await DB.putBlobAsset(id, blob);
    return BLOBREF_PREFIX + id;
}

/** 读取令牌对应的 Blob（非令牌或不存在返回 null）。 */
export async function getBlobForRef(ref: string): Promise<Blob | null> {
    if (!isBlobRef(ref)) return null;
    try {
        return await DB.getBlobAsset(idOfRef(ref));
    } catch {
        return null;
    }
}

/**
 * 删除令牌对应的 Blob（best-effort）。
 * 注意：同一令牌可能被多处引用（小屋自定义素材的 image 会被复制进摆放的 item.image），
 * 所以调用方需自行确认无人再引用后才删，否则会删出「碎图」。当前消费方从简：不主动删，
 * 残留孤儿 Blob 由后续 GC 处理，宁可占一点空间也不冒破图风险。
 */
export async function deleteBlobRef(ref: string | undefined | null): Promise<void> {
    if (ref && isBlobRef(ref)) {
        try { await DB.deleteBlobAsset(idOfRef(ref)); } catch { /* ignore */ }
    }
}

/**
 * 仅在令牌已不再被持久化设置引用时删除 Blob。
 *
 * 壁纸、锁屏和外观预设可能共享同一令牌；直接在换图时 delete 会让预设或“切回默认”备份
 * 变成死图。这里检查 assets（含 appearance_preset_* JSON）和 localStorage（含皮肤壁纸备份）
 * 后再清理。读取引用表失败时宁可保留，也绝不冒险删图。
 */
export async function deleteBlobRefIfUnreferenced(ref: string | undefined | null): Promise<boolean> {
    if (!ref || !isBlobRef(ref)) return false;

    try {
        const assets = await DB.getAllAssets();
        if (assets.some(asset => typeof asset.data === 'string' && asset.data.includes(ref))) {
            return false;
        }
    } catch {
        return false;
    }

    try {
        if (typeof localStorage !== 'undefined') {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (localStorage.getItem(key)?.includes(ref)) return false;
            }
        }
    } catch {
        return false;
    }

    await deleteBlobRef(ref);
    return true;
}

// ─── data URL ⇄ Blob 互转 ───────────────────────────────────────

/** `data:<mime>;base64,xxxx` → Blob。非 base64 data URL 会抛错。 */
export function dataUrlToBlob(dataUrl: string): Blob {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error('Invalid data URL');
    const header = dataUrl.slice(0, comma);
    const mimeMatch = header.match(/^data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    if (!/;base64/i.test(header)) {
        // 非 base64（极少见，如 utf8 编码的 svg），退化成 UTF-8 编码。
        return new Blob([decodeURIComponent(dataUrl.slice(comma + 1))], { type: mime });
    }
    const binary = atob(dataUrl.slice(comma + 1));
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/**
 * Blob → `data:<mime>;base64,xxxx`。浏览器主线程走 FileReader（高效）；
 * 没有 FileReader 的环境（Worker / Node 测试）退化到 arrayBuffer + base64 手编。
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
    if (typeof FileReader !== 'undefined') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error || new Error('blobToDataUrl failed'));
            reader.readAsDataURL(blob);
        });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const CHUNK = 0x8000; // 分块拼字符串，避开 String.fromCharCode 的参数上限
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const mime = blob.type || 'application/octet-stream';
    return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * 把一个 data: 图片存成 Blob 并返回令牌（惰性迁移用）。转换失败时回退返回原字符串，
 * 保证调用方永远拿到一个可渲染的值，不会因迁移失败而丢图。
 */
export async function migrateDataUrlToRef(dataUrl: string): Promise<string> {
    try {
        return await putImageBlob(dataUrlToBlob(dataUrl));
    } catch {
        return dataUrl;
    }
}

/**
 * 外观预设导入专用迁移：只转换已经接入 BlobRef 渲染链路的字段，其他 data URL 保持原状。
 * cache 让同一张原图在壁纸、锁屏或多个图标中复用同一个 Blob，避免导入时重复占空间。
 */
export async function migrateAppearancePresetBlobRefs(
    preset: AppearancePreset,
    cache: Map<string, string> = new Map<string, string>(),
): Promise<AppearancePreset> {
    const migrate = async (value: string | undefined): Promise<string | undefined> => {
        if (!value?.startsWith('data:')) return value;
        const cached = cache.get(value);
        if (cached) return cached;
        const stored = await migrateDataUrlToRef(value);
        cache.set(value, stored);
        return stored;
    };

    const theme = { ...preset.theme };
    theme.wallpaper = (await migrate(theme.wallpaper)) || theme.wallpaper;
    if ('lockWallpaper' in theme) theme.lockWallpaper = await migrate(theme.lockWallpaper);

    let customIcons = preset.customIcons;
    if (customIcons) {
        customIcons = {};
        for (const [appId, icon] of Object.entries(preset.customIcons || {})) {
            customIcons[appId] = (await migrate(icon)) || icon;
        }
    }

    return { ...preset, theme, customIcons };
}

/**
 * 把单个值从令牌解析成可直接用的 data URL（读 Blob → base64）；非令牌原样返回。
 * 用在必须拿 base64 字符串的消费点（如跨 iframe postMessage 的捏人器部件）。
 * Blob 已丢时返回空串（避免把死令牌当 img src 用）。
 */
export async function resolveRefToDataUrl(value: string): Promise<string> {
    if (!isBlobRef(value)) return value;
    const blob = await getBlobForRef(value);
    return blob ? blobToDataUrl(blob) : '';
}

/**
 * 深度遍历对象树，把所有 `blobref:<id>` 字符串原地替换成对应的 data URL（读 Blob 转 base64）。
 * 备份导出前调用，令牌随之变回 data:image，交给既有 zip 抽取管线处理。解析不到的令牌置空串
 * （图已丢，避免导出一个恢复端认不得的死令牌）。原地修改传入对象，调用方须传独立副本。
 */
export async function resolveBlobRefsDeep(root: unknown): Promise<void> {
    if (root === null || typeof root !== 'object') return;
    const hits: Array<{ container: any; key: string | number; ref: string }> = [];
    const seen = new WeakSet<object>();
    const stack: object[] = [root as object];
    while (stack.length) {
        const node = stack.pop()!;
        if (seen.has(node)) continue;
        seen.add(node);
        const entries: Array<[string | number, unknown]> = Array.isArray(node)
            ? node.map((v, i) => [i, v])
            : Object.keys(node).map(k => [k, (node as any)[k]]);
        for (const [key, v] of entries) {
            if (isBlobRef(v)) {
                hits.push({ container: node, key, ref: v });
            } else if (v !== null && typeof v === 'object') {
                stack.push(v as object);
            }
        }
    }
    if (!hits.length) return;
    // 同一令牌只读一次。
    const cache = new Map<string, string>();
    for (const { container, key, ref } of hits) {
        let dataUrl = cache.get(ref);
        if (dataUrl === undefined) {
            const blob = await getBlobForRef(ref);
            dataUrl = blob ? await blobToDataUrl(blob) : '';
            cache.set(ref, dataUrl);
        }
        container[key] = dataUrl;
    }
}

// ─── React 渲染 hook ────────────────────────────────────────────

/**
 * 把一个图片字段值解析成可直接用于 <img src>/CSS url() 的字符串。
 *   · blobref 令牌 → 读 Blob 建 objectURL，组件卸载 / value 变化时 revoke，绝不泄漏；
 *   · 其它（data: / http(s) / 渐变 / undefined）→ 原样返回。
 * 令牌解析前返回 undefined（首帧可能无图，等 Blob 读出后再渲染，属预期）。
 */
export function useBlobRefUrl(value: string | undefined | null): string | undefined {
    const [url, setUrl] = useState<string | undefined>(
        isBlobRef(value) ? undefined : (value ?? undefined)
    );

    useEffect(() => {
        if (!isBlobRef(value)) {
            setUrl(value ?? undefined);
            return;
        }
        let alive = true;
        let objUrl: string | undefined;
        getBlobForRef(value).then(blob => {
            if (!alive) return;
            if (blob) {
                objUrl = URL.createObjectURL(blob);
                setUrl(objUrl);
            } else {
                setUrl(undefined);
            }
        });
        return () => {
            alive = false;
            if (objUrl) URL.revokeObjectURL(objUrl);
        };
    }, [value]);

    return url;
}
