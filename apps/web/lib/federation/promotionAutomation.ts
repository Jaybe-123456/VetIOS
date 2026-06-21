import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildFederatedAggregateArtifacts,
    FederatedAggregateBuilderError,
    type BuildFederatedAggregateArtifactsResult,
    type FederatedAggregateTaskType,
} from '@/lib/federation/aggregateBuilder';
import {
    registerFederatedRoundCandidateModels,
    type FederatedCandidateRegistrationResult,
    type FederatedModelPromotionAssessment,
    type FederatedPromotionPolicy,
} from '@/lib/federation/modelPromotion';
import {
    evaluateModelPromotionGate,
    listCandidateRegressionRuns,
    type PromotionGateResult,
} from '@/lib/learningEngine/promotionGate';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import type { ModelRegistryEntryRecord } from '@/lib/learningEngine/types';

export type FederatedPromotionAutomationStatus =
    | 'candidate_registration_blocked'
    | 'promotion_gate_blocked'
    | 'manual_champion_approval_required';

export interface FederatedPromotionAutomationDecision {
    task_type: string;
    candidate_model_version: string | null;
    candidate_dataset_version: string | null;
    candidate_registration_status: 'blocked' | 'registered_or_existing' | 'missing_registry_entry';
    champion_promotion_status: FederatedPromotionAutomationStatus;
    automatic_champion_promotion_allowed: false;
    manual_promotion_route: '/api/learning/promote';
    registry_entry_ids: string[];
    blockers: string[];
    warnings: string[];
    next_required_actions: string[];
    promotion_gate: PromotionGateResult | null;
}

export interface FederatedPromotionAutomationResult {
    aggregate_artifacts: BuildFederatedAggregateArtifactsResult | null;
    aggregate_build_blockers: string[];
    registration: FederatedCandidateRegistrationResult;
    decisions: FederatedPromotionAutomationDecision[];
    automation_status: 'blocked' | 'manual_review_ready';
    automatic_champion_promotion_allowed: false;
    next_required_actions: string[];
}

export class FederatedPromotionAutomationError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'FederatedPromotionAutomationError';
    }
}

export function buildFederatedPromotionAutomationDecision(input: {
    assessment: FederatedModelPromotionAssessment;
    targetEntries: ModelRegistryEntryRecord[];
    promotionGate: PromotionGateResult | null;
    aggregateBuildBlockers?: string[];
}): FederatedPromotionAutomationDecision {
    const blockers = new Set<string>([
        ...(input.aggregateBuildBlockers ?? []),
        ...input.assessment.blockers,
        ...(input.promotionGate?.blockers ?? []),
    ]);
    const warnings = new Set<string>([
        ...input.assessment.warnings,
        ...(input.promotionGate?.warnings ?? []),
    ]);
    const nextActions = new Set<string>();
    let candidateRegistrationStatus: FederatedPromotionAutomationDecision['candidate_registration_status'] = 'registered_or_existing';
    let championPromotionStatus: FederatedPromotionAutomationStatus = 'manual_champion_approval_required';

    if (!input.assessment.allowed) {
        candidateRegistrationStatus = 'blocked';
        championPromotionStatus = 'candidate_registration_blocked';
        nextActions.add('resolve_federated_candidate_registration_blockers');
    } else if (input.targetEntries.length === 0) {
        candidateRegistrationStatus = 'missing_registry_entry';
        championPromotionStatus = 'candidate_registration_blocked';
        blockers.add('candidate_registry_entry_missing_after_registration');
        nextActions.add('rerun_federated_candidate_registration');
    } else if (!input.promotionGate?.allowed) {
        championPromotionStatus = 'promotion_gate_blocked';
        nextActions.add('run_benchmark_calibration_adversarial_and_regression_evidence');
    } else {
        nextActions.add('manual_operator_review_before_learning_promote');
        nextActions.add('call_/api/learning/promote_only_after_manual_approval');
    }

    nextActions.add('never_auto_promote_federated_candidate_to_champion');

    return {
        task_type: input.assessment.task_type,
        candidate_model_version: input.assessment.candidate_model_version,
        candidate_dataset_version: input.assessment.candidate_dataset_version,
        candidate_registration_status: candidateRegistrationStatus,
        champion_promotion_status: championPromotionStatus,
        automatic_champion_promotion_allowed: false,
        manual_promotion_route: '/api/learning/promote',
        registry_entry_ids: input.targetEntries.map((entry) => entry.id),
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        next_required_actions: Array.from(nextActions).sort(),
        promotion_gate: input.promotionGate,
    };
}

