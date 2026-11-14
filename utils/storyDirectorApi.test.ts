import { describe, expect, it, vi } from 'vitest';
import { normalizeStoryDirectorApi, resolveStoryDirectorApi } from './storyDirectorApi';
const DEFAULT_MOMENTS_SETTINGS = { enabled: false, width: 1216, height: 832, characterAnchors: {} };

const globalApi = { baseUrl: 'https://global.example/v1', apiKey: 'global-test-key', model: 'global-model' };
const directorApi = { baseUrl: 'https://moments.example/v1', apiKey: 'moments-test-key', model: 'moments-model' };

describe('生图导演独立 API', () => {
    it('旧设置和关闭开关时沿用全局配置', () => {
        expect(resolveStoryDirectorApi(DEFAULT_MOMENTS_SETTINGS, globalApi)).toBe(globalApi);
        expect(resolveStoryDirectorApi({ ...DEFAULT_MOMENTS_SETTINGS, directorApiEnabled: false, directorApi }, globalApi)).toBe(globalApi);
    });
    it('开启后独立选择地址、密钥和模型，即便全局未配置', () => {
        expect(resolveStoryDirectorApi({ ...DEFAULT_MOMENTS_SETTINGS, directorApiEnabled: true, directorApi }, { baseUrl: '', apiKey: '', model: '' })).toEqual(directorApi);
    });
    it('复制预设时清理粘贴空白，不修改原预设', () => {
        const preset = { baseUrl: ' https://moments.example/v1/ ', apiKey: '\u200Btest-key ', model: ' model-a ' };
        const copied = normalizeStoryDirectorApi(preset);
        expect(copied).toEqual({ baseUrl: 'https://moments.example/v1', apiKey: 'test-key', model: 'model-a' });
        copied.model = 'model-b';
        expect(preset.model).toBe(' model-a ');
    });
    it.each(['baseUrl', 'apiKey', 'model'])('缺少 %s 时提示补全，不回退调用全局', field => {
        expect(() => resolveStoryDirectorApi({ ...DEFAULT_MOMENTS_SETTINGS, directorApiEnabled: true, directorApi: { ...directorApi, [field]: '' } }, globalApi)).toThrow('请补全');
    });
    it.each(['bad-url', 'file:///tmp/api', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret'])('拒绝不适用的基础地址 %s', baseUrl => {
        expect(() => resolveStoryDirectorApi({ ...DEFAULT_MOMENTS_SETTINGS, directorApiEnabled: true, directorApi: { ...directorApi, baseUrl } }, globalApi)).toThrow();
    });
});

import { generateStoryTheaterImages } from './storyTheaterImage';

it('routes actual director requests to the independent endpoint without changing the narrative API', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response('', {status: 400}));
    vi.stubGlobal('fetch', fakeFetch);
    const narrative = { ...globalApi, novelAiImageGeneration: {baseUrl:'https://images.example/v1', model:'nai',apiKey:'image-key'} };
    try {
        await expect(generateStoryTheaterImages({apiConfig:narrative,entry:{id:'test',imageGeneration:{...DEFAULT_MOMENTS_SETTINGS,enabled:true,directorApiEnabled:true,directorApi}},actors:[],userName:'User',history:[{role:'assistant',content:'A scene'}]} as any)).rejects.toThrow();
        expect(fakeFetch).toHaveBeenCalledTimes(1);
        const [url, init] = fakeFetch.mock.calls[0];
        expect(url).toBe(directorApi.baseUrl+'/chat/completions');
        expect(init.headers.Authorization).toBe('Bearer '+directorApi.apiKey);
        expect(JSON.parse(init.body).model).toBe(directorApi.model);
        expect(narrative.model).toBe(globalApi.model);
    } finally { vi.unstubAllGlobals(); }
});


import { normalizeStoryTheater, createStoryTheaterDraft } from './storyTheater';
it('preserves director settings through persisted story normalization', () => {
    const entry = { ...createStoryTheaterDraft(), imageGeneration: {...DEFAULT_MOMENTS_SETTINGS,directorApiEnabled:true,directorApi} };
    const restored = normalizeStoryTheater(JSON.parse(JSON.stringify(entry)));
    expect(restored.imageGeneration?.directorApi).toEqual(directorApi);
    expect(restored.imageGeneration?.directorApiEnabled).toBe(true);
});
