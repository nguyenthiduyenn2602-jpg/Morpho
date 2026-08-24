import JSZip from 'jszip';
import type {
    CharacterNovelAiImageGenerationConfig,
    CharacterProfile,
    NovelAiImageGenerationApiConfig,
    UserProfile,
} from '../types';
import type { ImageGenerationDirective } from './imageGeneration';

export const DEFAULT_NAI_IMAGE_API_URL = 'https://image.novelai.net';
export const DEFAULT_NAI_IMAGE_MODEL = 'nai-diffusion-4-5-full';
export const DEFAULT_NAI_SAMPLER = 'k_euler_ancestral';
export const DEFAULT_NAI_QUALITY_TAGS = 'very aesthetic, masterpiece, high quality, absurdres';
export const DEFAULT_NAI_NEGATIVE_TAGS = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, watermark, signature';
export const NAI_IMAGE_GENERATION_OPEN = '[[GENERATE_NAI_IMAGE]]';
export const NAI_IMAGE_GENERATION_CLOSE = '[[/GENERATE_NAI_IMAGE]]';

const NAI_DIRECTIVE_RE = /\[\[GENERATE_NAI_IMAGE\]\]\s*([\s\S]*?)\s*\[\[\/GENERATE_NAI_IMAGE\]\]/i;

export function normalizeNovelAiBase(value: string): string {
    const raw = (value || DEFAULT_NAI_IMAGE_API_URL).trim().replace(/\/+$/, '');
    return raw.replace(/\/(?:ai\/generate-image|api\/generate|generate|novelai)$/i, '');
}

export function novelAiGenerateEndpoint(value: string): string {
    const raw = (value || DEFAULT_NAI_IMAGE_API_URL).trim().replace(/\/+$/, '');
    try {
        const url = new URL(raw);
        // 砂糖绘画的 /api/generate 是网页简易接口；/novelai 才接收标准 NAI payload。
        if (/\.loliyc\.com$/i.test(url.hostname) && /\/(?:api\/generate|generate)$/i.test(url.pathname)) {
            return `${url.origin}/novelai`;
        }
    } catch { /* 下方仍按普通字符串兼容 */ }
    if (/\/(?:ai\/generate-image|novelai)$/i.test(raw)) return raw;
    return `${normalizeNovelAiBase(raw)}/ai/generate-image`;
}

export function novelAiModelsEndpoint(value: string): string {
    const raw = (value || DEFAULT_NAI_IMAGE_API_URL).trim();
    try { return `${new URL(raw).origin}/v1/models`; }
    catch { return `${normalizeNovelAiBase(raw)}/v1/models`; }
}

export function extractNovelAiModelIds(data: any): string[] {
    const source = Array.isArray(data) ? data
        : Array.isArray(data?.data) ? data.data
            : Array.isArray(data?.models) ? data.models : [];
    const ids: string[] = source.map((item: any) => typeof item === 'string' ? item : item?.id || item?.name)
        .filter((item: any): item is string => typeof item === 'string' && !!item.trim())
        .map((item: string) => item.trim());
    return [...new Set<string>(ids)].sort((a, b) => a.localeCompare(b));
}

export async function fetchNovelAiModels(config: NovelAiImageGenerationApiConfig): Promise<string[]> {
    let response: Response;
    try {
        response = await fetch(novelAiModelsEndpoint(config.baseUrl), {
            headers: config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : undefined,
        });
    } catch (error: any) {
        throw new Error(error?.message === 'Load failed' ? '浏览器无法连接模型列表，可能是网络或 CORS 限制' : (error?.message || '获取模型失败'));
    }
    if (!response.ok) throw new Error(await readNovelAiError(response, `获取模型失败（HTTP ${response.status}）`));
    const models = extractNovelAiModelIds(await response.json().catch(() => null));
    if (!models.length) throw new Error('接口已返回，但没有识别到可用模型');
    return models;
}