export async function runFederatedPromotionAutomation(
    client: SupabaseClient,
    input: {
        federationRoundId: string;
        actorTenantId: string | null;
        actor: string | null;
        buildAggregateArtifacts?: boolean;
        aggregateTaskTypes?: FederatedAggregateTaskType[];
        minimumAcceptedUpdates?: number | null;
        markRoundCompleted?: boolean;
        aggregateEvidence?: Record<string, unknown>;
        policy?: Partial<FederatedPromotionPolicy>;
    },
): Promise<FederatedPromotionAutomationResult> {
    const aggregateBuildBlockers: string[] = [];
    let aggregateResult: BuildFederatedAggregateArtifactsResult | null = null;

    if (input.buildAggregateArtifacts !== false) {
        try {
            aggregateResult = await buildFederatedAggregateArtifacts(client, {
                federationRoundId: input.federationRoundId,
                actorTenantId: input.actorTenantId,
                actor: input.actor,
                taskTypes: input.aggregateTaskTypes,
                minimumAcceptedUpdates: input.minimumAcceptedUpdates,
                markCompleted: input.markRoundCompleted,
                evidence: {
                    automation_stage: 'federated_candidate_promotion',
                    ...(input.aggregateEvidence ?? {}),
                },
            });
        } catch (error) {
            if (!(error instanceof FederatedAggregateBuilderError) || error.status !== 409) {
                throw error;
            }
            aggregateBuildBlockers.push(error.message);
        }
    }

    const registration = await registerFederatedRoundCandidateModels(client, {
        federationRoundId: input.federationRoundId,
        actor: input.actor,
        policy: input.policy,
    });
    const store = createSupabaseLearningEngineStore(client);
    const tenantId = registration.round.coordinator_tenant_id;
    const [registryEntries, benchmarkReports, calibrationReports] = await Promise.all([
        store.listModelRegistryEntries(tenantId),
        store.listBenchmarkReports(tenantId, 250),
        store.listCalibrationReports(tenantId, 250),
    ]);
    const decisions: FederatedPromotionAutomationDecision[] = [];

    for (const assessment of registration.assessments) {
        const candidateModelVersion = assessment.candidate_model_version;
        const targetEntries = candidateModelVersion
            ? registryEntries.filter((entry) => entry.model_version === candidateModelVersion)
            : [];
        const regressionRuns = candidateModelVersion
            ? await listCandidateRegressionRuns(client, tenantId, candidateModelVersion)
            : [];
        const promotionGate = candidateModelVersion
            ? evaluateModelPromotionGate({
                candidateModelVersion,
                targetEntries,
                benchmarkReports,
                calibrationReports,
                regressionRuns,
            })
            : null;

        decisions.push(buildFederatedPromotionAutomationDecision({
            assessment,
            targetEntries,
            promotionGate,
            aggregateBuildBlockers,
        }));
    }

    const allBlockers = decisions.flatMap((decision) => decision.blockers);
    const nextRequiredActions = uniqueStrings(decisions.flatMap((decision) => decision.next_required_actions));

    return {
        aggregate_artifacts: aggregateResult,
        aggregate_build_blockers: aggregateBuildBlockers,
        registration,
        decisions,
        automation_status: allBlockers.length === 0 ? 'manual_review_ready' : 'blocked',
        automatic_champion_promotion_allowed: false,
        next_required_actions: nextRequiredActions,
    };
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.length > 0))).sort();
}
