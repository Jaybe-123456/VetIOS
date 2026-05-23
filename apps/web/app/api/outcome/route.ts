import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    SupabaseWriteError,
    asRecord as asCoreRecord,
    isUuidV4,
    logApiCompleted,
    logApiReceived,
    logSupabaseFailure,
    readErrorCode,
    readErrorMessage,
    readString,
    retryAfterResponse,
} from '@/lib/api/corePipeline';
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
    request_id: z.string().refine(isUuidV4, 'request_id must be a UUID v4'),
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
    const startTime = Date.now();
    let requestId: string | null = null;
    let tenantId: string | null = null;
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
        logApiReceived({ event: 'outcome.received', route: '/api/outcome', tenantId, requestId });
        logApiCompleted({
            event: 'outcome.completed',
            route: '/api/outcome',
            tenantId,
            requestId,
            startTime,
            error: 'invalid_json',
        });
        return NextResponse.json(
            { error: 'invalid_input', detail: parsedJson.error },
            { status: 400 },
        );
    }

    requestId = readString(asCoreRecord(parsedJson.data).request_id);
    const parsed = OutcomeRequestSchema.safeParse(parsedJson.data);
    tenantId = auth.actor.tenantId;
    logApiReceived({ event: 'outcome.received', route: '/api/outcome', tenantId, requestId });

    if (!parsed.success) {
        logApiCompleted({
            event: 'outcome.completed',
            route: '/api/outcome',
            tenantId,
            requestId,
            startTime,
            error: 'invalid_input',
        });
        return NextResponse.json(
            { error: 'invalid_input', detail: formatZodErrors(parsed.error) },
            { status: 400 },
        );
    }

    requestId = parsed.data.request_id;
    const body = parsed.data;

    const cached = await loadCachedOutcomeEvent(supabase, tenantId, requestId);
    if (cached.error) {
        const errorCode = readErrorCode(cached.error, 'outcome_idempotency_lookup_failed');
        logSupabaseFailure({
            route: '/api/outcome',
            requestId,
            tenantId,
            errorCode,
            error: cached.error,
        });
        logApiCompleted({
            event: 'outcome.completed',
            route: '/api/outcome',
            tenantId,
            requestId,
            startTime,
            error: errorCode,
        });
        return retryAfterResponse({ requestId, errorCode, detail: readErrorMessage(cached.error) });
    }
    if (cached.data) {
        logApiCompleted({
            event: 'outcome.completed',
            route: '/api/outcome',
            tenantId,
            requestId,
            startTime,
            cached: true,
        });
        return NextResponse.json(buildCachedOutcomePayload(cached.data as Record<string, unknown>, requestId));
    }

    const { data: inferenceEvent, error: inferenceError } = await supabase
        .from('ai_inference_events')
        .select('id, tenant_id, user_id, clinic_id, case_id, source_module, input_signature, output_payload, confidence_score, model_version')
        .eq('id', body.inference_event_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

    if (inferenceError) {
        const errorCode = readErrorCode(inferenceError, 'inference_lookup_failed');
        logSupabaseFailure({
            route: '/api/outcome',
            requestId,
            tenantId,
            errorCode,
            error: inferenceError,
        });
        logApiCompleted({
            event: 'outcome.completed',
            route: '/api/outcome',
            tenantId,
            requestId,
            startTime,
            error: errorCode,
        });
        return retryAfterResponse({ requestId, errorCode, detail: inferenceError.message });
    }
    if (!inferenceEvent) {
        logApiCompleted({
            event: 'outcome.completed',
            route: '/api/outcome',
            tenantId,
            requestId,
            startTime,
            error: 'not_found',
        });
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
    const predictedP = differentials.find((entry) => labelsMatch(entry.label, actualLabel))?.p ?? 0;
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
            request_id: requestId,
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
        const errorCode = error instanceof SupabaseWriteError ? error.errorCode : 'outcome_insert_failed';
        logSupabaseFailure({
            route: '/api/outcome',
            requestId,
            tenantId,
            errorCode,
            error: error instanceof SupabaseWriteError ? error.originalError : error,
        });
        logApiCompleted({
            event: 'outcome.completed',
            route: '/api/outcome',
            tenantId,
            requestId,
            startTime,
            error: errorCode,
        });
        return retryAfterResponse({ requestId, errorCode, detail: error instanceof Error ? error.message : 'Unknown insert error' });
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
        await upsertLabelCalibration(supabase, {
            tenantId,
            label: actualLabel,
            calibrationDelta,
        });
    } catch (error) {
        const errorCode = error instanceof SupabaseWriteError ? error.errorCode : 'label_calibration_write_failed';
        logSupabaseFailure({
            route: '/api/outcome',
            requestId,
            tenantId,
            errorCode,
            error: error instanceof SupabaseWriteError ? error.originalError : error,
        });
        logApiCompleted({
            event: 'outcome.completed',
            route: '/api/outcome',
            tenantId,
            requestId,
            startTime,
            error: errorCode,
        });
        return retryAfterResponse({ requestId, errorCode, detail: error instanceof Error ? error.message : 'Unknown calibration error' });
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
            logApiCompleted({
                event: 'outcome.completed',
                route: '/api/outcome',
                tenantId,
                requestId,
                startTime,
                error: 'clinical_case_update_failed',
            });
            return NextResponse.json(
                { error: 'clinical_case_update_failed', detail: error instanceof Error ? error.message : 'Unknown clinical case update error' },
                { status: 500 },
            );
        }
    }

    const diagnosisRecord = await insertDiagnosisRecordIfPossible(supabase, {
        tenantId,
        userId: auth.actor.userId,
        clinicalCaseId: caseId,
        clinicalCase,
        inferenceEventId: body.inference_event_id,
        outcomeEventId: persistedOutcomeId,
        actualLabel,
        timestamp: body.outcome.timestamp,
        outcomePayload,
        inputSignature,
    });

    const caseClosure = caseId
        ? await closeClinicalCaseIfPossible(supabase, {
            tenantId,
            clinicalCaseId: caseId,
            actualLabel,
            timestamp: body.outcome.timestamp,
            outcomePayload,
            diagnosisRecordId: diagnosisRecord.id,
        })
        : { closed: false, warning: null };

    const derivedUpdates = await runDerivedOutcomeUpdates(supabase, {
        tenantId,
        inferenceEventId: body.inference_event_id,
        actualLabel,
        timestamp: body.outcome.timestamp,
        outcomePayload,
        inputSignature,
        clinicalCase,
    });

    const responseBody = {
        outcome_event_id: persistedOutcomeId,
        clinical_case_id: clinicalCase?.id ?? caseId,
        linked_inference_event_id: body.inference_event_id,
        calibration_delta: calibrationDelta,
        prediction_correct: predictionCorrect,
        diagnosis_record_id: diagnosisRecord.id,
        derived_updates: {
            ...derivedUpdates,
            diagnosis_record_id: diagnosisRecord.id,
            case_closed: caseClosure.closed,
            warnings: [
                ...derivedUpdates.warnings,
                ...[diagnosisRecord.warning, caseClosure.warning].filter((entry): entry is string => Boolean(entry)),
            ],
        },
        request_id: requestId,
    };
    logApiCompleted({
        event: 'outcome.completed',
        route: '/api/outcome',
        tenantId,
        requestId,
        startTime,
    });
    return NextResponse.json(responseBody);
}

