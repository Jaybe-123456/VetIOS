import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createHash } from 'crypto';
import { vectorizeClinicalCase } from '@/lib/learningEngine/featureStore';
import {
    DEFAULT_FEATURE_SCHEMA_VERSION,
    DEFAULT_LABEL_POLICY_VERSION,
    DEFAULT_LABEL_TRUST,
    type CalibrationEvalRow,
    type DiagnosisTrainingRow,
    type LearningCaseRecord,
    type LearningDatasetBundle,
    type SeverityTrainingRow,
} from '@/lib/learningEngine/types';
import {
    buildFederatedOutcomeEligibilityDigest,
    type FederatedOutcomeEligibilityDigest,
} from '@/lib/federation/outcomeEligibility';

export interface VvrbCaseRecord {
    benchmark_id?: string;
    synthetic?: boolean;
    benchmark_version?: string;
    case_domain?: string;
    species?: string;
    breed?: string;
    age?: string;
    sex?: string;
    weight_kg?: number;
    care_environment?: string;
    regulatory_region?: string;
    severity?: string;
    presenting_complaint?: string;
    history?: string;
    clinical_signs?: string[];
    labs?: Record<string, unknown>;
    imaging?: Record<string, unknown>;
    differential_diagnoses?: string[];
    reasoning_chain_public?: string;
    red_flags?: string[];
    recommended_tests?: string[];
    treatment_plan?: string[];
    antimicrobial_decision?: {
        drug?: string;
        reason?: string;
        stewardship_risk?: string;
    };
    clinician_feedback?: string;
    preferred_response?: string;
    rejected_response?: string;
    corrected_response?: string;
    confirmed_diagnosis?: string;
    outcome?: string;
    follow_up_days?: number;
    evidence_sources?: string[];
    confidence_score?: number;
    cire_phi_hat?: number;
    evaluation_targets?: {
        top1_differential?: string;
        top3_contains_confirmed?: boolean;
        documentation_speed_task?: string;
        amr_stewardship_task?: string;
        red_flag_detection_task?: string;
    };
}

export interface VvrbStreamOptions {
    limit?: number;
    skipInvalidLines?: boolean;
}

export interface VvrbBenchmarkAdapterOptions {
    tenantId?: string;
    modelVersion?: string;
    featureSchemaVersion?: string;
    labelPolicyVersion?: string;
    now?: string;
}

export type VvrbAuditSeverity = 'info' | 'warning' | 'high' | 'critical';

export interface VvrbAuditIssue {
    key: string;
    severity: VvrbAuditSeverity;
    message: string;
    metric?: number;
    threshold?: number;
}

export interface VvrbAuditReport {
    dataset_name: 'vvrb';
    benchmark_version: string | null;
    total_cases: number;
    synthetic_cases: number;
    invalid_cases: number;
    diagnosis_leakage_rate: number;
    domain_diagnosis_diversity: Array<{
        domain: string;
        total_cases: number;
        unique_confirmed_diagnoses: number;
        top_confirmed_diagnosis: string | null;
        top_confirmed_diagnosis_rate: number;
    }>;
    repeated_reasoning_top_rate: number;
    repeated_history_top_rate: number;
    unique_lab_pattern_count: number;
    lab_pattern_top_rate: number;
    unique_amr_decision_count: number;
    amr_decision_top_rate: number;
    confidence_cire_correlation: number | null;
    generic_evidence_source_rate: number;
    issues: VvrbAuditIssue[];
    allowed_uses: string[];
    blocked_uses: string[];
    sources: string[];
}

export interface VvrbSyntheticFirewallReport {
    source: 'vvrb';
    synthetic: true;
    benchmark_only: true;
    total_rows: number;
    synthetic_rows_excluded: number;
    learning_ledger_rows_allowed: 0;
    federation_rows_allowed: 0;
    moat_completion_rows_allowed: 0;
    blockers: string[];
    federated_outcome_eligibility: FederatedOutcomeEligibilityDigest;
}

