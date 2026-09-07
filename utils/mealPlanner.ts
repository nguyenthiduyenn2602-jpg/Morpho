import type { APIConfig } from '../types';
import { safeFetchJson } from './safeApi';

export type PantryCategory = '主食' | '肉蛋' | '蔬菜' | '水果' | '奶豆' | '饮品' | '冷冻' | '速食' | '调味' | '其他';

export interface PantryItem {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    category: PantryCategory;
    expiresAt?: string;
    note?: string;
}

export interface MealDish {
    name: string;
    portion: string;
    kcal: number;
    stockUsed: string[];
}

export interface PlannedMeal {
    type: '早餐' | '午餐' | '晚餐' | '第一餐' | '第二餐' | '一餐' | string;
    dishes: MealDish[];
    kcal: number;
    prepMinutes: number;
    tip: string;
}

export interface DailyMealPlan {
    id: string;
    date: string;
    title: string;
    meals: PlannedMeal[];
    totalKcal: number;
    shoppingList: string[];
    stockPriority: string[];
    note: string;
    createdAt: number;
}

export interface MealPlannerSettings {
    targetKcal: number;
    diners: number;
    mealsPerDay: 1 | 2 | 3;
    pushCharacterId: string;
    goal: '正常吃' | '清淡点' | '控热量';
    dislikes: string;
    kitchenNote: string;
}

export interface MealPlannerState {
    version: 1;
    inventory: PantryItem[];
    plans: DailyMealPlan[];
    settings: MealPlannerSettings;
}

export const MEAL_PLANNER_STORAGE_KEY = 'morpho_eat_state_v1';

export const DEFAULT_MEAL_SETTINGS: MealPlannerSettings = {
    targetKcal: 1600,
    diners: 1,
    mealsPerDay: 3,
    pushCharacterId: '',
    goal: '正常吃',
    dislikes: '',
    kitchenNote: '普通家庭厨房，优先使用炒锅、电饭煲和蒸锅',
};

export const emptyMealPlannerState = (): MealPlannerState => ({
    version: 1,
    inventory: [],
    plans: [],
    settings: { ...DEFAULT_MEAL_SETTINGS },
});

export const loadMealPlannerState = (): MealPlannerState => {
    try {
        const raw = localStorage.getItem(MEAL_PLANNER_STORAGE_KEY);
        if (!raw) return emptyMealPlannerState();
        const parsed = JSON.parse(raw);
        return {
            version: 1,
            inventory: Array.isArray(parsed?.inventory) ? parsed.inventory : [],
            plans: Array.isArray(parsed?.plans) ? parsed.plans.slice(0, 14) : [],
            settings: { ...DEFAULT_MEAL_SETTINGS, ...(parsed?.settings || {}) },
        };
    } catch {
        return emptyMealPlannerState();
    }
};

export const saveMealPlannerState = (state: MealPlannerState): void => {
    localStorage.setItem(MEAL_PLANNER_STORAGE_KEY, JSON.stringify({ ...state, plans: state.plans.slice(0, 14) }));
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};

const text = (value: unknown, fallback = '', max = 120): string => {
    const result = String(value ?? '').trim().replace(/\s+/g, ' ');
    return (result || fallback).slice(0, max);
};

export const extractJsonObject = (raw: string): any => {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(cleaned); } catch { /* scan below */ }
    const start = cleaned.indexOf('{');
    if (start < 0) throw new Error('模型没有返回饮食安排 JSON');
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
        const char = cleaned[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') quoted = true;
        else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
        }
    }
    throw new Error('模型返回的饮食安排不完整');
};

const extractContent = (data: any): string => {
    const content = data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
    return '';
};

export const buildMealPlannerPrompt = (
    inventory: PantryItem[],
    settings: MealPlannerSettings,
    date: string,
): string => {
    const stock = inventory.length
        ? inventory.map(item => `- ${item.name}：${item.quantity}${item.unit}（${item.category}${item.expiresAt ? `，${item.expiresAt}到期` : ''}${item.note ? `，${item.note}` : ''}）`).join('\n')
        : '- 冰箱暂未录入存货';
    const mealTypes = settings.mealsPerDay === 1
        ? ['一餐']
        : settings.mealsPerDay === 2
            ? ['第一餐', '第二餐']
            : ['早餐', '午餐', '晚餐'];
    return `请为一位中国普通家庭用户安排 ${date} 的一天饮食。\n\n冰箱存货：\n${stock}\n\n人数：${settings.diners} 人\n每日餐数：严格 ${settings.mealsPerDay} 餐（${mealTypes.join('、')}）\n全天目标：约 ${settings.targetKcal} 千卡\n饮食方向：${settings.goal}\n不吃/忌口：${settings.dislikes || '无'}\n厨房条件：${settings.kitchenNote || '普通家庭厨房'}\n\n硬性要求：\n1. 优先消耗现有存货和临期食材，缺少的只补常见、平价、容易买到的食材。\n2. 菜谱必须符合中国人的日常饮食：粥、面、米饭、馒头、鸡蛋、豆腐、时令蔬菜、常见猪牛羊鸡肉等均可。\n3. 不要默认牛排、三文鱼、牛油果、羽衣甘蓝、藜麦、昂贵进口食材或健身博主式水煮餐。\n4. 不要佛跳墙、锅包肉、松鼠桂鱼等宴席菜或费时费油、普通家庭很少做的复杂菜。单餐尽量 35 分钟内完成。\n5. 不要为了减脂让人挨饿；热量是生活化估算，不得宣称医学精确。\n6. meals 数组必须恰好包含 ${settings.mealsPerDay} 餐，按 ${mealTypes.join('、')} 排列，不要额外添加加餐。菜名要具体自然，不写“优质蛋白套餐”之类营销词。\n7. 只输出一个合法 JSON 对象，不要 markdown、注释和额外文字。\n\nJSON 格式：\n{"title":"今天吃得踏实一点","meals":[{"type":"${mealTypes[0]}","dishes":[{"name":"菜名","portion":"一人份用量","kcal":300,"stockUsed":["用到的现有存货"]}],"kcal":300,"prepMinutes":15,"tip":"一句简短做法或替换建议"}],"shoppingList":["需要补买的食材与大致数量"],"stockPriority":["应优先消耗的存货"],"note":"一句生活化提醒"}`;
};

