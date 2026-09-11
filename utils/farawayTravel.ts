import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import { extractContent, extractJson as extractSafeJson, safeFetchJson } from './safeApi';

export type FarawayRouteClass = 'nearby' | 'distant';
export type FarawayEventKind = 'departure' | 'mid' | 'return';

export interface FarawayPhoto { id: string; front: string; back: string; createdAt: number; }
export interface FarawayDiary { id: string; date: string; title: string; body: string; }
export interface FarawayShelf { wardrobeUrls: string[]; carryItems: string[]; photos: FarawayPhoto[]; diaries: FarawayDiary[]; }
export interface FarawayJourneyEvent {
    id: string; kind: FarawayEventKind; dueAt: number; title: string; body: string; location: string;
    deliveredAt?: number; cloudScheduled?: boolean;
}
export interface FarawayJourney {
    id: string; charId: string; charName: string; startedAt: number; endsAt: number; status: 'away' | 'returned';
    routeClass: FarawayRouteClass; days: number; destination: string; purposeType: 'business' | 'travel'; purpose: string;
    summary: string; packItems: string[]; outfitNote: string; itinerary: string[]; diary: string; photos: FarawayPhoto[];
    events: FarawayJourneyEvent[];
}
export interface FarawayState { selectedCharId: string; shelves: Record<string, FarawayShelf>; journey?: FarawayJourney; }

const KEY = 'morpho_faraway_state_v1';
export const FARAWAY_STATE_EVENT = 'morpho-faraway-state';
const emptyShelf = (): FarawayShelf => ({ wardrobeUrls: [], carryItems: ['手机', '充电器', '证件'], photos: [], diaries: [] });

export const loadFarawayState = (): FarawayState => {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (raw && typeof raw === 'object') return { selectedCharId: String(raw.selectedCharId || ''), shelves: raw.shelves || {}, journey: raw.journey };
    } catch { /* use default */ }
    return { selectedCharId: '', shelves: {} };
};

export const saveFarawayState = (state: FarawayState) => {
    localStorage.setItem(KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(FARAWAY_STATE_EVENT));
};

export const shelfFor = (state: FarawayState, charId: string): FarawayShelf => ({ ...emptyShelf(), ...(state.shelves[charId] || {}) });

const profileText = (char: CharacterProfile) => [char.name, char.description, char.systemPrompt, char.worldview].filter(Boolean).join('\n');
export const isBusinessEligible = (char: CharacterProfile): boolean => {
    const text = profileText(char);
    const ageMatches = [...text.matchAll(/(?:age\s*[:：]?\s*|年龄\s*[:：]?\s*|)(\d{2})\s*(?:岁|years?\s*old)/gi)];
    const age = ageMatches.map(match => Number(match[1])).find(value => value >= 10 && value <= 99);
    const hasJob = /(工作|上班|职业|公司|职员|员工|经理|总监|老板|律师|医生|教师|教授|警察|记者|设计师|工程师|研究员|公务员|军人|演员|艺人|创业|business|employee|manager|doctor|lawyer|teacher|professor|engineer|office)/i.test(text);
    const clearlyStudent = /(高中生|中学生|大学生|在校生|student)/i.test(text) && !hasJob;
    return !clearlyStudent && hasJob && (age === undefined || age >= 22);
};

const extractQuotedField = (text: string, key: string) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, 'i'));
    if (!match) return '';
    try { return JSON.parse(`"${match[1].replace(/"$/, '')}"`); } catch { return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
};

