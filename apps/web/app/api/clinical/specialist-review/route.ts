import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
    SPECIALIST_AI_DISPOSITIONS,
    SPECIALIST_CLINICIAN_ACTIONS,
    SPECIALIST_PACS_STATUSES,
    SPECIALIST_REPORT_STATUSES,
    SPECIALIST_REVIEW_ROUTES,
    SPECIALIST_REVIEW_STAGES,
    SPECIALIST_REVIEW_STATUSES,
    SPECIALIST_REVIEW_URGENCY_LEVELS,
    aggregateSpecialistReviewEvents,
    normalizeOptionalSpecialistReviewLabel,
    normalizeSpecialistReviewText,
    resolveSpecialistLearningEligibility,
    type SpecialistReviewEventRow,
} from '@/lib/specialistReview/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});

const SpecialistReviewEventSchema = z.object({
    request_id: z.string().uuid(),
    ask_vetios_query_id: z.string().uuid().optional(),
    case_id: z.string().uuid().optional(),
    inference_event_id: z.string().uuid().optional(),
    clinical_outcome_id: z.string().uuid().optional(),
    reviewer_route: z.enum(SPECIALIST_REVIEW_ROUTES).default('primary_clinician'),
    specialty: z.string().max(120).optional(),
    urgency_level: z.enum(SPECIALIST_REVIEW_URGENCY_LEVELS).default('routine'),
    review_stage: z.enum(SPECIALIST_REVIEW_STAGES).default('requested'),
    review_status: z.enum(SPECIALIST_REVIEW_STATUSES).default('pending'),
    ai_disposition: z.enum(SPECIALIST_AI_DISPOSITIONS).default('not_reviewed'),
    clinician_action: z.enum(SPECIALIST_CLINICIAN_ACTIONS).default('none'),
    report_status: z.enum(SPECIALIST_REPORT_STATUSES).default('not_started'),
    pacs_status: z.enum(SPECIALIST_PACS_STATUSES).default('not_applicable'),
    outcome_required: z.boolean().default(true),
    outcome_captured: z.boolean().default(false),
    learning_eligible: z.boolean().optional(),
    evidence_pack: JsonRecordSchema,
    corrections: JsonRecordSchema,
    annotations: JsonRecordSchema,
    deidentified_report: JsonRecordSchema,
    review_summary: z.string().max(2000).optional(),
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

    const parsed = SpecialistReviewEventSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const body = parsed.data;
    const learningEligible = body.learning_eligible ?? resolveSpecialistLearningEligibility({
        review_status: body.review_status,
        ai_disposition: body.ai_disposition,
        report_status: body.report_status,
        outcome_required: body.outcome_required,
        outcome_captured: body.outcome_captured,
    });

    const payload = {
        tenant_id: auth.actor.tenantId,
        request_id: body.request_id,
        ask_vetios_query_id: body.ask_vetios_query_id ?? null,
        case_id: body.case_id ?? null,
        inference_event_id: body.inference_event_id ?? null,
        clinical_outcome_id: body.clinical_outcome_id ?? null,
        reviewer_route: body.reviewer_route,
        specialty: normalizeOptionalSpecialistReviewLabel(body.specialty),
        urgency_level: body.urgency_level,
        review_stage: body.review_stage,
        review_status: body.review_status,
        ai_disposition: body.ai_disposition,
        clinician_action: body.clinician_action,
        report_status: body.report_status,
        pacs_status: body.pacs_status,
        outcome_required: body.outcome_required,
        outcome_captured: body.outcome_captured,
        learning_eligible: learningEligible,
        evidence_pack: body.evidence_pack,
        corrections: body.corrections,
        annotations: body.annotations,
        deidentified_report: body.deidentified_report,
        review_summary: normalizeSpecialistReviewText(body.review_summary),
        observed_at: body.observed_at ?? new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from('specialist_review_events')
        .insert(payload)
        .select('id, learning_eligible')
        .single();

    if (error) {
        if (error.code === '23505') {
            const cached = await loadCachedSpecialistReviewEvent(supabase, auth.actor.tenantId, body.request_id);
            if (cached) return NextResponse.json(buildSpecialistReviewResponse(cached.id, cached.learning_eligible, true));
        }
        return NextResponse.json(
            { error: 'specialist_review_event_store_failed', detail: error.message },
            { status: 503 },
        );
    }

    return NextResponse.json(buildSpecialistReviewResponse(String(data.id), Boolean(data.learning_eligible), false));
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
    const sinceDays = clampDays(Number(searchParams.get('days') ?? 90));
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const reviewerRoute = normalizeOptionalSpecialistReviewLabel(searchParams.get('reviewer_route'));
    const reviewStatus = normalizeOptionalSpecialistReviewLabel(searchParams.get('review_status'));

    let query = supabase
        .from('specialist_review_events')
        .select('reviewer_route, specialty, urgency_level, review_stage, review_status, ai_disposition, clinician_action, report_status, pacs_status, outcome_required, outcome_captured, learning_eligible, observed_at, created_at')
        .eq('tenant_id', auth.actor.tenantId)
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(10_000);

    if (reviewerRoute) query = query.eq('reviewer_route', reviewerRoute);
    if (reviewStatus) query = query.eq('review_status', reviewStatus);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: 'specialist_review_data_unavailable' }, { status: 503 });
    }

    const rows = (Array.isArray(data) ? data : []) as SpecialistReviewEventRow[];
    return NextResponse.json({
        period: `last_${sinceDays}_days`,
        aggregate: aggregateSpecialistReviewEvents(rows),
        de_identified: true,
        error: null,
    });
}

async function loadCachedSpecialistReviewEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
): Promise<{ id: string; learning_eligible: boolean } | null> {
    const { data } = await supabase
        .from('specialist_review_events')
        .select('id, learning_eligible')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    return data?.id ? { id: String(data.id), learning_eligible: Boolean(data.learning_eligible) } : null;
}

function buildSpecialistReviewResponse(specialistReviewEventId: string, learningEligible: boolean, cached: boolean) {
    return {
        specialist_review_event_id: specialistReviewEventId,
        cached,
        learning_eligible: learningEligible,
        learning_signal: 'specialist_review_disposition',
        de_identified: true,
        error: null,
    };
}

function clampDays(value: number): number {
    if (!Number.isFinite(value)) return 90;
    return Math.min(365, Math.max(1, Math.round(value)));
}
