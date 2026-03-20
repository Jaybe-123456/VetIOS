import { isPlaceholderValue } from '@/lib/clinicalCases/symptomOntology';

export type ClinicalCaseIngestionStatus = 'accepted' | 'rejected' | 'quarantined';
export type ClinicalCaseLabelType = 'inferred_only' | 'synthetic' | 'expert_reviewed' | 'lab_confirmed';
export type ClinicalEmergencyLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
export type ClinicalTriagePriority = 'immediate' | 'urgent' | 'standard' | 'low';
export type ClinicalCalibrationStatus =
    | 'pending_outcome'
    | 'calibrated_match'
    | 'calibrated_mismatch'
    | 'no_prediction_anchor';

export interface ClinicalCaseValidationResult {
    ingestion_status: ClinicalCaseIngestionStatus;
    invalid_case: boolean;
    validation_error_code: string | null;
}

export interface ClinicalLearningPatch {
    primary_condition_class: string | null;
    top_diagnosis: string | null;
    predicted_diagnosis: string | null;
    confirmed_diagnosis: string | null;
    label_type: ClinicalCaseLabelType;
    diagnosis_confidence: number | null;
    severity_score: number | null;
    emergency_level: ClinicalEmergencyLevel | null;
    triage_priority: ClinicalTriagePriority | null;
    contradiction_score: number | null;
    contradiction_flags: string[];
    adversarial_case: boolean;
    adversarial_case_type: string | null;
    uncertainty_notes: string[];
    case_cluster: string | null;
    model_version: string | null;
    telemetry_status: string;
    calibration_status: ClinicalCalibrationStatus | null;
    prediction_correct: boolean | null;
    confidence_error: number | null;
    calibration_bucket: string | null;
    degraded_confidence: number | null;
    differential_spread: Record<string, unknown> | null;
}

export interface InferenceLearningInput {
    outputPayload: Record<string, unknown>;
    confidenceScore?: number | null;
    modelVersion?: string | null;
    sourceModule?: string | null;
    symptomKeys?: string[];
    preferIncoming?: boolean;
    existing?: Pick<
        ClinicalLearningPatch,
        | 'primary_condition_class'
        | 'top_diagnosis'
        | 'predicted_diagnosis'
        | 'confirmed_diagnosis'
        | 'label_type'
        | 'diagnosis_confidence'
        | 'severity_score'
        | 'emergency_level'
        | 'triage_priority'
        | 'contradiction_score'
        | 'contradiction_flags'
        | 'adversarial_case'
        | 'adversarial_case_type'
        | 'uncertainty_notes'
        | 'case_cluster'
        | 'model_version'
        | 'telemetry_status'
        | 'calibration_status'
        | 'prediction_correct'
        | 'confidence_error'
        | 'calibration_bucket'
        | 'degraded_confidence'
        | 'differential_spread'
    >;
}

export interface OutcomeLearningInput {
    outcomePayload: Record<string, unknown>;
    outcomeType: string;
    existing: Pick<
        ClinicalLearningPatch,
        | 'top_diagnosis'
        | 'predicted_diagnosis'
        | 'primary_condition_class'
        | 'confirmed_diagnosis'
        | 'label_type'
        | 'diagnosis_confidence'
        | 'severity_score'
        | 'emergency_level'
        | 'contradiction_score'
        | 'contradiction_flags'
        | 'uncertainty_notes'
        | 'case_cluster'
        | 'model_version'
        | 'telemetry_status'
        | 'adversarial_case'
        | 'adversarial_case_type'
        | 'calibration_status'
        | 'prediction_correct'
        | 'confidence_error'
        | 'calibration_bucket'
        | 'degraded_confidence'
        | 'differential_spread'
    >;
}

export interface SimulationLearningInput {
    simulationType: string;
    stressMetrics?: Record<string, unknown> | null;
    existing: Pick<
        ClinicalLearningPatch,
        | 'top_diagnosis'
        | 'predicted_diagnosis'
        | 'primary_condition_class'
        | 'confirmed_diagnosis'
        | 'label_type'
        | 'diagnosis_confidence'
        | 'severity_score'
        | 'emergency_level'
        | 'triage_priority'
        | 'contradiction_score'
        | 'contradiction_flags'
        | 'uncertainty_notes'
        | 'case_cluster'
        | 'model_version'
        | 'telemetry_status'
        | 'calibration_status'
        | 'prediction_correct'
        | 'confidence_error'
        | 'calibration_bucket'
        | 'degraded_confidence'
        | 'differential_spread'
    >;
}