const DEFAULT_TENANT_ID = 'vvrb-benchmark';
const GENERIC_EVIDENCE_SOURCE_PATTERNS = [
    /standard veterinary clinical reasoning patterns/i,
    /msd\/merck veterinary manual disease guidance/i,
    /woah antimicrobial stewardship/i,
];

export async function* streamVvrbJsonl(
    filePath: string,
    options: VvrbStreamOptions = {},
): AsyncGenerator<VvrbCaseRecord> {
    const reader = createInterface({
        input: createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });
    let emitted = 0;

    for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (isRecord(parsed)) {
                yield parsed as VvrbCaseRecord;
                emitted += 1;
                if (options.limit != null && emitted >= options.limit) break;
            } else if (!options.skipInvalidLines) {
                throw new Error('VVRB line did not parse to an object');
            }
        } catch (error) {
            if (!options.skipInvalidLines) throw error;
        }
    }
}

export async function loadVvrbCasesFromJsonl(
    filePath: string,
    options: VvrbStreamOptions = {},
): Promise<VvrbCaseRecord[]> {
    const cases: VvrbCaseRecord[] = [];
    for await (const record of streamVvrbJsonl(filePath, options)) {
        cases.push(record);
    }
    return cases;
}

export function buildVvrbBenchmarkBundle(
    records: VvrbCaseRecord[],
    options: VvrbBenchmarkAdapterOptions = {},
): LearningDatasetBundle {
    const now = options.now ?? new Date().toISOString();
    const featureSchemaVersion = options.featureSchemaVersion ?? DEFAULT_FEATURE_SCHEMA_VERSION;
    const labelPolicyVersion = options.labelPolicyVersion ?? `${DEFAULT_LABEL_POLICY_VERSION}:vvrb-benchmark-only`;
    const clinicalCases = records.map((record) => mapVvrbCaseToLearningCase(record, {
        tenantId: options.tenantId ?? DEFAULT_TENANT_ID,
        modelVersion: options.modelVersion ?? record.benchmark_version ?? 'vvrb-v1',
        now,
    }));

    const diagnosisTrainingSet: DiagnosisTrainingRow[] = [];
    const severityTrainingSet: SeverityTrainingRow[] = [];
    const calibrationEvalSet: CalibrationEvalRow[] = [];
    const excludedCounts: Record<string, number> = {
        invalid_case: 0,
        unresolved_diagnosis: 0,
        unresolved_severity: 0,
        calibration_ineligible: 0,
        synthetic_rows_blocked_from_learning_ledgers: clinicalCases.length,
    };

    for (const clinicalCase of clinicalCases) {
        if (clinicalCase.invalid_case || clinicalCase.ingestion_status !== 'accepted') {
            excludedCounts.invalid_case += 1;
            continue;
        }

        const featureVector = vectorizeClinicalCase(clinicalCase, featureSchemaVersion);
        if (clinicalCase.confirmed_diagnosis) {
            diagnosisTrainingSet.push({
                case_id: clinicalCase.case_id,
                tenant_id: clinicalCase.tenant_id,
                species_canonical: clinicalCase.species_canonical,
                breed: clinicalCase.breed,
                case_cluster: clinicalCase.case_cluster,
                feature_vector: featureVector,
                confirmed_diagnosis: clinicalCase.confirmed_diagnosis,
                primary_condition_class: clinicalCase.primary_condition_class,
                label_type: 'synthetic',
                label_weight: DEFAULT_LABEL_TRUST.synthetic,
                contradiction_score: clinicalCase.contradiction_score,
                contradiction_flags: clinicalCase.contradiction_flags,
                adversarial_case: clinicalCase.adversarial_case,
                model_version: clinicalCase.model_version,
                created_at: clinicalCase.created_at,
            });
        } else {
            excludedCounts.unresolved_diagnosis += 1;
        }

        if (clinicalCase.severity_score != null && clinicalCase.emergency_level) {
            severityTrainingSet.push({
                case_id: clinicalCase.case_id,
                tenant_id: clinicalCase.tenant_id,
                species_canonical: clinicalCase.species_canonical,
                breed: clinicalCase.breed,
                feature_vector: featureVector,
                severity_score: clinicalCase.severity_score,
                emergency_level: clinicalCase.emergency_level,
                triage_priority: clinicalCase.triage_priority,
                label_type: 'synthetic',
                label_weight: DEFAULT_LABEL_TRUST.synthetic,
                contradiction_score: clinicalCase.contradiction_score,
                adversarial_case: clinicalCase.adversarial_case,
                created_at: clinicalCase.created_at,
            });
        } else {
            excludedCounts.unresolved_severity += 1;
        }

        if (
            clinicalCase.predicted_diagnosis &&
            clinicalCase.confirmed_diagnosis &&
            clinicalCase.diagnosis_confidence != null &&
            clinicalCase.prediction_correct != null &&
            clinicalCase.confidence_error != null
        ) {
            calibrationEvalSet.push({
                case_id: clinicalCase.case_id,
                tenant_id: clinicalCase.tenant_id,
                predicted_diagnosis: clinicalCase.predicted_diagnosis,
                predicted_confidence: clinicalCase.diagnosis_confidence,
                confirmed_diagnosis: clinicalCase.confirmed_diagnosis,
                prediction_correct: clinicalCase.prediction_correct,
                confidence_error: clinicalCase.confidence_error,
                calibration_bucket: clinicalCase.calibration_bucket,
                label_type: 'synthetic',
                model_version: clinicalCase.model_version,
                case_cluster: clinicalCase.case_cluster,
                species_canonical: clinicalCase.species_canonical,
                created_at: clinicalCase.created_at,
            });
        } else {
            excludedCounts.calibration_ineligible += 1;
        }
    }

    return {
        diagnosis_training_set: diagnosisTrainingSet,
        severity_training_set: severityTrainingSet,
        calibration_eval_set: calibrationEvalSet,
        adversarial_benchmark_set: [],
        quarantine_set: [],
        summary: {
            total_cases: clinicalCases.length,
            diagnosis_training_cases: diagnosisTrainingSet.length,
            severity_training_cases: severityTrainingSet.length,
            calibration_eval_cases: calibrationEvalSet.length,
            adversarial_cases: 0,
            quarantined_cases: 0,
            label_composition: { synthetic: diagnosisTrainingSet.length },
            excluded_counts: excludedCounts,
        },
        dataset_version: buildVvrbDatasetVersion(clinicalCases),
        feature_schema_version: featureSchemaVersion,
        label_policy_version: labelPolicyVersion,
        filters: {
            tenantId: options.tenantId ?? DEFAULT_TENANT_ID,
            includeSynthetic: true,
            labelTypes: ['synthetic'],
            limit: clinicalCases.length,
        },
        case_ids: clinicalCases.map((clinicalCase) => clinicalCase.case_id),
    };
}

