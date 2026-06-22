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

export interface LocalOutcomeDataset {
    tenant_id: string;
    federation_key: string;
    partner_ref: string | null;
    records: LocalClinicalLearningRecord[];
    eligibilities: LearningRecordEligibility[];
    eligible_records: LearningRecordEligibility[];
    snapshot_draft: FederatedOutcomeEligibilitySnapshotDraft;
    record_digest: string;
    policy_hash: string;
}

export interface LocalFederatedModelDelta {
    schema: 'vetios_local_model_delta_v1';
    task_type: FederationNodeTaskType;
    contribution_role: FederatedUpdateRole;
    eligible_record_count: number;
    training_record_count: number;
    holdout_record_count: number;
    feature_count: number;
    label_count: number;
    record_digest: string;
    delta_digest: string;
    delta_norm: number;
    feature_weights: Record<string, number>;
    label_distribution: Record<string, number>;
    species_distribution: Record<string, number>;
    metric_summary: {
        local_accuracy: number | null;
        majority_label: string | null;
        holdout_coverage: number;
        average_trust_score: number;
        calibration_proxy: number | null;
    };
    evidence: Record<string, unknown>;
}

export interface TrainedMaskedUpdateCommitment extends MaskedUpdateCommitment {
    local_delta: LocalFederatedModelDelta;
}

export interface VetiosFederationNodeClientOptions {
    baseUrl: string;
    machineToken: string;
    federationKey: string;
    nodeRef: string;
    partnerRef?: string | null;
    fetchImpl?: typeof fetch;
}

