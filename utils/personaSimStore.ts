// 全局「人格模拟」演出生成状态。
// 放在模块作用域而非 CheckPhone 内部，这样：
//   1. 生成中即使离开查手机 App（甚至切到别的 OS App），状态/提示依旧存在；
//   2. PhoneShell 里的全局指示条可以随处显示进度，点一下深链回到演出。
import { useSyncExternalStore } from 'react';
import type { SimState } from '../apps/PersonaSim';

export type GlobalSimState = SimState & {
    charId?: string;
    charName?: string;
    deepLink?: boolean; // 用户点了全局指示条，请求 CheckPhone 直接进入该演出
};

let state: GlobalSimState = { status: 'idle' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const personaSimStore = {
    get: (): GlobalSimState => state,
    set: (s: GlobalSimState) => { state = s; emit(); },
    reset: () => { state = { status: 'idle' }; emit(); },
    requestOpen: () => { state = { ...state, deepLink: true }; emit(); },
    clearDeepLink: () => { if (state.deepLink) { state = { ...state, deepLink: false }; emit(); } },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function usePersonaSim(): GlobalSimState {
    return useSyncExternalStore(personaSimStore.subscribe, personaSimStore.get, personaSimStore.get);
}
