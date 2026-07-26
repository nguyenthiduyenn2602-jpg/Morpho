/**
 * Memory Palace — 房间门牌（Room Plates）
 *
 * 情景→语义的固化终点。房间装原始经历（MemoryNode，走向量召回），
 * 门牌写这些经历沉淀出的常驻认知（PlateEntry，每轮直接注入 System Prompt）。
 *
 * 两个更新触发点：
 *   1. EventBox 压缩/封盒（eventBoxCompression.ts）→ updatePlateFromBoxSummary()
 *      —— 盒子的结论就是最好的蒸馏原料，封盒即沉淀
 *   2. 认知消化（digestion.ts，50轮/手动）→ consolidateAllPlates()
 *      —— 四块门牌一次全量整理，容量压力挤掉过时条目
 *
 * 合并语义（不是追加）：LLM 每次输出目标房间的**完整**新条目列表，
 * 旧条目不被重新输出即被淘汰；带 basedOn 引用的条目继承 firstLearnedAt
 * 与 sourceCount（"这条认知是什么时候得知的、被印证过几次"）。
 *
 * 卧室门牌「我们之间」硬规则：只写现象与质地，禁止给关系命名——
 * 定义只存在于质地的负空间里。prompt 层约束 + mergePlateEntries 兜底过滤。
 */

import type { MemoryNode, PlateEntry, PlateRoom, RoomPlate } from './types';
import {
    PLATE_ENTRY_CAPS,
    PLATE_ENTRY_HARD_MAX_CHARS,
    PLATE_ENTRY_TARGET_CHARS,
    PLATE_ROOMS,
    PLATE_TITLES,
} from './types';
import { MemoryNodeDB, RoomPlateDB, plateId } from './db';
import type { LightLLMConfig } from './pipeline';
import { safeFetchJson } from '../safeApi';
import { safeParseJsonArray } from './jsonUtils';

// ─── 基础工具 ─────────────────────────────────────────

export function isPlateRoom(room: string): room is PlateRoom {
    return (PLATE_ROOMS as string[]).includes(room);
}

