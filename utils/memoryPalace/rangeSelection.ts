import type { Message } from '../../types';

export interface RangeSearchEntry {
    message: Message;
    searchText: string;
}

/**
 * 日期搜索允许用户按视觉习惯省略前导零：
 * `6/22` 可以命中界面显示的 `2026/06/22`。
 */
export function normalizeRangeSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/(^|[./-])0+(?=\d)/g, '$1')
        .replace(/\s+/g, ' ');
}

/** 预先生成小写内容和日期索引，避免用户每输入一个字符都重新格式化全部时间戳。 */
export function buildRangeSearchEntries(
    messages: Message[],
    formatTimestamp: (timestamp: number) => string,
): RangeSearchEntry[] {
    return messages.map(message => ({
        message,
        searchText: normalizeRangeSearchText(
            `${typeof message.content === 'string' ? message.content : ''} ${formatTimestamp(message.timestamp)}`,
        ),
    }));
}

export function filterRangeSearchEntries(entries: RangeSearchEntry[], query: string): Message[] {
    const normalizedQuery = normalizeRangeSearchText(query);
    if (!normalizedQuery) return entries.map(entry => entry.message);
    return entries
        .filter(entry => entry.searchText.includes(normalizedQuery))
        .map(entry => entry.message);
}

/** 标签忠实反映用户点击的端点角色，不按消息先后擅自互换“起点/终点”。 */
export function getRangeEndpointLabel(
    messageId: number,
    startId: number | null,
    endId: number | null,
): '' | '起点' | '终点' | '起点 / 终点' {
    const isStart = messageId === startId;
    const isEnd = messageId === endId;
    if (isStart && isEnd) return '起点 / 终点';
    if (isStart) return '起点';
    if (isEnd) return '终点';
    return '';
}

export function getRangeSelectionHint(startId: number | null, endId: number | null, selectedCount: number): string {
    if (startId != null && endId != null) return `已选 ${selectedCount} 条`;
    if (startId != null) return '已选起点，请再点终点';
    if (endId != null) return '已选终点，请再点起点';
    return '未选择';
}
