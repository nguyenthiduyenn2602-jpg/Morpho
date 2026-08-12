import type { APIConfig } from '../../types';

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
