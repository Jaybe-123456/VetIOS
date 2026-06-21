import { createHash, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    FEDERATED_MODEL_PROMOTION_EVENTS,
    FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS,
    FEDERATED_UPDATE_SUBMISSIONS,
    FEDERATION_ROUNDS,
    MODEL_DELTA_ARTIFACTS,
} from '@/lib/db/schemaContracts';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import type { LearningTaskType, ModelRegistryEntryRecord } from '@/lib/learningEngine/types';

export interface FederatedPromotionPolicy {
    minimumParticipants: number;
    minimumAcceptedUpdates: number | null;
    minimumEligibleOutcomeSnapshots: number | null;
    minimumOutcomeConfirmedRows: number;
    minimumProvenanceVerifiedRows: number;
    minimumTrustScoredRows: number;
    minimumAverageTrustScore: number;
}

export interface FederatedPromotionRoundEvidence {
    id: string;
    federation_key: string;
    coordinator_tenant_id: string;
    round_key: string;
    status: string;
    participant_count: number;
    aggregate_payload: Record<string, unknown>;
    candidate_artifact_payload: Record<string, unknown>;
    completed_at: string | null;
}

export interface FederatedPromotionArtifactEvidence {
    id: string | null;
    task_type: LearningTaskType;
    model_version: string | null;
    dataset_version: string | null;
    artifact_payload: Record<string, unknown>;
    summary: Record<string, unknown>;
}

export interface FederatedPromotionUpdateSubmissionEvidence {
    id: string;
    contribution_role: string | null;
    submission_status: string | null;
    node_ref: string | null;
    participant_ref: string | null;
    outcome_eligibility_snapshot_id: string | null;
    payload_commitment_hash: string | null;
    mask_commitment_hash: string | null;
    signed_payload_hash: string | null;
    signature_hash: string | null;
}

export interface FederatedPromotionOutcomeEligibilityEvidence {
    id: string;
    tenant_id: string;
    eligibility_status: string | null;
    outcome_confirmed_rows: number;
    provenance_verified_rows: number;
    trust_scored_rows: number;
    average_trust_score: number;
    source_record_digest: string | null;
}

export interface FederatedModelPromotionAssessment {
    allowed: boolean;
    promotion_status: 'blocked' | 'promotion_gate_required';
    task_type: LearningTaskType;
    candidate_model_version: string | null;
    candidate_dataset_version: string | null;
    blockers: string[];
    warnings: string[];
    metrics: {
        participant_count: number;
        accepted_update_submissions: number;
        eligible_outcome_snapshots: number;
        outcome_confirmed_rows: number;
        provenance_verified_rows: number;
        trust_scored_rows: number;
        average_trust_score: number;
        secure_aggregation_status: string;
    };
    hashes: {
        source_artifact_hash: string | null;
        aggregate_payload_hash: string;
    };
    evidence: Record<string, unknown>;
}

export interface FederatedCandidateRegistrationResult {
    round: FederatedPromotionRoundEvidence;
    assessments: FederatedModelPromotionAssessment[];
    registered_models: ModelRegistryEntryRecord[];
    promotion_events: Record<string, unknown>[];
}

const DEFAULT_PROMOTION_POLICY: FederatedPromotionPolicy = {
    minimumParticipants: 2,
    minimumAcceptedUpdates: null,
    minimumEligibleOutcomeSnapshots: null,
    minimumOutcomeConfirmedRows: 20,
    minimumProvenanceVerifiedRows: 20,
    minimumTrustScoredRows: 20,
    minimumAverageTrustScore: 0.7,
};

