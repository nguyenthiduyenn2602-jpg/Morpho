import { describe, expect, it } from 'vitest';
import { buildMealPlannerPrompt, extractJsonObject, formatMealPlanForChat, normalizeMealPlan } from './mealPlanner';

describe('mealPlanner', () => {
    it('把家常与平价限制写进导演提示词', () => {
        const prompt = buildMealPlannerPrompt([
            { id: 'egg', name: '鸡蛋', quantity: 3, unit: '个', category: '肉蛋' },
        ], { targetKcal: 1600, diners: 1, mealsPerDay: 2, pushCharacterId: '', goal: '控热量', dislikes: '不吃香菜', kitchenNote: '只有炒锅' }, '2026-09-07');
        expect(prompt).toContain('鸡蛋：3个');
        expect(prompt).toContain('优先消耗现有存货');
        expect(prompt).toContain('不要默认牛排、三文鱼');
        expect(prompt).toContain('不要佛跳墙、锅包肉');
        expect(prompt).toContain('安排 2 餐');
        expect(prompt).toContain('库存ID：egg');
        expect(prompt).toContain('ingredients');
    });

    it('按偏好只保留指定餐数，并可整理成私聊文本', () => {
        const plan = normalizeMealPlan({
            title: '两顿也好好吃',
            meals: [
                { type: '早午餐', dishes: [{ name: '鸡蛋面', portion: '一碗', kcal: 450 }], kcal: 450 },
                { type: '晚餐', dishes: [{ name: '白菜炖豆腐', portion: '一份', kcal: 500 }], kcal: 500 },
            ],
            shoppingList: ['豆腐一块'],
        }, '2026-09-07', 2);
        expect(plan.meals.map(meal => meal.type)).toEqual(['第一餐', '第二餐']);
        expect(formatMealPlanForChat(plan)).toContain('第一餐：鸡蛋面');
        expect(formatMealPlanForChat(plan)).toContain('顺手补买：豆腐一块');
    });

    it('能从模型夹带的文字中提取 JSON', () => {
        expect(extractJsonObject('安排如下：\n```json\n{"title":"吃饭"}\n```')).toEqual({ title: '吃饭' });
    });

    it('按各餐之和重新计算全天热量', () => {
        const plan = normalizeMealPlan({
            title: '家常一天',
            meals: [
                { type: '早餐', dishes: [{ name: '鸡蛋面', portion: '一碗', kcal: 400 }], kcal: 400, prepMinutes: 15 },
                { type: '午餐', dishes: [{ name: '番茄炒蛋饭', portion: '一份', kcal: 600 }], kcal: 600, prepMinutes: 25 },
                { type: '晚餐', dishes: [{ name: '白菜豆腐汤', portion: '一碗', kcal: 350 }], kcal: 350, prepMinutes: 20 },
            ],
            totalKcal: 9999,
        }, '2026-09-07');
        expect(plan.totalKcal).toBe(1350);
        expect(plan.meals).toHaveLength(3);
    });

    it('模型少返回餐次时也先落下可用的一餐', () => {
        const plan = normalizeMealPlan({
            meals: [{ type: '早餐', dishes: [{ name: '鸡蛋面', portion: '一碗', kcal: 420 }] }],
        }, '2026-09-07', 3);
        expect(plan.meals).toHaveLength(1);
        expect(plan.meals[0].type).toBe('早餐');
    });

    it('保留结构化食材用量并匹配库存ID', () => {
        const plan = normalizeMealPlan({
            meals: [{
                type: '一餐',
                dishes: [{
                    name: '番茄炒蛋', portion: '一盘', kcal: 380,
                    ingredients: [{ name: '鸡蛋', quantity: 2, unit: '个', inventoryId: 'egg', fromStock: true }],
                }],
            }],
        }, '2026-09-07', 1, [{ id: 'egg', name: '鸡蛋', quantity: 4, unit: '个', category: '肉蛋' }]);
        expect(plan.meals[0].dishes[0].ingredients[0]).toMatchObject({ inventoryId: 'egg', quantity: 2, fromStock: true });
        expect(plan.meals[0].dishes[0].stockUsed).toEqual(['鸡蛋']);
    });
});
