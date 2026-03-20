import type { SupabaseClient } from '@supabase/supabase-js';
import {
    AI_INFERENCE_EVENTS,
    CLINICAL_CASES,
    CLINICAL_OUTCOME_EVENTS,
    EDGE_SIMULATION_EVENTS,
} from '@/lib/db/schemaContracts';
import {
    applyClinicalCaseLearningSync,
    createSupabaseClinicalCaseStore,
    finalizeClinicalCaseAfterInference,
    finalizeClinicalCaseAfterOutcome,
    finalizeClinicalCaseAfterSimulation,
    mapClinicalCaseRow,
    normalizeSpeciesValue,
    type ClinicalCaseRecord,
    type ClinicalCaseStore,
} from '@/lib/clinicalCases/clinicalCaseManager';
import { buildInferenceLearningPatch } from '@/lib/clinicalCases/clinicalCaseIntelligence';

export interface ClinicalCaseHistoryInferenceEvent {
    id: string;
    tenant_id: string;
    user_id: string | null;
    case_id: string | null;
    source_module: string | null;
    model_version: string | null;
    input_signature: Record<string, unknown>;
    output_payload: Record<string, unknown>;
    confidence_score: number | null;
    created_at: string;
}

export interface ClinicalCaseHistoryOutcomeEvent {
    id: string;
    tenant_id: string;
    user_id: string | null;
    case_id: string | null;
    source_module: string | null;
    outcome_type: string;
    outcome_payload: Record<string, unknown>;
    outcome_timestamp: string;
    created_at: string;
}

export interface ClinicalCaseHistorySimulationEvent {
    id: string;
    tenant_id: string;
    user_id: string | null;
    case_id: string | null;
    source_module: string | null;
    simulation_type: string;
    stress_metrics: Record<string, unknown> | null;
    created_at: string;
}

export interface ClinicalCaseBackfillSummary {
    tenant_id: string;
    cases_scanned: number;
    cases_backfilled: number;
    cases_missing_inference_events: number;
    cases_with_conflicting_inference_history: number;
    cases_with_low_signal_defaults: number;
    cases_with_outcome_labels: number;
    cases_with_adversarial_history: number;
    cases_calibration_ready: number;
    generated_at: string;
}

export interface ClinicalCaseBackfillResult {
    summary: ClinicalCaseBackfillSummary;
    updated_case_ids: string[];
    skipped_case_ids: string[];
}

