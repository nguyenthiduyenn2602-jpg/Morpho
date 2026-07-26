/**
 * 见面(DateApp)「恢复上次进度」崩溃自愈 — 打破 iOS WebKit 反复闪退死循环
 *
 * 触发场景 (用户报障: iOS Edge 见面时突然闪退, 之后刷新重进反复灰屏/白屏):
 *  - 见面会话每 30s / 切后台 / 关页面时会把当前 DateState 直接落库 (savedDateState);
 *  - 若这份快照本身很重 (大图立绘/背景 + 大量历史消息 + 阅读模式全量渲染),
 *    在内存吃紧的 iOS WebKit 上「继续上次」会把整个内容进程撑爆 (OOM) 或触发
 *    看门狗超时 —— 浏览器直接杀进程, 表现为「此网页反复出现问题」而非 JS 异常。
 *
 * 关键: 这类进程级崩溃 **不是** 能被 React ErrorBoundary 捕获的 JS 异常, 而且崩溃前
 * 那份 savedDateState 已经落库 —— 重进见面点「继续上次」会原样重放同一份重快照,
 * 于是每次都崩, 用户被永久锁死在这个功能里 (只能清站点数据才能自救)。
 *
 * 自愈思路 (两段式, 参考 chunkLoadRecovery 的 sessionStorage 护栏):
 *  1) 恢复「尝试」开始时 (点「继续上次」) → armDateResumeAttempt(charId) 写哨兵;
 *  2) 会话成功挂载并稳定渲染一小段时间后 → clearDateResumeAttempt() 撤哨兵 (证明这份快照能安全加载)。
 * 若进程在 1) 与 2) 之间被杀, 哨兵不会被清除 (进程崩溃不会跑 React 卸载逻辑),
 * 于是下次进见面时 takeCrashedDateResume() 读到残留哨兵 = 上次恢复崩了 →
 * 调用方丢弃这份有毒的 savedDateState (仅清恢复快照, 不动消息历史), 让用户重新开始。
 *
 * 为什么用 sessionStorage: 整页 reload (刷新 / WebKit 崩溃后重载) 仍在同一 tab 会话内,
 * 哨兵得以留存被检出; 正常关标签页后自然清空, 不会误伤下次全新打开。
 */

const RESUME_SENTINEL_KEY = 'sullyos_date_resume_attempt';

/** 恢复尝试开始: 记下正在恢复哪个角色的见面会话 */
export const armDateResumeAttempt = (charId: string): void => {
    try {
        sessionStorage.setItem(RESUME_SENTINEL_KEY, JSON.stringify({ charId, at: Date.now() }));
    } catch {
        // sessionStorage 不可用: 没法防死循环, 但也不影响正常功能 —— 静默降级
    }
};

/** 恢复成功 / 干净退出: 撤销哨兵, 表示这份快照已被证明能安全加载 */
export const clearDateResumeAttempt = (): void => {
    try {
        sessionStorage.removeItem(RESUME_SENTINEL_KEY);
    } catch {
        // ignore
    }
};

/**
 * 进见面时调用: 若上一次恢复尝试的哨兵还残留 (说明进程在恢复途中被杀 = 崩溃了),
 * 返回崩溃时正在恢复的 charId, 并顺手清掉哨兵 (只读一次)。没有残留则返回 null。
 */
export const takeCrashedDateResume = (): string | null => {
    let raw: string | null = null;
    try {
        raw = sessionStorage.getItem(RESUME_SENTINEL_KEY);
        if (raw) sessionStorage.removeItem(RESUME_SENTINEL_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed?.charId === 'string' && parsed.charId ? parsed.charId : null;
    } catch {
        return null;
    }
};
