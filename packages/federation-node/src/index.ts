import { createHash, randomUUID } from 'crypto';

export type FederationNodeTaskType =
    | 'diagnosis_delta'
    | 'severity_delta'
    | 'support_summary'
    | 'secure_aggregation_key'
    | 'unmask_share';

export type FederatedUpdateRole = 'diagnosis' | 'severity' | 'support' | 'unmask_share';

export type OutcomeConfirmationStatus =
    | 'unconfirmed'
    | 'clinician_confirmed'
    | 'expert_reviewed'
    | 'lab_confirmed'
    | 'outcome_linked';

export type ProvenanceStatus =
    | 'not_verified'
    | 'source_attested'
    | 'hash_verified'
    | 'reviewer_verified'
    | 'externally_verified';

export interface LocalClinicalLearningRecord {
    local_record_id: string;
    species?: string | null;
    breed?: string | null;
    age_years?: number | null;
    sex?: string | null;
    signs?: string[] | null;
    duration_days?: number | null;
    labs?: Record<string, unknown> | null;
    imaging?: Record<string, unknown> | null;
    treatment?: Record<string, unknown> | null;
    diagnosis?: string | null;
    outcome?: string | null;
    outcome_confirmed?: boolean | null;
    lab_confirmed?: boolean | null;
    expert_reviewed?: boolean | null;
    clinician_confirmed?: boolean | null;
    amr_related?: boolean | null;
    culture_collected?: boolean | null;
    consent_status?: 'unknown' | 'granted' | 'denied' | 'revoked' | 'not_required' | null;
    provenance_status?: ProvenanceStatus | null;
    source_system?: string | null;
    observed_at?: string | null;
}

export interface EligibilityPolicy {
    minimumTrustScore: number;
    requireConsent: boolean;
    requireOutcomeConfirmation: boolean;
    requireProvenance: boolean;
}

export interface LearningRecordEligibility {
    local_record_id: string;
    record_hash: string;
    consent_status: NonNullable<LocalClinicalLearningRecord['consent_status']>;
    outcome_confirmation_status: OutcomeConfirmationStatus;
    provenance_status: ProvenanceStatus;
    trust_score: number;
    trust_score_components: {
        consent: number;
        outcome: number;
        provenance: number;
        clinical_completeness: number;
        amr_context: number;
    };
    eligible_for_federation: boolean;
    exclusion_reasons: string[];
    public_summary: {
        species: string | null;
        has_labs: boolean;
        has_imaging: boolean;
        has_treatment: boolean;
        amr_related: boolean;
        source_system: string | null;
    };
}

export interface FederatedOutcomeEligibilitySnapshotDraft {
    tenant_id: string;
    federation_key: string;
    partner_ref: string | null;
    outcome_confirmed_rows: number;
    lab_confirmed_rows: number;
    expert_reviewed_rows: number;
    synthetic_rows_excluded: number;
    consented_network_learning_rows: number;
    provenance_verified_rows: number;
    trust_scored_rows: number;
    amr_outcome_linked_rows: number;
    minimum_required_rows: number;
    minimum_provenance_rows: number;
    minimum_trust_scored_rows: number;
    minimum_trust_score: number;
    average_trust_score: number;
    eligibility_status: 'eligible' | 'insufficient_evidence' | 'blocked';
    blockers: string[];
    source_hash_bundle: Record<string, unknown>;
    source_record_digest: string;
    evidence: Record<string, unknown>;
}

export interface FederationRoundTask {
    id: string;
    federation_round_id: string;
    federation_key: string;
    round_key: string;
    node_ref: string;
    partner_ref: string;
    task_type: FederationNodeTaskType;
    plan_hash: string;
    dataset_policy?: Record<string, unknown> | null;
    secure_aggregation_config?: Record<string, unknown> | null;
    task_payload?: Record<string, unknown> | null;
}

export interface MaskedUpdateCommitment {
    request_id: string;
    round_node_task_id: string;
    outcome_eligibility_snapshot_id: string | null;
    node_ref: string;
    partner_ref: string;
    contribution_role: FederatedUpdateRole;
    payload_commitment_hash: string;
    mask_commitment_hash: string;
    signed_payload_hash: string;
    signature_algorithm: 'sha256-hmac-simulation';
    signature_hash: string;
    signing_key_fingerprint: string;
    masked_update_summary: Record<string, unknown>;
    public_summary: Record<string, unknown>;
    evidence: Record<string, unknown>;
}

export interface VetiosFederationNodeClientOptions {
    baseUrl: string;
    machineToken: string;
    federationKey: string;
    nodeRef: string;
    partnerRef?: string | null;
    fetchImpl?: typeof fetch;
}

