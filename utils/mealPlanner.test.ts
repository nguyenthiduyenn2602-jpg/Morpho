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
        expect(prompt).toContain('严格 2 餐');
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
});