const SPECIES_PLACEHOLDERS = new Set([
    'unknown',
    'unresolved',
    '-',
]);

const UNKNOWN_CONDITION_CLASS_LABELS = new Set([
    'idiopathic / unknown',
    'idiopathic',
    'unknown',
    'unknown / mixed',
    'mixed',
    'nonspecific',
    'non-specific',
]);

export function validateClinicalCaseDraft(input: {
    speciesCanonical: string | null;
    speciesRaw: string | null;
    symptomsRaw: string | null;
    symptomKeys: string[];
    unresolvedSymptoms?: string[];
}): ClinicalCaseValidationResult {
    const speciesMissing = isMissingSpecies(input.speciesCanonical, input.speciesRaw);
    const symptomsMissing = !hasMeaningfulSymptoms(input.symptomsRaw, input.symptomKeys, input.unresolvedSymptoms ?? []);

    if (speciesMissing && symptomsMissing) {
        return {
            ingestion_status: 'rejected',
            invalid_case: true,
            validation_error_code: 'MISSING_SPECIES_AND_SYMPTOMS',
        };
    }

    if (speciesMissing) {
        return {
            ingestion_status: 'quarantined',
            invalid_case: true,
            validation_error_code: 'MISSING_SPECIES',
        };
    }

    if (symptomsMissing) {
        return {
            ingestion_status: 'quarantined',
            invalid_case: true,
            validation_error_code: 'MISSING_SYMPTOMS',
        };
    }

    return {
        ingestion_status: 'accepted',
        invalid_case: false,
        validation_error_code: null,
    };
}

