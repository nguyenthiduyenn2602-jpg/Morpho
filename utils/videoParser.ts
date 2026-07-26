// 视频链接解析 — 抖音 / B站 / 快手等视频平台的分享链接，Jina Reader 基本抓不到东西
// （SPA + 登录墙），走 apizero 的 video-parse API 拿结构化元数据（标题/作者/封面/热度），
// 映射成 ExtractedWebpage 复用现有 webpage_card 管线（卡片渲染 + messageFormat 喂 LLM）。
//
// 接入方式：浏览器直连（该 API CORS 全开），不走 sfworker —— 匿名配额按调用方 IP 计，
// 经 worker 转发会让所有用户挤同一个出口 IP 的每日配额。API Key 可选（apizero.cn 注册，
// 会员配额更高），存 localStorage，设置页「视频链接解析」里填。
//
// 失败（配额耗尽 / 平台不支持 / 服务挂了）由调用方降级到 extractWebpageContent。

import type { ExtractedWebpage, VideoShareInfo } from './webpageExtractor';

const API_ENDPOINT = 'https://v1.apizero.cn/api/video-parse';
const LS_KEY = 'sully_video_parse_key_v1';
const REQUEST_TIMEOUT_MS = 20000;

// 内置默认 Key（原仓库内嵌了作者共享 key，二改版已清空，避免公开仓库泄露密钥）。
// 清空后回落匿名调用（5 次/天/IP）；二改用户可在设置页「视频链接解析」自填 apizero key 覆盖。
const DEFAULT_VIDEO_PARSE_KEY = '';

/** 读取生效的 apizero API Key：localStorage 用户自填 > 内置默认 > 匿名（空串）。 */
export const getVideoParseKey = (): string => {
  try {
    return (localStorage.getItem(LS_KEY) || '').trim() || DEFAULT_VIDEO_PARSE_KEY;
  } catch {
    return DEFAULT_VIDEO_PARSE_KEY;
  }
};

/** 写入 API Key。传空 → 清掉（回落内置默认 key，没有内置则匿名）。 */
export const setVideoParseKey = (key: string): void => {
  try {
    const trimmed = (key || '').trim();
    if (!trimmed) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, trimmed);
  } catch { /* localStorage 不可用就当匿名 */ }
};

// video-parse 支持的平台域名。判断按 hostname 后缀匹配（含子域）。
// 宽进严出：命中了但解析失败会降级回通用网页抓取，所以像 weibo/x.com 这种
// 「不一定是视频」的域名也放进来——视频页解析成功赚到，文字帖失败就走老路。
// 小红书不在列：已有专门的 xhs_card 路径（apps/Chat.tsx）。
const VIDEO_SHARE_HOSTS: RegExp[] = [
  /(?:^|\.)douyin\.com$/i, /(?:^|\.)iesdouyin\.com$/i,
  /(?:^|\.)tiktok\.com$/i,
  /(?:^|\.)bilibili\.com$/i, /^b23\.tv$/i,
  /(?:^|\.)kuaishou\.com$/i, /(?:^|\.)chenzhongtech\.com$/i, // chenzhongtech: 快手分享短链域
  /(?:^|\.)weibo\.com$/i, /(?:^|\.)weibo\.cn$/i,
  /(?:^|\.)pipix\.com$/i, /(?:^|\.)izuiyou\.com$/i,
  /(?:^|\.)youtube\.com$/i, /^youtu\.be$/i,
  /(?:^|\.)vimeo\.com$/i,
  /(?:^|\.)twitter\.com$/i, /(?:^|\.)x\.com$/i, /^t\.co$/i,
  /(?:^|\.)jianying\.com$/i, /(?:^|\.)klingai\.com$/i, // 即梦 / 可灵 AI 生成内容分享
];

/** 这个链接是否该优先走视频解析（而不是通用网页抓取）。 */
export function isVideoShareUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return VIDEO_SHARE_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

// API 业务错误码 → 用户能看懂的话（HTTP 状态不可靠，以 body.code 为准）。
const ERROR_MESSAGES: Record<number, string> = {
  4000: '链接格式不对或平台不支持',
  4015: '今日免费解析次数已用完（可在设置里填 API Key 提额）',
  4029: '解析请求太频繁，稍等几秒再试',
  4030: '今日解析配额已耗尽',
  5020: '解析服务连不上源平台',
  5021: '源平台内容解析失败（可能已删除或需要登录）',
};

/** 大数字转「1.2万 / 3.4亿」，卡片和喂 LLM 的热度行共用。0 / 无效返回空串。 */
export function formatStatCount(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
  if (n >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return String(n);
}

const toCount = (v: any): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * 调 apizero video-parse 解析一个视频平台分享链接，返回可直接存进
 * webpage_card metadata 的 ExtractedWebpage（带 video 附加字段）。
 * 失败抛错，调用方负责降级到 extractWebpageContent。
 */
export async function parseVideoShareUrl(url: string): Promise<ExtractedWebpage> {
  const params = new URLSearchParams({ url, flat: '1' });
  const key = getVideoParseKey();
  if (key) params.set('key', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let parsed: any = null;
  try {
    const res = await fetch(`${API_ENDPOINT}?${params.toString()}`, { signal: controller.signal });
    const text = await res.text().catch(() => '');
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    if (!parsed) throw new Error(`视频解析服务无响应 (HTTP ${res.status})`);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('视频解析超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const code = Number(parsed.code);
  if (code !== 0) {
    throw new Error(ERROR_MESSAGES[code] || String(parsed.msg || `视频解析失败 (code ${code})`));
  }

  // flat=1：字段直接在 data 顶层。兼容 flat=0 的两层 data 以防 API 行为变化。
  const d: any = parsed.data?.data && !parsed.data.title ? parsed.data.data : (parsed.data || {});
  const source: any = d.source || {};
  const stats: any = d.stats || {};
  const imagelist: string[] = Array.isArray(d.imagelist) ? d.imagelist.filter((u: any) => typeof u === 'string' && u) : [];
  const isImagePost = d.type === '图片' || (!d.video_url && imagelist.length > 0);

  const title = String(d.title || '').trim();
  if (!title && !d.video_url && !imagelist.length) {
    throw new Error('解析结果为空'); // 空壳结果不建卡，降级走通用抓取
  }

  const video: VideoShareInfo = {
    platform: String(d.platform || source.platform || ''),
    platformLabel: String(source.platform_label || '') || undefined,
    contentType: isImagePost ? 'image' : 'video',
    authorName: String(stats.author_name || source.author_name || '') || undefined,
    authorAvatar: String(stats.author_avatar || '') || undefined,
    playCount: toCount(stats.play_count),
    likeCount: toCount(stats.like_count),
    commentCount: toCount(stats.comment_count),
    shareCount: toCount(stats.share_count),
    collectCount: toCount(stats.collect_count),
    publishTime: String(stats.publish_time || '') || undefined,
    imageCount: isImagePost ? imagelist.length : undefined,
  };

  const finalUrl = String(source.original_url || '') || undefined;
  return {
    url,
    finalUrl,
    title: title || `${video.platformLabel || video.platform}${isImagePost ? '图文' : '视频'}`,
    siteName: video.platformLabel || video.platform || undefined,
    content: '', // 视频没有可读正文；messageFormat 的 video 分支会生成专门的描述文本
    excerpt: video.authorName ? `@${video.authorName}` : '',
    image: String(d.cover_url || '').trim() || imagelist[0] || undefined,
    truncated: false,
    fetchedAt: Date.now(),
    video,
  };
}
