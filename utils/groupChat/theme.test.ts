import { describe, it, expect } from 'vitest';
import { resolveChatTheme } from './theme';
import { ChatTheme } from '../../types';

const presets: Record<string, ChatTheme> = {
    default: {
        id: 'default', name: '默认', type: 'preset',
        user: { textColor: '#fff', backgroundColor: '#111', borderRadius: 18, opacity: 1 },
        ai: { textColor: '#000', backgroundColor: '#eee', borderRadius: 18, opacity: 1 },
    },
    dream: {
        id: 'dream', name: '梦境', type: 'preset',
        user: { textColor: '#fff', backgroundColor: '#f0f', borderRadius: 20, opacity: 1 },
        ai: { textColor: '#333', backgroundColor: '#fdf', borderRadius: 20, opacity: 1 },
    },
};

describe('resolveChatTheme', () => {
    it('未知 id / undefined 回落 default', () => {
        expect(resolveChatTheme('nope', [], presets).id).toBe('default');
        expect(resolveChatTheme(undefined, [], presets).id).toBe('default');
    });

    it('preset 命中', () => {
        expect(resolveChatTheme('dream', [], presets).user.backgroundColor).toBe('#f0f');
    });

    it('custom 同 id 覆盖 preset', () => {
        const custom = { ...presets.dream, id: 'dream', name: 'DIY梦境', type: 'custom' as const };
        expect(resolveChatTheme('dream', [custom], presets).name).toBe('DIY梦境');
    });

    it('legacy 主题缺 user/ai 侧时用 default 补全（不炸 styleConfig 读取）', () => {
        const broken = { id: 'old', name: '旧', type: 'custom' } as unknown as ChatTheme;
        const resolved = resolveChatTheme('old', [broken], presets);
        expect(resolved.user.borderRadius).toBe(18);
        expect(resolved.ai.backgroundColor).toBe('#eee');
    });
});
