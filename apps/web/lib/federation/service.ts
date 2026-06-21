import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    FEDERATED_SECURE_AGGREGATION_CONTRIBUTIONS,
    FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS,
    FEDERATED_SITE_SNAPSHOTS,
    FEDERATION_MEMBERSHIPS,
    FEDERATION_ROUNDS,
    MODEL_DELTA_ARTIFACTS,
} from '@/lib/db/schemaContracts';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import {
    computeNextFederationRoundDueAt,
    isFederationRoundDue,
    patchFederationGovernanceMetadata,
    readFederationGovernanceState,
    type FederationAutomationState,
    type FederationGovernancePolicy,
} from '@/lib/federation/policy';
import {
    buildFederatedOutcomeEligibilityDigest,
    evaluateFederatedOutcomeEligibilityForRound,
    normalizeFederatedOutcomeEligibilityStatus,
    type FederatedOutcomeEligibilityDigest,
    type FederatedOutcomeEligibilityInput,
    type FederatedOutcomeEligibilityStatus,
} from '@/lib/federation/outcomeEligibility';
import { decodeDiagnosisArtifact, decodeSeverityArtifact } from '@/lib/learningEngine/modelRegistryConnector';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import type {
    DiagnosisModelArtifact,
    ModelRegistryEntryRecord,
    SeverityModelArtifact,
} from '@/lib/learningEngine/types';

export type FederationMembershipStatus = 'active' | 'paused' | 'revoked';
export type FederationParticipationMode = 'full' | 'shadow';
export type FederationRoundStatus = 'collecting' | 'aggregating' | 'completed' | 'failed';
export type FederationArtifactRole = 'site_delta' | 'aggregate_candidate';

