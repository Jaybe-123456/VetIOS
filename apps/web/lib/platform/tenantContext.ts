import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveClinicalApiActor, type MachineCredentialScope } from '@/lib/auth/machineAuth';
import type { PlatformActor, PlatformRole } from '@/lib/platform/types';

interface JwtPayload {
    sub?: unknown;
    tenant_id?: unknown;
    role?: unknown;
    exp?: unknown;
    scopes?: unknown;
}

export class PlatformAuthError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'PlatformAuthError';
        this.status = status;
        this.code = code;
    }
}

export async function resolvePlatformActor(
    req: Request,
    client: SupabaseClient,
    options: {
        requiredScopes?: readonly MachineCredentialScope[];
        allowSession?: boolean;
    } = {},
): Promise<PlatformActor> {
    const tenantScope = readOptionalHeader(req, 'x-tenant-scope');
    const bearerToken = extractBearerToken(req);

    if (bearerToken && looksLikeJwt(bearerToken)) {
        const actor = resolveJwtPlatformActor(bearerToken, tenantScope);
        if (actor) {
            return actor;
        }
    }

    const clinicalActor = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: options.requiredScopes,
    });

    if (clinicalActor.error || !clinicalActor.actor) {
        throw new PlatformAuthError(
            clinicalActor.error?.status ?? 401,
            'unauthorized',
            clinicalActor.error?.message ?? 'Unauthorized',
        );
    }

    const resolvedTenantId = clinicalActor.actor.tenantId;
    if (tenantScope && tenantScope !== resolvedTenantId) {
        throw new PlatformAuthError(
            403,
            'tenant_scope_mismatch',
            'Requested tenant scope does not match the authenticated tenant.',
        );
    }

    const devRole = process.env.VETIOS_DEV_PLATFORM_ROLE === 'tenant_user'
        ? 'tenant_user'
        : 'system_admin';

    return {
        userId: clinicalActor.actor.userId,
        tenantId: resolvedTenantId,
        role: clinicalActor.actor.authMode === 'dev_bypass' ? devRole : 'tenant_user',
        authMode: clinicalActor.actor.authMode,
        scopes: normalizeScopes(clinicalActor.actor.scopes),
        tenantScope,
    };
}

export function assertActorCanAccessTenant(
    actor: PlatformActor,
    tenantId: string | null | undefined,
) {
    if (actor.role === 'system_admin') {
        return;
    }

    if (!tenantId || actor.tenantId !== tenantId) {
        throw new PlatformAuthError(
            403,
            'tenant_forbidden',
            'This request cannot access data for a different tenant.',
        );
    }
}

export function resolveActorTenant(
    actor: PlatformActor,
    requestedTenantId?: string | null,
) {
    const tenantId = requestedTenantId ?? actor.tenantScope ?? actor.tenantId;

    if (actor.role === 'system_admin') {
        return tenantId ?? null;
    }

    if (!tenantId) {
        throw new PlatformAuthError(
            400,
            'tenant_missing',
            'tenant_id is required for tenant-scoped requests.',
        );
    }

    assertActorCanAccessTenant(actor, tenantId);
    return tenantId;
}

export function isSystemAdmin(actor: PlatformActor) {
    return actor.role === 'system_admin';
}

export function issueInternalPlatformToken(input: {
    sub: string;
    tenantId: string | null;
    role: PlatformRole;
    scopes?: string[];
    expiresInSeconds?: number;
}) {
    const secret = process.env.VETIOS_JWT_SECRET;
    if (!secret) {
        throw new Error('VETIOS_JWT_SECRET is required to issue internal platform tokens.');
    }

    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
        sub: input.sub,
        tenant_id: input.tenantId,
        role: input.role,
        scopes: input.scopes ?? [],
        exp: Math.floor(Date.now() / 1000) + (input.expiresInSeconds ?? 300),
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', secret)
        .update(unsignedToken)
        .digest('base64url');

    return `${unsignedToken}.${signature}`;
}

function resolveJwtPlatformActor(token: string, tenantScope: string | null): PlatformActor | null {
    const secret = process.env.VETIOS_JWT_SECRET;
    if (!secret) {
        return null;
    }

    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
        throw new PlatformAuthError(401, 'invalid_jwt', 'Malformed JWT token.');
    }

    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = createHmac('sha256', secret)
        .update(unsignedToken)
        .digest();
    const presentedSignature = Buffer.from(encodedSignature, 'base64url');

    if (
        expectedSignature.length !== presentedSignature.length
        || !timingSafeEqual(expectedSignature, presentedSignature)
    ) {
        throw new PlatformAuthError(401, 'invalid_jwt_signature', 'JWT signature verification failed.');
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JwtPayload;
    const role = normalizeRole(payload.role);
    const tenantId = normalizeOptionalText(payload.tenant_id);

    if (payload.exp != null && Number(payload.exp) <= Math.floor(Date.now() / 1000)) {
        throw new PlatformAuthError(401, 'jwt_expired', 'JWT token has expired.');
    }

    if (role === 'tenant_user' && (!tenantId || (tenantScope && tenantScope !== tenantId))) {
        throw new PlatformAuthError(
            403,
            'tenant_scope_mismatch',
            'Tenant user tokens may only access their own tenant scope.',
        );
    }

    return {
        userId: normalizeOptionalText(payload.sub),
        tenantId,
        role,
        authMode: 'jwt',
        scopes: normalizeScopes(payload.scopes),
        tenantScope,
    };
}

function extractBearerToken(req: Request) {
    const authorization = req.headers.get('authorization');
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? null;
}

function looksLikeJwt(token: string) {
    return token.split('.').length === 3;
}

function normalizeRole(value: unknown): PlatformRole {
    return value === 'tenant_user' ? 'tenant_user' : 'system_admin';
}

function normalizeScopes(value: unknown) {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}

function readOptionalHeader(req: Request, key: string) {
    const value = req.headers.get(key);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function base64UrlEncode(input: string) {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string) {
    return Buffer.from(input, 'base64url').toString('utf8');
}