export function mapVvrbCaseToLearningCase(
    record: VvrbCaseRecord,
    options: Required<Pick<VvrbBenchmarkAdapterOptions, 'tenantId' | 'modelVersion' | 'now'>>,
): LearningCaseRecord {
    const topDiagnosis = readText(record.evaluation_targets?.top1_differential)
        ?? readText(record.differential_diagnoses?.[0])
        ?? null;
    const confirmedDiagnosis = readText(record.confirmed_diagnosis);
    const confidence = readScore(record.confidence_score);
    const predictionCorrect = topDiagnosis != null && confirmedDiagnosis != null
        ? normalizeText(topDiagnosis) === normalizeText(confirmedDiagnosis)
        : null;
    const symptomKeys = normalizeStringArray(record.clinical_signs);
    const caseId = readText(record.benchmark_id) ?? `vvrb-${hashRecord(record).slice(0, 12)}`;
    const severity = normalizeSeverity(record.severity);

    return {
        case_id: caseId,
        tenant_id: options.tenantId,
        user_id: null,
        clinic_id: null,
        source_module: 'vvrb_synthetic_benchmark',
        species_canonical: readText(record.species),
        species_display: readText(record.species),
        breed: readText(record.breed),
        symptom_text_raw: [record.presenting_complaint, record.history].filter(Boolean).join(' | ') || null,
        symptom_keys: symptomKeys,
        symptom_vector_normalized: Object.fromEntries(symptomKeys.map((key) => [normalizeKey(key), true])),
        patient_metadata: {
            synthetic: true,
            benchmark_source: 'vvrb',
            benchmark_version: record.benchmark_version,
            age: record.age,
            sex: record.sex,
            weight_kg: record.weight_kg,
            care_environment: record.care_environment,
            regulatory_region: record.regulatory_region,
            outcome: record.outcome,
            follow_up_days: record.follow_up_days,
            cire_phi_hat: record.cire_phi_hat,
            evidence_sources: record.evidence_sources,
        },
        latest_input_signature: {
            benchmark_id: caseId,
            case_domain: record.case_domain,
            presenting_complaint: record.presenting_complaint,
            history: record.history,
            clinical_signs: record.clinical_signs,
            labs: record.labs,
            imaging: record.imaging,
            differential_diagnoses: record.differential_diagnoses,
            reasoning_chain_public: record.reasoning_chain_public,
            red_flags: record.red_flags,
            antimicrobial_decision: record.antimicrobial_decision,
            synthetic: true,
        },
        ingestion_status: 'accepted',
        invalid_case: record.synthetic !== true,
        validation_error_code: record.synthetic === true ? null : 'vvrb_record_not_marked_synthetic',
        primary_condition_class: readText(record.case_domain),
        top_diagnosis: topDiagnosis,
        predicted_diagnosis: topDiagnosis,
        confirmed_diagnosis: confirmedDiagnosis,
        label_type: 'synthetic',
        diagnosis_confidence: confidence,
        severity_score: severity.score,
        emergency_level: severity.emergencyLevel,
        triage_priority: severity.triagePriority,
        contradiction_score: null,
        contradiction_flags: [],
        adversarial_case: false,
        adversarial_case_type: null,
        uncertainty_notes: ['synthetic_benchmark_case_not_outcome_confirmed'],
        case_cluster: readText(record.case_domain),
        model_version: options.modelVersion,
        telemetry_status: 'synthetic_benchmark',
        calibration_status: 'benchmark_only',
        prediction_correct: predictionCorrect,
        confidence_error: predictionCorrect == null || confidence == null ? null : Math.abs((predictionCorrect ? 1 : 0) - confidence),
        calibration_bucket: confidence == null ? null : buildCalibrationBucket(confidence),
        degraded_confidence: null,
        differential_spread: buildDifferentialSpread(record.differential_diagnoses),
        latest_inference_event_id: null,
        latest_outcome_event_id: null,
        latest_simulation_event_id: null,
        first_inference_at: options.now,
        last_inference_at: options.now,
        created_at: options.now,
        updated_at: options.now,
    };
}

