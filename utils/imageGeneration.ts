import type {
    CharacterImageGenerationConfig,
    CharacterProfile,
    ImageGenerationApiConfig,
    UserProfile,
} from '../types';
import type { Message } from '../types';
import { DB } from './db';
import { putImageBlob } from './blobRef';

export const DEFAULT_IMAGE_API_URL = 'https://open.mxapi.org';
export const DEFAULT_IMAGE_CHANNEL = 'default' as const;
export const IMAGE_POLL_INTERVAL_MS = 5_000;
export const IMAGE_POLL_MAX_ATTEMPTS = 120;
export const IMAGE_GENERATION_OPEN = '[[GENERATE_IMAGE]]';
export const IMAGE_GENERATION_CLOSE = '[[/GENERATE_IMAGE]]';

export interface ImageGenerationDirective {
    prompt: string;
    selfie: boolean;
}

const DIRECTIVE_RE = /\[\[GENERATE_IMAGE\]\]\s*([\s\S]*?)\s*\[\[\/GENERATE_IMAGE\]\]/i;

export function normalizeImageApiBase(value: string): string {
    const base = (value || DEFAULT_IMAGE_API_URL).trim().replace(/\/+$/, '');
    return base.replace(/\/api\/v[12](?:\/.*)?$/i, '');
}

/** FNV-1a；只用于判断绿灯是否仍对应当前配置，不是安全散列。 */
export function imageApiSignature(config: Pick<ImageGenerationApiConfig, 'baseUrl' | 'apiKey' | 'channel'>): string {
    const input = `${normalizeImageApiBase(config.baseUrl)}\u0000${config.channel}\u0000${config.apiKey}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isImageApiVerified(config?: ImageGenerationApiConfig): boolean {
    return !!(
        config?.verifiedAt
        && config.verifiedSignature
        && config.verifiedSignature === imageApiSignature(config)
    );
}

export async function testImageApiConnection(config: ImageGenerationApiConfig): Promise<void> {
    if (!config.apiKey.trim()) throw new Error('请先填写 API Key');
    const response = await fetch(`${normalizeImageApiBase(config.baseUrl)}/api/v2/points/balance`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
    });
    if (!response.ok) throw new Error(await readApiError(response, `连接失败（HTTP ${response.status}）`));
    const data = await response.json().catch(() => null);
    if (data?.code !== 200 || !data?.data) throw new Error(data?.message || '连接成功，但余额接口返回格式不正确');
}

/** 默认关闭主动发图时的客户端保险丝：只允许最新用户消息明确索图。 */
export function isExplicitImageRequest(text: string): boolean {
    const value = (text || '').trim();
    if (!value) return false;
    return /(?:生图|(?:拍|发|来|给|传|生成|画).{0,8}(?:自拍|照片|相片|图片|张图|一张)|(?:想|要|让我|给我).{0,8}(?:看|看看).{0,8}(?:你|样子|照片|自拍)|看看.{0,6}(?:你|样子)|(?:自拍|照片|相片).{0,5}(?:给我|发我|看看)|show\s+me|send\s+(?:me\s+)?(?:a\s+)?(?:selfie|photo|picture)|take\s+(?:a\s+)?(?:selfie|photo|picture))/i.test(value);
}

export function buildImageGenerationDecisionPrompt(
    char: CharacterProfile,
    userProfile: UserProfile,
): string {
    const cfg = char.imageGeneration;
    if (!cfg?.enabled) return '';
    const proactiveRule = cfg.allowProactive
        ? `当 ${userProfile.name} 在最新一条消息中明确要求看照片、自拍或要求生成图片时，必须使用。除此之外你也可以极低频地主动发图，但只在当前情境下真的自然、有意义时使用；不要连续两轮发图，也不要把发图当成固定节目。`
        : `当 ${userProfile.name} 在最新一条消息中明确要求看照片、自拍或要求生成图片时，必须使用；除此之外绝不能使用。仅仅谈到图片、外貌或旧照片不算请求。你绝不能主动发图。`;
    return `
## 本地私聊生图工具（严格规则）
你可以决定是否给 ${userProfile.name} 发一张图片。${proactiveRule}

需要发图时，先以角色当前的语气自然回复 ${userProfile.name}，可以是一至三个简短气泡；然后在回复末尾附加下面的控制块。控制块不会显示给用户，不要在正文中解释工具、API 或提示词：
${IMAGE_GENERATION_OPEN}
{"prompt":"用简洁、可视化的语言描述画面、环境、表情、姿势、镜头和光线；不要重复人物固定长相","selfie":true}
${IMAGE_GENERATION_CLOSE}

- selfie=true：自拍或明显由角色自己拍摄的照片；其他画面填 false。
- prompt 只描述本轮聊天决定出的画面。人物身份、发型发色、瞳色与参考脸由客户端固定提供，你不要自行改写。
- 不需要发图时正常聊天，绝不输出上述控制块，也不要谈论这个工具。`;
}

export function extractImageGenerationDirective(raw: string): {
    directive: ImageGenerationDirective | null;
    cleaned: string;
} {
    const match = (raw || '').match(DIRECTIVE_RE);
    if (!match) return { directive: null, cleaned: raw };
    let directive: ImageGenerationDirective | null = null;
    try {
        const parsed = JSON.parse(match[1]);
        const prompt = typeof parsed?.prompt === 'string' ? parsed.prompt.trim() : '';
        if (prompt) directive = { prompt: prompt.slice(0, 2000), selfie: parsed?.selfie !== false };
    } catch { /* malformed controls are stripped but never executed */ }
    return { directive, cleaned: raw.replace(DIRECTIVE_RE, '').trim() };
}

export function stripImageGenerationDirectives(raw: string): string {
    return (raw || '').replace(DIRECTIVE_RE, '').trim();
}

function buildGenerationPrompt(
    char: CharacterProfile,
    cfg: CharacterImageGenerationConfig,
    request: ImageGenerationDirective,
    hasReference: boolean,
): string {
    const anchors = cfg.appearanceAnchors?.trim() || 'Follow the established character identity consistently.';
    return `Create one polished, natural-looking image of ${char.name}.

IDENTITY ANCHORS:
${anchors}

SCENE REQUEST:
${request.prompt}

IDENTITY PRIORITY:
${hasReference
    ? 'The supplied reference image is the primary identity reference. Preserve the same recognizable face, facial proportions, eyes, nose, mouth, face shape and overall identity. Do not replace the person with a merely similar-looking person.'
    : 'Keep the person internally consistent with the identity anchors. Do not invent conflicting hair color, eye color or defining features.'}
${request.selfie
    ? 'This is a selfie. Use a believable handheld/front-camera composition, natural eye contact and a candid phone-photo feeling. The photographed person must match the reference identity.'
    : 'Use the requested camera viewpoint and scene while keeping the same character identity.'}
Clothing is flexible and may follow the scene; appearance anchors are guidance, not a rigid costume lock.
No captions, watermarks, UI, split panels or extra duplicate people unless the scene explicitly requires them.`;
}

export async function generateCharacterImage(
    api: ImageGenerationApiConfig,
    char: CharacterProfile,
    request: ImageGenerationDirective,
): Promise<Blob | string> {
    if (!api.apiKey.trim()) throw new Error('生图 API Key 尚未配置');
    const cfg = char.imageGeneration;
    if (!cfg?.enabled) throw new Error('当前角色尚未开启生图');

    const referenceUrl = /^https?:\/\//i.test(cfg.referenceImage || '') ? cfg.referenceImage!.trim() : '';
    const prompt = buildGenerationPrompt(char, cfg, request, !!referenceUrl);
    const base = normalizeImageApiBase(api.baseUrl);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.apiKey.trim()}`,
        'X-Channel': api.channel || DEFAULT_IMAGE_CHANNEL,
    };
    const response = await fetch(`${base}/api/v2/gpt-image-2`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                prompt,
                image_size: '1536x1536',
                aspect_ratio: '1:1',
                resolution: '2K',
                quality: api.channel === 'official' ? 'medium' : 'low',
                reference_images: referenceUrl ? [referenceUrl] : [],
            }),
        });
    if (!response.ok) throw new Error(await readApiError(response, `提交生图任务失败（HTTP ${response.status}）`));
    const submitted = await response.json();
    const taskId = submitted?.data?.task_id;
    if (!taskId) throw new Error(submitted?.message || 'MXAPI 未返回生图任务编号');

    const imageUrl = await pollMxApiImageTask(base, api.apiKey, String(taskId));
    return await downloadGeneratedImage(imageUrl);
}