/** FNV-1a，仅用于让绿灯随配置变化自动失效。 */
export function novelAiApiSignature(config: NovelAiImageGenerationApiConfig): string {
    const input = [
        normalizeNovelAiBase(config.baseUrl), config.apiKey, config.model,
        config.width, config.height, config.sampler, config.steps, config.scale,
    ].join('\u0000');
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isNovelAiApiVerified(config?: NovelAiImageGenerationApiConfig): boolean {
    return !!config?.verifiedAt
        && !!config.verifiedSignature
        && config.verifiedSignature === novelAiApiSignature(config);
}

/**
 * 无扣费探测。官方图像域没有独立余额接口，因此只检查端点可达性；
 * 401/403 说明请求已抵达 NAI 且 Key 被服务端识别/拒绝，也属于“端点可达”。
 */
export async function testNovelAiConnection(config: NovelAiImageGenerationApiConfig): Promise<void> {
    if (!config.apiKey.trim()) throw new Error('请先填写 NovelAI API Key');
    let response: Response;
    try {
        response = await fetch(novelAiGenerateEndpoint(config.baseUrl), {
            method: 'OPTIONS',
            headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
        });
    } catch (error: any) {
        throw new Error(error?.message === 'Load failed'
            ? '浏览器无法连接该地址，可能是网络或 CORS 限制'
            : (error?.message || '无法连接 NovelAI 端点'));
    }
    if (response.status >= 500) throw new Error(`NovelAI 端点异常（HTTP ${response.status}）`);
}

export function buildNovelAiDecisionPrompt(char: CharacterProfile, userProfile: UserProfile): string {
    const cfg = char.novelAiImageGeneration;
    if (!cfg?.enabled) return '';
    const proactiveRule = cfg.allowProactive
        ? `用户明确索图时必须使用；也可以极低频地主动发图，但不要连续两轮触发。`
        : `只有 ${userProfile.name} 在最新消息里明确要求看图、自拍或照片时才能使用，绝不能主动触发。`;
    return `
## 本地私聊生图 2.0（NovelAI，严格规则）
${proactiveRule}
先结合近期聊天和最新消息，选择一帧能够被画出来的具体瞬间：
1. 最新消息明确描述照片、视频、直播或自拍时，优先还原那幅媒体画面。
2. 否则选择当前互动中最有代表性、最有张力且最符合角色关系的一刻。
3. 只描述同一瞬间，禁止把前后连续动作塞进一张图。
4. 标签必须涵盖人物数量、环境/地点、时间、光线、镜头、服装、姿势、动作、表情和人物互动；没有依据的细节不要从远古记忆硬凑。

需要发图时，先用 ${char.name} 当前的语气自然回复一至三个简短气泡，再在末尾附加控制块：
${NAI_IMAGE_GENERATION_OPEN}
{"prompt":"只写本轮画面的英文 Danbooru/NAI 标签，用英文逗号分隔；不重复固定形象或画师串","selfie":true,"includeUser":false}
${NAI_IMAGE_GENERATION_CLOSE}
- selfie=true 仅表示自拍/角色自己拍摄；其他构图填 false。
- includeUser=true 仅当 ${userProfile.name} 本人确实出现在画面里；只被提及、作为拍摄者或在镜头外时填 false。
- 控制块不会展示给用户。不要解释 API、提示词或工具。
- 不生图时正常聊天，绝不输出控制块。`;
}

export function extractNovelAiDirective(raw: string): { directive: ImageGenerationDirective | null; cleaned: string } {
    const match = (raw || '').match(NAI_DIRECTIVE_RE);
    if (!match) return { directive: null, cleaned: raw };
    let directive: ImageGenerationDirective | null = null;
    try {
        const parsed = JSON.parse(match[1]);
        const prompt = typeof parsed?.prompt === 'string' ? parsed.prompt.trim() : '';
        if (prompt) directive = {
            prompt: prompt.slice(0, 2400),
            selfie: parsed?.selfie !== false,
            includeUser: parsed?.includeUser === true,
        };
    } catch { /* malformed controls are stripped but never executed */ }
    return { directive, cleaned: raw.replace(NAI_DIRECTIVE_RE, '').trim() };
}

export function splitNovelAiTags(value: string): string[] {
    return (value || '')
        .replace(/&#x20;|&nbsp;/gi, ' ')
        .replace(/\\+\s*$/, '')
        .split(/[，,\n]+/)
        .map(tag => tag.trim())
        .filter(Boolean);
}

/** 分层合并并去重，保留用户填写顺序与权重写法。 */
export function buildNovelAiPrompt(
    cfg: CharacterNovelAiImageGenerationConfig,
    request: ImageGenerationDirective,
): string {
    const selfieTags = request.selfie
        ? 'selfie, looking at viewer, solo, upper body, phone camera perspective'
        : '';
    const layers = [
        cfg.qualityTags || DEFAULT_NAI_QUALITY_TAGS,
        cfg.styleTags || '',
        cfg.characterTags || '',
        request.includeUser ? (cfg.userTags || '') : '',
        selfieTags,
        request.prompt,
    ];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const tag of layers.flatMap(splitNovelAiTags)) {
        const key = tag.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(key)) {
            seen.add(key);
            result.push(tag);
        }
    }
    return result.join(', ');
}