export function auditVvrbCases(records: VvrbCaseRecord[]): VvrbAuditReport {
    const totalCases = records.length;
    const syntheticCases = records.filter((record) => record.synthetic === true).length;
    const invalidCases = totalCases - syntheticCases;
    const benchmarkVersion = mostCommon(records.map((record) => readText(record.benchmark_version)).filter(isString));
    const leakageRows = records.filter((record) => {
        const top1 = readText(record.evaluation_targets?.top1_differential) ?? readText(record.differential_diagnoses?.[0]);
        const confirmed = readText(record.confirmed_diagnosis);
        return top1 != null && confirmed != null && normalizeText(top1) === normalizeText(confirmed);
    }).length;
    const diagnosisLeakageRate = ratio(leakageRows, totalCases);
    const domainDiagnosisDiversity = buildDomainDiversity(records);
    const repeatedReasoningTopRate = topRate(records.map((record) => reasoningOpener(record.reasoning_chain_public)));
    const repeatedHistoryTopRate = topRate(records.map((record) => normalizeText(readText(record.history))));
    const labPatterns = records.map((record) => stableJson(record.labs ?? {}));
    const amrDecisions = records.map((record) => stableJson(record.antimicrobial_decision ?? {}));
    const confidenceCireCorrelation = pearson(
        records.map((record) => readScore(record.confidence_score)),
        records.map((record) => readScore(record.cire_phi_hat)),
    );
    const genericEvidenceSourceRate = ratio(records.filter(hasOnlyGenericEvidenceSources).length, totalCases);
    const issues: VvrbAuditIssue[] = [];

    if (invalidCases > 0) {
        issues.push({
            key: 'records_not_marked_synthetic',
            severity: 'critical',
            message: 'Every VVRB row must be explicitly synthetic before benchmark use.',
            metric: invalidCases,
            threshold: 0,
        });
    }
    if (diagnosisLeakageRate > 0.9) {
        issues.push({
            key: 'diagnosis_target_leakage',
            severity: 'critical',
            message: 'Top-1 differential matches confirmed diagnosis too often; do not use this field as a fine-tuning target.',
            metric: diagnosisLeakageRate,
            threshold: 0.9,
        });
    }
    for (const domain of domainDiagnosisDiversity) {
        if (domain.total_cases >= 100 && domain.unique_confirmed_diagnoses < 8) {
            issues.push({
                key: `domain_collapse:${domain.domain}`,
                severity: 'high',
                message: `Domain ${domain.domain} has too few unique confirmed diagnoses for robust model training.`,
                metric: domain.unique_confirmed_diagnoses,
                threshold: 8,
            });
        }
    }
    if (repeatedReasoningTopRate > 0.05) {
        issues.push({
            key: 'repeated_reasoning_templates',
            severity: 'high',
            message: 'Reasoning-chain openers repeat too often, which can teach style templates instead of reasoning.',
            metric: repeatedReasoningTopRate,
            threshold: 0.05,
        });
    }
    if (topRate(labPatterns) > 0.05 || new Set(labPatterns).size < Math.max(20, Math.floor(totalCases * 0.01))) {
        issues.push({
            key: 'lab_template_repetition',
            severity: 'high',
            message: 'Lab patterns are too repetitive for clinical fine-tuning; use only for benchmark plumbing until numeric realism improves.',
            metric: new Set(labPatterns).size,
            threshold: Math.max(20, Math.floor(totalCases * 0.01)),
        });
    }
    if (topRate(amrDecisions) > 0.05 || new Set(amrDecisions).size < Math.max(20, Math.floor(totalCases * 0.01))) {
        issues.push({
            key: 'amr_decision_template_repetition',
            severity: 'high',
            message: 'Antimicrobial decisions are too template-like for stewardship fine-tuning or claims.',
            metric: new Set(amrDecisions).size,
            threshold: Math.max(20, Math.floor(totalCases * 0.01)),
        });
    }
    if (confidenceCireCorrelation != null && Math.abs(confidenceCireCorrelation) > 0.85) {
        issues.push({
            key: 'confidence_cire_correlation_too_high',
            severity: 'warning',
            message: 'Confidence and CIRE phi-hat are too tightly correlated; real validation should include disagreement cases.',
            metric: confidenceCireCorrelation,
            threshold: 0.85,
        });
    }
    if (genericEvidenceSourceRate > 0.5) {
        issues.push({
            key: 'generic_evidence_sources',
            severity: 'warning',
            message: 'Most evidence sources are generic; citation-quality evaluation needs source-specific references.',
            metric: genericEvidenceSourceRate,
            threshold: 0.5,
        });
    }

    return {
        dataset_name: 'vvrb',
        benchmark_version: benchmarkVersion,
        total_cases: totalCases,
        synthetic_cases: syntheticCases,
        invalid_cases: invalidCases,
        diagnosis_leakage_rate: roundScore(diagnosisLeakageRate),
        domain_diagnosis_diversity: domainDiagnosisDiversity,
        repeated_reasoning_top_rate: roundScore(repeatedReasoningTopRate),
        repeated_history_top_rate: roundScore(repeatedHistoryTopRate),
        unique_lab_pattern_count: new Set(labPatterns).size,
        lab_pattern_top_rate: roundScore(topRate(labPatterns)),
        unique_amr_decision_count: new Set(amrDecisions).size,
        amr_decision_top_rate: roundScore(topRate(amrDecisions)),
        confidence_cire_correlation: confidenceCireCorrelation == null ? null : roundScore(confidenceCireCorrelation),
        generic_evidence_source_rate: roundScore(genericEvidenceSourceRate),
        issues,
        allowed_uses: [
            'benchmark_harness',
            'prompt_regression_tests',
            'documentation_speed_eval',
            'synthetic_amr_stewardship_eval',
            'red_flag_detection_eval',
        ],
        blocked_uses: [
            'supervised_fine_tuning_without_clinician_review',
            'federated_outcome_learning_eligibility',
            'moat_completion_live_counts',
            'clinical_claim_substantiation',
            'outcome_confirmed_learning_ledgers',
        ],
        sources: [
            'FDA GMLP',
            'FDA PCCP guidance',
            'WHO AI health guidance',
            'WHO large multimodal model guidance',
            'DECIDE-AI',
            'CONSORT-AI',
            'SPIRIT-AI',
            'MI-CLAIM',
            'WHO GLASS',
            'WOAH AMR / One Health',
            'VetCompass / RVC',
            'synthetic-data and leakage literature',
        ],
    };
}

