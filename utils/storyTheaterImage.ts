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
    sharedAction?: string;
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
    if (count === 3) return ['a3', 'c3', 'e3'];
    return ['b2', 'd2', 'b4', 'd4'];
};

const CHARACTER_SUBJECTS: Record<string, { singular: string; plural: string }> = {
    girl: { singular: 'girl', plural: 'girls' },
    boy: { singular: 'boy', plural: 'boys' },
    woman: { singular: 'woman', plural: 'women' },
    man: { singular: 'man', plural: 'men' },
    milf: { singular: 'milf', plural: 'milfs' },
    dilf: { singular: 'dilf', plural: 'dilfs' },
    other: { singular: 'other', plural: 'others' },
};

const parseCharacterSubject = (tag: string): string => {
    const compact = tag.trim().toLowerCase().replace(/\s+/g, '');
    const match = compact.match(/^1?(girl|boy|woman|man|milf|dilf|other)$/);
    return match?.[1] || '';
};

const normalizeCharacterAnchor = (value: unknown): string => cleanTags(value)
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => {
        const subject = parseCharacterSubject(tag);
        return subject ? CHARACTER_SUBJECTS[subject].singular : tag;
    })
    .join(', ');

/**
 * V4 多人物时，固定外貌必须比本轮动作更难被覆盖。保留人物类别在权重组外，
 * 这样基础提示词仍能可靠统计 1girl / 2boys；其余固定锚点整体提高权重。
 */
const strengthenCharacterAnchor = (value: unknown): string => {
    const tags = normalizeCharacterAnchor(value).split(',').map(tag => tag.trim()).filter(Boolean);
    const subjectIndex = tags.findIndex(tag => !!parseCharacterSubject(tag));
    const subject = subjectIndex >= 0 ? tags.splice(subjectIndex, 1)[0] : '';
    const identity = tags.length ? `1.35::${tags.join(', ')}::` : '';
    return [subject, identity].filter(Boolean).join(', ');
};

const identityLeakTags = (value: string): string[] => value
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => /(?:hair|eyes?|iris|pupil|skin|freckles?|scar|mole|tattoo|horns?|ears?|tail)/i.test(tag));

const removeGeneratedIdentityTags = (value: unknown): string => cleanTags(value)
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
    .filter(tag => !parseCharacterSubject(tag))
    .filter(tag => !/(?:hair|eyes?|iris|pupil|skin|freckles?|scar|mole|tattoo|horns?|ears?|tail)/i.test(tag))
    .join(', ');

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
    const plans = source.slice(0, 4).map((character, index) => {
        const participant = participants.find(person => person.key === character?.key || person.name === character?.name)
            || selected[index];
        if (!participant) return null;
        // The planner may repeat or hallucinate identity tags. Fixed anchors are the
        // source of truth; the generated slot is allowed to add only clothing/action.
        const prompt = [strengthenCharacterAnchor(participant.anchor), removeGeneratedIdentityTags(character?.prompt || character?.tags || character?.action || character?.roleAction)]
            .filter(Boolean).join(', ');
        if (!prompt) return null;
        return {
            key: participant.key,
            prompt,
            negative: cleanTags(character?.negative || character?.uc),
            center: parseStoryImageCenter(character?.center, defaultCenterCodes(source.length)[index] || 'c3'),
        };
    }).filter((character): character is StoryImageCharacterPlan => Boolean(character));
    return plans.map(character => {
        const ownTags = new Set(identityLeakTags(character.prompt).map(tag => tag.toLowerCase()));
        const otherIdentityTags = plans
            .filter(other => other.key !== character.key)
            .flatMap(other => identityLeakTags(other.prompt))
            .filter(tag => !ownTags.has(tag.toLowerCase()));
        return {
            ...character,
            negative: cleanTags([character.negative, ...otherIdentityTags].filter(Boolean).join(', ')),
        };
    });
};

const extractStoryImageBlocks = (raw: string): string[] => {
    const source = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
    const blocks: string[] = [];
    const wrapped = /<image>\s*image###([\s\S]*?)###\s*<\/image>/gi;
    let match: RegExpExecArray | null;
    while ((match = wrapped.exec(source)) && blocks.length < 2) blocks.push(match[1].trim());
    if (blocks.length) return blocks;
    const bare = /image###([\s\S]*?)###/gi;
    while ((match = bare.exec(source)) && blocks.length < 2) blocks.push(match[1].trim());
    return blocks;
};