export function buildFederatedModelPromotionAssessment(input: {
    round: FederatedPromotionRoundEvidence;
    artifact: FederatedPromotionArtifactEvidence;
    updateSubmissions: FederatedPromotionUpdateSubmissionEvidence[];
    outcomeEligibilitySnapshots: FederatedPromotionOutcomeEligibilityEvidence[];
    policy?: Partial<FederatedPromotionPolicy>;
}): FederatedModelPromotionAssessment {
    const policy = { ...DEFAULT_PROMOTION_POLICY, ...input.policy };
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const taskRole = contributionRoleForTask(input.artifact.task_type);
    const acceptedUpdates = input.updateSubmissions.filter((submission) =>
        submission.contribution_role === taskRole
        && submission.submission_status === 'accepted',
    );
    const acceptedNodeRefs = uniqueNonEmpty(acceptedUpdates.map((submission) => submission.node_ref ?? submission.participant_ref));
    const linkedEligibilityIds = new Set(acceptedUpdates
        .map((submission) => submission.outcome_eligibility_snapshot_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0));
    const linkedEligibility = input.outcomeEligibilitySnapshots.filter((snapshot) => linkedEligibilityIds.has(snapshot.id));
    const eligibleSnapshots = linkedEligibility.filter((snapshot) => snapshot.eligibility_status === 'eligible');
    const outcomeConfirmedRows = eligibleSnapshots.reduce((sum, snapshot) => sum + snapshot.outcome_confirmed_rows, 0);
    const provenanceVerifiedRows = eligibleSnapshots.reduce((sum, snapshot) => sum + snapshot.provenance_verified_rows, 0);
    const trustScoredRows = eligibleSnapshots.reduce((sum, snapshot) => sum + snapshot.trust_scored_rows, 0);
    const averageTrustScore = weightedAverageTrustScore(eligibleSnapshots);
    const secureAggregationStatus = resolveSecureAggregationStatus(input.round.aggregate_payload, acceptedUpdates);
    const requiredAcceptedUpdates = policy.minimumAcceptedUpdates ?? Math.max(policy.minimumParticipants, input.round.participant_count);
    const requiredEligibleSnapshots = policy.minimumEligibleOutcomeSnapshots ?? Math.max(policy.minimumParticipants, input.round.participant_count);

    if (input.round.status !== 'completed') {
        blockers.add('federation_round_not_completed');
    }
    if (!input.round.completed_at) {
        warnings.add('federation_round_missing_completed_at');
    }
    if (input.round.participant_count < policy.minimumParticipants) {
        blockers.add('participant_count_below_promotion_floor');
    }
    if (!input.artifact.model_version) {
        blockers.add('candidate_model_version_missing');
    }
    if (!input.artifact.dataset_version) {
        warnings.add('candidate_dataset_version_missing');
    }
    if (secureAggregationStatus !== 'secure_aggregation_ready' && secureAggregationStatus !== 'live_node_commitments_ready') {
        blockers.add('secure_aggregation_evidence_missing');
    }
    if (acceptedNodeRefs.length < requiredAcceptedUpdates) {
        blockers.add('accepted_live_node_updates_below_threshold');
    }
    if (eligibleSnapshots.length < requiredEligibleSnapshots) {
        blockers.add('eligible_outcome_snapshots_below_threshold');
    }
    if (acceptedUpdates.some((submission) => !submission.payload_commitment_hash)) {
        blockers.add('accepted_update_missing_payload_commitment');
    }
    if (acceptedUpdates.some((submission) => !submission.mask_commitment_hash)) {
        blockers.add('accepted_update_missing_mask_commitment');
    }
    if (linkedEligibility.length !== linkedEligibilityIds.size) {
        blockers.add('accepted_update_missing_outcome_eligibility_snapshot');
    }
    if (linkedEligibility.some((snapshot) => snapshot.eligibility_status !== 'eligible')) {
        blockers.add('linked_outcome_eligibility_not_eligible');
    }
    if (outcomeConfirmedRows < policy.minimumOutcomeConfirmedRows) {
        blockers.add('outcome_confirmed_rows_below_threshold');
    }
    if (provenanceVerifiedRows < policy.minimumProvenanceVerifiedRows) {
        blockers.add('provenance_verified_rows_below_threshold');
    }
    if (trustScoredRows < policy.minimumTrustScoredRows) {
        blockers.add('trust_scored_rows_below_threshold');
    }
    if (averageTrustScore < policy.minimumAverageTrustScore) {
        blockers.add('average_trust_score_below_threshold');
    }

    const aggregatePayloadHash = stableHash(input.round.aggregate_payload);
    const sourceArtifactHash = Object.keys(input.artifact.artifact_payload).length > 0
        ? stableHash(input.artifact.artifact_payload)
        : null;

    return {
        allowed: blockers.size === 0,
        promotion_status: blockers.size === 0 ? 'promotion_gate_required' : 'blocked',
        task_type: input.artifact.task_type,
        candidate_model_version: input.artifact.model_version,
        candidate_dataset_version: input.artifact.dataset_version,
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        metrics: {
            participant_count: input.round.participant_count,
            accepted_update_submissions: acceptedNodeRefs.length,
            eligible_outcome_snapshots: eligibleSnapshots.length,
            outcome_confirmed_rows: outcomeConfirmedRows,
            provenance_verified_rows: provenanceVerifiedRows,
            trust_scored_rows: trustScoredRows,
            average_trust_score: roundScore(averageTrustScore),
            secure_aggregation_status: secureAggregationStatus,
        },
        hashes: {
            source_artifact_hash: sourceArtifactHash,
            aggregate_payload_hash: aggregatePayloadHash,
        },
        evidence: {
            federation_round_id: input.round.id,
            federation_key: input.round.federation_key,
            round_key: input.round.round_key,
            model_delta_artifact_id: input.artifact.id,
            accepted_update_submission_ids: acceptedUpdates.map((submission) => submission.id),
            accepted_node_refs: acceptedNodeRefs,
            outcome_eligibility_snapshot_ids: eligibleSnapshots.map((snapshot) => snapshot.id),
            outcome_source_digests: eligibleSnapshots
                .map((snapshot) => snapshot.source_record_digest)
                .filter((digest): digest is string => typeof digest === 'string' && digest.length > 0),
            policy,
            champion_promotion_policy: 'manual_only_after_learning_promotion_gate',
        },
    };
}

