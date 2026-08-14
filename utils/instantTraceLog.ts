/**
 * Instant Push / 主动消息链路共用的 trace ring buffer（localStorage）。
 *
 * 「无条件抓」的那一层通道日志：不受 devDebug 勾选影响，开发者随时能翻最近发生了什么
 * （另外两写——console.info 和 appendDevDebugLog——各自留在调用方，语义不同）。
 *
 * 键名、容量、条目形状只在这里定义一次。写在 instantPushClient / activeMsgRuntime、
 * 读在调试面板，三处各抄一份的话，键一改（比如升 v2）读侧会静默显示空列表——
 * 调试面板骗人比没有更糟。
 */

const TRACE_LOG_KEY = 'instant_push_trace_log_v1';
const TRACE_LOG_LIMIT = 200;

export interface InstantTraceEntry {
  ts?: string;
  event?: string;
  sessionId?: string;
  [key: string]: unknown;
}

/** 追加一条，超出容量丢最老的。读写失败一律静默：trace 不能反过来打断正常链路。 */
export const appendInstantTraceEntry = (entry: InstantTraceEntry): void => {
  try {
    const raw = localStorage.getItem(TRACE_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? [...list, entry].slice(-TRACE_LOG_LIMIT) : [entry];
    localStorage.setItem(TRACE_LOG_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
};

/** 最近 limit 条，最新的排在最前（调试面板按这个顺序显示）。 */
export const readRecentInstantTraces = (limit: number): InstantTraceEntry[] => {
  try {
    const raw = localStorage.getItem(TRACE_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(-limit).reverse() : [];
  } catch {
    return [];
  }
};
