import type { APIConfig, CharacterExportData, CharacterProfile, UserProfile } from '../types';
import { extractContent, extractJson, safeFetchJson } from './safeApi';
import { stripSensitiveCardFields } from './characterCard';

export type MihuiGender = 'male' | 'female' | 'any' | 'custom';
export type MihuiStage = '初识' | '熟悉' | '暧昧' | '心动' | '密友';
export type MihuiThemeId = 'noir' | 'pink' | 'crimson';

export interface MihuiPreferences {
    gender: MihuiGender;
    customGender: string;
    ageMin: number;
    ageMax: number;
    occupations: string;
    appearance: string;
    style: string;
    relationship: string;
    custom: string;
}

export interface MihuiPersona {
    name: string;
    age: number;
    gender: string;
    occupation: string;
    city: string;
    appearance: string;
    personality: string;
    socialStyle: string;
    relationshipIntent: string;
    background: string;
    greeting: string;
}

export interface MihuiMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    type?: 'text' | 'image' | 'location';
    location?: {
        name: string;
        address?: string;
    };
    /** 同一次模型回复拆出的气泡共享此 id，重新生成时按整轮替换。 */
    turnId?: string;
}

export interface MihuiSession {
    id: string;
    persona: MihuiPersona;
    messages: MihuiMessage[];
    affinity: number;
    createdAt: number;
    updatedAt: number;
    graduatedAt?: number;
    /** 复用原生见面模式的内部角色 id；同一密会对象始终续接同一份见面存档。 */
    linkedCharacterId?: string;
    /** 快速匹配彩蛋：后台绑定真实角色，揭晓前 UI 只使用 persona 化名资料。 */
    familiar?: {
        characterId: string;
        realName: string;
        avatar?: string;
        description: string;
        systemPrompt: string;
        worldview?: string;
        revealedAt?: number;
        revealLine?: string;
        syncedAt?: number;
    };
}

export interface MihuiState {
    version: 1;
    preferences: MihuiPreferences;
    sessions: MihuiSession[];
    activeSessionId?: string;
    /** 只作用于密会 App，不跟随也不覆盖系统或聊天美化。 */
    theme: MihuiThemeId;
}

export const MIHUI_STORAGE_KEY = 'morpho_mihui_v1';

export const DEFAULT_MIHUI_PREFERENCES: MihuiPreferences = {
    gender: 'any',
    customGender: '',
    ageMin: 22,
    ageMax: 38,
    occupations: '',
    appearance: '',
    style: '',
    relationship: '',
    custom: '',
};

export const DEFAULT_MIHUI_STATE: MihuiState = {
    version: 1,
    preferences: DEFAULT_MIHUI_PREFERENCES,
    sessions: [],
    theme: 'noir',
};

export function loadMihuiState(): MihuiState {
    if (typeof window === 'undefined') return DEFAULT_MIHUI_STATE;
    try {
        const parsed = JSON.parse(localStorage.getItem(MIHUI_STORAGE_KEY) || 'null');
        if (!parsed || parsed.version !== 1) return DEFAULT_MIHUI_STATE;
        return {
            version: 1,
            preferences: { ...DEFAULT_MIHUI_PREFERENCES, ...(parsed.preferences || {}) },
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
            activeSessionId: parsed.activeSessionId,
            theme: ['noir', 'pink', 'crimson'].includes(parsed.theme) ? parsed.theme : 'noir',
        };
    } catch {
        return DEFAULT_MIHUI_STATE;
    }
}

export function saveMihuiState(state: MihuiState): void {
    try {
        localStorage.setItem(MIHUI_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('[Mihui] 保存本地会话失败（可能是照片占用空间过大）', error);
    }
}

const boundedText = (value: unknown, fallback = '', max = 800): string => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return (text || fallback).slice(0, max);
};

