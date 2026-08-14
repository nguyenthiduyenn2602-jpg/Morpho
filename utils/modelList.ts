const MODEL_ID_KEYS = ['id', 'model', 'name', 'model_name', 'slug'] as const;

/**
 * 把第三方 /models 的松散返回值收敛成 UI 可以安全处理的字符串列表。
 * 有些兼容站会把整个模型对象（甚至 null、数字）塞进数组；这些值若直接
 * 进入选择器，公共前缀计算里的 slice/toLowerCase 会让整页崩溃。
 */
export function normalizeModelIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: string[] = [];

    for (const item of value) {
        let candidate: unknown = item;
        if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>;
            candidate = MODEL_ID_KEYS.map(key => record[key]).find(entry => typeof entry === 'string');
        }
        if (typeof candidate !== 'string') continue;
        const id = candidate.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }

    return result;
}

/** Extract common OpenAI-compatible and nested model-list response shapes. */
export function extractModelIds(data: unknown): string[] {
    if (Array.isArray(data)) return normalizeModelIds(data);
    if (!data || typeof data !== 'object') return [];

    const root = data as Record<string, unknown>;
    const nestedData = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
        ? root.data as Record<string, unknown>
        : undefined;
    const candidates = [root.data, root.models, nestedData?.models, nestedData?.data];
    for (const candidate of candidates) {
        const models = normalizeModelIds(candidate);
        if (models.length > 0) return models;
    }
    return [];
}
