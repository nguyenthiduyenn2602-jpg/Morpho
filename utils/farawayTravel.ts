import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import { extractContent, safeFetchJson } from './safeApi';

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

const extractJson = (text: string): any => {
    const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('旅行规划没有返回完整内容');
    return JSON.parse(cleaned.slice(start, end + 1));
};

const recentChat = async (charId: string) => {
    const messages = await DB.getMessagesByCharId(charId, true);
    return messages.slice(-18).map(message => `${message.role === 'user' ? '用户' : '角色'}：${String(message.content || '').slice(0, 260)}`).join('\n');
};

export const createFarawayJourney = async (char: CharacterProfile, user: UserProfile, api: APIConfig, shelf: FarawayShelf): Promise<FarawayJourney> => {
    if (!api.baseUrl || !api.apiKey || !api.model) throw new Error('请先配置全局 API');
    const businessEligible = isBusinessEligible(char);
    const chat = await recentChat(char.id);
    const prompt = `你是生活旅行策划器。请根据人物设定，为角色安排一次自然、克制、有生活感的国内外出。\n\n人物：${profileText(char)}\n用户：${user.name || '用户'}；${user.bio || ''}\n近期聊天：\n${chat || '暂无'}\n常带物品：${shelf.carryItems.join('、') || '无'}\n衣橱参考：${shelf.wardrobeUrls.length ? shelf.wardrobeUrls.join('、') : '无'}\n\n硬规则：\n1. 原则上在中国国内。近郊或邻近城市用 nearby；从北京到西安、云南这类跨省远行用 distant。\n2. nearby 只安排近郊、邻近城市、短程探访；distant 才安排明显跨省远行。\n3. ${businessEligible ? '该角色符合出差条件，purposeType 可以是 business 或 travel。' : '该角色不符合出差条件，purposeType 必须是 travel，禁止写工作、开会、客户、项目、出差。'}\n4. 理由要符合人设，可以旅行、探亲访友、临时散心、办私事；不要硬煽情。\n5. 不要写旅行天数和返程倒计时。\n6. 日记和照片文字要像本人随手留下的，简短自然。\n\n只返回 JSON：{"routeClass":"nearby或distant","destination":"地点","purposeType":"business或travel","purpose":"目的","summary":"出发小记，40字内","packItems":["物品"],"outfitNote":"穿着，25字内","itinerary":["安排1","安排2"],"diary":"80字内见闻","photos":[{"front":"照片正面叙述，35字内","back":"照片背面的留言，45字内"}]}`;
    const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
        body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: prompt }], temperature: Math.min(0.9, Math.max(0.55, api.temperature ?? 0.75)), max_tokens: 900, stream: false }),
    }, 0);
    const parsed = extractJson(extractContent(data));
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
    const purpose = purposeType === 'business' ? String(parsed.purpose || '临时出差') : String(parsed.purpose || '出去走走');
    const summary = String(parsed.summary || `${char.name}收拾好东西，准备去${destination}。`);
    return {
        id, charId: char.id, charName: char.name, startedAt: now, endsAt, status: 'away', routeClass, days, destination, purposeType, purpose,
        summary, packItems, outfitNote: String(parsed.outfitNote || '轻便的日常穿着'),
        itinerary: Array.isArray(parsed.itinerary) ? parsed.itinerary.map(String).filter(Boolean).slice(0, 5) : [],
        diary: String(parsed.diary || `在${destination}走了走，看到了一些平时不会留意的东西。`), photos,
        events: [
            { id: `${id}-departure`, kind: 'departure', dueAt: now, title: '出发前的消息', body: summary, location: destination },
            { id: `${id}-mid`, kind: 'mid', dueAt: midAt, title: `${destination}来信`, body: String(parsed.diary || summary), location: destination },
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
