import type {
    APIConfig,
    CharacterNovelAiImageGenerationConfig,
    CharacterProfile,
    StoryTheaterEntry,
} from '../types';
import { extractContent, safeResponseJson } from './safeApi';
import type { ImageGenerationDirective } from './imageGeneration';
import {
    DEFAULT_NAI_NEGATIVE_TAGS,
    DEFAULT_NAI_QUALITY_TAGS,
    generateNovelAiImage,
} from './novelAiImageGeneration';

export interface StoryImageHistoryItem {
    role: 'user' | 'assistant';
    content: string;
}

export interface StoryImagePromptPlan {
    visible: string[];
    sceneTags: string;
    finalPrompt: string;
}

interface GenerateStoryTheaterImageOptions {
    apiConfig: APIConfig;
    entry: StoryTheaterEntry;
    actors: CharacterProfile[];
    userName: string;
    history: StoryImageHistoryItem[];
}

const cleanTags = (value: unknown): string => String(value || '')
    .replace(/^```(?:json)?\s*|\s*```$/gi, '')
    .replace(/^(?:tags?|prompt|sceneTags?)\s*[:：]\s*/i, '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .trim()
    .replace(/^,+|,+$/g, '')
    .trim();

export function parseStoryImagePromptPlan(
    raw: string,
    participants: Array<{ key: string; name: string; anchor: string }>,
): StoryImagePromptPlan {
    const stripped = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
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
    // 少数模型会忘记 visible 字段。此时宁可保留全部人物锚点，也不让人物身份完全丢失。
    const resolved = selected.length > 0 ? selected : participants;
    const anchors = resolved.map(person => cleanTags(person.anchor)).filter(Boolean);
    const finalPrompt = [...anchors, sceneTags].filter(Boolean).join(', ');
    return { visible: resolved.map(person => person.key), sceneTags, finalPrompt };
}

export function buildStoryImagePlanningMessages(options: Omit<GenerateStoryTheaterImageOptions, 'apiConfig'>): Array<{ role: 'system' | 'user'; content: string }> {
    const image = options.entry.imageGeneration;
    const participants = [
        { key: 'user', name: options.userName, anchor: image?.userAnchor || '' },
        ...options.actors.map(actor => ({
            key: `character:${actor.id}`,
            name: actor.name,
            anchor: image?.characterAnchors?.[actor.id] || '',
        })),
    ];
    const roster = participants.map(person => `- ${person.key} | ${person.name} | identity anchor: ${person.anchor || '(not provided)'}`).join('\n');
    const history = options.history.slice(-8).map(item => `[${item.role === 'user' ? options.userName : 'story'}]\n${item.content}`).join('\n\n');
    return [
        {
            role: 'system',
            content: [
                'You are a NovelAI illustration prompt director. Read the latest story context and select one concrete, visually coherent moment from the newest round.',
                'Return ONLY compact JSON: {"visible":["participant key"],"sceneTags":"English comma-separated NovelAI/Danbooru tags"}.',
                'The visible array must contain only people actually visible in this chosen shot. It may contain any number of people, so group scenes are allowed.',
                'sceneTags must describe subject count, composition, poses and interaction, expressions, clothing, location, lighting, camera angle, depth and atmosphere.',
                'Do not repeat identity anchors inside sceneTags. Do not write prose, Markdown, dialogue, captions, watermarks or explanations.',
            ].join('\n'),
        },
        {
            role: 'user',
            content: `PARTICIPANTS\n${roster}\n\nRECENT STORY\n${history || '(opening scene)'}`,
        },
    ];
}

export async function generateStoryTheaterImage(options: GenerateStoryTheaterImageOptions): Promise<{ image: Blob | string; prompt: string }> {
    const imageConfig = options.entry.imageGeneration;
    const novelApi = options.apiConfig.novelAiImageGeneration;
    if (!imageConfig?.enabled) throw new Error('本剧情尚未开启自动配图');
    if (!novelApi?.baseUrl?.trim() || !novelApi.apiKey?.trim() || !novelApi.model?.trim()) {
        throw new Error('全局生图 2.0 的 URL、API Key 或模型尚未配置完整');
    }
    const messages = buildStoryImagePlanningMessages(options);
    const response = await fetch(`${options.apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiConfig.apiKey}`,
        },
        body: JSON.stringify({
            model: options.apiConfig.model,
            messages,
            stream: false,
            temperature: 0.35,
            max_tokens: 500,
        }),
    });
    if (!response.ok) throw new Error(`配图提示词生成失败（API ${response.status}）`);
    const raw = extractContent(await safeResponseJson(response)).trim();
    if (!raw) throw new Error('模型没有返回可用的配图提示词');

    const participants = [
        { key: 'user', name: options.userName, anchor: imageConfig.userAnchor || '' },
        ...options.actors.map(actor => ({
            key: `character:${actor.id}`,
            name: actor.name,
            anchor: imageConfig.characterAnchors?.[actor.id] || '',
        })),
    ];
    const plan = parseStoryImagePromptPlan(raw, participants);
    if (!plan.finalPrompt) throw new Error('模型没有整理出可用的 NAI 标签');

    const perStoryConfig: CharacterNovelAiImageGenerationConfig = {
        enabled: true,
        characterTags: '',
        userTags: '',
        styleTags: imageConfig.styleTags || '',
        qualityTags: DEFAULT_NAI_QUALITY_TAGS,
        negativeTags: imageConfig.negativeTags?.trim() || DEFAULT_NAI_NEGATIVE_TAGS,
    };
    const directive: ImageGenerationDirective = {
        prompt: plan.finalPrompt,
        selfie: false,
        includeUser: false,
    };
    const image = await generateNovelAiImage({
        ...novelApi,
        width: imageConfig.width || 1216,
        height: imageConfig.height || 832,
    }, perStoryConfig, directive);
    return { image, prompt: plan.finalPrompt };
}