export function buildNovelAiPayload(
    api: NovelAiImageGenerationApiConfig,
    cfg: CharacterNovelAiImageGenerationConfig,
    request: ImageGenerationDirective,
    seed = Math.floor(Math.random() * 0xffffffff),
    referenceImageBase64: string | string[] = '',
): Record<string, any> {
    const prompt = buildNovelAiPrompt(cfg, request);
    const negative = splitNovelAiTags(cfg.negativeTags || DEFAULT_NAI_NEGATIVE_TAGS).join(', ');
    const characterPrompts = (request.characterPrompts || [])
        .map(character => {
            const x = Math.max(0.1, Math.min(0.9, Number(character.center?.x) || 0.5));
            const y = Math.max(0.1, Math.min(0.9, Number(character.center?.y) || 0.5));
            return {
                prompt: character.prompt.trim(),
                uc: (character.negative || '').trim(),
                center: { x, y },
            };
        })
        .filter(character => character.prompt);
    const caption = {
        base_caption: prompt,
        char_captions: characterPrompts.map(character => ({
            centers: [character.center],
            char_caption: character.prompt,
        })),
    };
    const negativeCaption = {
        base_caption: negative,
        char_captions: characterPrompts.map(character => ({
            centers: [character.center],
            char_caption: character.uc,
        })),
    };
    const useCoords = characterPrompts.length > 0;
    const referenceImages = (Array.isArray(referenceImageBase64) ? referenceImageBase64 : [referenceImageBase64]).filter(Boolean);
    return {
        input: prompt,
        model: api.model || DEFAULT_NAI_IMAGE_MODEL,
        action: 'generate',
        parameters: {
            params_version: 3,
            width: api.width,
            height: api.height,
            scale: api.scale,
            sampler: api.sampler,
            steps: api.steps,
            n_samples: 1,
            seed,
            negative_prompt: negative,
            ucPreset: 0,
            qualityToggle: api.qualityToggle,
            dynamic_thresholding: false,
            controlnet_strength: 1,
            legacy: false,
            add_original_image: false,
            cfg_rescale: 0,
            noise_schedule: 'karras',
            legacy_v3_extend: false,
            skip_cfg_above_sigma: null,
            use_coords: useCoords,
            characterPrompts,
            reference_image_multiple: referenceImages,
            reference_information_extracted_multiple: referenceImages.map(() => 1),
            reference_strength_multiple: referenceImages.map(() => Math.min(1, Math.max(0, cfg.referenceStrength ?? 0.6))),
            deliberate_euler_ancestral_bug: false,
            prefer_brownian: true,
            v4_prompt: { caption, use_coords: useCoords, use_order: true },
            v4_negative_prompt: { caption: negativeCaption, legacy_uc: false },
        },
    };
}