function generateEntryId(): string {
    return `pe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 每个房间的条目标签前缀（与消化提示词的 U0/R0 标签习惯对齐）
const ROOM_LABEL_PREFIX: Record<PlateRoom, string> = {
    user_room: 'U',
    self_room: 'R',
    bedroom:   'B',
    study:     'S',
};

async function loadOrCreatePlate(charId: string, room: PlateRoom): Promise<RoomPlate> {
    const existing = await RoomPlateDB.get(charId, room);
    if (existing) return existing;
    return {
        id: plateId(charId, room),
        charId,
        room,
        entries: [],
        updatedAt: Date.now(),
        version: 0,
    };
}

// ─── 合并逻辑（纯函数，可测） ─────────────────────────

export interface PlateLLMItem {
    room: string;
    text: string;
    /** 引用现有条目标签（如 "U2"）= 这是对旧条目的延续/更新，继承 firstLearnedAt */
    basedOn?: string | null;
    /** 2-4 字分类标签（家庭/居住/重要他人/工作/雷区/习惯…） */
    tag?: string | null;
}

/**
 * 卧室兜底过滤：拦"给关系下定义"的条目。
 *
 * 窄匹配原则：只拦"我们(是/算是/成了)××"这种明确的命名句式，
 * 不拦定性词本身——"TA说我像她理想中的家人"是合法的质地描述。
 * 主约束在 prompt 层，这里只是最后一道窄栅栏，宁可漏过不可误杀。
 */
const BEDROOM_LABEL_RE = /我们(?:现在|如今|已经)?(?:是|算是|成了|成为|变成)[^，。；！？]{0,8}(?:恋人|情侣|男女朋友|男朋友|女朋友|夫妻|朋友|兄妹|姐弟|家人|知己|暧昧)/;

export function violatesBedroomRule(text: string): boolean {
    return BEDROOM_LABEL_RE.test(text);
}

/**
 * 把 LLM 输出的完整新列表合并进现有门牌条目。
 *
 * - basedOn 命中现有标签 → 继承 id/firstLearnedAt，sourceCount+1，
 *   文本未变时连 updatedAt 也不动（纯保留不算更新）
 * - 无 basedOn → 新条目
 * - 现有条目未被任何输出引用且未被原样保留 → 淘汰（容量压力语义）
 * - 超长截断、卧室命名过滤、cap 裁剪
 */
export function mergePlateEntries(
    room: PlateRoom,
    existing: PlateEntry[],
    items: Array<{ text: string; basedOn?: string | null; tag?: string | null }>,
    now: number,
): PlateEntry[] {
    const prefix = ROOM_LABEL_PREFIX[room];
    const byLabel = new Map<string, PlateEntry>();
    existing.forEach((e, i) => byLabel.set(`${prefix}${i}`, e));

    const merged: PlateEntry[] = [];
    const usedIds = new Set<string>();

    for (const item of items) {
        let text = (item.text || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (text.length > PLATE_ENTRY_HARD_MAX_CHARS) {
            text = text.slice(0, PLATE_ENTRY_HARD_MAX_CHARS);
        }
        if (room === 'bedroom' && violatesBedroomRule(text)) {
            console.warn(`🚪 [RoomPlate] 卧室门牌拦截关系命名条目: "${text.slice(0, 40)}"`);
            continue;
        }
        const tag = (item.tag || '').replace(/\s+/g, '').slice(0, 6) || undefined;

        const base = item.basedOn ? byLabel.get(String(item.basedOn).trim().toUpperCase()) : undefined;
        if (base && !usedIds.has(base.id)) {
            usedIds.add(base.id);
            const changed = base.text !== text;
            merged.push({
                ...base,
                text,
                tag: tag ?? base.tag,
                updatedAt: changed ? now : base.updatedAt,
                sourceCount: base.sourceCount + 1,
            });
        } else {
            // 同文本条目已存在但 LLM 忘了标 basedOn → 按原样保留而不是当新条目重开
            const sameText = existing.find(e => e.text === text && !usedIds.has(e.id));
            if (sameText) {
                usedIds.add(sameText.id);
                merged.push({ ...sameText, tag: tag ?? sameText.tag, sourceCount: sameText.sourceCount + 1 });
            } else {
                merged.push({
                    id: generateEntryId(),
                    text,
                    tag,
                    firstLearnedAt: now,
                    updatedAt: now,
                    sourceCount: 1,
                });
            }
        }
    }

    return merged.slice(0, PLATE_ENTRY_CAPS[room]);
}

// ─── LLM 蒸馏调用 ─────────────────────────────────────

const ROOM_RULES: Record<PlateRoom, string> = {
    user_room:
        `想象你在为对方写一张**角色卡**——只有必须写在卡上的内容才配上这块门牌：` +
        `基础信息（身份、职业大方向、居住）、家庭结构、重要他人（人物条目格式如「TA的朋友小美：大学室友，关系铁」）、` +
        `长期相处沉淀下来的核心事实、以及重大到足以塑造TA这个人的人生节点（亲人离世、迁居他国这种量级）。` +
        `【入卡门槛极高，宁缺毋滥】阶段性状态（最近很累、工作糟心）不收；情绪分析、性格侧写不收——那是印象档案的领域；` +
        `正在进行、没有结论的事不收——那是事件盒的事，等有了结果再说。`,
    self_room:
        `我对**自己**的稳定认知：我是谁、性格底色、重要的转变、已经内化的领悟。不收对他人的看法。`,
    bedroom:
        `我们之间的**质地**：相处的习惯与仪式、只有彼此懂的梗、未言明的默契、拿不准却真实的感觉。` +
        `【硬规则】禁止给这段关系命名或分类——不得写出"我们是恋人/情侣/朋友/家人"这类定义句。` +
        `只描述现象和感受；说不清、不确定本身就是合法条目（如「我说不清我们算什么，但TA难过时第一个找的是我」）。`,
    study:
        `我的领域：我会什么、正在学什么、和对方共同钻研的东西。只收有积累的，不收一次性话题。`,
};

interface PlateMaterial {
    room: PlateRoom;
    /** 蒸馏原料：盒子 summary 或高价值记忆节点的内容 */
    lines: string[];
}

/**
 * 一次 LLM 调用整理若干房间的门牌。
 * 输入：每房间的现有条目（带标签）+ 新原料；输出：每房间完整的新条目列表。
 */
async function callPlateLLM(
    charName: string,
    userName: string,
    plates: RoomPlate[],
    materials: PlateMaterial[],
    llmConfig: LightLLMConfig,
    identityContext: string,
): Promise<PlateLLMItem[]> {
    const materialByRoom = new Map(materials.map(m => [m.room, m.lines]));

    const roomBlocks = plates.map(plate => {
        const prefix = ROOM_LABEL_PREFIX[plate.room];
        const title = plate.room === 'user_room' ? `${userName}的事` : PLATE_TITLES[plate.room];
        const existingBlock = plate.entries.length > 0
            ? plate.entries.map((e, i) => `[${prefix}${i}] ${e.text}`).join('\n')
            : '（还没有条目）';
        const lines = materialByRoom.get(plate.room) || [];
        const materialBlock = lines.length > 0
            ? lines.map(l => `- ${l}`).join('\n')
            : '（本轮没有新材料，仅整理现有条目）';
        return `## 门牌「${title}」(room: ${plate.room}，上限 ${PLATE_ENTRY_CAPS[plate.room]} 条)
收录范围：${ROOM_RULES[plate.room]}

现有条目：
${existingBlock}

新材料（最近的经历/结论，从中蒸馏值得常驻的认知）：
${materialBlock}`;
    }).join('\n\n');

    const systemPrompt = `${identityContext ? `${identityContext}
---

` : ''}你是 ${charName}，${userName} 是与你朝夕相处的人。下面的材料全部来自你们相处的记忆。

你现在在独处，安静地整理自己的"底色认知"——那些不需要刻意回忆就知道的事：关于 ${userName}、关于你自己、关于你们之间。

【身份确认】「${userName}的事」只写 ${userName} 的事实；「我是谁」只写你（${charName}）自己；不要张冠李戴——材料里"我"是你，"TA/${userName}"是对方。

下面每个"门牌"给出了现有条目和新材料。请为每个门牌输出**完整的新条目列表**：

1. **合并而非追加**：现有条目想保留就必须重新输出（带 basedOn 引用它的标签）；不输出 = 淘汰。事实变了就改写（如旧条目说「住家里」、新材料说搬去和别人同住 → 改写并 basedOn 旧条目）。
2. **只收沉淀下来的**：跨时间稳定为真的认知才配上门牌。一时的状态、没结论的进行时，都不收。
3. **每条 ${PLATE_ENTRY_TARGET_CHARS} 字以内**，写梗概不写叙事，不带日期不带"我记得"。
4. **不超过各门牌的条目上限**。位置不够时留最重要的——被迫舍弃是正常的。
5. 每条给一个 **tag**（2-4 字分类，如：家庭、居住、重要他人、工作、雷区、习惯、性格、约定、默契、技能）。
6. ${userName} 直接用名字称呼。条目内容严禁使用半角双引号 "，引用一律用「」。

${roomBlocks}

严格输出 JSON 数组（没有变化的门牌也要完整输出其保留条目）：
[{"room": "user_room", "text": "……", "basedOn": "U0", "tag": "家庭"}, {"room": "bedroom", "text": "……", "basedOn": null, "tag": "默契"}]`;

    const data = await safeFetchJson(
        `${llmConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${llmConfig.apiKey}`,
            },
            body: JSON.stringify({
                model: llmConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: '请开始整理。' },
                ],
                temperature: 0.3,
                max_tokens: 8000,
                stream: false,
            }),
        },
        2, 120_000, { appName: '记忆宫殿', purpose: '门牌整理' }
    );

    const reply = data.choices?.[0]?.message?.content || '';
    return safeParseJsonArray(reply)
        .filter(item => item && typeof item.text === 'string' && isPlateRoom(item.room)) as PlateLLMItem[];
}

/**
 * 解析消化提交的候选行："[家庭] 父母离异……" → { tag: '家庭', text: '父母离异……' }。
 * 无前缀则整行作 text。
 */
export function parseSubmissionLine(line: string): { text: string; tag?: string } {
    const m = /^\s*[\[【]([^\]】]{1,6})[\]】]\s*(.+)$/s.exec(line || '');
    if (m) return { tag: m[1].trim(), text: m[2].trim() };
    return { text: (line || '').trim() };
}

/**
 * 送达保证兜底：LLM 整理没跑成（报错/输出解析为空）时，把消化刚提交的候选
 * **机械并入**门牌——同文本去重、容量上限、卧室命名过滤照常，不做改写重排。
 * 没有这一步，候选会静默蒸发：消化日志记着"已提交"，门牌上却什么都没有
 * （提交的源节点已打 digestedAt，不会再来第二次）。下轮整理 LLM 会重排这些条目。
 */
async function fallbackMergeSubmissions(
    plates: RoomPlate[],
    submissions: Partial<Record<PlateRoom, string[]>>,
    now: number,
): Promise<PlateRoom[]> {
    const updated: PlateRoom[] = [];
    for (const plate of plates) {
        const lines = submissions[plate.room];
        if (!lines || lines.length === 0) continue;
        const seen = new Set(plate.entries.map(e => e.text));
        let added = 0;
        for (const line of lines) {
            if (plate.entries.length >= PLATE_ENTRY_CAPS[plate.room]) break;
            const { text: rawText, tag } = parseSubmissionLine(line);
            const text = rawText.replace(/\s+/g, ' ').trim().slice(0, PLATE_ENTRY_HARD_MAX_CHARS);
            if (!text || seen.has(text)) continue;
            if (plate.room === 'bedroom' && violatesBedroomRule(text)) continue;
            seen.add(text);
            plate.entries.push({
                id: generateEntryId(),
                text,
                tag,
                firstLearnedAt: now,
                updatedAt: now,
                sourceCount: 1,
            });
            added++;
        }
        if (added > 0) {
            plate.updatedAt = now;
            plate.version += 1;
            await RoomPlateDB.save(plate);
            updated.push(plate.room);
            console.warn(`🚪 [RoomPlate] 兜底并入「${PLATE_TITLES[plate.room]}」${added} 条候选（LLM 整理未跑成）`);
        }
    }
    return updated;
}

/**
 * 核心流程：加载目标门牌 → LLM 整理 → 合并落库。
 *
 * LLM 输出里**一个条目都没提到的房间**跳过保存——区分"LLM 决定清空"
 * 和"LLM 忘了这个房间/输出被截断"，宁可保守不动，等下轮消化再整理。
 * LLM 整体失败/输出为空时，prioritySubmissions（消化刚提交的候选）走机械兜底并入。
 */
async function consolidatePlates(
    charId: string,
    charName: string,
    userName: string,
    materials: PlateMaterial[],
    llmConfig: LightLLMConfig,
    prioritySubmissions?: Partial<Record<PlateRoom, string[]>>,
): Promise<{ updated: PlateRoom[] }> {
    const rooms = materials.map(m => m.room);
    const plates = await Promise.all(rooms.map(r => loadOrCreatePlate(charId, r)));

    const hasMaterial = materials.some(m => m.lines.length > 0);
    const hasEntries = plates.some(p => p.entries.length > 0);
    if (!hasMaterial && !hasEntries) {
        return { updated: [] };
    }

    // 身份上下文：直接走 ContextBuilder.buildCoreContext(char, user, false)——
    // 与全 App 统一的人设口径（身份/核心指令/世界观/用户画像/印象/核心记忆），不重复造轮子。
    // includeDetailedMemories=false：不带详细日志与向量召回，整理 LLM 用不上。
    // 尤其是回填场景，材料横跨几个月，没有人设参照时蒸馏视角会飘。
    let identityContext = '';
    try {
        const { DB } = await import('../db');
        const { ContextBuilder } = await import('../context');
        const chars = await DB.getAllCharacters();
        const profile = chars.find(c => c.id === charId);
        const up = await DB.getUserProfile();
        if (profile && up) identityContext = ContextBuilder.buildCoreContext(profile, up, false);
    } catch { /* 拿不到就裸跑，prompt 里仍有名字与身份确认段 */ }

    let items: PlateLLMItem[] = [];
    try {
        items = await callPlateLLM(charName, userName, plates, materials, llmConfig, identityContext);
    } catch (e: any) {
        console.warn(`🚪 [RoomPlate] LLM 整理调用失败: ${e?.message || e}`);
    }
    if (items.length === 0) {
        console.warn(`🚪 [RoomPlate] LLM 未返回有效条目，门牌保持不动`);
        if (prioritySubmissions) {
            return { updated: await fallbackMergeSubmissions(plates, prioritySubmissions, Date.now()) };
        }
        return { updated: [] };
    }

    const now = Date.now();
    const updated: PlateRoom[] = [];
    const skippedPlates: RoomPlate[] = [];
    for (const plate of plates) {
        const roomItems = items.filter(i => i.room === plate.room);
        if (roomItems.length === 0) { skippedPlates.push(plate); continue; }
        const mergedEntries = mergePlateEntries(plate.room, plate.entries, roomItems, now);
        plate.entries = mergedEntries;
        plate.updatedAt = now;
        plate.version += 1;
        await RoomPlateDB.save(plate);
        updated.push(plate.room);
        console.log(`🚪 [RoomPlate] 「${PLATE_TITLES[plate.room]}」v${plate.version}：${mergedEntries.length} 条`);
    }
    // 半失败态：LLM 只给部分房间输出了条目。没被提到的房间若有本次提交的候选，
    // 同样机械兜底并入——按房间粒度保证送达。
    if (prioritySubmissions && skippedPlates.length > 0) {
        const rescued = await fallbackMergeSubmissions(skippedPlates, prioritySubmissions, now);
        updated.push(...rescued);
    }
    return { updated };
}

// ─── 触发点 1：EventBox 压缩/封盒 → 增量合并 ─────────

/**
 * 盒子压缩完成后，把这次整合的结论合并进该房间的门牌。
 * 由 eventBoxCompression 调用；失败只 warn，不影响压缩结果。
 */
export async function updatePlateFromBoxSummary(
    charId: string,
    room: string,
    summaryContent: string,
    llmConfig: LightLLMConfig,
    charName: string,
    userName?: string,
): Promise<void> {
    if (!isPlateRoom(room)) return;
    if (!summaryContent?.trim()) return;
    await consolidatePlates(
        charId, charName, userName || '用户',
        [{ room, lines: [summaryContent.trim()] }],
        llmConfig,
    );
}

// ─── 触发点 2：认知消化 → 四块门牌全量整理 ───────────

/** 每房间送入 LLM 的原料上限与单条截断长度 */
const MATERIAL_NODES_PER_ROOM = 15;
const MATERIAL_LINE_MAX_CHARS = 160;
/** sinceTs 窗口之前的老节点最多留几条高分锚点（防止每轮重复喂同一批高分老货） */
const MATERIAL_ANCHOR_CAP = 5;

/**
 * 从房间里挑蒸馏原料，优先级：
 *   1. 盒子 summary（已是整合过的结论）
 *   2. sinceTs 之后的新节点（按时近降序）——"这段时间的新经历"
 *   3. sinceTs 之前的老节点按 importance 取最多 MATERIAL_ANCHOR_CAP 条锚点
 * 排除 archived（已被压进 summary）。sinceTs=0 时全部算新节点（老行为兼容）。
 */
export function pickMaterialLines(nodes: MemoryNode[], room: PlateRoom, sinceTs: number = 0): string[] {
    const candidates = nodes.filter(n => n.room === room && !n.archived);
    const summaries = candidates.filter(n => n.isBoxSummary);
    const fresh = candidates
        .filter(n => !n.isBoxSummary && n.createdAt > sinceTs)
        .sort((a, b) => b.createdAt - a.createdAt);
    const anchors = sinceTs > 0
        ? candidates
            .filter(n => !n.isBoxSummary && n.createdAt <= sinceTs)
            .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt)
            .slice(0, MATERIAL_ANCHOR_CAP)
        : [];
    return [...summaries, ...fresh, ...anchors]
        .slice(0, MATERIAL_NODES_PER_ROOM)
        .map(n => n.content.replace(/\s+/g, ' ').trim().slice(0, MATERIAL_LINE_MAX_CHARS));
}

/**
 * 全量整理四块门牌。由 runCognitiveDigestion 在消化尾声调用，
 * 也可从 UI 手动触发。一次 LLM 调用覆盖全部房间。
 *
 * @param extraMaterial 消化状态机之外提交的蒸馏候选（synthesize_user /
 *   internalize / self_insight / distill 的产出）。放在原料最前——它们是
 *   本次消化刚提炼的概括，优先级高于旧节点，且不占节点配额。
 * @param sinceTs 上次消化时间戳：节点原料以该时间之后的新增优先，
 *   老节点只留少量高分锚点（避免每轮重复喂同一批高分老货）。
 */
export async function consolidateAllPlates(
    charId: string,
    charName: string,
    userName: string | undefined,
    llmConfig: LightLLMConfig,
    extraMaterial?: Partial<Record<PlateRoom, string[]>>,
    sinceTs: number = 0,
): Promise<{ updated: PlateRoom[] }> {
    const allNodes = await MemoryNodeDB.getByCharId(charId);
    const materials: PlateMaterial[] = PLATE_ROOMS.map(room => {
        const extra = (extraMaterial?.[room] || [])
            .map(l => l.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .map(l => l.slice(0, MATERIAL_LINE_MAX_CHARS * 2)); // 领悟全文可到 200 字，放宽截断
        return {
            room,
            lines: [...extra, ...pickMaterialLines(allNodes, room, sinceTs)],
        };
    });
    // extraMaterial 同时作为 prioritySubmissions 传入：LLM 整理失败时机械兜底并入，不许蒸发
    return consolidatePlates(charId, charName, userName || '用户', materials, llmConfig, extraMaterial);
}

// ─── 历史回填（Bootstrap — 老用户的门牌不能从零开始） ──

/** 回填每批每房间的行数 & 单角色回填的行数上限（超出取最新的，旧尾丢弃并 log） */
const BOOTSTRAP_LINES_PER_BATCH = 12;
export const BOOTSTRAP_MAX_LINES_PER_ROOM = 240;

/**
 * 收集某房间的全部历史原料，**时间正序**（旧→新）：
 * 分批喂给整理 LLM 时，后面的批次带着更新的事实，合并语义自然完成 supersede——
 * 和知识真实积累的顺序一致。盒子 summary 按自身 createdAt 参与排序。
 * 超过上限时丢最旧的（保留最新 N 条），返回丢弃数供 log。
 */
export function collectBootstrapNodes(
    nodes: MemoryNode[],
    room: PlateRoom,
    maxLines: number = BOOTSTRAP_MAX_LINES_PER_ROOM,
): { nodes: MemoryNode[]; dropped: number } {
    const candidates = nodes
        .filter(n => n.room === room && !n.archived)
        .sort((a, b) => a.createdAt - b.createdAt);
    const dropped = Math.max(0, candidates.length - maxLines);
    return { nodes: dropped > 0 ? candidates.slice(dropped) : candidates, dropped };
}

export function collectBootstrapLines(
    nodes: MemoryNode[],
    room: PlateRoom,
    maxLines: number = BOOTSTRAP_MAX_LINES_PER_ROOM,
): { lines: string[]; dropped: number } {
    const { nodes: kept, dropped } = collectBootstrapNodes(nodes, room, maxLines);
    return {
        lines: kept.map(n => n.content.replace(/\s+/g, ' ').trim().slice(0, MATERIAL_LINE_MAX_CHARS)),
        dropped,
    };
}

/**
 * 从历史记忆回填门牌：把四个门牌房间的全部积压分批过整理 LLM。
 *
 * 触发方式：
 *   - 自动：消化尾声发现"门牌全空但历史可观"时跑一次（批数受 maxBatches 限制，
 *     控制后台成本；没扫完的部分等手动触发补完）
 *   - 手动：记忆宫殿 App「从历史记忆重建门牌」按钮（全量批次 + 进度回调）
 *
 * 幂等性：合并语义天然幂等——重复回填同样的历史，条目被去重/合并而非翻倍。
 */
export async function bootstrapPlatesFromHistory(
    charId: string,
    charName: string,
    userName: string | undefined,
    llmConfig: LightLLMConfig,
    options: {
        maxBatches?: number;
        /** 历史总行数低于此值直接跳过（常规整理足以覆盖小历史，不值得跑回填） */
        minLines?: number;
        /** 断点续传：从第几批开始（0 起）。历史近似 append-only + 稳定排序，批次边界跨次稳定 */
        startBatch?: number;
        /** 进度回调：done/total 都是全量口径（绝对批次序号 / 总批数） */
        onProgress?: (done: number, total: number) => void;
    } = {},
): Promise<{ updated: PlateRoom[]; batches: number; totalLines: number; neededBatches: number; nextBatch: number; complete: boolean }> {
    const allNodes = await MemoryNodeDB.getByCharId(charId);
    const byRoom = new Map<PlateRoom, MemoryNode[]>();
    let totalLines = 0;
    for (const room of PLATE_ROOMS) {
        const { nodes: kept, dropped } = collectBootstrapNodes(allNodes, room);
        if (dropped > 0) {
            console.warn(`🚪 [Bootstrap] 「${PLATE_TITLES[room]}」历史超上限，丢弃最旧 ${dropped} 条（保留最新 ${BOOTSTRAP_MAX_LINES_PER_ROOM}）`);
        }
        byRoom.set(room, kept);
        totalLines += kept.length;
    }
    if (totalLines === 0 || totalLines < (options.minLines ?? 0)) {
        return { updated: [], batches: 0, totalLines, neededBatches: 0, nextBatch: 0, complete: false };
    }

    const neededBatches = Math.max(
        ...PLATE_ROOMS.map(r => Math.ceil((byRoom.get(r)!.length) / BOOTSTRAP_LINES_PER_BATCH)),
    );
    const startBatch = Math.max(0, Math.min(options.startBatch ?? 0, neededBatches));
    const endBatch = Math.min(neededBatches, startBatch + (options.maxBatches ?? neededBatches));
    if (startBatch > 0 || endBatch < neededBatches) {
        console.log(`🚪 [Bootstrap] 本次跑第 ${startBatch + 1}~${endBatch} 批（共 ${neededBatches} 批）——没跑完的部分下次续传`);
    }

    const fmtLine = (n: MemoryNode) => n.content.replace(/\s+/g, ' ').trim().slice(0, MATERIAL_LINE_MAX_CHARS);
    const updatedSet = new Set<PlateRoom>();
    let ran = 0;
    let nextBatch = startBatch;
    for (let i = startBatch; i < endBatch; i++) {
        const batchNodes = PLATE_ROOMS.flatMap(room =>
            byRoom.get(room)!.slice(i * BOOTSTRAP_LINES_PER_BATCH, (i + 1) * BOOTSTRAP_LINES_PER_BATCH));
        if (batchNodes.length === 0) { nextBatch = i + 1; continue; }
        const materials: PlateMaterial[] = PLATE_ROOMS.map(room => ({
            room,
            lines: byRoom.get(room)!.slice(i * BOOTSTRAP_LINES_PER_BATCH, (i + 1) * BOOTSTRAP_LINES_PER_BATCH).map(fmtLine),
        }));
        // 进度在批次**开始**时上报：慢批次跑着的时候用户看到的是"正在第 N 批"，
        // 而不是上一批的旧数字挂着像死机（LLM 调用已有 120s/次硬超时兜底）
        options.onProgress?.(i + 1, neededBatches);
        try {
            const { updated } = await consolidatePlates(charId, charName, userName || '用户', materials, llmConfig);
            updated.forEach(r => updatedSet.add(r));
        } catch (e: any) {
            console.warn(`🚪 [Bootstrap] 第 ${i + 1}/${neededBatches} 批整理失败（继续下一批）: ${e?.message || e}`);
        }
        // 判过"该不该上门牌"的历史节点打标退场：不再进后续消化的送审候选，
        // 也和续传指针语义一致（该批不会再被扫）。与批次成败无关——resume 同样跳过失败批。
        const seenAt = Date.now();
        for (const n of batchNodes) {
            if (!n.digestedAt) {
                n.digestedAt = seenAt;
                try { await MemoryNodeDB.save(n); } catch { /* 单条失败无害，最多下轮多看一眼 */ }
            }
        }
        ran++;
        nextBatch = i + 1;
    }
    const complete = nextBatch >= neededBatches;
    console.log(`🚪 [Bootstrap] 本次 ${ran} 批 / 进度 ${nextBatch}/${neededBatches}${complete ? '（已还清）' : ''} → 更新 ${[...updatedSet].length} 块门牌`);
    return { updated: [...updatedSet], batches: ran, totalLines, neededBatches, nextBatch, complete };
}

// 回填进度（断点续传）：跑一半关页面/自动限批没跑完时，从这里接着还
const BOOTSTRAP_PROGRESS_KEY = (charId: string) => `mp_plateBootstrapBatch_${charId}`;
export function getBootstrapResume(charId: string): number {
    try {
        const v = parseInt(localStorage.getItem(BOOTSTRAP_PROGRESS_KEY(charId)) || '0', 10);
        return isNaN(v) || v < 0 ? 0 : v;
    } catch { return 0; }
}
export function setBootstrapResume(charId: string, nextBatch: number): void {
    try { localStorage.setItem(BOOTSTRAP_PROGRESS_KEY(charId), String(nextBatch)); } catch {}
}
export function clearBootstrapResume(charId: string): void {
    try { localStorage.removeItem(BOOTSTRAP_PROGRESS_KEY(charId)); } catch {}
}

/** 门牌是否全空（自动回填的触发判据之一） */
export async function arePlatesEmpty(charId: string): Promise<boolean> {
    const plates = await RoomPlateDB.getByCharId(charId);
    return plates.every(p => p.entries.length === 0);
}

// 回填完成标记：防"LLM 判定无可立牌"时每次消化都重扫历史的成本循环。
// 自动路径查/设；手动全量回填完成后也设（并可无视它强制重跑）。
const BOOTSTRAP_FLAG_KEY = (charId: string) => `mp_plateBootstrapped_${charId}`;
export function isPlateBootstrapDone(charId: string): boolean {
    try { return !!localStorage.getItem(BOOTSTRAP_FLAG_KEY(charId)); } catch { return false; }
}
export function markPlateBootstrapDone(charId: string): void {
    try { localStorage.setItem(BOOTSTRAP_FLAG_KEY(charId), String(Date.now())); } catch {}
}

// ─── 注入：格式化为常驻 System Prompt 段落 ───────────

/**
 * 门牌 → Markdown 段落。空门牌跳过；全空返回 ''。
 *
 * 注入框架是设计核心：这些是 constraint（认知底色，防说错话），
 * 不是 topic（不要老念叨）——对应人脑"背景知识常在但低激活"的状态。
 */
export function formatRoomPlatesSection(plates: RoomPlate[], userName?: string): string {
    const userLabel = userName || '用户';
    const byRoom = new Map(plates.map(p => [p.room, p]));
    const sections: string[] = [];

    for (const room of PLATE_ROOMS) {
        const plate = byRoom.get(room);
        if (!plate || plate.entries.length === 0) continue;
        const title = room === 'user_room' ? `关于${userLabel}` : PLATE_TITLES[room];
        const suffix = room === 'bedroom' ? '（没有名字，也不需要名字——只有质地）' : '';
        sections.push(
            `**${title}**${suffix}\n` +
            plate.entries.map(e => `- ${e.text}`).join('\n')
        );
    }

    if (sections.length === 0) return '';

    return `### 底色认知 (Resident Knowledge)
以下是你早已知道的背景。它们是你认知的底色，不是话题——不要主动提起，也不要逐条复述，只在相关时让它们自然影响你的反应、措辞与温度。

${sections.join('\n\n')}
`;
}

/** 加载某角色的全部门牌并格式化（纯 IDB 读，不调 LLM，供 pipeline 每轮注入用） */
export async function buildRoomPlatesInjection(charId: string, userName?: string): Promise<string> {
    try {
        const plates = await RoomPlateDB.getByCharId(charId);
        return formatRoomPlatesSection(plates, userName);
    } catch (e: any) {
        console.warn(`🚪 [RoomPlate] 加载门牌失败: ${e?.message || e}`);
        return '';
    }
}