export function buildVvrbSyntheticFirewallReport(
    audit: Pick<VvrbAuditReport, 'total_cases' | 'synthetic_cases' | 'issues'>,
): VvrbSyntheticFirewallReport {
    const blockers = [
        'synthetic_benchmark_rows_not_federation_eligible',
        'synthetic_benchmark_rows_not_outcome_confirmed',
        'synthetic_benchmark_rows_excluded_from_moat_completion',
        ...audit.issues
            .filter((issue) => issue.severity === 'critical' || issue.severity === 'high')
            .map((issue) => `vvrb_audit:${issue.key}`),
    ];

    return {
        source: 'vvrb',
        synthetic: true,
        benchmark_only: true,
        total_rows: audit.total_cases,
        synthetic_rows_excluded: audit.synthetic_cases,
        learning_ledger_rows_allowed: 0,
        federation_rows_allowed: 0,
        moat_completion_rows_allowed: 0,
        blockers,
        federated_outcome_eligibility: buildFederatedOutcomeEligibilityDigest({
            outcome_confirmed_rows: 0,
            consented_network_learning_rows: 0,
            provenance_verified_rows: 0,
            trust_scored_rows: 0,
            synthetic_rows_excluded: audit.synthetic_cases,
            eligibility_status: 'blocked',
            blockers,
        }),
    };
}

