import { describe, it, expect } from 'vitest';
import { uploadBackup } from './webdavClient';
import type { CloudBackupConfig } from '../types';

// 这条锁住 #5 的大小预检：经 Worker 代理上传（web 路径）时，备份 blob 超体积上限必须在发起上传
// 前就给可执行报错（提示改用本地导出 / GitHub），而不是傻等几十秒上行后才失败。
// node 测试环境非 native，走 web 分支；超限会在创建 XMLHttpRequest 之前 resolve，所以这里无需 XHR。

const config: CloudBackupConfig = {
    webdavUrl: 'https://example.invalid/dav',
    remotePath: '/backups',
    username: 'u',
    password: 'p',
} as CloudBackupConfig;

describe('uploadBackup 大小预检（#5）', () => {
    it('超过 Worker 上传上限：直接报错且提示改用本地导出 / GitHub，不发起上传', async () => {
        // 只读 blob.size，造一个声明超大的假 blob，避免真分配几百 MB
        const oversized = { size: 200 * 1024 * 1024 } as Blob;
        const res = await uploadBackup(config, oversized, 'backup.zip');
        expect(res.ok).toBe(false);
        expect(res.message).toMatch(/超过云端代理上传上限/);
        expect(res.message).toMatch(/本地导出|GitHub/);
    });
});
