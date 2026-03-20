import { isPlaceholderValue } from '@/lib/clinicalCases/symptomOntology';

export type ClinicalCaseIngestionStatus = 'accepted' | 'rejected' | 'quarantined';
export type ClinicalCaseLabelType = 'inferred_only' | 'synthetic' | 'expert_reviewed' | 'lab_confirmed';
export type ClinicalEmergencyLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
export type ClinicalTriagePriority = 'immediate' | 'urgent' | 'standard' | 'low';

export interface ClinicalCaseValidationResult {
    ingestion_status: ClinicalCaseIngestionStatus;
    invalid_case: boolean;
    validation_error_code: string | null;
}

export interface ClinicalLearningPatch {
    primary_condition_class: string | null;
    top_diagnosis: string | null;
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
}

export interface InferenceLearningInput {
    outputPayload: Record<string, unknown>;
    confidenceScore?: number | null;
    modelVersion?: string | null;
    sourceModule?: string | null;
}

export interface OutcomeLearningInput {
    outcomePayload: Record<string, unknown>;
    outcomeType: string;
    existing: Pick<
        ClinicalLearningPatch,
        | 'top_diagnosis'
        | 'primary_condition_class'
        | 'confirmed_diagnosis'
        | 'label_type'
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
    >;
}

export interface SimulationLearningInput {
    simulationType: string;
    stressMetrics?: Record<string, unknown> | null;
    existing: Pick<
        ClinicalLearningPatch,
        | 'top_diagnosis'
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
    >;
}

const SPECIES_PLACEHOLDERS = new Set([
    'unknown',
    'unresolved',
    '-',
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
    const topDifferential = readTopDifferential(diagnosis.top_differentials);

    const topDiagnosis = readText(topDifferential?.name);
    const primaryConditionClass = readText(diagnosis.primary_condition_class);
    const emergencyLevel = normalizeEmergencyLevel(readText(riskAssessment.emergency_level));
    const severityScore = readNumber(riskAssessment.severity_score);
    const contradictionFlags = readStringArray(
        input.outputPayload.contradiction_reasons ?? contradiction.contradiction_reasons,
    );
    const uncertaintyNotes = readStringArray(input.outputPayload.uncertainty_notes);
    const contradictionScore = readNumber(
        input.outputPayload.contradiction_score ?? contradiction.contradiction_score,
    );
    const adversarialCase = (input.sourceModule ?? '') === 'adversarial_simulation';
    const adversarialType = adversarialCase ? 'simulated_adversarial_case' : null;
    const diagnosisConfidence =
        readNumber(input.confidenceScore) ??
        readNumber(diagnosis.confidence_score) ??
        readNumber(topDifferential?.probability);

    return {
        primary_condition_class: primaryConditionClass,
        top_diagnosis: topDiagnosis,
        confirmed_diagnosis: null,
        label_type: 'inferred_only',
        diagnosis_confidence: diagnosisConfidence,
        severity_score: severityScore,
        emergency_level: emergencyLevel,
        triage_priority: deriveTriagePriority(emergencyLevel, severityScore),
        contradiction_score: contradictionScore,
        contradiction_flags: contradictionFlags,
        adversarial_case: adversarialCase,
        adversarial_case_type: adversarialType,
        uncertainty_notes: uncertaintyNotes,
        case_cluster: deriveCaseCluster({
            topDiagnosis,
            confirmedDiagnosis: null,
            primaryConditionClass,
            adversarialCase,
            adversarialCaseType: adversarialType,
        }),
        model_version: readText(input.modelVersion),
        telemetry_status: deriveTelemetryStatus({
            hasDiagnosis: Boolean(topDiagnosis || primaryConditionClass),
            hasSeverity: Boolean(emergencyLevel || severityScore !== null),
            isInvalid: false,
            adversarialCase,
        }),
    };
}

export function buildOutcomeLearningPatch(input: OutcomeLearningInput): Partial<ClinicalLearningPatch> {
    const confirmedDiagnosis = readText(
        input.outcomePayload.confirmed_diagnosis ?? input.outcomePayload.diagnosis,
    );
    const primaryConditionClass = readText(
        input.outcomePayload.primary_condition_class,
    ) ?? input.existing.primary_condition_class;
    const severityScore = readNumber(input.outcomePayload.severity_score) ?? input.existing.severity_score;
    const emergencyLevel = normalizeEmergencyLevel(
        readText(input.outcomePayload.emergency_level),
    ) ?? input.existing.emergency_level;
    const contradictionScore = readNumber(input.outcomePayload.contradiction_score) ?? input.existing.contradiction_score;
    const contradictionFlags = mergeStringArrays(
        input.existing.contradiction_flags,
        readStringArray(input.outcomePayload.contradiction_flags),
    );
    const uncertaintyNotes = mergeStringArrays(
        input.existing.uncertainty_notes,
        readStringArray(input.outcomePayload.uncertainty_notes),
    );
    const labelType = deriveOutcomeLabelType(input.outcomePayload, input.outcomeType);

    return {
        confirmed_diagnosis: confirmedDiagnosis ?? input.existing.confirmed_diagnosis,
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
    };
}

export function buildSimulationLearningPatch(input: SimulationLearningInput): Partial<ClinicalLearningPatch> {
    const stressMetrics = readObject(input.stressMetrics);
    const contradictionAnalysis = readObject(stressMetrics.contradiction_analysis);
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
        contradiction_score: contradictionScore,
        contradiction_flags: contradictionFlags,
        uncertainty_notes: uncertaintyNotes,
        case_cluster: deriveCaseCluster({
            topDiagnosis: input.existing.top_diagnosis,
            confirmedDiagnosis: input.existing.confirmed_diagnosis,
            primaryConditionClass: input.existing.primary_condition_class,
            adversarialCase: true,
            adversarialCaseType: normalizeSimulationCaseType(input.simulationType),
        }),
        telemetry_status: deriveTelemetryStatus({
            hasDiagnosis: Boolean(input.existing.top_diagnosis || input.existing.confirmed_diagnosis || input.existing.primary_condition_class),
            hasSeverity: Boolean(input.existing.emergency_level || input.existing.severity_score !== null),
            isInvalid: false,
            adversarialCase: true,
        }),
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

function readTopDifferential(value: unknown): Record<string, unknown> | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const candidate = value[0];
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
    return normalized.length > 0 ? normalized : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const normalized = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    return Array.from(new Set(normalized));
}

function mergeStringArrays(left: string[], right: string[]): string[] {
    return Array.from(new Set([...left, ...right]));
}