export function extractJsonObject(raw: string): any {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const unwrap = (value: any): any => {
        if (Array.isArray(value)) return value[0] ?? {};
        if (!value || typeof value !== 'object') return value;
        for (const key of ['persona', 'profile', 'character', 'data', 'result']) {
            const nested = value[key];
            if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
        }
        return value;
    };

    const parsed = extractJson(cleaned);
    if (parsed && typeof parsed === 'object') return unwrap(parsed);

    const start = cleaned.indexOf('{');
    if (start < 0) throw new Error('模型没有返回人物档案 JSON');

    // 部分中转/模型会在最后一个字段中途触发长度截断。人物档案的所有字段在
    // normalizePersona 中都有安全默认值，因此保留已经完整返回的字段，比让整次匹配失败更合理。
    let candidate = cleaned.slice(start).replace(/```[\s\S]*$/i, '').trim();
    const stack: Array<'{' | '['> = [];
    let quoted = false, escaped = false;
    for (let i = 0; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') quoted = false;
            continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}') {
            if (stack[stack.length - 1] === '{') stack.pop();
        } else if (ch === ']') {
            if (stack[stack.length - 1] === '[') stack.pop();
        }
    }

    if (quoted) {
        // 截断点恰好落在转义符之后时，先去掉悬空反斜杠再闭合字符串。
        if (escaped && candidate.endsWith('\\')) candidate = candidate.slice(0, -1);
        candidate += '"';
    }
    candidate = candidate.replace(/,\s*$/, '').replace(/:\s*$/, ': ""');
    for (let i = stack.length - 1; i >= 0; i -= 1) candidate += stack[i] === '{' ? '}' : ']';

    const repaired = extractJson(candidate);
    if (repaired && typeof repaired === 'object') return unwrap(repaired);
    throw new Error('模型返回的人物档案不完整');
}

export function normalizePersona(raw: any, prefs: MihuiPreferences): MihuiPersona {
    const min = Math.max(18, Math.min(99, Math.round(Number(prefs.ageMin) || 22)));
    const max = Math.max(min, Math.min(99, Math.round(Number(prefs.ageMax) || 38)));
    const age = Math.max(min, Math.min(max, Math.round(Number(raw?.age) || min)));
    return {
        name: boundedText(raw?.name, '未命名来客', 24),
        age,
        gender: boundedText(raw?.gender, '成年人', 20),
        occupation: boundedText(raw?.occupation, '自由职业', 60),
        city: boundedText(raw?.city, '同城', 40),
        appearance: boundedText(raw?.appearance, '衣着干净，气质自然', 220),
        personality: boundedText(raw?.personality, '有自己的边界，也愿意认真交流', 220),
        socialStyle: boundedText(raw?.socialStyle, '自然直接', 120),
        relationshipIntent: boundedText(raw?.relationshipIntent, '先从聊天开始', 120),
        background: boundedText(raw?.background, '生活稳定，有自己的日常与社交圈。', 380),
        greeting: boundedText(raw?.greeting, '刚刚看到你的资料。现在方便聊两句吗？', 220),
    };
}

const callGlobalApi = async (
    api: APIConfig,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }>,
    temperature = 0.85,
    maxTokens = 1800,
): Promise<string> => {
    if (!api.baseUrl || !api.model) throw new Error('请先在设置中配置全局 API 和模型');
    const endpoint = `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const data = await safeFetchJson(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model: api.model,
            messages,
            temperature: api.temperature ?? temperature,
            max_tokens: maxTokens,
            stream: false,
        }),
    }, 0, 60000, { appId: 'mihui', appName: '密会', purpose: '匹配或聊天' });
    const content = extractContent(data).trim();
    if (!content) throw new Error('模型没有返回内容');
    return content;
};

const genderLine = (prefs: MihuiPreferences): string => {
    if (prefs.gender === 'male') return '男性';
    if (prefs.gender === 'female') return '女性';
    if (prefs.gender === 'custom') return prefs.customGender.trim() || '由自定义要求决定';
    return '不限；结合用户资料匹配合适的成年人。若资料无法判断用户性别与取向，就随机生成。';
};

