import { describe, it, expect } from 'vitest';
import { deriveRecentTrackSwitchForChar } from './chatRequestPayload';
import type { RecentTrackChange } from '../context/MusicContext';

const record = (overrides: Partial<RecentTrackChange> = {}): RecentTrackChange => ({
    previousSong: { id: 1, name: '起风了', artists: '买辣椒也用券' },
    charIds: ['char-1'],
    at: Date.now(),
    ...overrides,
});

describe('deriveRecentTrackSwitchForChar 换歌察觉判定', () => {
    it('换歌那刻在一起听名单里、未重新加入、刚发生 → 命中，返回上一首信息', () => {
        expect(deriveRecentTrackSwitchForChar(record(), 'char-1', false)).toEqual({
            songName: '起风了',
            artists: '买辣椒也用券',
        });
    });

    it('没有换歌记录 → null', () => {
        expect(deriveRecentTrackSwitchForChar(null, 'char-1', false)).toBeNull();
        expect(deriveRecentTrackSwitchForChar(undefined, 'char-1', false)).toBeNull();
    });

    it('char 已重新加入一起听 → 不再提示', () => {
        expect(deriveRecentTrackSwitchForChar(record(), 'char-1', true)).toBeNull();
    });

    it('换歌那刻 char 不在一起听名单里 → 与它无关，不提示', () => {
        expect(deriveRecentTrackSwitchForChar(record(), 'char-2', false)).toBeNull();
    });

    it('换歌已过去太久（超过新鲜窗口）→ 不再提示', () => {
        const stale = record({ at: Date.now() - 11 * 60 * 1000 });
        expect(deriveRecentTrackSwitchForChar(stale, 'char-1', false)).toBeNull();
    });
});