const DEFAULT_POLICY: EligibilityPolicy = {
    minimumTrustScore: 0.7,
    requireConsent: true,
    requireOutcomeConfirmation: true,
    requireProvenance: true,
};

export function assessLearningRecordEligibility(
    record: LocalClinicalLearningRecord,
    policy: Partial<EligibilityPolicy> = {},
): LearningRecordEligibility {
    const resolvedPolicy = { ...DEFAULT_POLICY, ...policy };
    const canonical = canonicalizeRecord(record);
    const recordHash = stableHash(canonical);
    const consentStatus = record.consent_status ?? 'unknown';
    const outcomeStatus = resolveOutcomeConfirmationStatus(record);
    const provenanceStatus = record.provenance_status ?? 'not_verified';
    const components = {
        consent: consentStatus === 'granted' || consentStatus === 'not_required' ? 1 : 0,
        outcome: outcomeScore(outcomeStatus),
        provenance: provenanceScore(provenanceStatus),
        clinical_completeness: clinicalCompletenessScore(record),
        amr_context: record.amr_related || record.culture_collected ? 1 : 0.5,
    };
    const trustScore = roundScore(
        components.consent * 0.2
        + components.outcome * 0.35
        + components.provenance * 0.25
        + components.clinical_completeness * 0.15
        + components.amr_context * 0.05,
    );
    const exclusionReasons = [
        resolvedPolicy.requireConsent && components.consent === 0 ? 'consent_not_granted' : null,
        resolvedPolicy.requireOutcomeConfirmation && components.outcome < 0.75 ? 'outcome_not_confirmed' : null,
        resolvedPolicy.requireProvenance && components.provenance < 0.75 ? 'provenance_not_verified' : null,
        trustScore < resolvedPolicy.minimumTrustScore ? 'trust_score_below_threshold' : null,
        !canonical.species ? 'species_missing' : null,
        !(canonical.signs as string[]).length ? 'clinical_signs_missing' : null,
    ].filter((reason): reason is string => reason != null);

    return {
        local_record_id: record.local_record_id,
        record_hash: recordHash,
        consent_status: consentStatus,
        outcome_confirmation_status: outcomeStatus,
        provenance_status: provenanceStatus,
        trust_score: trustScore,
        trust_score_components: components,
        eligible_for_federation: exclusionReasons.length === 0,
        exclusion_reasons: exclusionReasons,
        public_summary: {
            species: canonical.species as string | null,
            has_labs: Object.keys(canonical.labs as Record<string, unknown>).length > 0,
            has_imaging: Object.keys(canonical.imaging as Record<string, unknown>).length > 0,
            has_treatment: Object.keys(canonical.treatment as Record<string, unknown>).length > 0,
            amr_related: record.amr_related === true,
            source_system: normalizeText(record.source_system),
        },
    };
}

export function buildOutcomeEligibilitySnapshotDraft(input: {
    tenantId: string;
    federationKey: string;
    partnerRef?: string | null;
    records: LocalClinicalLearningRecord[];
    policy?: Partial<EligibilityPolicy>;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
}): FederatedOutcomeEligibilitySnapshotDraft {
    const policy = { ...DEFAULT_POLICY, ...(input.policy ?? {}) };
    const eligibilities = input.records.map((record) => assessLearningRecordEligibility(record, policy));
    const eligible = eligibilities.filter((row) => row.eligible_for_federation);
    const minimumRequiredRows = input.minimumRequiredRows ?? 20;
    const minimumProvenanceRows = input.minimumProvenanceRows ?? minimumRequiredRows;
    const minimumTrustScoredRows = input.minimumTrustScoredRows ?? minimumRequiredRows;
    const provenanceVerifiedRows = eligibilities.filter((row) => provenanceScore(row.provenance_status) >= 0.75).length;
    const trustScoredRows = eligibilities.filter((row) => row.trust_score >= policy.minimumTrustScore).length;
    const outcomeConfirmedRows = eligibilities.filter((row) => outcomeScore(row.outcome_confirmation_status) >= 0.75).length;
    const blockers = [
        eligible.length < minimumRequiredRows ? 'eligible_rows_below_minimum' : null,
        provenanceVerifiedRows < minimumProvenanceRows ? 'provenance_rows_below_minimum' : null,
        trustScoredRows < minimumTrustScoredRows ? 'trust_scored_rows_below_minimum' : null,
    ].filter((blocker): blocker is string => blocker != null);
    const sourceRecordHashes = eligibilities.map((row) => row.record_hash).sort();

    return {
        tenant_id: input.tenantId,
        federation_key: input.federationKey,
        partner_ref: input.partnerRef ?? null,
        outcome_confirmed_rows: outcomeConfirmedRows,
        lab_confirmed_rows: input.records.filter((record) => record.lab_confirmed === true).length,
        expert_reviewed_rows: input.records.filter((record) => record.expert_reviewed === true).length,
        synthetic_rows_excluded: 0,
        consented_network_learning_rows: eligibilities.filter((row) => row.consent_status === 'granted' || row.consent_status === 'not_required').length,
        provenance_verified_rows: provenanceVerifiedRows,
        trust_scored_rows: trustScoredRows,
        amr_outcome_linked_rows: input.records.filter((record) => record.amr_related === true && record.outcome_confirmed === true).length,
        minimum_required_rows: minimumRequiredRows,
        minimum_provenance_rows: minimumProvenanceRows,
        minimum_trust_scored_rows: minimumTrustScoredRows,
        minimum_trust_score: policy.minimumTrustScore,
        average_trust_score: average(eligibilities.map((row) => row.trust_score)),
        eligibility_status: blockers.length === 0 ? 'eligible' : 'insufficient_evidence',
        blockers,
        source_hash_bundle: {
            record_hashes: sourceRecordHashes,
            eligibility_hash: stableHash(eligibilities),
            policy_hash: stableHash(policy),
        },
        source_record_digest: stableHash(sourceRecordHashes),
        evidence: {
            package: '@vetios/federation-node',
            raw_records_shared: false,
            raw_owner_identifiers_shared: false,
            record_count: input.records.length,
            eligible_record_count: eligible.length,
            exclusion_reasons: aggregateExclusionReasons(eligibilities),
        },
    };
}