export function buildInferenceLearningPatch(input: InferenceLearningInput): ClinicalLearningPatch {
    const diagnosis = readObject(input.outputPayload.diagnosis);
    const riskAssessment = readObject(input.outputPayload.risk_assessment);
    const contradiction = readObject(input.outputPayload.contradiction_analysis);
    const telemetry = readObject(input.outputPayload.telemetry);
    const topDifferential = readTopDifferential(diagnosis.top_differentials ?? input.outputPayload.top_differentials);
    const existing = input.existing ?? null;
    const preferIncoming = input.preferIncoming ?? true;

    const parsedTopDiagnosis = extractTopDiagnosis(input.outputPayload, diagnosis, topDifferential);
    const parsedConditionClass = normalizeConditionClass(
        readText(diagnosis.primary_condition_class) ??
        readText(diagnosis.condition_class) ??
        readText(input.outputPayload.primary_condition_class) ??
        readText(input.outputPayload.condition_class) ??
        inferConditionClassFromDiagnosis(parsedTopDiagnosis),
    );
    const incomingSeverityScore =
        readNumber(riskAssessment.severity_score ?? input.outputPayload.severity_score);
    const incomingEmergencyLevel = normalizeEmergencyLevel(
        readText(riskAssessment.emergency_level) ??
        readText(input.outputPayload.emergency_level),
    );
    let emergencyLevel =
        incomingEmergencyLevel ??
        deriveEmergencyLevelFromSeverity(incomingSeverityScore) ??
        existing?.emergency_level ??
        null;
    let severityScore =
        incomingSeverityScore ??
        deriveSeverityScoreFromEmergencyLevel(emergencyLevel) ??
        existing?.severity_score ??
        null;
    const contradictionFlags = mergeStringArrays(
        existing?.contradiction_flags ?? [],
        mergeStringArrays(
            readStringArray(input.outputPayload.contradiction_flags),
            mergeStringArrays(
                readStringArray(input.outputPayload.contradiction_reasons),
                readStringArray(contradiction.contradiction_reasons),
            ),
        ),
    );
    const uncertaintyNotes = mergeStringArrays(
        existing?.uncertainty_notes ?? [],
        readStringArray(input.outputPayload.uncertainty_notes),
    );
    const contradictionScore = readNumber(
        input.outputPayload.contradiction_score ??
        contradiction.contradiction_score ??
        readObject(input.outputPayload.contradiction_analysis).contradiction_score,
    );
    const adversarialCase = (input.sourceModule ?? '') === 'adversarial_simulation';
    const adversarialType = adversarialCase ? 'simulated_adversarial_case' : null;
    let diagnosisConfidence =
        normalizeProbability(readNumber(input.confidenceScore)) ??
        readNumber(diagnosis.confidence_score ?? input.outputPayload.confidence_score) ??
        readNumber(topDifferential?.probability ?? topDifferential?.confidence) ??
        existing?.diagnosis_confidence ??
        null;
    let topDiagnosis = mergeScalar(existing?.top_diagnosis ?? null, parsedTopDiagnosis, preferIncoming);
    let primaryConditionClass = mergeScalar(
        existing?.primary_condition_class ?? null,
        parsedConditionClass,
        preferIncoming,
    );

    if (!hasMeaningfulConditionClass(primaryConditionClass)) {
        primaryConditionClass =
            inferConditionClassFromDiagnosis(topDiagnosis) ??
            primaryConditionClass;
    }

    if (!topDiagnosis || !hasMeaningfulConditionClass(primaryConditionClass)) {
        const lowSignalFallback = deriveLowSignalFallback(input.symptomKeys ?? []);
        topDiagnosis = topDiagnosis ?? lowSignalFallback.topDiagnosis;
        primaryConditionClass = hasMeaningfulConditionClass(primaryConditionClass)
            ? primaryConditionClass
            : lowSignalFallback.primaryConditionClass;
        diagnosisConfidence = capConfidence(
            diagnosisConfidence ?? lowSignalFallback.diagnosisConfidence,
            lowSignalFallback.diagnosisConfidence,
        );
        severityScore = severityScore ?? lowSignalFallback.severityScore;
        emergencyLevel = emergencyLevel ?? lowSignalFallback.emergencyLevel;
    }

    const predictedDiagnosis = topDiagnosis ?? existing?.predicted_diagnosis ?? null;
    const normalizedContradictionScore = normalizeContradictionScore(
        contradictionScore,
        contradictionFlags.length,
        adversarialCase || existing?.adversarial_case === true,
    );
    const degradedConfidence = adversarialCase || normalizedContradictionScore !== null
        ? diagnosisConfidence ?? existing?.degraded_confidence ?? null
        : existing?.degraded_confidence ?? null;
    const differentialSpread = chooseJsonPatch(
        existing?.differential_spread ?? null,
        deriveDifferentialSpread(input.outputPayload, diagnosis),
        preferIncoming,
    );
    const calibrationState = deriveCalibrationState({
        predictedDiagnosis,
        confirmedDiagnosis: existing?.confirmed_diagnosis ?? null,
        diagnosisConfidence,
    });

    return {
        primary_condition_class: primaryConditionClass,
        top_diagnosis: topDiagnosis,
        predicted_diagnosis: predictedDiagnosis,
        confirmed_diagnosis: existing?.confirmed_diagnosis ?? null,
        label_type: existing?.confirmed_diagnosis
            ? (existing.label_type ?? 'expert_reviewed')
            : (existing?.label_type ?? 'inferred_only'),
        diagnosis_confidence: diagnosisConfidence,
        severity_score: severityScore,
        emergency_level: emergencyLevel,
        triage_priority: deriveTriagePriority(emergencyLevel, severityScore),
        contradiction_score: normalizedContradictionScore,
        contradiction_flags: contradictionFlags,
        adversarial_case: adversarialCase || existing?.adversarial_case === true,
        adversarial_case_type: adversarialType ?? existing?.adversarial_case_type ?? null,
        uncertainty_notes: uncertaintyNotes,
        case_cluster: deriveCaseCluster({
            topDiagnosis,
            confirmedDiagnosis: existing?.confirmed_diagnosis ?? null,
            primaryConditionClass,
            adversarialCase: adversarialCase || existing?.adversarial_case === true,
            adversarialCaseType: adversarialType ?? existing?.adversarial_case_type ?? null,
        }),
        model_version:
            readText(input.modelVersion) ??
            readText(telemetry.model_version) ??
            existing?.model_version ??
            null,
        telemetry_status: deriveTelemetryStatus({
            hasDiagnosis: Boolean(topDiagnosis || primaryConditionClass || existing?.confirmed_diagnosis),
            hasSeverity: Boolean(emergencyLevel || severityScore !== null),
            isInvalid: false,
            adversarialCase: adversarialCase || existing?.adversarial_case === true,
        }),
        calibration_status: calibrationState.calibrationStatus,
        prediction_correct: calibrationState.predictionCorrect,
        confidence_error: calibrationState.confidenceError,
        calibration_bucket: deriveCalibrationBucket(diagnosisConfidence),
        degraded_confidence: degradedConfidence,
        differential_spread: differentialSpread,
    };
}

