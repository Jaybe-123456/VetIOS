import type { SupabaseClient } from '@supabase/supabase-js';
import {
    AI_INFERENCE_EVENTS,
    CLINICAL_CASES,
    CLINICAL_CASE_LIVE_VIEW,
} from '@/lib/db/schemaContracts';
import { logClinicalDatasetRead } from '@/lib/dataset/clinicalDatasetDiagnostics';

export type DatasetExportMode =
    | 'clean_labeled_cases'
    | 'severity_training_set'
    | 'adversarial_benchmark_set'
    | 'calibration_audit_set'
    | 'quarantined_invalid_cases';

export interface ClinicalCaseLiveRecord {
    case_id: string;
    tenant_id: string;
    user_id: string | null;
    species: string | null;
    breed: string | null;
    symptoms_summary: string | null;
    symptom_vector_normalized: Record<string, boolean>;
    primary_condition_class: string | null;
    top_diagnosis: string | null;
    predicted_diagnosis: string | null;
    confirmed_diagnosis: string | null;
    label_type: string | null;
    diagnosis_confidence: number | null;
    severity_score: number | null;
    latest_emergency_level: string | null;
    triage_priority: string | null;
    contradiction_score: number | null;
    contradiction_flags: string[];
    uncertainty_notes: string[];
    case_cluster: string | null;
    model_version: string | null;
    telemetry_status: string | null;
    calibration_status: string | null;
    prediction_correct: boolean | null;
    confidence_error: number | null;
    calibration_bucket: string | null;
    degraded_confidence: number | null;
    differential_spread: Record<string, unknown> | null;
    ingestion_status: string;
    invalid_case: boolean;
    validation_error_code: string | null;
    adversarial_case: boolean;
    adversarial_case_type: string | null;
    latest_inference_event_id: string | null;
    latest_outcome_event_id: string | null;
    latest_simulation_event_id: string | null;
    latest_confidence: number | null;
    source_module: string | null;
    updated_at: string;
}

export interface DatasetInferenceEventRecord {
    id: string;
    tenant_id: string;
    user_id: string | null;
    case_id: string | null;
    source_module: string | null;
    model_version: string;
    confidence_score: number | null;
    output_payload: Record<string, unknown>;
    created_at: string;
}

export interface ClinicalCaseDatasetRow extends ClinicalCaseLiveRecord {
    timestamp: string;
}

export interface DatasetInferenceEventView {
    event_id: string;
    case_id: string | null;
    top_prediction: string | null;
    primary_condition_class: string | null;
    confidence: number | null;
    emergency_level: string | null;
    contradiction_score: number | null;
    model_version: string;
    timestamp: string;
}

export interface TenantClinicalDatasetSummary {
    live_count: number;
    quarantined_count: number;
    unlabeled_count: number;
    label_coverage_count: number;
    adversarial_count: number;
    severity_coverage_count: number;
    contradiction_coverage_count: number;
    calibration_ready_count: number;
    label_coverage_pct: number;
    severity_coverage_pct: number;
    contradiction_coverage_pct: number;
    adversarial_coverage_pct: number;
    invalid_quarantined_pct: number;
    calibration_readiness_pct: number;
}

export interface TenantClinicalDataset {
    clinicalCases: ClinicalCaseDatasetRow[];
    quarantinedCases: ClinicalCaseDatasetRow[];
    inferenceEvents: DatasetInferenceEventView[];
    summary: TenantClinicalDatasetSummary;
    refreshedAt: string;
}

export interface ClinicalDatasetStore {
    listClinicalCases(tenantId: string, limit: number): Promise<ClinicalCaseLiveRecord[]>;
    listQuarantinedCases(tenantId: string, limit: number): Promise<ClinicalCaseLiveRecord[]>;
    listInferenceEvents(tenantId: string, limit: number): Promise<DatasetInferenceEventRecord[]>;
}

export interface TenantClinicalDatasetOptions {
    authenticatedUserId?: string | null;
    source?: string;
}

