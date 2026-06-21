import { describe, expect, it } from 'vitest';
import { buildFederatedChampionSurveillanceDecision } from '@/lib/federation/championSurveillance';
import type { LearningEvaluationEvent, ModelRegistryEntryRecord } from '@/lib/learningEngine/types';

describe('federated champion surveillance', () => {
    it('marks a federated champion healthy when enough outcome-linked evidence stays inside thresholds', () => {
        const decision = buildFederatedChampionSurveillanceDecision({
            champion: champion(),
            evaluationEvents: Array.from({ length: 12 }, (_, index) => evaluationEvent({
                id: `eval-${index}`,
                prediction_correct: true,
                calibration_error: 0.04,
                drift_score: 0.08,
                simulation_degradation: 0.03,
            })),
        });

        expect(decision.surveillance_status).toBe('healthy');
        expect(decision.rollback_recommended).toBe(false);
        expect(decision.metrics.outcome_linked_events).toBe(12);
        expect(decision.next_required_actions).toContain('continue_outcome_linked_surveillance');
    });

    it('does not roll back from weak evidence alone, but requires more outcome-linked surveillance', () => {
        const decision = buildFederatedChampionSurveillanceDecision({
            champion: champion(),
            evaluationEvents: [evaluationEvent({ prediction_correct: true })],
        });

        expect(decision.surveillance_status).toBe('insufficient_evidence');
        expect(decision.rollback_recommended).toBe(false);
        expect(decision.warnings).toContain('outcome_linked_surveillance_events_below_minimum');
        expect(decision.next_required_actions).toContain('collect_more_outcome_linked_evaluation_events');
    });

    it('requires rollback review when dangerous false negatives exceed threshold', () => {
        const events = Array.from({ length: 12 }, (_, index) => evaluationEvent({
            id: `eval-${index}`,
            prediction_correct: index !== 0,
            severity_true: index === 0 ? 'critical' : 'stable',
            severity_pred: index === 0 ? 'routine' : 'stable',
            calibration_error: 0.05,
            drift_score: 0.1,
            simulation_degradation: 0.04,
        }));

        const decision = buildFederatedChampionSurveillanceDecision({
            champion: champion(),
            evaluationEvents: events,
        });

        expect(decision.surveillance_status).toBe('rollback_required');
        expect(decision.rollback_recommended).toBe(true);
        expect(decision.blockers).toContain('dangerous_false_negative_rate_above_threshold');
        expect(decision.next_required_actions).toContain('freeze_federated_champion_expansion_until_reviewed');
    });
});

function champion(overrides: Partial<ModelRegistryEntryRecord> = {}): ModelRegistryEntryRecord {
    return {
        id: 'registry-1',
        tenant_id: 'coordinator-tenant',
        model_name: 'VetIOS Federated diagnosis Champion',
        model_version: 'fed-one-health-diagnosis',
        task_type: 'diagnosis',
        training_dataset_version: 'federated:one-health:abc123',
        feature_schema_version: 'federated_feature_schema_v1',
        label_policy_version: 'outcome_confirmed_federated_v1',
        artifact_payload: {
            federation_round_id: '11111111-1111-4111-8111-111111111111',
            federation_key: 'one_health_amr',
        },
        benchmark_scorecard: {},
        calibration_report_id: 'calibration-1',
        promotion_status: 'champion',
        is_champion: true,
        latency_profile: null,
        resource_profile: null,
        parent_model_version: null,
        created_at: '2026-06-21T16:00:00.000Z',
        updated_at: '2026-06-21T16:00:00.000Z',
        ...overrides,
    };
}

function evaluationEvent(overrides: Partial<LearningEvaluationEvent> = {}): LearningEvaluationEvent {
    return {
        id: 'eval-1',
        evaluation_event_id: null,
        tenant_id: 'coordinator-tenant',
        trigger_type: 'outcome_followup',
        inference_event_id: 'inference-1',
        outcome_event_id: 'outcome-1',
        case_id: 'case-1',
        model_name: 'VetIOS Federated diagnosis Champion',
        model_version: 'fed-one-health-diagnosis',
        prediction: 'stable_case',
        prediction_confidence: 0.82,
        ground_truth: 'stable_case',
        prediction_correct: true,
        condition_class_pred: 'stable',
        condition_class_true: 'stable',
        severity_pred: 'stable',
        severity_true: 'stable',
        contradiction_score: 0,
        adversarial_case: false,
        calibration_error: 0.04,
        drift_score: 0.08,
        outcome_alignment_delta: 0.02,
        simulation_degradation: 0.03,
        calibrated_confidence: 0.8,
        epistemic_uncertainty: 0.1,
        aleatoric_uncertainty: 0.1,
        evaluation_payload: {},
        created_at: '2026-06-21T20:00:00.000Z',
        ...overrides,
    };
}
