import { describe, expect, it } from 'vitest';
import { extractAssistantTransfers } from './chatParser';

describe('extractAssistantTransfers', () => {
    it('keeps supporting the canonical action format', () => {
        expect(extractAssistantTransfers('给你。\n[[ACTION:TRANSFER:520]]')).toEqual({
            content: '给你。',
            amounts: ['520'],
        });
    });

    it('tolerates full-width punctuation, currency symbols and decimals', () => {
        expect(extractAssistantTransfers('[[ ACTION：TRANSFER：￥1,999.50 元 ]]')).toEqual({
            content: '',
            amounts: ['1999.50'],
        });
    });

    it('recovers a transfer when the model imitates a system log', () => {
        expect(extractAssistantTransfers('拿着。\n[系统: 你向小鱼转账 1999]')).toEqual({
            content: '拿着。',
            amounts: ['1999'],
        });
        expect(extractAssistantTransfers('【系统：我向你转账￥520元】')).toEqual({
            content: '',
            amounts: ['520'],
        });
    });

    it('does not turn an incoming user transfer log into an outgoing transfer', () => {
        const incoming = '[系统: 用户向你转账 1999]';
        expect(extractAssistantTransfers(incoming)).toEqual({ content: incoming, amounts: [] });
    });

    it('extracts multiple transfers and ignores zero-value actions', () => {
        expect(extractAssistantTransfers('[[ACTION:TRANSFER:520]]\n[[ACTION:TRANSFER:0]]\n[[ACTION:TRANSFER:1314]]')).toEqual({
            content: '',
            amounts: ['520', '1314'],
        });
    });
});
