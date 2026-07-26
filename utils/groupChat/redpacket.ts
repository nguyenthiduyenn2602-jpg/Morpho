// 群聊红包 2.0 —— schema / 领取状态机 / 拼手气分配 / 指令解析 / prompt 序列化。
// 纯函数、无副作用（时间与随机数由调用方注入），便于 vitest 直测。
// 金额是纯装饰（与私聊转账一致），不接银行余额。
import { Message } from '../../types';

export type PacketStatus = 'pending' | 'done' | 'returned' | 'expired';

export interface PacketClaim {
    /** 'user' 或成员 charId */
    claimantId: string;
    amount: number;
    at: number;
}

/** 挂在 type:'transfer' 消息 metadata 上；`packet: true` 判别新版红包 vs 旧数据 */
export interface GroupPacketMeta {
    packet: true;
    packetType: 'direct' | 'lucky';
    /** 纯装饰金额，两位小数 */
    totalAmount: number;
    /** direct 恒为 1 */
    shares: number;
    /** 仅 direct：charId 或 'user' */
    targetId?: string;
    note?: string;
    claims: PacketClaim[];
    status: PacketStatus;
    /** 发出 + 24h，懒判定（渲染/领取时判，无定时器） */
    expiresAt: number;
    resolvedAt?: number;
}

/** 领取/退回回执（独立 transfer 消息，对齐私聊 receipt 模式） */
export interface PacketReceiptMeta {
    packetReceipt: 'claimed' | 'returned';
    /** 原红包消息 id */
    ref: number;
    amount?: number;
    claimantName: string;
    senderName: string;
}

export const PACKET_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PACKET_NOTE = '恭喜发财';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function makePacketMeta(opts: {
    packetType: 'direct' | 'lucky';
    totalAmount: number;
    shares?: number;
    targetId?: string;
    note?: string;
    now: number;
}): GroupPacketMeta {
    return {
        packet: true,
        packetType: opts.packetType,
        totalAmount: round2(opts.totalAmount),
        shares: opts.packetType === 'direct' ? 1 : Math.max(1, Math.floor(opts.shares ?? 1)),
        targetId: opts.packetType === 'direct' ? opts.targetId : undefined,
        note: opts.note?.trim() || DEFAULT_PACKET_NOTE,
        claims: [],
        status: 'pending',
        expiresAt: opts.now + PACKET_EXPIRY_MS,
    };
}

/**
 * 拼手气随机金额——二倍均值法：每份期望 = 剩余均值，上限 2 倍均值。
 * 保证每份 ≥ 0.01 且给后面每份留足 0.01；最后一份 = 全部余额（总和守恒）。
 */
export function drawLuckyAmount(remaining: number, remainingShares: number, rand: () => number = Math.random): number {
    if (remainingShares <= 1) return round2(remaining);
    const max = remaining - 0.01 * (remainingShares - 1);
    const raw = round2(rand() * (remaining / remainingShares) * 2);
    return Math.min(Math.max(raw, 0.01), round2(max));
}

export type ClaimResult =
    | { ok: true; meta: GroupPacketMeta; amount: number; action: 'claimed' | 'returned' }
    | { ok: false; reason: 'expired' | 'already_claimed' | 'not_target' | 'sold_out' | 'not_pending' };

/**
 * 领取状态机（不修改入参，返回新 meta）：
 * - lucky：群内任何人可抢（含发包人，微信同款），重复抢拒绝，领满转 done
 * - direct：仅 targetId 可收（action 'claim'）或退（action 'return'）
 * - pending 且过期 → 拒绝（返回 expired，由调用方决定是否落 expired 态）
 */
export function claimPacket(
    meta: GroupPacketMeta,
    claimantId: string,
    now: number,
    action: 'claim' | 'return' = 'claim',
    rand: () => number = Math.random,
): ClaimResult {
    if (meta.status !== 'pending') {
        return { ok: false, reason: meta.status === 'done' ? 'sold_out' : 'not_pending' };
    }
    if (now > meta.expiresAt) return { ok: false, reason: 'expired' };

    if (meta.packetType === 'direct') {
        if (meta.targetId !== claimantId) return { ok: false, reason: 'not_target' };
        if (action === 'return') {
            return { ok: true, action: 'returned', amount: meta.totalAmount, meta: { ...meta, status: 'returned', resolvedAt: now } };
        }
        const claim: PacketClaim = { claimantId, amount: meta.totalAmount, at: now };
        return { ok: true, action: 'claimed', amount: meta.totalAmount, meta: { ...meta, claims: [claim], status: 'done', resolvedAt: now } };
    }

    // lucky
    if (action === 'return') return { ok: false, reason: 'not_target' }; // 拼手气不能退
    if (meta.claims.some(c => c.claimantId === claimantId)) return { ok: false, reason: 'already_claimed' };
    if (meta.claims.length >= meta.shares) return { ok: false, reason: 'sold_out' };

    const claimedSum = round2(meta.claims.reduce((s, c) => s + c.amount, 0));
    const remaining = round2(meta.totalAmount - claimedSum);
    const remainingShares = meta.shares - meta.claims.length;
    const amount = drawLuckyAmount(remaining, remainingShares, rand);
    const claims = [...meta.claims, { claimantId, amount, at: now }];
    const done = claims.length >= meta.shares;
    return {
        ok: true,
        action: 'claimed',
        amount,
        meta: { ...meta, claims, status: done ? 'done' : 'pending', ...(done ? { resolvedAt: now } : {}) },
    };
}

