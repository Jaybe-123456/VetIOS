import { NextResponse } from 'next/server';
import { QIVSClient, type RNAFoldResponse } from '@vetios/quantum';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RNAFoldSchema = z.object({
    sequence: z.string().min(12).max(20_000),
    pathogen_label: z.string().min(1).max(128),
    region: z.string().min(2).max(64).optional(),
    reference_structure: z.string().min(1).max(20_000).optional(),
});

export async function POST(req: Request) {
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = RNAFoldSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const quantumUrl = process.env.QUANTUM_SERVICE_URL;
    if (!quantumUrl) {
        return NextResponse.json({ error: 'quantum_service_unconfigured' }, { status: 503 });
    }

    const client = new QIVSClient(quantumUrl, quantumTimeoutMs());
    if (!(await client.isAvailable())) {
        return NextResponse.json(
            {
                error: 'quantum_service_unavailable',
                message: 'Quantum RNA folding service is offline. Try again shortly.',
            },
            { status: 503, headers: { 'Retry-After': '30' } },
        );
    }

    let result: RNAFoldResponse;
    try {
        result = await client.foldRNA({
            sequence: parsed.data.sequence,
            pathogen_label: normalizeLabel(parsed.data.pathogen_label),
            region: normalizeRegion(parsed.data.region) ?? undefined,
            reference_structure: parsed.data.reference_structure,
            n_samples: quantumSamples(),
            n_iterations: quantumIterations(),
        });
    } catch (error) {
        console.log(JSON.stringify({
            event: 'rna_folding_failed',
            pathogen_label: parsed.data.pathogen_label,
            error: error instanceof Error ? error.message : 'unknown',
            timestamp: new Date().toISOString(),
        }));
        return NextResponse.json({ error: 'rna_folding_failed' }, { status: 503 });
    }

    const { data: event, error: dbError } = await supabase
        .from('rna_folding_events')
        .insert({
            tenant_id: auth.actor.tenantId,
            sequence_hash: result.sequence_hash,
            sequence_length: result.sequence_length,
            pathogen_label: normalizeLabel(result.pathogen_label),
            region: normalizeRegion(result.region ?? undefined),
            wfsg_node_count: result.wfsg_node_count,
            wfsg_edge_count: result.wfsg_edge_count,
            predicted_stems: result.predicted_stems,
            max_clique_weight: result.max_clique_weight,
            secondary_structure: result.secondary_structure,
            mcc_score: result.mcc_score ?? null,
            gbs_backend: result.gbs_backend,
            algorithm_version: result.algorithm_version,
            paper_doi: result.paper_doi,
        })
        .select('id')
        .single();

    if (dbError) {
        if (dbError.code === '23505') {
            const existing = await loadExistingRNAEvent(supabase, result.sequence_hash);
            if (existing) {
                return NextResponse.json(buildResponse(existing.id, result, true));
            }
        }
        return NextResponse.json({ error: 'rna_event_store_failed', detail: dbError.message }, { status: 503 });
    }

    return NextResponse.json(buildResponse(String(event.id), result, false));
}

async function loadExistingRNAEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    sequenceHash: string,
): Promise<{ id: string } | null> {
    const { data } = await supabase
        .from('rna_folding_events')
        .select('id')
        .eq('sequence_hash', sequenceHash)
        .maybeSingle();
    return data?.id ? { id: String(data.id) } : null;
}

function buildResponse(eventId: string, result: RNAFoldResponse, cached: boolean) {
    return {
        rna_folding_event_id: eventId,
        sequence_hash: result.sequence_hash,
        sequence_length: result.sequence_length,
        pathogen_label: result.pathogen_label,
        wfsg_node_count: result.wfsg_node_count,
        wfsg_edge_count: result.wfsg_edge_count,
        predicted_stems: result.predicted_stems,
        secondary_structure: result.secondary_structure,
        max_clique_weight: result.max_clique_weight,
        mcc_score: result.mcc_score ?? null,
        quantum_advantage: result.quantum_advantage,
        algorithm_version: result.algorithm_version,
        paper_doi: result.paper_doi,
        cached,
        error: null,
    };
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeRegion(value: string | undefined): string | null {
    const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    return normalized || null;
}

function quantumTimeoutMs(): number {
    const parsed = Number(process.env.QUANTUM_SERVICE_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 45_000;
}

function quantumSamples(): number {
    const parsed = Number(process.env.QUANTUM_GBS_SAMPLES);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;
}

function quantumIterations(): number {
    const parsed = Number(process.env.QUANTUM_GBS_ITERATIONS);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}