const extractStringArray = (text: string, key: string): string[] => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)(?:\\]|$)`, 'i'));
    if (!match) return [];
    return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map(item => item[1].replace(/\\"/g, '"')).filter(Boolean);
};

/** 模型偶尔在 JSON 尾部被截断；能恢复前置规划字段时继续行程，其余使用本地兜底。 */
export const parseFarawayPlan = (text: string): any => {
    const parsed = extractSafeJson(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    const salvaged = {
        routeClass: extractQuotedField(text, 'routeClass'), destination: extractQuotedField(text, 'destination'),
        purposeType: extractQuotedField(text, 'purposeType'), purpose: extractQuotedField(text, 'purpose'),
        summary: extractQuotedField(text, 'summary'), packItems: extractStringArray(text, 'packItems'),
        outfitNote: extractQuotedField(text, 'outfitNote'), itinerary: extractStringArray(text, 'itinerary'),
        diary: extractQuotedField(text, 'diary'), photos: [],
    };
    if (!salvaged.destination && !salvaged.purpose && !salvaged.summary) throw new Error('旅行规划没有返回可用内容，请重试一次');
    console.warn('[Faraway] 旅行规划 JSON 不完整，已使用可恢复字段继续生成', text.slice(0, 240));
    return salvaged;
};

const recentChat = async (charId: string) => {
    const messages = await DB.getMessagesByCharId(charId, true);
    return messages.slice(-18).map(message => `${message.role === 'user' ? '用户' : '角色'}：${String(message.content || '').slice(0, 260)}`).join('\n');
};

const userWasMadeACompanion = (value: unknown, userName: string) => {
    const text = Array.isArray(value) ? value.join('\n') : String(value || '');
    const escapedName = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        /(?:和|跟|带着|陪着|约上)用户(?:一起|一同)?(?:去|出发|旅行|游玩|同行)/,
        /(?:你们|两个人|二人)(?:一起|一同)?(?:去|出发|旅行|游玩|同行)/,
        /(?:带你|陪你|和你一起|跟你一起|与你一起|与你同行)(?:去|出发|旅行|游玩|看看)?/,
    ];
    if (userName && userName !== '用户') {
        patterns.push(new RegExp(`(?:和|跟|带着|陪着|约上)${escapedName}(?:一起|一同)?(?:去|出发|旅行|游玩|同行)`));
    }
    return patterns.some(pattern => pattern.test(text));
};

export const createFarawayJourney = async (char: CharacterProfile, user: UserProfile, api: APIConfig, shelf: FarawayShelf): Promise<FarawayJourney> => {
    if (!api.baseUrl || !api.apiKey || !api.model) throw new Error('请先配置全局 API');
    const businessEligible = isBusinessEligible(char);
    const chat = await recentChat(char.id);
    const prompt = `你是生活旅行策划器。请根据人物设定，为角色安排一次自然、克制、有生活感的国内外出。\n\n人物：${profileText(char)}\n用户：${user.name || '用户'}；${user.bio || ''}\n近期聊天：\n${chat || '暂无'}\n常带物品：${shelf.carryItems.join('、') || '无'}\n衣橱参考：${shelf.wardrobeUrls.length ? shelf.wardrobeUrls.join('、') : '无'}\n\n硬规则：\n1. 这是角色独自离开、用户留在原地的外出。绝对不能安排用户同行、陪同、偶遇或一起出发；用户资料和近期聊天只用于判断角色会怎样向用户报备、分享旅途。所有行程、日记和照片中实际出行的人只有该角色。\n2. 原则上在中国国内。近郊或邻近城市用 nearby；从北京到西安、云南这类跨省远行用 distant。\n3. nearby 只安排近郊、邻近城市、短程探访；distant 才安排明显跨省远行。\n4. ${businessEligible ? '该角色符合出差条件，purposeType 可以是 business 或 travel。' : '该角色不符合出差条件，purposeType 必须是 travel，禁止写工作、开会、客户、项目、出差。'}\n5. 理由要符合人设，可以旅行、探亲访友、临时散心、办私事；不要硬煽情。\n6. 不要写旅行天数和返程倒计时。\n7. 日记和照片文字要像本人随手留下的，简短自然。\n\n只返回 JSON：{"routeClass":"nearby或distant","destination":"地点","purposeType":"business或travel","purpose":"目的","summary":"出发小记，40字内","packItems":["物品"],"outfitNote":"穿着，25字内","itinerary":["安排1","安排2"],"diary":"80字内见闻","photos":[{"front":"照片正面叙述，35字内","back":"照片背面的留言，45字内"}]}`;
    const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
        body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: `${prompt}\n\n补充：整个 JSON 请控制在 650 个中文字符以内，必须优先保证闭合完整。` }], temperature: Math.min(0.9, Math.max(0.55, api.temperature ?? 0.75)), max_tokens: 1800, stream: false }),
    }, 0);
    const parsed = parseFarawayPlan(extractContent(data));
    const routeClass: FarawayRouteClass = parsed.routeClass === 'distant' ? 'distant' : 'nearby';
    const days = routeClass === 'distant' ? 3 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
    const purposeType: 'business' | 'travel' = businessEligible && parsed.purposeType === 'business' ? 'business' : 'travel';
    const now = Date.now();
    const endsAt = now + days * 24 * 60 * 60 * 1000;
    const id = `faraway-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const destination = String(parsed.destination || (routeClass === 'nearby' ? '附近走走' : '去远一点的地方')).slice(0, 30);
    const packItems = Array.isArray(parsed.packItems) ? parsed.packItems.map(String).filter(Boolean).slice(0, 8) : shelf.carryItems;
    const photos: FarawayPhoto[] = (Array.isArray(parsed.photos) ? parsed.photos : []).slice(0, 4).map((item: any, index: number) => ({ id: `${id}-photo-${index}`, front: String(item?.front || '途中随手拍下的一幕'), back: String(item?.back || '等回来再慢慢说。'), createdAt: now }));
    const midAt = now + Math.round((endsAt - now) * (0.38 + Math.random() * 0.24));
    const userName = user.name || '用户';
    const companionLeak = [parsed.purpose, parsed.summary, parsed.itinerary, parsed.diary, ...(Array.isArray(parsed.photos) ? parsed.photos.flatMap((item: any) => [item?.front, item?.back]) : [])]
        .some(value => userWasMadeACompanion(value, userName));
    const purpose = companionLeak
        ? (purposeType === 'business' ? '独自临时出差' : '独自出去走走')
        : (purposeType === 'business' ? String(parsed.purpose || '临时出差') : String(parsed.purpose || '出去走走'));
    const summary = companionLeak ? `${char.name}收拾好东西，独自去了${destination}。` : String(parsed.summary || `${char.name}收拾好东西，准备去${destination}。`);
    const safeItinerary = companionLeak ? [`抵达${destination}`, '按自己的节奏四处走走'] : (Array.isArray(parsed.itinerary) ? parsed.itinerary.map(String).filter(Boolean).slice(0, 5) : []);
    const safeDiary = companionLeak ? `一个人在${destination}走了走，记下几件想回来讲给你听的小事。` : String(parsed.diary || `在${destination}走了走，看到了一些平时不会留意的东西。`);
    const safePhotos = companionLeak ? [{ id: `${id}-photo-0`, front: `${destination}途中随手拍下的一幕`, back: '等我回来，再慢慢讲给你听。', createdAt: now }] : photos;
    return {
        id, charId: char.id, charName: char.name, startedAt: now, endsAt, status: 'away', routeClass, days, destination, purposeType, purpose,
        summary, packItems, outfitNote: String(parsed.outfitNote || '轻便的日常穿着'),
        itinerary: safeItinerary,
        diary: safeDiary, photos: safePhotos,
        events: [
            { id: `${id}-departure`, kind: 'departure', dueAt: now, title: '出发前的消息', body: summary, location: destination },
            { id: `${id}-mid`, kind: 'mid', dueAt: midAt, title: `${destination}来信`, body: safeDiary || summary, location: destination },
            { id: `${id}-return`, kind: 'return', dueAt: endsAt, title: '已经回来了', body: `${char.name}结束了这次外出，带回了一些见闻。`, location: destination },
        ],
    };
};

export const deliverTravelCard = async (journey: FarawayJourney, event: FarawayJourneyEvent) => {
    await DB.saveMessage({
        charId: journey.charId, role: 'assistant', type: 'travel_card', timestamp: Date.now(),
        content: `${event.title}\n${event.body}`,
        metadata: { source: 'faraway', journeyId: journey.id, eventId: event.id, travelCard: { kind: event.kind, title: event.title, body: event.body, destination: journey.destination, purpose: journey.purpose, items: journey.packItems, location: event.location } },
    });
    window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId: journey.charId } }));
};

export const finishJourneyIfDue = (state: FarawayState, now = Date.now()): FarawayState => {
    const journey = state.journey;
    if (!journey || journey.status !== 'away' || now < journey.endsAt) return state;
    const shelf = shelfFor(state, journey.charId);
    return {
        ...state,
        shelves: { ...state.shelves, [journey.charId]: { ...shelf, diaries: [{ id: `${journey.id}-diary`, date: new Date(journey.endsAt).toLocaleDateString('zh-CN'), title: journey.destination, body: journey.diary }, ...shelf.diaries], photos: [...journey.photos, ...shelf.photos] } },
        journey: { ...journey, status: 'returned' },
    };
};
