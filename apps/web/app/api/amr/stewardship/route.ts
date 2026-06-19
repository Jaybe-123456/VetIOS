import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import {
    AMR_DECISION_STAGES,
    AMR_OUTCOME_STATUSES,
    AMR_STEWARDSHIP_STATUSES,
    aggregateAMRStewardship,
    normalizeAMRLabel,
    normalizeAMRString,
    normalizeAMRStringList,
    normalizeOptionalAMRLabel,
    type AMRStewardshipEventRow,
} from '@/lib/amr/stewardship';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});

const AMRStewardshipSchema = z.object({
    request_id: z.string().uuid(),
    case_id: z.string().uuid().optional(),
    inference_event_id: z.string().uuid().optional(),
    clinical_outcome_id: z.string().uuid().optional(),
    patient: z.object({
        species: z.string().min(1),
        breed: z.string().max(128).optional(),
        age_years: z.number().min(0).max(80).optional(),
    }),
    microbiology: z.object({
        pathogen_label: z.string().max(128).optional(),
        syndrome: z.string().max(128).optional(),
        infection_site: z.string().max(128).optional(),
        sample_source: z.string().max(128).optional(),
        culture_collected: z.boolean().default(false),
        culture_result: z.string().max(128).optional(),
        ast_method: z.string().max(128).optional(),
        ast_panel: JsonRecordSchema,
        mic_results: JsonRecordSchema,
        resistance_genes: z.array(z.string().max(128)).max(100).default([]),
        resistance_classes: z.array(z.string().max(128)).max(100).default([]),
    }).default({
        culture_collected: false,
        ast_panel: {},
        mic_results: {},
        resistance_genes: [],
        resistance_classes: [],
    }),
    antimicrobial: z.object({
        drug_name: z.string().min(1).max(128),
        drug_class: z.string().max(128).optional(),
        dose: z.string().max(128).optional(),
        route: z.string().max(64).optional(),
        frequency: z.string().max(64).optional(),
        duration_days: z.number().min(0).max(365).optional(),
        indication: z.string().max(256).optional(),
        decision_stage: z.enum(AMR_DECISION_STAGES).default('unknown'),
    }),
    stewardship: z.object({
        status: z.enum(AMR_STEWARDSHIP_STATUSES).default('monitoring'),
        outcome_status: z.enum(AMR_OUTCOME_STATUSES).optional(),
        response_at_followup: z.string().max(512).optional(),
        resistance_suspected: z.boolean().default(false),
        de_escalation_recommended: z.boolean().default(false),
        review_required: z.boolean().default(true),
        rationale: z.string().max(1200).optional(),
        evidence: JsonRecordSchema,
    }).default({
        status: 'monitoring',
        resistance_suspected: false,
        de_escalation_recommended: false,
        review_required: true,
        evidence: {},
    }),
    observed_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['outcome:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = AMRStewardshipSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const body = parsed.data;
    const microbiology = body.microbiology;
    const stewardship = body.stewardship;
    const antimicrobial = body.antimicrobial;

    const payload = {
        tenant_id: auth.actor.tenantId,
        request_id: body.request_id,
        case_id: body.case_id ?? null,
        inference_event_id: body.inference_event_id ?? null,
        clinical_outcome_id: body.clinical_outcome_id ?? null,
        species: normalizeAMRLabel(body.patient.species),
        breed: normalizeAMRString(body.patient.breed),
        age_years: body.patient.age_years ?? null,
        pathogen_label: normalizeOptionalAMRLabel(microbiology.pathogen_label),
        syndrome: normalizeOptionalAMRLabel(microbiology.syndrome),
        infection_site: normalizeOptionalAMRLabel(microbiology.infection_site),
        sample_source: normalizeOptionalAMRLabel(microbiology.sample_source),
        culture_collected: microbiology.culture_collected,
        culture_result: normalizeOptionalAMRLabel(microbiology.culture_result),
        ast_method: normalizeOptionalAMRLabel(microbiology.ast_method),
        ast_panel: microbiology.ast_panel,
        mic_results: microbiology.mic_results,
        resistance_genes: normalizeAMRStringList(microbiology.resistance_genes),
        resistance_classes: normalizeAMRStringList(microbiology.resistance_classes),
        drug_name: normalizeAMRLabel(antimicrobial.drug_name),
        drug_class: normalizeOptionalAMRLabel(antimicrobial.drug_class),
        dose: normalizeAMRString(antimicrobial.dose),
        route: normalizeAMRString(antimicrobial.route),
        frequency: normalizeAMRString(antimicrobial.frequency),
        duration_days: antimicrobial.duration_days ?? null,
        indication: normalizeAMRString(antimicrobial.indication),
        decision_stage: antimicrobial.decision_stage,
        stewardship_status: stewardship.status,
        outcome_status: stewardship.outcome_status ?? null,
        response_at_followup: normalizeAMRString(stewardship.response_at_followup),
        resistance_suspected: stewardship.resistance_suspected,
        de_escalation_recommended: stewardship.de_escalation_recommended,
        review_required: stewardship.review_required,
        rationale: normalizeAMRString(stewardship.rationale),
        evidence: stewardship.evidence,
        observed_at: body.observed_at ?? new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from('amr_stewardship_events')
        .insert(payload)
        .select('id')
        .single();

    if (error) {
        if (error.code === '23505') {
            const cached = await loadCachedStewardshipEvent(supabase, auth.actor.tenantId, body.request_id);
            if (cached) return NextResponse.json(buildStewardshipResponse(cached.id, true));
        }
        return NextResponse.json(
            { error: 'amr_stewardship_event_store_failed', detail: error.message },
            { status: 503 },
        );
    }

    return NextResponse.json(buildStewardshipResponse(String(data.id), false));
}

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const species = normalizeOptionalAMRLabel(searchParams.get('species'));
    const drugClass = normalizeOptionalAMRLabel(searchParams.get('drug_class'));
    const sinceDays = clampDays(Number(searchParams.get('days') ?? 90));
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
        .from('amr_stewardship_events')
        .select('species, pathogen_label, infection_site, drug_name, drug_class, decision_stage, stewardship_status, outcome_status, culture_collected, resistance_suspected, de_escalation_recommended, review_required, resistance_classes, observed_at')
        .eq('tenant_id', auth.actor.tenantId)
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(10_000);

    if (species) query = query.eq('species', species);
    if (drugClass) query = query.eq('drug_class', drugClass);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: 'amr_stewardship_data_unavailable' }, { status: 503 });
    }

    const rows = (Array.isArray(data) ? data : []) as AMRStewardshipEventRow[];
    return NextResponse.json({
        period: `last_${sinceDays}_days`,
        aggregate: aggregateAMRStewardship(rows),
        de_identified: true,
        error: null,
    });
}

async function loadCachedStewardshipEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
): Promise<{ id: string } | null> {
    const { data } = await supabase
        .from('amr_stewardship_events')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    return data?.id ? { id: String(data.id) } : null;
}

function buildStewardshipResponse(amrStewardshipEventId: string, cached: boolean) {
    return {
        amr_stewardship_event_id: amrStewardshipEventId,
        cached,
        learning_signal: 'clinical_antimicrobial_decision',
        de_identified: true,
        error: null,
    };
}

function clampDays(value: number): number {
    if (!Number.isFinite(value)) return 90;
    return Math.min(365, Math.max(1, Math.round(value)));
}
