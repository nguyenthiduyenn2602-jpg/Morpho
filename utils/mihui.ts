import type { APIConfig, CharacterExportData, CharacterProfile, UserProfile } from '../types';
import { extractContent, safeFetchJson } from './safeApi';
import { stripSensitiveCardFields } from './characterCard';

export type MihuiGender = 'male' | 'female' | 'any' | 'custom';
export type MihuiStage = '初识' | '熟悉' | '暧昧' | '心动' | '密友';

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
}

export interface MihuiState {
    version: 1;
    preferences: MihuiPreferences;
    sessions: MihuiSession[];
    activeSessionId?: string;
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
    try { return JSON.parse(cleaned); } catch { /* scan below */ }
    const start = cleaned.indexOf('{');
    if (start < 0) throw new Error('模型没有返回人物档案 JSON');
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
        const ch = cleaned[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') quoted = false;
            continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
        }
    }
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
            content: `你是虚构同城交友软件「密会」的匹配导演。生成一个有生活感、有边界、有缺点的虚构成年人物，禁止未成年人。人物不是服务用户的工具，不要完美迎合，也不要写成夸张霸总。只输出一个合法 JSON，不要 markdown。字段必须为：name, age, gender, occupation, city, appearance, personality, socialStyle, relationshipIntent, background, greeting。greeting 是这个人物匹配成功后主动发来的第一句话，要自然、短、能接话，不能像客服或人物介绍。`,
        },
        {
            role: 'user',
            content: `用户姓名：${user.name || '未命名'}\n用户资料：${user.bio || '没有填写'}\n模式：${quickMatch ? '快速匹配，优先结合用户资料推断合适对象；无法判断时随机' : '按明确偏好匹配'}\n${preferenceText}`,
        },
    ], 0.95, 1600);
    return normalizePersona(extractJsonObject(raw), prefs);
}

export interface MihuiReplyResult {
    reply: string;
    signal: 'warm' | 'neutral' | 'cool';
}

export async function generateMihuiReply(
    api: APIConfig,
    user: UserProfile,
    session: MihuiSession,
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
    const raw = await callGlobalApi(api, [
        {
            role: 'system',
            content: `你现在扮演「${persona.name}」，${persona.age}岁，${persona.gender}，${persona.occupation}，生活在${persona.city}。\n外貌：${persona.appearance}\n性格：${persona.personality}\n社交方式：${persona.socialStyle}\n关系倾向：${persona.relationshipIntent}\n背景：${persona.background}\n对方叫${user.name || '用户'}，资料：${user.bio || '未填写'}。\n这是同城交友软件里的私人聊天。像真实的人一样回复：保留边界与主见，承接刚才的话，不复述设定，不写旁白，不替用户行动。回复通常 1-3 句。所有人物均为成年人。\n只输出 JSON：{"reply":"你的回复","signal":"warm|neutral|cool"}。signal 只表示这一轮互动给你的主观感受，不直接给分。`,
        },
        ...history,
    ], 0.9, 1000);
    try {
        const parsed = extractJsonObject(raw);
        const signal = ['warm', 'neutral', 'cool'].includes(parsed?.signal) ? parsed.signal : 'neutral';
        return { reply: boundedText(parsed?.reply, '嗯？你继续说。', 600), signal } as MihuiReplyResult;
    } catch {
        return { reply: boundedText(raw, '嗯？你继续说。', 600), signal: 'neutral' };
    }
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