export async function backfillClinicalCaseLearningState(input: {
    tenantId: string;
    store: ClinicalCaseStore;
    clinicalCases: ClinicalCaseRecord[];
    inferenceEvents: ClinicalCaseHistoryInferenceEvent[];
    outcomeEvents: ClinicalCaseHistoryOutcomeEvent[];
    simulationEvents: ClinicalCaseHistorySimulationEvent[];
}): Promise<ClinicalCaseBackfillResult> {
    const now = new Date().toISOString();
    const inferenceByCase = groupByCase(input.inferenceEvents);
    const outcomeByCase = groupByCase(input.outcomeEvents);
    const simulationByCase = groupByCase(input.simulationEvents);

    const updatedCaseIds: string[] = [];
    const skippedCaseIds: string[] = [];
    let missingInferenceCount = 0;
    let conflictingInferenceHistoryCount = 0;
    let lowSignalDefaultCount = 0;
    let outcomeLabelCount = 0;
    let adversarialHistoryCount = 0;
    let calibrationReadyCount = 0;

    for (const clinicalCase of input.clinicalCases) {
        const originalFingerprint = fingerprintCase(clinicalCase);
        let current = clinicalCase;
        const caseInferenceHistory = sortDescending(inferenceByCase.get(clinicalCase.id) ?? []);
        const caseOutcomeHistory = sortDescending(outcomeByCase.get(clinicalCase.id) ?? [], 'outcome_timestamp');
        const caseSimulationHistory = sortDescending(simulationByCase.get(clinicalCase.id) ?? []);

        if (caseInferenceHistory.length === 0) {
            missingInferenceCount += 1;
        } else {
            const conflictingSignals = new Set(
                caseInferenceHistory
                    .map((event) => readInferenceConflictSignature(event.output_payload))
                    .filter(Boolean),
            );
            if (conflictingSignals.size > 1) {
                conflictingInferenceHistoryCount += 1;
            }

            const latestInference = caseInferenceHistory[0];
            const oldestInference = caseInferenceHistory[caseInferenceHistory.length - 1];
            current = await finalizeClinicalCaseAfterInference(
                input.store,
                current,
                latestInference.id,
                {
                    observedAt: latestInference.created_at,
                    firstObservedAt: oldestInference.created_at,
                    inferenceHistoryCount: caseInferenceHistory.length,
                    syncMode: 'backfill',
                    userId: latestInference.user_id,
                    sourceModule: latestInference.source_module ?? current.source_module ?? 'historical_backfill',
                    outputPayload: latestInference.output_payload,
                    confidenceScore: latestInference.confidence_score,
                    modelVersion: latestInference.model_version,
                    metadataPatch: {
                        latest_learning_backfill_at: now,
                        latest_learning_backfill_source: 'historical_inference_sync',
                    },
                },
            );
        }

        if (!caseInferenceHistory.length && needsLowSignalDefault(current)) {
            current = await applyClinicalCaseLearningSync(
                input.store,
                current,
                {
                    observedAt: now,
                    userId: current.user_id,
                    sourceModule: current.source_module ?? 'historical_backfill',
                    metadataPatch: {
                        latest_learning_backfill_at: now,
                        latest_learning_backfill_source: 'low_signal_default',
                    },
                },
                {},
                buildInferenceLearningPatch({
                    outputPayload: {},
                    sourceModule: current.source_module ?? 'historical_backfill',
                    symptomKeys: current.symptoms_normalized,
                    existing: {
                        primary_condition_class: current.primary_condition_class,
                        top_diagnosis: current.top_diagnosis,
                        predicted_diagnosis: current.predicted_diagnosis,
                        confirmed_diagnosis: current.confirmed_diagnosis,
                        label_type: current.label_type,
                        diagnosis_confidence: current.diagnosis_confidence,
                        severity_score: current.severity_score,
                        emergency_level: current.emergency_level,
                        triage_priority: current.triage_priority,
                        contradiction_score: current.contradiction_score,
                        contradiction_flags: current.contradiction_flags,
                        adversarial_case: current.adversarial_case,
                        adversarial_case_type: current.adversarial_case_type,
                        uncertainty_notes: current.uncertainty_notes,
                        case_cluster: current.case_cluster,
                        model_version: current.model_version,
                        telemetry_status: current.telemetry_status ?? current.ingestion_status,
                        calibration_status: current.calibration_status,
                        prediction_correct: current.prediction_correct,
                        confidence_error: current.confidence_error,
                        calibration_bucket: current.calibration_bucket,
                        degraded_confidence: current.degraded_confidence,
                        differential_spread: current.differential_spread,
                    },
                    preferIncoming: true,
                }),
            );
            lowSignalDefaultCount += 1;
        }

        if (caseOutcomeHistory.length > 0) {
            const latestOutcome = caseOutcomeHistory[0];
            current = await finalizeClinicalCaseAfterOutcome(
                input.store,
                current,
                latestOutcome.id,
                {
                    observedAt: latestOutcome.outcome_timestamp,
                    userId: latestOutcome.user_id,
                    sourceModule: latestOutcome.source_module ?? 'historical_backfill',
                    outcomePayload: latestOutcome.outcome_payload,
                    outcomeType: latestOutcome.outcome_type,
                    metadataPatch: {
                        latest_learning_backfill_at: now,
                        latest_learning_backfill_source: 'historical_outcome_sync',
                    },
                },
            );
            outcomeLabelCount += 1;
        }

        if (caseSimulationHistory.length > 0) {
            const latestSimulation = caseSimulationHistory[0];
            current = await finalizeClinicalCaseAfterSimulation(
                input.store,
                current,
                latestSimulation.id,
                {
                    observedAt: latestSimulation.created_at,
                    userId: latestSimulation.user_id,
                    sourceModule: latestSimulation.source_module ?? 'historical_backfill',
                    simulationType: latestSimulation.simulation_type,
                    stressMetrics: latestSimulation.stress_metrics,
                    metadataPatch: {
                        latest_learning_backfill_at: now,
                        latest_learning_backfill_source: 'historical_simulation_sync',
                    },
                },
            );
            adversarialHistoryCount += 1;
        }

        const normalizedSpecies = normalizeSpeciesValue(
            current.species_canonical ??
            current.species ??
            current.species_display ??
            current.species_raw ??
            caseInferenceHistory[0]?.input_signature?.species,
        );
        if (normalizedSpecies && normalizedSpecies !== current.species_canonical) {
            current = await input.store.updateById(current.tenant_id, current.id, {
                species: normalizedSpecies,
                species_canonical: normalizedSpecies,
                species_display: speciesDisplayFromCanonical(normalizedSpecies),
                species_raw: current.species_raw ?? readString(caseInferenceHistory[0]?.input_signature?.species),
            });
        }

        if (current.confirmed_diagnosis && current.predicted_diagnosis && current.prediction_correct !== null) {
            calibrationReadyCount += 1;
        }

        if (fingerprintCase(current) !== originalFingerprint) {
            updatedCaseIds.push(current.id);
        } else {
            skippedCaseIds.push(current.id);
        }
    }

    return {
        summary: {
            tenant_id: input.tenantId,
            cases_scanned: input.clinicalCases.length,
            cases_backfilled: updatedCaseIds.length,
            cases_missing_inference_events: missingInferenceCount,
            cases_with_conflicting_inference_history: conflictingInferenceHistoryCount,
            cases_with_low_signal_defaults: lowSignalDefaultCount,
            cases_with_outcome_labels: outcomeLabelCount,
            cases_with_adversarial_history: adversarialHistoryCount,
            cases_calibration_ready: calibrationReadyCount,
            generated_at: now,
        },
        updated_case_ids: updatedCaseIds,
        skipped_case_ids: skippedCaseIds,
    };
}

