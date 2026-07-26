/**
 * 「进小屋意图」轻量 store（module-level，无 React 依赖）。
 *
 * openApp(AppID.Room) 只能打开小屋 App、无法指定进哪个分区 / 是否直接开梦境。
 * 桌面主题（TamagotchiHome）的世界化入口（家园门、像素电视、床头梦境…）需要
 * 「打开小屋 App 并落到指定 tab / 指定角色 / 直接开梦境」——用这个 store 传意图：
 * 调用方先 request(...) 再 openApp(Room)，RoomApp 挂载时 consume() 一次并应用。
 */

export interface RoomLaunchIntent {
    charId?: string;
    tab?: 'room' | 'worldHome' | 'pixelHome';
    /** 进该角色房间后直接打开梦境演出 */
    openDream?: boolean;
}

let pending: RoomLaunchIntent | null = null;

export const roomLaunch = {
    request(intent: RoomLaunchIntent): void {
        pending = intent;
    },
    /** 只读，不清空——供 useState 惰性初始化把首帧就渲染成目标视图（避免闪一下 select）。 */
    peek(): RoomLaunchIntent | null {
        return pending;
    },
    /** 取出并清空（只应用一次，避免下次进小屋还残留旧意图）。 */
    consume(): RoomLaunchIntent | null {
        const v = pending;
        pending = null;
        return v;
    },
};