export async function getTenantClinicalDataset(
    store: ClinicalDatasetStore,
    tenantId: string,
    limit = 50,
    options: TenantClinicalDatasetOptions = {},
): Promise<TenantClinicalDataset> {
    const [clinicalCases, quarantinedCases, inferenceEvents] = await Promise.all([
        store.listClinicalCases(tenantId, limit),
        store.listQuarantinedCases(tenantId, limit),
        store.listInferenceEvents(tenantId, limit),
    ]);

    logClinicalDatasetRead({
        source: options.source ?? 'dataset_manager',
        authenticatedUserId: options.authenticatedUserId ?? null,
        resolvedTenantId: tenantId,
        datasetQueryTenantId: tenantId,
        rowCount: clinicalCases.length,
        inferenceRowCount: inferenceEvents.length,
        quarantinedRowCount: quarantinedCases.length,
    });

    const liveRows = clinicalCases.map(mapCaseRecordToDatasetRow);
    const quarantinedRows = quarantinedCases.map(mapCaseRecordToDatasetRow);
    const inferenceRows = inferenceEvents.map(mapInferenceEventToDatasetRow);

    return {
        clinicalCases: liveRows,
        quarantinedCases: quarantinedRows,
        inferenceEvents: inferenceRows,
        summary: buildDatasetSummary(liveRows, quarantinedRows),
        refreshedAt: new Date().toISOString(),
    };
}

export function buildClinicalDatasetExport(dataset: TenantClinicalDataset, mode: DatasetExportMode): Array<Record<string, unknown>> {
    switch (mode) {
        case 'clean_labeled_cases':
            return dataset.clinicalCases
                .filter((row) => row.label_type !== 'inferred_only' || Boolean(row.confirmed_diagnosis))
                .map(serializeCaseForExport);
        case 'severity_training_set':
            return dataset.clinicalCases
                .filter((row) => row.severity_score !== null && Boolean(row.latest_emergency_level))
                .map(serializeCaseForExport);
        case 'adversarial_benchmark_set':
            return dataset.clinicalCases
                .filter((row) => row.adversarial_case)
                .map(serializeCaseForExport);
        case 'calibration_audit_set':
            return dataset.clinicalCases
                .filter((row) => row.diagnosis_confidence !== null && Boolean(row.predicted_diagnosis) && Boolean(row.confirmed_diagnosis))
                .map(serializeCaseForExport);
        case 'quarantined_invalid_cases':
            return dataset.quarantinedCases.map(serializeCaseForExport);
        default:
            return dataset.clinicalCases.map(serializeCaseForExport);
    }
}