export interface FederationMembershipRecord {
    id: string;
    federation_key: string;
    tenant_id: string;
    coordinator_tenant_id: string;
    status: FederationMembershipStatus;
    participation_mode: FederationParticipationMode;
    weight: number;
    metadata: Record<string, unknown>;
    created_by: string | null;
    last_snapshot_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface FederatedSiteSnapshotRecord {
    id: string;
    federation_key: string;
    tenant_id: string;
    coordinator_tenant_id: string;
    snapshot_window_start: string | null;
    snapshot_window_end: string;
    dataset_version: string | null;
    dataset_versions: number;
    total_dataset_rows: number;
    benchmark_reports: number;
    calibration_reports: number;
    audit_events: number;
    champion_models: number;
    support_summary: Record<string, unknown>;
    quality_summary: Record<string, unknown>;
    snapshot_payload: Record<string, unknown>;
    created_at: string;
}

export interface FederationRoundRecord {
    id: string;
    federation_key: string;
    coordinator_tenant_id: string;
    round_key: string;
    status: FederationRoundStatus;
    aggregation_strategy: string;
    snapshot_cutoff_at: string | null;
    participant_count: number;
    aggregate_payload: Record<string, unknown>;
    candidate_artifact_payload: Record<string, unknown>;
    notes: string | null;
    started_at: string;
    completed_at: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface ModelDeltaArtifactRecord {
    id: string;
    federation_round_id: string;
    federation_key: string;
    coordinator_tenant_id: string;
    tenant_id: string | null;
    artifact_role: FederationArtifactRole;
    task_type: string;
    model_version: string | null;
    dataset_version: string | null;
    artifact_payload: Record<string, unknown>;
    summary: Record<string, unknown>;
    created_at: string;
}

export type SecureAggregationContributionRole = 'diagnosis' | 'severity' | 'support';

export interface SecureAggregationContributionRecord {
    id: string;
    federation_round_id: string;
    federation_key: string;
    coordinator_tenant_id: string;
    tenant_id: string;
    participant_ref: string;
    contribution_role: SecureAggregationContributionRole;
    masking_protocol: string;
    payload_commitment_hash: string;
    mask_commitment_hash: string;
    masked_payload_summary: Record<string, unknown>;
    public_summary: Record<string, unknown>;
    accepted_at: string;
    created_at: string;
}

export interface FederatedOutcomeEligibilitySnapshotRecord extends FederatedOutcomeEligibilityInput {
    id: string;
    tenant_id: string;
    request_id: string;
    federation_key: string;
    partner_ref: string | null;
    membership_id: string | null;
    evidence_window_start: string | null;
    evidence_window_end: string;
    outcome_confirmed_rows: number;
    lab_confirmed_rows: number;
    expert_reviewed_rows: number;
    synthetic_rows_excluded: number;
    consented_network_learning_rows: number;
    provenance_verified_rows: number;
    trust_scored_rows: number;
    amr_outcome_linked_rows: number;
    external_validation_events: number;
    minimum_required_rows: number;
    minimum_provenance_rows: number;
    minimum_trust_scored_rows: number;
    minimum_external_validations: number;
    minimum_trust_score: number;
    average_trust_score: number;
    eligibility_status: FederatedOutcomeEligibilityStatus;
    blockers: string[];
    source_hash_bundle: Record<string, unknown>;
    source_table_counts: Record<string, unknown>;
    source_record_digest: string | null;
    evidence: Record<string, unknown>;
    observed_at: string;
    created_at: string;
}

export interface FederationControlPlaneSnapshot {
    tenant_id: string;
    memberships: FederationMembershipRecord[];
    recent_site_snapshots: FederatedSiteSnapshotRecord[];
    recent_rounds: FederationRoundRecord[];
    recent_artifacts: ModelDeltaArtifactRecord[];
    recent_secure_contributions: SecureAggregationContributionRecord[];
    recent_outcome_eligibility_snapshots: FederatedOutcomeEligibilitySnapshotRecord[];
    summary: {
        active_memberships: number;
        coordinator_memberships: number;
        active_federations: number;
        visible_participants: number;
        stale_snapshots: number;
        completed_rounds: number;
        secure_rounds: number;
        secure_contributions: number;
        outcome_eligible_participants: number;
        latest_round_completed_at: string | null;
    };
    refreshed_at: string;
}

export interface FederatedPublicSummary {
    active: boolean;
    federation_key: string | null;
    participant_count: number;
    recent_rounds: number;
    latest_snapshot_at: string | null;
    latest_round_status: FederationRoundStatus | null;
    latest_round_completed_at: string | null;
    aggregate_dataset_rows: number;
    benchmark_pass_rate: number | null;
    calibration_avg_ece: number | null;
    diagnosis_candidate_version: string | null;
    severity_candidate_version: string | null;
    enrollment_mode: string | null;
    auto_run_rounds: boolean;
    round_interval_hours: number | null;
    next_round_due_at: string | null;
    minimum_participants: number | null;
    minimum_benchmark_pass_rate: number | null;
    maximum_calibration_avg_ece: number | null;
    privacy_mode: string | null;
    privacy_status: string | null;
    privacy_minimum_participants: number | null;
    privacy_participant_count: number | null;
    secure_aggregation_status: string | null;
    secure_contribution_count: number | null;
    raw_site_delta_artifacts_stored: boolean | null;
    raw_tenant_ids_in_aggregate: boolean | null;
}

export interface FederationAutomationExecution {
    federation_key: string;
    coordinator_tenant_id: string;
    governance: FederationGovernancePolicy;
    automation: FederationAutomationState;
    auto_enrolled_memberships: FederationMembershipRecord[];
    published_snapshots: FederatedSiteSnapshotRecord[];
    round: FederationRoundRecord | null;
    artifacts: ModelDeltaArtifactRecord[];
    secure_contributions: SecureAggregationContributionRecord[];
    skipped_reason: string | null;
}

export async function getFederationControlPlaneSnapshot(
    client: SupabaseClient,
    tenantId: string,
    options: {
        federationKey?: string | null;
    } = {},
): Promise<FederationControlPlaneSnapshot> {
    const memberships = await listVisibleFederationMemberships(client, tenantId, options.federationKey ?? null);
    const federationKeys = uniqueStrings(memberships.map((membership) => membership.federation_key));
    const [snapshots, rounds, outcomeEligibilitySnapshots] = await Promise.all([
        federationKeys.length > 0
            ? listSiteSnapshotsForFederations(client, federationKeys, 60)
            : Promise.resolve([]),
        federationKeys.length > 0
            ? listRoundsForFederations(client, federationKeys, 20)
            : Promise.resolve([]),
        federationKeys.length > 0
            ? listLatestOutcomeEligibilitySnapshotsForFederations(client, federationKeys, 120)
            : Promise.resolve([]),
    ]);
    const artifacts = rounds.length > 0
        ? await listModelDeltaArtifactsForRounds(client, rounds.slice(0, 10).map((round) => round.id), 40)
        : [];
    const secureContributions = rounds.length > 0
        ? await listSecureAggregationContributionsForRounds(client, rounds.slice(0, 10).map((round) => round.id), 80)
        : [];

    const activeMemberships = memberships.filter((membership) => membership.status === 'active');
    const latestRound = rounds.find((round) => round.completed_at != null) ?? null;

    return {
        tenant_id: tenantId,
        memberships,
        recent_site_snapshots: snapshots,
        recent_rounds: rounds,
        recent_artifacts: artifacts,
        recent_secure_contributions: secureContributions,
        recent_outcome_eligibility_snapshots: outcomeEligibilitySnapshots,
        summary: {
            active_memberships: activeMemberships.length,
            coordinator_memberships: memberships.filter((membership) => membership.coordinator_tenant_id === tenantId).length,
            active_federations: uniqueStrings(activeMemberships.map((membership) => membership.federation_key)).length,
            visible_participants: uniqueStrings(activeMemberships.map((membership) => membership.tenant_id)).length,
            stale_snapshots: snapshots.filter((snapshot) => isStaleTimestamp(snapshot.created_at, 24)).length,
            completed_rounds: rounds.filter((round) => round.status === 'completed').length,
            secure_rounds: rounds.filter((round) => asRecord(round.aggregate_payload.secure_aggregation).status === 'secure_aggregation_ready').length,
            secure_contributions: secureContributions.length,
            outcome_eligible_participants: uniqueStrings(outcomeEligibilitySnapshots
                .filter((snapshot) => buildFederatedOutcomeEligibilityDigest(snapshot).eligibility_status === 'eligible')
                .map((snapshot) => snapshot.tenant_id)).length,
            latest_round_completed_at: latestRound?.completed_at ?? null,
        },
        refreshed_at: new Date().toISOString(),
    };
}

export async function upsertFederationMembership(
    client: SupabaseClient,
    input: {
        federationKey: string;
        tenantId: string;
        coordinatorTenantId: string;
        actor: string | null;
        participationMode?: FederationParticipationMode;
        status?: FederationMembershipStatus;
        weight?: number;
        metadata?: Record<string, unknown>;
    },
): Promise<FederationMembershipRecord> {
    const C = FEDERATION_MEMBERSHIPS.COLUMNS;
    const existing = await getFederationMembership(client, input.federationKey, input.tenantId);
    const payload = {
        [C.federation_key]: input.federationKey,
        [C.tenant_id]: input.tenantId,
        [C.coordinator_tenant_id]: input.coordinatorTenantId,
        [C.status]: input.status ?? 'active',
        [C.participation_mode]: input.participationMode ?? 'full',
        [C.weight]: input.weight ?? 1,
        [C.metadata]: mergeRecords(existing?.metadata ?? {}, input.metadata ?? {}),
        [C.created_by]: existing?.created_by ?? input.actor,
    };

    const { data, error } = await client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .upsert(payload, {
            onConflict: `${C.federation_key},${C.tenant_id}`,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to upsert federation membership: ${error?.message ?? 'Unknown error'}`);
    }

    return mapFederationMembership(asRecord(data));
}

export async function setFederationGovernancePolicy(
    client: SupabaseClient,
    input: {
        federationKey: string;
        actorTenantId: string;
        actor: string | null;
        policy: Partial<FederationGovernancePolicy>;
    },
): Promise<FederationMembershipRecord> {
    const coordinatorMembership = await requireCoordinatorMembership(client, input.federationKey, input.actorTenantId, input.actor);
    const governanceState = readFederationGovernanceState(coordinatorMembership.metadata);
    const nextPolicy = {
        ...governanceState.policy,
        ...input.policy,
        approved_tenant_ids: input.policy.approved_tenant_ids ?? governanceState.policy.approved_tenant_ids,
    };
    const nextAutomation = shouldAdvanceAutomationSchedule(input.policy)
        ? {
            next_round_due_at: computeNextFederationRoundDueAt(governanceState.automation.last_round_started_at, nextPolicy),
        }
        : {};

    return upsertFederationMembership(client, {
        federationKey: coordinatorMembership.federation_key,
        tenantId: coordinatorMembership.tenant_id,
        coordinatorTenantId: coordinatorMembership.coordinator_tenant_id,
        actor: input.actor,
        participationMode: coordinatorMembership.participation_mode,
        status: coordinatorMembership.status,
        weight: coordinatorMembership.weight,
        metadata: patchFederationGovernanceMetadata(coordinatorMembership.metadata, {
            policy: nextPolicy,
            automation: nextAutomation,
        }),
    });
}

export async function enrollFederationTenant(
    client: SupabaseClient,
    input: {
        federationKey: string;
        actorTenantId: string;
        actor: string | null;
        targetTenantId: string;
        participationMode?: FederationParticipationMode;
        status?: FederationMembershipStatus;
        weight?: number;
        metadata?: Record<string, unknown>;
    },
): Promise<FederationMembershipRecord> {
    const coordinatorMembership = await requireCoordinatorMembership(client, input.federationKey, input.actorTenantId, input.actor);
    const governance = readFederationGovernanceState(coordinatorMembership.metadata).policy;
    if (
        governance.enrollment_mode === 'allow_list'
        && input.targetTenantId !== coordinatorMembership.tenant_id
        && governance.approved_tenant_ids.length > 0
        && !governance.approved_tenant_ids.includes(input.targetTenantId)
    ) {
        throw new Error('This tenant is not approved by the federation allow-list policy.');
    }

    return upsertFederationMembership(client, {
        federationKey: input.federationKey,
        tenantId: input.targetTenantId,
        coordinatorTenantId: coordinatorMembership.coordinator_tenant_id,
        actor: input.actor,
        participationMode: input.participationMode ?? 'full',
        status: input.status ?? 'active',
        weight: input.weight ?? 1,
        metadata: mergeRecords(input.metadata ?? {}, {
            enrollment: {
                enrolled_at: new Date().toISOString(),
                enrolled_by: input.actor,
                enrolled_via: 'coordinator_control_plane',
            },
        }),
    });
}

export async function runFederationAutomation(
    client: SupabaseClient,
    input: {
        federationKey: string;
        actorTenantId: string | null;
        actor: string | null;
        force?: boolean;
        now?: Date;
    },
): Promise<FederationAutomationExecution> {
    const coordinatorMembership = input.actorTenantId
        ? await requireCoordinatorMembership(client, input.federationKey, input.actorTenantId, input.actor)
        : await getCoordinatorMembershipForFederation(client, input.federationKey);
    if (!coordinatorMembership) {
        throw new Error('No coordinator membership exists for this federation key.');
    }

    const now = input.now ?? new Date();
    const governanceState = readFederationGovernanceState(coordinatorMembership.metadata);
    const governance = governanceState.policy;
    const autoEnrolledMemberships = governance.auto_enroll_enabled
        ? await autoEnrollFederationApprovedTenants(client, coordinatorMembership, governance, input.actor)
        : [];
    const shouldRunRound = input.force === true || (
        governance.auto_run_rounds
        && isFederationRoundDue(governanceState.automation, now)
    );

    if (!shouldRunRound) {
        await persistFederationAutomationState(client, coordinatorMembership, {
            last_automation_run_at: now.toISOString(),
            last_automation_error: null,
        });

        return {
            federation_key: coordinatorMembership.federation_key,
            coordinator_tenant_id: coordinatorMembership.coordinator_tenant_id,
            governance,
            automation: {
                ...governanceState.automation,
                last_automation_run_at: now.toISOString(),
            },
            auto_enrolled_memberships: autoEnrolledMemberships,
            published_snapshots: [],
            round: null,
            artifacts: [],
            secure_contributions: [],
            skipped_reason: governance.auto_run_rounds
                ? 'Federation round is not due yet for this schedule.'
                : 'Automatic federation rounds are disabled for this federation.',
        };
    }

    try {
        const result = await runFederationRound(client, {
            federationKey: input.federationKey,
            actorTenantId: coordinatorMembership.tenant_id,
            actor: input.actor,
            snapshotMaxAgeHours: governance.snapshot_max_age_hours,
        });
        const refreshedCoordinator = await getCoordinatorMembershipForFederation(client, input.federationKey);
        const refreshedGovernance = readFederationGovernanceState(refreshedCoordinator?.metadata ?? coordinatorMembership.metadata);

        await persistFederationAutomationState(client, refreshedCoordinator ?? coordinatorMembership, {
            last_automation_run_at: now.toISOString(),
            last_automation_error: null,
        });

        return {
            federation_key: input.federationKey,
            coordinator_tenant_id: coordinatorMembership.coordinator_tenant_id,
            governance: refreshedGovernance.policy,
            automation: {
                ...refreshedGovernance.automation,
                last_automation_run_at: now.toISOString(),
                last_automation_error: null,
            },
            auto_enrolled_memberships: autoEnrolledMemberships,
            published_snapshots: result.published_snapshots,
            round: result.round,
            artifacts: result.artifacts,
            secure_contributions: result.secure_contributions,
            skipped_reason: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown federation automation error';
        await persistFederationAutomationState(client, coordinatorMembership, {
            last_automation_run_at: now.toISOString(),
            last_automation_error: message,
        });
        throw error;
    }
}

export async function runDueFederationAutomation(
    client: SupabaseClient,
    input: {
        tenantId?: string | null;
        federationKey?: string | null;
        actor: string | null;
        now?: Date;
    },
): Promise<FederationAutomationExecution[]> {
    const coordinatorMemberships = await listCoordinatorMemberships(client, input.tenantId ?? null, input.federationKey ?? null);
    const now = input.now ?? new Date();
    const executions: FederationAutomationExecution[] = [];

    for (const membership of coordinatorMemberships) {
        const governanceState = readFederationGovernanceState(membership.metadata);
        if (!governanceState.policy.auto_run_rounds) {
            continue;
        }
        if (!isFederationRoundDue(governanceState.automation, now)) {
            continue;
        }

        executions.push(await runFederationAutomation(client, {
            federationKey: membership.federation_key,
            actorTenantId: membership.tenant_id,
            actor: input.actor,
            now,
        }));
    }

    return executions;
}

export async function publishFederatedSiteSnapshots(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        federationKey?: string | null;
    },
): Promise<FederatedSiteSnapshotRecord[]> {
    const memberships = await listTenantFederationMemberships(client, input.tenantId, input.federationKey ?? null);
    const activeMemberships = memberships.filter((membership) => membership.status === 'active');
    if (activeMemberships.length === 0) {
        return [];
    }

    const experimentStore = createSupabaseExperimentTrackingStore(client);
    const learningStore = createSupabaseLearningEngineStore(client);

    return Promise.all(activeMemberships.map(async (membership) => {
        const [datasets, benchmarks, calibrations, audits, registryEntries, outcomeEligibilitySnapshot] = await Promise.all([
            experimentStore.listLearningDatasetVersions(membership.tenant_id, 24),
            experimentStore.listLearningBenchmarkReports(membership.tenant_id, 24),
            experimentStore.listLearningCalibrationReports(membership.tenant_id, 24),
            experimentStore.listLearningAuditEvents(membership.tenant_id, 24),
            learningStore.listModelRegistryEntries(membership.tenant_id),
            getLatestOutcomeEligibilitySnapshot(client, membership.tenant_id, membership.federation_key),
        ]);

        const champions = registryEntries.filter((entry) => entry.is_champion);
        const diagnosisChampion = champions.find((entry) => entry.task_type === 'diagnosis') ?? null;
        const severityChampion = champions.find((entry) => entry.task_type === 'severity') ?? null;
        const timestamps = [
            ...datasets.map((dataset) => dataset.created_at),
            ...benchmarks.map((benchmark) => benchmark.created_at),
            ...calibrations.map((calibration) => calibration.created_at),
            ...audits.map((audit) => audit.created_at),
        ];
        const benchmarkPassCount = benchmarks.filter((benchmark) => benchmark.pass_status === 'pass').length;
        const totalDatasetRows = datasets.reduce((sum, dataset) => sum + dataset.row_count, 0);
        const latestCalibrationEce = calibrations[0]?.ece_score ?? null;
        const averageCalibrationEce = averageNumbers(calibrations.map((calibration) => calibration.ece_score));
        const outcomeEligibility = buildFederatedOutcomeEligibilityDigest(outcomeEligibilitySnapshot);
        const supportSummary = {
            benchmark_pass_rate: benchmarks.length > 0 ? benchmarkPassCount / benchmarks.length : null,
            latest_calibration_ece: latestCalibrationEce,
            average_calibration_ece: averageCalibrationEce,
            total_dataset_rows: totalDatasetRows,
            dataset_versions: datasets.length,
            champion_versions: compactStrings([
                diagnosisChampion?.model_version ?? null,
                severityChampion?.model_version ?? null,
            ]),
            outcome_eligibility_status: outcomeEligibility.eligibility_status,
            outcome_confirmed_rows: outcomeEligibility.counts.outcome_confirmed_rows,
            consented_network_learning_rows: outcomeEligibility.counts.consented_network_learning_rows,
            provenance_verified_rows: outcomeEligibility.counts.provenance_verified_rows,
            trust_scored_rows: outcomeEligibility.counts.trust_scored_rows,
            federated_outcome_eligibility: toOutcomeEligibilitySummary(outcomeEligibility),
        };
        const qualitySummary = {
            benchmark_pass_rate: benchmarks.length > 0 ? benchmarkPassCount / benchmarks.length : null,
            calibration_avg_ece: averageCalibrationEce,
            audit_event_density: audits.length,
            participation_mode: membership.participation_mode,
            outcome_eligibility_score: outcomeEligibility.eligibility_score,
            outcome_eligibility_blockers: outcomeEligibility.blockers,
        };
        const payload = {
            generated_by: 'federation_service_v1',
            generated_at: new Date().toISOString(),
            membership_weight: membership.weight,
            participation_mode: membership.participation_mode,
            datasets: datasets.slice(0, 5).map((dataset) => ({
                dataset_version: dataset.dataset_version,
                dataset_kind: dataset.dataset_kind,
                row_count: dataset.row_count,
                created_at: dataset.created_at,
            })),
            champions: [
                diagnosisChampion ? summarizeChampionEntry(diagnosisChampion) : null,
                severityChampion ? summarizeChampionEntry(severityChampion) : null,
            ].filter(Boolean),
            benchmarks: benchmarks.slice(0, 5).map((benchmark) => ({
                benchmark_family: benchmark.benchmark_family,
                task_type: benchmark.task_type,
                pass_status: benchmark.pass_status,
                summary_score: benchmark.summary_score,
                created_at: benchmark.created_at,
            })),
            calibrations: calibrations.slice(0, 5).map((calibration) => ({
                task_type: calibration.task_type,
                ece_score: calibration.ece_score,
                brier_score: calibration.brier_score,
                created_at: calibration.created_at,
            })),
            federated_outcome_eligibility: toOutcomeEligibilitySummary(outcomeEligibility),
        };

        const inserted = await insertSiteSnapshot(client, {
            federation_key: membership.federation_key,
            tenant_id: membership.tenant_id,
            coordinator_tenant_id: membership.coordinator_tenant_id,
            snapshot_window_start: minimumTimestamp(timestamps),
            snapshot_window_end: maximumTimestamp(timestamps) ?? new Date().toISOString(),
            dataset_version: datasets[0]?.dataset_version ?? null,
            dataset_versions: datasets.length,
            total_dataset_rows: totalDatasetRows,
            benchmark_reports: benchmarks.length,
            calibration_reports: calibrations.length,
            audit_events: audits.length,
            champion_models: champions.length,
            support_summary: supportSummary,
            quality_summary: qualitySummary,
            snapshot_payload: payload,
        });

        await touchFederationMembershipSnapshot(client, membership.id, inserted.created_at);
        return inserted;
    }));
}

export async function runFederationRound(
    client: SupabaseClient,
    input: {
        federationKey: string;
        actorTenantId: string | null;
        actor: string | null;
        snapshotMaxAgeHours?: number;
    },
): Promise<{
    round: FederationRoundRecord;
    published_snapshots: FederatedSiteSnapshotRecord[];
    artifacts: ModelDeltaArtifactRecord[];
    secure_contributions: SecureAggregationContributionRecord[];
}> {
    let memberships = await listActiveMembershipsByFederation(client, input.federationKey);
    if (memberships.length === 0) {
        throw new Error('No active federation members were found for this federation key.');
    }

    const coordinatorMembership = await getCoordinatorMembershipForFederation(client, input.federationKey);
    const coordinatorTenantId = coordinatorMembership?.coordinator_tenant_id ?? memberships[0]?.coordinator_tenant_id ?? null;
    if (input.actorTenantId && coordinatorTenantId && input.actorTenantId !== coordinatorTenantId) {
        throw new Error('Only the coordinator tenant can run federation rounds for this key.');
    }

    const governance = readFederationGovernanceState(coordinatorMembership?.metadata).policy;
    if (governance.auto_enroll_enabled && coordinatorMembership) {
        await autoEnrollFederationApprovedTenants(client, coordinatorMembership, governance, input.actor);
        memberships = await listActiveMembershipsByFederation(client, input.federationKey);
    }

    const governedMemberships = filterMembershipsForGovernance(memberships, coordinatorTenantId, governance);
    if (governedMemberships.length < governance.minimum_participants) {
        throw new Error(`Federation governance requires at least ${governance.minimum_participants} eligible members before a round can start.`);
    }

    const snapshotMaxAgeHours = input.snapshotMaxAgeHours ?? governance.snapshot_max_age_hours ?? 24;
    const latestSnapshotsBeforePublish = await listLatestSnapshotsForFederation(client, input.federationKey);
    const staleTenants = governedMemberships
        .filter((membership) => {
            const snapshot = latestSnapshotsBeforePublish.find((candidate) => candidate.tenant_id === membership.tenant_id);
            return !snapshot || isStaleTimestamp(snapshot.created_at, snapshotMaxAgeHours);
        })
        .map((membership) => membership.tenant_id);

    const publishedSnapshots = staleTenants.length > 0
        ? (await Promise.all(staleTenants.map((tenantId) => publishFederatedSiteSnapshots(client, {
            tenantId,
            actor: input.actor,
            federationKey: input.federationKey,
        })))).flat()
        : [];

    const latestSnapshots = await listLatestSnapshotsForFederation(client, input.federationKey);
    const participantSnapshots = latestSnapshots.filter((snapshot) => governedMemberships.some((membership) => membership.tenant_id === snapshot.tenant_id));
    if (participantSnapshots.length === 0) {
        throw new Error('No tenant snapshots are available to aggregate for this federation round.');
    }

    const roundKey = createRoundKey(input.federationKey);
    const round = await insertFederationRound(client, {
        federation_key: input.federationKey,
        coordinator_tenant_id: coordinatorTenantId ?? input.actorTenantId ?? 'unknown_coordinator',
        round_key: roundKey,
        status: 'aggregating',
        aggregation_strategy: 'weighted_mean_v1',
        snapshot_cutoff_at: new Date().toISOString(),
        participant_count: participantSnapshots.length,
        aggregate_payload: {},
        candidate_artifact_payload: {},
        notes: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        created_by: input.actor,
    });

    try {
        const learningStore = createSupabaseLearningEngineStore(client);
        const participants = await Promise.all(participantSnapshots.map(async (snapshot) => {
            const membership = governedMemberships.find((candidate) => candidate.tenant_id === snapshot.tenant_id) ?? null;
            const entries = await learningStore.listModelRegistryEntries(snapshot.tenant_id);
            const diagnosisChampion = entries.find((entry) => entry.task_type === 'diagnosis' && entry.is_champion) ?? null;
            const severityChampion = entries.find((entry) => entry.task_type === 'severity' && entry.is_champion) ?? null;
            const siteWeight = resolveParticipantWeight(snapshot, membership, diagnosisChampion, severityChampion);

            return {
                snapshot,
                membership,
                diagnosisChampion,
                severityChampion,
                diagnosisArtifact: decodeDiagnosisArtifact(diagnosisChampion?.artifact_payload ?? null),
                severityArtifact: decodeSeverityArtifact(severityChampion?.artifact_payload ?? null),
                siteWeight,
            };
        }));

        const evaluatedParticipants = participants.map((participant) => ({
            participant,
            reasons: evaluateParticipantGovernanceReasons(participant.snapshot, participant.membership, governance),
        }));
        const eligibleParticipants = evaluatedParticipants
            .filter((candidate) => candidate.reasons.length === 0)
            .map((candidate) => candidate.participant);
        const excludedParticipants = evaluatedParticipants
            .filter((candidate) => candidate.reasons.length > 0)
            .map((candidate) => ({
                tenant_id: candidate.participant.snapshot.tenant_id,
                reasons: candidate.reasons,
            }));

        if (eligibleParticipants.length < governance.minimum_participants) {
            throw new Error(
                `Federation governance left only ${eligibleParticipants.length} eligible participant(s); at least ${governance.minimum_participants} are required.`,
            );
        }

        const secureAggregation = buildSecureAggregationManifest(input.federationKey, roundKey, eligibleParticipants);
        const diagnosisCandidate = aggregateDiagnosisArtifacts(input.federationKey, roundKey, eligibleParticipants, new Date().toISOString());
        const severityCandidate = aggregateSeverityArtifacts(input.federationKey, roundKey, eligibleParticipants, new Date().toISOString());
        const aggregatePayload = buildFederationAggregatePayload(input.federationKey, roundKey, eligibleParticipants, diagnosisCandidate, severityCandidate, secureAggregation);
        const candidateArtifactPayload = {
            diagnosis: diagnosisCandidate,
            severity: severityCandidate,
        };

        const completedRound = await updateFederationRound(client, round.id, {
            status: 'completed',
            participant_count: eligibleParticipants.length,
            aggregate_payload: {
                ...aggregatePayload,
                governance: {
                    enrollment_mode: governance.enrollment_mode,
                    minimum_participants: governance.minimum_participants,
                    minimum_benchmark_pass_rate: governance.minimum_benchmark_pass_rate,
                    maximum_calibration_avg_ece: governance.maximum_calibration_avg_ece,
                    allow_shadow_participants: governance.allow_shadow_participants,
                    snapshot_max_age_hours: snapshotMaxAgeHours,
                },
                excluded_participants: excludedParticipants,
                secure_aggregation: secureAggregation,
            },
            candidate_artifact_payload: candidateArtifactPayload,
            completed_at: new Date().toISOString(),
        });

        const secureContributionRecords = await insertSecureAggregationContributions(
            client,
            buildSecureAggregationContributionRecords({
                roundId: completedRound.id,
                federationKey: completedRound.federation_key,
                coordinatorTenantId: completedRound.coordinator_tenant_id,
                roundKey,
                participants: eligibleParticipants,
            }),
        );

        const siteArtifacts = shouldStoreRawSiteDeltaArtifacts()
            ? eligibleParticipants.flatMap((participant) => {
            const artifacts: Array<Omit<ModelDeltaArtifactRecord, 'id' | 'created_at'>> = [];
            if (participant.diagnosisChampion) {
                artifacts.push(buildSiteDeltaArtifactRecord({
                    roundId: completedRound.id,
                    federationKey: completedRound.federation_key,
                    coordinatorTenantId: completedRound.coordinator_tenant_id,
                    tenantId: participant.snapshot.tenant_id,
                    taskType: 'diagnosis',
                    modelVersion: participant.diagnosisChampion.model_version,
                    datasetVersion: participant.diagnosisChampion.training_dataset_version,
                    artifactPayload: participant.diagnosisChampion.artifact_payload,
                    summary: {
                        site_weight: participant.siteWeight,
                        benchmark_pass_rate: participant.snapshot.support_summary.benchmark_pass_rate ?? null,
                        total_dataset_rows: participant.snapshot.total_dataset_rows,
                    },
                }));
            }
            if (participant.severityChampion) {
                artifacts.push(buildSiteDeltaArtifactRecord({
                    roundId: completedRound.id,
                    federationKey: completedRound.federation_key,
                    coordinatorTenantId: completedRound.coordinator_tenant_id,
                    tenantId: participant.snapshot.tenant_id,
                    taskType: 'severity',
                    modelVersion: participant.severityChampion.model_version,
                    datasetVersion: participant.severityChampion.training_dataset_version,
                    artifactPayload: participant.severityChampion.artifact_payload,
                    summary: {
                        site_weight: participant.siteWeight,
                        benchmark_pass_rate: participant.snapshot.support_summary.benchmark_pass_rate ?? null,
                        total_dataset_rows: participant.snapshot.total_dataset_rows,
                    },
                }));
            }
            return artifacts;
        })
            : [];

        const aggregateArtifacts = [
            ...(diagnosisCandidate ? [buildAggregateCandidateArtifactRecord({
                roundId: completedRound.id,
                federationKey: completedRound.federation_key,
                coordinatorTenantId: completedRound.coordinator_tenant_id,
                taskType: 'diagnosis',
                modelVersion: diagnosisCandidate.model_version,
                datasetVersion: diagnosisCandidate.dataset_version,
                artifactPayload: diagnosisCandidate as unknown as Record<string, unknown>,
                summary: {
                    participant_count: participantSnapshots.length,
                    aggregate_dataset_rows: aggregatePayload.aggregate_dataset_rows,
                },
            })] : []),
            ...(severityCandidate ? [buildAggregateCandidateArtifactRecord({
                roundId: completedRound.id,
                federationKey: completedRound.federation_key,
                coordinatorTenantId: completedRound.coordinator_tenant_id,
                taskType: 'severity',
                modelVersion: severityCandidate.model_version,
                datasetVersion: severityCandidate.dataset_version,
                artifactPayload: severityCandidate as unknown as Record<string, unknown>,
                summary: {
                    participant_count: participantSnapshots.length,
                    aggregate_dataset_rows: aggregatePayload.aggregate_dataset_rows,
                },
            })] : []),
        ];

        const artifactRecords = await insertModelDeltaArtifacts(client, [
            ...siteArtifacts,
            ...aggregateArtifacts,
        ]);

        if (coordinatorMembership) {
            await persistFederationAutomationState(client, coordinatorMembership, {
                last_round_started_at: completedRound.started_at,
                next_round_due_at: computeNextFederationRoundDueAt(completedRound.started_at, governance),
                last_automation_error: null,
            });
        }

        return {
            round: completedRound,
            published_snapshots: publishedSnapshots,
            artifacts: artifactRecords,
            secure_contributions: secureContributionRecords,
        };
    } catch (error) {
        await updateFederationRound(client, round.id, {
            status: 'failed',
            notes: error instanceof Error ? error.message : 'Unknown federation aggregation error',
            completed_at: new Date().toISOString(),
        });
        throw error;
    }
}

export async function getFederationPublicSummary(
    client: SupabaseClient,
    tenantId: string,
): Promise<FederatedPublicSummary> {
    const memberships = await listTenantFederationMemberships(client, tenantId, null);
    const activeMembership = memberships.find((membership) => membership.status === 'active') ?? null;
    if (!activeMembership) {
        return {
            active: false,
            federation_key: null,
            participant_count: 0,
            recent_rounds: 0,
            latest_snapshot_at: null,
            latest_round_status: null,
            latest_round_completed_at: null,
            aggregate_dataset_rows: 0,
            benchmark_pass_rate: null,
            calibration_avg_ece: null,
            diagnosis_candidate_version: null,
            severity_candidate_version: null,
            enrollment_mode: null,
            auto_run_rounds: false,
            round_interval_hours: null,
            next_round_due_at: null,
            minimum_participants: null,
            minimum_benchmark_pass_rate: null,
            maximum_calibration_avg_ece: null,
            privacy_mode: null,
            privacy_status: null,
            privacy_minimum_participants: null,
            privacy_participant_count: null,
            secure_aggregation_status: null,
            secure_contribution_count: null,
            raw_site_delta_artifacts_stored: null,
            raw_tenant_ids_in_aggregate: null,
        };
    }

    const [membersForKey, latestSnapshots, rounds] = await Promise.all([
        listActiveMembershipsByFederation(client, activeMembership.federation_key),
        listLatestSnapshotsForFederation(client, activeMembership.federation_key),
        listRoundsForFederations(client, [activeMembership.federation_key], 8),
    ]);
    const latestSnapshot = latestSnapshots.find((snapshot) => snapshot.tenant_id === tenantId) ?? null;
    const latestRound = rounds[0] ?? null;
    const diagnosisCandidate = readArtifactVersion(latestRound?.candidate_artifact_payload?.diagnosis);
    const severityCandidate = readArtifactVersion(latestRound?.candidate_artifact_payload?.severity);
    const coordinatorMembership = await getCoordinatorMembershipForFederation(client, activeMembership.federation_key);
    const governance = readFederationGovernanceState(coordinatorMembership?.metadata ?? activeMembership.metadata);
    const aggregateDatasetRows = latestRound
        ? readNumber(latestRound.aggregate_payload.aggregate_dataset_rows) ?? 0
        : latestSnapshots.reduce((sum, snapshot) => sum + snapshot.total_dataset_rows, 0);
    const privacyManifest = asRecord(latestRound?.aggregate_payload.privacy_manifest);
    const secureAggregation = asRecord(latestRound?.aggregate_payload.secure_aggregation);

    return {
        active: true,
        federation_key: activeMembership.federation_key,
        participant_count: membersForKey.length,
        recent_rounds: rounds.length,
        latest_snapshot_at: latestSnapshot?.created_at ?? null,
        latest_round_status: latestRound?.status ?? null,
        latest_round_completed_at: latestRound?.completed_at ?? null,
        aggregate_dataset_rows: aggregateDatasetRows,
        benchmark_pass_rate: latestRound ? readNumber(latestRound.aggregate_payload.benchmark_pass_rate) : null,
        calibration_avg_ece: latestRound ? readNumber(latestRound.aggregate_payload.calibration_avg_ece) : null,
        diagnosis_candidate_version: diagnosisCandidate,
        severity_candidate_version: severityCandidate,
        enrollment_mode: governance.policy.enrollment_mode,
        auto_run_rounds: governance.policy.auto_run_rounds,
        round_interval_hours: governance.policy.round_interval_hours,
        next_round_due_at: governance.automation.next_round_due_at,
        minimum_participants: governance.policy.minimum_participants,
        minimum_benchmark_pass_rate: governance.policy.minimum_benchmark_pass_rate,
        maximum_calibration_avg_ece: governance.policy.maximum_calibration_avg_ece,
        privacy_mode: readString(privacyManifest.mode),
        privacy_status: readString(privacyManifest.status),
        privacy_minimum_participants: readNumber(privacyManifest.minimum_privacy_participants),
        privacy_participant_count: readNumber(privacyManifest.participant_count),
        secure_aggregation_status: readString(secureAggregation.status),
        secure_contribution_count: readNumber(secureAggregation.contribution_count),
        raw_site_delta_artifacts_stored: typeof secureAggregation.raw_site_delta_artifacts_stored === 'boolean'
            ? secureAggregation.raw_site_delta_artifacts_stored
            : null,
        raw_tenant_ids_in_aggregate: typeof privacyManifest.raw_tenant_ids_in_aggregate === 'boolean'
            ? privacyManifest.raw_tenant_ids_in_aggregate
            : null,
    };
}

async function getFederationMembership(
    client: SupabaseClient,
    federationKey: string,
    tenantId: string,
): Promise<FederationMembershipRecord | null> {
    const { data, error } = await client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .select('*')
        .eq(FEDERATION_MEMBERSHIPS.COLUMNS.federation_key, federationKey)
        .eq(FEDERATION_MEMBERSHIPS.COLUMNS.tenant_id, tenantId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to read federation membership: ${error.message}`);
    }

    return data ? mapFederationMembership(asRecord(data)) : null;
}

async function listMembershipsByFederation(
    client: SupabaseClient,
    federationKey: string,
): Promise<FederationMembershipRecord[]> {
    const { data, error } = await client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .select('*')
        .eq(FEDERATION_MEMBERSHIPS.COLUMNS.federation_key, federationKey)
        .order(FEDERATION_MEMBERSHIPS.COLUMNS.updated_at, { ascending: false });

    if (error) {
        throw new Error(`Failed to list federation memberships by key: ${error.message}`);
    }

    return (data ?? []).map((row) => mapFederationMembership(asRecord(row)));
}

async function getCoordinatorMembershipForFederation(
    client: SupabaseClient,
    federationKey: string,
): Promise<FederationMembershipRecord | null> {
    const memberships = await listMembershipsByFederation(client, federationKey);
    const directCoordinator = memberships.find((membership) => membership.tenant_id === membership.coordinator_tenant_id) ?? null;
    if (directCoordinator) {
        return directCoordinator;
    }

    const coordinatorTenantId = memberships[0]?.coordinator_tenant_id ?? null;
    if (!coordinatorTenantId) {
        return null;
    }

    return memberships.find((membership) => membership.tenant_id === coordinatorTenantId) ?? null;
}

async function requireCoordinatorMembership(
    client: SupabaseClient,
    federationKey: string,
    actorTenantId: string,
    actor: string | null,
): Promise<FederationMembershipRecord> {
    const existing = await getCoordinatorMembershipForFederation(client, federationKey);
    if (!existing) {
        return upsertFederationMembership(client, {
            federationKey,
            tenantId: actorTenantId,
            coordinatorTenantId: actorTenantId,
            actor,
            participationMode: 'full',
            status: 'active',
            weight: 1,
            metadata: patchFederationGovernanceMetadata({}, {
                automation: {
                    next_round_due_at: computeNextFederationRoundDueAt(null, readFederationGovernanceState({}).policy),
                },
            }),
        });
    }

    if (existing.coordinator_tenant_id !== actorTenantId && existing.tenant_id !== actorTenantId) {
        throw new Error('Only the federation coordinator tenant can manage enrollment, governance, or scheduling.');
    }

    return existing;
}

async function listCoordinatorMemberships(
    client: SupabaseClient,
    tenantId: string | null,
    federationKey: string | null,
): Promise<FederationMembershipRecord[]> {
    let query = client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .select('*')
        .order(FEDERATION_MEMBERSHIPS.COLUMNS.updated_at, { ascending: false });

    if (tenantId) {
        query = query.eq(FEDERATION_MEMBERSHIPS.COLUMNS.tenant_id, tenantId);
    }

    if (federationKey) {
        query = query.eq(FEDERATION_MEMBERSHIPS.COLUMNS.federation_key, federationKey);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to list coordinator federation memberships: ${error.message}`);
    }

    return (data ?? [])
        .map((row) => mapFederationMembership(asRecord(row)))
        .filter((membership) => membership.tenant_id === membership.coordinator_tenant_id && membership.status === 'active');
}

async function autoEnrollFederationApprovedTenants(
    client: SupabaseClient,
    coordinatorMembership: FederationMembershipRecord,
    governance: FederationGovernancePolicy,
    actor: string | null,
): Promise<FederationMembershipRecord[]> {
    if (!governance.auto_enroll_enabled || governance.approved_tenant_ids.length === 0) {
        return [];
    }

    const memberships = await listMembershipsByFederation(client, coordinatorMembership.federation_key);
    const existingByTenant = new Map(memberships.map((membership) => [membership.tenant_id, membership]));
    const autoEnrolled: FederationMembershipRecord[] = [];

    for (const tenantId of governance.approved_tenant_ids) {
        if (tenantId === coordinatorMembership.tenant_id) {
            continue;
        }
        const existing = existingByTenant.get(tenantId) ?? null;
        if (existing?.status === 'active') {
            continue;
        }

        autoEnrolled.push(await upsertFederationMembership(client, {
            federationKey: coordinatorMembership.federation_key,
            tenantId,
            coordinatorTenantId: coordinatorMembership.coordinator_tenant_id,
            actor,
            participationMode: 'full',
            status: 'active',
            weight: 1,
            metadata: {
                enrollment: {
                    enrolled_at: new Date().toISOString(),
                    enrolled_by: actor,
                    enrolled_via: 'automation_allow_list',
                },
            },
        }));
    }

    return autoEnrolled;
}

async function persistFederationAutomationState(
    client: SupabaseClient,
    membership: FederationMembershipRecord,
    automation: Partial<FederationAutomationState>,
): Promise<FederationMembershipRecord> {
    return upsertFederationMembership(client, {
        federationKey: membership.federation_key,
        tenantId: membership.tenant_id,
        coordinatorTenantId: membership.coordinator_tenant_id,
        actor: membership.created_by,
        participationMode: membership.participation_mode,
        status: membership.status,
        weight: membership.weight,
        metadata: patchFederationGovernanceMetadata(membership.metadata, {
            automation,
        }),
    });
}

function filterMembershipsForGovernance(
    memberships: FederationMembershipRecord[],
    coordinatorTenantId: string | null,
    governance: FederationGovernancePolicy,
): FederationMembershipRecord[] {
    return memberships.filter((membership) => {
        if (membership.status !== 'active') {
            return false;
        }
        if (!governance.allow_shadow_participants && membership.participation_mode === 'shadow') {
            return false;
        }
        if (
            governance.enrollment_mode === 'allow_list'
            && membership.tenant_id !== coordinatorTenantId
            && governance.approved_tenant_ids.length > 0
            && !governance.approved_tenant_ids.includes(membership.tenant_id)
        ) {
            return false;
        }
        return true;
    });
}

function evaluateParticipantGovernanceReasons(
    snapshot: FederatedSiteSnapshotRecord,
    membership: FederationMembershipRecord | null,
    governance: FederationGovernancePolicy,
): string[] {
    const reasons: string[] = [];
    if (!governance.allow_shadow_participants && membership?.participation_mode === 'shadow') {
        reasons.push('shadow participation disabled');
    }

    const benchmarkPassRate = readNumber(snapshot.support_summary.benchmark_pass_rate);
    if (
        governance.minimum_benchmark_pass_rate != null
        && (benchmarkPassRate == null || benchmarkPassRate < governance.minimum_benchmark_pass_rate)
    ) {
        reasons.push('benchmark pass rate below threshold');
    }

    const calibrationAvgEce = readNumber(snapshot.quality_summary.calibration_avg_ece)
        ?? readNumber(snapshot.support_summary.average_calibration_ece);
    if (
        governance.maximum_calibration_avg_ece != null
        && (calibrationAvgEce == null || calibrationAvgEce > governance.maximum_calibration_avg_ece)
    ) {
        reasons.push('calibration ECE above threshold');
    }

    reasons.push(...evaluateFederatedOutcomeEligibilityForRound(readOutcomeEligibilitySummary(snapshot)));

    return reasons;
}

function shouldAdvanceAutomationSchedule(policyPatch: Partial<FederationGovernancePolicy>): boolean {
    return policyPatch.auto_run_rounds !== undefined || policyPatch.round_interval_hours !== undefined;
}

async function listVisibleFederationMemberships(
    client: SupabaseClient,
    tenantId: string,
    federationKey: string | null,
): Promise<FederationMembershipRecord[]> {
    let query = client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .select('*')
        .or(`${FEDERATION_MEMBERSHIPS.COLUMNS.tenant_id}.eq.${tenantId},${FEDERATION_MEMBERSHIPS.COLUMNS.coordinator_tenant_id}.eq.${tenantId}`)
        .order(FEDERATION_MEMBERSHIPS.COLUMNS.updated_at, { ascending: false });

    if (federationKey) {
        query = query.eq(FEDERATION_MEMBERSHIPS.COLUMNS.federation_key, federationKey);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to list federation memberships: ${error.message}`);
    }