export function buildOutcomeLearningPatch(input: OutcomeLearningInput): Partial<ClinicalLearningPatch> {
    const confirmedDiagnosis = readText(
        input.outcomePayload.confirmed_diagnosis ??
        input.outcomePayload.final_diagnosis ??
        input.outcomePayload.diagnosis,
    );
    const primaryConditionClass = readText(
        input.outcomePayload.primary_condition_class ?? input.outcomePayload.condition_class,
    ) ??
        input.existing.primary_condition_class ??
        inferConditionClassFromDiagnosis(confirmedDiagnosis ?? input.existing.predicted_diagnosis ?? input.existing.top_diagnosis);
    const severityScore = readNumber(input.outcomePayload.severity_score) ?? input.existing.severity_score;
    const emergencyLevel = normalizeEmergencyLevel(
        readText(input.outcomePayload.emergency_level),
    ) ??
        deriveEmergencyLevelFromSeverity(severityScore) ??
        input.existing.emergency_level;
    const contradictionScore = readNumber(input.outcomePayload.contradiction_score) ?? input.existing.contradiction_score;
    const contradictionFlags = mergeStringArrays(
        input.existing.contradiction_flags,
        mergeStringArrays(
            readStringArray(input.outcomePayload.contradiction_flags),
            readStringArray(input.outcomePayload.contradiction_reasons),
        ),
    );
    const uncertaintyNotes = mergeStringArrays(
        input.existing.uncertainty_notes,
        readStringArray(input.outcomePayload.uncertainty_notes),
    );
    const labelType = deriveOutcomeLabelType(input.outcomePayload, input.outcomeType);
    const predictedDiagnosis = input.existing.predicted_diagnosis ?? input.existing.top_diagnosis;
    const diagnosisConfidence = input.existing.degraded_confidence ?? input.existing.diagnosis_confidence;
    const calibrationState = deriveCalibrationState({
        predictedDiagnosis,
        confirmedDiagnosis: confirmedDiagnosis ?? input.existing.confirmed_diagnosis,
        diagnosisConfidence,
    });

    return {
        confirmed_diagnosis: confirmedDiagnosis ?? input.existing.confirmed_diagnosis,
        predicted_diagnosis: predictedDiagnosis,
        primary_condition_class: primaryConditionClass,
        label_type: labelType,
        severity_score: severityScore,
        emergency_level: emergencyLevel,
        triage_priority: deriveTriagePriority(emergencyLevel, severityScore),
        contradiction_score: contradictionScore,
        contradiction_flags: contradictionFlags,
        uncertainty_notes: uncertaintyNotes,
        case_cluster: deriveCaseCluster({
            topDiagnosis: input.existing.top_diagnosis,
            confirmedDiagnosis: confirmedDiagnosis ?? input.existing.confirmed_diagnosis,
            primaryConditionClass,
            adversarialCase: input.existing.adversarial_case,
            adversarialCaseType: input.existing.adversarial_case_type,
        }),
        telemetry_status: deriveTelemetryStatus({
            hasDiagnosis: Boolean(confirmedDiagnosis ?? input.existing.top_diagnosis ?? primaryConditionClass),
            hasSeverity: Boolean(emergencyLevel || severityScore !== null),
            isInvalid: false,
            adversarialCase: input.existing.adversarial_case,
        }),
        calibration_status: calibrationState.calibrationStatus,
        prediction_correct: calibrationState.predictionCorrect,
        confidence_error: calibrationState.confidenceError,
        calibration_bucket: deriveCalibrationBucket(diagnosisConfidence),
    };
}