/** 同一个 blobref 同时写入角色图片消息与相册，避免 2K base64 双份占用。 */
export async function persistGeneratedCharacterImage(
    image: Blob | string,
    char: CharacterProfile,
    contextMessages: Message[],
    request: ImageGenerationDirective,
): Promise<string> {
    const ref = typeof image === 'string' ? image : await putImageBlob(image);
    const now = Date.now();
    const recentChat = contextMessages.slice(-10).map(message => {
        const sender = message.role === 'user' ? '用户' : char.name;
        return `${sender}: ${String(message.content || '').slice(0, 100)}`;
    });
    await DB.saveMessage({
        charId: char.id,
        role: 'assistant',
        type: 'image',
        content: ref,
        metadata: { generatedImage: true, scenePrompt: request.prompt, selfie: request.selfie },
    });
    await DB.saveGalleryImage({
        id: `generated-${now}-${Math.random().toString(36).slice(2, 8)}`,
        charId: char.id,
        url: ref,
        timestamp: now,
        savedDate: localDateKey(now),
        chatContext: recentChat,
    });
    return ref;
}

export async function pollMxApiImageTask(
    baseUrl: string,
    apiKey: string,
    taskId: string,
    options: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<string> {
    const base = normalizeImageApiBase(baseUrl);
    const intervalMs = options.intervalMs ?? IMAGE_POLL_INTERVAL_MS;
    const maxAttempts = options.maxAttempts ?? IMAGE_POLL_MAX_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0 && intervalMs > 0) await delay(intervalMs);
        const response = await fetch(`${base}/api/v2/gpt-image/task?task_id=${encodeURIComponent(taskId)}`, {
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
        });
        if (!response.ok) throw new Error(await readApiError(response, `查询生图任务失败（HTTP ${response.status}）`));
        const data = await response.json();
        const task = data?.data;
        const status = String(task?.status || '').toLowerCase();
        if (status === 'completed' || status === 'success' || status === 'succeeded') {
            const imageUrl = task?.result?.images?.[0];
            if (typeof imageUrl !== 'string' || !imageUrl) throw new Error('生图任务已完成，但响应中没有图片地址');
            return new URL(imageUrl, `${base}/`).toString();
        }
        if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
            throw new Error(task?.error_msg || task?.error || data?.message || '生图任务失败');
        }
    }
    throw new Error('生图等待超时，请稍后重试；若任务已扣费，可到 MXAPI 后台查看结果');
}

async function downloadGeneratedImage(imageUrl: string): Promise<Blob | string> {
    try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('返回内容不是图片');
        return blob;
    } catch (error) {
        console.warn('[image-generation] 结果图片无法下载到本地，改为保存远程地址', error);
        return imageUrl;
    }
}

async function readApiError(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.clone().json();
        return data?.error?.message || data?.message || fallback;
    } catch {
        try { return (await response.text()).slice(0, 300) || fallback; }
        catch { return fallback; }
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