    return (data ?? []).map((row) => mapFederationMembership(asRecord(row)));
}

async function listTenantFederationMemberships(
    client: SupabaseClient,
    tenantId: string,
    federationKey: string | null,
): Promise<FederationMembershipRecord[]> {
    let query = client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .select('*')
        .eq(FEDERATION_MEMBERSHIPS.COLUMNS.tenant_id, tenantId)
        .order(FEDERATION_MEMBERSHIPS.COLUMNS.updated_at, { ascending: false });

    if (federationKey) {
        query = query.eq(FEDERATION_MEMBERSHIPS.COLUMNS.federation_key, federationKey);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to list tenant federation memberships: ${error.message}`);
    }

    return (data ?? []).map((row) => mapFederationMembership(asRecord(row)));
}

async function listActiveMembershipsByFederation(
    client: SupabaseClient,
    federationKey: string,
): Promise<FederationMembershipRecord[]> {
    const { data, error } = await client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .select('*')
        .eq(FEDERATION_MEMBERSHIPS.COLUMNS.federation_key, federationKey)
        .eq(FEDERATION_MEMBERSHIPS.COLUMNS.status, 'active')
        .order(FEDERATION_MEMBERSHIPS.COLUMNS.updated_at, { ascending: false });

    if (error) {
        throw new Error(`Failed to list federation participants: ${error.message}`);
    }

    return (data ?? []).map((row) => mapFederationMembership(asRecord(row)));
}

async function listSiteSnapshotsForFederations(
    client: SupabaseClient,
    federationKeys: string[],
    limit: number,
): Promise<FederatedSiteSnapshotRecord[]> {
    const { data, error } = await client
        .from(FEDERATED_SITE_SNAPSHOTS.TABLE)
        .select('*')
        .in(FEDERATED_SITE_SNAPSHOTS.COLUMNS.federation_key, federationKeys)
        .order(FEDERATED_SITE_SNAPSHOTS.COLUMNS.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list federated site snapshots: ${error.message}`);
    }