export function buildSimulationLearningPatch(input: SimulationLearningInput): Partial<ClinicalLearningPatch> {
    const stressMetrics = readObject(input.stressMetrics);
    const contradictionAnalysis = readObject(stressMetrics.contradiction_analysis);
    const diagnosis = readObject(stressMetrics.diagnosis);
    const riskAssessment = readObject(stressMetrics.risk_assessment);
    const topDifferential = readTopDifferential(diagnosis.top_differentials);
    const parsedTopDiagnosis = extractTopDiagnosis(stressMetrics, diagnosis, topDifferential);
    const parsedConditionClass = normalizeConditionClass(
        readText(diagnosis.primary_condition_class) ??
        readText(diagnosis.condition_class) ??
        inferConditionClassFromDiagnosis(parsedTopDiagnosis),
    );
    const resolvedConditionClass = hasMeaningfulConditionClass(parsedConditionClass)
        ? parsedConditionClass
        : inferConditionClassFromDiagnosis(parsedTopDiagnosis);
    const severityScore =
        readNumber(riskAssessment.severity_score ?? stressMetrics.severity_score) ??
        input.existing.severity_score;
    const emergencyLevel =
        normalizeEmergencyLevel(readText(riskAssessment.emergency_level) ?? readText(stressMetrics.emergency_level)) ??
        deriveEmergencyLevelFromSeverity(severityScore) ??
        input.existing.emergency_level;
    const contradictionScore =
        readNumber(stressMetrics.contradiction_score) ??
        readNumber(contradictionAnalysis.contradiction_score) ??
        input.existing.contradiction_score;
    const contradictionFlags = mergeStringArrays(
        input.existing.contradiction_flags,
        readStringArray(
            stressMetrics.contradiction_reasons ?? contradictionAnalysis.contradiction_reasons,
        ),
    );
    const uncertaintyNotes = mergeStringArrays(
        input.existing.uncertainty_notes,
        readStringArray(stressMetrics.uncertainty_notes),
    );

    return {
        adversarial_case: true,
        adversarial_case_type: normalizeSimulationCaseType(input.simulationType),
        top_diagnosis: input.existing.top_diagnosis ?? parsedTopDiagnosis,
        predicted_diagnosis: input.existing.predicted_diagnosis ?? input.existing.top_diagnosis ?? parsedTopDiagnosis,
        primary_condition_class: input.existing.primary_condition_class ?? resolvedConditionClass,
        severity_score: severityScore,
        emergency_level: emergencyLevel,
        triage_priority: deriveTriagePriority(emergencyLevel, severityScore),
        contradiction_score: contradictionScore,
        contradiction_flags: contradictionFlags,
        uncertainty_notes: uncertaintyNotes,
        case_cluster: deriveCaseCluster({
            topDiagnosis: input.existing.top_diagnosis ?? parsedTopDiagnosis,
            confirmedDiagnosis: input.existing.confirmed_diagnosis,
            primaryConditionClass: input.existing.primary_condition_class ?? resolvedConditionClass,
            adversarialCase: true,
            adversarialCaseType: normalizeSimulationCaseType(input.simulationType),
        }),
        telemetry_status: deriveTelemetryStatus({
            hasDiagnosis: Boolean(input.existing.top_diagnosis || parsedTopDiagnosis || input.existing.confirmed_diagnosis || input.existing.primary_condition_class || resolvedConditionClass),
            hasSeverity: Boolean(emergencyLevel || severityScore !== null),
            isInvalid: false,
            adversarialCase: true,
        }),
        degraded_confidence: input.existing.degraded_confidence ?? input.existing.diagnosis_confidence ?? readNumber(stressMetrics.confidence_score),
        differential_spread: chooseJsonPatch(
            input.existing.differential_spread,
            deriveDifferentialSpread(stressMetrics, diagnosis),
            true,
        ),
    };
}

