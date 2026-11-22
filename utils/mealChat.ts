import type { APIConfig, Message } from '../types';
import { DB } from './db';
import { generateDailyMealPlan, loadMealPlannerState, MEAL_STORAGE_CHANGED, saveMealPlannerState, type PantryItem } from './mealPlanner';

export interface MealChatMatch {
    food: string;
    itemIds: string[];
    portion?: { quantity: number; unit?: string };
    fromDish?: string;
    /** 已下线的购物卡，仅供旧聊天记录识别。 */
    purchase?: { unit: string };
}

const amountToken = /((?:\d+(?:\.\d+)?)|[一二三四五六七八九十零两]{1,3}|[俩仨半])\s*(千克|公斤|毫升|kg|ml|[个盒箱瓶袋杯碗盘份片块根颗枚只条碟串包罐克升斤gL])?/;
const portionAtEnd = new RegExp(`(?:^|[^\\d.一二三四五六七八九十零两俩仨半])${amountToken.source}\\s*$`, 'i');
const digitNames = '零一二三四五六七八九';

function parsePortion(prefix: string): MealChatMatch['portion'] {
    const match = prefix.match(portionAtEnd);
    if (!match) return;
    const [, amount, unit] = match;
    if (!unit && !/^[俩仨]$/.test(amount)) return;
    const number = amount.replace(/两|俩/g, '二').replace('仨', '三');
    const [tens, ones] = number.split('十');
    const quantity = amount === '半' ? 0.5 : /^\d/.test(number) ? Number(number)
        : ones !== undefined ? (tens ? digitNames.indexOf(tens) : 1) * 10 + (ones ? digitNames.indexOf(ones) : 0)
        : digitNames.indexOf(number);
    if (Number.isFinite(quantity) && quantity >= 0.01) return { quantity, unit };
}

export function mealChatStockQuantity(portion: MealChatMatch['portion'], stockUnit: string, fromDish?: string): number | undefined {
    if (fromDish && !/^(份|碗)$/.test(stockUnit.trim())) return;
    if (!portion) return 1;
    if (!portion.unit) return portion.quantity; // 俩、仨
    const aliases: Record<string, string> = { g: '克', kg: '千克', 公斤: '千克', ml: '毫升', l: '升', 颗: '个', 枚: '个', 只: '个' };
    const normalize = (value: string) => aliases[value.toLowerCase()] ?? value;
    return normalize(portion.unit) === normalize(stockUnit) ? portion.quantity : undefined;
}

const generalFoods = ['牛奶', '酸奶', '豆浆', '鸡蛋', '面包', '米饭', '面条', '燕麦', '苹果', '橙汁', '饺子', '馒头', '香蕉', '咖啡', '鸡肉', '豆腐', '番茄'];
const normalizeFoodAlias = (name: string) => name.replace(/水饺/g, '饺子');
const namedFriedRice = /(羊肉|牛肉|猪肉|鸡肉|蛋|鸡蛋|虾仁)炒饭/g;
const stockWords = /冰箱|生鲜区|冷冻区|存货|库存|家里.{0,6}食材/;
const stockQuestion = /还有|还剩|有什么|有啥|有没有|到期|过期|临期|清一清|清理|先用|先吃|看看|看下|查一下|用掉|能做|能吃/;
const mealAdviceRequest = /(?:下顿|下一餐|早餐|午餐|晚餐|宵夜|早饭|午饭|晚饭|今晚|明天|冰箱|食材|家里|剩下的).{0,16}(?:吃点什么|吃什么|吃啥|做点什么|做什么|做啥|怎么搭配|能搭什么)|(?:推荐|安排|想个|帮我想|不知道|纠结).{0,12}(?:吃什么|吃啥|菜单|食谱|菜谱|下一餐|下顿|晚饭|晚餐)/;
const consumed = /(?:吃|喝)(?:了|过|完(?:了)?|掉(?:了)?)|(?:把|将).*(?:吃|喝)(?:光|完|掉|了)/;
const consumedWithFinalLe = /^[^吃喝]{0,12}[吃喝]([^吃喝。！？?!]+?)(?:了|啦|咯)[呀呢哦~～]*$/;
const uncertain = /没有|还没|没[吃喝]|不曾|不[吃喝]|别[吃喝]|[没不]有.*[吃喝]|想|打算|准备|计划|如果|要是|假如|明天|还要|会不会|[吗么？?]|(?:你|他|她|它|他们|她们)(?:刚|已经|也|都|又|今天|中午|晚上|早上|昨晚)*[吃喝]|(?:给|让|看见|看到|听说).*?[吃喝]/;

