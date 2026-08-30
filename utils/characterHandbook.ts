import type { APIConfig, CharacterProfile, GalleryImage, GroupProfile, RealtimeConfig, UserProfile } from '../types';
import { DB } from './db';
import { putImageBlob } from './blobRef';
import { loadMomentPosts } from './moments';
import {
    DEFAULT_NAI_NEGATIVE_TAGS,
    DEFAULT_NAI_QUALITY_TAGS,
    DEFAULT_NAI_SAMPLER,
    generateNovelAiImage,
} from './novelAiImageGeneration';
import { RealtimeContextManager } from './realtimeContext';
import { extractContent, extractJson, safeResponseJson } from './safeApi';

export type CharacterHandbookStyle = 'normal' | 'highlight' | 'wave' | 'strike' | 'censored' | 'emphasis' | 'handwritten' | 'messy';

export interface CharacterHandbookRun {
    text: string;
    style?: CharacterHandbookStyle;
}

export interface CharacterHandbookParagraph {
    runs: CharacterHandbookRun[];
}

export interface CharacterHandbookEntry {
    id: string;
    charId: string;
    date: string;
    createdAt: number;
    mood: string;
    weather: { emoji: string; description: string; temp: number | null; city?: string };
    paragraphs: CharacterHandbookParagraph[];
    stillLifePrompt: string;
    stillImage?: string;
    chibiImage?: string;
    sourceIds: string[];
    imageStatus?: 'none' | 'generating' | 'ready' | 'partial' | 'failed';
    schemaVersion: 1;
}

export interface HandbookChibiPreset {
    id: string;
    name: string;
    builtIn?: boolean;
    styleTags: string;
    negativeTags: string;
    qualityTags: string;
    steps: number;
    scale: number;
    sampler: string;
}

export interface HandbookChibiSettings {
    selectedPresetId: string;
    customPresets: HandbookChibiPreset[];
}

const ASSET_PREFIX = 'character-handbook-v1:';
const CHIBI_SETTINGS_ASSET_ID = 'character-handbook-chibi-settings-v1';
const ALLOWED_STYLES = new Set<CharacterHandbookStyle>(['normal', 'highlight', 'wave', 'strike', 'censored', 'emphasis', 'handwritten', 'messy']);

export const DEFAULT_HANDBOOK_CHIBI_PRESET: HandbookChibiPreset = {
    id: 'builtin-morpho-chibi',
    name: 'Morpho特调q版',
    builtIn: true,
    styleTags: `1.3::artist:horuhara::,1.4::artist:beni_shake::,0.9::artist:waka_(wk4444)::,year 2024,year 2025,2::chibi::,0.3::crayon line::,0.6::thick line::,1.2::high saturation::,1.3::white background::,
chibi, super deformed, large head, small body, cute proportions,
chibi background, background, soft colors, kawaii atmosphere`,
    negativeTags: `text, logo, 2::signature, watermark::, too many watermarks, artist:gaoo (frpjx283), artist:matsunaga kouyou, artist:nameo (judgemasterkou), artist:bb (baalbuddy), 1990s (style), bad anatomy, distorted anatomy, disfigured, bad hands, missing finger, 1.5::too many fingers::, mutated hands, extra fingers, interlocked fingers, badly drawn hands and fingers, anatomically incorrect hands, extra digits, fewer digits, mutation, extra arms, extra legs, long neck, bad feet, very displeasing, undetailed eyes, multiple views, negative space, blank page, variant set, large variant set, oekaki, halftone, screentone, artistic error, film grain, scan artifacts, jpeg artifacts, chromatic aberration, dithering, disorganized colors, lowres, worst quality, bad quality, cheesy, sloppiness, unfinished, incomplete, colored inner hair, lineart, monochrome, black and white, sketch, line drawing, ink drawing, comic style, manga style`,
    qualityTags: DEFAULT_NAI_QUALITY_TAGS,
    steps: 24,
    scale: 6.5,
    sampler: DEFAULT_NAI_SAMPLER,
};