async function loadCachedOutcomeEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
) {
    return supabase
        .from('clinical_outcome_events')
        .select('id, tenant_id, request_id, case_id, inference_event_id, outcome_type, outcome_payload, actual_label, actual_confidence, calibration_delta, created_at')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
}

function buildCachedOutcomePayload(row: Record<string, unknown>, requestId: string) {
    const payload = asCoreRecord(row.outcome_payload);
    return {
        outcome_event_id: readString(row.id),
        clinical_case_id: readString(row.case_id),
        linked_inference_event_id: readString(row.inference_event_id),
        calibration_delta: readNumber(row.calibration_delta) ?? readNumber(payload.calibration_delta),
        prediction_correct: typeof payload.prediction_correct === 'boolean' ? payload.prediction_correct : null,
        derived_updates: {
            cached: true,
            warnings: [],
        },
        request_id: requestId,
        meta: {
            tenant_id: readString(row.tenant_id),
            idempotent: true,
        },
        error: null,
    };
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

const OPTIONAL_DIAGNOSIS_RECORD_COLUMNS = new Set([
    'clinical_case_id',
    'encounter_id',
    'inference_event_id',
    'outcome_event_id',
    'diagnosis_method',
    'clinician_notes',
    'treatment_initiated',
    'outcome_at_followup',
    'created_by',
]);

const OPTIONAL_CASE_CLOSURE_COLUMNS = new Set([
    'case_status',
    'closed_at',
    'case_closure_summary',
    'treatments',
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
        if (!error) {
            throw new SupabaseWriteError(
                'clinical_outcome_events insert failed: Unknown insert error',
                'outcome_insert_failed',
                error,
            );
        }

        const missingColumn = resolveMissingColumn(error.message ?? '', nextPayload, OPTIONAL_OUTCOME_INSERT_COLUMNS);
        if (!missingColumn) {
            throw new SupabaseWriteError(
                `clinical_outcome_events insert failed: ${error.message}`,
                readErrorCode(error, 'outcome_insert_failed'),
                error,
            );
        }

        nextPayload = { ...nextPayload };
        delete nextPayload[missingColumn];
    }
}

async function upsertLabelCalibration(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        label: string;
        calibrationDelta: number;
    },
): Promise<void> {
    const existing = await supabase
        .from('label_calibration')
        .select('sample_count, cumulative_delta')
        .eq('tenant_id', input.tenantId)
        .eq('label', input.label)
        .maybeSingle();

    if (existing.error) {
        throw new SupabaseWriteError(
            `label_calibration lookup failed: ${existing.error.message}`,
            readErrorCode(existing.error, 'label_calibration_lookup_failed'),
            existing.error,
        );
    }

    const row = asCoreRecord(existing.data);
    const sampleCount = Math.max(0, Math.trunc(readNumber(row.sample_count) ?? 0)) + 1;
    const cumulativeDelta = (readNumber(row.cumulative_delta) ?? 0) + input.calibrationDelta;
    const { error } = await supabase
        .from('label_calibration')
        .upsert({
            tenant_id: input.tenantId,
            label: input.label,
            sample_count: sampleCount,
            cumulative_delta: cumulativeDelta,
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'tenant_id,label',
        });

    if (error) {
        throw new SupabaseWriteError(
            `label_calibration write failed: ${error.message}`,
            readErrorCode(error, 'label_calibration_write_failed'),
            error,
        );
    }
}