export function buildMaskedUpdateCommitment(input: {
    task: FederationRoundTask;
    eligibleRecords: LearningRecordEligibility[];
    outcomeEligibilitySnapshotId?: string | null;
    secret: string;
    requestId?: string;
}): MaskedUpdateCommitment {
    const eligibleRecords = input.eligibleRecords.filter((record) => record.eligible_for_federation);
    const contributionRole = contributionRoleForTaskType(input.task.task_type);
    const recordDigest = stableHash(eligibleRecords.map((record) => record.record_hash).sort());
    const payloadCommitmentHash = stableHash({
        federation_round_id: input.task.federation_round_id,
        round_node_task_id: input.task.id,
        contribution_role: contributionRole,
        record_digest: recordDigest,
        plan_hash: input.task.plan_hash,
    });
    const maskCommitmentHash = stableHash({
        payload_commitment_hash: payloadCommitmentHash,
        node_ref: input.task.node_ref,
        secret_commitment: stableHash(input.secret),
    });
    const signedPayloadHash = stableHash({
        payload_commitment_hash: payloadCommitmentHash,
        mask_commitment_hash: maskCommitmentHash,
    });

    return {
        request_id: input.requestId ?? randomUUID(),
        round_node_task_id: input.task.id,
        outcome_eligibility_snapshot_id: input.outcomeEligibilitySnapshotId ?? null,
        node_ref: input.task.node_ref,
        partner_ref: input.task.partner_ref,
        contribution_role: contributionRole,
        payload_commitment_hash: payloadCommitmentHash,
        mask_commitment_hash: maskCommitmentHash,
        signed_payload_hash: signedPayloadHash,
        signature_algorithm: 'sha256-hmac-simulation',
        signature_hash: stableHash(`${signedPayloadHash}:${input.secret}`),
        signing_key_fingerprint: stableHash(input.secret).slice(0, 32),
        masked_update_summary: {
            schema: 'vetios_masked_update_summary_v1',
            contribution_role: contributionRole,
            eligible_record_count: eligibleRecords.length,
            record_digest: recordDigest,
            raw_delta_included: false,
            raw_records_included: false,
        },
        public_summary: {
            species_counts: countBy(eligibleRecords.map((record) => record.public_summary.species ?? 'unknown')),
            eligible_record_count: eligibleRecords.length,
            average_trust_score: average(eligibleRecords.map((record) => record.trust_score)),
            contribution_role: contributionRole,
        },
        evidence: {
            generated_by: '@vetios/federation-node',
            task_plan_hash: input.task.plan_hash,
            secure_aggregation_boundary: 'commitments_only_no_raw_delta',
            local_training_data_shared: false,
        },
    };
}

export class VetiosFederationNodeClient {
    private readonly fetchImpl: typeof fetch;
    private readonly baseUrl: string;
    private readonly options: VetiosFederationNodeClientOptions;

    constructor(options: VetiosFederationNodeClientOptions) {
        this.options = options;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    }

    heartbeat(payload: Record<string, unknown> = {}) {
        return this.post('/api/federation/v1/rounds/current', {
            federation_key: this.options.federationKey,
            node_ref: this.options.nodeRef,
            partner_ref: this.options.partnerRef,
            runtime_event: 'heartbeat',
            node_status: 'online',
            evidence: payload,
        });
    }

