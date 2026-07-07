import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    buildGlobalOneHealthSeedMaterializationRows,
    recordGlobalOneHealthSeedMaterializationEvents,
} from '@/lib/inference/globalOneHealthMaterializer';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MaterializeGlobalOneHealthSchema = z.object({
    request_id: z.string().trim().min(1).max(160).optional(),
    observed_at: z.string().datetime().optional(),
    dry_run: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 4,
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

    const parsed = MaterializeGlobalOneHealthSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const materializationInput = {
        tenantId: auth.actor.tenantId,
        requestId: parsed.data.request_id ?? `global_one_health_seed:${requestId}`,
        observedAt: parsed.data.observed_at ?? null,
    };

    if (parsed.data.dry_run) {
        const rows = buildGlobalOneHealthSeedMaterializationRows(materializationInput);
        return withHeaders(
            NextResponse.json({
                status: 'dry_run',
                request_id: requestId,
                materialization_request_id: materializationInput.requestId,
                condition_rows: rows.conditionRows.length,
                source_mapping_rows: rows.sourceMappingRows.length,
                edge_rows: rows.edgeRows.length,
                writes_committed: false,
            }),
            requestId,
            startTime,
        );
    }

    const result = await recordGlobalOneHealthSeedMaterializationEvents(
        supabase as unknown as Parameters<typeof recordGlobalOneHealthSeedMaterializationEvents>[0],
        materializationInput,
    );

    return withHeaders(
        NextResponse.json({
            status: result.error ? 'failed' : 'materialized',
            request_id: requestId,
            materialization_request_id: materializationInput.requestId,
            condition_rows: result.conditionRows,
            source_mapping_rows: result.sourceMappingRows,
            edge_rows: result.edgeRows,
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