export function requestedChatMeal(text: string): string | undefined {
    if (/昨天|昨晚|昨早|明天|后天|吃了|吃过|(?:你们?|他们?|她们?)(?:今天|晚上|今晚|想|打算|准备|要)*吃/.test(text)) return;
    if (!/(?:吃点什么|吃什么|吃啥|吃点啥|做点什么|做什么吃|做个什么吃)|(?:安排|推荐|帮我想).{0,12}(?:饭|餐|菜单|菜谱)/.test(text)) return;
    if (/宵夜|夜宵/.test(text)) return '宵夜';
    if (/晚上|今晚|晚饭|晚餐/.test(text)) return '晚餐';
    if (/午饭|午餐|中午/.test(text)) return '午餐';
    if (/早餐|早饭|早上/.test(text)) return '早餐';
    return '一餐';
}

export const isChatMealFinished = (text: string) =>
    /^(?:(?:我|这顿|刚|已经|刚刚|终于|也|都|照着.{1,12})\s*)*(?:吃完(?:了|啦|咯)?|吃好(?:了|啦)|用餐完成)[\s。！!～~～，,]*$/.test(text.trim());

const withMealStorageLock = <T,>(operation: () => T): Promise<T> =>
    typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(MEAL_STORAGE_CHANGED, operation)
        : Promise.resolve().then(operation);

export async function arrangeChatMeal(api: APIConfig, charId: string, date: string, type: string, request: string) {
    const { settings, inventory } = loadMealPlannerState();
    if (settings.chatCharacterId !== charId) throw new Error('请先在吃了没授权这位角色');
    const available = inventory.filter(item => item.quantity > 0 && (!item.expiresAt || item.expiresAt >= date));
    const plan = await generateDailyMealPlan(api, available, { ...settings, diners: 1, mealsPerDay: 1 }, date, { type, request });
    await withMealStorageLock(() => {
        const state = loadMealPlannerState();
        if (state.settings.chatCharacterId !== charId) throw new Error('这位角色的饮食授权已变更');
        saveMealPlannerState({ ...state, chatPlans: [plan, ...(state.chatPlans || [])].slice(0, 30) });
        window.dispatchEvent(new Event(MEAL_STORAGE_CHANGED));
    });
    return plan;
}

export function completeQuotedMeal(charId: string, planId: string, type: string) {
    return withMealStorageLock(() => {
        const state = loadMealPlannerState();
        if (state.settings.chatCharacterId !== charId) throw new Error('请先在吃了没授权这位角色');
        const plan = [...(state.chatPlans || []), ...state.plans].find(entry => entry.id === planId);
        const meal = plan?.meals.find(entry => entry.type === type);
        if (!plan || !meal) throw new Error('这份菜单已不在吃了没，请按实际食物记录');
        if (plan.completedMeals?.includes(type)) return '这餐已经记过了';
        const usage = new Map<string, number>();
        for (const ingredient of meal.dishes.flatMap(dish => dish.ingredients || [])) {
            if (!ingredient.fromStock) continue;
            const item = state.inventory.find(entry => entry.id === ingredient.inventoryId);
            if (!item || item.unit !== ingredient.unit || !Number.isFinite(ingredient.quantity) || ingredient.quantity <= 0) {
                throw new Error('菜单里的库存或单位已变化，请按实际吃掉的食物记录');
            }
            usage.set(item.id, Math.round(((usage.get(item.id) || 0) + ingredient.quantity) * 100) / 100);
        }
        if (state.inventory.some(item => (usage.get(item.id) || 0) > item.quantity)) {
            throw new Error('菜单所需库存已不足，请按实际吃掉的食物记录');
        }
        const updated = { ...plan, completedMeals: [...(plan.completedMeals || []), type] };
        const replace = (entry: typeof plan) => entry.id === plan.id ? updated : entry;
        saveMealPlannerState({
            ...state, plans: state.plans.map(replace), chatPlans: state.chatPlans?.map(replace),
            inventory: state.inventory.map(item => usage.has(item.id)
                ? { ...item, quantity: Math.round((item.quantity - usage.get(item.id)!) * 100) / 100 }
                : item),
        });
        window.dispatchEvent(new Event(MEAL_STORAGE_CHANGED));
        return usage.size ? `${type}已记下，已扣除菜单用到的存货` : `${type}已记下`;
    });
}