    return (data ?? []).map((row) => mapFederatedSiteSnapshot(asRecord(row)));
}

async function listLatestSnapshotsForFederation(
    client: SupabaseClient,
    federationKey: string,
): Promise<FederatedSiteSnapshotRecord[]> {
    const snapshots = await listSiteSnapshotsForFederations(client, [federationKey], 200);
    const deduped = new Map<string, FederatedSiteSnapshotRecord>();
    for (const snapshot of snapshots) {
        if (!deduped.has(snapshot.tenant_id)) {
            deduped.set(snapshot.tenant_id, snapshot);
        }
    }
    return Array.from(deduped.values());
}

async function listLatestOutcomeEligibilitySnapshotsForFederations(
    client: SupabaseClient,
    federationKeys: string[],
    limit: number,
): Promise<FederatedOutcomeEligibilitySnapshotRecord[]> {
    const C = FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.TABLE)
        .select('*')
        .in(C.federation_key, federationKeys)
        .order(C.observed_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list federated outcome eligibility snapshots: ${error.message}`);
    }

    const deduped = new Map<string, FederatedOutcomeEligibilitySnapshotRecord>();
    for (const row of data ?? []) {
        const snapshot = mapFederatedOutcomeEligibilitySnapshot(asRecord(row));
        const key = `${snapshot.federation_key}:${snapshot.tenant_id}`;
        if (!deduped.has(key)) {
            deduped.set(key, snapshot);
        }
    }
    return Array.from(deduped.values());
}

async function getLatestOutcomeEligibilitySnapshot(
    client: SupabaseClient,
    tenantId: string,
    federationKey: string,
): Promise<FederatedOutcomeEligibilitySnapshotRecord | null> {
    const C = FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.federation_key, federationKey)
        .order(C.observed_at, { ascending: false })
        .limit(1);

    if (error) {
        return null;
    }

    const row = Array.isArray(data) ? data[0] : null;
    return row ? mapFederatedOutcomeEligibilitySnapshot(asRecord(row)) : null;
}

async function listRoundsForFederations(
    client: SupabaseClient,
    federationKeys: string[],
    limit: number,
): Promise<FederationRoundRecord[]> {
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .select('*')
        .in(FEDERATION_ROUNDS.COLUMNS.federation_key, federationKeys)
        .order(FEDERATION_ROUNDS.COLUMNS.started_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list federation rounds: ${error.message}`);
    }

    return (data ?? []).map((row) => mapFederationRound(asRecord(row)));
}

