import { describe, it, expect } from 'vitest';
import { removeSongsFromPlaylist } from './charPlaylistEdit';
import type { CharPlaylist, CharPlaylistSong } from '../types';

let songSeq = 1;
const makeSong = (overrides: Partial<CharPlaylistSong> = {}): CharPlaylistSong => ({
  id: songSeq++,
  name: `song-${songSeq}`,
  artists: 'artist',
  album: 'album',
  albumPic: '',
  duration: 200,
  fee: 0,
  ...overrides,
});

const makePlaylist = (id: string, songs: CharPlaylistSong[], updatedAt = 100): CharPlaylist => ({
  id,
  title: `pl-${id}`,
  description: '',
  coverStyle: 'gradient-01',
  songs,
  createdAt: 1,
  updatedAt,
});

describe('removeSongsFromPlaylist', () => {
  it('删掉选中的歌，保留其余', () => {
    const a = makeSong(), b = makeSong(), c = makeSong();
    const playlists = [makePlaylist('p1', [a, b, c])];

    const result = removeSongsFromPlaylist(playlists, 'p1', [b.id], 999);

    expect(result[0].songs.map(s => s.id)).toEqual([a.id, c.id]);
  });

  it('支持一次删多首', () => {
    const a = makeSong(), b = makeSong(), c = makeSong(), d = makeSong();
    const playlists = [makePlaylist('p1', [a, b, c, d])];

    const result = removeSongsFromPlaylist(playlists, 'p1', new Set([a.id, c.id]), 999);

    expect(result[0].songs.map(s => s.id)).toEqual([b.id, d.id]);
  });

  it('只动目标歌单，其它歌单连引用都不变', () => {
    const p1 = makePlaylist('p1', [makeSong(), makeSong()]);
    const p2 = makePlaylist('p2', [makeSong()]);
    const playlists = [p1, p2];

    const result = removeSongsFromPlaylist(playlists, 'p1', [p1.songs[0].id], 999);

    expect(result[1]).toBe(p2); // 别的歌单原样保留
  });

  it('删了歌就把目标歌单 updatedAt 更新为 now', () => {
    const a = makeSong(), b = makeSong();
    const playlists = [makePlaylist('p1', [a, b], 100)];

    const result = removeSongsFromPlaylist(playlists, 'p1', [a.id], 777);

    expect(result[0].updatedAt).toBe(777);
  });

  it('删光所有歌：歌单还在，songs 变空数组', () => {
    const a = makeSong(), b = makeSong();
    const playlists = [makePlaylist('p1', [a, b])];

    const result = removeSongsFromPlaylist(playlists, 'p1', [a.id, b.id], 999);

    expect(result[0].songs).toEqual([]);
    expect(result).toHaveLength(1);
  });

  it('songIds 含歌单里没有的 id：安全忽略，只删存在的', () => {
    const a = makeSong(), b = makeSong();
    const playlists = [makePlaylist('p1', [a, b])];

    const result = removeSongsFromPlaylist(playlists, 'p1', [a.id, 99999], 999);

    expect(result[0].songs.map(s => s.id)).toEqual([b.id]);
  });

  it('空 songIds 是 no-op：按原引用返回，不动 updatedAt', () => {
    const playlists = [makePlaylist('p1', [makeSong()], 100)];

    const result = removeSongsFromPlaylist(playlists, 'p1', [], 999);

    expect(result).toBe(playlists);
  });

  it('目标歌单不存在：按原引用返回', () => {
    const playlists = [makePlaylist('p1', [makeSong()])];

    const result = removeSongsFromPlaylist(playlists, 'nope', [1, 2, 3], 999);

    expect(result).toBe(playlists);
  });

  it('选中的 id 都不在歌单里：no-op，按原引用返回', () => {
    const playlists = [makePlaylist('p1', [makeSong(), makeSong()])];

    const result = removeSongsFromPlaylist(playlists, 'p1', [88888, 99999], 999);

    expect(result).toBe(playlists);
  });
});
