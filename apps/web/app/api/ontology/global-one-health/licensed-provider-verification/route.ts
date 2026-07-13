import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveControlPlaneRole, buildControlPlanePermissionSet } from '@/lib/settings/permissions';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { verifyLicensedOntologyProviderOperations } from '@/lib/inference/licensedOntologyProviderVerifier';
import { resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const VerificationSchema = z.object({
    provider_keys: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
    tenant_id: z.string().uuid().optional(),
    max_nodes_per_provider: z.number().int().min(1).max(5000).optional(),
    max_relationships_per_provider: z.number().int().min(1).max(10000).optional(),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 8,
        windowMs: 60_000,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const access = await resolveVerificationAccess(req);
    if (!access.ok) {
        return withHeaders(
            NextResponse.json({ error: access.error, request_id: requestId }, { status: access.status }),
            requestId,
            startTime,
        );
    }

    const url = new URL(req.url);
    const providerKeys = url.searchParams.get('provider_keys')
        ?.split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    const packet = await verifyLicensedOntologyProviderOperations({
        tenantId: access.tenantId,
        requestId,
        providerKeys,
        env: process.env,
    });

    return withHeaders(
        NextResponse.json({
            packet,
            request_id: requestId,
        }, { status: packet.summary.all_provider_operations_verified ? 200 : 207 }),
        requestId,
        startTime,
    );
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 4,
        windowMs: 60_000,
        maxBodySize: 64 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const access = await resolveVerificationAccess(req);
    if (!access.ok) {
        return withHeaders(
            NextResponse.json({ error: access.error, request_id: requestId }, { status: access.status }),
            requestId,
            startTime,
        );
    }
    if (!access.canManageInfrastructure) {
        return withHeaders(
            NextResponse.json({ error: 'Forbidden', message: 'Infrastructure admin permission is required.', request_id: requestId }, { status: 403 }),
            requestId,
            startTime,
        );
    }

    const json = await safeJson(req);
    if (!json.ok) {
        return withHeaders(
            NextResponse.json({ error: json.error, request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }
    const parsed = VerificationSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const packet = await verifyLicensedOntologyProviderOperations({
        tenantId: parsed.data.tenant_id ?? access.tenantId,
        requestId,
        providerKeys: parsed.data.provider_keys,
        maxNodesPerProvider: parsed.data.max_nodes_per_provider,
        maxRelationshipsPerProvider: parsed.data.max_relationships_per_provider,
        env: process.env,
    });

    return withHeaders(
        NextResponse.json({
            packet,
            request_id: requestId,
        }, { status: packet.summary.all_provider_operations_verified ? 200 : 207 }),
        requestId,
        startTime,
    );
}

async function resolveVerificationAccess(req: Request): Promise<
    | {
        ok: true;
        tenantId: string;
        canManageInfrastructure: boolean;
    }
    | {
        ok: false;
        status: number;
        error: string;
    }
> {
    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const user = session ? (await session.supabase.auth.getUser()).data.user ?? null : null;
    const role = resolveControlPlaneRole(user, session ? 'session' : 'dev_bypass');
    const permissions = buildControlPlanePermissionSet(role);
    const url = new URL(req.url);
    const requestedTenantId = url.searchParams.get('tenant_id')?.trim();
    const configuredTenantId = process.env.VETIOS_PLATFORM_TENANT_ID?.trim()
        || process.env.VETIOS_PUBLIC_TENANT_ID?.trim()
        || process.env.VETIOS_DEV_TENANT_ID?.trim()
        || session?.tenantId;
    const tenantId = requestedTenantId || configuredTenantId;

    if (!tenantId) return { ok: false, status: 400, error: 'tenant_missing' };
    if (!isUuid(tenantId)) return { ok: false, status: 400, error: 'tenant_id_must_be_uuid' };

    return {
        ok: true,
        tenantId,
        canManageInfrastructure: permissions.can_manage_infrastructure,
    };
}

function withHeaders(response: NextResponse, requestId: string, startTime: number) {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}