async function listModelDeltaArtifactsForRounds(
    client: SupabaseClient,
    roundIds: string[],
    limit: number,
): Promise<ModelDeltaArtifactRecord[]> {
    const { data, error } = await client
        .from(MODEL_DELTA_ARTIFACTS.TABLE)
        .select('*')
        .in(MODEL_DELTA_ARTIFACTS.COLUMNS.federation_round_id, roundIds)
        .order(MODEL_DELTA_ARTIFACTS.COLUMNS.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list model delta artifacts: ${error.message}`);
    }

    return (data ?? []).map((row) => mapModelDeltaArtifact(asRecord(row)));
}

async function insertSiteSnapshot(
    client: SupabaseClient,
    record: Omit<FederatedSiteSnapshotRecord, 'id' | 'created_at'>,
): Promise<FederatedSiteSnapshotRecord> {
    const { data, error } = await client
        .from(FEDERATED_SITE_SNAPSHOTS.TABLE)
        .insert(record)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create federated site snapshot: ${error?.message ?? 'Unknown error'}`);
    }

    return mapFederatedSiteSnapshot(asRecord(data));
}

async function touchFederationMembershipSnapshot(
    client: SupabaseClient,
    membershipId: string,
    createdAt: string,
): Promise<void> {
    const { error } = await client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .update({
            [FEDERATION_MEMBERSHIPS.COLUMNS.last_snapshot_at]: createdAt,
        })
        .eq(FEDERATION_MEMBERSHIPS.COLUMNS.id, membershipId);

    if (error) {
        throw new Error(`Failed to update federation membership snapshot timestamp: ${error.message}`);
    }
}

async function insertFederationRound(
    client: SupabaseClient,
    record: Omit<FederationRoundRecord, 'id' | 'created_at' | 'updated_at'>,
): Promise<FederationRoundRecord> {
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .insert(record)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create federation round: ${error?.message ?? 'Unknown error'}`);
    }

    return mapFederationRound(asRecord(data));
}

async function updateFederationRound(
    client: SupabaseClient,
    roundId: string,
    patch: Partial<Omit<FederationRoundRecord, 'id' | 'federation_key' | 'coordinator_tenant_id' | 'round_key' | 'created_at' | 'updated_at'>>,
): Promise<FederationRoundRecord> {
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .update(patch)
        .eq(FEDERATION_ROUNDS.COLUMNS.id, roundId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to update federation round: ${error?.message ?? 'Unknown error'}`);
    }

    return mapFederationRound(asRecord(data));
}

async function insertModelDeltaArtifacts(
    client: SupabaseClient,
    records: Array<Omit<ModelDeltaArtifactRecord, 'id' | 'created_at'>>,
): Promise<ModelDeltaArtifactRecord[]> {
    if (records.length === 0) {
        return [];
    }

    const { data, error } = await client
        .from(MODEL_DELTA_ARTIFACTS.TABLE)
        .insert(records)
        .select('*');

    if (error) {
        throw new Error(`Failed to create model delta artifacts: ${error.message}`);
    }

    return (data ?? []).map((row) => mapModelDeltaArtifact(asRecord(row)));
}