export const normalizeMealPlan = (raw: any, date: string, mealsPerDay: 1 | 2 | 3 = 3): DailyMealPlan => {
    const expectedTypes = mealsPerDay === 1 ? ['一餐'] : mealsPerDay === 2 ? ['第一餐', '第二餐'] : ['早餐', '午餐', '晚餐'];
    const meals: PlannedMeal[] = (Array.isArray(raw?.meals) ? raw.meals : []).map((meal: any, index: number) => {
        const type = expectedTypes[index] || String(meal?.type || `第${index + 1}餐`);
        const dishes = (Array.isArray(meal?.dishes) ? meal.dishes : []).slice(0, 4).map((dish: any) => ({
            name: text(dish?.name, '家常菜', 40),
            portion: text(dish?.portion, '一人份', 60),
            kcal: clampNumber(dish?.kcal, 0, 2000, 0),
            stockUsed: (Array.isArray(dish?.stockUsed) ? dish.stockUsed : []).map((item: unknown) => text(item, '', 30)).filter(Boolean).slice(0, 8),
        }));
        const dishKcal = dishes.reduce((sum, dish) => sum + dish.kcal, 0);
        return {
            type,
            dishes,
            kcal: clampNumber(meal?.kcal, 0, 3000, dishKcal),
            prepMinutes: clampNumber(meal?.prepMinutes, 1, 180, 20),
            tip: text(meal?.tip, '', 120),
        } as PlannedMeal;
    }).filter(meal => meal.dishes.length > 0).slice(0, mealsPerDay);
    if (meals.length !== mealsPerDay) throw new Error(`模型没有返回完整的 ${mealsPerDay} 餐安排，请再试一次`);
    const calculatedTotal = meals.reduce((sum, meal) => sum + meal.kcal, 0);
    return {
        id: `meal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date,
        title: text(raw?.title, '今天好好吃饭', 40),
        meals,
        totalKcal: calculatedTotal,
        shoppingList: (Array.isArray(raw?.shoppingList) ? raw.shoppingList : []).map((item: unknown) => text(item, '', 60)).filter(Boolean).slice(0, 16),
        stockPriority: (Array.isArray(raw?.stockPriority) ? raw.stockPriority : []).map((item: unknown) => text(item, '', 40)).filter(Boolean).slice(0, 10),
        note: text(raw?.note, '热量为估算值，按实际用量调整。', 160),
        createdAt: Date.now(),
    };
};

export const formatMealPlanForChat = (plan: DailyMealPlan): string => {
    const meals = plan.meals.map(meal => {
        const dishes = meal.dishes.map(dish => `${dish.name}（${dish.portion}，约${dish.kcal} kcal）`).join('、');
        return `${meal.type}：${dishes}`;
    }).join('\n');
    const shopping = plan.shoppingList.length ? `\n顺手补买：${plan.shoppingList.join('、')}` : '';
    return `【吃了吗 · ${plan.date}】\n${plan.title}\n${meals}\n全天约 ${plan.totalKcal} kcal${shopping}\n${plan.note}`;
};

export const generateDailyMealPlan = async (
    api: APIConfig,
    inventory: PantryItem[],
    settings: MealPlannerSettings,
    date: string,
): Promise<DailyMealPlan> => {
    if (!api.baseUrl?.trim() || !api.model?.trim()) throw new Error('请先在设置中配置全局 API 和模型');
    const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model: api.model,
            messages: [
                { role: 'system', content: '你是一位真正会过日子的中国家庭饮食助手。严格按用户库存安排平价、简单、家常的饭菜，只输出合法 JSON。' },
                { role: 'user', content: buildMealPlannerPrompt(inventory, settings, date) },
            ],
            temperature: 0.72,
            max_tokens: 2600,
            stream: false,
        }),
    }, 0, 60000, { appId: 'eat', appName: '吃了吗', purpose: '生成家常饮食安排' });
    const content = extractContent(data).trim();
    if (!content) throw new Error('模型没有返回饮食安排');
    return normalizeMealPlan(extractJsonObject(content), date, settings.mealsPerDay);
};
