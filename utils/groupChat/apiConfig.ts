import type { APIConfig, CharacterProfile, GroupProfile } from '../../types';

export function normalizeMemberApiConfig(config?: Partial<APIConfig>): APIConfig {
    return {
        baseUrl: String(config?.baseUrl ?? '').trim().replace(/\/+$/, ''),
        apiKey: String(config?.apiKey ?? '').trim(),
        model: String(config?.model ?? '').trim(),
    };
}

export function hasMemberApiConfig(config?: Partial<APIConfig>): boolean {
    const normalized = normalizeMemberApiConfig(config);
    return !!(normalized.baseUrl || normalized.apiKey || normalized.model);
}

export function isMemberApiConfigComplete(config?: Partial<APIConfig>): boolean {
    const normalized = normalizeMemberApiConfig(config);
    return !!(normalized.baseUrl && normalized.apiKey && normalized.model);
}

/**
 * 公共话题盒只沿用角色1本轮已经会使用的 API，不在多个第三方端点之间重试。
 * 这样既修正“群聊走独立 API、整理器却偷走全局 API”的错位，也不会把同一批
 * 群聊历史额外发送给另一个服务。角色1没有独立配置时才保持旧行为，回退全局 API。
 */
export function resolveGroupTopicApi(
    group: GroupProfile,
    characters: CharacterProfile[],
    globalConfig: APIConfig,
): APIConfig | null {
    const primaryId = group.members[0];
    const primary = characters.find(character => character.id === primaryId);
    const groupOverride = group.memberApiConfigs?.[primaryId];
    const selected: Partial<APIConfig> | undefined = groupOverride?.apiKey
        ? {
            baseUrl: groupOverride.baseUrl || globalConfig.baseUrl,
            apiKey: groupOverride.apiKey,
            model: groupOverride.model || globalConfig.model,
        }
        : primary?.chatApiConfig?.apiKey
            ? primary.chatApiConfig
            : globalConfig;
    const normalized = normalizeMemberApiConfig(selected);
    return isMemberApiConfigComplete(normalized) ? normalized : null;
}

/** 兼容 OpenAI 风格 `{ data: [{ id }] }` 与常见中转站 `{ models: [...] }`。 */
export function extractAvailableModelIds(payload: any): string[] {
    const raw = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
            ? payload.models
            : Array.isArray(payload)
                ? payload
                : [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of raw) {
        const id = String(
            typeof item === 'string' || typeof item === 'number'
                ? item
                : item?.id ?? item?.name ?? item?.model ?? '',
        ).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }
    return result;
}

/**
 * Stable non-secret fingerprint used to bind a successful connection test to
 * the exact draft that was tested. The API key itself is never persisted in
 * verification metadata (the real config remains in memberApiConfigs).
 */
export function memberApiConfigFingerprint(config?: Partial<APIConfig>): string {
    const normalized = normalizeMemberApiConfig(config);
    const input = `${normalized.baseUrl}\u0000${normalized.apiKey}\u0000${normalized.model}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
