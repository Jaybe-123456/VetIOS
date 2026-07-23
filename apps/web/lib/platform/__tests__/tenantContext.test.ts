import { createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { issueInternalPlatformToken, resolvePlatformActor } from '../tenantContext';

const ORIGINAL_ENV = {
    secret: process.env.VETIOS_JWT_SECRET,
    issuer: process.env.VETIOS_PLATFORM_JWT_ISSUER,
    audience: process.env.VETIOS_PLATFORM_JWT_AUDIENCE,
    maxTtl: process.env.VETIOS_INTERNAL_JWT_MAX_TTL_SECONDS,
};

afterEach(() => {
    restoreEnv('VETIOS_JWT_SECRET', ORIGINAL_ENV.secret);
    restoreEnv('VETIOS_PLATFORM_JWT_ISSUER', ORIGINAL_ENV.issuer);
    restoreEnv('VETIOS_PLATFORM_JWT_AUDIENCE', ORIGINAL_ENV.audience);
    restoreEnv('VETIOS_INTERNAL_JWT_MAX_TTL_SECONDS', ORIGINAL_ENV.maxTtl);
});

describe('internal platform JWT verification', () => {
    it('accepts a bounded token with exact issuer, audience, role, and tenant claims', async () => {
        configureJwt();
        const token = issueInternalPlatformToken({
            sub: 'workload-1',
            tenantId: 'tenant-1',
            role: 'tenant_user',
            scopes: ['evaluation:read'],
            expiresInSeconds: 300,
        });

        const actor = await resolvePlatformActor(
            bearerRequest(token),
            {} as SupabaseClient,
        );

        expect(actor).toMatchObject({
            userId: 'workload-1',
            tenantId: 'tenant-1',
            role: 'tenant_user',
            authMode: 'jwt',
            scopes: ['evaluation:read'],
        });
    });

    it('rejects a correctly signed token with an untrusted issuer', async () => {
        configureJwt();
        const now = Math.floor(Date.now() / 1000);
        const token = signJwt({
            sub: 'workload-1',
            tenant_id: 'tenant-1',
            role: 'tenant_user',
            scopes: [],
            iss: 'attacker.example',
            aud: 'vetios-test-api',
            iat: now,
            exp: now + 300,
        });

        await expect(resolvePlatformActor(bearerRequest(token), {} as SupabaseClient))
            .rejects.toMatchObject({ code: 'invalid_jwt_issuer_audience', status: 401 });
    });

    it('rejects unknown roles instead of promoting them to system admin', async () => {
        configureJwt();
        const now = Math.floor(Date.now() / 1000);
        const token = signJwt({
            sub: 'workload-1',
            tenant_id: 'tenant-1',
            role: 'super_admin',
            scopes: ['*'],
            iss: 'vetios-test',
            aud: 'vetios-test-api',
            iat: now,
            exp: now + 300,
        });

        await expect(resolvePlatformActor(bearerRequest(token), {} as SupabaseClient))
            .rejects.toMatchObject({ code: 'invalid_jwt_role', status: 401 });
    });

    it('fails closed for JWT-shaped bearer tokens when verification is unconfigured', async () => {
        configureJwt();
        const token = issueInternalPlatformToken({
            sub: 'workload-1',
            tenantId: 'tenant-1',
            role: 'tenant_user',
        });
        delete process.env.VETIOS_JWT_SECRET;

        await expect(resolvePlatformActor(bearerRequest(token), {} as SupabaseClient))
            .rejects.toMatchObject({ code: 'jwt_verifier_unconfigured', status: 503 });
    });

    it('refuses to issue tokens beyond the verifier lifetime bound', () => {
        configureJwt();
        process.env.VETIOS_INTERNAL_JWT_MAX_TTL_SECONDS = '600';
        expect(() => issueInternalPlatformToken({
            sub: 'workload-1',
            tenantId: 'tenant-1',
            role: 'tenant_user',
            expiresInSeconds: 601,
        })).toThrow(/lifetime exceeds/i);
    });
});

function configureJwt() {
    process.env.VETIOS_JWT_SECRET = 'test-secret-that-is-not-used-outside-vitest';
    process.env.VETIOS_PLATFORM_JWT_ISSUER = 'vetios-test';
    process.env.VETIOS_PLATFORM_JWT_AUDIENCE = 'vetios-test-api';
    process.env.VETIOS_INTERNAL_JWT_MAX_TTL_SECONDS = '3600';
}

function bearerRequest(token: string) {
    return new Request('https://vetios.test/api/v1/telemetry', {
        headers: { authorization: `Bearer ${token}` },
    });
}

function signJwt(payload: Record<string, unknown>) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsigned = `${header}.${body}`;
    const signature = createHmac('sha256', process.env.VETIOS_JWT_SECRET ?? '')
        .update(unsigned)
        .digest('base64url');
    return `${unsigned}.${signature}`;
}

function restoreEnv(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}
