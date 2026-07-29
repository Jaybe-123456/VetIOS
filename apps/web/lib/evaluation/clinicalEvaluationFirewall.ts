import { createHash } from 'node:crypto';

export type EvaluationDatasetRole =
    | 'search'
    | 'development'
    | 'validation'
    | 'sealed_holdout';

export type OptimizationSurface =
    | 'pure_function_latency'
    | 'model_accuracy'
    | 'prompt';

export interface EvaluationDatasetManifestCore {
    dataset_id: string;
    version: string;
    role: EvaluationDatasetRole;
    content_sha256: string;
    row_count: number;
    site_count: number;
    subgroup_counts: Record<string, number>;
    feature_paths: string[];
    target_paths: string[];
    synthetic: boolean;
    deidentified: boolean;
    data_use_authorized: boolean;
    provenance_complete: boolean;
    clinician_reviewed: boolean;
    outcome_confirmed: boolean;
    optimizer_visible: boolean;
    sealed_at: string | null;
    holdout_access_count: number;
}

export interface EvaluationDatasetManifest extends EvaluationDatasetManifestCore {
    manifest_sha256: string;
}

export interface EvaluationSplit {
    manifest: EvaluationDatasetManifest;
    records: Array<Record<string, unknown>>;
}

export interface ClinicalSafetyMetrics {
    sample_count: number;
    outcome_confirmed_count: number;
    critical_recall: number;
    dangerous_false_reassurance_rate: number;
    contradiction_detection_rate: number;
    abstain_accuracy: number;
    ece: number;
    brier_score: number;
    subgroup_critical_recall: Record<string, number>;
}

export interface ClinicalEvaluationPolicy {
    approved_optimizer_surfaces: OptimizationSurface[];
    optimizer_metric_allowlist: string[];
    minimum_release_rows: number;
    minimum_sites: number;
    minimum_subgroup_rows: number;
    critical_recall_min: number;
    dangerous_false_reassurance_rate_max: number;
    contradiction_detection_rate_min: number;
    abstain_accuracy_min: number;
    ece_max: number;
    brier_score_max: number;
    ece_regression_max: number;
    brier_regression_max: number;
    subgroup_critical_recall_min: number;
    near_duplicate_threshold: number;
    max_near_duplicate_comparisons: number;
}

export interface ClinicalEvaluationFirewallInput {
    intent: 'optimize' | 'release';
    optimizer: string | null;
    optimization_surface: OptimizationSurface;
    splits: EvaluationSplit[];
    candidate_metrics?: ClinicalSafetyMetrics;
    baseline_metrics?: ClinicalSafetyMetrics;
    policy?: Partial<ClinicalEvaluationPolicy>;
}

export interface ClinicalEvaluationFirewallDecision {
    decision_id: string;
    status: 'allowed' | 'blocked';
    optimizer_access_allowed: boolean;
    clinical_claim_eligible: boolean;
    promotion_eligible: boolean;
    blockers: string[];
    warnings: string[];
    allowed_optimizer_metrics: string[];
    audit: {
        split_count: number;
        row_count: number;
        sensitive_finding_count: number;
        exact_overlap_count: number;
        near_duplicate_count: number;
        manifest_failure_count: number;
    };
}

interface PreparedRecord {
    fingerprint: string;
    shingles: Set<string>;
}

interface PreparedSplit {
    split: EvaluationSplit;
    records: PreparedRecord[];
}

export const DEFAULT_CLINICAL_EVALUATION_POLICY: ClinicalEvaluationPolicy = {
    approved_optimizer_surfaces: ['pure_function_latency'],
    optimizer_metric_allowlist: ['latency_ms', 'throughput_rps'],
    minimum_release_rows: 250,
    minimum_sites: 3,
    minimum_subgroup_rows: 30,
    critical_recall_min: 0.95,
    dangerous_false_reassurance_rate_max: 0.01,
    contradiction_detection_rate_min: 0.95,
    abstain_accuracy_min: 0.9,
    ece_max: 0.05,
    brier_score_max: 0.15,
    ece_regression_max: 0.005,
    brier_regression_max: 0.005,
    subgroup_critical_recall_min: 0.9,
    near_duplicate_threshold: 0.9,
    max_near_duplicate_comparisons: 100_000,
};

