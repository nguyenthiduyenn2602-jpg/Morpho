import { describe, expect, it } from 'vitest';
import {
    hasMemberApiConfig,
    isMemberApiConfigComplete,
    memberApiConfigFingerprint,
    normalizeMemberApiConfig,
} from './apiConfig';

describe('群成员独立 API 配置', () => {
    it('规范化空白与 URL 尾斜杠', () => {
        expect(normalizeMemberApiConfig({ baseUrl: ' https://api.example.com/v1/// ', apiKey: ' key ', model: ' model ' }))
            .toEqual({ baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' });
    });

    it('区分空配置、残缺配置与完整配置', () => {
        expect(hasMemberApiConfig({})).toBe(false);
        expect(hasMemberApiConfig({ apiKey: 'key' })).toBe(true);
        expect(isMemberApiConfigComplete({ apiKey: 'key' })).toBe(false);
        expect(isMemberApiConfigComplete({ baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' })).toBe(true);
    });

    it('指纹对等价配置稳定，任一字段变化都会失效', () => {
        const base = { baseUrl: 'https://api.example.com/v1/', apiKey: 'key', model: 'm' };
        expect(memberApiConfigFingerprint(base)).toBe(memberApiConfigFingerprint({ ...base, baseUrl: ' https://api.example.com/v1 ' }));
        expect(memberApiConfigFingerprint(base)).not.toBe(memberApiConfigFingerprint({ ...base, apiKey: 'key-2' }));
        expect(memberApiConfigFingerprint(base)).not.toBe(memberApiConfigFingerprint({ ...base, model: 'm-2' }));
    });
});
