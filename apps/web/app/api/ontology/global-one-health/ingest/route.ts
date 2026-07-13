import { NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceVetiosClinicalActorGate } from '@/lib/auth/authTrustRouteGate';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    buildOfficialOntologyIngestionPlan,
    buildVerifiedExternalMappingRows,
    fetchOfficialOntologyMatches,
    recordVerifiedExternalCodeMappings,
} from '@/lib/inference/globalOneHealthOfficialIngestion';
import { recordOfficialOntologyIngestionRunEvent } from '@/lib/inference/officialOntologyIngestionEvents';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const IngestGlobalOneHealthSchema = z.object({
    request_id: z.string().trim().min(1).max(160).optional(),
    provider_keys: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    condition_keys: z.array(z.string().trim().min(1).max(120)).max(80).optional(),
    observed_at: z.string().datetime().optional(),
    dry_run: z.boolean().optional().default(false),
    plan_only: z.boolean().optional().default(false),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 20,
        windowMs: 60_000,
        maxBodySize: 64 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['rag:write'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }),
            requestId,
            startTime,
        );
    }

    return withHeaders(
        NextResponse.json({
            request_id: requestId,
            provider_plan: buildOfficialOntologyIngestionPlan(),
            writes_committed: false,
        }),
        requestId,
        startTime,
    );
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 3,
        windowMs: 60_000,
        maxBodySize: 256 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['rag:write'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }),
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

    const parsed = IngestGlobalOneHealthSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    if (parsed.data.plan_only) {
        return withHeaders(
            NextResponse.json({
                request_id: requestId,
                provider_plan: buildOfficialOntologyIngestionPlan(),
                writes_committed: false,
            }),
            requestId,
            startTime,
        );
    }

    const trustGate = await enforceVetiosClinicalActorGate({
        client: supabase as unknown as Parameters<typeof enforceVetiosClinicalActorGate>[0]['client'],
        requestId,
        actor: auth.actor,
        actionKey: 'ontology.provider.ingest',
        resource: {
            type: 'ontology_provider',
            id: normalizeProviderResourceId(parsed.data.provider_keys),
            tenantId: auth.actor.tenantId,
        },
        evidence: {
            route: 'api/ontology/global-one-health/ingest',
            provider_keys: parsed.data.provider_keys ?? [],
            condition_key_count: parsed.data.condition_keys?.length ?? 0,
            dry_run: parsed.data.dry_run,
        },
    });
    if (!trustGate.ok) {
        return withHeaders(trustGate.response, requestId, startTime);
    }

    const ingestion = await fetchOfficialOntologyMatches({
        providerKeys: parsed.data.provider_keys,
        conditionKeys: parsed.data.condition_keys,
    });
    const materializationRequestId = parsed.data.request_id ?? `global_one_health_official_ingest:${requestId}`;
    const mappingRows = buildVerifiedExternalMappingRows({
        matches: ingestion.matches,
        tenantId: auth.actor.tenantId,
        requestId: materializationRequestId,
        observedAt: parsed.data.observed_at ?? null,
    });

    if (parsed.data.dry_run) {
        await recordOfficialOntologyIngestionRunEvent(
            supabase as unknown as Parameters<typeof recordOfficialOntologyIngestionRunEvent>[0],
            {
                tenantId: auth.actor.tenantId,
                requestId: materializationRequestId,
                ingestion,
                insertedRows: 0,
                dryRun: true,
                observedAt: parsed.data.observed_at ?? null,
            },
        );
        return withHeaders(
            NextResponse.json({
                status: 'dry_run',
                request_id: requestId,
                materialization_request_id: materializationRequestId,
                provider_plan: ingestion.provider_plan,
                matches: ingestion.matches,
                skipped_providers: ingestion.skipped_providers,
                errors: ingestion.errors,
                mapping_rows: mappingRows.length,
                writes_committed: false,
            }),
            requestId,
            startTime,
        );
    }

    const insertResult = await recordVerifiedExternalCodeMappings({
        client: supabase as unknown as Parameters<typeof recordVerifiedExternalCodeMappings>[0]['client'],
        tenantId: auth.actor.tenantId,
        requestId: materializationRequestId,
        matches: ingestion.matches,
        observedAt: parsed.data.observed_at ?? null,
    });
    const auditResult = await recordOfficialOntologyIngestionRunEvent(
        supabase as unknown as Parameters<typeof recordOfficialOntologyIngestionRunEvent>[0],
        {
            tenantId: auth.actor.tenantId,
            requestId: materializationRequestId,
            ingestion,
            insertedRows: insertResult.inserted,
            dryRun: false,
            observedAt: parsed.data.observed_at ?? null,
        },
    );

    return withHeaders(
        NextResponse.json({
            status: insertResult.error ? 'failed' : 'ingested',
            request_id: requestId,
            materialization_request_id: materializationRequestId,
            provider_plan: ingestion.provider_plan,
            matches: ingestion.matches,
            skipped_providers: ingestion.skipped_providers,
            errors: ingestion.errors,
            mapping_rows: mappingRows.length,
            inserted_rows: insertResult.inserted,
            ingestion_audit_event_id: auditResult.id,
            ingestion_audit_error: auditResult.error,
            writes_committed: insertResult.error === null,
            error: insertResult.error,
        }, { status: insertResult.error ? 500 : 201 }),
        requestId,
        startTime,
    );
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function normalizeProviderResourceId(providerKeys: readonly string[] | undefined): string {
    return providerKeys?.length
        ? providerKeys.map((key) => key.trim()).filter(Boolean).sort().join(',')
        : 'all_configured_providers';
}
