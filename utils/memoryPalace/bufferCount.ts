import type { Message } from '../../types';

/**
 * 纯计算：记忆宫殿"未同步"缓冲区条数——即真正能被 pipeline 处理的历史消息数。
 *
 * 口径必须和 pipeline 的缓冲区定义一致：
 *   - 排除热区（最后 hotZoneSize 条永远留在上下文，不参与处理）
 *   - 排除已处理（id <= hwm）
 *
 * 切勿退回 "id > hwm" 裸过滤——那会把永远不处理的热区也算进未同步，
 * UI 会显示几百条待处理、用户点了却跑不出新水位，等于骗人。
 * 这个坑已经踩过一次，bufferCount.test.ts 把正确口径钉住了。
 *
 * @param semanticMessages 已过滤成"语义相关"的消息（可不排序，本函数内部按 id 排序）
 * @param hwm 当前高水位标记（id <= hwm 视为已处理）
 * @param hotZoneSize 热区大小，默认 200，与 pipeline 的 HOT_ZONE_SIZE 对齐
 */
export function countUnprocessedBufferMessages(
    semanticMessages: Message[],
    hwm: number,
    hotZoneSize = 200,
): number {
    const sorted = [...semanticMessages].sort((a, b) => a.id - b.id);
    if (sorted.length <= hotZoneSize) return 0;
    const hotZoneStartId = sorted[sorted.length - hotZoneSize].id;
    let count = 0;
    for (const m of sorted) {
        if (m.id > hwm && m.id < hotZoneStartId) count++;
    }
    return count;
}