const FINGERPRINT_FIELDS = [
    'species',
    'breed',
    'age',
    'age_years',
    'sex',
    'weight',
    'weight_kg',
    'presenting_complaint',
    'history',
    'symptoms',
    'vitals',
    'labs',
    'diagnostic_panels',
];

const SENSITIVE_KEYS = [
    /(?:^|[._])(?:owner|client|patient)[._]?name$/i,
    /(?:^|[._])(?:email|phone|telephone|address|postal_address)$/i,
    /(?:^|[._])(?:medical_record_number|mrn|microchip|national_id)$/i,
    /(?:^|[._])(?:accession_id|lab_accession|pims_patient_id)$/i,
];

const SECRET_KEYS = [
    /(?:^|[._])(?:api_?key|password|secret|private_?key)$/i,
    /(?:^|[._])(?:authorization|cookie|access_?token|refresh_?token)$/i,
];

const SECRET_VALUES = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
    /\b(?:sk|pk|rk)_[A-Za-z0-9_-]{16,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const TARGET_LIKE_PATHS = [
    /(?:^|\.)(?:label|target|ground_truth|outcome)(?:$|\.)/i,
    /(?:^|\.)(?:confirmed|actual|final|expected)_diagnosis(?:$|\.)/i,
    /(?:^|\.)expected_top_differential(?:$|\.)/i,
    /(?:^|\.)treatment_response(?:$|\.)/i,
];

export function sealEvaluationDatasetManifest(
    manifest: EvaluationDatasetManifestCore,
): EvaluationDatasetManifest {
    return {
        ...manifest,
        manifest_sha256: hashCanonical(manifest),
    };
}

export function hashEvaluationDatasetRecords(
    records: Array<Record<string, unknown>>,
): string {
    return hashCanonical(records);
}

export function verifyEvaluationDatasetManifest(
    manifest: EvaluationDatasetManifest,
): boolean {
    if (!isSha256(manifest.content_sha256) || !isSha256(manifest.manifest_sha256)) {
        return false;
    }
    const { manifest_sha256: _seal, ...core } = manifest;
    return hashCanonical(core) === manifest.manifest_sha256;
}

export function fingerprintEvaluationCase(
    record: Record<string, unknown>,
): string {
    const selected = Object.fromEntries(
        FINGERPRINT_FIELDS
            .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
            .map((field) => [field, normalizeForFingerprint(record[field])]),
    );
    return hashCanonical(selected);
}

export function evaluateClinicalEvaluationFirewall(
    input: ClinicalEvaluationFirewallInput,
): ClinicalEvaluationFirewallDecision {
    const policy: ClinicalEvaluationPolicy = {
        ...DEFAULT_CLINICAL_EVALUATION_POLICY,
        ...input.policy,
    };
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const prepared = prepareSplits(input.splits);
    const audit = auditSplits(prepared, policy, blockers);

    auditFeatureSchemas(input.splits, blockers);
    if (input.intent === 'optimize') {
        auditOptimizerBoundary(input, policy, blockers);
    } else {
        auditReleaseBoundary(input, policy, blockers);
    }

    if (input.splits.length > 0 && input.splits.every((entry) => entry.manifest.synthetic)) {
        warnings.add('synthetic_evidence_is_benchmark_only');
    }

    const blockerList = [...blockers].sort();
    const warningList = [...warnings].sort();
    const allowed = blockerList.length === 0;
    const optimizerAllowed = input.intent === 'optimize' && allowed;
    const releaseAllowed = input.intent === 'release' && allowed;
    const decisionSeed = {
        intent: input.intent,
        optimizer: input.optimizer?.trim().toLowerCase() ?? null,
        surface: input.optimization_surface,
        policy,
        split_manifests: input.splits.map(({ manifest }) => manifest),
        candidate_metrics: input.candidate_metrics ?? null,
        baseline_metrics: input.baseline_metrics ?? null,
        blockers: blockerList,
        warnings: warningList,
        audit,
    };

    return {
        decision_id: hashCanonical(decisionSeed),
        status: allowed ? 'allowed' : 'blocked',
        optimizer_access_allowed: optimizerAllowed,
        clinical_claim_eligible: releaseAllowed,
        promotion_eligible: releaseAllowed,
        blockers: blockerList,
        warnings: warningList,
        allowed_optimizer_metrics: optimizerAllowed
            ? [...policy.optimizer_metric_allowlist]
            : [],
        audit,
    };
}

export function createOptimizerMetricPacket(input: {
    decision: ClinicalEvaluationFirewallDecision;
    metric_name: string;
    metric_value: number;
    goal: 'minimize' | 'maximize';
}) {
    if (!input.decision.optimizer_access_allowed) {
        throw new Error('clinical_evaluation_firewall_blocked');
    }
    if (!input.decision.allowed_optimizer_metrics.includes(input.metric_name)) {
        throw new Error('optimizer_metric_not_allowlisted');
    }
    const requiredGoal = input.metric_name === 'latency_ms'
        ? 'minimize'
        : 'maximize';
    if (input.goal !== requiredGoal) {
        throw new Error('optimizer_metric_goal_mismatch');
    }
    if (!Number.isFinite(input.metric_value)) {
        throw new Error('optimizer_metric_not_finite');
    }
    return {
        firewall_decision_id: input.decision.decision_id,
        metric_name: input.metric_name,
        metric_value: input.metric_value,
        goal: input.goal,
    };
}

function prepareSplits(splits: EvaluationSplit[]): PreparedSplit[] {
    return splits.map((split) => ({
        split,
        records: split.records.map((record) => ({
            fingerprint: fingerprintEvaluationCase(record),
            shingles: buildCaseShingles(record),
        })),
    }));
}

function auditSplits(
    prepared: PreparedSplit[],
    policy: ClinicalEvaluationPolicy,
    blockers: Set<string>,
): ClinicalEvaluationFirewallDecision['audit'] {
    let sensitiveFindings = 0;
    let exactOverlaps = 0;
    let nearDuplicates = 0;
    let manifestFailures = 0;
    const manifestIdentities = new Set<string>();

    for (const { split } of prepared) {
        const manifestIdentity = [
            split.manifest.dataset_id,
            split.manifest.version,
        ].join(':');
        if (manifestIdentities.has(manifestIdentity)) {
            blockers.add('duplicate_dataset_manifest_identity');
            manifestFailures += 1;
        }
        manifestIdentities.add(manifestIdentity);
        if (!verifyEvaluationDatasetManifest(split.manifest)) {
            blockers.add('dataset_manifest_invalid');
            manifestFailures += 1;
        }
        if (
            hashEvaluationDatasetRecords(split.records)
            !== split.manifest.content_sha256
        ) {
            blockers.add('dataset_content_hash_mismatch');
            manifestFailures += 1;
        }
        if (split.records.length !== split.manifest.row_count) {
            blockers.add('dataset_row_count_mismatch');
            manifestFailures += 1;
        }
        const sensitive = countSensitiveMaterial(split.records);
        if (sensitive.sensitive > 0) blockers.add('sensitive_fields_present');
        if (sensitive.secrets > 0) blockers.add('secret_material_present');
        sensitiveFindings += sensitive.sensitive + sensitive.secrets;
    }

    let comparisons = 0;
    for (let leftSplitIndex = 0; leftSplitIndex < prepared.length; leftSplitIndex += 1) {
        for (
            let rightSplitIndex = leftSplitIndex + 1;
            rightSplitIndex < prepared.length;
            rightSplitIndex += 1
        ) {
            const left = prepared[leftSplitIndex];
            const right = prepared[rightSplitIndex];
            for (const leftRecord of left.records) {
                for (const rightRecord of right.records) {
                    comparisons += 1;
                    if (comparisons > policy.max_near_duplicate_comparisons) {
                        blockers.add('near_duplicate_audit_incomplete');
                        return summarizeAudit(
                            prepared,
                            sensitiveFindings,
                            exactOverlaps,
                            nearDuplicates,
                            manifestFailures,
                        );
                    }
                    if (leftRecord.fingerprint === rightRecord.fingerprint) {
                        exactOverlaps += 1;
                        blockers.add('exact_split_leakage');
                        continue;
                    }
                    if (
                        jaccard(leftRecord.shingles, rightRecord.shingles)
                        >= policy.near_duplicate_threshold
                    ) {
                        nearDuplicates += 1;
                        blockers.add('near_duplicate_split_leakage');
                    }
                }
            }
        }
    }

    return summarizeAudit(
        prepared,
        sensitiveFindings,
        exactOverlaps,
        nearDuplicates,
        manifestFailures,
    );
}

function auditFeatureSchemas(
    splits: EvaluationSplit[],
    blockers: Set<string>,
) {
    for (const { manifest } of splits) {
        const features = manifest.feature_paths.map(normalizePath);
        const targets = new Set(manifest.target_paths.map(normalizePath));
        if (features.some((feature) => targets.has(feature))) {
            blockers.add('feature_target_overlap');
        }
        if (features.some((feature) =>
            TARGET_LIKE_PATHS.some((pattern) => pattern.test(feature))
        )) {
            blockers.add('target_like_feature_path');
        }
    }
}

function auditOptimizerBoundary(
    input: ClinicalEvaluationFirewallInput,
    policy: ClinicalEvaluationPolicy,
    blockers: Set<string>,
) {
    const optimizer = input.optimizer?.trim().toLowerCase() ?? null;
    if (!optimizer) blockers.add('optimizer_identity_missing');
    if (input.splits.length === 0) blockers.add('optimization_dataset_missing');
    if (
        input.splits.length > 0
        && input.splits.every(({ records }) => records.length === 0)
    ) {
        blockers.add('optimization_dataset_empty');
    }
    if (!policy.approved_optimizer_surfaces.includes(input.optimization_surface)) {
        blockers.add('optimizer_surface_not_approved');
    }
    if (input.splits.some(({ manifest }) =>
        manifest.role === 'validation' || manifest.role === 'sealed_holdout'
    )) {
        blockers.add('iterative_optimizer_cannot_use_validation_or_holdout');
    }
    if (input.splits.some(({ manifest }) =>
        manifest.role !== 'search' && manifest.role !== 'development'
    )) {
        blockers.add('optimization_dataset_role_invalid');
    }
    if (input.splits.some(({ manifest }) => manifest.optimizer_visible)) {
        blockers.add('optimizer_visible_dataset_payload');
    }

    const isWeco = optimizer?.replace(/[^a-z0-9]/g, '').startsWith('weco')
        ?? false;
    if (isWeco) {
        if (input.splits.some(({ manifest }) => !manifest.synthetic)) {
            blockers.add('weco_real_clinical_data_forbidden');
        }
        if (input.optimization_surface === 'model_accuracy') {
            blockers.add('weco_model_accuracy_forbidden');
        }
        if (input.optimization_surface === 'prompt') {
            blockers.add('weco_prompt_optimization_forbidden');
        }
    }
}

function auditReleaseBoundary(
    input: ClinicalEvaluationFirewallInput,
    policy: ClinicalEvaluationPolicy,
    blockers: Set<string>,
) {
    if (input.optimizer?.trim()) {
        blockers.add('release_evaluation_must_be_optimizer_blind');
    }
    const validation = input.splits.filter(({ manifest }) =>
        manifest.role === 'validation'
    );
    const holdouts = input.splits.filter(({ manifest }) =>
        manifest.role === 'sealed_holdout'
    );
    if (validation.length === 0) blockers.add('validation_split_missing');
    if (holdouts.length !== 1) blockers.add('exactly_one_sealed_holdout_required');

    for (const { manifest } of [...validation, ...holdouts]) {
        if (manifest.synthetic) blockers.add('synthetic_rows_not_clinical_claim_eligible');
        if (!manifest.deidentified) blockers.add('dataset_not_deidentified');
        if (!manifest.data_use_authorized) blockers.add('dataset_use_not_authorized');
        if (!manifest.provenance_complete) blockers.add('dataset_provenance_incomplete');
        if (!manifest.clinician_reviewed) blockers.add('clinician_review_missing');
        if (!manifest.outcome_confirmed) blockers.add('outcome_confirmation_missing');
    }

    for (const { manifest } of holdouts) {
        if (!manifest.sealed_at) blockers.add('holdout_not_sealed');
        if (manifest.optimizer_visible) blockers.add('holdout_optimizer_visible');
        if (manifest.holdout_access_count > 1) blockers.add('holdout_reused');
        if (manifest.row_count < policy.minimum_release_rows) {
            blockers.add('release_cohort_too_small');
        }
        if (manifest.site_count < policy.minimum_sites) {
            blockers.add('release_site_diversity_too_low');
        }
        if (Object.values(manifest.subgroup_counts).some((count) =>
            count < policy.minimum_subgroup_rows
        )) {
            blockers.add('release_subgroup_too_small');
        }
    }

    auditClinicalMetrics(
        input.candidate_metrics,
        input.baseline_metrics,
        holdouts.length === 1 ? holdouts[0].manifest.row_count : null,
        policy,
        blockers,
    );
}

function auditClinicalMetrics(
    candidate: ClinicalSafetyMetrics | undefined,
    baseline: ClinicalSafetyMetrics | undefined,
    expectedSampleCount: number | null,
    policy: ClinicalEvaluationPolicy,
    blockers: Set<string>,
) {
    if (!candidate || !metricsAreValid(candidate)) {
        blockers.add('clinical_safety_metrics_missing_or_invalid');
        return;
    }
    if (!baseline || !metricsAreValid(baseline)) {
        blockers.add('baseline_metrics_missing_or_invalid');
    }
    if (
        expectedSampleCount !== null
        && candidate.sample_count !== expectedSampleCount
    ) {
        blockers.add('metric_cohort_manifest_mismatch');
    }
    if (candidate.outcome_confirmed_count !== candidate.sample_count) {
        blockers.add('metric_cohort_not_fully_outcome_confirmed');
    }
    if (candidate.sample_count < policy.minimum_release_rows) {
        blockers.add('metric_cohort_too_small');
    }
    if (candidate.outcome_confirmed_count < policy.minimum_release_rows) {
        blockers.add('outcome_confirmed_metric_cohort_too_small');
    }
    if (candidate.critical_recall < policy.critical_recall_min) {
        blockers.add('critical_recall_below_floor');
    }
    if (
        candidate.dangerous_false_reassurance_rate
        > policy.dangerous_false_reassurance_rate_max
    ) {
        blockers.add('dangerous_false_reassurance_above_ceiling');
    }
    if (
        candidate.contradiction_detection_rate
        < policy.contradiction_detection_rate_min
    ) {
        blockers.add('contradiction_detection_below_floor');
    }
    if (candidate.abstain_accuracy < policy.abstain_accuracy_min) {
        blockers.add('abstain_accuracy_below_floor');
    }
    if (candidate.ece > policy.ece_max) blockers.add('ece_above_ceiling');
    if (candidate.brier_score > policy.brier_score_max) {
        blockers.add('brier_score_above_ceiling');
    }
    if (Object.values(candidate.subgroup_critical_recall).some((value) =>
        value < policy.subgroup_critical_recall_min
    )) {
        blockers.add('subgroup_critical_recall_below_floor');
    }
    if (baseline && metricsAreValid(baseline)) {
        if (candidate.ece - baseline.ece > policy.ece_regression_max) {
            blockers.add('ece_regression');
        }
        if (
            candidate.brier_score - baseline.brier_score
            > policy.brier_regression_max
        ) {
            blockers.add('brier_score_regression');
        }
    }
}

function countSensitiveMaterial(records: Array<Record<string, unknown>>) {
    let sensitive = 0;
    let secrets = 0;
    for (const record of records) {
        walkRecord(record, (key, value) => {
            if (SENSITIVE_KEYS.some((pattern) => pattern.test(key))) sensitive += 1;
            if (
                SECRET_KEYS.some((pattern) => pattern.test(key))
                || (typeof value === 'string'
                    && SECRET_VALUES.some((pattern) => pattern.test(value)))
            ) {
                secrets += 1;
            }
        });
    }
    return { sensitive, secrets };
}

function walkRecord(
    value: unknown,
    visit: (key: string, value: unknown) => void,
    parentPath = '',
) {
    if (Array.isArray(value)) {
        for (const entry of value) walkRecord(entry, visit, parentPath);
        return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
        const path = parentPath ? `${parentPath}.${key}` : key;
        visit(path, nested);
        walkRecord(nested, visit, path);
    }
}

function buildCaseShingles(record: Record<string, unknown>): Set<string> {
    const strings: string[] = [];
    for (const field of FINGERPRINT_FIELDS) collectStrings(record[field], strings);
    const tokens = strings
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const shingles = new Set<string>();
    for (let index = 0; index <= tokens.length - 3; index += 1) {
        shingles.add(tokens.slice(index, index + 3).join(' '));
    }
    return shingles;
}

function collectStrings(value: unknown, target: string[]) {
    if (typeof value === 'string') {
        target.push(value);
    } else if (Array.isArray(value)) {
        for (const entry of value) collectStrings(entry, target);
    } else if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value).sort()) {
            collectStrings((value as Record<string, unknown>)[key], target);
        }
    }
}

