import { describe, expect, it, vi } from 'vitest';

describe('inference API rate limiter', () => {
    it('allows the tenant burst window then blocks additional requests', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'));
        vi.resetModules();

        const { checkRateLimit } = await import('../inference-rate-limit');
        const tenantId = 'tenant-load-test';

        for (let index = 0; index < 60; index += 1) {
            const result = checkRateLimit(tenantId);
            expect(result.allowed).toBe(true);
        }

        expect(checkRateLimit(tenantId).allowed).toBe(false);

        vi.advanceTimersByTime(60_001);
        expect(checkRateLimit(tenantId).allowed).toBe(true);
        vi.useRealTimers();
    });
});
