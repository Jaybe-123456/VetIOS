import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    buildGlobalBiomedicalOntologyPopulationRows,
    recordGlobalBiomedicalOntologyPopulationEvents,
} from '@/lib/inference/globalBiomedicalOntologyPopulation';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PopulateGlobalOneHealthSchema = z.object({
    request_id: z.string().trim().min(1).max(160).optional(),
    provider_keys: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    max_nodes_per_provider: z.number().int().min(1).max(250_000).optional(),
    max_relationships_per_provider: z.number().int().min(1).max(500_000).optional(),
    observed_at: z.string().datetime().optional(),
    dry_run: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 2,
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

    const parsed = PopulateGlobalOneHealthSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const populationRequestId = parsed.data.request_id ?? `global_biomedical_ontology_population:${requestId}`;
    const rows = await buildGlobalBiomedicalOntologyPopulationRows({
        tenantId: auth.actor.tenantId,
        requestId: populationRequestId,
        providerKeys: parsed.data.provider_keys,
        maxNodesPerProvider: parsed.data.max_nodes_per_provider,
        maxRelationshipsPerProvider: parsed.data.max_relationships_per_provider,
        observedAt: parsed.data.observed_at ?? null,
    });

    if (parsed.data.dry_run) {
        return withHeaders(
            NextResponse.json({
                status: 'dry_run',
                request_id: requestId,
                population_request_id: populationRequestId,
                release_rows: rows.releaseRows.length,
                node_rows: rows.nodeRows.length,
                relationship_rows: rows.relationshipRows.length,
                provider_plan: rows.providerPlan,
                skipped_providers: rows.skippedProviders,
                errors: rows.errors,
                snapshot: rows.snapshotRow,
                writes_committed: false,
            }),
            requestId,
            startTime,
        );
    }

    const result = await recordGlobalBiomedicalOntologyPopulationEvents(
        supabase as unknown as Parameters<typeof recordGlobalBiomedicalOntologyPopulationEvents>[0],
        rows,
    );

    return withHeaders(
        NextResponse.json({
            status: result.error ? 'failed' : 'populated',
            request_id: requestId,
            population_request_id: populationRequestId,
            release_rows: result.releaseRows,
            node_rows: result.nodeRows,
            relationship_rows: result.relationshipRows,
            snapshot_inserted: result.snapshotInserted,
            provider_plan: rows.providerPlan,
            skipped_providers: rows.skippedProviders,
            errors: rows.errors,
            writes_committed: result.error === null,
            error: result.error,
        }, { status: result.error ? 500 : 201 }),
        requestId,
        startTime,
    );
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
