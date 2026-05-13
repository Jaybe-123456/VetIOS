import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    createSupabaseClinicalCaseStore,
    finalizeClinicalCaseAfterOutcome,
    type ClinicalCaseRecord,
} from '@/lib/clinicalCases/clinicalCaseManager';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getVectorStore } from '@/lib/vectorStore/vetVectorStore';
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
    learning_consent: z.object({
        deidentified_training: z.boolean().optional(),
        network_learning: z.boolean().optional(),
        consent_version: z.string().min(1).optional(),
    }).optional(),
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
        .select('id, tenant_id, user_id, clinic_id, case_id, source_module, input_signature, output_payload, confidence_score, model_version')
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
    const outputPayload = asRecord((inferenceEvent as Record<string, unknown>).output_payload);
    const predictedLabel = differentials[0]?.label ?? readTopDiagnosisFromOutput(outputPayload);
    const predictionCorrect = predictedLabel ? labelsMatch(predictedLabel, actualLabel) : null;
    const predictedP = differentials.find((entry) => entry.label === actualLabel)?.p ?? 0;
    const calibrationDelta = Number((body.outcome.payload.confidence - predictedP).toFixed(4));

    const inputSignature = asRecord((inferenceEvent as Record<string, unknown>).input_signature);
    const diagnosticEvidenceSnapshot = buildDiagnosticEvidenceSnapshot(inputSignature);
    const learningConsent = normalizeLearningConsent(body.learning_consent);
    const requestOutcomePayload = asRecord(body.outcome.payload);
    const outcomePayload = {
        ...body.outcome.payload,
        label: actualLabel,
        actual_label: actualLabel,
        confirmed_diagnosis: readText(requestOutcomePayload.confirmed_diagnosis) ?? actualLabel,
        actual_diagnosis: readText(requestOutcomePayload.actual_diagnosis) ?? actualLabel,
        prediction_correct: predictionCorrect,
        calibration_delta: calibrationDelta,
        predicted_probability: predictedP,
        diagnostic_evidence_snapshot: diagnosticEvidenceSnapshot,
        learning_consent: learningConsent,
    };

    const caseId = readText((inferenceEvent as Record<string, unknown>).case_id);
    let persistedOutcomeId: string;
    try {
        persistedOutcomeId = await insertOutcomeEvent(supabase, {
            tenant_id: tenantId,
            user_id: readText((inferenceEvent as Record<string, unknown>).user_id) ?? auth.actor.userId,
            clinic_id: readText((inferenceEvent as Record<string, unknown>).clinic_id),
            case_id: caseId,
            source_module: 'clinical_outcome_closure',
            inference_event_id: body.inference_event_id,
            outcome_type: body.outcome.type,
            outcome_payload: outcomePayload,
            outcome_timestamp: body.outcome.timestamp,
            label_type: readText(requestOutcomePayload.label_type) ?? 'expert_reviewed',
            actual_label: actualLabel,
            actual_confidence: body.outcome.payload.confidence,
            calibration_delta: calibrationDelta,
            timestamp: body.outcome.timestamp,
        });
    } catch (error) {
        return NextResponse.json(
            { error: 'outcome_insert_failed', detail: error instanceof Error ? error.message : 'Unknown insert error' },
            { status: 500 },
        );
    }

    const outcomeResolution = {
        resolved: true,
        calibration_delta: calibrationDelta,
        actual_label: actualLabel,
        actual_confidence: body.outcome.payload.confidence,
        prediction_correct: predictionCorrect,
        outcome_event_id: persistedOutcomeId,
        diagnostic_evidence_snapshot: diagnosticEvidenceSnapshot,
        learning_consent: learningConsent,
        timestamp: body.outcome.timestamp,
    };
    try {
        await updateInferenceOutcome(supabase, tenantId, body.inference_event_id, {
            output_payload: {
                ...outputPayload,
                outcome_resolution: outcomeResolution,
            },
            calibration_delta: calibrationDelta,
            outcome_resolved: true,
            outcome_confirmed: true,
            outcome_confirmed_at: body.outcome.timestamp,
            confirmed_diagnosis: actualLabel,
            prediction_correct: predictionCorrect,
        });
    } catch (error) {
        return NextResponse.json(
            { error: 'inference_update_failed', detail: error instanceof Error ? error.message : 'Unknown update error' },
            { status: 500 },
        );
    }

    let clinicalCase: ClinicalCaseRecord | null = null;
    if (caseId) {
        try {
            const caseStore = createSupabaseClinicalCaseStore(supabase);
            const existingCase = await caseStore.findById(tenantId, caseId);
            if (existingCase) {
                clinicalCase = await finalizeClinicalCaseAfterOutcome(
                    caseStore,
                    existingCase,
                    persistedOutcomeId,
                    {
                        observedAt: body.outcome.timestamp,
                        userId: auth.actor.userId,
                        sourceModule: 'clinical_outcome_closure',
                        outcomePayload,
                        outcomeType: body.outcome.type,
                        metadataPatch: {
                            latest_outcome_closure_at: body.outcome.timestamp,
                            latest_outcome_event_id: persistedOutcomeId,
                            learning_consent: learningConsent,
                        },
                    },
                );
            }
        } catch (error) {
            return NextResponse.json(
                { error: 'clinical_case_update_failed', detail: error instanceof Error ? error.message : 'Unknown clinical case update error' },
                { status: 500 },
            );
        }
    }

    const derivedUpdates = await runDerivedOutcomeUpdates(supabase, {
        tenantId,
        inferenceEventId: body.inference_event_id,
        actualLabel,
        timestamp: body.outcome.timestamp,
        outcomePayload,
        inputSignature,
        clinicalCase,
    });

    return NextResponse.json({
        outcome_event_id: persistedOutcomeId,
        clinical_case_id: clinicalCase?.id ?? caseId,
        linked_inference_event_id: body.inference_event_id,
        calibration_delta: calibrationDelta,
        prediction_correct: predictionCorrect,
        derived_updates: derivedUpdates,
        request_id: requestId,
    });
}

