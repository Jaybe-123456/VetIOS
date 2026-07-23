import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { queryGraphPriors } from '@/lib/graph/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });
    if (auth.error || !auth.actor) {
        const response = NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    try {
        const body = await req.json() as {
            species?: unknown;
            symptoms?: unknown;
            age_months?: unknown;
            modifiers?: unknown;
        };

        const species = typeof body.species === 'string' ? body.species : '';
        const symptoms = Array.isArray(body.symptoms)
            ? body.symptoms.filter((symptom): symptom is string => typeof symptom === 'string')
            : [];

        if (!species || symptoms.length === 0) {
            const response = NextResponse.json(
                { error: 'species and symptoms are required' },
                { status: 400 },
            );
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        const result = await queryGraphPriors(supabase, {
            species,
            symptoms,
            age_months: typeof body.age_months === 'number' ? body.age_months : null,
            modifiers: Array.isArray(body.modifiers)
                ? body.modifiers.filter((modifier): modifier is string => typeof modifier === 'string')
                : [],
        });

        const response = NextResponse.json({
            matched_diseases: result.matched_diseases,
            subgraph_edges: result.subgraph_edges.map((edge) => ({
                weight: edge.weight,
                modifier_key: edge.modifier_key ?? null,
                modifier_value: edge.modifier_value ?? null,
                symptom: edge.vet_symptom_nodes,
                disease: edge.vet_disease_nodes,
            })),
            query_version: result.query_version,
            symptom_count: result.symptom_count,
            matched_edge_count: result.matched_edge_count,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: 'graph_query_failed', detail: error instanceof Error ? error.message : 'unknown' },
            { status: 503 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
