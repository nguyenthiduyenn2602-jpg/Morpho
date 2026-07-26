import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    armDateResumeAttempt,
    clearDateResumeAttempt,
    takeCrashedDateResume,
} from './dateSessionRecovery';

// 锁住见面「继续上次」崩溃自愈的两段式护栏:
// arm(恢复开始) → clear(恢复成功/干净退出); 若进程在两者之间被 iOS WebKit 杀掉,
// 哨兵残留, 下次 take 读到 = 上次恢复崩了 → 调用方丢弃有毒的 savedDateState。
//
// 测试环境是 node (无 sessionStorage)，用 Map 后端的 stub 模拟，与 chunkLoadRecovery.test.ts 一致。

const KEY = 'sullyos_date_resume_attempt';

const stubSessionStorage = () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
    });
    return store;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('dateSessionRecovery 两段式护栏', () => {
    it('arm 后正常 clear（恢复成功）→ 再进见面无残留', () => {
        stubSessionStorage();
        armDateResumeAttempt('char-1');
        clearDateResumeAttempt();
        expect(takeCrashedDateResume()).toBeNull();
    });

    it('arm 后没 clear（进程崩溃）→ 下次进见面检出崩溃的 charId', () => {
        stubSessionStorage();
        armDateResumeAttempt('char-42');
        // 模拟崩溃 + reload：sessionStorage 在同一 tab 会话内留存，哨兵仍在
        expect(takeCrashedDateResume()).toBe('char-42');
    });

    it('take 只读一次：读到后自动清除，第二次返回 null', () => {
        stubSessionStorage();
        armDateResumeAttempt('char-7');
        expect(takeCrashedDateResume()).toBe('char-7');
        expect(takeCrashedDateResume()).toBeNull();
    });

    it('从未 arm → take 返回 null（正常全新进入不误伤）', () => {
        stubSessionStorage();
        expect(takeCrashedDateResume()).toBeNull();
    });

    it('后一次 arm 覆盖前一次的 charId', () => {
        stubSessionStorage();
        armDateResumeAttempt('char-a');
        armDateResumeAttempt('char-b');
        expect(takeCrashedDateResume()).toBe('char-b');
    });

    it('哨兵内容损坏（非法 JSON）→ take 安全返回 null，不抛异常，并清除', () => {
        const store = stubSessionStorage();
        store.set(KEY, '{not valid json');
        expect(() => takeCrashedDateResume()).not.toThrow();
        expect(store.has(KEY)).toBe(false);
    });

    it('哨兵缺 charId 字段 → take 返回 null', () => {
        const store = stubSessionStorage();
        store.set(KEY, JSON.stringify({ at: 123 }));
        expect(takeCrashedDateResume()).toBeNull();
    });

    it('sessionStorage 不可用时静默降级，不影响调用方', () => {
        // 不 stub sessionStorage → 访问抛 ReferenceError → 内部 catch
        expect(() => armDateResumeAttempt('char-x')).not.toThrow();
        expect(() => clearDateResumeAttempt()).not.toThrow();
        expect(takeCrashedDateResume()).toBeNull();
    });
});
