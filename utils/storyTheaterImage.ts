import type { APIConfig, CharacterNovelAiImageGenerationConfig, CharacterProfile, StoryTheaterEntry } from '../types';
import { extractContent, safeResponseJson } from './safeApi';
import type { ImageGenerationDirective } from './imageGeneration';
import { DEFAULT_NAI_NEGATIVE_TAGS, DEFAULT_NAI_QUALITY_TAGS, generateNovelAiImage } from './novelAiImageGeneration';

export interface StoryImageHistoryItem { role: 'user' | 'assistant'; content: string; }
export interface StoryImagePromptPlan { visible: string[]; sceneTags: string; finalPrompt: string; }
export interface StoryImageCastState { key: string; name: string; clothing: string; position: string; pose: string; expression: string; }
export interface StoryImageCharacterPlan {
    key: string;
    prompt: string;
    negative: string;
    center: { x: number; y: number };
}
export interface StoryImageFramePlan extends StoryImagePromptPlan {
    kind: 'motion' | 'highlight';
    title: string;
    description: string;
    characters: StoryImageCharacterPlan[];
}
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

type StoryImageParticipant = { key: string; name: string; anchor: string };

const cleanText = (value: unknown, fallback = '未明确'): string => String(value || '').trim() || fallback;
const cleanTags = (value: unknown): string => String(value || '')
    .replace(/^```(?:json)?\s*|\s*```$/gi, '')
    .replace(/^(?:tags?|prompt|sceneTags?)\s*[:：]\s*/i, '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .trim().replace(/^,+|,+$/g, '').trim();
const stripJsonFence = (raw: string): string => String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();

const extractJsonObject = (raw: string): string => {
    const source = stripJsonFence(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (start < 0) {
            if (character !== '{') continue;
            start = index;
            depth = 1;
            continue;
        }
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') inString = true;
        else if (character === '{') depth += 1;
        else if (character === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    return '';
};

const isPlaceholder = (value: unknown): boolean => /^(?:未明确|沿用当前|依照正文|根据本轮正文|本轮没有明确)/.test(String(value || '').trim());

const defaultCenterCodes = (count: number): string[] => {
    if (count <= 1) return ['c3'];
    if (count === 2) return ['b3', 'd3'];
    if (count === 3) return ['b3', 'c3', 'd3'];
    return ['b2', 'd2', 'b4', 'd4'];
};

export function parseStoryImageCenter(value: unknown, fallback = 'c3'): { x: number; y: number } {
    const token = String(value || fallback).trim().toLowerCase();
    const match = token.match(/^([a-e])([1-5])$/);
    const safe = match || fallback.toLowerCase().match(/^([a-e])([1-5])$/) || ['c3', 'c', '3'];
    return {
        x: Number((0.1 + (safe[1].charCodeAt(0) - 97) * 0.2).toFixed(1)),
        y: Number((0.1 + (Number(safe[2]) - 1) * 0.2).toFixed(1)),
    };
}

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

const buildStoryImageCharacterPlans = (
    rawCharacters: any[],
    visible: string[],
    participants: StoryImageParticipant[],
): StoryImageCharacterPlan[] => {
    const selected = participants.filter(person => visible.includes(person.key));
    const source = rawCharacters.length > 0 ? rawCharacters : selected.map((person, index) => ({
        key: person.key,
        prompt: '',
        negative: '',
        center: defaultCenterCodes(selected.length)[index] || 'c3',
    }));
    return source.slice(0, 4).map((character, index) => {
        const participant = participants.find(person => person.key === character?.key || person.name === character?.name)
            || selected[index];
        if (!participant) return null;
        const prompt = [cleanTags(participant.anchor), cleanTags(character?.prompt || character?.tags)]
            .filter(Boolean).join(', ');
        if (!prompt) return null;
        return {
            key: participant.key,
            prompt,
            negative: cleanTags(character?.negative || character?.uc),
            center: parseStoryImageCenter(character?.center, defaultCenterCodes(source.length)[index] || 'c3'),
        };
    }).filter((character): character is StoryImageCharacterPlan => Boolean(character));
};

export function parseStoryImageStoryboard(raw: string, participants: Array<{ key: string; name: string; anchor: string }>, strict = false): { state: StoryImageState; frames: StoryImageFramePlan[] } {
    let parsed: any;
    const jsonObject = extractJsonObject(raw);
    try { parsed = JSON.parse(jsonObject || stripJsonFence(raw)); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object') {
        if (strict) throw new Error('生图导演没有返回完整 JSON；已停止生图，未消耗 NAI 次数');
        const base = parseStoryImagePromptPlan(raw, participants);
        const characters = buildStoryImageCharacterPlans([], base.visible, participants);
        const motion: StoryImageFramePlan = { ...base, characters, kind: 'motion', title: '动作变化帧', description: '本轮动作变化最明显的一瞬间' };
        const highlightBase = parseStoryImagePromptPlan(JSON.stringify({ visible: base.visible, sceneTags: `${base.sceneTags}, interaction focus, clear body language, rule of thirds, coherent detailed background` }), participants);
        const highlight: StoryImageFramePlan = { ...highlightBase, characters, kind: 'highlight', title: '关系高光帧', description: '本轮最值得描绘的情绪与互动瞬间' };
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
    const defaultTitles = ['动作变化帧', '关系高光帧'];
    const frames: StoryImageFramePlan[] = rawFrames.map((frame: any, index: number) => {
        const rawCharacters = Array.isArray(frame?.characters) ? frame.characters : [];
        const visible = Array.isArray(frame?.visible) && frame.visible.length > 0
            ? frame.visible.map(String)
            : rawCharacters.map((character: any) => String(character?.key || character?.name || '')).filter(Boolean);
        const plan = parseStoryImagePromptPlan(JSON.stringify({ visible, sceneTags: frame?.sceneTags || frame?.tags }), participants);
        return {
            ...plan,
            characters: buildStoryImageCharacterPlans(rawCharacters, plan.visible, participants),
            kind: frameKinds[index] || 'highlight',
            title: cleanText(frame?.title, defaultTitles[index] || '剧情关键帧'),
            description: cleanText(frame?.description, index === 0 ? '本轮动作变化最明显的一瞬间' : '本轮最值得描绘的情绪与互动瞬间'),
        };
    });
    if (frames.length < 2 && frames[0]) {
        const base = frames[0];
        const highlight = parseStoryImagePromptPlan(JSON.stringify({ visible: base.visible, sceneTags: `${base.sceneTags}, interaction focus, clear body language, rule of thirds, coherent detailed background` }), participants);
        frames.push({ ...highlight, characters: base.characters, kind: 'highlight', title: '关系高光帧', description: '本轮最值得描绘的情绪与互动瞬间' });
    }
    if (!frames.length) {
        if (strict) throw new Error('生图导演没有整理出关键帧；已停止生图，未消耗 NAI 次数');
        return parseStoryImageStoryboard(cleanTags(parsed?.sceneTags || parsed?.prompt), participants);
    }

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
    if (strict) {
        const sceneValues = [state.location, state.time, state.lighting, state.atmosphere, state.continuityChange];
        const invalidScene = sceneValues.some(value => !value.trim() || isPlaceholder(value));
        const invalidCast = state.cast.length === 0 || state.cast.some(person =>
            [person.clothing, person.position, person.pose, person.expression].some(value => !value.trim() || isPlaceholder(value))
        );
        const invalidFrames = rawFrames.length < 2 || frames.length < 2 || frames.some(frame =>
            frame.sceneTags.length < 24
            || !frame.description.trim()
            || isPlaceholder(frame.description)
            || frame.characters.length === 0
            || frame.characters.some(character => character.prompt.length < 12)
        );
        if (invalidScene || invalidCast || invalidFrames) {
            throw new Error('生图导演返回的场景、人物状态或分镜不完整；已停止生图，未消耗 NAI 次数');
        }
    }
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
                'You are the continuity director and NovelAI V4 multi-character storyboard artist for a story. All depicted characters are adults.',
                'Read the newest round and the previous visual state. Unless the story explicitly changes location, time, clothing, hairstyle, hair color, eye color or lighting, preserve them exactly. Never invent a scene transition or replace a supplied identity anchor.',
                'Return ONLY valid compact JSON with this shape:',
                '{"scene":{"location":"Chinese","time":"Chinese","lighting":"Chinese","atmosphere":"Chinese"},"cast":[{"key":"participant key","name":"Chinese","clothing":"Chinese detailed","position":"Chinese","pose":"Chinese","expression":"Chinese"}],"continuityChange":"Chinese: largest visual change","frames":[{"title":"动作变化帧","description":"Chinese detailed CG description of one frozen instant","visible":["participant key"],"sceneTags":"English global scene/composition tags","characters":[{"key":"participant key","prompt":"English clothing, pose, action, expression and source#/target# interaction tags","negative":"English per-character contradictory/exclusion tags","center":"b3"}]},{"title":"关系高光帧","description":"Chinese detailed CG description of a different frozen instant","visible":["participant key"],"sceneTags":"English global scene/composition tags","characters":[{"key":"participant key","prompt":"English clothing, pose, action, expression and source#/target# interaction tags","negative":"English per-character contradictory/exclusion tags","center":"d3"}]}]}',
                'IMAGE PRIORITY: if the newest round explicitly contains a photo/video/live-stream image, depict that media frame first. Otherwise choose the strongest relationship/action beat. In an explicit adult scene, choose the clearest and most visually legible sensual beat; add nsfw to sceneTags only when explicit anatomy is actually visible.',
                'Frame 1 captures the largest movement or spatial change. Use a wide, medium-wide or full/three-quarter body composition that clearly shows bodies, limbs, props and environment.',
                'Frame 2 captures a different emotionally or dramatically valuable instant. Choose upper body, half body, lower body, full body, POV, from above or from below according to the action. Do NOT default to a face portrait or headshot: show at least the torso and every body part needed to understand the interaction.',
                'sceneTags are the V4 base caption: include exact subject count, complete environment/location, time, lighting, atmosphere, camera distance, angle, depth, foreground/background separation and composition. Never omit the setting. Do not put identity anchors here.',
                'characters are V4 character captions. Include every visible person exactly once. Their prompt must include current clothing state, body pose, hands, gaze, expression and concrete interaction. Use matching {source#action}/{target#action} tags when people touch or act on one another.',
                'center uses the 5x5 grid a1-e5. Prefer b2-d4; c3 is center. Two separated people usually use b3/d3; overlapping interaction may use c3/c3 or c3/d3. Avoid a1/e5 unless the composition truly requires an edge crop.',
                'The visible array contains only people actually visible in that frame and may contain any number of people. Character keys and name order must exactly follow PARTICIPANTS. Identity anchors are injected by code, so never contradict their hairstyle, hair color, eye color or fixed traits.',
                'No prose outside JSON, no Markdown, dialogue, captions, UI, watermark or explanation.',
                'Keep every Chinese field concise (prefer 12-60 Chinese characters) and every English tag field concrete. Completeness is more important than literary prose. Never write placeholders such as “沿用当前”“依照正文” or “未明确”; copy the actual state into every required field.',
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

export async function generateStoryTheaterFrameImage(apiConfig: APIConfig, entry: StoryTheaterEntry, frame: StoryImageFramePlan | string): Promise<Blob | string> {
    const novelApi = apiConfig.novelAiImageGeneration;
    if (!novelApi?.baseUrl?.trim() || !novelApi.apiKey?.trim() || !novelApi.model?.trim()) throw new Error('全局生图 2.0 的 URL、API Key 或模型尚未配置完整');
    const structuredCharacters = typeof frame === 'string' || !Array.isArray(frame.characters)
        ? []
        : frame.characters;
    const directive: ImageGenerationDirective = typeof frame === 'string'
        ? { prompt: frame, selfie: false, includeUser: false }
        : {
            prompt: structuredCharacters.length > 0 ? frame.sceneTags : frame.finalPrompt,
            selfie: false,
            includeUser: false,
            characterPrompts: structuredCharacters.map(character => ({
                prompt: character.prompt,
                negative: character.negative,
                center: character.center,
            })),
        };
    return generateNovelAiImage({ ...novelApi, width: entry.imageGeneration?.width || 1216, height: entry.imageGeneration?.height || 832 }, storyNovelConfig(entry), directive);
}

export async function generateStoryTheaterImages(options: GenerateStoryTheaterImageOptions): Promise<{ state: StoryImageState; frames: StoryGeneratedImageFrame[] }> {
    if (!options.entry.imageGeneration?.enabled) throw new Error('本剧情尚未开启自动配图');
    const response = await fetch(`${options.apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiConfig.apiKey}` },
        body: JSON.stringify({ model: options.apiConfig.model, messages: buildStoryImagePlanningMessages(options), stream: false, temperature: 0.15, max_tokens: 3200 }),
    });
    if (!response.ok) throw new Error(`配图分镜整理失败（API ${response.status}）`);
    const raw = extractContent(await safeResponseJson(response)).trim();
    if (!raw) throw new Error('模型没有返回可用的画面状态与分镜');
    const participants = [
        { key: 'user', name: options.userName, anchor: options.entry.imageGeneration.userAnchor || '' },
        ...options.actors.map(actor => ({ key: `character:${actor.id}`, name: actor.name, anchor: options.entry.imageGeneration?.characterAnchors?.[actor.id] || '' })),
    ];
    const storyboard = parseStoryImageStoryboard(raw, participants, true);
    const count = options.entry.imageGeneration.imageCount === 1 ? 1 : 2;
    const plans = count === 1 ? [storyboard.frames[storyboard.frames.length - 1]] : storyboard.frames.slice(0, 2);
    const frames: StoryGeneratedImageFrame[] = [];
    for (const plan of plans) {
        if (!plan?.finalPrompt) continue;
        frames.push({ ...plan, image: await generateStoryTheaterFrameImage(options.apiConfig, options.entry, plan) });
    }
    if (!frames.length) throw new Error('没有整理出可生成的剧情关键帧');
    return { state: storyboard.state, frames };
}