const readProtocolField = (block: string, label: string): string => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = block.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]*)(?=;|$)`, 'i'));
    return cleanTags(match?.[1]);
};

const parseProtocolCharacterSlot = (value: string): { prompt: string; center: string } => {
    const centerMatch = value.match(/\|\s*centers?\s*:\s*([a-e][1-5]|auto)/i);
    return {
        prompt: cleanTags(value.replace(/\|\s*centers?\s*:\s*(?:[a-e][1-5]|auto)/ig, '')),
        center: centerMatch?.[1]?.toLowerCase() === 'auto' ? 'c3' : (centerMatch?.[1] || ''),
    };
};

/** Parse the Tavern Scene Plugin / worldbook semicolon protocol. */
export function parseStoryImageProtocol(raw: string, participants: StoryImageParticipant[]): { state: StoryImageState; frames: StoryImageFramePlan[] } | null {
    const blocks = extractStoryImageBlocks(raw);
    if (!blocks.length) return null;
    const titles = ['动作变化帧', '关系高光帧'];
    const descriptions = ['本轮动作变化最明显的一瞬间', '本轮最值得描绘的互动瞬间'];
    const frames = blocks.map((block, frameIndex) => {
        const sceneComposition = readProtocolField(block, 'Scene Composition');
        const slots: Array<{ key: string; prompt: string; negative: string; center: string }> = [];
        const used = new Set<string>();
        for (let index = 1; index <= Math.min(4, participants.length); index += 1) {
            const rawPrompt = readProtocolField(block, `Character ${index} Prompt`);
            if (!rawPrompt) continue;
            const parsedSlot = parseProtocolCharacterSlot(rawPrompt);
            const lower = parsedSlot.prompt.toLowerCase();
            const matched = participants.find(person => !used.has(person.key) && (
                lower.includes(person.key.toLowerCase()) || lower.includes(person.name.toLowerCase())
            )) || participants.find(person => !used.has(person.key));
            if (!matched) continue;
            used.add(matched.key);
            const withoutLocator = parsedSlot.prompt
                .replace(new RegExp(matched.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '')
                .replace(new RegExp(matched.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '');
            slots.push({
                key: matched.key,
                prompt: cleanTags(withoutLocator),
                negative: readProtocolField(block, `Character ${index} UC`),
                center: parsedSlot.center || defaultCenterCodes(participants.length)[index - 1] || 'c3',
            });
        }
        const visible = slots.map(slot => slot.key);
        const plan = parseStoryImagePromptPlan(JSON.stringify({ visible, sceneTags: sceneComposition }), participants);
        return {
            ...plan,
            kind: (frameIndex === 0 ? 'motion' : 'highlight') as 'motion' | 'highlight',
            title: titles[frameIndex] || '剧情关键帧',
            description: descriptions[frameIndex] || '本轮剧情关键帧',
            characters: buildStoryImageCharacterPlans(slots, plan.visible, participants),
        };
    }).filter(frame => frame.sceneTags && frame.characters.length > 0);
    if (!frames.length) return null;
    const visibleKeys = [...new Set(frames.flatMap(frame => frame.visible))];
    const state: StoryImageState = {
        location: frames[0].sceneTags,
        time: '', lighting: '', atmosphere: '',
        cast: participants.filter(person => visibleKeys.includes(person.key)).map(person => ({
            key: person.key, name: person.name, clothing: person.anchor || '人物锚点未填写', position: '', pose: '', expression: '',
        })),
        continuityChange: frames[0].description,
        frames: frames.map(frame => ({ kind: frame.kind, title: frame.title, description: frame.description, visible: frame.visible })),
    };
    return { state, frames };
}

export function parseStoryImageStoryboard(raw: string, participants: Array<{ key: string; name: string; anchor: string }>, strict = false): { state: StoryImageState; frames: StoryImageFramePlan[] } {
    const protocol = parseStoryImageProtocol(raw, participants);
    if (protocol) {
        if (strict && protocol.frames.length < 2) throw new Error('生图导演只返回了一张配图段落；已停止生图，未消耗 NAI 次数');
        return protocol;
    }
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
        const sharedAction = cleanTags(frame?.sharedAction);
        const sceneComposition = cleanTags(frame?.sceneComposition);
        const usesUnifiedAction = Boolean(sharedAction || sceneComposition);
        const sceneTags = usesUnifiedAction
            ? [sharedAction, sceneComposition].filter(Boolean).join(', ')
            : cleanTags(frame?.sceneTags || frame?.tags);
        const plan = parseStoryImagePromptPlan(JSON.stringify({ visible, sceneTags }), participants);
        const characterInputs = usesUnifiedAction
            ? rawCharacters.map((character: any) => ({
                key: character?.key,
                name: character?.name,
                center: character?.center,
                action: character?.action || character?.roleAction,
                negative: character?.negative || character?.uc,
            }))
            : rawCharacters;
        return {
            ...plan,
            sharedAction,
            characters: buildStoryImageCharacterPlans(characterInputs, plan.visible, participants),
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
            clothing: cleanText(person?.appearance || person?.clothing, participant?.anchor || '人物锚点未填写'),
            position: String(person?.position || '').trim(),
            pose: String(person?.pose || '').trim(),
            expression: String(person?.expression || '').trim(),
        };
    });
    const state: StoryImageState = {
        location: cleanText(scene.location || parsed.location, '沿用当前剧情场景'),
        time: String(scene.time || parsed.time || '').trim(),
        lighting: String(scene.lighting || parsed.lighting || '').trim(),
        atmosphere: String(scene.atmosphere || parsed.atmosphere || '').trim(),
        cast,
        continuityChange: cleanText(parsed.continuityChange || parsed.change, '本轮没有明确的视觉状态变化'),
        frames: frames.map(frame => ({ kind: frame.kind, title: frame.title, description: frame.description, visible: frame.visible })),
    };
    if (strict) {
        const sceneValues = [state.location, state.continuityChange];
        const invalidScene = sceneValues.some(value => !value.trim() || isPlaceholder(value));
        const invalidCast = state.cast.length === 0 || state.cast.some(person => !person.clothing.trim() || isPlaceholder(person.clothing));
        const invalidFrames = rawFrames.length < 2 || frames.length < 2 || frames.some((frame, index) =>
            frame.sceneTags.length < 24
            || !frame.sharedAction
            || !frame.description.trim()
            || isPlaceholder(frame.description)
            || frame.characters.length === 0
            || frame.characters.some(character => character.prompt.length < 12)
            || !Array.isArray(rawFrames[index]?.characters)
            || rawFrames[index].characters.some((character: any) => cleanTags(character?.action || character?.roleAction).length < 4)
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
                'You are a dedicated NovelAI prompt compiler for a story. All depicted characters are adults. Your output goes directly to the image API; do not write a literary status report.',
                'Read the newest round and previous visual state. Choose two concrete frozen instants. The priorities are: (1) fixed participant identity, (2) one readable group action, (3) a short physical location and camera composition.',
                'Preserve identity anchors exactly. They are authoritative and will be injected by code after your text is parsed.',
                'Return exactly TWO single-line Tavern Scene Plugin blocks and nothing else. Do NOT return JSON or Markdown:',
                '<image>image###Scene Composition: 1girl, 2boys, bedroom, full body; Character 1 Prompt: user, 沈欢, clothing, pose, expression, (source#action)|centers:a3; Character 1 UC: exclusions; Character 2 Prompt: character:id, name, clothing, pose, expression, (target#action)|centers:c3; Character 2 UC: exclusions;###</image>',
                '<image>image###Scene Composition: 1girl, 2boys, bedroom, three-quarter body; Character 1 Prompt: user, 沈欢, clothing, pose, expression, (source#action)|centers:a3; Character 1 UC: exclusions; Character 2 Prompt: character:id, name, clothing, pose, expression, (target#action)|centers:c3; Character 2 UC: exclusions;###</image>',
                'IMAGE PRIORITY: if the newest round explicitly contains a photo/video/live-stream image, depict that media frame first. Otherwise choose the strongest relationship/action beat. In an explicit adult scene, choose the clearest visually legible sensual beat; add nsfw to sceneComposition only when explicit anatomy is actually visible.',
                'Block 1 captures the largest movement or spatial change. Block 2 captures a different relationship high point. Describe one instant per block, never a sequence. Pick the framing needed to make the action readable; do not default to portraits or headshots.',
                'Scene Composition is deliberately short: exact subject counts + bed/sofa/bathroom/wall or similarly simple placement + one camera framing. Do not add decorative background, weather, cinematic lighting, props or scenery unless needed to understand the action.',
                'Each Character N Prompt is one participant\'s role in the SAME group action: first copy that participant key and name exactly, then clothing, body pose, hand placement, expression, and paired (source#action)/(target#action) or (mutual#action) tags. Follow PARTICIPANTS order and include only visible people. Never output a Character slot for an absent person.',
                'Do not write hair, eye color, age, skin or other identity traits in Character Prompt. Code injects the fixed identity anchor and discards generated identity traits, so character identity cannot be changed here.',
                'centers uses the 5x5 grid a1-e5. Use b3/d3 for two separated people, a3/c3/e3 for three, and c3/c3 or c3/d3 for overlapping contact.',
                'Every field ends with a semicolon. Do not omit Scene Composition, Character Prompt, Character UC, centers, image###, ### or </image>. No prose, explanations, dialogue, captions, UI or watermark outside the two blocks.',
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

export function buildStoryFrameMainPrompt(frame: StoryImageFramePlan): string {
    const counts = new Map<string, number>();
    for (const character of frame.characters || []) {
        const subject = character.prompt.split(',').map(parseCharacterSubject).find(Boolean);
        if (subject) counts.set(subject, (counts.get(subject) || 0) + 1);
    }
    const subjectCount = [...counts.entries()].map(([subject, count]) => {
        const labels = CHARACTER_SUBJECTS[subject];
        return `${count}${count === 1 ? labels.singular : labels.plural}`;
    }).join(', ') || `${Math.max(1, frame.characters?.length || 1)}people`;
    const sceneWithoutCounts = frame.sceneTags.split(',')
        .map(tag => tag.trim())
        .filter(tag => !/^\d+\s*(?:girls?|boys?|women|men|milfs?|dilfs?|others?|people)$/i.test(tag))
        .join(', ');
    return [subjectCount, sceneWithoutCounts]
        .map(part => part.trim())
        .filter(Boolean)
        .join(', ');
}

const packedCharacterPosition = (character: StoryImageCharacterPlan, index: number, total: number): string => {
    if (total === 1) return 'center';
    if (character.center.x <= 0.3) return 'left';
    if (character.center.x >= 0.7) return 'right';
    return index === 0 ? 'left' : index === total - 1 ? 'right' : 'center';
};

const characterIdentityOnly = (prompt: string): string => {
    const match = prompt.match(/^\s*(girl|boy|woman|man|milf|dilf|other)\s*,\s*(1\.35::[\s\S]*?::)(?:\s*,|$)/i);
    return match ? `${match[1]}, ${match[2]}` : prompt;
};

/**
 * Put every visible person's identity in one ordinary base prompt. Native V4 character
 * captions are still sent as a spatial aid, but the image no longer depends on a relay
 * preserving those nested fields in order to see hair/eye colors at all.
 */
export function buildStoryFramePackedPrompt(frame: StoryImageFramePlan): string {
    const main = buildStoryFrameMainPrompt(frame);
    const characters = frame.characters || [];
    if (!characters.length) return main;
    const identityLine = characters.map((character, index) => {
        const position = packedCharacterPosition(character, index, characters.length);
        return `${position} character: ${characterIdentityOnly(character.prompt)}`;
    }).join('; ');
    return `${main}, ${characters.length} distinct characters, fixed identity lineup from left to right, ${identityLine}`;
}

export async function generateStoryTheaterFrameImage(apiConfig: APIConfig, entry: StoryTheaterEntry, frame: StoryImageFramePlan | string): Promise<Blob | string> {
    const novelApi = apiConfig.novelAiImageGeneration;
    if (!novelApi?.baseUrl?.trim() || !novelApi.apiKey?.trim() || !novelApi.model?.trim()) throw new Error('全局生图 2.0 的 URL、API Key 或模型尚未配置完整');
    const structuredCharacters = typeof frame === 'string' || !Array.isArray(frame.characters)
        ? []
        : frame.characters;
    const directive: ImageGenerationDirective = typeof frame === 'string'
        ? { prompt: frame, selfie: false, includeUser: false }
        : {
            // Some compatible relays silently discard NovelAI V4 char_captions. Keep the
            // native character prompts, but also lead the base prompt with weighted identity
            // anchors so hair, eyes and other fixed traits survive those relays.
            prompt: structuredCharacters.length > 0 ? buildStoryFramePackedPrompt(frame) : frame.finalPrompt,
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
        body: JSON.stringify({ model: options.apiConfig.model, messages: buildStoryImagePlanningMessages(options), stream: false, temperature: 0.15, max_tokens: 2200 }),
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