export async function backfillTenantClinicalCaseLearningState(
    client: SupabaseClient,
    tenantId: string,
): Promise<ClinicalCaseBackfillResult> {
    const caseStore = createSupabaseClinicalCaseStore(client);
    const caseColumns = CLINICAL_CASES.COLUMNS;
    const inferenceColumns = AI_INFERENCE_EVENTS.COLUMNS;
    const outcomeColumns = CLINICAL_OUTCOME_EVENTS.COLUMNS;
    const simulationColumns = EDGE_SIMULATION_EVENTS.COLUMNS;

    const [casesResult, inferenceResult, outcomeResult, simulationResult] = await Promise.all([
        client
            .from(CLINICAL_CASES.TABLE)
            .select('*')
            .eq(caseColumns.tenant_id, tenantId),
        client
            .from(AI_INFERENCE_EVENTS.TABLE)
            .select([
                inferenceColumns.id,
                inferenceColumns.tenant_id,
                inferenceColumns.user_id,
                inferenceColumns.case_id,
                inferenceColumns.source_module,
                inferenceColumns.model_version,
                inferenceColumns.input_signature,
                inferenceColumns.output_payload,
                inferenceColumns.confidence_score,
                inferenceColumns.created_at,
            ].join(', '))
            .eq(inferenceColumns.tenant_id, tenantId)
            .not(inferenceColumns.case_id, 'is', null),
        client
            .from(CLINICAL_OUTCOME_EVENTS.TABLE)
            .select([
                outcomeColumns.id,
                outcomeColumns.tenant_id,
                outcomeColumns.user_id,
                outcomeColumns.case_id,
                outcomeColumns.source_module,
                outcomeColumns.outcome_type,
                outcomeColumns.outcome_payload,
                outcomeColumns.outcome_timestamp,
                outcomeColumns.created_at,
            ].join(', '))
            .eq(outcomeColumns.tenant_id, tenantId)
            .not(outcomeColumns.case_id, 'is', null),
        client
            .from(EDGE_SIMULATION_EVENTS.TABLE)
            .select([
                simulationColumns.id,
                simulationColumns.tenant_id,
                simulationColumns.user_id,
                simulationColumns.case_id,
                simulationColumns.source_module,
                simulationColumns.simulation_type,
                simulationColumns.stress_metrics,
                simulationColumns.created_at,
            ].join(', '))
            .eq(simulationColumns.tenant_id, tenantId)
            .not(simulationColumns.case_id, 'is', null),
    ]);

    const firstError = [
        casesResult.error,
        inferenceResult.error,
        outcomeResult.error,
        simulationResult.error,
    ].find(Boolean);
    if (firstError) {
        throw new Error(`Failed to backfill clinical dataset learning state: ${firstError.message}`);
    }

    return backfillClinicalCaseLearningState({
        tenantId,
        store: caseStore,
        clinicalCases: (casesResult.data ?? []).map((row) => mapClinicalCaseRow(readObject(row))),
        inferenceEvents: mapInferenceEvents(inferenceResult.data ?? []),
        outcomeEvents: mapOutcomeEvents(outcomeResult.data ?? []),
        simulationEvents: mapSimulationEvents(simulationResult.data ?? []),
    });
}

function sortDescending<T extends { created_at: string }>(
    values: T[],
    timestampField: keyof T = 'created_at',
): T[] {
    return [...values].sort((left, right) =>
        String(right[timestampField]).localeCompare(String(left[timestampField])),
    );
}

