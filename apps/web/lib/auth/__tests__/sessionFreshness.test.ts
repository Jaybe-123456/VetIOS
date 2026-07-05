import { describe, expect, it } from 'vitest';
import { assessSessionFreshness, readJwtIssuedAt } from '../sessionFreshness';

describe('session freshness after password change', () => {
    it('allows sessions when no password-change marker exists', () => {
        const result = assessSessionFreshness(
            { app_metadata: {} },
            { access_token: fakeJwt(Math.floor(Date.now() / 1000)) },
        );

        expect(result.fresh).toBe(true);
        expect(result.reason).toBe('no_password_change_marker');
    });

    it('allows sessions issued after the recorded password change', () => {
        const passwordChangedAt = '2026-07-04T10:00:00.000Z';
        const result = assessSessionFreshness(
            { app_metadata: { password_changed_at: passwordChangedAt } },
            { access_token: fakeJwt(Date.parse('2026-07-04T10:01:00.000Z') / 1000) },
        );

        expect(result.fresh).toBe(true);
        expect(result.reason).toBe('fresh');
        expect(result.passwordChangedAt).toBe(passwordChangedAt);
    });

    it('rejects sessions issued before the recorded password change', () => {
        const passwordChangedAt = '2026-07-04T10:00:00.000Z';
        const result = assessSessionFreshness(
            { app_metadata: { password_changed_at: passwordChangedAt } },
            { access_token: fakeJwt(Date.parse('2026-07-04T09:55:00.000Z') / 1000) },
        );

        expect(result.fresh).toBe(false);
        expect(result.reason).toBe('stale_after_password_change');
    });

    it('extracts JWT issued-at values without exposing token contents', () => {
        const token = fakeJwt(Date.parse('2026-07-04T11:30:00.000Z') / 1000);
        expect(readJwtIssuedAt(token)?.toISOString()).toBe('2026-07-04T11:30:00.000Z');
    });
});

function fakeJwt(iat: number): string {
    return [
        encodeBase64Url({ alg: 'none', typ: 'JWT' }),
        encodeBase64Url({ iat }),
        'signature',
    ].join('.');
}

function encodeBase64Url(payload: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(payload), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}