export function createSupabaseClinicalDatasetStore(client: SupabaseClient): ClinicalDatasetStore {
    const liveCaseColumns = CLINICAL_CASE_LIVE_VIEW.COLUMNS;
    const caseColumns = CLINICAL_CASES.COLUMNS;
    const inferenceColumns = AI_INFERENCE_EVENTS.COLUMNS;

    return {
        async listClinicalCases(tenantId, limit) {
            const { data, error } = await client
                .from(CLINICAL_CASE_LIVE_VIEW.TABLE)
                .select([
                    liveCaseColumns.case_id,
                    liveCaseColumns.tenant_id,
                    liveCaseColumns.user_id,
                    liveCaseColumns.species,
                    liveCaseColumns.breed,
                    liveCaseColumns.symptoms_summary,
                    liveCaseColumns.symptom_vector_normalized,
                    liveCaseColumns.primary_condition_class,
                    liveCaseColumns.top_diagnosis,
                    liveCaseColumns.predicted_diagnosis,
                    liveCaseColumns.confirmed_diagnosis,
                    liveCaseColumns.label_type,
                    liveCaseColumns.diagnosis_confidence,
                    liveCaseColumns.severity_score,
                    liveCaseColumns.latest_emergency_level,
                    liveCaseColumns.triage_priority,
                    liveCaseColumns.contradiction_score,
                    liveCaseColumns.contradiction_flags,
                    liveCaseColumns.uncertainty_notes,
                    liveCaseColumns.case_cluster,
                    liveCaseColumns.model_version,
                    liveCaseColumns.telemetry_status,
                    liveCaseColumns.calibration_status,
                    liveCaseColumns.prediction_correct,
                    liveCaseColumns.confidence_error,
                    liveCaseColumns.calibration_bucket,
                    liveCaseColumns.degraded_confidence,
                    liveCaseColumns.differential_spread,
                    liveCaseColumns.ingestion_status,
                    liveCaseColumns.invalid_case,
                    liveCaseColumns.validation_error_code,
                    liveCaseColumns.adversarial_case,
                    liveCaseColumns.adversarial_case_type,
                    liveCaseColumns.latest_inference_event_id,
                    liveCaseColumns.latest_outcome_event_id,
                    liveCaseColumns.latest_simulation_event_id,
                    liveCaseColumns.latest_confidence,
                    liveCaseColumns.source_module,
                    liveCaseColumns.updated_at,
                ].join(', '))
                .eq(liveCaseColumns.tenant_id, tenantId)
                .order(liveCaseColumns.updated_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to query clinical case live view: ${error.message}`);
            }

            const rows = (data ?? []) as unknown[];
            return rows.map((row) => mapClinicalCaseRecord(asRecord(row)));
        },
        async listQuarantinedCases(tenantId, limit) {
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .select([
                    caseColumns.id,
                    caseColumns.tenant_id,
                    caseColumns.user_id,
                    caseColumns.species_canonical,
                    caseColumns.breed,
                    caseColumns.symptom_summary,
                    caseColumns.symptom_vector_normalized,
                    caseColumns.primary_condition_class,
                    caseColumns.top_diagnosis,
                    caseColumns.predicted_diagnosis,
                    caseColumns.confirmed_diagnosis,
                    caseColumns.label_type,
                    caseColumns.diagnosis_confidence,
                    caseColumns.severity_score,
                    caseColumns.emergency_level,
                    caseColumns.triage_priority,
                    caseColumns.contradiction_score,
                    caseColumns.contradiction_flags,
                    caseColumns.uncertainty_notes,
                    caseColumns.case_cluster,
                    caseColumns.model_version,
                    caseColumns.telemetry_status,
                    caseColumns.calibration_status,
                    caseColumns.prediction_correct,
                    caseColumns.confidence_error,
                    caseColumns.calibration_bucket,
                    caseColumns.degraded_confidence,
                    caseColumns.differential_spread,
                    caseColumns.ingestion_status,
                    caseColumns.invalid_case,
                    caseColumns.validation_error_code,
                    caseColumns.adversarial_case,
                    caseColumns.adversarial_case_type,
                    caseColumns.latest_inference_event_id,
                    caseColumns.latest_outcome_event_id,
                    caseColumns.latest_simulation_event_id,
                    caseColumns.source_module,
                    caseColumns.updated_at,
                ].join(', '))
                .eq(caseColumns.tenant_id, tenantId)
                .or(`${caseColumns.invalid_case}.eq.true,${caseColumns.ingestion_status}.eq.quarantined,${caseColumns.ingestion_status}.eq.rejected`)
                .order(caseColumns.updated_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to query quarantined clinical cases: ${error.message}`);
            }

            const rows = (data ?? []) as unknown[];
            return rows.map((row) => mapClinicalCaseRecord(asRecord(row), true));
        },
        async listInferenceEvents(tenantId, limit) {
            const { data, error } = await client
                .from(AI_INFERENCE_EVENTS.TABLE)
                .select([
                    inferenceColumns.id,
                    inferenceColumns.tenant_id,
                    inferenceColumns.user_id,
                    inferenceColumns.case_id,
                    inferenceColumns.source_module,
                    inferenceColumns.model_version,
                    inferenceColumns.confidence_score,
                    inferenceColumns.output_payload,
                    inferenceColumns.created_at,
                ].join(', '))
                .eq(inferenceColumns.tenant_id, tenantId)
                .order(inferenceColumns.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to query inference events for dataset manager: ${error.message}`);
            }

            const rows = (data ?? []) as unknown[];
            return rows.map((row) => {
                const record = asRecord(row);
                return {
                    id: String(record.id),
                    tenant_id: String(record.tenant_id),
                    user_id: typeof record.user_id === 'string' ? record.user_id : null,
                    case_id: typeof record.case_id === 'string' ? record.case_id : null,
                    source_module: typeof record.source_module === 'string' ? record.source_module : null,
                    model_version: String(record.model_version),
                    confidence_score: typeof record.confidence_score === 'number' ? record.confidence_score : null,
                    output_payload: isRecord(record.output_payload) ? record.output_payload : {},
                    created_at: String(record.created_at),
                };
            });
        },
    };
}

function mapCaseRecordToDatasetRow(row: ClinicalCaseLiveRecord): ClinicalCaseDatasetRow {
    const topDiagnosis = row.top_diagnosis;
    const predictedDiagnosis = row.predicted_diagnosis ?? topDiagnosis;
    const confirmedDiagnosis = row.confirmed_diagnosis;

    return {
        ...row,
        primary_condition_class: resolveConditionClassForDisplay(
            row.primary_condition_class,
            topDiagnosis,
            predictedDiagnosis,
            confirmedDiagnosis,
        ),
        diagnosis_confidence: readNumber(row.diagnosis_confidence),
        severity_score: readNumber(row.severity_score),
        contradiction_score: normalizeProbability(readNumber(row.contradiction_score)),
        confidence_error: readNumber(row.confidence_error),
        degraded_confidence: readNumber(row.degraded_confidence),
        latest_confidence: readNumber(row.latest_confidence),
        timestamp: formatDatasetTimestamp(row.updated_at),
    };
}

function mapInferenceEventToDatasetRow(row: DatasetInferenceEventRecord): DatasetInferenceEventView {
    const diagnosis = readObject(row.output_payload.diagnosis);
    const riskAssessment = readObject(row.output_payload.risk_assessment);
    const topPrediction = readTopPrediction(row.output_payload);
    const adversarialCase = isAdversarialInference(row);

    return {
        event_id: row.id,
        case_id: row.case_id,
        top_prediction: topPrediction,
        primary_condition_class: resolveInferenceConditionClass(row.output_payload, diagnosis, topPrediction),
        confidence: row.confidence_score,
        emergency_level:
            readString(riskAssessment.emergency_level) ??
            readString(row.output_payload.emergency_level),
        contradiction_score: resolveInferenceContradictionScore(row.output_payload, adversarialCase),
        model_version: row.model_version,
        timestamp: formatDatasetTimestamp(row.created_at),
    };
}

function serializeCaseForExport(row: ClinicalCaseDatasetRow): Record<string, unknown> {
    return {
        case_id: row.case_id,
        tenant_id: row.tenant_id,
        species: row.species,
        breed: row.breed,
        symptoms_summary: row.symptoms_summary,
        symptom_vector_normalized: row.symptom_vector_normalized,
        top_diagnosis: row.top_diagnosis,
        predicted_diagnosis: row.predicted_diagnosis,
        confirmed_diagnosis: row.confirmed_diagnosis,
        primary_condition_class: row.primary_condition_class,
        label_type: row.label_type,
        diagnosis_confidence: row.diagnosis_confidence,
        severity_score: row.severity_score,
        emergency_level: row.latest_emergency_level,
        triage_priority: row.triage_priority,
        contradiction_score: row.contradiction_score,
        contradiction_flags: row.contradiction_flags,
        uncertainty_notes: row.uncertainty_notes,
        adversarial_case: row.adversarial_case,
        adversarial_case_type: row.adversarial_case_type,
        case_cluster: row.case_cluster,
        calibration_status: row.calibration_status,
        prediction_correct: row.prediction_correct,
        confidence_error: row.confidence_error,
        calibration_bucket: row.calibration_bucket,
        degraded_confidence: row.degraded_confidence,
        differential_spread: row.differential_spread,
        ingestion_status: row.ingestion_status,
        invalid_case: row.invalid_case,
        validation_error_code: row.validation_error_code,
        latest_inference_event_id: row.latest_inference_event_id,
        latest_outcome_event_id: row.latest_outcome_event_id,
        latest_simulation_event_id: row.latest_simulation_event_id,
        model_version: row.model_version,
        telemetry_status: row.telemetry_status,
        source_module: row.source_module,
        updated_at: row.updated_at,
    };
}

function mapClinicalCaseRecord(row: Record<string, unknown>, forceQuarantined = false): ClinicalCaseLiveRecord {
    const topDiagnosis = readString(row.top_diagnosis);
    const predictedDiagnosis = readString(row.predicted_diagnosis) ?? topDiagnosis;
    const confirmedDiagnosis = readString(row.confirmed_diagnosis);

    return {
        case_id: String(row.case_id ?? row.id),
        tenant_id: String(row.tenant_id),
        user_id: readString(row.user_id),
        species: readString(row.species) ?? readString(row.species_display) ?? readString(row.species_canonical),
        breed: readString(row.breed),
        symptoms_summary: readString(row.symptoms_summary) ?? readString(row.symptom_summary),
        symptom_vector_normalized: isRecord(row.symptom_vector_normalized)
            ? booleanRecord(row.symptom_vector_normalized)
            : {},
        primary_condition_class: resolveStoredConditionClass(row, topDiagnosis, predictedDiagnosis, confirmedDiagnosis),
        top_diagnosis: topDiagnosis,
        predicted_diagnosis: predictedDiagnosis,
        confirmed_diagnosis: confirmedDiagnosis,
        label_type: readString(row.label_type),
        diagnosis_confidence: readNumber(row.diagnosis_confidence) ?? readNumber(row.latest_confidence),
        severity_score: readNumber(row.severity_score),
        latest_emergency_level: readString(row.latest_emergency_level) ?? readString(row.emergency_level),
        triage_priority: readString(row.triage_priority),
        contradiction_score: normalizeProbability(readNumber(row.contradiction_score)),
        contradiction_flags: readStringArray(row.contradiction_flags),
        uncertainty_notes: readStringArray(row.uncertainty_notes),
        case_cluster: readString(row.case_cluster),
        model_version: readString(row.model_version),
        telemetry_status: readString(row.telemetry_status),
        calibration_status: readString(row.calibration_status),
        prediction_correct: typeof row.prediction_correct === 'boolean' ? row.prediction_correct : null,
        confidence_error: readNumber(row.confidence_error),
        calibration_bucket: readString(row.calibration_bucket),
        degraded_confidence: readNumber(row.degraded_confidence),
        differential_spread: isRecord(row.differential_spread) ? row.differential_spread : null,
        ingestion_status: forceQuarantined ? (readString(row.ingestion_status) ?? 'quarantined') : (readString(row.ingestion_status) ?? 'accepted'),
        invalid_case: forceQuarantined ? true : row.invalid_case === true,
        validation_error_code: readString(row.validation_error_code),
        adversarial_case: row.adversarial_case === true,
        adversarial_case_type: readString(row.adversarial_case_type),
        latest_inference_event_id: readString(row.latest_inference_event_id),
        latest_outcome_event_id: readString(row.latest_outcome_event_id),
        latest_simulation_event_id: readString(row.latest_simulation_event_id),
        latest_confidence: readNumber(row.latest_confidence) ?? readNumber(row.diagnosis_confidence),
        source_module: readString(row.source_module),
        updated_at: String(row.updated_at),
    };
}

function readTopPrediction(outputPayload: Record<string, unknown>): string | null {
    const diagnosis = readObject(outputPayload.diagnosis);
    const topDifferentials = diagnosis.top_differentials;
    if (Array.isArray(topDifferentials) && topDifferentials.length > 0) {
        const top = topDifferentials[0];
        if (isRecord(top)) {
            return readString(top.name) ??
                readString(top.diagnosis) ??
                readString(top.condition) ??
                readString(top.label);
        }
    }

    return readString(diagnosis.top_diagnosis) ??
        readString(diagnosis.predicted_diagnosis) ??
        readString(diagnosis.primary_diagnosis) ??
        readString(outputPayload.top_diagnosis) ??
        readString(outputPayload.predicted_diagnosis);
}

function resolveStoredConditionClass(
    row: Record<string, unknown>,
    topDiagnosis: string | null,
    predictedDiagnosis: string | null,
    confirmedDiagnosis: string | null,
): string | null {
    return resolveConditionClassForDisplay(
        readString(row.primary_condition_class),
        topDiagnosis,
        predictedDiagnosis,
        confirmedDiagnosis,
    );
}

function resolveConditionClassForDisplay(
    explicitClassRaw: string | null,
    topDiagnosis: string | null,
    predictedDiagnosis: string | null,
    confirmedDiagnosis: string | null,
): string | null {
    const explicitClass = normalizeConditionClass(explicitClassRaw);
    if (explicitClass && explicitClass !== 'Undifferentiated') {
        return explicitClass;
    }

    return inferConditionClassFromDiagnosis(
        confirmedDiagnosis ??
        predictedDiagnosis ??
        topDiagnosis,
    ) ?? explicitClass;
}

function resolveInferenceConditionClass(
    outputPayload: Record<string, unknown>,
    diagnosis: Record<string, unknown>,
    topPrediction: string | null,
): string | null {
    const explicitClass = normalizeConditionClass(
        readString(diagnosis.primary_condition_class) ??
        readString(diagnosis.condition_class) ??
        readHighestProbabilityConditionClass(readObject(diagnosis.condition_class_probabilities)) ??
        readString(outputPayload.primary_condition_class) ??
        readString(outputPayload.condition_class) ??
        readHighestProbabilityConditionClass(readObject(outputPayload.condition_class_probabilities)),
    );

    if (explicitClass && explicitClass !== 'Undifferentiated') {
        return explicitClass;
    }

    return inferConditionClassFromDiagnosis(topPrediction) ?? explicitClass;
}

function resolveInferenceContradictionScore(
    outputPayload: Record<string, unknown>,
    adversarialCase: boolean,
): number | null {
    const contradictionAnalysis = readObject(outputPayload.contradiction_analysis);
    const telemetry = readObject(outputPayload.telemetry);
    const explicitScore = normalizeProbability(readNumber(
        outputPayload.contradiction_score ??
        contradictionAnalysis.contradiction_score ??
        telemetry.contradiction_score,
    ));

    if (explicitScore !== null) {
        return explicitScore;
    }

    const contradictionReasons = [
        ...readStringArray(outputPayload.contradiction_flags),
        ...readStringArray(outputPayload.contradiction_reasons),
        ...readStringArray(contradictionAnalysis.contradiction_reasons),
    ];

    if (contradictionReasons.length > 0) {
        return adversarialCase ? 0.55 : 0.35;
    }

    if (adversarialCase) {
        return 0.25;
    }

    return null;
}

function isAdversarialInference(row: DatasetInferenceEventRecord): boolean {
    if (row.source_module === 'adversarial_simulation') {
        return true;
    }

    return row.output_payload.adversarial_case === true ||
        readString(row.output_payload.adversarial_case_type) !== null ||
        readString(row.output_payload.simulation_type) !== null ||
        Object.keys(readObject(row.output_payload.stress_metrics)).length > 0;
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
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.replace(/\s+/g, ' ').trim())
            .filter(Boolean),
    ));
}

function formatDatasetTimestamp(value: string): string {
    if (!value) return 'Unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function buildDatasetSummary(
    liveRows: ClinicalCaseDatasetRow[],
    quarantinedRows: ClinicalCaseDatasetRow[],
): TenantClinicalDatasetSummary {
    const totalRows = liveRows.length + quarantinedRows.length;
    const labelCoverageCount = liveRows.filter((row) => hasLabelCoverage(row)).length;
    const severityCoverageCount = liveRows.filter((row) => hasSeverityCoverage(row)).length;
    const contradictionCoverageCount = [...liveRows, ...quarantinedRows].filter((row) => hasContradictionCoverage(row)).length;
    const adversarialCount = [...liveRows, ...quarantinedRows].filter((row) => hasAdversarialCoverage(row)).length;
    const calibrationReadyCount = liveRows.filter((row) => hasCalibrationCoverage(row)).length;

    return {
        live_count: liveRows.length,
        quarantined_count: quarantinedRows.length,
        unlabeled_count: liveRows.filter((row) => row.label_type === 'inferred_only' && !row.confirmed_diagnosis).length,
        label_coverage_count: labelCoverageCount,
        adversarial_count: adversarialCount,
        severity_coverage_count: severityCoverageCount,
        contradiction_coverage_count: contradictionCoverageCount,
        calibration_ready_count: calibrationReadyCount,
        label_coverage_pct: percentage(labelCoverageCount, liveRows.length),
        severity_coverage_pct: percentage(severityCoverageCount, liveRows.length),
        contradiction_coverage_pct: percentage(contradictionCoverageCount, totalRows),
        adversarial_coverage_pct: percentage(adversarialCount, totalRows),
        invalid_quarantined_pct: percentage(quarantinedRows.length, totalRows),
        calibration_readiness_pct: percentage(calibrationReadyCount, liveRows.length),
    };
}

function normalizeConditionClass(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    if (normalized.toLowerCase() === 'idiopathic / unknown' || normalized.toLowerCase() === 'idiopathic' || normalized.toLowerCase() === 'unknown') {
        return 'Undifferentiated';
    }
    return normalized;
}

function readHighestProbabilityConditionClass(probabilities: Record<string, unknown>): string | null {
    let bestClass: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const [candidate, rawScore] of Object.entries(probabilities)) {
        const score = readNumber(rawScore);
        if (score === null || score <= bestScore) {
            continue;
        }
        bestClass = candidate;
        bestScore = score;
    }

    return normalizeConditionClass(readString(bestClass));
}

function inferConditionClassFromDiagnosis(value: string | null): string | null {
    const normalized = (value ?? '').toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('gdv') || normalized.includes('dilatation') || normalized.includes('volvulus') || normalized.includes('obstruction') || normalized.includes('tracheal collapse')) {
        return 'Mechanical';
    }
    if (
        normalized.includes('parvo') ||
        normalized.includes('distemper') ||
        normalized.includes('infect') ||
        normalized.includes('tracheobronchitis') ||
        normalized.includes('kennel cough') ||
        normalized.includes('rhinotracheitis') ||
        normalized.includes('herpesvirus') ||
        normalized.includes('fhv') ||
        normalized.includes('upper respiratory') ||
        normalized.includes('respiratory infection') ||
        normalized.includes('viral infection')
    ) {
        return 'Infectious';
    }
    if (normalized.includes('bronchitis')) {
        return 'Inflammatory';
    }
    if (normalized.includes('toxic')) {
        return 'Toxicology';
    }
    if (normalized.includes('pancreatitis')) {
        return 'Inflammatory';
    }
    if (normalized.includes('unknown') || normalized.includes('undifferentiated')) {
        return 'Undifferentiated';
    }
    return null;
}

function hasLabelCoverage(row: ClinicalCaseDatasetRow): boolean {
    return Boolean(row.confirmed_diagnosis) || row.label_type !== 'inferred_only';
}

function hasSeverityCoverage(row: ClinicalCaseDatasetRow): boolean {
    return row.severity_score !== null && Boolean(row.latest_emergency_level);
}

function hasContradictionCoverage(row: ClinicalCaseDatasetRow): boolean {
    return row.contradiction_score !== null || row.contradiction_flags.length > 0 || row.adversarial_case;
}

function hasAdversarialCoverage(row: ClinicalCaseDatasetRow): boolean {
    return row.adversarial_case ||
        Boolean(row.adversarial_case_type) ||
        Boolean(row.latest_simulation_event_id) ||
        row.source_module === 'adversarial_simulation';
}

function hasCalibrationCoverage(row: ClinicalCaseDatasetRow): boolean {
    return Boolean(row.predicted_diagnosis) &&
        Boolean(row.confirmed_diagnosis) &&
        row.prediction_correct !== null &&
        row.confidence_error !== null;
}

function percentage(value: number, total: number): number {
    if (total <= 0) return 0;
    return Number(((value / total) * 100).toFixed(1));
}

function normalizeProbability(value: number | null): number | null {
    if (value === null) return null;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function booleanRecord(value: Record<string, unknown>): Record<string, boolean> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry === true),
    ) as Record<string, boolean>;
}