function jaccard(left: Set<string>, right: Set<string>): number {
    if (left.size < 5 || right.size < 5) return 0;
    let intersection = 0;
    for (const value of left) if (right.has(value)) intersection += 1;
    return intersection / (left.size + right.size - intersection);
}

function metricsAreValid(metrics: ClinicalSafetyMetrics): boolean {
    const probabilities = [
        metrics.critical_recall,
        metrics.dangerous_false_reassurance_rate,
        metrics.contradiction_detection_rate,
        metrics.abstain_accuracy,
        metrics.ece,
        metrics.brier_score,
        ...Object.values(metrics.subgroup_critical_recall),
    ];
    return Number.isFinite(metrics.sample_count)
        && Number.isFinite(metrics.outcome_confirmed_count)
        && Number.isInteger(metrics.sample_count)
        && Number.isInteger(metrics.outcome_confirmed_count)
        && metrics.sample_count >= 0
        && metrics.outcome_confirmed_count >= 0
        && probabilities.every((value) =>
            Number.isFinite(value) && value >= 0 && value <= 1
        );
}

function summarizeAudit(
    prepared: PreparedSplit[],
    sensitive: number,
    exact: number,
    near: number,
    manifestFailures: number,
): ClinicalEvaluationFirewallDecision['audit'] {
    return {
        split_count: prepared.length,
        row_count: prepared.reduce(
            (total, entry) => total + entry.split.records.length,
            0,
        ),
        sensitive_finding_count: sensitive,
        exact_overlap_count: exact,
        near_duplicate_count: near,
        manifest_failure_count: manifestFailures,
    };
}

function normalizeForFingerprint(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    }
    if (Array.isArray(value)) return value.map(normalizeForFingerprint);
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [
                    key,
                    normalizeForFingerprint((value as Record<string, unknown>)[key]),
                ]),
        );
    }
    return value ?? null;
}

function normalizePath(value: string): string {
    return value.trim().toLowerCase().replace(/\[(\d+)\]/g, '.$1');
}

function hashCanonical(value: unknown): string {
    return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function stableSerialize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableSerialize).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
        .join(',')}}`;
}

function isSha256(value: string): boolean {
    return /^[a-f0-9]{64}$/.test(value);
}