function groupByCase<T extends { case_id: string | null }>(values: T[]): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const value of values) {
        if (!value.case_id) continue;
        const bucket = grouped.get(value.case_id) ?? [];
        bucket.push(value);
        grouped.set(value.case_id, bucket);
    }
    return grouped;
}

function readInferenceConflictSignature(outputPayload: Record<string, unknown>): string | null {
    const diagnosis = readObject(outputPayload.diagnosis);
    const topDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    const top = readObject(topDifferentials[0]);
    const diagnosisName = readString(top.name);
    const conditionClass = readString(diagnosis.primary_condition_class);
    return diagnosisName || conditionClass
        ? `${diagnosisName ?? 'unknown'}::${conditionClass ?? 'unknown'}`
        : null;
}

function needsLowSignalDefault(clinicalCase: ClinicalCaseRecord): boolean {
    return !clinicalCase.top_diagnosis &&
        !clinicalCase.primary_condition_class &&
        !clinicalCase.confirmed_diagnosis &&
        clinicalCase.ingestion_status === 'accepted' &&
        clinicalCase.invalid_case === false;
}

function speciesDisplayFromCanonical(value: string): string {
    if (value === 'Canis lupus familiaris') return 'Dog';
    if (value === 'Felis catus') return 'Cat';
    if (value === 'Equus ferus caballus') return 'Horse';
    if (value === 'Bos taurus') return 'Cow';
    return value;
}

function fingerprintCase(clinicalCase: ClinicalCaseRecord): string {
    return JSON.stringify({
        species_canonical: clinicalCase.species_canonical,
        top_diagnosis: clinicalCase.top_diagnosis,
        predicted_diagnosis: clinicalCase.predicted_diagnosis,
        confirmed_diagnosis: clinicalCase.confirmed_diagnosis,
        label_type: clinicalCase.label_type,
        severity_score: clinicalCase.severity_score,
        emergency_level: clinicalCase.emergency_level,
        contradiction_score: clinicalCase.contradiction_score,
        contradiction_flags: clinicalCase.contradiction_flags,
        adversarial_case: clinicalCase.adversarial_case,
        adversarial_case_type: clinicalCase.adversarial_case_type,
        model_version: clinicalCase.model_version,
        calibration_status: clinicalCase.calibration_status,
        prediction_correct: clinicalCase.prediction_correct,
        confidence_error: clinicalCase.confidence_error,
        calibration_bucket: clinicalCase.calibration_bucket,
        degraded_confidence: clinicalCase.degraded_confidence,
        latest_inference_event_id: clinicalCase.latest_inference_event_id,
        latest_outcome_event_id: clinicalCase.latest_outcome_event_id,
        latest_simulation_event_id: clinicalCase.latest_simulation_event_id,
    });
}

function mapInferenceEvents(rows: unknown[]): ClinicalCaseHistoryInferenceEvent[] {
    return rows.map((row) => {
        const record = readObject(row);
        return {
            id: String(record.id),
            tenant_id: String(record.tenant_id),
            user_id: readString(record.user_id),
            case_id: readString(record.case_id),
            source_module: readString(record.source_module),
            model_version: readString(record.model_version),
            input_signature: readObject(record.input_signature),
            output_payload: readObject(record.output_payload),
            confidence_score: readNumber(record.confidence_score),
            created_at: String(record.created_at),
        };
    });
}

function mapOutcomeEvents(rows: unknown[]): ClinicalCaseHistoryOutcomeEvent[] {
    return rows.map((row) => {
        const record = readObject(row);
        return {
            id: String(record.id),
            tenant_id: String(record.tenant_id),
            user_id: readString(record.user_id),
            case_id: readString(record.case_id),
            source_module: readString(record.source_module),
            outcome_type: readString(record.outcome_type) ?? 'outcome_learning',
            outcome_payload: readObject(record.outcome_payload),
            outcome_timestamp: String(record.outcome_timestamp ?? record.created_at),
            created_at: String(record.created_at),
        };
    });
}

function mapSimulationEvents(rows: unknown[]): ClinicalCaseHistorySimulationEvent[] {
    return rows.map((row) => {
        const record = readObject(row);
        return {
            id: String(record.id),
            tenant_id: String(record.tenant_id),
            user_id: readString(record.user_id),
            case_id: readString(record.case_id),
            source_module: readString(record.source_module),
            simulation_type: readString(record.simulation_type) ?? 'adversarial_simulation',
            stress_metrics: Object.keys(readObject(record.stress_metrics)).length > 0
                ? readObject(record.stress_metrics)
                : null,
            created_at: String(record.created_at),
        };
    });
}

function readObject(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
