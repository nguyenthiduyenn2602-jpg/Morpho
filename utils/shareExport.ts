import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface ShareOrDownloadOptions {
    /** 文件文本内容（目前导出都是文本，如 JSON / txt）。 */
    content: string;
    /** 带扩展名的文件名，如 `worldbook.json`。 */
    fileName: string;
    /** MIME 类型，默认 `application/json`。 */
    mimeType?: string;
    /** 系统 / Web 分享面板标题，默认取文件名。 */
    shareTitle?: string;
}

export interface ShareOrDownloadBlobOptions {
    blob: Blob;
    fileName: string;
    shareTitle?: string;
}

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        if (comma < 0) reject(new Error('文件编码失败'));
        else resolve(dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsDataURL(blob);
});

const base64ToBlob = (value: string, mimeType: string): Blob => {
    const base64 = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
};

/** Fetch a downloadable blob, using native HTTP as a CORS-free fallback in Capacitor. */
export async function fetchBlobForShare(sourceUrl: string, fallbackMimeType = 'application/octet-stream'): Promise<Blob> {
    try {
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.size) throw new Error('文件为空');
        return blob;
    } catch (webError) {
        if (!Capacitor.isNativePlatform() || !/^https?:\/\//i.test(sourceUrl)) throw webError;
        const response = await CapacitorHttp.request({ url: sourceUrl, method: 'GET', responseType: 'blob' });
        if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
        const blob = base64ToBlob(String(response.data || ''), String(response.headers?.['content-type'] || fallbackMimeType));
        if (!blob.size) throw new Error('文件为空');
        return blob;
    }
}

/**
 * 保存二进制媒体：原生壳写缓存并调系统分享，移动浏览器优先 Web Share，
 * 桌面浏览器才使用 a.download。WebView 普遍不可靠的裸 download 点击只作为末级兜底。
 */
export async function shareOrDownloadBlob(options: ShareOrDownloadBlobOptions): Promise<'shared' | 'downloaded' | 'cancelled'> {
    const { blob, fileName, shareTitle = fileName } = options;
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error('文件为空，无法保存');

    if (Capacitor.isNativePlatform()) {
        try {
            await Filesystem.writeFile({
                path: fileName,
                data: await blobToBase64(blob),
                directory: Directory.Cache,
            });
            const uriResult = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
            await Share.share({ title: shareTitle, files: [uriResult.uri] });
            return 'shared';
        } catch (error: any) {
            if (error?.name === 'AbortError') return 'cancelled';
            console.error('Native Blob Share Error', error);
        }
    }

    try {
        const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
        const canShareFile = typeof navigator !== 'undefined'
            && typeof navigator.share === 'function'
            && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
        if (canShareFile) {
            await navigator.share({ title: shareTitle, files: [file] });
            return 'shared';
        }
    } catch (error: any) {
        if (error?.name === 'AbortError') return 'cancelled';
        console.error('Web Blob Share Error', error);
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
}

/**
 * 强制拉起分享的文件导出：原生（Capacitor Share）→ Web Share API → 浏览器下载兜底。
 *
 * SullyOS 常被包成移动端 WebView / 原生壳，这类环境里 `<a download>` 往往不触发任何东西，
 * 直接下载会「点了没反应 = 导不出来」。所以先尝试调起系统 / 浏览器的分享面板把文件送出去，
 * 只有在既没有原生分享、也没有 Web Share 能力时，才退回到浏览器下载。
 *
 * 与 apps/Character.tsx 的角色卡导出保持一致的三级兜底策略。
 *
 * @returns `'shared'` 已调起分享面板；`'downloaded'` 走了浏览器下载兜底。
 */
export async function shareOrDownloadFile(options: ShareOrDownloadOptions): Promise<'shared' | 'downloaded'> {
    const { content, fileName, mimeType = 'application/json', shareTitle = fileName } = options;

    // 1) 原生平台：写缓存 → 取 URI → 调起系统分享面板。
    if (Capacitor.isNativePlatform()) {
        try {
            await Filesystem.writeFile({
                path: fileName,
                data: content,
                directory: Directory.Cache,
                encoding: Encoding.UTF8,
            });
            const uriResult = await Filesystem.getUri({
                directory: Directory.Cache,
                path: fileName,
            });
            await Share.share({
                title: shareTitle,
                files: [uriResult.uri],
            });
            return 'shared';
        } catch (e) {
            // 原生分享失败 → 落到 Web 分享 / 下载兜底。
            console.error('Native Export Error', e);
        }
    }

    // 2) Web Share API（移动端浏览器 / 支持的 WebView）。
    try {
        const file = new File([content], fileName, { type: mimeType });
        const canShareFile = typeof navigator !== 'undefined'
            && typeof navigator.share === 'function'
            && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));

        if (canShareFile) {
            await navigator.share({
                title: shareTitle,
                files: [file],
            });
            return 'shared';
        }
    } catch (e: any) {
        // 用户取消（AbortError）与不支持的情况都继续走下载兜底，保证一定能拿到文件。
        if (e?.name !== 'AbortError') {
            console.error('Web Share Export Error', e);
        }
    }

    // 3) 浏览器下载兜底。
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return 'downloaded';
}
