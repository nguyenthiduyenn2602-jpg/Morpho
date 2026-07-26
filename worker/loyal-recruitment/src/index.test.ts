import { describe, expect, it } from 'vitest';
import worker from './index';

const candidates = [
    { qq: '123456789', submitted_at: Date.parse('2026-07-20T19:01:00+08:00') },
];

const makeEnv = () => ({
    ADMIN_TOKEN: 'test-admin-token',
    GROUP_ID: '892128017',
    GROUP_PASSWORD: 'test-password',
    DB: {
        exec: async () => undefined,
        prepare: () => ({
            bind() { return this; },
            run: async () => undefined,
            first: async () => null,
            all: async () => ({ results: candidates }),
        }),
    },
}) as any;

describe('loyal recruitment admin export', () => {
    it('accepts v1-v4 sealed contracts during migration and rejects unknown versions', async () => {
        const acceptedV2 = await worker.fetch(new Request('https://example.com/recruit/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                qq: '123456789',
                criteriaVersion: '2026-07-20-v2',
                cutoffAt: Date.parse('2026-07-20T19:00:00+08:00'),
            }),
        }), makeEnv());
        expect(acceptedV2.status).toBe(200);
        await expect(acceptedV2.json()).resolves.toMatchObject({
            ok: true,
            group: '892128017',
            password: 'test-password',
        });

        const acceptedV1 = await worker.fetch(new Request('https://example.com/recruit/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                qq: '123456789',
                criteriaVersion: '2026-07-20-v1',
                cutoffAt: Date.parse('2026-07-20T19:00:00+08:00'),
            }),
        }), makeEnv());
        expect(acceptedV1.status).toBe(200);

        const acceptedV3 = await worker.fetch(new Request('https://example.com/recruit/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                qq: '123456789',
                criteriaVersion: '2026-07-20-v3',
                cutoffAt: Date.parse('2026-07-20T19:00:00+08:00'),
            }),
        }), makeEnv());
        expect(acceptedV3.status).toBe(200);

        const acceptedV4 = await worker.fetch(new Request('https://example.com/recruit/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                qq: '123456789',
                criteriaVersion: '2026-07-20-v4',
                cutoffAt: Date.parse('2026-07-20T19:00:00+08:00'),
            }),
        }), makeEnv());
        expect(acceptedV4.status).toBe(200);

        const rejected = await worker.fetch(new Request('https://example.com/recruit/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                qq: '123456789',
                criteriaVersion: 'unknown',
                cutoffAt: Date.parse('2026-07-20T19:00:00+08:00'),
            }),
        }), makeEnv());
        expect(rejected.status).toBe(409);
    });

    it('serves the private admin page without embedding the token', async () => {
        const response = await worker.fetch(new Request('https://example.com/recruit/admin'), makeEnv());
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(html).toContain('下载 CSV');
        expect(html).toContain('/admin-list?limit=5000');
        expect(html).not.toContain('test-admin-token');
    });

    it('keeps the list endpoint protected by bearer authentication', async () => {
        const unauthorized = await worker.fetch(
            new Request('https://example.com/recruit/admin-list'),
            makeEnv(),
        );
        expect(unauthorized.status).toBe(401);

        const authorized = await worker.fetch(
            new Request('https://example.com/recruit/admin-list', {
                headers: { Authorization: 'Bearer test-admin-token' },
            }),
            makeEnv(),
        );
        expect(authorized.status).toBe(200);
        await expect(authorized.json()).resolves.toMatchObject({ ok: true, candidates });
    });
});
