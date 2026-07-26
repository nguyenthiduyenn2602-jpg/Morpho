/**
 * 角色歌单的本地编辑操作（纯函数，不碰网络 / 存储）。
 *
 * 抽出来单独放，是为了能脱离 React 组件直接做单元测试——
 * 批量删歌这种"删错一首就糟"的逻辑，靠测试钉住比靠肉眼放心。
 */
import { CharPlaylist } from '../types';

/**
 * 从指定歌单里批量移除若干首歌，返回新的 playlists 数组。
 *
 * - 只动 id === playlistId 的那个歌单，其它歌单原样保留（连引用都不变）。
 * - songIds 里不存在于歌单中的 id 会被安全忽略。
 * - 真有歌被删掉时，目标歌单的 updatedAt 更新为 now；否则整个数组按原引用返回（no-op）。
 * - 删光所有歌只会让 songs 变空数组，歌单本身不会被删除。
 *
 * @param playlists  当前所有歌单
 * @param playlistId 目标歌单的本地 id
 * @param songIds    要删除的歌曲 id 集合
 * @param now        删除发生的时间戳（注入而非内部取，方便测试）
 */
export function removeSongsFromPlaylist(
  playlists: CharPlaylist[],
  playlistId: string,
  songIds: Iterable<number>,
  now: number,
): CharPlaylist[] {
  const idSet = songIds instanceof Set ? songIds : new Set(songIds);
  if (idSet.size === 0) return playlists;

  let changed = false;
  const next = playlists.map(pl => {
    if (pl.id !== playlistId) return pl;
    const keptSongs = pl.songs.filter(s => !idSet.has(s.id));
    if (keptSongs.length === pl.songs.length) return pl; // 没删掉任何歌
    changed = true;
    return { ...pl, songs: keptSongs, updatedAt: now };
  });

  return changed ? next : playlists;
}
