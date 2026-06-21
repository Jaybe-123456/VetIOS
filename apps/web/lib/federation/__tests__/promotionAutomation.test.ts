import { describe, expect, it } from 'vitest';
import { buildFederatedPromotionAutomationDecision } from '@/lib/federation/promotionAutomation';
import type { FederatedModelPromotionAssessment } from '@/lib/federation/modelPromotion';
import type { PromotionGateResult } from '@/lib/learningEngine/promotionGate';
import type { ModelRegistryEntryRecord } from '@/lib/learningEngine/types';

describe('federated promotion automation', () => {
    it('requires manual champion approval even when promotion gates pass', () => {
        const decision = buildFederatedPromotionAutomationDecision({
            assessment: assessment(),
            targetEntries: [registryEntry()],
            promotionGate: promotionGate({ allowed: true }),
        });

        expect(decision.champion_promotion_status).toBe('manual_champion_approval_required');
        expect(decision.automatic_champion_promotion_allowed).toBe(false);
        expect(decision.manual_promotion_route).toBe('/api/learning/promote');
        expect(decision.next_required_actions).toContain('call_/api/learning/promote_only_after_manual_approval');
        expect(decision.next_required_actions).toContain('never_auto_promote_federated_candidate_to_champion');
        expect(decision.blockers).toEqual([]);
    });

    it('blocks champion promotion when benchmark and regression evidence is missing', () => {
        const decision = buildFederatedPromotionAutomationDecision({
            assessment: assessment(),
            targetEntries: [registryEntry()],
            promotionGate: promotionGate({
                allowed: false,
                blockers: [
                    'No safety benchmark report was found for this candidate.',
                    'No completed regression simulation was found for this candidate.',
                ],
            }),
        });

        expect(decision.champion_promotion_status).toBe('promotion_gate_blocked');
        expect(decision.automatic_champion_promotion_allowed).toBe(false);
        expect(decision.blockers).toEqual(expect.arrayContaining([
            'No safety benchmark report was found for this candidate.',
            'No completed regression simulation was found for this candidate.',
        ]));
        expect(decision.next_required_actions).toContain('run_benchmark_calibration_adversarial_and_regression_evidence');
    });

    it('keeps candidate registration blocked when federated evidence fails first', () => {
        const decision = buildFederatedPromotionAutomationDecision({
            assessment: assessment({
                allowed: false,
                promotion_status: 'blocked',
                blockers: ['accepted_live_node_updates_below_threshold'],
            }),
            targetEntries: [],
            promotionGate: null,
            aggregateBuildBlockers: ['No aggregate candidate artifacts are ready.'],
        });

        expect(decision.candidate_registration_status).toBe('blocked');
        expect(decision.champion_promotion_status).toBe('candidate_registration_blocked');
        expect(decision.blockers).toEqual(expect.arrayContaining([
            'accepted_live_node_updates_below_threshold',
            'No aggregate candidate artifacts are ready.',
        ]));
        expect(decision.next_required_actions).toContain('resolve_federated_candidate_registration_blockers');
    });
});

function assessment(overrides: Partial<FederatedModelPromotionAssessment> = {}): FederatedModelPromotionAssessment {
    return {
        allowed: true,
        promotion_status: 'promotion_gate_required',
        task_type: 'diagnosis',
        candidate_model_version: 'fed-one-health-diagnosis',
        candidate_dataset_version: 'federated:one-health:abc123',
        blockers: [],
        warnings: [],
        metrics: {
            participant_count: 2,
            accepted_update_submissions: 2,
            eligible_outcome_snapshots: 2,
            outcome_confirmed_rows: 28,
            provenance_verified_rows: 28,
            trust_scored_rows: 28,
            average_trust_score: 0.82,
            secure_aggregation_status: 'secure_aggregation_ready',
        },
        hashes: {
            source_artifact_hash: 'a'.repeat(64),
            aggregate_payload_hash: 'b'.repeat(64),
        },
        evidence: {},
        ...overrides,
    };
}

function promotionGate(overrides: Partial<PromotionGateResult> = {}): PromotionGateResult {
    return {
        allowed: true,
        blockers: [],
        warnings: [],
        evidence: {
            benchmark_report_ids: ['bench-1', 'bench-2'],
            calibration_report_ids: ['calibration-1'],
            regression_run_id: 'regression-1',
            regression_status: 'complete',
            regression_results: { fixture_count: 6, failed: 0 },
        },
        ...overrides,
    };
}

function registryEntry(overrides: Partial<ModelRegistryEntryRecord> = {}): ModelRegistryEntryRecord {
    return {
        id: 'registry-1',
        tenant_id: 'coordinator-tenant',
        model_name: 'VetIOS Federated diagnosis Candidate',
        model_version: 'fed-one-health-diagnosis',
        task_type: 'diagnosis',
        training_dataset_version: 'federated:one-health:abc123',
        feature_schema_version: 'federated_feature_schema_v1',
        label_policy_version: 'outcome_confirmed_federated_v1',
        artifact_payload: {},
        benchmark_scorecard: {},
        calibration_report_id: 'calibration-1',
        promotion_status: 'candidate',
        is_champion: false,
        latency_profile: null,
        resource_profile: null,
        parent_model_version: null,
        created_at: '2026-06-21T16:00:00.000Z',
        updated_at: '2026-06-21T16:00:00.000Z',
        ...overrides,
    };
}
