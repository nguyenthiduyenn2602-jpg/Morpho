import { describe, expect, it } from 'vitest';
import { assertSupportedSullyBackup } from './backupImportPolicy';

describe('backup import policy', () => {
    it('accepts SullyOS v1-style backup objects', () => {
        expect(() => assertSupportedSullyBackup({
            timestamp: Date.now(),
            version: 1,
            characters: [],
            messages: [],
        })).not.toThrow();
    });

    it.each([
        { vectorMemories: [] },
        { extraLocalStorageConfig: {} },
    ])('rejects unsupported third-party backup markers before import', marker => {
        expect(() => assertSupportedSullyBackup({
            timestamp: Date.now(),
            version: 1,
            characters: [],
            ...marker,
        })).toThrow('不支持导入第三方系统备份');
    });

    it('rejects non-object payloads', () => {
        expect(() => assertSupportedSullyBackup([])).toThrow('备份内容无效');
    });
});
