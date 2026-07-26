/**
 * 小屋「生活动态」涓流 → 私聊 room_card
 *
 * 思路（用户拍板的极简版）：情绪评估（副 API）本来就在每轮聊完后跑，让它**偶尔顺便**
 * 捎带一句「角色小屋里发生的小变化」（换了桌上的书 / 窗台多了盆花……），落成一张
 * 轻量 room_card 进私聊——卡片 content 进上下文，角色自然记得自己干过啥，
 * 后续归档/记忆全走现有管线。**不绑角色字段、不做独立 feed**：卡片本身就是记录，
 * 一切交给上下文和看到上下文的 AI。
 *
 * 管线（双路径通吃）：
 *   1. buildEmotionEvalPrompt 构建时，若 shouldRequestAmbient 双闸通过，追加
 *      buildAmbientEvalSection 的可选输出段。instant 模式的 eval prompt 也是客户端
 *      构建后传给 worker 的，所以这一处覆盖在线 + instant 两条路径。
 *   2. applyEmotionEvalRaw（两条路径的共用落点）解析可选 ambientEvent，
 *      落 room_card + 记录 localStorage 水位。
 *
 * 节流双闸（客户端判，判不过连 prompt 段都不加、零成本）：
 *   - 时间闸：距上一条 < AMBIENT_MIN_INTERVAL_MS 不生成
 *   - 概率闸：过了时间闸也只有 AMBIENT_PROBABILITY 概率真出——"偶尔"的惊喜，不是准点打卡
 */

import { CharacterProfile } from '../types';
import { DB } from './db';

export const AMBIENT_MIN_INTERVAL_MS = 90 * 60 * 1000; // 90 分钟
export const AMBIENT_PROBABILITY = 0.3;
const AMBIENT_TEXT_MAX = 60;

const lastKey = (charId: string) => `room_ambient_last_${charId}`;

interface AmbientMark { ts: number; text: string }

function readLastMark(charId: string): AmbientMark | null {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(lastKey(charId)) : null;
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return typeof parsed?.ts === 'number' ? parsed : null;
    } catch { return null; }
}

function writeLastMark(charId: string, text: string): void {
    try { localStorage.setItem(lastKey(charId), JSON.stringify({ ts: Date.now(), text } satisfies AmbientMark)); } catch { /* ignore */ }
}

/** 双闸判定。random 可注入便于测试。 */
export function shouldRequestAmbient(charId: string, random: () => number = Math.random): boolean {
    const last = readLastMark(charId);
    if (last && Date.now() - last.ts < AMBIENT_MIN_INTERVAL_MS) return false;
    return random() < AMBIENT_PROBABILITY;
}

/** 情绪评估 prompt 的可选输出段。只在双闸通过时拼进去。 */
export function buildAmbientEvalSection(char: CharacterProfile): string {
    const items = (char.roomConfig?.items || [])
        .slice(0, 15)
        .map(i => i.name)
        .filter(Boolean)
        .join('、');
    const lastText = readLastMark(char.id)?.text;
    return `

## [可选] 小屋生活动态 (ambientEvent)
角色有一间自己的小屋。如果你觉得 ta 这段时间里、在自己的生活里自然会发生一个**微小的变化**
（换了桌上的书、窗台多了盆花、灯还亮着、杯子挪了位置……），可以在上述 JSON 里额外加一个可选字段：
"ambientEvent": { "text": "把飘窗那本书换成了新的一本", "emoji": "📖" }
- text ≤ ${AMBIENT_TEXT_MAX} 字，客观白描一句，不带心理描写（心理归 innerState）。
- 变化要贴合角色此刻的日程/情绪，且是 ta 自己生活的痕迹，与用户无关。
${items ? `- 小屋里现有的物件可以参考：${items}。` : ''}
${lastText ? `- 上一条动态是「${lastText}」，不要重复或雷同。` : ''}
- **绝大多数时候不需要**——没有值得一提的变化就省略整个 ambientEvent 字段，不要硬编。`;
}

/**
 * 从 eval 结果里解析可选 ambientEvent 并落地：私聊 room_card + localStorage 水位。
 * 宽松校验，不合法/失败静默返回 false，绝不影响情绪主链路。
 */
export async function landAmbientEventFromEval(parsed: any, char: CharacterProfile): Promise<boolean> {
    try {
        const ev = parsed?.ambientEvent;
        if (!ev || typeof ev.text !== 'string' || !ev.text.trim()) return false;
        const text = ev.text.trim().slice(0, AMBIENT_TEXT_MAX);
        const emoji = (typeof ev.emoji === 'string' && ev.emoji.trim()) ? ev.emoji.trim().slice(0, 4) : undefined;
        await DB.saveMessage({
            charId: char.id,
            role: 'assistant',
            type: 'room_card',
            content: `[小屋动态] ${char.name}${text}`,
            metadata: { roomAmbient: true, text, emoji },
        });
        writeLastMark(char.id, text);
        console.log(`🏠 [RoomAmbient] ${char.name}: ${text}`);
        return true;
    } catch (e: any) {
        console.warn('🏠 [RoomAmbient] land failed (non-fatal):', e?.message);
        return false;
    }
}