// Specific names win over a generic match inside the same span. Generic names
// stay a choice between every matching stocked variant.
export function matchMealChat(text: string, inventory: PantryItem[]): MealChatMatch[] {
    const stock = inventory.filter(item => item.quantity > 0 && item.name.trim());
    const names = [...new Set([...stock.map(item => normalizeFoodAlias(item.name.trim())), ...generalFoods])]
        .sort((a, b) => b.length - a.length);
    const found = new Map<string, MealChatMatch>();
    for (const rawClause of text.split(/[。！!；;，,\n]/)) {
        const clause = rawClause.trim();
        const action = consumed.exec(clause) ?? /(?:炒饭|这道菜|做饭)[^。！？?!]{0,10}?用了/.exec(clause);
        if (uncertain.test(clause) || /没用|不用/.test(clause)) continue;
        const suffixFood = !action ? consumedWithFinalLe.exec(clause)?.[1] : undefined;
        if (!action && !suffixFood) continue;
        const foodText = normalizeFoodAlias(!action ? suffixFood! : /^(?:把|将)/.test(action[0])
            ? action[0].replace(/^(?:把|将)/, '')
            : clause.slice(action.index + action[0].length));
        const spans: Array<[number, number]> = [];
        for (const match of foodText.matchAll(namedFriedRice)) {
            const [dish, protein] = match;
            const index = match.index!;
            spans.push([index, index + dish.length]);
            const prepared = stock.filter(item => item.name.includes(dish));
            if (prepared.length) {
                const portion = parsePortion(foodText.slice(0, index));
                found.set(dish, { food: dish, itemIds: prepared.map(item => item.id), ...(portion ? { portion } : {}) });
                continue;
            }
            for (const ingredient of [protein === '蛋' ? '鸡蛋' : protein, '米饭']) {
                const candidates = stock.filter(item => !item.name.includes('炒饭') && item.name.includes(ingredient));
                if (candidates.length) {
                    found.set(ingredient, { food: ingredient, itemIds: candidates.map(item => item.id), fromDish: dish });
                }
            }
        }
        for (const name of names) {
            let index = foodText.indexOf(name);
            while (index >= 0 && spans.some(([start, end]) => index < end && index + name.length > start)) {
                index = foodText.indexOf(name, index + name.length);
            }
            if (index < 0) continue;
            const candidates = stock.filter(item => {
                const itemName = normalizeFoodAlias(item.name.trim());
                return generalFoods.includes(name) ? itemName.includes(name) : itemName === name;
            });
            if (!candidates.length) continue;
            spans.push([index, index + name.length]);
            const portion = parsePortion(foodText.slice(0, index));
            found.set(name, { food: name, itemIds: candidates.map(item => item.id), ...(portion ? { portion } : {}) });
        }
    }
    return [...found.values()];
}

export const mealChatReceiptKey = (message: Message, food: string) =>
    JSON.stringify([message.charId, message.metadata?.mealChatSourceId ?? message.id,
        message.metadata?.mealChatSourceAt ?? message.timestamp, food]);

export const mealChatConfirmationKey = (message: Message, match: MealChatMatch) =>
    mealChatReceiptKey(message, match.purchase ? JSON.stringify(['购物', match.food, match.purchase.unit]) : match.food);

export function mealChatReplySource(message: Message | undefined): number | undefined {
    if (message?.role !== 'user' || message.type !== 'text' || message.metadata?.mealChatEligible === false) return;
    const state = loadMealPlannerState();
    if (state.settings.chatCharacterId === message.charId && matchMealChat(message.content, state.inventory).length) {
        return message.id;
    }
}

const mealCardsInFlight = new Set<string>();

export async function appendMealChatReplyCard(
    charId: string, sourceId: number, options?: { alreadyDelivered?: boolean; timestamp?: number },
): Promise<boolean> {
    const key = JSON.stringify([charId, sourceId]);
    if (mealCardsInFlight.has(key)) return false;
    mealCardsInFlight.add(key);
    try {
        const { messages } = await DB.getMessagesFromId(charId, sourceId);
        const source = messages.find(message => message.id === sourceId);
        if (!source || !mealChatReplySource(source)) return false;
        if (messages.some(message => message.metadata?.mealChatSourceId === sourceId)) return false;
        const reply = options?.alreadyDelivered ? messages.find(message => message.id > sourceId && message.role === 'assistant'
            && !message.metadata?.mealChatConfirmation) : undefined;
        if (options?.alreadyDelivered && !reply) return false;
        const { inventory } = loadMealPlannerState();
        const mealChat = matchMealChat(source.content, inventory);
        if (!mealChat.length) return false;
        await DB.saveMessage({
            charId, role: 'assistant', type: 'meal_card', timestamp: options?.timestamp,
            content: `饮食 · ${mealChat.map(match => match.food).join('、')}`,
            metadata: { source: 'eat', mealChat, mealChatConfirmation: true, mealChatSourceId: sourceId,
                mealChatSourceAt: source.timestamp, ...(reply ? { mealChatReplyId: reply.id } : {}) },
        });
        return true;
    } catch (error) {
        console.warn('[MealChat] 饮食确认卡保存失败', error);
        return false;
    } finally {
        mealCardsInFlight.delete(key);
    }
}

