import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    EXTERNAL_VALIDATION_ATTESTATION_STATUSES,
    EXTERNAL_VALIDATION_ATTESTOR_KINDS,
    EXTERNAL_VALIDATION_SCOPES,
    EXTERNAL_VALIDATION_TARGET_TYPES,
    EXTERNAL_VALIDATION_VERIFICATION_STATUSES,
    aggregateExternalValidationEvents,
    buildExternalValidationAssessment,
    type ExternalValidationEventRow,
} from '@/lib/platform/externalValidation';
import { apiGuard } from '@/lib/http/apiGuard';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});

const ExternalValidationSchema = z.object({
    request_id: z.string().uuid(),
    validation_target_type: z.enum(EXTERNAL_VALIDATION_TARGET_TYPES),
    validation_target_id: z.string().uuid().optional(),
    validation_target_ref: z.string().min(3).max(180),
    moat_key: z.string().min(3).max(96).optional(),
    attestor_kind: z.enum(EXTERNAL_VALIDATION_ATTESTOR_KINDS),
    attestor_ref: z.string().min(3).max(180),
    validation_scope: z.enum(EXTERNAL_VALIDATION_SCOPES),
    attestation_status: z.enum(EXTERNAL_VALIDATION_ATTESTATION_STATUSES).default('submitted'),
    verification_status: z.enum(EXTERNAL_VALIDATION_VERIFICATION_STATUSES).default('unsigned'),
    validation_score: z.number().min(0).max(1).default(0),
    source_system: z.string().max(120).optional(),
    source_ref: z.string().max(180).optional(),
    signed_payload_hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    signature_algorithm: z.string().max(80).optional(),
    signature_hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    signing_key_fingerprint: z.string().max(160).optional(),
    evidence: JsonRecordSchema,
    limitations: z.string().max(2000).optional(),
    validation_summary: z.string().max(2000).optional(),
    observed_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['evaluation:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = ExternalValidationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    let assessment;
    try {
        assessment = buildExternalValidationAssessment(parsed.data);
    } catch (error) {
        return NextResponse.json(
            { error: 'invalid_validation_reference', detail: error instanceof Error ? error.message : 'Invalid reference.' },
            { status: 400 },
        );
    }

    const body = parsed.data;
    const payload = {
        tenant_id: auth.actor.tenantId,
        request_id: body.request_id,
        validation_target_type: body.validation_target_type,
        validation_target_id: body.validation_target_id ?? null,
        validation_target_ref: assessment.normalized_target_ref,
        moat_key: assessment.normalized_moat_key,
        attestor_kind: body.attestor_kind,
        attestor_ref: assessment.normalized_attestor_ref,
        validation_scope: body.validation_scope,
        attestation_status: body.attestation_status,
        verification_status: body.verification_status,
        evidence_grade: assessment.evidence_grade,
        validation_score: assessment.validation_score,
        source_system: normalizeOptionalText(body.source_system),
        source_ref: normalizeOptionalText(body.source_ref),
        signed_payload_hash: assessment.signed_payload_hash,
        signature_algorithm: normalizeOptionalText(body.signature_algorithm),
        signature_hash: normalizeOptionalText(body.signature_hash)?.toLowerCase() ?? null,
        signing_key_fingerprint: normalizeOptionalText(body.signing_key_fingerprint),
        evidence: {
            ...body.evidence,
            next_required_action: assessment.next_required_action,
            defensibility_signal: assessment.defensibility_signal,
        },
        limitations: normalizeOptionalText(body.limitations),
        validation_summary: normalizeOptionalText(body.validation_summary),
        observed_at: body.observed_at ?? new Date().toISOString(),
    };

    const { data, error } = await client
        .from('external_validation_events')
        .insert(payload)
        .select('id, evidence_grade, validation_score')
        .single();

    if (error) {
        if (error.code === '23505') {
            const cached = await loadCachedExternalValidationEvent(client, auth.actor.tenantId, body.request_id);
            if (cached) return NextResponse.json({ ...cached, cached: true, de_identified: true, error: null });
        }
        return NextResponse.json(
            { error: 'external_validation_event_store_failed', detail: error.message },
            { status: 503 },
        );
    }

    return NextResponse.json({
        external_validation_event_id: String(data.id),
        evidence_grade: String(data.evidence_grade ?? assessment.evidence_grade),
        validation_score: Number(data.validation_score ?? assessment.validation_score),
        defensibility_signal: assessment.defensibility_signal,
        next_required_action: assessment.next_required_action,
        cached: false,
        de_identified: true,
        error: null,
    });
}

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['evaluation:read'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sinceDays = clampDays(Number(searchParams.get('days') ?? 90));
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const moatKey = normalizeQueryText(searchParams.get('moat_key'));

    let query = client
        .from('external_validation_events')
        .select('validation_target_type, moat_key, attestor_kind, validation_scope, attestation_status, verification_status, evidence_grade, validation_score, observed_at, created_at')
        .eq('tenant_id', auth.actor.tenantId)
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(10_000);

    if (moatKey) query = query.eq('moat_key', moatKey);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: 'external_validation_data_unavailable' }, { status: 503 });
    }

    const rows = (Array.isArray(data) ? data : []) as ExternalValidationEventRow[];
    return NextResponse.json({
        period: `last_${sinceDays}_days`,
        aggregate: aggregateExternalValidationEvents(rows),
        de_identified: true,
        error: null,
    });
}

async function loadCachedExternalValidationEvent(
    client: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
) {
    const { data } = await client
        .from('external_validation_events')
        .select('id, evidence_grade, validation_score')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();

    if (!data?.id) return null;
    return {
        external_validation_event_id: String(data.id),
        evidence_grade: String(data.evidence_grade ?? 'none'),
        validation_score: Number(data.validation_score ?? 0),
    };
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeQueryText(value: string | null): string | null {
    return value?.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_') || null;
}

function clampDays(value: number): number {
    if (!Number.isFinite(value)) return 90;
    return Math.min(365, Math.max(1, Math.round(value)));
}