export async function generateMihuiPersona(
    api: APIConfig,
    user: UserProfile,
    prefs: MihuiPreferences,
    quickMatch = false,
): Promise<MihuiPersona> {
    const preferenceText = `匹配性别：${genderLine(prefs)}\n年龄：${prefs.ageMin}-${prefs.ageMax}\n职业偏好：${prefs.occupations || '不限'}\n外貌偏好：${prefs.appearance || '不限'}\n相处风格：${prefs.style || '不限'}\n关系倾向：${prefs.relationship || '先聊天了解'}\n补充：${prefs.custom || '无'}`;
    const raw = await callGlobalApi(api, [
        {
            role: 'system',
            content: `你是虚构同城交友软件「密会」的匹配导演。生成一个有生活感、有边界、有缺点的虚构成年人物，禁止未成年人。人物不是服务用户的工具，不要完美迎合，也不要写成夸张霸总。只输出一个合法、完整的 JSON 对象，不要 markdown，不要解释，不要在 JSON 前后添加文字。字段必须且只能为：name, age, gender, occupation, city, appearance, personality, socialStyle, relationshipIntent, background, greeting。除 age 外均为字符串；每个字段用一至两句短句，总输出控制在 1000 个汉字以内，务必闭合最后的花括号。greeting 是这个人物匹配成功后主动发来的第一句话，要自然、短、能接话，不能像客服或人物介绍。`,
        },
        {
            role: 'user',
            content: `用户姓名：${user.name || '未命名'}\n用户资料：${user.bio || '没有填写'}\n模式：${quickMatch ? '快速匹配，优先结合用户资料推断合适对象；无法判断时随机' : '按明确偏好匹配'}\n${preferenceText}`,
        },
    ], 0.95, 1600);
    return normalizePersona(extractJsonObject(raw), prefs);
}

/**
 * 快速匹配的 1/3 熟人彩蛋。random 可注入，便于锁住概率与降权规则的测试。
 * 密会为见面临时创建的角色不应再次被当成“已有熟人”抽中。
 */
export function pickMihuiFamiliar(
    characters: CharacterProfile[],
    sessions: MihuiSession[],
    random: () => number = Math.random,
): CharacterProfile | undefined {
    if (random() >= 1 / 3) return undefined;
    const generatedMeetingIds = new Set(sessions
        .filter(session => session.linkedCharacterId && session.familiar?.characterId !== session.linkedCharacterId)
        .map(session => session.linkedCharacterId as string));
    const eligible = characters.filter(character => character.name?.trim()
        && character.name !== 'New Character'
        && !generatedMeetingIds.has(character.id));
    if (!eligible.length) return undefined;

    const hitCounts = new Map<string, number>();
    sessions.slice(0, 8).forEach(session => {
        const id = session.familiar?.characterId;
        if (id) hitCounts.set(id, (hitCounts.get(id) || 0) + 1);
    });
    const latestId = sessions.find(session => session.familiar)?.familiar?.characterId;
    const weighted = eligible.map(character => ({
        character,
        weight: (latestId === character.id ? 0.12 : 1) / (1 + (hitCounts.get(character.id) || 0) * 2),
    }));
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let cursor = random() * total;
    for (const item of weighted) {
        cursor -= item.weight;
        if (cursor <= 0) return item.character;
    }
    return weighted[weighted.length - 1]?.character;
}