export async function generateNovelAiCharacterImage(
    api: NovelAiImageGenerationApiConfig,
    char: CharacterProfile,
    request: ImageGenerationDirective,
): Promise<Blob | string> {
    if (!api.apiKey.trim()) throw new Error('NovelAI API Key 尚未配置');
    const cfg = char.novelAiImageGeneration;
    if (!cfg?.enabled) throw new Error('当前角色尚未开启生图 2.0');
    return generateNovelAiImage(api, cfg, request, cfg.referenceImageUrl ? [cfg.referenceImageUrl] : []);
}

/** 通用 NAI 生成入口：供私聊角色与多人剧情剧场共用同一套全局 API。 */
export async function generateNovelAiImage(
    api: NovelAiImageGenerationApiConfig,
    cfg: CharacterNovelAiImageGenerationConfig,
    request: ImageGenerationDirective,
    referenceImageUrls: string[] = [],
): Promise<Blob | string> {
    if (!api.apiKey.trim()) throw new Error('NovelAI API Key 尚未配置');
    const urls = referenceImageUrls.map(url => url.trim()).filter(Boolean);
    const referenceImages = urls.length ? await Promise.all(urls.map(fetchReferenceImageBase64)) : [];
    const response = await fetch(novelAiGenerateEndpoint(api.baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/zip, application/json, image/*',
            Authorization: `Bearer ${api.apiKey.trim()}`,
        },
        body: JSON.stringify(buildNovelAiPayload(api, cfg, request, undefined, referenceImages)),
    });
    if (!response.ok) throw new Error(await readNovelAiError(response, `NovelAI 生图失败（HTTP ${response.status}）`));

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.startsWith('image/')) return await response.blob();
    if (contentType.includes('json')) return await readJsonImage(response);

    const archive = await JSZip.loadAsync(await response.arrayBuffer()).catch(() => null);
    if (!archive) throw new Error('NovelAI 返回的不是可识别的图片或 ZIP');
    const entry = Object.values(archive.files).find(file => !file.dir && /\.(?:png|jpe?g|webp)$/i.test(file.name));
    if (!entry) throw new Error('NovelAI ZIP 中没有找到图片');
    const blob = await entry.async('blob');
    return new Blob([blob], { type: imageMimeFromName(entry.name) });
}

async function fetchReferenceImageBase64(url: string): Promise<string> {
    if (!/^https?:\/\//i.test(url)) throw new Error('参考图必须是 http(s) 图片直链');
    let response: Response;
    try { response = await fetch(url); }
    catch (error: any) {
        throw new Error(error?.message === 'Load failed'
            ? '参考图能显示，但图片站禁止浏览器读取（CORS）。请换一个允许外链读取的图床直链'
            : (error?.message || '读取参考图失败'));
    }
    if (!response.ok) throw new Error(`读取参考图失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) throw new Error('参考图 URL 返回的不是图片');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}

async function readJsonImage(response: Response): Promise<Blob | string> {
    const data = await response.json().catch(() => null);
    const url = data?.url || data?.image_url
        || (typeof data?.data === 'string' ? data.data : undefined)
        || data?.data?.url || data?.data?.[0]?.url || data?.data?.images?.[0];
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
    const b64 = data?.image || data?.b64_json || data?.data?.b64_json || data?.data?.[0]?.b64_json;
    if (typeof b64 === 'string' && b64) {
        const cleaned = b64.replace(/^data:image\/[^;]+;base64,/, '');
        const bytes = Uint8Array.from(atob(cleaned), char => char.charCodeAt(0));
        return new Blob([bytes], { type: 'image/png' });
    }
    throw new Error(data?.message || data?.error?.message
        || (data?.status === 'failed' && typeof data?.data === 'string' ? data.data : '')
        || '接口返回 JSON，但没有找到图片');
}

async function readNovelAiError(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.clone().json();
        return data?.error?.message || data?.message || data?.error || fallback;
    } catch {
        try { return (await response.text()).slice(0, 300) || fallback; }
        catch { return fallback; }
    }
}

function imageMimeFromName(name: string): string {
    if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
    if (/\.webp$/i.test(name)) return 'image/webp';
    return 'image/png';
}