function buildDomainDiversity(records: VvrbCaseRecord[]): VvrbAuditReport['domain_diagnosis_diversity'] {
    const byDomain = new Map<string, string[]>();
    for (const record of records) {
        const domain = readText(record.case_domain) ?? 'unknown';
        const diagnosis = readText(record.confirmed_diagnosis);
        if (!diagnosis) continue;
        const bucket = byDomain.get(domain) ?? [];
        bucket.push(diagnosis);
        byDomain.set(domain, bucket);
    }

    return Array.from(byDomain.entries())
        .map(([domain, diagnoses]) => {
            const counts = countValues(diagnoses.map(normalizeText));
            const [topDiagnosis, topCount] = topEntry(counts);
            return {
                domain,
                total_cases: diagnoses.length,
                unique_confirmed_diagnoses: counts.size,
                top_confirmed_diagnosis: topDiagnosis,
                top_confirmed_diagnosis_rate: roundScore(ratio(topCount, diagnoses.length)),
            };
        })
        .sort((left, right) => right.total_cases - left.total_cases || left.domain.localeCompare(right.domain));
}

function normalizeSeverity(value: unknown): { score: number | null; emergencyLevel: string | null; triagePriority: string | null } {
    const severity = normalizeText(readText(value));
    if (severity === 'critical' || severity === 'emergency') {
        return { score: 0.95, emergencyLevel: 'critical', triagePriority: 'immediate' };
    }
    if (severity === 'severe' || severity === 'high' || severity === 'urgent') {
        return { score: 0.8, emergencyLevel: 'high', triagePriority: 'same_day' };
    }
    if (severity === 'moderate') {
        return { score: 0.55, emergencyLevel: 'medium', triagePriority: 'priority' };
    }
    if (severity === 'mild' || severity === 'low') {
        return { score: 0.25, emergencyLevel: 'low', triagePriority: 'routine' };
    }
    return { score: null, emergencyLevel: null, triagePriority: null };
}