export async function generateMihuiFamiliarPersona(
    api: APIConfig,
    user: UserProfile,
    character: CharacterProfile,
    prefs: MihuiPreferences,
): Promise<MihuiPersona> {
    const raw = await callGlobalApi(api, [
        {
            role: 'system',
            content: `你是虚构同城交友软件「密会」的伪装导演。下面给你的是真实成年角色卡。请保留这个人的核心性格、说话习惯、边界与对用户的既有感情，但替 ta 制作一套不容易被立刻认出的临时交友资料：必须改用新的自然中文化名；职业、城市与背景可做合理模糊或伪装；头像不会展示；开场白要像 ta 故意换了身份来试探用户，允许有极轻微熟悉感，但绝不能直接说出真名、原职业、共同经历或暴露“我是熟人”。只输出合法 JSON，不要 markdown。字段必须为：name, age, gender, occupation, city, appearance, personality, socialStyle, relationshipIntent, background, greeting。所有人物均为成年人。`,
        },
        {
            role: 'user',
            content: `用户：${user.name || '用户'}\n用户资料：${user.bio || '未填写'}\n真实角色名（只供后台理解，严禁输出）：${character.name}\n真实角色简介：${character.description || '无'}\n真实角色核心设定：${character.systemPrompt || '无'}\n世界观与关系：${character.worldview || '无'}\n用户当前快速匹配偏好：${genderLine(prefs)}，${prefs.ageMin}-${prefs.ageMax}岁。`,
        },
    ], 0.9, 1600);
    const persona = normalizePersona(extractJsonObject(raw), prefs);
    // 模型偶尔会偷懒沿用真名；本地再清一遍所有可见字段，避免开场白或背景直接穿帮。
    const trueName = character.name.trim();
    const redact = (value: string) => trueName ? value.split(trueName).join('某人') : value;
    (Object.keys(persona) as Array<keyof MihuiPersona>).forEach(key => {
        if (typeof persona[key] === 'string') (persona as any)[key] = redact(persona[key] as string);
    });
    if (!persona.name.trim() || persona.name.includes('某人')) persona.name = '林默';
    return persona;
}

export interface MihuiReplyResult {
    bubbles: string[];
    signal: 'warm' | 'neutral' | 'cool';
}

export const MIHUI_KAOMOJI = [
    '˶ᗜ - ᗜ˶ಣ', '⩌⤙⩌', 'ᗜ⩊ᗜ', 'ᗜ - ᗜ', 'ᗜ ‸ ᗜ', 'ᗜ^ᗜ', '˵>ㅿ<˵', 'ᗜ ˰ ᗜ',
    '╸▵╺', 'ᗜ⤚ᗜ', '⁃̀⩊⁃́', '⁃̀ 𐋣 ⁃́', 'ᗜ - ᗜ.', '՞⩌⌯⩌՞', '￣へ￣', 'ᗜへᗜ',
    'ᗜᴖᗜ', 'ᗜᴗᗜ', '⩌⌯⩌', 'ᗜ﹁ᗜ', 'ᗜ﹃ᗜ', 'ᗜ ֊ ᗜ', 'ᗜ◞ᗜ', 'ᗜ - ᗜꐦ',
    'ᗜ 𖥦 ᗜ', '˶ᗜ ▵ ᗜ˶', '₌ ᗜ - ᗜ ₌', '=⩌⩊⩌=', '˶ᗜ𐃷ᗜ˶ಣ', '.ᗜ ◞ ᗜ',
    '◂ ᗜ ˰ ᗜ ▾ಎ↝', '⩌⩊⩌', 'ᗜ⌯ᗜ̥̥', '՞⩌⌯⩌՞ ᶻ', 'ᗜ×ᗜ', '꒰ᐡ⩌⤙⩌ᐡ꒱',
    '=ᗜωᗜ=', '꧞ ˃ 𛱊 ˂', '૮ ៸៸៸ᗜ ~ ᗜ៸៸៸ ა', '⩌ ֊ ⩌',
] as const;