const normalizeChibiPreset = (preset: HandbookChibiPreset): HandbookChibiPreset => ({
    ...preset,
    id: String(preset.id || `handbook-chibi-${Date.now()}`),
    name: cleanContent(preset.name, 40) || '未命名Q版预设',
    builtIn: false,
    styleTags: String(preset.styleTags || '').trim(),
    negativeTags: String(preset.negativeTags || DEFAULT_NAI_NEGATIVE_TAGS).trim(),
    qualityTags: String(preset.qualityTags || DEFAULT_NAI_QUALITY_TAGS).trim(),
    steps: Math.min(50, Math.max(1, Number(preset.steps) || 24)),
    scale: Math.min(20, Math.max(1, Number(preset.scale) || 6.5)),
    sampler: String(preset.sampler || DEFAULT_NAI_SAMPLER),
});

export async function loadHandbookChibiSettings(): Promise<HandbookChibiSettings> {
    try {
        const saved = await DB.getAssetRaw(CHIBI_SETTINGS_ASSET_ID) as Partial<HandbookChibiSettings> | null;
        const customPresets = Array.isArray(saved?.customPresets)
            ? saved.customPresets.map(preset => normalizeChibiPreset(preset as HandbookChibiPreset))
            : [];
        const selectedPresetId = saved?.selectedPresetId === DEFAULT_HANDBOOK_CHIBI_PRESET.id
            || customPresets.some(preset => preset.id === saved?.selectedPresetId)
            ? String(saved?.selectedPresetId)
            : DEFAULT_HANDBOOK_CHIBI_PRESET.id;
        return { selectedPresetId, customPresets };
    } catch {
        return { selectedPresetId: DEFAULT_HANDBOOK_CHIBI_PRESET.id, customPresets: [] };
    }
}

export async function saveHandbookChibiSettings(settings: HandbookChibiSettings): Promise<HandbookChibiSettings> {
    const customPresets = settings.customPresets.map(normalizeChibiPreset);
    const selectedPresetId = settings.selectedPresetId === DEFAULT_HANDBOOK_CHIBI_PRESET.id
        || customPresets.some(preset => preset.id === settings.selectedPresetId)
        ? settings.selectedPresetId
        : DEFAULT_HANDBOOK_CHIBI_PRESET.id;
    const normalized = { selectedPresetId, customPresets };
    await DB.saveAssetRaw(CHIBI_SETTINGS_ASSET_ID, normalized);
    return normalized;
}

export function resolveHandbookChibiPreset(settings: HandbookChibiSettings): HandbookChibiPreset {
    return settings.customPresets.find(preset => preset.id === settings.selectedPresetId)
        || DEFAULT_HANDBOOK_CHIBI_PRESET;
}

export const localDiaryDate = (timestamp = Date.now()): string => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const entryAssetId = (charId: string, date: string) => `${ASSET_PREFIX}${charId}:${date}`;

