import React from 'react';
import { AppID } from '../../types';

// ===== 手游主题专用插画 =====
// 二次元手绘风：平涂粉紫渐变 + 干净描边轮廓 + 二分阴影(cel) + 白色高光小细节。
// 每个 viewBox 64x64，className 控制尺寸。渐变 id 各自唯一，避免冲突。

const A = {
    purple1: '#cdbcf2', purple2: '#9a82d6', purpleLine: '#6f57b0', purpleSh: '#8265c4',
    pink1: '#fbcfe6', pink2: '#f09bcb', pinkLine: '#cf5e9e', pinkSh: '#e87fb8',
    peri1: '#c4d1f6', peri2: '#94aae6', periLine: '#6680cf', periSh: '#7e98de',
    gloss: '#ffffff',
};

const Sparkle: React.FC<{ x: number; y: number; s: number; c: string }> = ({ x, y, s, c }) => (
    <path d={`M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z`} fill={c} />
);

// 行星 · 神经链接
const Planet: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs>
            <linearGradient id="mg-planet" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor={A.purple1} /><stop offset="1" stopColor={A.purple2} /></linearGradient>
            <clipPath id="mg-planet-clip"><circle cx="30" cy="30" r="16" /></clipPath>
        </defs>
        <circle cx="30" cy="30" r="16" fill="url(#mg-planet)" stroke={A.purpleLine} strokeWidth="1.8" />
        <g clipPath="url(#mg-planet-clip)"><path d="M14 34 Q30 30 46 36 L46 50 L14 50 Z" fill={A.purpleSh} opacity="0.45" /></g>
        <ellipse cx="23" cy="22" rx="5.5" ry="3.4" fill={A.gloss} opacity="0.7" transform="rotate(-25 23 22)" />
        <ellipse cx="31" cy="31" rx="26" ry="8.5" fill="none" stroke={A.pinkLine} strokeWidth="4.6" transform="rotate(-22 31 31)" opacity="0.95" />
        <ellipse cx="31" cy="31" rx="26" ry="8.5" fill="none" stroke={A.pink1} strokeWidth="1.8" transform="rotate(-22 31 31)" opacity="0.9" />
        <Sparkle x={52} y={13} s={5} c={A.pink1} />
        <Sparkle x={12} y={46} s={3} c={A.gloss} />
    </svg>
);

// 大脑 · 记忆宫殿
const Brain: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs>
            <linearGradient id="mg-brain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.pink1} /><stop offset="1" stopColor={A.pink2} /></linearGradient>
            <clipPath id="mg-brain-clip"><path d="M32 13 C21 13 15 21 18 29 C12 33 15 44 25 43 C27 49 37 49 39 43 C49 44 52 33 46 29 C49 21 43 13 32 13 Z" /></clipPath>
        </defs>
        <path d="M32 13 C21 13 15 21 18 29 C12 33 15 44 25 43 C27 49 37 49 39 43 C49 44 52 33 46 29 C49 21 43 13 32 13 Z" fill="url(#mg-brain)" stroke={A.pinkLine} strokeWidth="1.8" strokeLinejoin="round" />
        <g clipPath="url(#mg-brain-clip)"><rect x="32" y="12" width="20" height="40" fill={A.pinkSh} opacity="0.4" /></g>
        <path d="M32 15 V45" stroke={A.pinkLine} strokeWidth="1.8" opacity="0.55" fill="none" strokeLinecap="round" />
        <path d="M25 23 q5 2 1 7 M39 23 q-5 2 -1 7 M21 33 q5 3 9 1 M43 33 q-5 3 -9 1" stroke={A.gloss} strokeWidth="1.8" opacity="0.6" fill="none" strokeLinecap="round" />
        <Sparkle x={50} y={16} s={4.5} c={A.gloss} />
    </svg>
);

// 电话 · 电话
const Phone: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs><linearGradient id="mg-phone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.purple1} /><stop offset="1" stopColor={A.purple2} /></linearGradient></defs>
        <path d="M19 15 q-5 0 -5 5 q0 9 8 19 q10 13 21 16 q5 1 6 -3 l2 -6 q1 -3 -3 -4 l-7 -2 q-3 -1 -4 2 l-1 2 q-7 -4 -12 -12 l2 -1 q3 -1 2 -4 l-2 -7 q-1 -3 -4 -2 z" fill="url(#mg-phone)" stroke={A.purpleLine} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M21 18.5 q-2.5 0 -2.5 3.2" stroke={A.gloss} strokeWidth="2" opacity="0.6" fill="none" strokeLinecap="round" />
        <path d="M42 14 a9 9 0 0 1 8 8 M44 9 a14 14 0 0 1 11 11" stroke={A.pink2} strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <Sparkle x={14} y={47} s={4} c={A.pink1} />
    </svg>
);