async function insertDiagnosisRecordIfPossible(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        userId: string | null;
        clinicalCaseId: string | null;
        clinicalCase: ClinicalCaseRecord | null;
        inferenceEventId: string;
        outcomeEventId: string;
        actualLabel: string;
        timestamp: string;
        outcomePayload: Record<string, unknown>;
        inputSignature: Record<string, unknown>;
    },
): Promise<{ id: string | null; warning: string | null }> {
    const metadata = asRecord(input.inputSignature.metadata);
    const diagnosis = readText(input.outcomePayload.confirmed_diagnosis)
        ?? readText(input.outcomePayload.actual_diagnosis)
        ?? input.actualLabel;
    let payload: Record<string, unknown> = {
        tenant_id: input.tenantId,
        clinical_case_id: readUuid(input.clinicalCaseId),
        encounter_id: readUuid(input.clinicalCase?.encounter_id)
            ?? readUuid(input.inputSignature.encounter_id)
            ?? readUuid(metadata.encounter_id),
        inference_event_id: input.inferenceEventId,
        outcome_event_id: input.outcomeEventId,
        confirmed_diagnosis: diagnosis,
        diagnosis_method: normalizeDiagnosisMethod(input.outcomePayload.diagnosis_method),
        clinician_notes: readText(input.outcomePayload.clinician_notes)
            ?? readText(input.outcomePayload.notes),
        treatment_initiated: readStringArray(
            input.outcomePayload.treatment_initiated,
            input.outcomePayload.treatments,
            input.outcomePayload.treatment,
            input.outcomePayload.treatment_prescribed,
        ),
        outcome_at_followup: readText(input.outcomePayload.outcome_at_followup),
        created_by: readUuid(input.userId),
        created_at: input.timestamp,
    };

    payload = Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== null && value !== undefined),
    );

    for (;;) {
        const { data, error } = await supabase
            .from('diagnosis_records')
            .insert(payload)
            .select('id')
            .single();

        if (!error && data?.id) {
            return { id: String(data.id), warning: null };
        }
        if (!error) {
            return { id: null, warning: 'diagnosis_records: unknown insert error' };
        }
        if (isMissingRelationError(error.message ?? '')) {
            return { id: null, warning: 'diagnosis_records table is not available; apply clinician case migration' };
        }

        const missingColumn = resolveMissingColumn(error.message ?? '', payload, OPTIONAL_DIAGNOSIS_RECORD_COLUMNS);
        if (!missingColumn) {
            return { id: null, warning: `diagnosis_records: ${error.message}` };
        }

        payload = { ...payload };
        delete payload[missingColumn];
    }
}

