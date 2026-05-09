import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { Differential } from '@/lib/cire';

export const runtime = 'nodejs';

const OutcomeRequestSchema = z.object({
    inference_event_id: z.string().uuid(),
    outcome: z.object({
        type: z.string().min(1),
        payload: z.object({
            label: z.string().min(1),
            confidence: z.number().min(0).max(1),
        }).passthrough(),
        timestamp: z.string().datetime(),
    }),
});

export async function POST(req: Request) {
    const requestId = randomUUID();
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['outcome:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsedJson.error },
            { status: 400 },
        );
    }

    const parsed = OutcomeRequestSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: formatZodErrors(parsed.error) },
            { status: 400 },
        );
    }

    const tenantId = auth.actor.tenantId;
    const body = parsed.data;

    const { data: inferenceEvent, error: inferenceError } = await supabase
        .from('ai_inference_events')
        .select('id, tenant_id, case_id, input_signature, output_payload')
        .eq('id', body.inference_event_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

    if (inferenceError) {
        return NextResponse.json(
            { error: 'inference_lookup_failed', detail: inferenceError.message },
            { status: 500 },
        );
    }
    if (!inferenceEvent) {
        return NextResponse.json(
            { error: 'not_found', detail: 'Inference event not found.' },
            { status: 404 },
        );
    }

    const differentials = readDifferentials(inferenceEvent as Record<string, unknown>);
    const actualLabel = body.outcome.payload.label;
    const predictedP = differentials.find((entry) => entry.label === actualLabel)?.p ?? 0;
    const calibrationDelta = Number((body.outcome.payload.confidence - predictedP).toFixed(4));

    const inputSignature = asRecord((inferenceEvent as Record<string, unknown>).input_signature);
    const diagnosticEvidenceSnapshot = buildDiagnosticEvidenceSnapshot(inputSignature);
    const outcomePayload = {
        ...body.outcome.payload,
        calibration_delta: calibrationDelta,
        predicted_probability: predictedP,
        diagnostic_evidence_snapshot: diagnosticEvidenceSnapshot,
    };

    const { data: outcomeEvent, error: insertError } = await supabase
        .from('clinical_outcome_events')
        .insert({
            tenant_id: tenantId,
            case_id: readText((inferenceEvent as Record<string, unknown>).case_id),
            inference_event_id: body.inference_event_id,
            outcome_type: body.outcome.type,
            outcome_payload: outcomePayload,
            outcome_timestamp: body.outcome.timestamp,
        })
        .select('id')
        .single();

    let persistedOutcomeId = outcomeEvent?.id ? String(outcomeEvent.id) : null;
    if (insertError && isMissingColumnError(insertError.message)) {
        const fallbackInsert = await supabase
            .from('clinical_outcome_events')
            .insert({
                tenant_id: tenantId,
                case_id: readText((inferenceEvent as Record<string, unknown>).case_id),
                inference_event_id: body.inference_event_id,
                outcome_type: body.outcome.type,
                outcome_payload: outcomePayload,
                outcome_timestamp: body.outcome.timestamp,
            })
            .select('id')
            .single();

        if (fallbackInsert.error || !fallbackInsert.data?.id) {
            return NextResponse.json(
                { error: 'outcome_insert_failed', detail: fallbackInsert.error?.message ?? 'Unknown insert error' },
                { status: 500 },
            );
        }
        persistedOutcomeId = String(fallbackInsert.data.id);
    } else if (insertError || !outcomeEvent?.id) {
        return NextResponse.json(
            { error: 'outcome_insert_failed', detail: insertError?.message ?? 'Unknown insert error' },
            { status: 500 },
        );
    }

    const outputPayload = asRecord((inferenceEvent as Record<string, unknown>).output_payload);
    const inferenceUpdate = await supabase
        .from('ai_inference_events')
        .update({
            output_payload: {
                ...outputPayload,
                outcome_resolution: {
                    resolved: true,
                    calibration_delta: calibrationDelta,
                    actual_label: actualLabel,
                    actual_confidence: body.outcome.payload.confidence,
                    outcome_event_id: persistedOutcomeId,
                    diagnostic_evidence_snapshot: diagnosticEvidenceSnapshot,
                    timestamp: body.outcome.timestamp,
                },
            },
        })
        .eq('id', body.inference_event_id)
        .eq('tenant_id', tenantId);

    if (inferenceUpdate.error && !isMissingColumnError(inferenceUpdate.error.message)) {
        return NextResponse.json(
            { error: 'inference_update_failed', detail: inferenceUpdate.error.message },
            { status: 500 },
        );
    }

    if (inferenceUpdate.error && isMissingColumnError(inferenceUpdate.error.message)) {
        const fallbackUpdate = await supabase
            .from('ai_inference_events')
            .update({
                output_payload: {
                    ...outputPayload,
                    outcome_resolution: {
                        resolved: true,
                        calibration_delta: calibrationDelta,
                        actual_label: actualLabel,
                        actual_confidence: body.outcome.payload.confidence,
                        outcome_event_id: persistedOutcomeId,
                        diagnostic_evidence_snapshot: diagnosticEvidenceSnapshot,
                        timestamp: body.outcome.timestamp,
                    },
                },
            })
            .eq('id', body.inference_event_id)
            .eq('tenant_id', tenantId);

        if (fallbackUpdate.error) {
            return NextResponse.json(
                { error: 'inference_update_failed', detail: fallbackUpdate.error.message },
                { status: 500 },
            );
        }
    }

    return NextResponse.json({
        outcome_event_id: persistedOutcomeId,
        clinical_case_id: body.inference_event_id,
        linked_inference_event_id: body.inference_event_id,
        calibration_delta: calibrationDelta,
        request_id: requestId,
    });
}

function buildDiagnosticEvidenceSnapshot(inputSignature: Record<string, unknown>) {
    const diagnosticTests = asRecord(inputSignature.diagnostic_tests);
    const metadata = asRecord(inputSignature.metadata);
    const encounterPayload = asRecord(metadata.encounter_payload_v2 ?? metadata.v2_payload);
    const activePanels = Array.isArray(encounterPayload.active_system_panels)
        ? encounterPayload.active_system_panels
        : [];

    return {
        diagnostic_tests: diagnosticTests,
        active_system_panels: activePanels,
        panel_count: activePanels.length,
        evidence_keys: flattenDiagnosticEvidenceKeys(diagnosticTests),
    };
}

function flattenDiagnosticEvidenceKeys(value: unknown, prefix = ''): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            return flattenDiagnosticEvidenceKeys(nested, nextPrefix);
        }
        return [nextPrefix];
    });
}

function readDifferentials(row: Record<string, unknown>): Differential[] {
    const direct = normalizeDifferentials(row.differentials);
    if (direct.length > 0) return direct;

    const outputPayload = asRecord(row.output_payload);
    const outputDifferentials = normalizeDifferentials(outputPayload.differentials);
    if (outputDifferentials.length > 0) return outputDifferentials;

    const topDifferentials = normalizeDifferentials(asRecord(outputPayload.diagnosis).top_differentials);
    return topDifferentials;
}

function normalizeDifferentials(value: unknown): Differential[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            const record = asRecord(entry);
            const label = readText(record.label) ?? readText(record.name);
            const probability = readNumber(record.p) ?? readNumber(record.probability);
            return label && probability != null
                ? { label, p: Math.min(1, Math.max(0, probability)) }
                : null;
        })
        .filter((entry): entry is Differential => entry != null);
}

function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function isMissingColumnError(message: string): boolean {
    return message.includes('schema cache')
        || message.includes('column')
        || message.includes('Could not find the');
}
