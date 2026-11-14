import type { APIConfig, StoryTheaterImageConfig } from '../types';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';

export function normalizeStoryDirectorApi(config: Partial<APIConfig> = {}): APIConfig {
    return { baseUrl: normalizeApiBaseUrl(config.baseUrl), apiKey: normalizeApiCredential(config.apiKey), model: normalizeApiModel(config.model) };
}
export function resolveStoryDirectorApi(settings: StoryTheaterImageConfig, globalApi: APIConfig): APIConfig {
    if (!settings.directorApiEnabled) return globalApi;
    const api = normalizeStoryDirectorApi(settings.directorApi);
    if (!api.baseUrl || !api.apiKey || !api.model) throw new Error('请补全生图导演独立 API 的 URL、Key 和模型，或关闭独立 API');
    let url: URL;
    try { url = new URL(api.baseUrl); } catch { throw new Error('生图导演 API URL 格式不正确'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('生图导演 API 请使用不含账号、查询参数和片段的 HTTP(S) 基础地址');
    return api;
}