export async function registerFederatedRoundCandidateModels(
    client: SupabaseClient,
    input: {
        federationRoundId: string;
        actor: string | null;
        policy?: Partial<FederatedPromotionPolicy>;
    },
): Promise<FederatedCandidateRegistrationResult> {
    const round = await loadFederationRoundForPromotion(client, input.federationRoundId);
    const [artifacts, updateSubmissions] = await Promise.all([
        loadAggregateArtifactsForRound(client, round.id),
        loadUpdateSubmissionsForRound(client, round.id),
    ]);
    const outcomeEligibilitySnapshots = await loadOutcomeEligibilitySnapshotsForSubmissions(client, updateSubmissions);
    const store = createSupabaseLearningEngineStore(client);
    const existingEntries = await store.listModelRegistryEntries(round.coordinator_tenant_id);
    const assessments = artifacts.map((artifact) => buildFederatedModelPromotionAssessment({
        round,
        artifact,
        updateSubmissions,
        outcomeEligibilitySnapshots,
        policy: input.policy,
    }));
    const registered: ModelRegistryEntryRecord[] = [];
    const events: Record<string, unknown>[] = [];

    for (const assessment of assessments) {
        const existing = existingEntries.find((entry) =>
            entry.task_type === assessment.task_type
            && entry.model_version === assessment.candidate_model_version,
        ) ?? null;
        let registryEntry: ModelRegistryEntryRecord | null = existing;
        let eventStatus: 'blocked' | 'candidate_registered' | 'already_registered' = assessment.allowed ? 'candidate_registered' : 'blocked';

        if (assessment.allowed && existing) {
            eventStatus = 'already_registered';
        } else if (assessment.allowed) {
            registryEntry = await store.createModelRegistryEntry(buildFederatedCandidateRegistryEntry(round, assessment, artifacts.find((artifact) => artifact.task_type === assessment.task_type) ?? null));
            registered.push(registryEntry);
        }

        const event = await insertPromotionEvent(client, {
            round,
            assessment,
            registryEntry,
            eventStatus,
            actor: input.actor,
        });
        events.push(event);
    }

    if (artifacts.length === 0) {
        const syntheticAssessment = buildBlockedNoArtifactAssessment(round, input.policy);
        const event = await insertPromotionEvent(client, {
            round,
            assessment: syntheticAssessment,
            registryEntry: null,
            eventStatus: 'blocked',
            actor: input.actor,
        });
        events.push(event);
        assessments.push(syntheticAssessment);
    }

    return {
        round,
        assessments,
        registered_models: registered,
        promotion_events: events,
    };
}