function buildDifferentialSpread(differentials: string[] | undefined): Record<string, unknown> | null {
    const normalized = normalizeStringArray(differentials);
    if (normalized.length === 0) return null;
    const denominator = normalized.reduce((sum, _entry, index) => sum + 1 / (index + 1), 0);
    return {
        source: 'vvrb',
        differentials: normalized.map((name, index) => ({
            name,
            probability: roundScore((1 / (index + 1)) / denominator),
        })),
    };
}

function buildVvrbDatasetVersion(cases: LearningCaseRecord[]): string {
    const digest = createHash('sha256');
    for (const clinicalCase of cases) {
        digest.update(clinicalCase.case_id);
        digest.update('\0');
    }
    return `vvrb-benchmark-${digest.digest('hex').slice(0, 16)}`;
}

function buildCalibrationBucket(confidence: number): string {
    const bucket = Math.max(0, Math.min(9, Math.floor(confidence * 10)));
    return `${bucket / 10}-${(bucket + 1) / 10}`;
}

function reasoningOpener(value: unknown): string | null {
    const text = readText(value);
    if (!text) return null;
    const opener = text.split(/\bbecause\b/i)[0] ?? text;
    return normalizeText(opener);
}

function hasOnlyGenericEvidenceSources(record: VvrbCaseRecord): boolean {
    const sources = normalizeStringArray(record.evidence_sources);
    if (sources.length === 0) return true;
    return sources.every((source) => GENERIC_EVIDENCE_SOURCE_PATTERNS.some((pattern) => pattern.test(source)));
}

function pearson(leftValues: Array<number | null>, rightValues: Array<number | null>): number | null {
    const pairs = leftValues
        .map((left, index) => [left, rightValues[index]] as const)
        .filter((pair): pair is readonly [number, number] => pair[0] != null && pair[1] != null);
    if (pairs.length < 3) return null;

    const leftMean = average(pairs.map(([left]) => left));
    const rightMean = average(pairs.map(([, right]) => right));
    let numerator = 0;
    let leftSum = 0;
    let rightSum = 0;
    for (const [left, right] of pairs) {
        const leftDelta = left - leftMean;
        const rightDelta = right - rightMean;
        numerator += leftDelta * rightDelta;
        leftSum += leftDelta ** 2;
        rightSum += rightDelta ** 2;
    }
    if (leftSum === 0 || rightSum === 0) return null;
    return numerator / Math.sqrt(leftSum * rightSum);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

function hashRecord(value: unknown): string {
    return createHash('sha256').update(stableJson(value)).digest('hex');
}

function topRate(values: Array<string | null>): number {
    const filtered = values.filter(isString);
    if (filtered.length === 0) return 0;
    const [, count] = topEntry(countValues(filtered));
    return count / filtered.length;
}

function mostCommon(values: string[]): string | null {
    if (values.length === 0) return null;
    return topEntry(countValues(values))[0];
}

function countValues(values: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
}

function topEntry(counts: Map<string, number>): [string | null, number] {
    let topKey: string | null = null;
    let topCount = 0;
    for (const [key, count] of counts.entries()) {
        if (count > topCount || (count === topCount && topKey != null && key < topKey)) {
            topKey = key;
            topCount = count;
        }
    }
    return [topKey, topCount];
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readScore(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : null;
}

function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(readText).filter(isString)
        : [];
}

function normalizeText(value: string | null): string {
    return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeKey(value: string): string {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function ratio(value: number, denominator: number): number {
    return denominator <= 0 ? 0 : value / denominator;
}

function average(values: number[]): number {
    return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundScore(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: string | null): value is string {
    return value != null && value.length > 0;
}
