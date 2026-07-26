// 界面风格方案 —— tamagotchi（电子宠物）与 mobilegame（手游风）两套桌面皮肤共用。
// 每个方案 = { 色相 hue, 明暗 dark, 金线 gold, 压饱和 mute }，各皮肤用自己的
// makeVars 把它推导成整套 CSS 变量（角色 S/L 定死只转色相，任何 hue 都和谐）。

export type TgStyle = { id: string; name: string; hue: number; dark: boolean; gold: boolean; mute: boolean };

export const SCHEMES: TgStyle[] = [
    { id: 'nebula', name: '星云紫', hue: 262, dark: true, gold: false, mute: false },
    { id: 'cream', name: '奶油白', hue: 38, dark: false, gold: true, mute: false },
    { id: 'blackgold', name: '暗夜黑金', hue: 45, dark: true, gold: true, mute: true },
    { id: 'mint', name: '薄荷青', hue: 168, dark: false, gold: false, mute: false },
    { id: 'sakura', name: '粉樱梦', hue: 340, dark: false, gold: false, mute: false },
    { id: 'abyss', name: '深海蓝', hue: 218, dark: true, gold: false, mute: false },
    { id: 'peach', name: '蜜桃汽水', hue: 25, dark: false, gold: false, mute: false },
    { id: 'aurora', name: '极光青', hue: 185, dark: true, gold: false, mute: false },
    { id: 'silver', name: '月雾银', hue: 240, dark: false, gold: false, mute: true },
    { id: 'rose', name: '蔷薇夜', hue: 350, dark: true, gold: false, mute: false },
    { id: 'matcha', name: '抹茶拿铁', hue: 105, dark: false, gold: false, mute: false },
    { id: 'graphite', name: '曜夜银', hue: 250, dark: true, gold: false, mute: true },
];

export const hsl = (h: number, s: number, l: number, a?: number) => {
    const hh = ((h % 360) + 360) % 360;
    return a === undefined ? `hsl(${hh}, ${s}%, ${l}%)` : `hsla(${hh}, ${s}%, ${l}%, ${a})`;
};

// 面板小预览用：方案的底色 / 线色
export const schemePreview = (s: TgStyle) => ({
    bg: s.dark ? hsl(s.hue, s.mute ? 10 : 26, 14) : hsl(s.hue, s.mute ? 10 : 50, 92),
    line: s.gold ? (s.dark ? hsl(45, 48, 64) : hsl(43, 42, 56)) : hsl(s.hue, s.mute ? 12 : 45, s.dark ? 74 : 62),
});