function buildFederatedCandidateRegistryEntry(
    round: FederatedPromotionRoundEvidence,
    assessment: FederatedModelPromotionAssessment,
    artifact: FederatedPromotionArtifactEvidence | null,
): Omit<ModelRegistryEntryRecord, 'id' | 'created_at' | 'updated_at'> {
    if (!assessment.candidate_model_version) {
        throw new Error('Cannot register a federated candidate without a model version.');
    }

    return {
        tenant_id: round.coordinator_tenant_id,
        model_name: `VetIOS Federated ${assessment.task_type} Candidate`,
        model_version: assessment.candidate_model_version,
        task_type: assessment.task_type,
        training_dataset_version: assessment.candidate_dataset_version ?? `federated:${round.round_key}`,
        feature_schema_version: readText(artifact?.artifact_payload.feature_schema_version) ?? 'federated_feature_schema_v1',
        label_policy_version: readText(artifact?.artifact_payload.label_policy_version) ?? 'outcome_confirmed_federated_v1',
        artifact_payload: {
            ...(artifact?.artifact_payload ?? {}),
            federation_round_id: round.id,
            federation_key: round.federation_key,
            round_key: round.round_key,
            task_type: assessment.task_type,
            model_version: assessment.candidate_model_version,
            dataset_version: assessment.candidate_dataset_version,
            artifact_hash: assessment.hashes.source_artifact_hash,
            aggregate_payload_hash: assessment.hashes.aggregate_payload_hash,
            value_capture_layer: {
                outcome_confirmed_rows: assessment.metrics.outcome_confirmed_rows,
                provenance_verified_rows: assessment.metrics.provenance_verified_rows,
                trust_scored_rows: assessment.metrics.trust_scored_rows,
                average_trust_score: assessment.metrics.average_trust_score,
                eligible_outcome_snapshots: assessment.metrics.eligible_outcome_snapshots,
            },
            promotion_evidence: assessment.evidence,
            champion_promotion_status: 'requires_learning_promotion_gate',
        },
        benchmark_scorecard: {
            federated_candidate_registered: 1,
            outcome_confirmed_rows: assessment.metrics.outcome_confirmed_rows,
            average_trust_score: assessment.metrics.average_trust_score,
        },
        calibration_report_id: null,
        promotion_status: 'candidate',
        is_champion: false,
        latency_profile: null,
        resource_profile: null,
        parent_model_version: null,
    };
}

async function loadFederationRoundForPromotion(
    client: SupabaseClient,
    federationRoundId: string,
): Promise<FederatedPromotionRoundEvidence> {
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .select('*')
        .eq(FEDERATION_ROUNDS.COLUMNS.id, federationRoundId)
        .single();

    if (error || !data) {
        throw new Error(`Failed to load federation round for promotion: ${error?.message ?? 'not found'}`);
    }

    const row = asRecord(data);
    return {
        id: String(row.id),
        federation_key: readText(row.federation_key) ?? '',
        coordinator_tenant_id: readText(row.coordinator_tenant_id) ?? '',
        round_key: readText(row.round_key) ?? '',
        status: readText(row.status) ?? 'unknown',
        participant_count: readNumber(row.participant_count) ?? 0,
        aggregate_payload: asRecord(row.aggregate_payload),
        candidate_artifact_payload: asRecord(row.candidate_artifact_payload),
        completed_at: readText(row.completed_at),
    };
}

