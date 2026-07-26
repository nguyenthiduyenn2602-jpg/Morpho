import { describe, it, expect } from 'vitest';
import {
    makePacketMeta,
    drawLuckyAmount,
    claimPacket,
    effectivePacketStatus,
    parseSendPacketPayload,
    extractPacketCommands,
    packetHistoryLine,
    GroupPacketMeta,
    PACKET_EXPIRY_MS,
} from './redpacket';
import { Message } from '../../types';

const NOW = 1_700_000_000_000;

const lucky = (over?: Partial<GroupPacketMeta>): GroupPacketMeta => ({
    ...makePacketMeta({ packetType: 'lucky', totalAmount: 88, shares: 3, now: NOW }),
    ...over,
});

const direct = (over?: Partial<GroupPacketMeta>): GroupPacketMeta => ({
    ...makePacketMeta({ packetType: 'direct', totalAmount: 52, targetId: 'c1', note: '请你喝奶茶', now: NOW }),
    ...over,
});

describe('drawLuckyAmount 二倍均值', () => {
    it('注入 rand 后总和守恒且每份 ≥ 0.01', () => {
        const seq = [0.99, 0.01, 0.5];
        let i = 0;
        const rand = () => seq[i++ % seq.length];
        let remaining = 88, shares = 3;
        const amounts: number[] = [];
        while (shares > 0) {
            const a = drawLuckyAmount(remaining, shares, rand);
            amounts.push(a);
            remaining = Math.round((remaining - a) * 100) / 100;
            shares--;
        }
        expect(amounts.every(a => a >= 0.01)).toBe(true);
        expect(amounts.reduce((s, a) => Math.round((s + a) * 100) / 100, 0)).toBe(88);
    });

    it('单份时直接拿全部余额', () => {
        expect(drawLuckyAmount(13.37, 1)).toBe(13.37);
    });

    it('极端边界：份数 = 金额 × 100（每份只能 0.01）', () => {
        let remaining = 0.03, shares = 3;
        const amounts: number[] = [];
        while (shares > 0) {
            const a = drawLuckyAmount(remaining, shares, () => 0.999);
            amounts.push(a);
            remaining = Math.round((remaining - a) * 100) / 100;
            shares--;
        }
        expect(amounts).toEqual([0.01, 0.01, 0.01]);
    });
});

describe('claimPacket 状态机', () => {
    it('lucky：正常抢，最后一份领完转 done 且总和守恒', () => {
        let meta = lucky();
        const got: number[] = [];
        for (const who of ['c1', 'c2', 'user']) {
            const r = claimPacket(meta, who, NOW + 1000);
            expect(r.ok).toBe(true);
            if (r.ok) { meta = r.meta; got.push(r.amount); }
        }
        expect(meta.status).toBe('done');
        expect(got.reduce((s, a) => Math.round((s + a) * 100) / 100, 0)).toBe(88);
    });

    it('lucky：重复抢被拒', () => {
        let meta = lucky();
        const r1 = claimPacket(meta, 'c1', NOW + 1);
        meta = (r1 as any).meta;
        const r2 = claimPacket(meta, 'c1', NOW + 2);
        expect(r2).toEqual({ ok: false, reason: 'already_claimed' });
    });

    it('lucky：领完后再抢被拒 sold_out', () => {
        let meta = lucky({ shares: 1 });
        meta = (claimPacket(meta, 'c1', NOW + 1) as any).meta;
        expect(claimPacket(meta, 'c2', NOW + 2)).toEqual({ ok: false, reason: 'sold_out' });
    });

    it('lucky：发包人自己也能抢（微信同款）', () => {
        // 发包人不在 claims 里有特殊限制——claimantId 任意
        const r = claimPacket(lucky(), 'sender-id', NOW + 1);
        expect(r.ok).toBe(true);
    });

    it('lucky：不能退回', () => {
        expect(claimPacket(lucky(), 'c1', NOW + 1, 'return')).toEqual({ ok: false, reason: 'not_target' });
    });

    it('过期后拒绝领取', () => {
        const r = claimPacket(lucky(), 'c1', NOW + PACKET_EXPIRY_MS + 1);
        expect(r).toEqual({ ok: false, reason: 'expired' });
        expect(effectivePacketStatus(lucky(), NOW + PACKET_EXPIRY_MS + 1)).toBe('expired');
    });

    it('direct：仅目标能收，非目标被拒', () => {
        expect(claimPacket(direct(), 'c2', NOW + 1)).toEqual({ ok: false, reason: 'not_target' });
        const r = claimPacket(direct(), 'c1', NOW + 1);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.amount).toBe(52);
            expect(r.meta.status).toBe('done');
            expect(r.meta.claims).toHaveLength(1);
        }
    });

    it('direct：目标可退回', () => {
        const r = claimPacket(direct(), 'c1', NOW + 1, 'return');
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.action).toBe('returned');
            expect(r.meta.status).toBe('returned');
        }
    });

    it('已 resolved 的包再操作被拒', () => {
        const done = (claimPacket(direct(), 'c1', NOW + 1) as any).meta;
        expect(claimPacket(done, 'c1', NOW + 2).ok).toBe(false);
    });
});