export async function loadCharacterHandbooks(charId: string): Promise<CharacterHandbookEntry[]> {
    const assets = await DB.getAllAssets();
    const prefix = `${ASSET_PREFIX}${charId}:`;
    const entries = assets
        .filter(asset => asset.id.startsWith(prefix))
        .map(asset => {
            try { return JSON.parse(asset.data) as CharacterHandbookEntry; }
            catch { return null; }
        })
        .filter((entry): entry is CharacterHandbookEntry => Boolean(entry?.date && entry.charId === charId))
        .sort((a, b) => a.date.localeCompare(b.date));
    const repaired: CharacterHandbookEntry[] = [];
    for (const entry of entries) {
        const rawText = entry.paragraphs?.flatMap(paragraph => paragraph.runs || []).map(run => run.text).join('\n') || '';
        if (/^\s*\{[\s\S]*["“]paragraphs["”]\s*:/i.test(rawText)) {
            try {
                const parsed = parseCharacterHandbookDiaryResponse(rawText);
                const healed = { ...entry, mood: parsed.mood || entry.mood, paragraphs: parsed.paragraphs };
                await saveCharacterHandbook(healed);
                repaired.push(healed);
                continue;
            } catch { /* 保留原记录，用户仍可选择重新生成 */ }
        }
        repaired.push(entry);
    }
    return repaired;
}

export async function saveCharacterHandbook(entry: CharacterHandbookEntry): Promise<void> {
    await DB.saveAsset(entryAssetId(entry.charId, entry.date), JSON.stringify(entry));
}

const weatherEmoji = (icon = '', description = ''): string => {
    if (icon.startsWith('11') || /雷/.test(description)) return '⛈️';
    if (icon.startsWith('13') || /雪|冰/.test(description)) return '❄️';
    if (icon.startsWith('09') || icon.startsWith('10') || /雨/.test(description)) return '🌧️';
    if (icon.startsWith('50') || /雾/.test(description)) return '🌫️';
    if (icon.startsWith('04') || /阴/.test(description)) return '☁️';
    if (icon.startsWith('02') || icon.startsWith('03') || /云/.test(description)) return '⛅';
    return '☀️';
};

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const cleanContent = (content: unknown, max = 320): string => String(content || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function collectTodayFacts(
    char: CharacterProfile,
    characters: CharacterProfile[],
    groups: GroupProfile[],
    userProfile: UserProfile,
): Promise<{ lines: string[]; ids: string[] }> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const lines: string[] = [];
    const ids: string[] = [];
    const nameOf = (id?: string) => characters.find(character => character.id === id)?.name || (id === char.id ? char.name : '群成员');

    const privateMessages = (await DB.getMessagesByCharId(char.id, true))
        .filter(message => message.timestamp >= start && message.timestamp <= Date.now() && message.role !== 'system')
        .slice(-50);
    privateMessages.forEach(message => {
        const content = cleanContent(message.content);
        if (!content) return;
        lines.push(`[私聊 dm:${message.id} ${formatTime(message.timestamp)} ${message.role === 'user' ? userProfile.name : char.name}] ${content}`);
        ids.push(`dm:${message.id}`);
    });

    const memberGroups = groups.filter(group => group.members.includes(char.id));
    for (const group of memberGroups) {
        const messages = (await DB.getGroupMessages(group.id))
            .filter(message => message.timestamp >= start && message.timestamp <= Date.now() && message.role !== 'system')
            .slice(-35);
        messages.forEach(message => {
            const content = cleanContent(message.content);
            if (!content) return;
            const speaker = message.role === 'user' ? userProfile.name : nameOf(message.charId);
            lines.push(`[群聊 group:${group.id}:${message.id} ${group.name} ${formatTime(message.timestamp)} ${speaker}] ${content}`);
            ids.push(`group:${group.id}:${message.id}`);
        });
    }

    const posts = (await loadMomentPosts()).filter(post => post.timestamp >= start && post.timestamp <= Date.now()).slice(0, 20);
    posts.forEach(post => {
        const relevant = post.authorCharId === char.id
            || post.authorType === 'user'
            || post.comments?.some(comment => comment.authorCharId === char.id || comment.authorType === 'user');
        if (!relevant) return;
        const content = cleanContent(post.content);
        if (content) {
            lines.push(`[朋友圈 moment:${post.id} ${formatTime(post.timestamp)} ${post.authorName}] ${content}`);
            ids.push(`moment:${post.id}`);
        }
        (post.comments || []).filter(comment => comment.authorCharId === char.id || comment.authorType === 'user').slice(-8).forEach((comment, index) => {
            const commentText = cleanContent(comment.content, 180);
            if (commentText) lines.push(`[朋友圈评论 moment:${post.id}:comment:${comment.id || index} ${comment.authorName}] ${commentText}`);
        });
    });

    return { lines: lines.slice(-110), ids: Array.from(new Set(ids)) };
}

const decodeJsonString = (source: string): string => {
    try { return JSON.parse(`"${source}"`); }
    catch { return source.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
};

const readJsonStringAt = (raw: string, start: number): { value: string; end: number; closed: boolean } => {
    let escaped = false;
    let source = '';
    for (let index = start; index < raw.length; index++) {
        const char = raw[index];
        if (!escaped && char === '"') return { value: decodeJsonString(source), end: index + 1, closed: true };
        source += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
    }
    return { value: decodeJsonString(source), end: raw.length, closed: false };
};

const salvageTruncatedDiary = (raw: string): { mood: string; paragraphs: CharacterHandbookParagraph[] } | null => {
    const moodMatch = raw.match(/["“]mood["”]\s*:\s*"((?:\\.|[^"\\])*)"/i);
    const mood = moodMatch ? cleanContent(decodeJsonString(moodMatch[1]), 20) : '平静';

    // 新版精简结构：paragraphs 直接是字符串数组，优先按原自然段抢救。
    const paragraphStart = raw.search(/["“]paragraphs["”]\s*:\s*\[/i);
    if (paragraphStart >= 0) {
        let cursor = raw.indexOf('[', paragraphStart) + 1;
        const paragraphs: CharacterHandbookParagraph[] = [];
        while (cursor > 0 && cursor < raw.length && paragraphs.length < 5) {
            while (cursor < raw.length && /[\s,]/.test(raw[cursor])) cursor++;
            if (raw[cursor] !== '"') break;
            const found = readJsonStringAt(raw, cursor + 1);
            const text = cleanContent(found.value, 260);
            if (text) paragraphs.push({ runs: [{ text, style: 'normal' }] });
            cursor = found.end;
            if (!found.closed) break;
        }
        if (paragraphs.length) return { mood, paragraphs };
    }

    // 兼容已经保存的旧版嵌套 runs JSON：只抓完整 text 字段，绝不展示 JSON 源码。
    const runs: CharacterHandbookRun[] = [];
    const matcher = /["“]text["”]\s*:\s*"/gi;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(raw)) && runs.length < 24) {
        const found = readJsonStringAt(raw, matcher.lastIndex);
        const text = cleanContent(found.value, 180);
        const nearby = raw.slice(found.end, Math.min(raw.length, found.end + 100));
        const styleMatch = nearby.match(/["“]style["”]\s*:\s*["“]([a-z]+)["”]/i);
        const style = ALLOWED_STYLES.has(styleMatch?.[1] as CharacterHandbookStyle)
            ? styleMatch![1] as CharacterHandbookStyle
            : 'normal';
        if (text) runs.push({ text, style });
        matcher.lastIndex = Math.max(matcher.lastIndex, found.end);
        if (!found.closed) break;
    }
    if (!runs.length) return null;
    const total = runs.reduce((sum, run) => sum + Array.from(run.text).length, 0);
    const target = Math.max(55, Math.ceil(total / 3));
    const paragraphs: CharacterHandbookParagraph[] = [];
    let current: CharacterHandbookRun[] = [];
    let length = 0;
    runs.forEach((run, index) => {
        current.push(run);
        length += Array.from(run.text).length;
        if ((length >= target && paragraphs.length < 2) || index === runs.length - 1) {
            paragraphs.push({ runs: current });
            current = [];
            length = 0;
        }
    });
    return { mood, paragraphs };
};

