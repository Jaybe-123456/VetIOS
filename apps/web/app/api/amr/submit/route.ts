import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { screenAMRSequence } from '@/lib/amr/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AMRSubmitSchema = z.object({
    sequence: z.string().min(20),
    species: z.string().min(1),
    region: z.string().min(2).max(64).optional(),
    pathogen_label: z.string().min(1).max(128).optional(),
    clinical_outcome_id: z.string().uuid().optional(),
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

    const parsed = AMRSubmitSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const screenResult = await screenAMRSequence({
        sequence: parsed.data.sequence,
        species: parsed.data.species,
    });

    const payload = {
        tenant_id: auth.actor.tenantId,
        species: normalizeLabel(parsed.data.species),
        pathogen_label: normalizeOptionalLabel(parsed.data.pathogen_label),
        region: normalizeRegion(parsed.data.region),
        resistance_genes: screenResult.resistance_genes,
        resistance_classes: screenResult.resistance_classes,
        novel_pattern_score: screenResult.novel_pattern_score,
        quantum_backend: screenResult.quantum_backend,
        sequence_hash: screenResult.sequence_hash,
        card_db_version: screenResult.card_db_version,
        clinical_outcome_id: parsed.data.clinical_outcome_id ?? null,
    };

    const { data, error } = await supabase
        .from('amr_genomic_events')
        .insert(payload)
        .select('id')
        .single();

    if (error) {
        if (error.code === '23505') {
            const existing = await loadExistingAMREvent(supabase, screenResult.sequence_hash);
            if (existing) {
                return NextResponse.json(buildResponse(existing.id, screenResult, true));
            }
        }
        return NextResponse.json(
            { error: 'amr_event_store_failed', detail: error.message },
            { status: 503 },
        );
    }

    return NextResponse.json(buildResponse(String(data.id), screenResult, false));
}

async function loadExistingAMREvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    sequenceHash: string,
): Promise<{ id: string } | null> {
    const { data } = await supabase
        .from('amr_genomic_events')
        .select('id')
        .eq('sequence_hash', sequenceHash)
        .maybeSingle();
    return data?.id ? { id: String(data.id) } : null;
}

function buildResponse(amrEventId: string, result: Awaited<ReturnType<typeof screenAMRSequence>>, cached: boolean) {
    return {
        amr_event_id: amrEventId,
        resistance_genes: result.resistance_genes,
        resistance_classes: result.resistance_classes,
        novel_pattern_score: result.novel_pattern_score,
        is_novel: result.novel_pattern_score > 0.75,
        quantum_backend: result.quantum_backend,
        card_db_version: result.card_db_version,
        cached,
        error: null,
    };
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeOptionalLabel(value: string | undefined): string | null {
    return value ? normalizeLabel(value) : null;
}

function normalizeRegion(value: string | undefined): string | null {
    const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    return normalized || null;
}