const OPTIONAL_OUTCOME_INSERT_COLUMNS = new Set([
    'user_id',
    'clinic_id',
    'source_module',
    'label_type',
    'actual_label',
    'actual_confidence',
    'calibration_delta',
    'timestamp',
]);

const OPTIONAL_INFERENCE_OUTCOME_COLUMNS = new Set([
    'calibration_delta',
    'outcome_resolved',
    'outcome_confirmed',
    'outcome_confirmed_at',
    'confirmed_diagnosis',
    'prediction_correct',
]);

async function insertOutcomeEvent(
    supabase: SupabaseClient,
    payload: Record<string, unknown>,
): Promise<string> {
    let nextPayload = { ...payload };

    for (;;) {
        const { data, error } = await supabase
            .from('clinical_outcome_events')
            .insert(nextPayload)
            .select('id')
            .single();

        if (!error && data?.id) return String(data.id);
        if (!error) throw new Error('Unknown insert error');

        const missingColumn = resolveMissingColumn(error.message ?? '', nextPayload, OPTIONAL_OUTCOME_INSERT_COLUMNS);
        if (!missingColumn) throw new Error(error.message);

        nextPayload = { ...nextPayload };
        delete nextPayload[missingColumn];
    }
}

async function updateInferenceOutcome(
    supabase: SupabaseClient,
    tenantId: string,
    inferenceEventId: string,
    patch: Record<string, unknown>,
): Promise<void> {
    let nextPatch = { ...patch };

    for (;;) {
        const { error } = await supabase
            .from('ai_inference_events')
            .update(nextPatch)
            .eq('id', inferenceEventId)
            .eq('tenant_id', tenantId);

        if (!error) return;

        const missingColumn = resolveMissingColumn(error.message ?? '', nextPatch, OPTIONAL_INFERENCE_OUTCOME_COLUMNS);
        if (!missingColumn) throw new Error(error.message);

        nextPatch = { ...nextPatch };
        delete nextPatch[missingColumn];
    }
}

async function runDerivedOutcomeUpdates(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        actualLabel: string;
        timestamp: string;
        outcomePayload: Record<string, unknown>;
        inputSignature: Record<string, unknown>;
        clinicalCase: ClinicalCaseRecord | null;
    },
) {
    const warnings: string[] = [];
    let vector_case_confirmed = false;
    let active_learning_reviewed = false;
    let longitudinal_record_id: string | null = null;

    try {
        await getVectorStore().confirmOutcome(input.inferenceEventId, input.actualLabel);
        vector_case_confirmed = true;
    } catch (error) {
        warnings.push(`vector_store: ${error instanceof Error ? error.message : 'confirm failed'}`);
    }

    try {
        const { data, error } = await supabase
            .from('active_learning_queue')
            .update({
                status: 'reviewed',
                confirmed_diagnosis: input.actualLabel,
                reviewed_at: input.timestamp,
            })
            .eq('tenant_id', input.tenantId)
            .eq('inference_event_id', input.inferenceEventId)
            .select('id')
            .maybeSingle();

        if (error) warnings.push(`active_learning: ${error.message}`);
        else active_learning_reviewed = Boolean(data?.id);
    } catch (error) {
        warnings.push(`active_learning: ${error instanceof Error ? error.message : 'review update failed'}`);
    }

    try {
        longitudinal_record_id = await upsertLongitudinalOutcome(supabase, input);
    } catch (error) {
        warnings.push(`longitudinal: ${error instanceof Error ? error.message : 'record update failed'}`);
    }

    return {
        vector_case_confirmed,
        active_learning_reviewed,
        longitudinal_record_id,
        warnings,
    };
}