export function parseCharacterHandbookDiaryResponse(raw: string): { mood: string; paragraphs: CharacterHandbookParagraph[] } {
    const extracted = extractJson(raw) as any;
    const parsed = extracted?.diary && typeof extracted.diary === 'object' ? extracted.diary : extracted;
    const marks = Array.isArray(parsed?.marks) ? parsed.marks : [];
    const rawParagraphs = Array.isArray(parsed?.paragraphs)
        ? parsed.paragraphs
        : typeof parsed?.body === 'string'
            ? parsed.body.split(/\n{2,}/)
            : [];
    const styleCounts = new Map<CharacterHandbookStyle, number>();
    const paragraphs = rawParagraphs.slice(0, 5).map((paragraph: any) => {
        let sourceRuns: any[] = typeof paragraph === 'string'
            ? [{ text: paragraph, style: 'normal' }]
            : Array.isArray(paragraph?.runs)
                ? paragraph.runs
                : [];
        if (typeof paragraph === 'string') {
            for (const mark of marks) {
                const markedText = cleanContent(mark?.text, 40);
                if (!markedText) continue;
                const nextRuns: any[] = [];
                let applied = false;
                for (const run of sourceRuns) {
                    if (applied || run.style !== 'normal' || !String(run.text).includes(markedText)) {
                        nextRuns.push(run);
                        continue;
                    }
                    const [before, ...afterParts] = String(run.text).split(markedText);
                    const after = afterParts.join(markedText);
                    if (before) nextRuns.push({ text: before, style: 'normal' });
                    nextRuns.push({ text: markedText, style: mark.style });
                    if (after) nextRuns.push({ text: after, style: 'normal' });
                    applied = true;
                }
                sourceRuns = nextRuns;
            }
        }
        return {
            runs: sourceRuns
            .map((run: any) => {
                const text = cleanContent(run?.text, 180);
                let style = ALLOWED_STYLES.has(run?.style) ? run.style as CharacterHandbookStyle : 'normal';
                const used = styleCounts.get(style) || 0;
                if (style !== 'normal' && used >= 2) style = 'normal';
                if (style === 'censored' && (Array.from(text).length < 2 || Array.from(text).length > 5)) style = 'normal';
                styleCounts.set(style, (styleCounts.get(style) || 0) + 1);
                return { text, style };
            })
            .filter((run: CharacterHandbookRun) => run.text),
        };
    }).filter((paragraph: CharacterHandbookParagraph) => paragraph.runs.length);
    if (!paragraphs.length) {
        const stripped = raw.replace(/```(?:json)?|```/gi, '').trim();
        const looksLikeJson = /^\s*[\[{]/.test(stripped) || /["“]paragraphs["”]\s*:/.test(stripped);
        if (looksLikeJson) {
            const salvaged = salvageTruncatedDiary(stripped);
            if (salvaged) return salvaged;
            throw new Error('全局 API 返回的手账正文被截断，请重新生成');
        }
        // 少数兼容接口会无视 JSON 要求直接返回正文。真正的普通文字仍然保留。
        const plainParagraphs = stripped
            .split(/\n{2,}/)
            .map(text => cleanContent(text, 220))
            .filter(text => text && !/^[\[{].*[\]}]$/.test(text))
            .slice(0, 5)
            .map(text => ({ runs: [{ text, style: 'normal' as const }] }));
        if (plainParagraphs.length) return { mood: '平静', paragraphs: plainParagraphs };
        throw new Error('全局 API 没有返回可用的手账正文');
    }
    return {
        mood: cleanContent(parsed.mood, 20) || '平静',
        paragraphs,
    };
}

async function requestGlobalCompletion(apiConfig: APIConfig, prompt: string, maxTokens: number, temperature: number): Promise<string> {
    const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({
            model: apiConfig.model,
            stream: false,
            temperature,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    if (!response.ok) throw new Error(`全局 API 调用失败（HTTP ${response.status}）`);
    const data = await safeResponseJson(response);
    return extractContent(data);
}

async function generateStillLifePrompt(entry: CharacterHandbookEntry, char: CharacterProfile, apiConfig: APIConfig): Promise<string> {
    const diaryText = entry.paragraphs
        .map(paragraph => paragraph.runs.map(run => run.text).join(''))
        .join('\n');
    const prompt = `请根据下面这篇已经完成的角色日记，单独写一条英文生图提示词。它将生成手账顶部的正方形静物贴图。

角色：${char.name}
日期：${entry.date}
天气：${entry.weather.emoji} ${entry.weather.description}${entry.weather.temp == null ? '' : ` / ${entry.weather.temp}℃`}
心情：${entry.mood}
日记正文：
${diaryText}

只描绘日记中确实提到的物品或环境细节，不要添加未发生的事件。只画静物或场景局部，不出现人物、人体、文字、水印、UI。
画面为 1:1 正方形，现代时尚的手账插画或生活摄影感，构图清楚，适合作为小贴图。
只输出一条英文 prompt，不要 JSON，不要标题，不要解释，不要 Markdown。`;
    const raw = await requestGlobalCompletion(apiConfig, prompt, 600, 0.55);
    const cleaned = cleanContent(
        raw.replace(/```(?:text)?|```/gi, '').replace(/^(?:prompt|image prompt)\s*:\s*/i, '').replace(/^['"]|['"]$/g, ''),
        800,
    );
    if (!cleaned) throw new Error('全局 API 没有返回生图提示词');
    return cleaned;
}

export async function generateCharacterHandbookText(input: {
    char: CharacterProfile;
    characters: CharacterProfile[];
    groups: GroupProfile[];
    userProfile: UserProfile;
    apiConfig: APIConfig;
    realtimeConfig: RealtimeConfig;
}): Promise<CharacterHandbookEntry> {
    const { char, characters, groups, userProfile, apiConfig, realtimeConfig } = input;
    if (!apiConfig.baseUrl || !apiConfig.apiKey || !apiConfig.model) throw new Error('请先在设置中配置全局 API、模型和密钥');
    const date = localDiaryDate();
    const [facts, weatherData] = await Promise.all([
        collectTodayFacts(char, characters, groups, userProfile),
        RealtimeContextManager.fetchWeather(realtimeConfig).catch(() => null),
    ]);
    const weather: CharacterHandbookEntry['weather'] = weatherData
        ? { emoji: weatherEmoji(weatherData.icon, weatherData.description), description: weatherData.description, temp: weatherData.temp, city: weatherData.city }
        : { emoji: '🌤️', description: '天气未同步', temp: null };
    const prompt = `你正在以角色「${char.name}」的第一人称写今天的私人手账。默认文风是自然、松弛的日常随笔，不是总结报告，也不是矫情散文；语气、用词和观察角度必须符合角色性格。

角色设定：
${cleanContent(char.description, 1800)}
${cleanContent(char.systemPrompt, 3500)}

今天日期：${date}
天气由客户端固定显示为：${weather.emoji} ${weather.description}${weather.temp == null ? '' : ` / ${weather.temp}℃`}

严格事实规则：下面的素材是唯一允许写成“发生过”的事情。不能补写未出现的见面、礼物、动作、对话或未来事件；素材少就写短一些，可以写基于事实的感受，但不能创造新事实。

今日素材：
${facts.lines.length ? facts.lines.join('\n') : '（今天没有可用聊天、群聊或朋友圈素材。只可简短写“今天没发生太多事情”一类感受，不能编造。）'}

输出一篇 180～260 个中文字符、3～5 个自然段的日常随笔；素材不足时允许短于 180 字。正文必须自然连贯，不要逐条复述素材。paragraphs 直接放每个自然段的完整纯文字，不要再嵌套 runs。
marks 只标记正文中已经原样出现的短语及样式：highlight（荧光高亮）、wave（浪线）、strike（删除线）、censored（涂黑）、emphasis、handwritten、messy。highlight/wave/strike/censored 每种使用 1～2 次；每个 censored 的 text 只能包含 2～5 个汉字。其他样式酌情少量使用。不要输出 HTML 或 Markdown。
这一次只写日记文字，不要生成任何图片描述或生图提示词。

只输出 JSON：
{"mood":"不超过10字的心情","paragraphs":["第一自然段","第二自然段","第三自然段"],"marks":[{"text":"正文中原样出现的短语","style":"highlight|wave|strike|censored|emphasis|handwritten|messy"}]}`;

    // 第一次全局 API：只生成文字。extractContent 同时兼容 OpenAI、Gemini、Claude 中转格式。
    const diaryRaw = await requestGlobalCompletion(apiConfig, prompt, 4096, apiConfig.temperature ?? 0.82);
    const result = parseCharacterHandbookDiaryResponse(diaryRaw);
    let entry: CharacterHandbookEntry = {
        id: `${char.id}:${date}`,
        charId: char.id,
        date,
        createdAt: Date.now(),
        mood: result.mood,
        weather,
        paragraphs: result.paragraphs,
        stillLifePrompt: 'a quiet tabletop still life inspired by today, square composition, no people, no text',
        sourceIds: facts.ids,
        imageStatus: char.novelAiImageGeneration?.enabled && apiConfig.novelAiImageGeneration ? 'generating' : 'none',
        schemaVersion: 1,
    };
    // 文字先落盘。第二次全局 API 只负责提示词，失败也不会让已经生成的文字消失。
    await saveCharacterHandbook(entry);
    try {
        entry = { ...entry, stillLifePrompt: await generateStillLifePrompt(entry, char, apiConfig) };
        await saveCharacterHandbook(entry);
    } catch (error) {
        console.warn('[Handbook] image prompt generation failed, using fallback:', error);
    }
    return entry;
}

async function storeHandbookImage(
    image: Blob | string,
    entry: CharacterHandbookEntry,
    char: CharacterProfile,
    kind: 'still' | 'chibi',
): Promise<string> {
    const ref = typeof image === 'string' ? image : await putImageBlob(image);
    const label = kind === 'still' ? '静物方图' : 'Q版人物竖图';
    const gallery: GalleryImage = {
        id: `handbook-${entry.charId}-${entry.date}-${kind}`,
        charId: entry.charId,
        url: ref,
        timestamp: Date.now(),
        savedDate: entry.date,
        chatContext: [`[手账本 · ${entry.date} · ${label}]`, `心情：${entry.mood}`],
    };
    await DB.saveGalleryImage(gallery);
    return ref;
}

export async function generateAndSaveHandbookImages(
    entry: CharacterHandbookEntry,
    char: CharacterProfile,
    apiConfig: APIConfig,
    onUpdate?: (entry: CharacterHandbookEntry) => void,
): Promise<CharacterHandbookEntry> {
    const api = apiConfig.novelAiImageGeneration;
    const cfg = char.novelAiImageGeneration;
    if (!api || !cfg?.enabled) {
        const withoutImages = { ...entry, imageStatus: 'none' as const };
        await saveCharacterHandbook(withoutImages);
        onUpdate?.(withoutImages);
        return withoutImages;
    }
    const chibiPreset = resolveHandbookChibiPreset(await loadHandbookChibiSettings());
    let current = { ...entry, imageStatus: 'generating' as const };
    const update = async (patch: Partial<CharacterHandbookEntry>) => {
        current = { ...current, ...patch };
        await saveCharacterHandbook(current);
        onUpdate?.(current);
    };
    let failures = 0;
    try {
        const still = await generateNovelAiImage(
            { ...api, width: 1024, height: 1024 },
            { ...cfg, characterTags: '', userTags: '', referenceImageUrl: undefined },
            { prompt: `${entry.stillLifePrompt}, square composition, stylish modern journal illustration, still life only, no people, no text, no watermark`, selfie: false },
        );
        await update({ stillImage: await storeHandbookImage(still, entry, char, 'still') });
    } catch (error) {
        failures += 1;
        console.warn('[Handbook] still-life generation failed:', error);
    }
    try {
        const chibi = await generateNovelAiImage(
            {
                ...api,
                width: 768,
                height: 1024,
                sampler: chibiPreset.sampler,
                steps: chibiPreset.steps,
                scale: chibiPreset.scale,
            },
            {
                ...cfg,
                styleTags: chibiPreset.styleTags,
                qualityTags: chibiPreset.qualityTags,
                negativeTags: chibiPreset.negativeTags,
                userTags: '',
            },
            { prompt: `one full-body chibi version of ${char.name}, mood: ${entry.mood}, expressive relaxed pose, fashionable cute sticker illustration, pure white background, centered composition, 3:4 portrait, no text, no watermark`, selfie: false },
        );
        await update({ chibiImage: await storeHandbookImage(chibi, entry, char, 'chibi') });
    } catch (error) {
        failures += 1;
        console.warn('[Handbook] chibi generation failed:', error);
    }
    const imageStatus: CharacterHandbookEntry['imageStatus'] = failures === 0 ? 'ready' : failures === 1 ? 'partial' : 'failed';
    await update({ imageStatus });
    return current;
}
