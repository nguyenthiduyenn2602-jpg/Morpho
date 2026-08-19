import { describe, expect, it } from 'vitest';
import type { APIConfig, CharacterProfile, GroupProfile } from '../../types';
import { resolveGroupTopicApi } from './apiConfig';

const globalConfig: APIConfig = {
    baseUrl: 'https://global.example/v1',
    apiKey: 'global-key',
    model: 'global-model',
};

const group: GroupProfile = {
    id: 'g1',
    name: '测试群',
    members: ['a', 'b'],
    createdAt: 1,
    memberApiConfigs: {
        a: { baseUrl: 'https://group-a.example/v1', apiKey: 'a-key', model: 'a-model' },
    },
};

describe('群话题盒 API 路由', () => {
    it('沿用角色1的群内 API，而不是全局 API', () => {
        const selected = resolveGroupTopicApi(group, [{ id: 'a', name: 'A' } as CharacterProfile], globalConfig);
        expect(selected).toEqual({ baseUrl: 'https://group-a.example/v1', apiKey: 'a-key', model: 'a-model' });
    });

    it('角色1没有独立 API 时回退全局 API', () => {
        const selected = resolveGroupTopicApi({ ...group, memberApiConfigs: undefined }, [], globalConfig);
        expect(selected).toEqual(globalConfig);
    });

    it('没有任何完整配置时返回 null', () => {
        const selected = resolveGroupTopicApi(
            { ...group, memberApiConfigs: undefined },
            [],
            { baseUrl: '', apiKey: '', model: '' } as APIConfig,
        );
        expect(selected).toBeNull();
    });
});