    getCurrentRound() {
        const params = new URLSearchParams({
            federation_key: this.options.federationKey,
            node_ref: this.options.nodeRef,
        });
        return this.get(`/api/federation/v1/rounds/current?${params.toString()}`);
    }

    pullTask(roundId: string, taskId: string) {
        const params = new URLSearchParams({
            federation_key: this.options.federationKey,
            node_ref: this.options.nodeRef,
        });
        return this.get(`/api/federation/v1/rounds/${roundId}/tasks/${taskId}/pull?${params.toString()}`);
    }

    submitUpdate(roundId: string, commitment: MaskedUpdateCommitment) {
        return this.post(`/api/federation/v1/rounds/${roundId}/updates`, {
            federation_key: this.options.federationKey,
            ...commitment,
        });
    }

    private async get(path: string): Promise<unknown> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            headers: this.headers(),
        });
        return readJsonResponse(response);
    }

    private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        return readJsonResponse(response);
    }

    private headers(): HeadersInit {
        return {
            Authorization: `Bearer ${this.options.machineToken}`,
            'Content-Type': 'application/json',
        };
    }
}

function canonicalizeRecord(record: LocalClinicalLearningRecord): Record<string, unknown> {
    return {
        local_record_id: record.local_record_id,
        species: normalizeText(record.species),
        breed: normalizeText(record.breed),
        age_years: finiteNumber(record.age_years),
        sex: normalizeText(record.sex),
        signs: normalizeList(record.signs),
        duration_days: finiteNumber(record.duration_days),
        labs: normalizeRecord(record.labs),
        imaging: normalizeRecord(record.imaging),
        treatment: normalizeRecord(record.treatment),
        diagnosis: normalizeText(record.diagnosis),
        outcome: normalizeText(record.outcome),
        observed_at: normalizeText(record.observed_at),
    };
}

function resolveOutcomeConfirmationStatus(record: LocalClinicalLearningRecord): OutcomeConfirmationStatus {
    if (record.outcome_confirmed) return 'outcome_linked';
    if (record.lab_confirmed) return 'lab_confirmed';
    if (record.expert_reviewed) return 'expert_reviewed';
    if (record.clinician_confirmed) return 'clinician_confirmed';
    return 'unconfirmed';
}

function outcomeScore(status: OutcomeConfirmationStatus): number {
    if (status === 'outcome_linked') return 1;
    if (status === 'lab_confirmed') return 0.95;
    if (status === 'expert_reviewed') return 0.9;
    if (status === 'clinician_confirmed') return 0.8;
    return 0;
}

function provenanceScore(status: ProvenanceStatus): number {
    if (status === 'externally_verified') return 1;
    if (status === 'reviewer_verified') return 0.9;
    if (status === 'hash_verified') return 0.85;
    if (status === 'source_attested') return 0.75;
    return 0;
}

function clinicalCompletenessScore(record: LocalClinicalLearningRecord): number {
    const checks = [
        normalizeText(record.species) != null,
        normalizeList(record.signs).length > 0,
        Object.keys(normalizeRecord(record.labs)).length > 0,
        Object.keys(normalizeRecord(record.treatment)).length > 0,
        normalizeText(record.diagnosis) != null,
        normalizeText(record.outcome) != null,
    ];
    return checks.filter(Boolean).length / checks.length;
}

function contributionRoleForTaskType(taskType: FederationNodeTaskType): FederatedUpdateRole {
    if (taskType === 'severity_delta') return 'severity';
    if (taskType === 'support_summary' || taskType === 'secure_aggregation_key') return 'support';
    if (taskType === 'unmask_share') return 'unmask_share';
    return 'diagnosis';
}

async function readJsonResponse(response: Response): Promise<unknown> {
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`VetIOS federation node request failed: ${response.status} ${JSON.stringify(json)}`);
    }
    return json;
}

function aggregateExclusionReasons(rows: LearningRecordEligibility[]): Record<string, number> {
    return rows.flatMap((row) => row.exclusion_reasons).reduce<Record<string, number>>((acc, reason) => {
        acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
    }, {});
}

function countBy(values: string[]): Record<string, number> {
    return values.reduce<Record<string, number>>((acc, value) => {
        acc[value] = (acc[value] ?? 0) + 1;
        return acc;
    }, {});
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return roundScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundScore(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

function stableHash(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        return `{${Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function normalizeRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function normalizeList(value: string[] | null | undefined): string[] {
    return Array.isArray(value)
        ? Array.from(new Set(value.map((entry) => normalizeText(entry)).filter((entry): entry is string => entry != null))).sort()
        : [];
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