const splitReplyText = (value: unknown): string[] => {
    const text = String(value ?? '').replace(/```(?:json)?|```/gi, '').trim();
    if (!text) return [];
    const paragraphs = text.split(/\n+|\s*\|{2,}\s*/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (paragraphs.length > 1) return paragraphs.slice(0, 3).map(item => item.slice(0, 420));

    const single = paragraphs[0] || text;
    const sentences = single.match(/[^。！？!?…]+[。！？!?…]*/g)?.map(item => item.trim()).filter(Boolean) || [single];
    const desired = single.length > 120 ? 3 : single.length > 58 ? 2 : 1;
    if (desired === 1 || sentences.length === 1) return [single.slice(0, 420)];
    const groups = Array.from({ length: Math.min(desired, sentences.length) }, () => '');
    sentences.forEach((sentence, index) => {
        const target = Math.min(groups.length - 1, Math.floor(index * groups.length / sentences.length));
        groups[target] += sentence;
    });
    return groups.map(item => item.trim().slice(0, 420)).filter(Boolean);
};

export function normalizeMihuiReply(raw: unknown): MihuiReplyResult {
    const parsed = typeof raw === 'string' ? (() => {
        try { return extractJsonObject(raw); } catch { return { reply: raw }; }
    })() : raw as any;
    const signal = ['warm', 'neutral', 'cool'].includes(parsed?.signal) ? parsed.signal : 'neutral';
    const candidate = Array.isArray(parsed?.bubbles) && parsed.bubbles.length > 0
        ? parsed.bubbles
        : parsed?.reply;
    const bubbles = (Array.isArray(candidate) ? candidate.flatMap(splitReplyText) : splitReplyText(candidate))
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 3);
    return { bubbles: bubbles.length ? bubbles : ['嗯？你继续说。'], signal } as MihuiReplyResult;
}

export async function generateMihuiReply(
    api: APIConfig,
    user: UserProfile,
    session: MihuiSession,
    sourceCharacter?: CharacterProfile,
): Promise<MihuiReplyResult> {
    const history = session.messages.slice(-24).map(message => {
        if (message.type === 'image' && message.role === 'user') {
            return {
                role: message.role,
                content: [
                    { type: 'text', text: '用户发来了一张照片。请认真观察照片内容并自然回应，不要声称自己看不到。' },
                    { type: 'image_url', image_url: { url: message.content } },
                ],
            };
        }
        if (message.type === 'location') {
            const location = message.location;
            return {
                role: message.role,
                content: `[位置卡片] ${location?.name || message.content}${location?.address ? `；${location.address}` : ''}`,
            };
        }
        return { role: message.role, content: message.content };
    }) as Array<{ role: 'user' | 'assistant'; content: any }>;
    const persona = session.persona;
    const familiar = session.familiar;
    const hiddenFamiliarPrompt = familiar && !familiar.revealedAt
        ? `\n[隐藏身份规则] 你实际上是用户神经链接里的熟人「${familiar.realName}」，当前故意使用化名「${persona.name}」。你的真实设定如下：\n${sourceCharacter?.systemPrompt || familiar.systemPrompt}\n${sourceCharacter?.description || familiar.description}\n${sourceCharacter?.worldview || familiar.worldview || ''}\n必须以真实角色的性格和记忆回应，但在系统通知身份揭晓前，绝不能直接说出真名、头像、原职业或明确共同经历；只允许非常轻微的熟悉感。`
        : familiar?.revealedAt
            ? `\n[身份已揭晓] 你就是「${familiar.realName}」，不再使用化名隐瞒。继续承接密会里发生的一切。`
            : '';
    const raw = await callGlobalApi(api, [
        {
            role: 'system',
            content: `你现在扮演「${persona.name}」，${persona.age}岁，${persona.gender}，${persona.occupation}，生活在${persona.city}。\n外貌：${persona.appearance}\n性格：${persona.personality}\n社交方式：${persona.socialStyle}\n关系倾向：${persona.relationshipIntent}\n背景：${persona.background}${hiddenFamiliarPrompt}\n对方叫${user.name || '用户'}，资料：${user.bio || '未填写'}。\n这是同城交友软件里的私人聊天。像真实的人一样回复：保留边界与主见，承接刚才的话，不复述设定，不写旁白，不替用户行动。每轮必须拆成 1-3 个自然聊天气泡；每个气泡只承载一个连贯意思，不要为了凑数硬拆，也不要把长篇文字塞进一个气泡。所有人物均为成年人。\n可以依据角色性格和当下情绪偶尔自然使用 0-1 个颜文字，不要每轮必用，也不要连续堆叠。可选颜文字：${MIHUI_KAOMOJI.join(' ')}\n只输出 JSON：{"bubbles":["气泡1","气泡2"],"signal":"warm|neutral|cool"}。bubbles 必须有 1-3 项；signal 只表示这一轮互动给你的主观感受，不直接给分。`,
        },
        ...history,
    ], 0.9, 1400);
    return normalizeMihuiReply(raw);
}

