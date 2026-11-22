import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { arrangeChatMeal, buildMealChatContext, completeQuotedMeal, confirmMealChat, isChatMealFinished, matchMealChat, mealChatReceiptKey, requestedChatMeal } from './mealChat';
import { emptyMealPlannerState, loadMealPlannerState, saveMealPlannerState, type PantryItem } from './mealPlanner';

const milk: PantryItem = { id: 'whole', name: '普通牛奶', category: '奶豆', quantity: 3, unit: '盒', expiresAt: '2026-11-24' };
const skim: PantryItem = { ...milk, id: 'skim', name: '脱脂牛奶', expiresAt: '2026-12-03' };
const apple: PantryItem = { id: 'apple', name: '苹果', category: '水果', quantity: 1, unit: '个' };

function prepareStorage() {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('navigator', {});
    saveMealPlannerState({ ...emptyMealPlannerState(), inventory: [milk, skim, apple] });
}

afterEach(() => vi.unstubAllGlobals());

describe('私聊吃了没', () => {
    it('泛称保留两种候选，明确品类只对应那一种，同时可识别两个食物', () => {
        expect(matchMealChat('我把牛奶喝了', [milk, skim])).toEqual([{ food: '牛奶', itemIds: ['whole', 'skim'] }]);
        expect(matchMealChat('我喝了脱脂牛奶和苹果', [milk, skim, apple])).toEqual([
            { food: '脱脂牛奶', itemIds: ['skim'] }, { food: '苹果', itemIds: ['apple'] },
        ]);
        for (const text of ['还没喝完牛奶', '我打算喝了牛奶再出门', '你喝了牛奶吗', '牛奶还在冰箱，我吃了面包']) {
            expect(matchMealChat(text, [milk, skim])).toEqual([]);
        }
    });

    it('同一组候选只能扣一次，并且用最新库存检测余量和单位', async () => {
        prepareStorage();
        const key = mealChatReceiptKey({ charId: 'char', id: 1, timestamp: 2000 } as Message, '牛奶');
        await expect(confirmMealChat(key, { item: skim, quantity: 4 })).rejects.toThrow('不能超过');
        await Promise.all([confirmMealChat(key, { item: skim, quantity: 2 }), confirmMealChat(key, { item: milk, quantity: 1 })]);
        expect(loadMealPlannerState().inventory.map(item => item.quantity)).toEqual([3, 1, 1]);
        expect(loadMealPlannerState().chatConsumption?.[key]).toMatchObject({ name: '脱脂牛奶', quantity: 2, unit: '盒' });
        await expect(confirmMealChat('stale', { item: { ...skim, unit: '升' }, quantity: 1 })).rejects.toThrow('库存已变动');
        await confirmMealChat('skip');
        await confirmMealChat('skip', { item: milk, quantity: 1 });
        expect(loadMealPlannerState().inventory[0].quantity).toBe(3);
    });

    it('仅授权角色安排一人份晚餐，引用完成只扣一次，库存不足时整餐不扣', async () => {
        prepareStorage();
        const state = loadMealPlannerState();
        saveMealPlannerState({ ...state, settings: { ...state.settings, diners: 4, chatCharacterId: 'cook' } });
        const response = { title: '一人食', meals: [{ dishes: [{ name: '牛奶燕麦', ingredients: [
            { name: '普通牛奶', inventoryId: 'whole', quantity: 2, unit: '盒', fromStock: true },
            { name: '燕麦', quantity: 1, unit: '份', fromStock: false },
        ] }] }] };
        const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }));
        vi.stubGlobal('fetch', fetchMock);
        const api = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' };
        const text = '晚上吃什么';
        const type = requestedChatMeal(text)!;
        expect(type).toBe('晚餐');
        expect(requestedChatMeal('你晚上吃什么')).toBeUndefined();
        expect(isChatMealFinished('已经吃完了！')).toBe(true);
        expect(isChatMealFinished('还没吃完')).toBe(false);
        await expect(arrangeChatMeal(api, 'other', '2026-11-22', type, text)).rejects.toThrow('授权');
        expect(fetchMock).not.toHaveBeenCalled();
        const plan = await arrangeChatMeal(api, 'cook', '2026-11-22', type, text);
        expect(plan.meals.map(meal => meal.type)).toEqual(['晚餐']);
        expect(loadMealPlannerState().chatPlans?.[0].id).toBe(plan.id);
        expect(loadMealPlannerState().inventory[0].quantity).toBe(3);
        await Promise.all([completeQuotedMeal('cook', plan.id, type), completeQuotedMeal('cook', plan.id, type)]);
        expect(loadMealPlannerState().inventory.map(item => item.quantity)).toEqual([1, 3, 1]);
        const another = await arrangeChatMeal(api, 'cook', '2026-11-22', type, text);
        await expect(completeQuotedMeal('cook', another.id, type)).rejects.toThrow('库存已不足');
        expect(loadMealPlannerState().chatPlans?.[0].completedMeals).toBeUndefined();
        expect(loadMealPlannerState().inventory[0].quantity).toBe(1);
    });

    it('仅在相关话题提供库存，并从本地日期计算三天内到期', () => {
        prepareStorage();
        const date = new Date(2026, 10, 22, 18);
        for (const content of ['下班了吗', '晚饭吃了苹果', '刚喝了牛奶', '冰箱里的牛奶我喝了', '动画怎么做']) {
            expect(buildMealChatContext({ type: 'text', content } as Message, date)).toBe('');
        }
        const context = buildMealChatContext({ type: 'text', content: '冰箱还有什么能吃' } as Message, date);
        expect(context).toContain('"临期提醒":{"名称":"普通牛奶","分区":"生鲜区","到期日":"2026-11-24"}');
        expect(buildMealChatContext({ type: 'text', content: '冷冻区有没有快到期的' } as Message, date)).not.toContain('普通牛奶');
    });
});
