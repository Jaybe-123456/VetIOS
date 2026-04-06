import type { SupabaseClient } from '@supabase/supabase-js';
import { enforceTenantRateLimit } from '@/lib/platform/rateLimit';
import { startPlatformBackgroundJobs } from '@/lib/platform/flywheel';
import {
    PlatformAuthError,
    assertActorCanAccessTenant,
    resolveActorTenant,
    resolvePlatformActor,
} from '@/lib/platform/tenantContext';
import type { PlatformActor } from '@/lib/platform/types';
import type { MachineCredentialScope } from '@/lib/auth/machineAuth';

export async function requirePlatformRequestContext(
    req: Request,
    client: SupabaseClient,
    options: {
        requiredScopes?: readonly MachineCredentialScope[];
        requestedTenantId?: string | null;
        rateLimitKind?: 'inference' | 'evaluation' | 'simulate';
        requireSystemAdmin?: boolean;
    } = {},
) {
    startPlatformBackgroundJobs(client);

    const actor = await resolvePlatformActor(req, client, {
        requiredScopes: options.requiredScopes,
    });

    if (options.requireSystemAdmin && actor.role !== 'system_admin') {
        throw new PlatformAuthError(
            403,
            'system_admin_required',
            'A system_admin token is required for this route.',
        );
    }

    const tenantId = resolveActorTenant(actor, options.requestedTenantId);
    if (tenantId && actor.role !== 'system_admin') {
        assertActorCanAccessTenant(actor, tenantId);
    }

    if (tenantId && options.rateLimitKind) {
        const rateLimit = await enforceTenantRateLimit(client, tenantId, options.rateLimitKind);
        if (!rateLimit.allowed) {
            throw new PlatformRateLimitError(rateLimit);
        }
    }

    return {
        actor,
        tenantId,
    };
}

export class PlatformRateLimitError extends Error {
    status = 429;
    code = 'rate_limit_exceeded';
    tenantId: string;
    limit: number;
    windowSeconds: number;
    retryAfterSeconds: number;

    constructor(input: {
        tenantId: string;
        limit: number;
        windowSeconds: number;
        retryAfterSeconds: number;
    }) {
        super('Tenant rate limit exceeded.');
        this.name = 'PlatformRateLimitError';
        this.tenantId = input.tenantId;
        this.limit = input.limit;
        this.windowSeconds = input.windowSeconds;
        this.retryAfterSeconds = input.retryAfterSeconds;
    }
}

export function buildRateLimitErrorPayload(error: PlatformRateLimitError) {
    return {
        error: 'rate_limit_exceeded',
        tenant_id: error.tenantId,
        limit: error.limit,
        window_seconds: error.windowSeconds,
        retry_after_seconds: error.retryAfterSeconds,
    };
}

export function extractRequestTenantId(
    actor: PlatformActor,
    req: Request,
    bodyTenantId?: string | null,
) {
    const queryTenantId = new URL(req.url).searchParams.get('tenant_id');
    return resolveActorTenant(
        actor,
        bodyTenantId ?? queryTenantId ?? actor.tenantScope ?? actor.tenantId,
    );
}