export function deriveCaseCluster(input: {
    topDiagnosis: string | null;
    confirmedDiagnosis: string | null;
    primaryConditionClass: string | null;
    adversarialCase: boolean;
    adversarialCaseType: string | null;
}): string | null {
    const label = (input.confirmedDiagnosis ?? input.topDiagnosis ?? '').toLowerCase();
    const conditionClass = (input.primaryConditionClass ?? '').toLowerCase();

    let cluster = 'Unknown / Mixed';
    if (label.includes('gastric dilatation') || label.includes('gdv')) cluster = 'GDV';
    else if (label.includes('parvo')) cluster = 'Parvovirus';
    else if (label.includes('distemper')) cluster = 'Distemper';
    else if (label.includes('pancreatitis')) cluster = 'Pancreatitis';
    else if (label.includes('toxic') || conditionClass.includes('toxic')) cluster = 'Toxicology';
    else if (conditionClass.includes('mechanical')) cluster = 'Mechanical';
    else if (conditionClass.includes('infectious')) cluster = 'Infectious';

    if (!input.adversarialCase) {
        return cluster;
    }

    if (input.adversarialCaseType?.toLowerCase().includes('mechanical') || cluster === 'GDV' || conditionClass.includes('mechanical')) {
        return 'Adversarial Mechanical';
    }

    if (input.adversarialCaseType?.toLowerCase().includes('infectious') || cluster === 'Distemper' || cluster === 'Parvovirus' || conditionClass.includes('infectious')) {
        return 'Adversarial Infectious';
    }

    return 'Unknown / Mixed';
}

export function deriveTriagePriority(
    emergencyLevel: ClinicalEmergencyLevel | null,
    severityScore: number | null,
): ClinicalTriagePriority | null {
    if (emergencyLevel === 'CRITICAL') return 'immediate';
    if (emergencyLevel === 'HIGH') return 'urgent';
    if (emergencyLevel === 'MODERATE') return 'standard';
    if (emergencyLevel === 'LOW') return 'low';

    if (severityScore === null) return null;
    if (severityScore >= 0.85) return 'immediate';
    if (severityScore >= 0.6) return 'urgent';
    if (severityScore >= 0.3) return 'standard';
    return 'low';
}

export function deriveTelemetryStatus(input: {
    hasDiagnosis: boolean;
    hasSeverity: boolean;
    isInvalid: boolean;
    adversarialCase: boolean;
}): string {
    if (input.isInvalid) return 'quarantined';
    if (input.hasDiagnosis && input.hasSeverity) return input.adversarialCase ? 'benchmark_ready' : 'learning_ready';
    if (input.hasDiagnosis || input.hasSeverity) return 'partial';
    return 'pending';
}

function deriveOutcomeLabelType(
    payload: Record<string, unknown>,
    outcomeType: string,
): ClinicalCaseLabelType {
    const explicit = readText(payload.label_type)?.toLowerCase();
    if (explicit === 'lab_confirmed' || explicit === 'lab-confirmed' || payload.lab_confirmed === true) {
        return 'lab_confirmed';
    }
    if (explicit === 'expert_reviewed' || explicit === 'expert-reviewed' || explicit === 'expert') {
        return 'expert_reviewed';
    }
    if (
        explicit === 'synthetic' ||
        explicit === 'sandbox' ||
        explicit === 'test' ||
        outcomeType.toLowerCase().includes('synthetic') ||
        outcomeType.toLowerCase().includes('sandbox')
    ) {
        return 'synthetic';
    }
    return 'expert_reviewed';
}

function deriveLowSignalFallback(symptomKeys: string[]): {
    primaryConditionClass: string;
    topDiagnosis: string;
    diagnosisConfidence: number;
    severityScore: number;
    emergencyLevel: ClinicalEmergencyLevel;
} {
    const signalCount = symptomKeys.length;
    if (signalCount <= 1) {
        return {
            primaryConditionClass: 'Undifferentiated',
            topDiagnosis: 'Undifferentiated low-signal presentation',
            diagnosisConfidence: 0.22,
            severityScore: 0.2,
            emergencyLevel: 'LOW',
        };
    }

    return {
        primaryConditionClass: 'Undifferentiated',
        topDiagnosis: 'Undifferentiated clinical syndrome',
        diagnosisConfidence: 0.35,
        severityScore: 0.42,
        emergencyLevel: 'MODERATE',
    };
}

