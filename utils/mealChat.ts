import type { APIConfig, Message } from '../types';
import { generateDailyMealPlan, loadMealPlannerState, MEAL_STORAGE_CHANGED, saveMealPlannerState, type PantryItem } from './mealPlanner';

export interface MealChatMatch {
    food: string;
    itemIds: string[];
}

const generalFoods = ['牛奶', '酸奶', '豆浆', '鸡蛋', '面包', '米饭', '面条', '燕麦', '苹果', '橙汁', '饺子', '馒头', '香蕉', '咖啡', '鸡肉', '豆腐', '番茄'];
const stockWords = /冰箱|生鲜区|冷冻区|存货|库存|家里.{0,6}食材/;
const stockQuestion = /还有|还剩|有什么|有啥|有没有|到期|过期|临期|清一清|清理|先用|先吃|看看|看下|查一下|用掉|能做|能吃/;
const mealAdviceRequest = /(?:下顿|下一餐|早餐|午餐|晚餐|宵夜|早饭|午饭|晚饭|今晚|明天|冰箱|食材|家里|剩下的).{0,16}(?:吃点什么|吃什么|吃啥|做点什么|做什么|做啥|怎么搭配|能搭什么)|(?:推荐|安排|想个|帮我想|不知道|纠结).{0,12}(?:吃什么|吃啥|菜单|食谱|菜谱|下一餐|下顿|晚饭|晚餐)/;
const consumed = /(?:吃|喝)(?:了|过|完(?:了)?|掉(?:了)?)|(?:把|将).*(?:吃|喝)(?:光|完|掉|了)/;
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
    const names = [...new Set([...stock.map(item => item.name.trim()), ...generalFoods])].sort((a, b) => b.length - a.length);
    const found = new Map<string, MealChatMatch>();
    for (const clause of text.split(/[。！!；;，,\n]/)) {
        const action = consumed.exec(clause);
        if (!action || uncertain.test(clause)) continue;
        const foodText = /^(?:把|将)/.test(action[0])
            ? action[0].replace(/^(?:把|将)/, '')
            : clause.slice(action.index + action[0].length);
        const spans: Array<[number, number]> = [];
        for (const name of names) {
            let index = foodText.indexOf(name);
            while (index >= 0 && spans.some(([start, end]) => index < end && index + name.length > start)) {
                index = foodText.indexOf(name, index + name.length);
            }
            if (index < 0) continue;
            const candidates = stock.filter(item => generalFoods.includes(name) ? item.name.includes(name) : item.name.trim() === name);
            if (!candidates.length) continue;
            spans.push([index, index + name.length]);
            found.set(name, { food: name, itemIds: candidates.map(item => item.id) });
        }
    }
    return [...found.values()];
}

export const mealChatReceiptKey = (message: Message, food: string) =>
    JSON.stringify([message.charId, message.id, message.timestamp, food]);

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