async function listSecureAggregationContributionsForRounds(
    client: SupabaseClient,
    roundIds: string[],
    limit: number,
): Promise<SecureAggregationContributionRecord[]> {
    if (roundIds.length === 0) return [];
    const C = FEDERATED_SECURE_AGGREGATION_CONTRIBUTIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_SECURE_AGGREGATION_CONTRIBUTIONS.TABLE)
        .select('*')
        .in(C.federation_round_id, roundIds)
        .order(C.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list secure aggregation contributions: ${error.message}`);
    }

    return (data ?? []).map((row) => mapSecureAggregationContribution(asRecord(row)));
}

async function insertSecureAggregationContributions(
    client: SupabaseClient,
    records: Array<Omit<SecureAggregationContributionRecord, 'id' | 'created_at'>>,
): Promise<SecureAggregationContributionRecord[]> {
    if (records.length === 0) return [];
    const C = FEDERATED_SECURE_AGGREGATION_CONTRIBUTIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_SECURE_AGGREGATION_CONTRIBUTIONS.TABLE)
        .upsert(records, {
            onConflict: `${C.federation_round_id},${C.tenant_id},${C.contribution_role}`,
        })
        .select('*');

    if (error) {
        throw new Error(`Failed to create secure aggregation contributions: ${error.message}`);
    }

    return (data ?? []).map((row) => mapSecureAggregationContribution(asRecord(row)));
}

function buildFederationAggregatePayload(
    federationKey: string,
    roundKey: string,
    participants: Array<{
        snapshot: FederatedSiteSnapshotRecord;
        siteWeight: number;
    }>,
    diagnosisCandidate: DiagnosisModelArtifact | null,
    severityCandidate: SeverityModelArtifact | null,
    secureAggregation: Record<string, unknown>,
): Record<string, unknown> {
    const benchmarkPassRate = averageNumbers(
        participants.map((participant) => readNumber(participant.snapshot.support_summary.benchmark_pass_rate)),
    );
    const calibrationAvgEce = averageNumbers(
        participants.map((participant) => readNumber(participant.snapshot.support_summary.average_calibration_ece)),
    );

    return {
        aggregate_dataset_rows: participants.reduce((sum, participant) => sum + participant.snapshot.total_dataset_rows, 0),
        participant_count: participants.length,
        benchmark_pass_rate: benchmarkPassRate,
        calibration_avg_ece: calibrationAvgEce,
        federated_candidate_tasks: compactStrings([
            diagnosisCandidate ? 'diagnosis' : null,
            severityCandidate ? 'severity' : null,
        ]),
        source_tenant_count: participants.length,
        source_participant_refs: participants.map((participant) => createParticipantRef(federationKey, roundKey, participant.snapshot.tenant_id)),
        privacy_manifest: buildFederationPrivacyManifest(federationKey, roundKey, participants, secureAggregation),
    };
}

function buildFederationPrivacyManifest(
    federationKey: string,
    roundKey: string,
    participants: Array<{
        snapshot: FederatedSiteSnapshotRecord;
        siteWeight: number;
    }>,
    secureAggregation: Record<string, unknown>,
): Record<string, unknown> {
    const aggregateDatasetRows = participants.reduce((sum, participant) => sum + participant.snapshot.total_dataset_rows, 0);
    const minimumPrivacyParticipants = 3;
    const minimumRowsPerParticipant = Math.min(...participants.map((participant) => participant.snapshot.total_dataset_rows));
    const participantRefs = participants.map((participant) => createParticipantRef(federationKey, roundKey, participant.snapshot.tenant_id));
    const pass = participants.length >= minimumPrivacyParticipants && minimumRowsPerParticipant >= 10;
    const failedChecks = [
        participants.length < minimumPrivacyParticipants ? `participant_count_below_${minimumPrivacyParticipants}` : null,
        minimumRowsPerParticipant < 10 ? 'site_row_count_below_10' : null,
    ].filter((check): check is string => check != null);

    return {
        mode: 'privacy_preflight_v1',
        status: pass ? 'privacy_ready' : 'privacy_limited',
        participant_count: participants.length,
        minimum_privacy_participants: minimumPrivacyParticipants,
        aggregate_dataset_rows: aggregateDatasetRows,
        minimum_rows_per_participant: Number.isFinite(minimumRowsPerParticipant) ? minimumRowsPerParticipant : 0,
        participant_refs: participantRefs,
        failed_checks: failedChecks,
        raw_tenant_ids_in_aggregate: false,
        raw_case_rows_shared: false,
        patient_identifiers_shared: false,
        owner_identifiers_shared: false,
        coordinator_visibility: 'masked_commitments_and_aggregate_candidates_only',
        masking_protocol: readString(secureAggregation.masking_protocol) ?? 'pairwise_masked_commitment_v1',
        secure_aggregation_status: readString(secureAggregation.status),
        secure_contribution_count: readNumber(secureAggregation.contribution_count),
        raw_site_delta_artifacts_stored: false,
        next_secure_aggregation_step: pass
            ? 'continue_collecting_masked_commitments_and_external_privacy_review'
            : 'increase_participant_count_or_site_support_before_masked_updates',
    };
}

function buildSecureAggregationManifest(
    federationKey: string,
    roundKey: string,
    participants: Array<{
        snapshot: FederatedSiteSnapshotRecord;
        diagnosisChampion: ModelRegistryEntryRecord | null;
        severityChampion: ModelRegistryEntryRecord | null;
        siteWeight: number;
    }>,
): Record<string, unknown> {
    const contributionCount = participants.reduce((sum, participant) => {
        return sum
            + (participant.diagnosisChampion ? 1 : 0)
            + (participant.severityChampion ? 1 : 0)
            + 1;
    }, 0);
    const minimumPrivacyParticipants = 3;
    const minimumRowsPerParticipant = Math.min(...participants.map((participant) => participant.snapshot.total_dataset_rows));
    const ready = participants.length >= minimumPrivacyParticipants && minimumRowsPerParticipant >= 10;

    return {
        mode: 'secure_aggregation_v1',
        status: ready ? 'secure_aggregation_ready' : 'secure_aggregation_limited',
        masking_protocol: 'pairwise_masked_commitment_v1',
        participant_count: participants.length,
        contribution_count: contributionCount,
        minimum_privacy_participants: minimumPrivacyParticipants,
        participant_refs: participants.map((participant) => createParticipantRef(federationKey, roundKey, participant.snapshot.tenant_id)),
        payload_commitment: createCommitmentHash(federationKey, roundKey, 'aggregate_payload', participants.map((participant) => participant.snapshot.tenant_id)),
        raw_site_delta_artifacts_stored: false,
        coordinator_visibility: 'commitment_hashes_only_for_site_updates',
    };
}

function buildSecureAggregationContributionRecords(input: {
    roundId: string;
    federationKey: string;
    coordinatorTenantId: string;
    roundKey: string;
    participants: Array<{
        snapshot: FederatedSiteSnapshotRecord;
        diagnosisChampion: ModelRegistryEntryRecord | null;
        severityChampion: ModelRegistryEntryRecord | null;
        siteWeight: number;
    }>;
}): Array<Omit<SecureAggregationContributionRecord, 'id' | 'created_at'>> {
    const acceptedAt = new Date().toISOString();
    return input.participants.flatMap((participant) => {
        const participantRef = createParticipantRef(input.federationKey, input.roundKey, participant.snapshot.tenant_id);
        const common = {
            federation_round_id: input.roundId,
            federation_key: input.federationKey,
            coordinator_tenant_id: input.coordinatorTenantId,
            tenant_id: participant.snapshot.tenant_id,
            participant_ref: participantRef,
            masking_protocol: 'pairwise_masked_commitment_v1',
            accepted_at: acceptedAt,
        };
        const records: Array<Omit<SecureAggregationContributionRecord, 'id' | 'created_at'>> = [
            {
                ...common,
                contribution_role: 'support',
                payload_commitment_hash: createContributionCommitment(input.federationKey, input.roundKey, participant.snapshot.tenant_id, 'support', participant.snapshot.snapshot_payload),
                mask_commitment_hash: createMaskCommitment(input.federationKey, input.roundKey, participant.snapshot.tenant_id, 'support'),
                masked_payload_summary: {
                    total_dataset_rows: participant.snapshot.total_dataset_rows,
                    benchmark_reports: participant.snapshot.benchmark_reports,
                    calibration_reports: participant.snapshot.calibration_reports,
                    site_weight_bucket: bucketSiteWeight(participant.siteWeight),
                },
                public_summary: {
                    participant_ref: participantRef,
                    contribution_role: 'support',
                    total_dataset_rows: participant.snapshot.total_dataset_rows,
                },
            },
        ];

        if (participant.diagnosisChampion) {
            records.push({
                ...common,
                contribution_role: 'diagnosis',
                payload_commitment_hash: createContributionCommitment(input.federationKey, input.roundKey, participant.snapshot.tenant_id, 'diagnosis', participant.diagnosisChampion.artifact_payload),
                mask_commitment_hash: createMaskCommitment(input.federationKey, input.roundKey, participant.snapshot.tenant_id, 'diagnosis'),
                masked_payload_summary: {
                    model_version_hash: hashValue(participant.diagnosisChampion.model_version),
                    dataset_version_hash: hashValue(participant.diagnosisChampion.training_dataset_version),
                    site_weight_bucket: bucketSiteWeight(participant.siteWeight),
                },
                public_summary: {
                    participant_ref: participantRef,
                    contribution_role: 'diagnosis',
                    task_type: 'diagnosis',
                },
            });
        }

        if (participant.severityChampion) {
            records.push({
                ...common,
                contribution_role: 'severity',
                payload_commitment_hash: createContributionCommitment(input.federationKey, input.roundKey, participant.snapshot.tenant_id, 'severity', participant.severityChampion.artifact_payload),
                mask_commitment_hash: createMaskCommitment(input.federationKey, input.roundKey, participant.snapshot.tenant_id, 'severity'),
                masked_payload_summary: {
                    model_version_hash: hashValue(participant.severityChampion.model_version),
                    dataset_version_hash: hashValue(participant.severityChampion.training_dataset_version),
                    site_weight_bucket: bucketSiteWeight(participant.siteWeight),
                },
                public_summary: {
                    participant_ref: participantRef,
                    contribution_role: 'severity',
                    task_type: 'severity',
                },
            });
        }

        return records;
    });
}

function shouldStoreRawSiteDeltaArtifacts(): boolean {
    return process.env.VETIOS_FEDERATION_STORE_RAW_SITE_DELTAS === 'true';
}

function buildSiteDeltaArtifactRecord(input: {
    roundId: string;
    federationKey: string;
    coordinatorTenantId: string;
    tenantId: string;
    taskType: string;
    modelVersion: string | null;
    datasetVersion: string | null;
    artifactPayload: Record<string, unknown>;
    summary: Record<string, unknown>;
}): Omit<ModelDeltaArtifactRecord, 'id' | 'created_at'> {
    return {
        federation_round_id: input.roundId,
        federation_key: input.federationKey,
        coordinator_tenant_id: input.coordinatorTenantId,
        tenant_id: input.tenantId,
        artifact_role: 'site_delta',
        task_type: input.taskType,
        model_version: input.modelVersion,
        dataset_version: input.datasetVersion,
        artifact_payload: input.artifactPayload,
        summary: input.summary,
    };
}

function buildAggregateCandidateArtifactRecord(input: {
    roundId: string;
    federationKey: string;
    coordinatorTenantId: string;
    taskType: string;
    modelVersion: string | null;
    datasetVersion: string | null;
    artifactPayload: Record<string, unknown>;
    summary: Record<string, unknown>;
}): Omit<ModelDeltaArtifactRecord, 'id' | 'created_at'> {
    return {
        federation_round_id: input.roundId,
        federation_key: input.federationKey,
        coordinator_tenant_id: input.coordinatorTenantId,
        tenant_id: null,
        artifact_role: 'aggregate_candidate',
        task_type: input.taskType,
        model_version: input.modelVersion,
        dataset_version: input.datasetVersion,
        artifact_payload: input.artifactPayload,
        summary: input.summary,
    };
}

function aggregateDiagnosisArtifacts(
    federationKey: string,
    roundKey: string,
    participants: Array<{
        snapshot: FederatedSiteSnapshotRecord;
        diagnosisArtifact: DiagnosisModelArtifact | null;
        siteWeight: number;
    }>,
    trainedAt: string,
): DiagnosisModelArtifact | null {
    const inputs = participants
        .filter((participant): participant is typeof participant & { diagnosisArtifact: DiagnosisModelArtifact } => participant.diagnosisArtifact != null)
        .map((participant) => ({
            artifact: participant.diagnosisArtifact,
            weight: Math.max(participant.siteWeight, 1),
            tenantId: participant.snapshot.tenant_id,
        }));

    if (inputs.length === 0) {
        return null;
    }

    const labels = uniqueStrings(inputs.flatMap((input) => input.artifact.labels));
    return {
        artifact_type: 'diagnosis_frequency_bayes_v1',
        task_type: 'diagnosis',
        model_name: 'VetIOS Federated Diagnosis',
        model_version: `${sanitizeSlug(federationKey)}_diagnosis_${roundKey}`,
        dataset_version: `${sanitizeSlug(federationKey)}:${roundKey}`,
        feature_schema_version: collapseVersion(inputs.map((input) => input.artifact.feature_schema_version)),
        label_policy_version: collapseVersion(inputs.map((input) => input.artifact.label_policy_version)),
        trained_at: trainedAt,
        labels,
        priors: mergeFlatWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.priors }))),
        symptom_weights: mergeNestedWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.symptom_weights }))),
        species_weights: mergeNestedWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.species_weights }))),
        breed_weights: mergeNestedWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.breed_weights }))),
        cluster_weights: mergeNestedWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.cluster_weights }))),
        label_to_condition_class: mergeStringMaps(inputs.map((input) => input.artifact.label_to_condition_class)),
        training_summary: {
            federation_key: federationKey,
            round_key: roundKey,
            participant_count: inputs.length,
            total_weight: inputs.reduce((sum, input) => sum + input.weight, 0),
            source_tenant_count: inputs.length,
            source_participant_refs: inputs.map((input) => createParticipantRef(federationKey, roundKey, input.tenantId)),
            source_model_versions: inputs.map((input) => input.artifact.model_version),
            aggregation_strategy: 'weighted_mean_v1',
            privacy_mode: 'secure_aggregation_v1',
        },
    };
}

function aggregateSeverityArtifacts(
    federationKey: string,
    roundKey: string,
    participants: Array<{
        snapshot: FederatedSiteSnapshotRecord;
        severityArtifact: SeverityModelArtifact | null;
        siteWeight: number;
    }>,
    trainedAt: string,
): SeverityModelArtifact | null {
    const inputs = participants
        .filter((participant): participant is typeof participant & { severityArtifact: SeverityModelArtifact } => participant.severityArtifact != null)
        .map((participant) => ({
            artifact: participant.severityArtifact,
            weight: Math.max(participant.siteWeight, 1),
            tenantId: participant.snapshot.tenant_id,
        }));

    if (inputs.length === 0) {
        return null;
    }

    return {
        artifact_type: 'severity_risk_regression_v1',
        task_type: 'severity',
        model_name: 'VetIOS Federated Severity',
        model_version: `${sanitizeSlug(federationKey)}_severity_${roundKey}`,
        dataset_version: `${sanitizeSlug(federationKey)}:${roundKey}`,
        feature_schema_version: collapseVersion(inputs.map((input) => input.artifact.feature_schema_version)),
        label_policy_version: collapseVersion(inputs.map((input) => input.artifact.label_policy_version)),
        trained_at: trainedAt,
        average_severity: weightedAverage(inputs.map((input) => ({
            value: input.artifact.average_severity,
            weight: input.weight,
        }))) ?? 0,
        symptom_risk_weights: mergeFlatWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.symptom_risk_weights }))),
        condition_class_weights: mergeFlatWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.condition_class_weights }))),
        cluster_weights: mergeFlatWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.cluster_weights }))),
        emergency_distribution_by_class: mergeNestedWeightMaps(inputs.map((input) => ({ weight: input.weight, map: input.artifact.emergency_distribution_by_class }))),
        training_summary: {
            federation_key: federationKey,
            round_key: roundKey,
            participant_count: inputs.length,
            total_weight: inputs.reduce((sum, input) => sum + input.weight, 0),
            source_tenant_count: inputs.length,
            source_participant_refs: inputs.map((input) => createParticipantRef(federationKey, roundKey, input.tenantId)),
            source_model_versions: inputs.map((input) => input.artifact.model_version),
            aggregation_strategy: 'weighted_mean_v1',
            privacy_mode: 'secure_aggregation_v1',
        },
    };
}

function summarizeChampionEntry(entry: ModelRegistryEntryRecord) {
    return {
        task_type: entry.task_type,
        model_name: entry.model_name,
        model_version: entry.model_version,
        dataset_version: entry.training_dataset_version,
        updated_at: entry.updated_at,
    };
}

function resolveParticipantWeight(
    snapshot: FederatedSiteSnapshotRecord,
    membership: FederationMembershipRecord | null,
    diagnosisChampion: ModelRegistryEntryRecord | null,
    severityChampion: ModelRegistryEntryRecord | null,
): number {
    const diagnosisTrainingSummary = asRecord(asRecord(diagnosisChampion?.artifact_payload).training_summary);
    const severityTrainingSummary = asRecord(asRecord(severityChampion?.artifact_payload).training_summary);
    const artifactSupport = readNumber(diagnosisTrainingSummary.support)
        ?? readNumber(severityTrainingSummary.support)
        ?? snapshot.total_dataset_rows
        ?? 1;
    return Math.max((membership?.weight ?? 1) * Math.max(artifactSupport, 1), 1);
}

function createRoundKey(federationKey: string): string {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z');
    return `${sanitizeSlug(federationKey)}_${stamp}`;
}

function createParticipantRef(federationKey: string, roundKey: string, tenantId: string): string {
    const digest = createHash('sha256')
        .update(`${federationKey}:${roundKey}:${tenantId}`)
        .digest('hex')
        .slice(0, 16);
    return `participant_${digest}`;
}

function createContributionCommitment(
    federationKey: string,
    roundKey: string,
    tenantId: string,
    role: SecureAggregationContributionRole,
    payload: unknown,
): string {
    return createCommitmentHash(federationKey, roundKey, role, [
        tenantId,
        stableStringify(payload),
    ]);
}

function createMaskCommitment(
    federationKey: string,
    roundKey: string,
    tenantId: string,
    role: SecureAggregationContributionRole,
): string {
    return createCommitmentHash(federationKey, roundKey, `mask:${role}`, [
        tenantId,
        createParticipantRef(federationKey, roundKey, tenantId),
    ]);
}

function createCommitmentHash(
    federationKey: string,
    roundKey: string,
    label: string,
    values: unknown[],
): string {
    return createHash('sha256')
        .update(stableStringify({
            federation_key: federationKey,
            round_key: roundKey,
            label,
            values,
        }))
        .digest('hex');
}

function hashValue(value: unknown): string | null {
    if (value == null) return null;
    return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function bucketSiteWeight(value: number): string {
    if (!Number.isFinite(value)) return 'unknown';
    if (value < 25) return 'lt_25';
    if (value < 100) return '25_99';
    if (value < 500) return '100_499';
    return 'gte_500';
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function mergeFlatWeightMaps(
    inputs: Array<{ weight: number; map: Record<string, number> }>,
): Record<string, number> {
    const totals = new Map<string, { weighted: number; weight: number }>();
    for (const input of inputs) {
        for (const [key, value] of Object.entries(input.map)) {
            if (!Number.isFinite(value)) continue;
            const current = totals.get(key) ?? { weighted: 0, weight: 0 };
            current.weighted += value * input.weight;
            current.weight += input.weight;
            totals.set(key, current);
        }
    }

    return Object.fromEntries(
        Array.from(totals.entries()).map(([key, value]) => [key, roundMetric(value.weighted / Math.max(value.weight, 1))]),
    );
}

function mergeNestedWeightMaps(
    inputs: Array<{ weight: number; map: Record<string, Record<string, number>> }>,
): Record<string, Record<string, number>> {
    const outer = new Map<string, Map<string, { weighted: number; weight: number }>>();
    for (const input of inputs) {
        for (const [outerKey, innerMap] of Object.entries(input.map)) {
            const innerTotals = outer.get(outerKey) ?? new Map<string, { weighted: number; weight: number }>();
            for (const [innerKey, value] of Object.entries(innerMap)) {
                if (!Number.isFinite(value)) continue;
                const current = innerTotals.get(innerKey) ?? { weighted: 0, weight: 0 };
                current.weighted += value * input.weight;
                current.weight += input.weight;
                innerTotals.set(innerKey, current);
            }
            outer.set(outerKey, innerTotals);
        }
    }

    return Object.fromEntries(
        Array.from(outer.entries()).map(([outerKey, innerTotals]) => [outerKey, Object.fromEntries(
            Array.from(innerTotals.entries()).map(([innerKey, value]) => [innerKey, roundMetric(value.weighted / Math.max(value.weight, 1))]),
        )]),
    );
}

function mergeStringMaps(inputs: Array<Record<string, string | null>>): Record<string, string | null> {
    const merged = new Map<string, string | null>();
    for (const input of inputs) {
        for (const [key, value] of Object.entries(input)) {
            if (value == null) continue;
            if (!merged.has(key)) {
                merged.set(key, value);
            }
        }
    }
    return Object.fromEntries(merged.entries());
}

function weightedAverage(inputs: Array<{ value: number; weight: number }>): number | null {
    const valid = inputs.filter((input) => Number.isFinite(input.value) && Number.isFinite(input.weight) && input.weight > 0);
    if (valid.length === 0) {
        return null;
    }
    const totalWeight = valid.reduce((sum, input) => sum + input.weight, 0);
    return valid.reduce((sum, input) => sum + (input.value * input.weight), 0) / Math.max(totalWeight, 1);
}

function collapseVersion(values: string[]): string {
    const unique = uniqueStrings(values);
    return unique.length === 1 ? unique[0] : 'mixed';
}

function mapFederationMembership(row: Record<string, unknown>): FederationMembershipRecord {
    return {
        id: String(row.id),
        federation_key: readString(row.federation_key) ?? 'unknown_federation',
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        coordinator_tenant_id: readString(row.coordinator_tenant_id) ?? 'unknown_tenant',
        status: (readString(row.status) ?? 'active') as FederationMembershipStatus,
        participation_mode: (readString(row.participation_mode) ?? 'full') as FederationParticipationMode,
        weight: readNumber(row.weight) ?? 1,
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        last_snapshot_at: readString(row.last_snapshot_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapFederatedSiteSnapshot(row: Record<string, unknown>): FederatedSiteSnapshotRecord {
    return {
        id: String(row.id),
        federation_key: readString(row.federation_key) ?? 'unknown_federation',
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        coordinator_tenant_id: readString(row.coordinator_tenant_id) ?? 'unknown_tenant',
        snapshot_window_start: readString(row.snapshot_window_start),
        snapshot_window_end: String(row.snapshot_window_end ?? row.created_at),
        dataset_version: readString(row.dataset_version),
        dataset_versions: readNumber(row.dataset_versions) ?? 0,
        total_dataset_rows: readNumber(row.total_dataset_rows) ?? 0,
        benchmark_reports: readNumber(row.benchmark_reports) ?? 0,
        calibration_reports: readNumber(row.calibration_reports) ?? 0,
        audit_events: readNumber(row.audit_events) ?? 0,
        champion_models: readNumber(row.champion_models) ?? 0,
        support_summary: asRecord(row.support_summary),
        quality_summary: asRecord(row.quality_summary),
        snapshot_payload: asRecord(row.snapshot_payload),
        created_at: String(row.created_at),
    };
}

function mapFederationRound(row: Record<string, unknown>): FederationRoundRecord {
    return {
        id: String(row.id),
        federation_key: readString(row.federation_key) ?? 'unknown_federation',
        coordinator_tenant_id: readString(row.coordinator_tenant_id) ?? 'unknown_tenant',
        round_key: readString(row.round_key) ?? 'unknown_round',
        status: (readString(row.status) ?? 'collecting') as FederationRoundStatus,
        aggregation_strategy: readString(row.aggregation_strategy) ?? 'weighted_mean_v1',
        snapshot_cutoff_at: readString(row.snapshot_cutoff_at),
        participant_count: readNumber(row.participant_count) ?? 0,
        aggregate_payload: asRecord(row.aggregate_payload),
        candidate_artifact_payload: asRecord(row.candidate_artifact_payload),
        notes: readString(row.notes),
        started_at: String(row.started_at ?? row.created_at),
        completed_at: readString(row.completed_at),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapModelDeltaArtifact(row: Record<string, unknown>): ModelDeltaArtifactRecord {
    return {
        id: String(row.id),
        federation_round_id: readString(row.federation_round_id) ?? 'unknown_round',
        federation_key: readString(row.federation_key) ?? 'unknown_federation',
        coordinator_tenant_id: readString(row.coordinator_tenant_id) ?? 'unknown_tenant',
        tenant_id: readString(row.tenant_id),
        artifact_role: (readString(row.artifact_role) ?? 'site_delta') as FederationArtifactRole,
        task_type: readString(row.task_type) ?? 'diagnosis',
        model_version: readString(row.model_version),
        dataset_version: readString(row.dataset_version),
        artifact_payload: asRecord(row.artifact_payload),
        summary: asRecord(row.summary),
        created_at: String(row.created_at),
    };
}

function mapSecureAggregationContribution(row: Record<string, unknown>): SecureAggregationContributionRecord {
    return {
        id: String(row.id),
        federation_round_id: readString(row.federation_round_id) ?? 'unknown_round',
        federation_key: readString(row.federation_key) ?? 'unknown_federation',
        coordinator_tenant_id: readString(row.coordinator_tenant_id) ?? 'unknown_tenant',
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        participant_ref: readString(row.participant_ref) ?? 'participant_unknown',
        contribution_role: (readString(row.contribution_role) ?? 'support') as SecureAggregationContributionRole,
        masking_protocol: readString(row.masking_protocol) ?? 'pairwise_masked_commitment_v1',
        payload_commitment_hash: readString(row.payload_commitment_hash) ?? '',
        mask_commitment_hash: readString(row.mask_commitment_hash) ?? '',
        masked_payload_summary: asRecord(row.masked_payload_summary),
        public_summary: asRecord(row.public_summary),
        accepted_at: String(row.accepted_at ?? row.created_at),
        created_at: String(row.created_at),
    };
}

function mapFederatedOutcomeEligibilitySnapshot(row: Record<string, unknown>): FederatedOutcomeEligibilitySnapshotRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        request_id: readString(row.request_id) ?? 'unknown_request',
        federation_key: readString(row.federation_key) ?? 'unknown_federation',
        partner_ref: readString(row.partner_ref),
        membership_id: readString(row.membership_id),
        evidence_window_start: readString(row.evidence_window_start),
        evidence_window_end: String(row.evidence_window_end ?? row.observed_at ?? row.created_at),
        outcome_confirmed_rows: readNumber(row.outcome_confirmed_rows) ?? 0,
        lab_confirmed_rows: readNumber(row.lab_confirmed_rows) ?? 0,
        expert_reviewed_rows: readNumber(row.expert_reviewed_rows) ?? 0,
        synthetic_rows_excluded: readNumber(row.synthetic_rows_excluded) ?? 0,
        consented_network_learning_rows: readNumber(row.consented_network_learning_rows) ?? 0,
        provenance_verified_rows: readNumber(row.provenance_verified_rows) ?? 0,
        trust_scored_rows: readNumber(row.trust_scored_rows) ?? 0,
        amr_outcome_linked_rows: readNumber(row.amr_outcome_linked_rows) ?? 0,
        external_validation_events: readNumber(row.external_validation_events) ?? 0,
        minimum_required_rows: readNumber(row.minimum_required_rows) ?? 20,
        minimum_provenance_rows: readNumber(row.minimum_provenance_rows) ?? 20,
        minimum_trust_scored_rows: readNumber(row.minimum_trust_scored_rows) ?? 20,
        minimum_external_validations: readNumber(row.minimum_external_validations) ?? 0,
        minimum_trust_score: readNumber(row.minimum_trust_score) ?? 0.7,
        average_trust_score: readNumber(row.average_trust_score) ?? 0,
        eligibility_status: normalizeFederatedOutcomeEligibilityStatus(row.eligibility_status),
        blockers: readStringArray(row.blockers),
        source_hash_bundle: asRecord(row.source_hash_bundle),
        source_table_counts: asRecord(row.source_table_counts),
        source_record_digest: readString(row.source_record_digest),
        evidence: asRecord(row.evidence),
        observed_at: String(row.observed_at ?? row.created_at),
        created_at: String(row.created_at ?? row.observed_at),
    };
}

function toOutcomeEligibilitySummary(
    digest: FederatedOutcomeEligibilityDigest,
): Record<string, unknown> {
    return {
        present: digest.present,
        eligibility_status: digest.eligibility_status,
        eligibility_score: digest.eligibility_score,
        blockers: digest.blockers,
        counts: digest.counts,
        minimums: digest.minimums,
        latest_signal_at: digest.latest_signal_at,
    };
}

function readOutcomeEligibilitySummary(
    snapshot: FederatedSiteSnapshotRecord,
): FederatedOutcomeEligibilityInput | null {
    const support = asRecord(snapshot.support_summary.federated_outcome_eligibility);
    const payload = asRecord(snapshot.snapshot_payload.federated_outcome_eligibility);
    const source = Object.keys(support).length > 0 ? support : payload;
    if (Object.keys(source).length === 0) {
        return null;
    }
    const counts = asRecord(source.counts);
    const minimums = asRecord(source.minimums);

    return {
        outcome_confirmed_rows: readNumber(counts.outcome_confirmed_rows) ?? undefined,
        lab_confirmed_rows: readNumber(counts.lab_confirmed_rows) ?? undefined,
        expert_reviewed_rows: readNumber(counts.expert_reviewed_rows) ?? undefined,
        synthetic_rows_excluded: readNumber(counts.synthetic_rows_excluded) ?? undefined,
        consented_network_learning_rows: readNumber(counts.consented_network_learning_rows) ?? undefined,
        provenance_verified_rows: readNumber(counts.provenance_verified_rows) ?? undefined,
        trust_scored_rows: readNumber(counts.trust_scored_rows) ?? undefined,
        amr_outcome_linked_rows: readNumber(counts.amr_outcome_linked_rows) ?? undefined,
        external_validation_events: readNumber(counts.external_validation_events) ?? undefined,
        average_trust_score: readNumber(counts.average_trust_score) ?? undefined,
        minimum_required_rows: readNumber(minimums.minimum_required_rows) ?? undefined,
        minimum_provenance_rows: readNumber(minimums.minimum_provenance_rows) ?? undefined,
        minimum_trust_scored_rows: readNumber(minimums.minimum_trust_scored_rows) ?? undefined,
        minimum_external_validations: readNumber(minimums.minimum_external_validations) ?? undefined,
        minimum_trust_score: readNumber(minimums.minimum_trust_score) ?? undefined,
        eligibility_status: readString(source.eligibility_status),
        blockers: readStringArray(source.blockers),
        observed_at: readString(source.latest_signal_at),
    };
}

function averageNumbers(values: Array<number | null>): number | null {
    const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
    if (valid.length === 0) {
        return null;
    }
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function readArtifactVersion(value: unknown): string | null {
    return readString(asRecord(value).model_version);
}

function minimumTimestamp(values: string[]): string | null {
    if (values.length === 0) {
        return null;
    }
    const parsed = values
        .map((value) => new Date(value))
        .filter((value) => !Number.isNaN(value.getTime()))
        .sort((left, right) => left.getTime() - right.getTime());
    return parsed[0]?.toISOString() ?? null;
}

function maximumTimestamp(values: string[]): string | null {
    if (values.length === 0) {
        return null;
    }
    const parsed = values
        .map((value) => new Date(value))
        .filter((value) => !Number.isNaN(value.getTime()))
        .sort((left, right) => right.getTime() - left.getTime());
    return parsed[0]?.toISOString() ?? null;
}

function isStaleTimestamp(value: string, maxAgeHours: number): boolean {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return true;
    }
    return Date.now() - parsed.getTime() > maxAgeHours * 60 * 60 * 1000;
}

function compactStrings(values: Array<string | null>): string[] {
    return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(compactStrings(values)));
}

function sanitizeSlug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'federation';
}

function roundMetric(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

function mergeRecords(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
        if (value === undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            merged[key] = value.slice();
            continue;
        }
        if (isPlainRecord(value) && isPlainRecord(merged[key])) {
            merged[key] = mergeRecords(merged[key] as Record<string, unknown>, value);
            continue;
        }
        merged[key] = value;
    }
    return merged;
}

function asRecord(value: unknown): Record<string, unknown> {
    return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => readString(entry))
        .filter((entry): entry is string => entry != null);
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
