// 全局「梦境」生成状态。
// 放在模块作用域而非 DreamTheater 内部，这样：
//   1. 生成中即使离开小屋 App（甚至切到别的 OS App），状态/提示依旧存在；
//   2. PhoneShell 里的全局指示条可以随处显示进度，点一下深链回到那场梦。
import { useSyncExternalStore } from 'react';
import type { DreamScript } from '../types';

export type DreamGenState =
    | { status: 'idle' }
    | { status: 'loading'; charId: string; charName: string }
    | { status: 'ready'; charId: string; charName: string; script: DreamScript }
    | { status: 'error'; charId: string; charName: string };

export type GlobalDreamState = DreamGenState & {
    deepLink?: boolean; // 用户点了全局指示条，请求小屋直接进入那场梦
};

let state: GlobalDreamState = { status: 'idle' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const dreamSimStore = {
    get: (): GlobalDreamState => state,
    set: (s: GlobalDreamState) => { state = s; emit(); },
    reset: () => { state = { status: 'idle' }; emit(); },
    requestOpen: () => { state = { ...state, deepLink: true }; emit(); },
    clearDeepLink: () => { if (state.deepLink) { state = { ...state, deepLink: false }; emit(); } },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function useDreamSim(): GlobalDreamState {
    return useSyncExternalStore(dreamSimStore.subscribe, dreamSimStore.get, dreamSimStore.get);
}