// 房子 · 小小窝
const House: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs>
            <linearGradient id="mg-house" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.peri1} /><stop offset="1" stopColor={A.peri2} /></linearGradient>
            <linearGradient id="mg-roof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.purple1} /><stop offset="1" stopColor={A.purple2} /></linearGradient>
        </defs>
        <rect x="18" y="30" width="28" height="20" rx="3" fill="url(#mg-house)" stroke={A.periLine} strokeWidth="1.8" strokeLinejoin="round" />
        <rect x="38" y="30" width="8" height="20" fill={A.periSh} opacity="0.4" />
        <path d="M32 12 L52 31 Q53 33 50 33 L14 33 Q11 33 12 31 Z" fill="url(#mg-roof)" stroke={A.purpleLine} strokeWidth="1.8" strokeLinejoin="round" />
        <rect x="28" y="38" width="8" height="12" rx="2" fill={A.gloss} opacity="0.92" stroke={A.periLine} strokeWidth="1.2" />
        <circle cx="34" cy="44" r="1" fill={A.periLine} />
        <Sparkle x={50} y={16} s={4} c={A.pink1} />
    </svg>
);

// 手机 · 查手机
const Smartphone: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs><linearGradient id="mg-sp" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stopColor={A.peri1} /><stop offset="1" stopColor={A.peri2} /></linearGradient></defs>
        <rect x="20" y="10" width="24" height="44" rx="7" fill="url(#mg-sp)" stroke={A.periLine} strokeWidth="1.8" />
        <rect x="24" y="16" width="16" height="28" rx="3" fill={A.gloss} opacity="0.9" />
        <path d="M26 18 l9 0 -11 15 0 -11 z" fill={A.peri1} opacity="0.7" />
        <circle cx="32" cy="49" r="2" fill={A.gloss} opacity="0.95" />
        <Sparkle x={47} y={16} s={4.5} c={A.pink1} />
    </svg>
);

// 日记本（带爱心）· 见面
const Diary: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs><linearGradient id="mg-diary" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.pink1} /><stop offset="1" stopColor={A.pink2} /></linearGradient></defs>
        <rect x="16" y="12" width="32" height="40" rx="5" fill="url(#mg-diary)" stroke={A.pinkLine} strokeWidth="1.8" strokeLinejoin="round" />
        <rect x="16" y="12" width="7" height="40" rx="3" fill={A.pinkSh} opacity="0.6" />
        <path d="M34 24 c-2 -3 -7 -2 -7 2 c0 3 4 6 7 8 c3 -2 7 -5 7 -8 c0 -4 -5 -5 -7 -2 z" fill={A.gloss} stroke={A.pinkLine} strokeWidth="1.2" strokeLinejoin="round" />
        <rect x="43" y="20" width="4" height="16" rx="2" fill={A.periSh} stroke={A.periLine} strokeWidth="1" />
        <Sparkle x={50} y={48} s={4} c={A.pink1} />
    </svg>
);

// 文件夹 · 档案
const Folder: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs><linearGradient id="mg-folder" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.peri1} /><stop offset="1" stopColor={A.peri2} /></linearGradient></defs>
        <path d="M12 20 q0 -4 4 -4 l10 0 q2 0 3 2 l2 3 l17 0 q4 0 4 4 l0 4 l-44 0 z" fill={A.periSh} stroke={A.periLine} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="20" y="24" width="24" height="14" rx="2" fill={A.gloss} opacity="0.92" stroke={A.periLine} strokeWidth="1.2" />
        <path d="M10 30 q0 -3 4 -3 l36 0 q4 0 4 3 l-2 15 q-1 4 -5 4 l-30 0 q-4 0 -5 -4 z" fill="url(#mg-folder)" stroke={A.periLine} strokeWidth="1.8" strokeLinejoin="round" />
        <ellipse cx="20" cy="34" rx="5" ry="2" fill={A.gloss} opacity="0.4" />
        <Sparkle x={48} y={20} s={4} c={A.pink1} />
    </svg>
);

