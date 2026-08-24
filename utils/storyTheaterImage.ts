import type { APIConfig, CharacterNovelAiImageGenerationConfig, CharacterProfile, StoryTheaterEntry } from '../types';
import { extractContent, safeResponseJson } from './safeApi';
import type { ImageGenerationDirective } from './imageGeneration';
import { DEFAULT_NAI_NEGATIVE_TAGS, DEFAULT_NAI_QUALITY_TAGS, generateNovelAiImage } from './novelAiImageGeneration';

export interface StoryImageHistoryItem { role: 'user' | 'assistant'; content: string; }
export interface StoryImagePromptPlan { visible: string[]; sceneTags: string; finalPrompt: string; }
export interface StoryImageCastState { key: string; name: string; clothing: string; position: string; pose: string; expression: string; }
export interface StoryImageFramePlan extends StoryImagePromptPlan { kind: 'motion' | 'highlight'; title: string; description: string; }
export interface StoryImageState {
    location: string;
    time: string;
    lighting: string;
    atmosphere: string;
    cast: StoryImageCastState[];
    continuityChange: string;
    frames: Array<Pick<StoryImageFramePlan, 'kind' | 'title' | 'description' | 'visible'>>;
}
export interface StoryGeneratedImageFrame extends StoryImageFramePlan { image: Blob | string; }

interface GenerateStoryTheaterImageOptions {
    apiConfig: APIConfig;
    entry: StoryTheaterEntry;
    actors: CharacterProfile[];
    userName: string;
    history: StoryImageHistoryItem[];
    previousState?: StoryImageState;
}