function isMissingSpecies(speciesCanonical: string | null, speciesRaw: string | null): boolean {
    const normalizedCanonical = (speciesCanonical ?? '').trim().toLowerCase();
    const normalizedRaw = (speciesRaw ?? '').trim().toLowerCase();

    if (!normalizedCanonical && !normalizedRaw) return true;
    if (SPECIES_PLACEHOLDERS.has(normalizedCanonical) || SPECIES_PLACEHOLDERS.has(normalizedRaw)) return true;
    return false;
}

function hasMeaningfulSymptoms(
    symptomsRaw: string | null,
    symptomKeys: string[],
    unresolvedSymptoms: string[],
): boolean {
    if (symptomKeys.length > 0 || unresolvedSymptoms.length > 0) return true;
    if (!symptomsRaw) return false;
    return !isPlaceholderValue(symptomsRaw);
}

function normalizeEmergencyLevel(value: string | null): ClinicalEmergencyLevel | null {
    if (!value) return null;
    const normalized = value.toUpperCase();
    if (normalized === 'CRITICAL' || normalized === 'HIGH' || normalized === 'MODERATE' || normalized === 'LOW') {
        return normalized;
    }
    return null;
}

function normalizeSimulationCaseType(value: string): string {
    return value
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function deriveEmergencyLevelFromSeverity(value: number | null): ClinicalEmergencyLevel | null {
    if (value === null) return null;
    if (value >= 0.85) return 'CRITICAL';
    if (value >= 0.6) return 'HIGH';
    if (value >= 0.3) return 'MODERATE';
    return 'LOW';
}

function deriveSeverityScoreFromEmergencyLevel(value: ClinicalEmergencyLevel | null): number | null {
    if (value === 'CRITICAL') return 0.95;
    if (value === 'HIGH') return 0.72;
    if (value === 'MODERATE') return 0.42;
    if (value === 'LOW') return 0.2;
    return null;
}

function inferConditionClassFromDiagnosis(value: string | null): string | null {
    const normalized = (value ?? '').toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('gdv') || normalized.includes('dilatation') || normalized.includes('volvulus') || normalized.includes('obstruction')) {
        return 'Mechanical';
    }
    if (normalized.includes('parvo') || normalized.includes('distemper') || normalized.includes('infect')) {
        return 'Infectious';
    }
    if (normalized.includes('toxic')) {
        return 'Toxicology';
    }
    if (normalized.includes('pancreatitis')) {
        return 'Inflammatory';
    }
    if (normalized.includes('undifferentiated')) {
        return 'Undifferentiated';
    }
    if (normalized.includes('unknown') || normalized.includes('undifferentiated')) {
        return 'Undifferentiated';
    }
    return null;
}

function readTopDifferential(value: unknown): Record<string, unknown> | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const candidate = value[0];
    if (typeof candidate === 'string') {
        return { name: candidate };
    }
    return readObject(candidate);
}

function readObject(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 && !isPlaceholderValue(normalized) ? normalized : null;
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
    const normalized = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.replace(/\s+/g, ' ').trim())
        .filter((entry) => entry.length > 0 && !isPlaceholderValue(entry));

    return Array.from(new Set(normalized));
}

function extractTopDiagnosis(
    payload: Record<string, unknown>,
    diagnosis: Record<string, unknown>,
    topDifferential: Record<string, unknown> | null,
): string | null {
    return readText(topDifferential?.name) ??
        readText(topDifferential?.diagnosis) ??
        readText(topDifferential?.condition) ??
        readText(diagnosis.top_diagnosis) ??
        readText(diagnosis.predicted_diagnosis) ??
        readText(diagnosis.primary_diagnosis) ??
        readText(payload.top_diagnosis) ??
        readText(payload.predicted_diagnosis) ??
        null;
}

function normalizeConditionClass(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    if (UNKNOWN_CONDITION_CLASS_LABELS.has(normalized.toLowerCase())) {
        return 'Undifferentiated';
    }
    return normalized;
}

function hasMeaningfulConditionClass(value: string | null): boolean {
    if (!value) return false;
    return normalizeConditionClass(value) !== 'Undifferentiated' || value === 'Undifferentiated';
}