// 星星罐 · 存钱罐
const Jar: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs>
            <linearGradient id="mg-jar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.pink1} stopOpacity="0.7" /><stop offset="1" stopColor={A.pink2} stopOpacity="0.85" /></linearGradient>
            <clipPath id="mg-jar-clip"><path d="M20 20 q0 -4 4 -4 l16 0 q4 0 4 4 l0 26 q0 6 -6 6 l-12 0 q-6 0 -6 -6 z" /></clipPath>
        </defs>
        <rect x="22" y="9" width="20" height="7" rx="3.5" fill={A.pinkSh} stroke={A.pinkLine} strokeWidth="1.6" />
        <path d="M20 20 q0 -4 4 -4 l16 0 q4 0 4 4 l0 26 q0 6 -6 6 l-12 0 q-6 0 -6 -6 z" fill="url(#mg-jar)" stroke={A.pinkLine} strokeWidth="1.8" strokeLinejoin="round" />
        <g clipPath="url(#mg-jar-clip)"><rect x="32" y="16" width="14" height="40" fill={A.pinkSh} opacity="0.3" /></g>
        <Sparkle x={32} y={35} s={9} c={A.gloss} />
        <path d={`M32 ${35 - 9} L${32 + 9 * 0.3} ${35 - 9 * 0.3} L${32 + 9} 35 L${32 + 9 * 0.3} ${35 + 9 * 0.3} L32 ${35 + 9} L${32 - 9 * 0.3} ${35 + 9 * 0.3} L${32 - 9} 35 L${32 - 9 * 0.3} ${35 - 9 * 0.3} Z`} fill="none" stroke={A.pinkLine} strokeWidth="1.2" strokeLinejoin="round" />
        <ellipse cx="26" cy="26" rx="2.5" ry="7" fill={A.gloss} opacity="0.4" />
        <Sparkle x={49} y={15} s={4} c={A.pink1} />
    </svg>
);

// 日历（带勾）· 日程
const Calendar: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs><linearGradient id="mg-cal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.purple1} /><stop offset="1" stopColor={A.purple2} /></linearGradient></defs>
        <rect x="13" y="16" width="38" height="36" rx="6" fill="url(#mg-cal)" stroke={A.purpleLine} strokeWidth="1.8" />
        <path d="M13 27 h38" stroke={A.purpleLine} strokeWidth="1.6" opacity="0.7" />
        <rect x="13" y="16" width="38" height="11" rx="6" fill={A.purpleSh} opacity="0.55" />
        <rect x="21" y="11" width="4" height="9" rx="2" fill={A.purpleLine} />
        <rect x="39" y="11" width="4" height="9" rx="2" fill={A.purpleLine} />
        <path d="M24 39 l5 5 9 -11" stroke={A.gloss} strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Sparkle x={47} y={48} s={4} c={A.pink1} />
    </svg>
);

// 齿轮 · 设置
const Gear: React.FC = () => (
    <svg viewBox="0 0 64 64" className="w-full h-full">
        <defs><linearGradient id="mg-gear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={A.purple1} /><stop offset="1" stopColor={A.purple2} /></linearGradient></defs>
        {Array.from({ length: 8 }).map((_, i) => (
            <rect key={i} x="29" y="7" width="6" height="12" rx="3" fill="url(#mg-gear)" stroke={A.purpleLine} strokeWidth="1.4" transform={`rotate(${i * 45} 32 32)`} />
        ))}
        <circle cx="32" cy="32" r="16" fill="url(#mg-gear)" stroke={A.purpleLine} strokeWidth="1.8" />
        <circle cx="32" cy="32" r="7" fill={A.gloss} opacity="0.92" stroke={A.purpleLine} strokeWidth="1.4" />
        <ellipse cx="26" cy="25" rx="3.6" ry="2.2" fill={A.gloss} opacity="0.5" transform="rotate(-30 26 25)" />
        <Sparkle x={51} y={14} s={4} c={A.pink1} />
    </svg>
);

const MG_ART: Partial<Record<AppID, React.FC>> = {
    [AppID.Character]: Planet,
    [AppID.MemoryPalace]: Brain,
    [AppID.Call]: Phone,
    [AppID.Room]: House,
    [AppID.CheckPhone]: Smartphone,
    [AppID.Date]: Diary,
    [AppID.User]: Folder,
    [AppID.Bank]: Jar,
    [AppID.Schedule]: Calendar,
    [AppID.Settings]: Gear,
};

// 有插画就用插画，否则返回 null（调用方回退到 Phosphor 图标）
export const getMobileGameArt = (id: AppID): React.ReactNode => {
    const Comp = MG_ART[id];
    return Comp ? <Comp /> : null;
};
