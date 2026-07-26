import { describe, expect, it } from 'vitest';
import {
    buildRangeSearchEntries,
    filterRangeSearchEntries,
    getRangeEndpointLabel,
    getRangeSelectionHint,
    normalizeRangeSearchText,
} from './rangeSelection';

describe('手动总结区间选择', () => {
    it('先选终点时保持显示“终点”，不会误标为起点', () => {
        expect(getRangeEndpointLabel(22, null, 22)).toBe('终点');
        expect(getRangeSelectionHint(null, 22, 1)).toBe('已选终点，请再点起点');
    });

    it('起终点反向选择时仍忠实显示用户指定的角色', () => {
        expect(getRangeEndpointLabel(80, 80, 20)).toBe('起点');
        expect(getRangeEndpointLabel(20, 80, 20)).toBe('终点');
    });

    it('同一条消息可同时作为起点和终点', () => {
        expect(getRangeEndpointLabel(30, 30, 30)).toBe('起点 / 终点');
        expect(getRangeSelectionHint(30, 30, 1)).toBe('已选 1 条');
    });

    it('日期搜索忽略分隔符后的前导零，并复用预计算索引', () => {
        const messages = [
            { id: 1, content: '六月的约定', timestamp: 1 },
            { id: 2, content: '七月见', timestamp: 2 },
        ] as any;
        const entries = buildRangeSearchEntries(messages, timestamp =>
            timestamp === 1 ? '2026/06/22 01:04' : '2026/07/03 09:30',
        );

        expect(normalizeRangeSearchText(' 6/22 ')).toBe('6/22');
        expect(filterRangeSearchEntries(entries, '6/22').map(message => message.id)).toEqual([1]);
        expect(filterRangeSearchEntries(entries, '七月').map(message => message.id)).toEqual([2]);
    });
});