async function loadAggregateArtifactsForRound(
    client: SupabaseClient,
    federationRoundId: string,
): Promise<FederatedPromotionArtifactEvidence[]> {
    const C = MODEL_DELTA_ARTIFACTS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_DELTA_ARTIFACTS.TABLE)
        .select('*')
        .eq(C.federation_round_id, federationRoundId)
        .eq(C.artifact_role, 'aggregate_candidate');

    if (error) {
        throw new Error(`Failed to load federated aggregate artifacts: ${error.message}`);
    }

    return (data ?? [])
        .map((row) => mapPromotionArtifact(asRecord(row)))
        .filter((artifact): artifact is FederatedPromotionArtifactEvidence => artifact != null);
}

async function loadUpdateSubmissionsForRound(
    client: SupabaseClient,
    federationRoundId: string,
): Promise<FederatedPromotionUpdateSubmissionEvidence[]> {
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .select('*')
        .eq(C.federation_round_id, federationRoundId);

    if (error) {
        throw new Error(`Failed to load federated update submissions: ${error.message}`);
    }

    return (data ?? []).map((row) => {
        const record = asRecord(row);
        return {
            id: String(record.id),
            contribution_role: readText(record.contribution_role),
            submission_status: readText(record.submission_status),
            node_ref: readText(record.node_ref),
            participant_ref: readText(record.participant_ref),
            outcome_eligibility_snapshot_id: readText(record.outcome_eligibility_snapshot_id),
            payload_commitment_hash: readText(record.payload_commitment_hash),
            mask_commitment_hash: readText(record.mask_commitment_hash),
            signed_payload_hash: readText(record.signed_payload_hash),
            signature_hash: readText(record.signature_hash),
        };
    });
}

async function loadOutcomeEligibilitySnapshotsForSubmissions(
    client: SupabaseClient,
    submissions: FederatedPromotionUpdateSubmissionEvidence[],
): Promise<FederatedPromotionOutcomeEligibilityEvidence[]> {
    const ids = uniqueNonEmpty(submissions.map((submission) => submission.outcome_eligibility_snapshot_id));
    if (ids.length === 0) return [];

    const C = FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.TABLE)
        .select('*')
        .in(C.id, ids);

    if (error) {
        throw new Error(`Failed to load federated outcome eligibility snapshots: ${error.message}`);
    }

    return (data ?? []).map((row) => {
        const record = asRecord(row);
        return {
            id: String(record.id),
            tenant_id: readText(record.tenant_id) ?? '',
            eligibility_status: readText(record.eligibility_status),
            outcome_confirmed_rows: readNumber(record.outcome_confirmed_rows) ?? 0,
            provenance_verified_rows: readNumber(record.provenance_verified_rows) ?? 0,
            trust_scored_rows: readNumber(record.trust_scored_rows) ?? 0,
            average_trust_score: readNumber(record.average_trust_score) ?? 0,
            source_record_digest: readText(record.source_record_digest),
        };
    });
}

