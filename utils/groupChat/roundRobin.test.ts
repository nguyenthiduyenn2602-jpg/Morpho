import { describe, expect, it } from 'vitest';
import { resolveRoundRobinOrder } from './roundRobin';

const members = [
    { id: 'a', name: '阿澜' },
    { id: 'b', name: '小北' },
];

describe('resolveRoundRobinOrder', () => {
    it('明确 @ 的成员优先发言', () => {
        expect(resolveRoundRobinOrder(members, '@小北 你先说', () => 0)[0].id).toBe('b');
        expect(resolveRoundRobinOrder(members, '＠阿澜，怎么看', () => 0.99)[0].id).toBe('a');
    });

    it('同时 @ 多人时按正文中最先出现的名字', () => {
        expect(resolveRoundRobinOrder(members, '@小北 先说，@阿澜 再补充', () => 0)[0].id).toBe('b');
    });

    it('没有明确 @ 时只由传入的随机数决定首发者', () => {
        expect(resolveRoundRobinOrder(members, '大家怎么看', () => 0)[0].id).toBe('a');
        expect(resolveRoundRobinOrder(members, '大家怎么看', () => 0.999)[0].id).toBe('b');
    });

    it('普通提到名字不算 @，无法匹配的 @ 也走随机', () => {
        expect(resolveRoundRobinOrder(members, '小北怎么看', () => 0)[0].id).toBe('a');
        expect(resolveRoundRobinOrder(members, '@不存在的人', () => 0.9)[0].id).toBe('b');
    });
});
