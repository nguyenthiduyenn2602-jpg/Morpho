/**
 * 云端工具痕迹 —— 「这一轮角色在云端跑过哪些工具」怎么说给用户听。
 *
 * 即时对话把整轮交给云端跑，搜索、翻记忆这些都发生在用户看不见的地方（本地那条路
 * 一直有「正在搜索网页…」的状态条，云端这条路全程静默）。worker 把跑过的工具随最后
 * 一条推送捎回来，气泡底下画一行灰字：
 *
 *     调用了工具：搜索网页 ×2 · 读取记忆
 *
 * 线上传的是**原始工具名 + 次数**（见 worker/amsg/src/index.ts 的 condenseToolTrace），
 * 翻译成人话全在这一份里做——显示的事归客户端，wire 上少一层约定就少一处对不齐。
 */

import { MCP_FIRE_NAME_PREFIX } from './mcpFireCore';

/** worker 捎回来的一项：跑过的工具原始名 + 这一轮跑了几次。 */
export interface AmsgToolTraceEntry {
  name: string;
  count: number;
}

/**
 * 内置工具 → 给用户看的说法。**唯一词表**：聊天里那条「正在搜索网页…」的状态条
 * （utils/instantToolRunner.ts 的 getToolStatusLabel）也从这里取词——同一件事在等待时
 * 和事后回看时必须是同一个说法，过去两张手抄表靠注释互相提醒，迟早漂。
 *
 * 表外的名字原样显示，不编——露个英文名总好过给用户一个错的说法。
 */
const TOOL_DISPLAY_LABELS: Record<string, string> = {
  web_search: '搜索网页',
  recall: '读取记忆',
  notion_read_diary: '读取 Notion',
  read_note: '读取 Notion',
  feishu_read_diary: '读取飞书',
  xhs_search: '读取小红书',
  xhs_browse: '读取小红书',
  xhs_my_profile: '读取小红书',
  xhs_detail: '读取小红书',
  schedule_active_message: '给自己排消息',
  cancel_active_message: '取消排好的消息',
  renew_active_message: '改排好的消息时间',
  list_active_messages: '查自己排的消息',
};

/**
 * 一个工具名 → 给用户看的说法。认不出来的原样返回，名字是空的返回空串（调用方丢掉）。
 *
 * MCP 工具剥掉内部前缀就直接用：那是用户自己接进来的服务器，只有他知道那工具是干嘛的，
 * 我们编不出比原名更准的说法；前缀又是我们拿来分流的，露出去跟他在设置里填的对不上号。
 *
 * export 给状态条那边共用（见 TOOL_DISPLAY_LABELS 注释）。
 */
export const describeToolForUser = (rawName: unknown): string => {
  if (typeof rawName !== 'string') return '';
  const name = rawName.trim();
  if (!name) return '';
  if (name.startsWith(MCP_FIRE_NAME_PREFIX)) return name.slice(MCP_FIRE_NAME_PREFIX.length);
  return TOOL_DISPLAY_LABELS[name] ?? name;
};

/**
 * 工具痕迹 → 气泡底下那行灰字里的内容（不含「调用了工具：」那个前缀）。
 *
 * `[{ name: 'web_search', count: 2 }, { name: 'recall', count: 1 }]`
 *   → `搜索网页 ×2 · 读取记忆`
 *
 * 两条规矩：
 *   - 只跑过一次的省掉 `×1`。不然一行全是 ×1，反倒看不出哪个跑了好几遍。
 *   - 说法相同的几项合并计次（小红书那几个工具在用户眼里是同一件事），
 *     否则会画出「读取小红书 · 读取小红书」，像渲染出了 bug。
 *
 * 形状不对就返回空串、这一行整个不画：这份数据是 worker 随推送捎回来的，老版本 worker
 * 压根不带，宁可少一行也不要在气泡底下渲染出 `[object Object]`。
 */
export const formatAmsgToolTrace = (raw: unknown): string => {
  if (!Array.isArray(raw)) return '';
  const byLabel = new Map<string, number>();
  for (const entry of raw) {
    const label = describeToolForUser((entry as Partial<AmsgToolTraceEntry> | null)?.name);
    if (!label) continue;
    // 次数缺了 / 是垃圾值时按「跑过一次」算：这一项存在本身就说明至少跑过一次。
    const parsed = Number((entry as Partial<AmsgToolTraceEntry>).count);
    const count = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
    byLabel.set(label, (byLabel.get(label) ?? 0) + count);
  }
  return [...byLabel]
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    .join(' · ');
};
