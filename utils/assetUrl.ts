/**
 * GitHub 素材仓库（qegj567-cloud/SullyOS-assets）的统一出口 + 多 CDN 镜像兜底。
 *
 * 背景：房间底图 / 活动背景 / BGM 等素材托管在上面这个 GitHub 仓库，之前散落着
 * jsDelivr / raw.githubusercontent 的写死链接。单一 host 抽风时——jsDelivr 在大陆常被墙、
 * raw.githubusercontent 根本没 CDN 全球都慢——用户就「看不到图」。
 *
 * 这里把「仓库内相对路径」映射成一串跨【独立网络】的等价镜像；主源拉不到就自动换下一个。
 * 同一个文件在各 CDN 边缘字节完全一致，随便切、切了就好。
 *
 * 三种消费方式，各用对应工具（都在浏览器里跑，探测用 new Image()/<audio>）：
 *   · <img>          → components/os/CdnImg.tsx（onError 自动切镜像）
 *   · CSS background → useResilientAssetUrl(path)（JS 预探测，返回第一个能加载的 url 并触发重渲染）
 *   · new Audio()    → attachAudioMirrorFallback(audio, pathOrUrl)（error 事件切镜像）
 * 不需要运行时兜底的一次性场景（canvas 合成等）直接 assetUrl(path) 拿主源即可。
 *
 * 注：sharkpan 等第三方图床没有等价镜像，assetPathFromUrl 认不出会原样返回单条，
 * 想让它们也享受兜底得先把文件搬进这个 GitHub 仓库。
 */

import { useEffect, useMemo, useState } from 'react';

const ASSETS_REPO = 'qegj567-cloud/SullyOS-assets';
const ASSETS_REF = 'main';

const stripLead = (p: string) => p.replace(/^\/+/, '');

/** 仓库相对路径 → 一串跨独立网络的等价镜像 url（越靠前越优先）。 */
export function assetMirrors(path: string): string[] {
    const p = stripLead(path);
    return [
        `https://cdn.jsdelivr.net/gh/${ASSETS_REPO}@${ASSETS_REF}/${p}`,
        `https://fastly.jsdelivr.net/gh/${ASSETS_REPO}@${ASSETS_REF}/${p}`,
        `https://gcore.jsdelivr.net/gh/${ASSETS_REPO}@${ASSETS_REF}/${p}`,
        `https://cdn.statically.io/gh/${ASSETS_REPO}/${ASSETS_REF}/${p}`,
        `https://raw.githubusercontent.com/${ASSETS_REPO}/${ASSETS_REF}/${p}`,
    ];
}

/** 主源（mirror[0]）。给不需要运行时兜底的一次性场景。 */
export function assetUrl(path: string): string {
    return assetMirrors(path)[0];
}

/**
 * 把一个已知的完整素材 url（jsdelivr / statically / raw.githubusercontent 任意形态）反解回
 * 仓库相对路径，好让历史写死链接也能接进镜像兜底。认不出的（如 sharkpan 图床）返回 null。
 */
export function assetPathFromUrl(url: string): string | null {
    let m = url.match(/\/gh\/[^/]+\/[^/@]+@[^/]+\/(.+)$/);                     // jsdelivr @ref
    if (m) return m[1];
    m = url.match(/statically\.io\/gh\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);           // statically /ref/
    if (m) return m[1];
    m = url.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);  // raw /ref/
    if (m) return m[1];
    return null;
}

/** 把任意素材 url 归一成镜像链：认得的按仓库路径展开，认不得的原样单条返回。 */
export function mirrorsForUrl(url: string): string[] {
    const p = assetPathFromUrl(url);
    return p ? assetMirrors(p) : [url];
}

// ─── 运行时探测（浏览器）────────────────────────────────────────────────────
// 探测结果缓存（key=主源 url）：整个会话每个素材只探一次，命中直接复用。
const probed = new Map<string, string>();
const probing = new Map<string, Promise<string>>();

/** 依次尝试镜像，返回第一个能被浏览器成功加载为图片的 url。全挂则回退末位镜像。 */
export function loadFirstWorkingImage(mirrors: string[]): Promise<string> {
    if (!mirrors.length) return Promise.resolve('');
    const key = mirrors[0];
    const hit = probed.get(key);
    if (hit) return Promise.resolve(hit);
    const inflight = probing.get(key);
    if (inflight) return inflight;

    const run = (async () => {
        for (const url of mirrors) {
            const ok = await new Promise<boolean>((resolve) => {
                const img = new Image();
                img.onload = () => resolve(true);
                img.onerror = () => resolve(false);
                img.src = url;
            });
            if (ok) { probed.set(key, url); return url; }
        }
        const last = mirrors[mirrors.length - 1];
        probed.set(key, last); // 全挂：记末位，别每次重探
        return last;
    })();
    probing.set(key, run);
    run.finally(() => probing.delete(key));
    return run;
}

/**
 * CSS 背景专用 hook：给一个仓库路径，先同步返回主源（不留白），后台探测到能加载的镜像后
 * 切过去并触发重渲染。path 为空返回空字符串。
 */
export function useResilientAssetUrl(path: string | null | undefined): string {
    const mirrors = useMemo(() => (path ? assetMirrors(path) : []), [path]);
    const [url, setUrl] = useState<string>(() => mirrors[0] ?? '');
    useEffect(() => {
        if (!mirrors.length) { setUrl(''); return; }
        setUrl(mirrors[0]);
        let alive = true;
        loadFirstWorkingImage(mirrors).then((ok) => { if (alive && ok) setUrl(ok); });
        return () => { alive = false; };
    }, [mirrors]);
    return url;
}

/**
 * 给 JS 构造的 <audio> 挂 CDN 镜像兜底：设好首源，加载/播放报错就切下一个镜像重试，
 * 全挂才罢休。返回解绑函数（调用它会移除监听，元素复用换曲前先解绑旧的，避免监听堆叠）。
 * pathOrUrl 可为仓库相对路径或完整素材 url。
 */
export function attachAudioMirrorFallback(audio: HTMLAudioElement, pathOrUrl: string): () => void {
    const mirrors = pathOrUrl.includes('://') ? mirrorsForUrl(pathOrUrl) : assetMirrors(pathOrUrl);
    let idx = 0;
    audio.src = mirrors[0];
    const onError = () => {
        if (idx >= mirrors.length - 1) return; // 镜像用尽，认栽
        idx++;
        const wasPlaying = !audio.paused;
        audio.src = mirrors[idx];
        audio.load();
        if (wasPlaying) audio.play().catch(() => { /* 自动播放策略拦截：静待用户交互 */ });
    };
    audio.addEventListener('error', onError);
    return () => audio.removeEventListener('error', onError);
}