export interface FederationNodeAgentOptions {
    client: VetiosFederationNodeClient;
    records: LocalClinicalLearningRecord[];
    secret: string;
    tenantId: string;
    federationKey: string;
    partnerRef?: string | null;
    policy?: Partial<EligibilityPolicy>;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
    outcomeEligibilitySnapshotId?: string | null;
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

export function buildLocalOutcomeDataset(input: {
    tenantId: string;
    federationKey: string;
    partnerRef?: string | null;
    records: LocalClinicalLearningRecord[];
    policy?: Partial<EligibilityPolicy>;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
}): LocalOutcomeDataset {
    const policy = { ...DEFAULT_POLICY, ...(input.policy ?? {}) };
    const eligibilities = input.records.map((record) => assessLearningRecordEligibility(record, policy));
    const eligibleRecords = eligibilities.filter((row) => row.eligible_for_federation);
    const snapshotDraft = buildOutcomeEligibilitySnapshotDraft({
        tenantId: input.tenantId,
        federationKey: input.federationKey,
        partnerRef: input.partnerRef,
        records: input.records,
        policy,
        minimumRequiredRows: input.minimumRequiredRows,
        minimumProvenanceRows: input.minimumProvenanceRows,
        minimumTrustScoredRows: input.minimumTrustScoredRows,
    });

    return {
        tenant_id: input.tenantId,
        federation_key: input.federationKey,
        partner_ref: input.partnerRef ?? null,
        records: input.records,
        eligibilities,
        eligible_records: eligibleRecords,
        snapshot_draft: snapshotDraft,
        record_digest: snapshotDraft.source_record_digest,
        policy_hash: stableHash(policy),
    };
}

export function trainLocalFederatedTask(input: {
    task: FederationRoundTask;
    records: LocalClinicalLearningRecord[];
    tenantId: string;
    federationKey: string;
    partnerRef?: string | null;
    policy?: Partial<EligibilityPolicy>;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
}): {
    dataset: LocalOutcomeDataset;
    delta: LocalFederatedModelDelta;
} {
    const dataset = buildLocalOutcomeDataset({
        tenantId: input.tenantId,
        federationKey: input.federationKey,
        partnerRef: input.partnerRef,
        records: input.records,
        policy: input.policy,
        minimumRequiredRows: input.minimumRequiredRows,
        minimumProvenanceRows: input.minimumProvenanceRows,
        minimumTrustScoredRows: input.minimumTrustScoredRows,
    });
    const delta = buildLocalFederatedModelDelta(input.task, dataset);
    return { dataset, delta };
}

export function buildTrainedMaskedUpdateCommitment(input: {
    task: FederationRoundTask;
    dataset: LocalOutcomeDataset;
    delta: LocalFederatedModelDelta;
    outcomeEligibilitySnapshotId?: string | null;
    secret: string;
    requestId?: string;
}): TrainedMaskedUpdateCommitment {
    const payloadCommitmentHash = stableHash({
        federation_round_id: input.task.federation_round_id,
        round_node_task_id: input.task.id,
        contribution_role: input.delta.contribution_role,
        record_digest: input.delta.record_digest,
        delta_digest: input.delta.delta_digest,
        plan_hash: input.task.plan_hash,
        trainer_schema: input.delta.schema,
    });
    const maskNonce = stableHash({
        node_ref: input.task.node_ref,
        task_id: input.task.id,
        secret_commitment: stableHash(input.secret),
        delta_digest: input.delta.delta_digest,
    });
    const maskCommitmentHash = stableHash({
        payload_commitment_hash: payloadCommitmentHash,
        mask_nonce: maskNonce,
        secure_aggregation_config: input.task.secure_aggregation_config ?? {},
    });
    const signedPayloadHash = stableHash({
        payload_commitment_hash: payloadCommitmentHash,
        mask_commitment_hash: maskCommitmentHash,
        evaluation_digest: stableHash(input.delta.metric_summary),
    });

    return {
        request_id: input.requestId ?? randomUUID(),
        round_node_task_id: input.task.id,
        outcome_eligibility_snapshot_id: input.outcomeEligibilitySnapshotId ?? null,
        node_ref: input.task.node_ref,
        partner_ref: input.task.partner_ref,
        contribution_role: input.delta.contribution_role,
        payload_commitment_hash: payloadCommitmentHash,
        mask_commitment_hash: maskCommitmentHash,
        signed_payload_hash: signedPayloadHash,
        signature_algorithm: 'sha256-hmac-simulation',
        signature_hash: stableHash(`${signedPayloadHash}:${input.secret}`),
        signing_key_fingerprint: stableHash(input.secret).slice(0, 32),
        masked_update_summary: {
            schema: 'vetios_masked_model_delta_commitment_v1',
            local_delta_schema: input.delta.schema,
            contribution_role: input.delta.contribution_role,
            eligible_record_count: input.delta.eligible_record_count,
            feature_count: input.delta.feature_count,
            label_count: input.delta.label_count,
            delta_digest: input.delta.delta_digest,
            delta_norm: input.delta.delta_norm,
            record_digest: input.delta.record_digest,
            metric_summary: input.delta.metric_summary,
            raw_delta_included: false,
            raw_records_included: false,
        },
        public_summary: {
            species_counts: input.delta.species_distribution,
            eligible_record_count: input.delta.eligible_record_count,
            average_trust_score: input.delta.metric_summary.average_trust_score,
            contribution_role: input.delta.contribution_role,
            task_type: input.delta.task_type,
        },
        evidence: {
            generated_by: '@vetios/federation-node',
            local_runner: 'deterministic_outcome_delta_v1',
            task_plan_hash: input.task.plan_hash,
            dataset_policy_hash: input.dataset.policy_hash,
            outcome_eligibility_status: input.dataset.snapshot_draft.eligibility_status,
            secure_aggregation_boundary: 'masked_delta_commitments_no_raw_delta',
            model_delta_materialized: true,
            local_training_data_shared: false,
            raw_model_delta_shared: false,
        },
        local_delta: input.delta,
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

export class VetiosFederationNodeAgent {
    private readonly options: FederationNodeAgentOptions;

    constructor(options: FederationNodeAgentOptions) {
        this.options = options;
    }

    buildDataset(): LocalOutcomeDataset {
        return buildLocalOutcomeDataset({
            tenantId: this.options.tenantId,
            federationKey: this.options.federationKey,
            partnerRef: this.options.partnerRef,
            records: this.options.records,
            policy: this.options.policy,
            minimumRequiredRows: this.options.minimumRequiredRows,
            minimumProvenanceRows: this.options.minimumProvenanceRows,
            minimumTrustScoredRows: this.options.minimumTrustScoredRows,
        });
    }

    trainTask(task: FederationRoundTask): {
        dataset: LocalOutcomeDataset;
        delta: LocalFederatedModelDelta;
        commitment: TrainedMaskedUpdateCommitment;
    } {
        const { dataset, delta } = trainLocalFederatedTask({
            task,
            records: this.options.records,
            tenantId: this.options.tenantId,
            federationKey: this.options.federationKey,
            partnerRef: this.options.partnerRef,
            policy: this.options.policy,
            minimumRequiredRows: this.options.minimumRequiredRows,
            minimumProvenanceRows: this.options.minimumProvenanceRows,
            minimumTrustScoredRows: this.options.minimumTrustScoredRows,
        });
        const commitment = buildTrainedMaskedUpdateCommitment({
            task,
            dataset,
            delta,
            outcomeEligibilitySnapshotId: this.options.outcomeEligibilitySnapshotId,
            secret: this.options.secret,
        });
        return { dataset, delta, commitment };
    }

    async runTask(task: FederationRoundTask): Promise<{
        dataset: LocalOutcomeDataset;
        delta: LocalFederatedModelDelta;
        commitment: TrainedMaskedUpdateCommitment;
        submission: unknown;
    }> {
        await this.options.client.pullTask(task.federation_round_id, task.id);
        const result = this.trainTask(task);
        const submission = await this.options.client.submitUpdate(task.federation_round_id, result.commitment);
        return {
            ...result,
            submission,
        };
    }
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

function buildLocalFederatedModelDelta(
    task: FederationRoundTask,
    dataset: LocalOutcomeDataset,
): LocalFederatedModelDelta {
    const eligibleIds = new Set(dataset.eligible_records.map((row) => row.local_record_id));
    const eligibleSourceRecords = dataset.records.filter((record) => eligibleIds.has(record.local_record_id));
    const eligibleById = new Map(dataset.eligible_records.map((row) => [row.local_record_id, row]));
    const examples = eligibleSourceRecords.map((record) => ({
        record,
        eligibility: eligibleById.get(record.local_record_id),
        features: extractModelFeatures(record),
        label: labelForTask(task.task_type, record),
        hash: stableHash({
            local_record_id: record.local_record_id,
            task_type: task.task_type,
            record_hash: eligibleById.get(record.local_record_id)?.record_hash,
        }),
    })).filter((example) => example.eligibility != null && example.features.length > 0 && example.label != null);

    const trainingExamples = examples.filter((example) => holdoutBucket(example.hash) !== 0);
    const holdoutExamples = examples.filter((example) => holdoutBucket(example.hash) === 0);
    const trainingSet = trainingExamples.length > 0 ? trainingExamples : examples;
    const labelDistribution = countBy(examples.map((example) => example.label ?? 'unknown'));
    const speciesDistribution = countBy(examples.map((example) => normalizeText(example.record.species) ?? 'unknown'));
    const featureWeights = buildFeatureWeights(task.task_type, trainingSet.map((example) => ({
        features: example.features,
        label: example.label ?? 'unknown',
        trustScore: example.eligibility?.trust_score ?? 0,
    })));
    const majorityLabel = majorityValue(trainingSet.map((example) => example.label ?? 'unknown'));
    const localAccuracy = holdoutExamples.length > 0 && majorityLabel
        ? roundScore(holdoutExamples.filter((example) => example.label === majorityLabel).length / holdoutExamples.length)
        : null;
    const deltaDigest = stableHash({
        schema: 'vetios_local_model_delta_v1',
        task_type: task.task_type,
        plan_hash: task.plan_hash,
        record_digest: dataset.record_digest,
        feature_weights: featureWeights,
        label_distribution: labelDistribution,
    });

    return {
        schema: 'vetios_local_model_delta_v1',
        task_type: task.task_type,
        contribution_role: contributionRoleForTaskType(task.task_type),
        eligible_record_count: dataset.eligible_records.length,
        training_record_count: trainingSet.length,
        holdout_record_count: holdoutExamples.length,
        feature_count: Object.keys(featureWeights).length,
        label_count: Object.keys(labelDistribution).length,
        record_digest: dataset.record_digest,
        delta_digest: deltaDigest,
        delta_norm: vectorNorm(Object.values(featureWeights)),
        feature_weights: featureWeights,
        label_distribution: labelDistribution,
        species_distribution: speciesDistribution,
        metric_summary: {
            local_accuracy: localAccuracy,
            majority_label: majorityLabel,
            holdout_coverage: examples.length > 0 ? roundScore(holdoutExamples.length / examples.length) : 0,
            average_trust_score: average(dataset.eligible_records.map((record) => record.trust_score)),
            calibration_proxy: localAccuracy == null ? null : roundScore(Math.abs(localAccuracy - average(dataset.eligible_records.map((record) => record.trust_score)))),
        },
        evidence: {
            generated_by: '@vetios/federation-node',
            local_runner: 'deterministic_outcome_delta_v1',
            task_plan_hash: task.plan_hash,
            raw_records_shared: false,
            raw_delta_shared: false,
            eligible_record_count: dataset.eligible_records.length,
            source_record_digest: dataset.record_digest,
        },
    };
}

function buildFeatureWeights(
    taskType: FederationNodeTaskType,
    examples: Array<{ features: string[]; label: string; trustScore: number }>,
): Record<string, number> {
    const weights: Record<string, number> = {};
    for (const example of examples) {
        const labelPrefix = taskType === 'support_summary' || taskType === 'secure_aggregation_key'
            ? 'support'
            : example.label;
        const contributionWeight = Math.max(0.1, example.trustScore);
        for (const feature of example.features) {
            const key = `${labelPrefix}::${feature}`;
            weights[key] = roundScore((weights[key] ?? 0) + contributionWeight);
        }
    }
    return Object.fromEntries(Object.entries(weights).sort(([left], [right]) => left.localeCompare(right)));
}

function extractModelFeatures(record: LocalClinicalLearningRecord): string[] {
    const features = [
        normalizeText(record.species) ? `species:${normalizeText(record.species)}` : null,
        normalizeText(record.breed) ? `breed:${normalizeText(record.breed)}` : null,
        normalizeText(record.sex) ? `sex:${normalizeText(record.sex)}` : null,
        finiteNumber(record.age_years) != null ? `age_bucket:${bucketNumber(record.age_years, [1, 3, 7, 12])}` : null,
        finiteNumber(record.duration_days) != null ? `duration_bucket:${bucketNumber(record.duration_days, [1, 3, 7, 14, 30])}` : null,
        record.amr_related ? 'amr_related:true' : null,
        record.culture_collected ? 'culture_collected:true' : null,
        ...normalizeList(record.signs).map((sign) => `sign:${sign}`),
        ...Object.keys(normalizeRecord(record.labs)).sort().map((key) => `lab:${normalizeText(key) ?? key}`),
        ...Object.keys(normalizeRecord(record.imaging)).sort().map((key) => `imaging:${normalizeText(key) ?? key}`),
        ...Object.keys(normalizeRecord(record.treatment)).sort().map((key) => `treatment:${normalizeText(key) ?? key}`),
    ];
    return features.filter((feature): feature is string => feature != null);
}

function labelForTask(taskType: FederationNodeTaskType, record: LocalClinicalLearningRecord): string | null {
    if (taskType === 'severity_delta') return inferSeverityLabel(record);
    if (taskType === 'support_summary' || taskType === 'secure_aggregation_key' || taskType === 'unmask_share') {
        return record.amr_related || record.culture_collected ? 'amr_support' : 'clinical_support';
    }
    return normalizeText(record.diagnosis);
}

function inferSeverityLabel(record: LocalClinicalLearningRecord): string {
    const signs = normalizeList(record.signs);
    const outcome = normalizeText(record.outcome);
    if (signs.some((sign) => sign.includes('collapse') || sign.includes('seizure') || sign.includes('dyspnea'))) return 'emergency';
    if (outcome?.includes('death') || outcome?.includes('euthan')) return 'critical';
    if (signs.some((sign) => sign.includes('fever') || sign.includes('lethargy') || sign.includes('anorexia'))) return 'urgent';
    return 'routine';
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

function majorityValue(values: string[]): string | null {
    const counts = countBy(values);
    const [label] = Object.entries(counts).sort((left, right) => {
        const countDelta = right[1] - left[1];
        return countDelta !== 0 ? countDelta : left[0].localeCompare(right[0]);
    })[0] ?? [];
    return label ?? null;
}

function vectorNorm(values: number[]): number {
    return roundScore(Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)));
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

function bucketNumber(value: unknown, thresholds: number[]): string {
    const numeric = finiteNumber(value);
    if (numeric == null) return 'unknown';
    for (const threshold of thresholds) {
        if (numeric <= threshold) return `lte_${threshold}`;
    }
    return `gt_${thresholds[thresholds.length - 1] ?? 0}`;
}

function holdoutBucket(hash: string): number {
    const prefix = hash.slice(0, 8);
    const parsed = Number.parseInt(prefix, 16);
    return Number.isFinite(parsed) ? parsed % 5 : 0;
}