function mergeStringArrays(left: string[], right: string[]): string[] {
    return Array.from(new Set([...left, ...right]));
}

function mergeScalar<T extends string | number | boolean | null>(
    existing: T,
    incoming: T,
    preferIncoming: boolean,
): T {
    if (incoming === null) return existing;
    if (existing === null) return incoming;
    return preferIncoming ? incoming : existing;
}

function chooseJsonPatch(
    existing: Record<string, unknown> | null,
    incoming: Record<string, unknown> | null,
    preferIncoming: boolean,
): Record<string, unknown> | null {
    if (!incoming || Object.keys(incoming).length === 0) {
        return existing;
    }
    if (!existing || Object.keys(existing).length === 0) {
        return incoming;
    }
    return preferIncoming ? incoming : existing;
}

function normalizeProbability(value: number | null): number | null {
    if (value === null) return null;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function capConfidence(value: number, cap: number): number {
    return Math.min(normalizeProbability(value) ?? cap, cap);
}

function normalizeContradictionScore(
    value: number | null,
    contradictionFlagCount: number,
    adversarialCase: boolean,
): number | null {
    if (value !== null) return normalizeProbability(value);
    if (contradictionFlagCount > 0) {
        return adversarialCase ? 0.55 : 0.35;
    }
    if (adversarialCase) {
        return 0.25;
    }
    return null;
}

function deriveDifferentialSpread(
    payload: Record<string, unknown>,
    diagnosis: Record<string, unknown>,
): Record<string, unknown> | null {
    const explicitSpread = readObject(payload.differential_spread);
    if (Object.keys(explicitSpread).length > 0) {
        return explicitSpread;
    }

    const topDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    if (topDifferentials.length < 2) {
        return null;
    }

    const topOne = readObject(topDifferentials[0]);
    const topTwo = readObject(topDifferentials[1]);
    const topThree = readObject(topDifferentials[2]);
    const firstProbability = normalizeProbability(readNumber(topOne.probability));
    const secondProbability = normalizeProbability(readNumber(topTwo.probability));

    return {
        top_1_probability: firstProbability,
        top_2_probability: secondProbability,
        top_3_probability: normalizeProbability(readNumber(topThree.probability)),
        spread: firstProbability !== null && secondProbability !== null
            ? Number((firstProbability - secondProbability).toFixed(3))
            : null,
    };
}

function deriveCalibrationState(input: {
    predictedDiagnosis: string | null;
    confirmedDiagnosis: string | null;
    diagnosisConfidence: number | null;
}): {
    calibrationStatus: ClinicalCalibrationStatus;
    predictionCorrect: boolean | null;
    confidenceError: number | null;
} {
    if (!input.predictedDiagnosis) {
        return {
            calibrationStatus: 'no_prediction_anchor',
            predictionCorrect: null,
            confidenceError: null,
        };
    }

    if (!input.confirmedDiagnosis) {
        return {
            calibrationStatus: 'pending_outcome',
            predictionCorrect: null,
            confidenceError: null,
        };
    }

    const predictionCorrect = diagnosesMatch(input.predictedDiagnosis, input.confirmedDiagnosis);
    const confidence = normalizeProbability(input.diagnosisConfidence);
    return {
        calibrationStatus: predictionCorrect ? 'calibrated_match' : 'calibrated_mismatch',
        predictionCorrect,
        confidenceError: confidence === null ? null : Number(Math.abs((predictionCorrect ? 1 : 0) - confidence).toFixed(3)),
    };
}

function deriveCalibrationBucket(confidence: number | null): string | null {
    const normalized = normalizeProbability(confidence);
    if (normalized === null) return null;
    if (normalized < 0.2) return '0-20';
    if (normalized < 0.4) return '20-40';
    if (normalized < 0.6) return '40-60';
    if (normalized < 0.8) return '60-80';
    return '80-100';
}

function diagnosesMatch(left: string, right: string): boolean {
    const normalizedLeft = left.toLowerCase();
    const normalizedRight = right.toLowerCase();
    return normalizedLeft === normalizedRight ||
        normalizedLeft.includes(normalizedRight) ||
        normalizedRight.includes(normalizedLeft);
}