async function insertPromotionEvent(
    client: SupabaseClient,
    input: {
        round: FederatedPromotionRoundEvidence;
        assessment: FederatedModelPromotionAssessment;
        registryEntry: ModelRegistryEntryRecord | null;
        eventStatus: 'blocked' | 'candidate_registered' | 'already_registered';
        actor: string | null;
    },
): Promise<Record<string, unknown>> {
    const C = FEDERATED_MODEL_PROMOTION_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_MODEL_PROMOTION_EVENTS.TABLE)
        .insert({
            [C.tenant_id]: input.round.coordinator_tenant_id,
            [C.request_id]: randomUUID(),
            [C.federation_round_id]: input.round.id,
            [C.model_registry_entry_id]: input.registryEntry?.id ?? null,
            [C.federation_key]: input.round.federation_key,
            [C.round_key]: input.round.round_key,
            [C.task_type]: input.assessment.task_type,
            [C.candidate_model_version]: input.assessment.candidate_model_version ?? 'missing_candidate_version',
            [C.candidate_dataset_version]: input.assessment.candidate_dataset_version,
            [C.promotion_stage]: 'candidate_registration',
            [C.promotion_status]: input.eventStatus,
            [C.participant_count]: input.assessment.metrics.participant_count,
            [C.accepted_update_submissions]: input.assessment.metrics.accepted_update_submissions,
            [C.eligible_outcome_snapshots]: input.assessment.metrics.eligible_outcome_snapshots,
            [C.outcome_confirmed_rows]: input.assessment.metrics.outcome_confirmed_rows,
            [C.provenance_verified_rows]: input.assessment.metrics.provenance_verified_rows,
            [C.trust_scored_rows]: input.assessment.metrics.trust_scored_rows,
            [C.average_trust_score]: input.assessment.metrics.average_trust_score,
            [C.secure_aggregation_status]: input.assessment.metrics.secure_aggregation_status,
            [C.source_artifact_hash]: input.assessment.hashes.source_artifact_hash,
            [C.aggregate_payload_hash]: input.assessment.hashes.aggregate_payload_hash,
            [C.blockers]: input.assessment.blockers,
            [C.warnings]: input.assessment.warnings,
            [C.evidence]: {
                ...input.assessment.evidence,
                actor: input.actor,
                registry_entry_id: input.registryEntry?.id ?? null,
            },
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to write federated model promotion event: ${error?.message ?? 'unknown error'}`);
    }

    return asRecord(data);
}

function buildBlockedNoArtifactAssessment(
    round: FederatedPromotionRoundEvidence,
    policy?: Partial<FederatedPromotionPolicy>,
): FederatedModelPromotionAssessment {
    return buildFederatedModelPromotionAssessment({
        round,
        artifact: {
            id: null,
            task_type: 'hybrid',
            model_version: null,
            dataset_version: null,
            artifact_payload: {},
            summary: {},
        },
        updateSubmissions: [],
        outcomeEligibilitySnapshots: [],
        policy,
    });
}

function mapPromotionArtifact(row: Record<string, unknown>): FederatedPromotionArtifactEvidence | null {
    const taskType = normalizeTaskType(row.task_type);
    if (!taskType) return null;
    return {
        id: readText(row.id),
        task_type: taskType,
        model_version: readText(row.model_version),
        dataset_version: readText(row.dataset_version),
        artifact_payload: asRecord(row.artifact_payload),
        summary: asRecord(row.summary),
    };
}

function contributionRoleForTask(taskType: LearningTaskType): string {
    if (taskType === 'severity') return 'severity';
    if (taskType === 'hybrid') return 'support';
    return 'diagnosis';
}

function resolveSecureAggregationStatus(
    aggregatePayload: Record<string, unknown>,
    acceptedUpdates: FederatedPromotionUpdateSubmissionEvidence[],
): string {
    const manifestStatus = readText(asRecord(aggregatePayload.secure_aggregation).status);
    if (manifestStatus === 'secure_aggregation_ready') {
        return manifestStatus;
    }
    if (
        acceptedUpdates.length > 0
        && acceptedUpdates.every((submission) => submission.payload_commitment_hash && submission.mask_commitment_hash)
    ) {
        return 'live_node_commitments_ready';
    }
    return manifestStatus ?? 'missing';
}

function weightedAverageTrustScore(snapshots: FederatedPromotionOutcomeEligibilityEvidence[]): number {
    const totalRows = snapshots.reduce((sum, snapshot) => sum + Math.max(snapshot.trust_scored_rows, 0), 0);
    if (totalRows <= 0) return 0;
    return snapshots.reduce((sum, snapshot) => sum + snapshot.average_trust_score * Math.max(snapshot.trust_scored_rows, 0), 0) / totalRows;
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

function normalizeTaskType(value: unknown): LearningTaskType | null {
    return value === 'diagnosis' || value === 'severity' || value === 'hybrid' ? value : null;
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

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function roundScore(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}