/** 渲染/领取时的懒过期判定 */
export function effectivePacketStatus(meta: GroupPacketMeta, now: number): PacketStatus {
    if (meta.status === 'pending' && now > meta.expiresAt) return 'expired';
    return meta.status;
}

// ─── 指令解析（两层容错：坏值静默丢弃，绝不影响正文） ───

export interface PacketCommand {
    kind: 'grab' | 'return' | 'send';
    /** 仅 send */
    send?: { packetType: 'direct' | 'lucky'; totalAmount: number; shares: number; targetName?: string; note?: string };
}

/**
 * 解析 [[SEND_PACKET: ...]] 的载荷：
 *   lucky:总额:份数(:祝福语)  /  direct:目标名:金额(:祝福语)
 * 按全/半角冒号切前 3 段，其余合并为祝福语（祝福语里的冒号不炸）。
 * 金额非法 / 份数 < 1 / 目标名为空 → null。
 */
export function parseSendPacketPayload(payload: string): PacketCommand['send'] | null {
    const parts = String(payload ?? '').split(/[:：]/);
    if (parts.length < 3) return null;
    const kind = parts[0].trim().toLowerCase();
    if (kind === 'lucky') {
        const totalAmount = parseFloat(parts[1]);
        const shares = parseInt(parts[2], 10);
        if (!Number.isFinite(totalAmount) || totalAmount <= 0) return null;
        if (!Number.isFinite(shares) || shares < 1) return null;
        const note = parts.slice(3).join(':').trim() || undefined;
        return { packetType: 'lucky', totalAmount: round2(totalAmount), shares: Math.floor(shares), note };
    }
    if (kind === 'direct') {
        const targetName = parts[1].trim();
        const totalAmount = parseFloat(parts[2]);
        if (!targetName) return null;
        if (!Number.isFinite(totalAmount) || totalAmount <= 0) return null;
        const note = parts.slice(3).join(':').trim() || undefined;
        return { packetType: 'direct', totalAmount: round2(totalAmount), shares: 1, targetName, note };
    }
    return null;
}

/**
 * 从角色输出里抠红包命令，返回剥净后的正文 + 命令列表。
 * 无法解析的 SEND_PACKET 也会被剥掉（保正文），只是不产生命令。
 */
export function extractPacketCommands(content: string): { text: string; commands: PacketCommand[] } {
    const commands: PacketCommand[] = [];
    let text = String(content ?? '');

    text = text.replace(/\[\[\s*GRAB_PACKET\s*\]\]/gi, () => { commands.push({ kind: 'grab' }); return ''; });
    text = text.replace(/\[\[\s*RETURN_PACKET\s*\]\]/gi, () => { commands.push({ kind: 'return' }); return ''; });
    text = text.replace(/\[\[\s*SEND_PACKET\s*[:：]\s*([\s\S]*?)\]\]/gi, (_m, payload) => {
        const send = parseSendPacketPayload(payload);
        if (send) commands.push({ kind: 'send', send });
        return '';
    });

    return { text: text.trim(), commands };
}

// ─── prompt 序列化 ───

const fmtAmount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * 群历史里一条 transfer 消息的文本行（不含 `名字: ` 前缀，调用方拼）。
 * 旧数据（无 packet 判别）沿用 `[发红包: X]`。
 */
export function packetHistoryLine(msg: Message, nameOf: (claimantId: string) => string, now: number): string {
    const meta = msg.metadata as Partial<GroupPacketMeta & PacketReceiptMeta> | undefined;
    if (meta?.packetReceipt) {
        return meta.packetReceipt === 'claimed'
            ? `[系统: ${meta.claimantName} 领取了 ${meta.senderName} 的红包${meta.amount != null ? ` ${fmtAmount(meta.amount)}` : ''}]`
            : `[系统: ${meta.claimantName} 退回了 ${meta.senderName} 的专属红包]`;
    }
    if (!meta?.packet) return `[发红包: ${meta?.amount ?? ''}]`;

    const m = meta as GroupPacketMeta;
    const status = effectivePacketStatus(m, now);
    if (m.packetType === 'direct') {
        const target = nameOf(m.targetId || '');
        const tail = status === 'done' ? `${target}已收下`
            : status === 'returned' ? `${target}已退回`
            : status === 'expired' ? '已过期'
            : `待${target}收下或退回`;
        return `[发了专属红包给 ${target}：金额${fmtAmount(m.totalAmount)}，「${m.note}」（${tail}）]`;
    }
    const claimed = m.claims.map(c => `${nameOf(c.claimantId)} 抢到${fmtAmount(c.amount)}`).join('、');
    const tail = status === 'done' ? '已被领完'
        : status === 'expired' ? '已过期'
        : `还剩${m.shares - m.claims.length}份可抢`;
    return `[发了拼手气红包：总额${fmtAmount(m.totalAmount)}，共${m.shares}份，「${m.note}」${m.claims.length > 0 ? `，已领${m.claims.length}份（${claimed}）` : ''}，${tail}]`;
}
