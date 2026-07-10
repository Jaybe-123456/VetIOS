import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveControlPlaneRole, buildControlPlanePermissionSet } from '@/lib/settings/permissions';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    buildIngestionOperationsSnapshot,
    runIngestionProviderOperation,
} from '@/lib/inference/ontologyIngestionOperations';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ProviderRunSchema = z.object({
    action: z.literal('run_provider'),
    provider_key: z.string().trim().min(1).max(120),
    dry_run: z.boolean().default(true),
    tenant_id: z.string().uuid().optional(),
    max_nodes_per_provider: z.number().int().min(1).max(250_000).optional(),
    max_relationships_per_provider: z.number().int().min(1).max(500_000).optional(),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 30,
        windowMs: 60_000,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const access = await resolveOperationsAccess(req);
    if (!access.ok) {
        return withHeaders(
            NextResponse.json({ error: access.error, request_id: requestId }, { status: access.status }),
            requestId,
            startTime,
        );
    }

    const snapshot = await buildIngestionOperationsSnapshot({
        client: getSupabaseServer(),
        tenantId: access.tenantId,
        env: process.env,
    });

    return withHeaders(
        NextResponse.json({
            snapshot,
            request_id: requestId,
        }),
        requestId,
        startTime,
    );
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 8,
        windowMs: 60_000,
        maxBodySize: 64 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const access = await resolveOperationsAccess(req);
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
    const parsed = ProviderRunSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const payload = parsed.data;
    const tenantId = payload.tenant_id ?? access.tenantId;
    const result = await runIngestionProviderOperation({
        client: getSupabaseServer(),
        tenantId,
        providerKey: payload.provider_key,
        dryRun: payload.dry_run,
        maxNodesPerProvider: payload.max_nodes_per_provider,
        maxRelationshipsPerProvider: payload.max_relationships_per_provider,
        env: process.env,
    });
    const snapshot = await buildIngestionOperationsSnapshot({
        client: getSupabaseServer(),
        tenantId,
        env: process.env,
    });
    const failed = result.population.error
        || result.mapping_ingestion.error
        || result.mapping_ingestion.audit_error
        || result.completion.error
        || result.completion.query_errors.length > 0;

    return withHeaders(
        NextResponse.json({
            result,
            snapshot,
            request_id: requestId,
        }, { status: failed ? 207 : payload.dry_run ? 200 : 201 }),
        requestId,
        startTime,
    );
}

async function resolveOperationsAccess(req: Request): Promise<
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

    if (!tenantId) {
        return { ok: false, status: 400, error: 'tenant_missing' };
    }
    if (!isUuid(tenantId)) {
        return { ok: false, status: 400, error: 'tenant_id_must_be_uuid' };
    }

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
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
