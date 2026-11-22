import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { DB } from './db';
import { applyAssistantPostProcessing, type PostProcessCtx } from './applyAssistantPostProcessing';
import { appendMealChatReplyCard, arrangeChatMeal, buildMealChatContext, completeQuotedMeal, confirmMealChat, isChatMealFinished, matchMealChat, mealChatReceiptKey, mealChatReplySource, mealChatStockQuantity, placeMealCardsBeforeReplies, requestedChatMeal } from './mealChat';
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

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('私聊吃了没', () => {
    it('私聊收到真实回复才生成卡片，卡片先于角色正文落库，重复处理不会多发', async () => {
        prepareStorage();
        const state = loadMealPlannerState();
        saveMealPlannerState({ ...state, settings: { ...state.settings, chatCharacterId: 'cook' } });
        const messages: Message[] = [
            { id: 1, charId: 'cook', timestamp: 1, role: 'user', type: 'text', content: '我喝了牛奶' },
        ];
        for (const content of ['我买了3盒牛奶', '我买了3盒牛奶，花了30元']) {
            expect(mealChatReplySource({ ...messages[0], content })).toBeUndefined();
        }
        vi.spyOn(DB, 'getMessagesFromId').mockImplementation(async () => ({ messages: [...messages], totalCount: messages.length }));
        vi.spyOn(DB, 'getRecentMessagesByCharId').mockImplementation(async () => [...messages]);
        const save = vi.spyOn(DB, 'saveMessage').mockImplementation(async message => {
            const id = messages.length + 1;
            messages.push({ ...message, timestamp: message.timestamp ?? id, id });
            return id;
        });
        const ctx: PostProcessCtx = {
            char: { id: 'cook', name: '角色' } as PostProcessCtx['char'],
            userProfile: { name: '我' } as PostProcessCtx['userProfile'],
            emojis: [], contextMsgs: [...messages], fullMessages: [], initialData: {}, historyMsgCount: 1,
            xhsCaches: { xsecTokenCache: new Map(), noteTitleCache: new Map(), commentUserIdCache: new Map(), commentParentIdCache: new Map() },
            api: { baseUrl: '', headers: {}, effectiveApi: { baseUrl: '', apiKey: '', model: '' } },
            hooks: { setMessages: vi.fn(), addToast: vi.fn() }, instantRender: true,
            beforeReplyBubbles: () => appendMealChatReplyCard('cook', 1),
        };
        await applyAssistantPostProcessing('', ctx);
        expect(save).not.toHaveBeenCalled();
        await applyAssistantPostProcessing('好喝吗？\n下次再买。', ctx);
        expect(await appendMealChatReplyCard('cook', 1)).toBe(false);
        expect(messages.map(message => message.type)).toEqual(['text', 'meal_card', 'text', 'text']);
        expect(messages[1]).toMatchObject({ role: 'assistant', type: 'meal_card', metadata: { mealChatSourceId: 1 } });
        expect(placeMealCardsBeforeReplies(messages).map(message => message.id)).toEqual([1, 2, 3, 4]);
        expect(loadMealPlannerState().inventory[0].quantity).toBe(3);
    });

    it('未说明时按一份，俩苹果和两盒牛奶各提取成两份库存单位', () => {
        expect(mealChatStockQuantity(matchMealChat('我吃了苹果', [apple])[0].portion, apple.unit)).toBe(1);
        expect(mealChatStockQuantity(matchMealChat('我吃了俩苹果', [apple])[0].portion, apple.unit)).toBe(2);
        expect(mealChatStockQuantity(matchMealChat('我吃俩苹果了', [apple])[0].portion, apple.unit)).toBe(2);
        expect(mealChatStockQuantity(matchMealChat('我喝了两盒牛奶', [milk])[0].portion, milk.unit)).toBe(2);
        expect(mealChatStockQuantity(matchMealChat('我喝了半盒牛奶', [milk])[0].portion, milk.unit)).toBe(0.5);
        expect(mealChatStockQuantity(matchMealChat('我喝了两杯牛奶', [milk])[0].portion, milk.unit)).toBeUndefined();
    });

    it('炒饭优先匹配成品，否则分开提示米饭和原料，并保留各自的库存单位', () => {
        const lamb: PantryItem = { id: 'lamb', name: '羊肉', unit: '克', quantity: 500, category: '肉蛋' };
        const rice: PantryItem = { id: 'rice', name: '米饭', unit: '碗', quantity: 2, category: '主食' };
        const ready: PantryItem = { ...rice, id: 'ready', name: '羊肉炒饭', unit: '份' };
        const message = '我吃了一份羊肉炒饭';
        expect(matchMealChat(message, [lamb, rice])).toEqual([
            { food: '羊肉', itemIds: ['lamb'], fromDish: '羊肉炒饭' },
            { food: '米饭', itemIds: ['rice'], fromDish: '羊肉炒饭' },
        ]);
        expect(matchMealChat(message, [lamb, rice, ready])).toEqual([
            { food: '羊肉炒饭', itemIds: ['ready'], portion: { quantity: 1, unit: '份' } },
        ]);
        expect(mealChatStockQuantity(undefined, rice.unit, '羊肉炒饭')).toBe(1);
        expect(mealChatStockQuantity(undefined, lamb.unit, '羊肉炒饭')).toBeUndefined();
        expect(mealChatStockQuantity(matchMealChat('炒饭用了100克羊肉', [lamb])[0].portion, lamb.unit)).toBe(100);
    });
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

    it('水饺和饺子双向匹配，具体馅料优先，泛称仍保留所有候选', () => {
        const pork: PantryItem = { id: 'pork', name: '猪肉水饺', category: '冷冻', quantity: 6, unit: '个' };
        const veg: PantryItem = { ...pork, id: 'veg', name: '素馅饺子' };
        expect(matchMealChat('我吃了饺子', [pork])).toEqual([{ food: '饺子', itemIds: ['pork'] }]);
        expect(matchMealChat('我吃了水饺', [veg])).toEqual([{ food: '饺子', itemIds: ['veg'] }]);
        expect(matchMealChat('我吃了水饺', [pork, veg])).toEqual([{ food: '饺子', itemIds: ['pork', 'veg'] }]);
        expect(matchMealChat('我吃了猪肉饺子', [pork, veg])).toEqual([{ food: '猪肉饺子', itemIds: ['pork'] }]);
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