export function buildMihuiRevealLine(character: CharacterProfile): string {
    const personality = `${character.description || ''} ${character.systemPrompt || ''}`;
    if (/毒舌|恶劣|戏谑|腹黑|傲慢|挑衅/.test(personality)) return `聊了这么久还没认出来？胆子不小。是我，${character.name}。`;
    if (/温柔|体贴|耐心|克制|治愈/.test(personality)) return `别紧张，是我，${character.name}。只是想换个方式，再认识你一次。`;
    if (/寡言|冷淡|沉稳|理性|严肃|冷静/.test(personality)) return `到这里就不瞒你了。是我，${character.name}。`;
    return `看来该重新自我介绍了——是我，${character.name}。`;
}

export function affinityDelta(signal: MihuiReplyResult['signal'], userText: string): number {
    const lengthBonus = userText.trim().length >= 12 ? 1 : 0;
    if (signal === 'warm') return 3 + lengthBonus;
    if (signal === 'cool') return -2;
    return 1;
}

export function clampAffinity(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

export function affinityStage(value: number): MihuiStage {
    if (value >= 100) return '密友';
    if (value >= 75) return '心动';
    if (value >= 50) return '暧昧';
    if (value >= 25) return '熟悉';
    return '初识';
}

export function replaceMihuiMessage(session: MihuiSession, messageId: string, replacement: MihuiMessage): MihuiSession {
    return {
        ...session,
        messages: session.messages.map(message => message.id === messageId ? replacement : message),
        updatedAt: Date.now(),
    };
}

export function removeMihuiMessage(session: MihuiSession, messageId: string): MihuiSession {
    return {
        ...session,
        messages: session.messages.filter(message => message.id !== messageId),
        updatedAt: Date.now(),
    };
}

export function mihuiMessageSummary(message: MihuiMessage): string {
    if (message.type === 'image') return '[分享照片]';
    if (message.type === 'location') return `[分享位置：${message.location?.name || message.content}]`;
    return message.content;
}

export function buildMihuiCharacterCard(session: MihuiSession): CharacterExportData {
    const p = session.persona;
    const recent = session.messages.slice(-18).map(m => `${m.role === 'user' ? '用户' : p.name}：${mihuiMessageSummary(m)}`).join('\n');
    const profile: CharacterProfile = {
        id: `mihui-${session.id}`,
        name: p.name,
        avatar: '',
        description: `${p.age}岁 · ${p.occupation} · ${p.city}\n${p.appearance}\n${p.personality}`,
        systemPrompt: `你是${p.name}，${p.age}岁的${p.gender}，职业是${p.occupation}，生活在${p.city}。\n外貌：${p.appearance}\n性格：${p.personality}\n社交方式：${p.socialStyle}\n关系倾向：${p.relationshipIntent}\n背景：${p.background}\n你与用户在「密会」相识，已经建立了真实连续的关系。保留自己的边界、生活与判断，不要把自己写成无条件迎合用户的工具。`,
        worldview: `相识于同城交友软件「密会」。\n近期聊天：\n${recent}`,
        memories: recent ? [{
            id: `mihui-memory-${Date.now()}`,
            date: new Date().toISOString().slice(0, 10),
            summary: recent,
            mood: '在密会相识后逐渐熟悉',
        }] : [],
    };
    const { id: _id, memories: _memories, ...shareable } = stripSensitiveCardFields(profile);
    return { ...shareable, version: 1, type: 'sully_character_card' };
}