describe('parseSendPacketPayload', () => {
    it('lucky 半角冒号', () => {
        expect(parseSendPacketPayload('lucky:88:5:恭喜发财')).toEqual({ packetType: 'lucky', totalAmount: 88, shares: 5, note: '恭喜发财' });
    });

    it('direct 全角冒号 + 祝福语含冒号', () => {
        expect(parseSendPacketPayload('direct：小蝶：52：注意：请你喝奶茶')).toEqual({ packetType: 'direct', totalAmount: 52, shares: 1, targetName: '小蝶', note: '注意:请你喝奶茶' });
    });

    it('无祝福语', () => {
        expect(parseSendPacketPayload('lucky:10:2')).toEqual({ packetType: 'lucky', totalAmount: 10, shares: 2, note: undefined });
    });

    it('坏金额/坏份数/未知类型 → null', () => {
        expect(parseSendPacketPayload('lucky:abc:5')).toBeNull();
        expect(parseSendPacketPayload('lucky:88:0')).toBeNull();
        expect(parseSendPacketPayload('direct::52')).toBeNull();
        expect(parseSendPacketPayload('foo:88:5')).toBeNull();
        expect(parseSendPacketPayload('lucky:88')).toBeNull();
    });
});

describe('extractPacketCommands', () => {
    it('剥净命令保正文', () => {
        const { text, commands } = extractPacketCommands('哈哈我来了\n[[GRAB_PACKET]]\n手气怎么样');
        expect(text).toBe('哈哈我来了\n\n手气怎么样');
        expect(commands).toEqual([{ kind: 'grab' }]);
    });

    it('SEND_PACKET 载荷坏值也剥标记（不产生命令、正文保留）', () => {
        const { text, commands } = extractPacketCommands('给大家发个红包 [[SEND_PACKET: lucky:abc:xyz]]');
        expect(text).toBe('给大家发个红包');
        expect(commands).toEqual([]);
    });

    it('多命令混合', () => {
        const { commands } = extractPacketCommands('[[RETURN_PACKET]] 不好意思心领了 [[SEND_PACKET: lucky:20:3:回礼]]');
        expect(commands).toHaveLength(2);
        expect(commands[0]).toEqual({ kind: 'return' });
        expect(commands[1].kind).toBe('send');
    });
});

describe('packetHistoryLine', () => {
    const nameOf = (id: string) => (id === 'user' ? '用户' : id === 'c1' ? '小夏' : '成员');
    const msg = (metadata: any): Message => ({ id: 9, charId: 'c1', role: 'assistant', type: 'transfer', content: '[红包]', timestamp: NOW, metadata } as Message);

    it('旧数据沿用 [发红包: X]', () => {
        expect(packetHistoryLine(msg({ amount: '88' }), nameOf, NOW)).toBe('[发红包: 88]');
    });

    it('lucky 未领完 / 领完 / 过期', () => {
        let meta = lucky();
        expect(packetHistoryLine(msg(meta), nameOf, NOW)).toContain('还剩3份可抢');
        meta = (claimPacket(meta, 'c1', NOW + 1, 'claim', () => 0.5) as any).meta;
        const line = packetHistoryLine(msg(meta), nameOf, NOW + 2);
        expect(line).toContain('已领1份');
        expect(line).toContain('小夏 抢到');
        expect(packetHistoryLine(msg(lucky()), nameOf, NOW + PACKET_EXPIRY_MS + 1)).toContain('已过期');
    });

    it('direct 待收/已收/已退', () => {
        expect(packetHistoryLine(msg(direct()), nameOf, NOW)).toContain('待小夏收下或退回');
        const done = (claimPacket(direct(), 'c1', NOW + 1) as any).meta;
        expect(packetHistoryLine(msg(done), nameOf, NOW + 2)).toContain('小夏已收下');
        const ret = (claimPacket(direct(), 'c1', NOW + 1, 'return') as any).meta;
        expect(packetHistoryLine(msg(ret), nameOf, NOW + 2)).toContain('小夏已退回');
    });

    it('回执行', () => {
        expect(packetHistoryLine(msg({ packetReceipt: 'claimed', ref: 1, amount: 30.1, claimantName: '小夏', senderName: '用户' }), nameOf, NOW))
            .toBe('[系统: 小夏 领取了 用户 的红包 30.10]');
        expect(packetHistoryLine(msg({ packetReceipt: 'returned', ref: 1, claimantName: '小夏', senderName: '用户' }), nameOf, NOW))
            .toBe('[系统: 小夏 退回了 用户 的专属红包]');
    });
});