async function closeClinicalCaseIfPossible(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        clinicalCaseId: string;
        actualLabel: string;
        timestamp: string;
        outcomePayload: Record<string, unknown>;
        diagnosisRecordId: string | null;
    },
): Promise<{ closed: boolean; warning: string | null }> {
    let patch: Record<string, unknown> = {
        case_status: 'closed',
        closed_at: input.timestamp,
        case_closure_summary: {
            confirmed_diagnosis: readText(input.outcomePayload.confirmed_diagnosis) ?? input.actualLabel,
            diagnosis_method: normalizeDiagnosisMethod(input.outcomePayload.diagnosis_method),
            clinician_notes: readText(input.outcomePayload.clinician_notes) ?? readText(input.outcomePayload.notes),
            outcome_at_followup: readText(input.outcomePayload.outcome_at_followup),
            diagnosis_record_id: input.diagnosisRecordId,
        },
        treatments: readStringArray(
            input.outcomePayload.treatment_initiated,
            input.outcomePayload.treatments,
            input.outcomePayload.treatment,
            input.outcomePayload.treatment_prescribed,
        ),
    };

    for (;;) {
        const { error } = await supabase
            .from('clinical_cases')
            .update(patch)
            .eq('tenant_id', input.tenantId)
            .eq('id', input.clinicalCaseId);

        if (!error) {
            return { closed: true, warning: null };
        }

        const missingColumn = resolveMissingColumn(error.message ?? '', patch, OPTIONAL_CASE_CLOSURE_COLUMNS);
        if (!missingColumn) {
            return { closed: false, warning: `clinical_cases closure: ${error.message}` };
        }

        patch = { ...patch };
        delete patch[missingColumn];
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
            const probability = readNumber(record.p)
                ?? readNumber(record.probability)
                ?? readNumber(record.confidence)
                ?? readNumber(record.confidence_score);
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

function readUuid(value: unknown): string | null {
    const text = readText(value);
    return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
        ? text
        : null;
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

function normalizeDiagnosisMethod(value: unknown): string | null {
    const normalized = readText(value)?.toLowerCase();
    return normalized === 'clinical'
        || normalized === 'lab_confirmed'
        || normalized === 'imaging_confirmed'
        || normalized === 'pathology'
        || normalized === 'response_to_treatment'
        ? normalized
        : null;
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

function isMissingRelationError(message: string): boolean {
    return message.includes('relation')
        && (message.includes('does not exist') || message.includes('schema cache'));
}