const cleanText = (value: unknown, fallback = '未明确'): string => String(value || '').trim() || fallback;
const cleanTags = (value: unknown): string => String(value || '')
    .replace(/^```(?:json)?\s*|\s*```$/gi, '')
    .replace(/^(?:tags?|prompt|sceneTags?)\s*[:：]\s*/i, '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .trim().replace(/^,+|,+$/g, '').trim();
const stripJsonFence = (raw: string): string => String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();

export function parseStoryImagePromptPlan(raw: string, participants: Array<{ key: string; name: string; anchor: string }>): StoryImagePromptPlan {
    const stripped = stripJsonFence(raw);
    let visible: string[] = [];
    let sceneTags = '';
    try {
        const parsed = JSON.parse(stripped);
        visible = Array.isArray(parsed?.visible) ? parsed.visible.map(String) : [];
        sceneTags = cleanTags(parsed?.sceneTags || parsed?.tags || parsed?.prompt);
    } catch {
        const visibleMatch = stripped.match(/VISIBLE\s*[:：]\s*([^\n]+)/i);
        const tagsMatch = stripped.match(/(?:TAGS?|PROMPT)\s*[:：]\s*([\s\S]+)/i);
        visible = visibleMatch ? visibleMatch[1].split(/[,，、]/).map(value => value.trim()).filter(Boolean) : [];
        sceneTags = cleanTags(tagsMatch?.[1] || stripped);
    }
    const selected = participants.filter(person => visible.some(value => {
        const token = value.trim().toLowerCase();
        return token === person.key.toLowerCase() || token === person.name.toLowerCase();
    }));
    const resolved = selected.length > 0 ? selected : participants;
    const anchors = resolved.map(person => cleanTags(person.anchor)).filter(Boolean);
    return { visible: resolved.map(person => person.key), sceneTags, finalPrompt: [...anchors, sceneTags].filter(Boolean).join(', ') };
}

export function parseStoryImageStoryboard(raw: string, participants: Array<{ key: string; name: string; anchor: string }>): { state: StoryImageState; frames: StoryImageFramePlan[] } {
    let parsed: any;
    try { parsed = JSON.parse(stripJsonFence(raw)); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object') {
        const base = parseStoryImagePromptPlan(raw, participants);
        const motion: StoryImageFramePlan = { ...base, kind: 'motion', title: '动作变化帧', description: '本轮动作变化最明显的一瞬间' };
        const highlightBase = parseStoryImagePromptPlan(JSON.stringify({ visible: base.visible, sceneTags: `${base.sceneTags}, medium close-up, emotional focus, rule of thirds, shallow depth of field, simple coherent background` }), participants);
        const highlight: StoryImageFramePlan = { ...highlightBase, kind: 'highlight', title: '情绪高光帧', description: '本轮最值得描绘的情绪与互动瞬间' };
        return {
            state: {
                location: '沿用当前剧情场景', time: '沿用当前时间', lighting: '沿用当前光线', atmosphere: '沿用当前氛围',
                cast: participants.filter(person => base.visible.includes(person.key)).map(person => ({ key: person.key, name: person.name, clothing: '依照正文', position: '依照正文', pose: '依照正文', expression: '依照正文' })),
                continuityChange: '根据本轮正文更新动作与人物关系',
                frames: [motion, highlight].map(frame => ({ kind: frame.kind, title: frame.title, description: frame.description, visible: frame.visible })),
            },
            frames: [motion, highlight],
        };
    }

    const rawFrames = Array.isArray(parsed.frames) ? parsed.frames.slice(0, 2) : [];
    const frameKinds: Array<'motion' | 'highlight'> = ['motion', 'highlight'];
    const defaultTitles = ['动作变化帧', '情绪高光帧'];
    const frames: StoryImageFramePlan[] = rawFrames.map((frame: any, index: number) => {
        const plan = parseStoryImagePromptPlan(JSON.stringify({ visible: frame?.visible, sceneTags: frame?.sceneTags || frame?.tags }), participants);
        return {
            ...plan,
            kind: frameKinds[index] || 'highlight',
            title: cleanText(frame?.title, defaultTitles[index] || '剧情关键帧'),
            description: cleanText(frame?.description, index === 0 ? '本轮动作变化最明显的一瞬间' : '本轮最值得描绘的情绪与互动瞬间'),
        };
    });
    if (frames.length < 2 && frames[0]) {
        const base = frames[0];
        const highlight = parseStoryImagePromptPlan(JSON.stringify({ visible: base.visible, sceneTags: `${base.sceneTags}, medium close-up, emotional focus, rule of thirds, shallow depth of field, simple coherent background` }), participants);
        frames.push({ ...highlight, kind: 'highlight', title: '情绪高光帧', description: '本轮最值得描绘的情绪与互动瞬间' });
    }
    if (!frames.length) return parseStoryImageStoryboard(cleanTags(parsed?.sceneTags || parsed?.prompt), participants);

    const scene = parsed.scene && typeof parsed.scene === 'object' ? parsed.scene : {};
    const cast: StoryImageCastState[] = (Array.isArray(parsed.cast) ? parsed.cast : []).map((person: any) => {
        const key = cleanText(person?.key, 'unknown');
        const participant = participants.find(item => item.key === key || item.name === person?.name);
        return {
            key,
            name: cleanText(person?.name, participant?.name || key),
            clothing: cleanText(person?.clothing),
            position: cleanText(person?.position),
            pose: cleanText(person?.pose),
            expression: cleanText(person?.expression),
        };
    });
    const state: StoryImageState = {
        location: cleanText(scene.location || parsed.location, '沿用当前剧情场景'),
        time: cleanText(scene.time || parsed.time, '沿用当前时间'),
        lighting: cleanText(scene.lighting || parsed.lighting, '沿用当前光线'),
        atmosphere: cleanText(scene.atmosphere || parsed.atmosphere, '沿用当前氛围'),
        cast,
        continuityChange: cleanText(parsed.continuityChange || parsed.change, '本轮没有明确的视觉状态变化'),
        frames: frames.map(frame => ({ kind: frame.kind, title: frame.title, description: frame.description, visible: frame.visible })),
    };
    return { state, frames };
}

export function buildStoryImagePlanningMessages(options: Omit<GenerateStoryTheaterImageOptions, 'apiConfig'>): Array<{ role: 'system' | 'user'; content: string }> {
    const image = options.entry.imageGeneration;
    const participants = [
        { key: 'user', name: options.userName, anchor: image?.userAnchor || '' },
        ...options.actors.map(actor => ({ key: `character:${actor.id}`, name: actor.name, anchor: image?.characterAnchors?.[actor.id] || '' })),
    ];
    const roster = participants.map(person => `- ${person.key} | ${person.name} | identity anchor: ${person.anchor || '(not provided)'}`).join('\n');
    const history = options.history.slice(-8).map(item => `[${item.role === 'user' ? options.userName : 'story'}]\n${item.content}`).join('\n\n');
    const previousState = options.previousState ? JSON.stringify(options.previousState) : '(none; establish the first visual state from the story)';
    return [
        {
            role: 'system',
            content: [
                'You are the continuity director and CG storyboard artist for a NovelAI-illustrated story.',
                'Read the newest round and the previous visual state. Unless the story explicitly changes location, time, clothing or lighting, preserve them exactly. Never invent a scene transition.',
                'Return ONLY valid compact JSON with this shape:',
                '{"scene":{"location":"Chinese","time":"Chinese","lighting":"Chinese","atmosphere":"Chinese"},"cast":[{"key":"participant key","name":"Chinese","clothing":"Chinese detailed","position":"Chinese","pose":"Chinese","expression":"Chinese"}],"continuityChange":"Chinese: the largest visual change from the previous round","frames":[{"title":"动作变化帧","description":"Chinese detailed CG action description","visible":["participant key"],"sceneTags":"English NovelAI/Danbooru tags"},{"title":"情绪高光帧","description":"Chinese detailed CG description of the single most drawable moment","visible":["participant key"],"sceneTags":"English NovelAI/Danbooru tags"}]}',
                'Frame 1 captures the largest movement or spatial change in this round. Choose a camera distance that clearly shows the action and interaction.',
                'Frame 2 captures the most emotionally or dramatically valuable instant. Prefer a deliberate medium close-up or close-up, clear subject placement (center or rule of thirds), shallow depth of field and a simple coherent background.',
                'Each sceneTags must include subject count, exact clothing, composition, pose and interaction, expressions, location, lighting, camera angle, depth of field and atmosphere.',
                'The visible array contains only people actually visible in that frame and may contain any number of people. Do not repeat identity anchors inside sceneTags.',
                'No prose outside JSON, no Markdown, dialogue, captions, UI, watermark or explanation.',
            ].join('\n'),
        },
        { role: 'user', content: `PARTICIPANTS\n${roster}\n\nPREVIOUS VISUAL STATE\n${previousState}\n\nRECENT STORY\n${history || '(opening scene)'}` },
    ];
}

const storyNovelConfig = (entry: StoryTheaterEntry): CharacterNovelAiImageGenerationConfig => ({
    enabled: true,
    characterTags: '',
    userTags: '',
    styleTags: entry.imageGeneration?.styleTags || '',
    qualityTags: DEFAULT_NAI_QUALITY_TAGS,
    negativeTags: entry.imageGeneration?.negativeTags?.trim() || DEFAULT_NAI_NEGATIVE_TAGS,
});

export async function generateStoryTheaterFrameImage(apiConfig: APIConfig, entry: StoryTheaterEntry, prompt: string): Promise<Blob | string> {
    const novelApi = apiConfig.novelAiImageGeneration;
    if (!novelApi?.baseUrl?.trim() || !novelApi.apiKey?.trim() || !novelApi.model?.trim()) throw new Error('全局生图 2.0 的 URL、API Key 或模型尚未配置完整');
    const directive: ImageGenerationDirective = { prompt, selfie: false, includeUser: false };
    return generateNovelAiImage({ ...novelApi, width: entry.imageGeneration?.width || 1216, height: entry.imageGeneration?.height || 832 }, storyNovelConfig(entry), directive);
}

export async function generateStoryTheaterImages(options: GenerateStoryTheaterImageOptions): Promise<{ state: StoryImageState; frames: StoryGeneratedImageFrame[] }> {
    if (!options.entry.imageGeneration?.enabled) throw new Error('本剧情尚未开启自动配图');
    const response = await fetch(`${options.apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiConfig.apiKey}` },
        body: JSON.stringify({ model: options.apiConfig.model, messages: buildStoryImagePlanningMessages(options), stream: false, temperature: 0.3, max_tokens: 1400 }),
    });
    if (!response.ok) throw new Error(`配图分镜整理失败（API ${response.status}）`);
    const raw = extractContent(await safeResponseJson(response)).trim();
    if (!raw) throw new Error('模型没有返回可用的画面状态与分镜');
    const participants = [
        { key: 'user', name: options.userName, anchor: options.entry.imageGeneration.userAnchor || '' },
        ...options.actors.map(actor => ({ key: `character:${actor.id}`, name: actor.name, anchor: options.entry.imageGeneration?.characterAnchors?.[actor.id] || '' })),
    ];
    const storyboard = parseStoryImageStoryboard(raw, participants);
    const count = options.entry.imageGeneration.imageCount === 1 ? 1 : 2;
    const plans = count === 1 ? [storyboard.frames[storyboard.frames.length - 1]] : storyboard.frames.slice(0, 2);
    const frames: StoryGeneratedImageFrame[] = [];
    for (const plan of plans) {
        if (!plan?.finalPrompt) continue;
        frames.push({ ...plan, image: await generateStoryTheaterFrameImage(options.apiConfig, options.entry, plan.finalPrompt) });
    }
    if (!frames.length) throw new Error('没有整理出可生成的剧情关键帧');
    return { state: storyboard.state, frames };
}
