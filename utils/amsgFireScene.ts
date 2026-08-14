/**
 * 主动消息「此刻在做什么」的到点渲染（AMSG_SLOT_SCENE）。
 *
 * 为什么要有这一层：fire_pack 是最后一次聊天时打好的模板，到点才渲染。角色的日程
 * 「当前时段」和由日程推出来的「此刻在听的歌」都是打包那一刻算的，烤进模板的话，
 * 凌晨三点触发时角色会说「我在健身房呢，今天多跑了两公里」。这两块改成随包带原始数据
 * （整天的作息表 + 歌单抽样池），worker 到点按角色时区现算。
 *
 * 一份表只管一天：随包还带打包那天的日期（dateKey），到点先比日期，跨天了整段不用——
 * 拿周五的作息表照着周日念，跟烤死是同一种穿帮。
 *
 * 零浏览器依赖：只 import type 和两个纯叶子（scheduleInjection / charMusicSchedule /
 * timezone / localDate）。日程文本与前台聊天共用 buildScheduleInjection，歌与前台聊天
 * 共用 pickSongFromPool —— 不共用的话，角色在聊天里和到点生成时会说出两套作息。
 *
 * 前台聊天的音乐块比这里丰富（一起听状态、歌词片段、换歌察觉，见
 * ContextBuilder.buildMusicAtmosphere）。那些要么依赖用户此刻的播放状态、要么要拉网络，
 * worker 都够不着，所以 fire 这边只渲染「你此刻在听什么」这一句。
 */

/** 抽歌只用到这三个字段；专辑封面之类不随包上云。 */
export interface AmsgFireSong {
  id: number;
  name: string;
  artists: string;
}
import { getLocalDateKey } from './localDate';
import { nowInTimeZone } from './timezone';
import { buildScheduleInjection, resolveScheduleSlots, type RenderableSchedule } from './scheduleInjection';
import { pickSongFromPool, slotIsListening } from './charMusicSchedule';
import type { AmsgTzRef } from './amsgFirePack';

/** 随 fire_pack 带给 worker 的原始素材。到点渲染成 AMSG_SLOT_SCENE 那一段。 */
export interface AmsgFireScene {
  /** 角色 id —— 抽歌的种子之一，换个角色同一时段听的歌不一样。 */
  charId: string;
  /**
   * 这份日程说的是哪一天（打包时角色当地的 YYYY-MM-DD）。
   *
   * 表里只有「几点做什么」，没有日期。周五晚上打的包周日上午触发时，光按墙钟时分挑
   * 时段一样挑得出「09:00 晨会」——角色于是在周日说自己正在开周五的会。到点先比日期，
   * 不是同一天就整段不用（见 renderFireSceneBlock）。
   */
  dateKey: string;
  /**
   * 打包时那天的日程；到点由 worker 按角色时区挑出当前时段。
   *
   * 只带渲染会读的字段（见 RenderableSchedule）——整份 DailySchedule 里挂着每个时段
   * 缓存的小剧场台词和 coverImage（可能是 base64 图），随包上云纯属白占体积。
   */
  schedule: RenderableSchedule | null;
  /**
   * 意识流独白。日程自带的 flowNarrative 按小时分三档、到点现取，
   * 这个字段是聊天时演化出来的那一份（进化独白），有的话优先。
   */
  evolvedNarrative?: string;
  /** 歌单抽样池（charMusicSchedule.buildSongPool 的结果，最多 20 首）。 */
  songPool: AmsgFireSong[];
}

/**
 * 这次触发角色「此刻在听」的是哪一首（不在听歌的时段 / 歌单空 / 跨天作废 → null）。
 *
 * 单独 export 是给 worker 用的：prompt 里那句「你此刻在听：《X》」是这里挑的，可角色
 * 写出来的 `[[MUSIC_ACTION:add|歌单标题]]` 标签只带得动歌单名、带不动歌名。worker 到点
 * 把这一首附进 music_action directive，客户端重放时才知道角色说的是哪首歌——不然只能取
 * 「用户此刻在听的那首」，而定时消息补收时用户多半什么都没在放，卡片和加歌单整个不发生。
 *
 * 判定与种子跟 renderFireSceneBlock 共用这一份：prompt 里写的那首和 directive 里冻的
 * 那首必须严格是同一首，各写一份迟早对不上。
 */
export const resolveFireSceneSong = (
  scene: AmsgFireScene | null,
  nowMs: number,
  tz: AmsgTzRef,
): AmsgFireSong | null => {
  if (!scene?.schedule?.slots?.length) return null;
  const wallNow = nowInTimeZone(tz.tzId, new Date(nowMs));
  // 跨天的包整段作废，「此刻在听」跟着走：那首歌是从当前时段推出来的，日程都不算数了，
  // 它就没有依据了（同 renderFireSceneBlock 的日期门槛）。
  if (getLocalDateKey(wallNow) !== scene.dateKey) return null;
  if (scene.songPool.length === 0) return null;

  const { current } = resolveScheduleSlots(scene.schedule, wallNow);
  if (!current || !slotIsListening(current)) return null;
  return pickSongFromPool(
    scene.songPool,
    current.startTime,
    getLocalDateKey(wallNow),
    scene.charId,
  );
};

/**
 * 渲染 fire 时刻的「此刻在做什么」。没有日程、日程是空表、或者这份日程已经不是今天的了，
 * 一律返回空串（槽位被抹平，模板跟没这回事一样）。
 */
export const renderFireSceneBlock = (
  scene: AmsgFireScene | null,
  nowMs: number,
  tz: AmsgTzRef,
): string => {
  if (!scene?.schedule?.slots?.length) return '';

  // 角色所在地的墙钟：日程表里的 "08:00" 说的是角色那边的八点。
  const wallNow = nowInTimeZone(tz.tzId, new Date(nowMs));
  // 跨天的包整段不用：这是 scene.dateKey 那天的安排，第二天再照着念就是在说昨天的事。
  // 宁缺勿错，跟「实时世界拉不到就整段消失」同一条线。
  if (getLocalDateKey(wallNow) !== scene.dateKey) return '';
  const scheduleText = buildScheduleInjection(scene.schedule, scene.evolvedNarrative, wallNow).trim();

  const lines: string[] = [];
  if (scheduleText) lines.push(scheduleText);

  const song = resolveFireSceneSong(scene, nowMs, tz);
  if (song) lines.push(`你此刻在听：《${song.name}》— ${song.artists}`);

  if (lines.length === 0) return '';
  // 前导空行：槽位是紧跟在上一行后面填的，自带空行才不会跟当前时间粘成一行。
  return `\n\n${lines.join('\n')}`;
};