export function placeMealCardsBeforeReplies(messages: Message[]): Message[] {
    const ids = new Set(messages.map(message => message.id));
    const cards = new Map<number, Message[]>();
    for (const message of messages) {
        const replyId = message.metadata?.mealChatReplyId;
        if (message.metadata?.mealChatConfirmation && ids.has(replyId)) {
            cards.set(replyId, [...(cards.get(replyId) || []), message]);
        }
    }
    if (!cards.size) return messages;
    return messages.flatMap(message => {
        if (message.metadata?.mealChatConfirmation && cards.has(message.metadata.mealChatReplyId)) return [];
        return [...(cards.get(message.id) || []), message];
    });
}

export function confirmMealChat(key: string, choice?: { item: PantryItem; quantity: number }) {
    const commit = () => {
        const state = loadMealPlannerState();
        if (state.chatConsumption?.[key]) return;
        if (!choice) {
            saveMealPlannerState({ ...state, chatConsumption: { ...state.chatConsumption, [key]: { skipped: true } } });
            window.dispatchEvent(new Event(MEAL_STORAGE_CHANGED));
            return;
        }
        const { item: candidate, quantity } = choice;
        const item = state.inventory.find(entry => entry.id === candidate.id);
        if (!item || item.name !== candidate.name || item.unit !== candidate.unit || !(item.quantity > 0)) {
            throw new Error('这项库存已变动，请重新选择');
        }
        if (!Number.isFinite(quantity) || quantity < 0.01 || quantity > item.quantity) {
            throw new Error('请填写有效数量，且不能超过当前库存');
        }
        saveMealPlannerState({
            ...state,
            inventory: state.inventory.map(entry => entry.id === item.id
                ? { ...entry, quantity: Math.round((entry.quantity - quantity) * 100) / 100 }
                : entry),
            chatConsumption: { ...state.chatConsumption, [key]: { name: item.name, unit: item.unit, quantity, recordedAt: Date.now() } },
        });
        window.dispatchEvent(new Event(MEAL_STORAGE_CHANGED));
    };
    return withMealStorageLock(commit);
}

export function buildMealChatContext(message: Message | undefined, now = new Date()): string {
    if (message?.type !== 'text') return '';
    const stockRequest = stockWords.test(message.content) && stockQuestion.test(message.content);
    const wantsAdvice = mealAdviceRequest.test(message.content);
    if (!stockRequest && !wantsAdvice) return '';
    const { inventory, settings } = loadMealPlannerState();
    const dateKey = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, '0')).join('-');
    const today = dateKey(now);
    const end = new Date(now);
    end.setDate(end.getDate() + 3);
    const stock = inventory.filter(item => item.quantity > 0 && item.category !== '饮品');
    const zone = (item: PantryItem) => item.category === '冷冻' || item.category === '速食' ? '冷冻区' : '生鲜区';
    const describe = (item: PantryItem) => ({
        名称: item.name.slice(0, 60), 分区: zone(item), 到期日: item.expiresAt,
    });
    const available = stock.filter(item => !item.expiresAt || item.expiresAt >= today);
    const expires = /过期|临期|到期/.test(message.content);
    const requestedZone = /生鲜区/.test(message.content) && !/冷冻区/.test(message.content) ? '生鲜区'
        : /冷冻区/.test(message.content) && !/生鲜区/.test(message.content) ? '冷冻区' : undefined;
    const inScope = (item: PantryItem) => !requestedZone || zone(item) === requestedZone;
    const expiring = available.filter(item => inScope(item) && item.expiresAt && item.expiresAt <= dateKey(end))
        .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))[0];
    const expired = expires ? stock.find(item => inScope(item) && item.expiresAt && item.expiresAt < today) : undefined;
    const candidates = available.filter(item => inScope(item) && item.id !== expiring?.id).slice(0, 4);
    return [
        '【吃了没 · 仅供回答本轮饮食问题】先接住对方原本的话题，保持角色口吻。询问怎么吃时，给一个简单搭配即可。临期提醒最多顺口提一项，提到时可带上分区；没关系就略过。',
        '这些只是冰箱里的少量候选，不要照着念库存或背菜谱，不要声称替对方扣库存。若问到过期情况，已过期食材只作提醒，不要推荐食用。',
        JSON.stringify({
            今天: today, 临期提醒: expiring && describe(expiring), 已过期提醒: expired && describe(expired),
            可考虑食材: !expires || wantsAdvice ? candidates.map(describe) : undefined,
            饮食方向: settings.goal, 忌口: String(settings.dislikes ?? '').slice(0, 180), 厨房条件: String(settings.kitchenNote ?? '').slice(0, 180),
        }),
    ].join('\n');
}