async function upsertLongitudinalOutcome(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        actualLabel: string;
        timestamp: string;
        outcomePayload: Record<string, unknown>;
        inputSignature: Record<string, unknown>;
        clinicalCase: ClinicalCaseRecord | null;
    },
): Promise<string | null> {
    const metadata = asRecord(input.inputSignature.metadata);
    const patientId = input.clinicalCase?.patient_id
        ?? readText(input.inputSignature.patient_id)
        ?? readText(metadata.patient_id);
    if (!patientId) return null;

    const biomarkers = firstNonEmptyRecord(
        asRecord(metadata.labs),
        asRecord(input.inputSignature.biomarkers),
        asRecord(input.inputSignature.lab_results),
    );
    const visitRecord = {
        patient_id: patientId,
        tenant_id: input.tenantId,
        visit_date: input.timestamp.slice(0, 10),
        species: input.clinicalCase?.species_canonical
            ?? input.clinicalCase?.species
            ?? readText(input.inputSignature.species)
            ?? 'unknown',
        breed: input.clinicalCase?.breed ?? readText(input.inputSignature.breed),
        age_years: readNumber(metadata.age_years ?? input.inputSignature.age_years),
        weight_kg: readNumber(metadata.weight_kg ?? input.inputSignature.weight_kg),
        symptoms: input.clinicalCase?.symptoms_normalized.length
            ? input.clinicalCase.symptoms_normalized
            : readStringArray(input.inputSignature.symptoms),
        biomarkers,
        inference_event_id: input.inferenceEventId,
        primary_diagnosis: input.clinicalCase?.predicted_diagnosis
            ?? input.clinicalCase?.top_diagnosis
            ?? readTopDiagnosisFromOutput(asRecord(input.outcomePayload)),
        diagnosis_confidence: input.clinicalCase?.diagnosis_confidence
            ?? readNumber(input.outcomePayload.predicted_probability),
        treatment_prescribed: readStringArray(
            input.outcomePayload.treatment_prescribed,
            input.outcomePayload.treatments,
            input.outcomePayload.treatment,
        ),
        outcome_confirmed: true,
        confirmed_diagnosis: input.actualLabel,
        outcome_confirmed_at: input.timestamp,
        vet_notes: readText(input.outcomePayload.notes),
    };

    const existing = await supabase
        .from('patient_longitudinal_records')
        .select('id')
        .eq('tenant_id', input.tenantId)
        .eq('inference_event_id', input.inferenceEventId)
        .maybeSingle();

    if (existing.error) throw new Error(existing.error.message);

    if (existing.data?.id) {
        const { data, error } = await supabase
            .from('patient_longitudinal_records')
            .update(visitRecord)
            .eq('id', existing.data.id)
            .select('id')
            .single();
        if (error || !data?.id) throw new Error(error?.message ?? 'Failed to update longitudinal record');
        return String(data.id);
    }

    const { data, error } = await supabase
        .from('patient_longitudinal_records')
        .insert(visitRecord)
        .select('id')
        .single();
    if (error || !data?.id) throw new Error(error?.message ?? 'Failed to insert longitudinal record');
    return String(data.id);
}

function normalizeLearningConsent(value: unknown) {
    const record = asRecord(value);
    return {
        deidentified_training: record.deidentified_training === true,
        network_learning: record.network_learning === true,
        consent_version: readText(record.consent_version) ?? 'vetios_learning_consent_v1',
    };
}

function resolveMissingColumn(
    message: string,
    payload: Record<string, unknown>,
    optionalColumns: Set<string>,
): string | null {
    if (!isMissingColumnError(message)) return null;

    for (const column of Object.keys(payload)) {
        if (!optionalColumns.has(column)) continue;
        if (
            message.includes(`'${column}'`) ||
            message.includes(`"${column}"`) ||
            message.includes(`.${column}`) ||
            message.includes(` ${column} `)
        ) {
            return column;
        }
    }

    return null;
}

function readTopDiagnosisFromOutput(outputPayload: Record<string, unknown>): string | null {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const diagnosisDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    const directDifferentials = Array.isArray(outputPayload.differentials)
        ? outputPayload.differentials
        : [];
    const first = asRecord(diagnosisDifferentials[0] ?? directDifferentials[0]);
    return readText(outputPayload.top_diagnosis)
        ?? readText(diagnosis.top_diagnosis)
        ?? readText(first.label)
        ?? readText(first.name)
        ?? readText(first.condition);
}

function labelsMatch(left: string, right: string): boolean {
    return normalizeLabel(left) === normalizeLabel(right);
}

function normalizeLabel(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
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
            const label = readText(record.label) ?? readText(record.name) ?? readText(record.condition);
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

function readStringArray(...values: unknown[]): string[] {
    const entries: string[] = [];
    for (const value of values) {
        if (Array.isArray(value)) {
            for (const entry of value) {
                const normalized = readText(entry);
                if (normalized) entries.push(normalized);
            }
            continue;
        }
        const normalized = readText(value);
        if (normalized) entries.push(normalized);
    }
    return Array.from(new Set(entries));
}

function firstNonEmptyRecord(...records: Record<string, unknown>[]): Record<string, unknown> | null {
    for (const record of records) {
        if (Object.keys(record).length > 0) return record;
    }
    return null;
}

function isMissingColumnError(message: string): boolean {
    return message.includes('schema cache')
        || message.includes('column')
        || message.includes('Could not find the');
}
