import { describe, expect, it } from 'vitest';
import {
    buildMoatCompletionAssessment,
    buildMoatCompletionSnapshot,
    type MoatCompletionEvidence,
} from '@/lib/platform/moatCompletion';

describe('moat completion scoring', () => {
    it('keeps a technical foundation at architecture-only until live evidence exists', () => {
        const digest = buildMoatCompletionAssessment({
            moat_key: 'test_moat',
            moat_name: 'Test Moat',
            value_capture_layer: 'data_provenance',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'hard_to_replicate',
            scarcity_basis: ['outcome_followup_required'],
            counts: emptyCounts(),
            defensible_minimums: {
                live_event_count: 10,
                outcome_confirmed_count: 5,
                provenance_verified_count: 5,
                trust_scored_count: 5,
            },
        });

        expect(digest.completion_level).toBe('foundation');
        expect(digest.claim_posture).toBe('architecture_only');
        expect(digest.missing_evidence).toContain('live_usage_events');
        expect(digest.missing_evidence).toContain('outcome_confirmed_records');
    });

    it('allows measured activity before the moat reaches defensible volume', () => {
        const digest = buildMoatCompletionAssessment({
            moat_key: 'operating_moat',
            moat_name: 'Operating Moat',
            value_capture_layer: 'trust_scoring',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'hard_to_replicate',
            scarcity_basis: ['trust_scored_outcomes'],
            counts: {
                live_event_count: 12,
                outcome_confirmed_count: 2,
                provenance_verified_count: 2,
                trust_scored_count: 2,
                external_validation_count: 0,
                last_signal_at: '2026-06-19T12:00:00.000Z',
            },
            defensible_minimums: {
                live_event_count: 50,
                outcome_confirmed_count: 20,
                provenance_verified_count: 20,
                trust_scored_count: 20,
            },
        });

        expect(digest.completion_level).toBe('operating');
        expect(digest.claim_posture).toBe('measured_activity');
        expect(digest.missing_evidence).toContain('defensible_outcome_volume_20');
    });

    it('requires outcome, provenance, and trust-score thresholds for defensible status', () => {
        const digest = buildMoatCompletionAssessment({
            moat_key: 'defensible_moat',
            moat_name: 'Defensible Moat',
            value_capture_layer: 'data_provenance',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'not_replicable_short_term',
            scarcity_basis: ['confirmed_outcomes', 'verified_provenance'],
            counts: {
                live_event_count: 100,
                outcome_confirmed_count: 50,
                provenance_verified_count: 50,
                trust_scored_count: 30,
                external_validation_count: 0,
                last_signal_at: '2026-06-19T12:00:00.000Z',
            },
            defensible_minimums: {
                live_event_count: 100,
                outcome_confirmed_count: 50,
                provenance_verified_count: 50,
                trust_scored_count: 30,
            },
        });

        expect(digest.completion_level).toBe('defensible');
        expect(digest.claim_posture).toBe('evidence_grade_claims');
        expect(digest.missing_evidence).toEqual([]);
    });

    it('builds a portfolio snapshot that separates defensible data moats from copyable controls', () => {
        const snapshot = buildMoatCompletionSnapshot(evidence({
            dataset: {
                clinical_cases: 125,
                confirmed_labels: 75,
                learning_ready_cases: 60,
                calibration_ready_cases: 35,
            },
            inference: {
                inference_events: 150,
                outcome_linked_inferences: 45,
                cire_sample_size: 35,
                cire_status: 'validated',
            },
            ask_vetios: {
                query_events: 20,
                security_review_required: 3,
                security_test_events: 3,
                regulatory_reviewable: 4,
                regulatory_review_events: 4,
            },
        }));

        const outcomeLayer = snapshot.moats.find((moat) => moat.moat_key === 'outcome_provenance_layer');
        const securityLayer = snapshot.moats.find((moat) => moat.moat_key === 'ai_security_layer');

        expect(outcomeLayer?.completion_level).toBe('defensible');
        expect(outcomeLayer?.two_quarter_replicability).toBe('not_replicable_short_term');
        expect(securityLayer?.completion_level).toBe('foundation');
        expect(securityLayer?.claim_posture).toBe('architecture_only');
        expect(snapshot.summary.defensible).toBeGreaterThanOrEqual(1);
    });

    it('counts operating ledgers for workflow, AMR, specialist, security, and regulatory maturity', () => {
        const snapshot = buildMoatCompletionSnapshot(evidence({
            workflow: {
                passive_signal_events: 2,
                integration_run_events: 8,
                ready_integration_runs: 6,
            },
            specialist_review: {
                review_events: 3,
                operation_events: 5,
                assigned_operations: 4,
                outcome_closed_operations: 2,
                completed_reviews: 2,
                corrected_or_partial_reviews: 1,
            },
            amr: {
                stewardship_events: 3,
                lab_feed_events: 7,
                normalized_lab_feed_events: 6,
                one_health_export_ready_events: 2,
                culture_guided_events: 2,
                outcome_tracked_events: 1,
            },
            ask_vetios: {
                query_events: 12,
                workflow_ready: 4,
                human_review_required: 2,
                security_review_required: 1,
                security_test_events: 6,
                regulatory_reviewable: 3,
                regulatory_review_events: 4,
                regulatory_blocked_reviews: 1,
                grounded_drafts: 3,
            },
        }));

        const workflow = snapshot.moats.find((moat) => moat.moat_key === 'workflow_integration');
        const specialist = snapshot.moats.find((moat) => moat.moat_key === 'specialist_review_loop');
        const amr = snapshot.moats.find((moat) => moat.moat_key === 'amr_stewardship');
        const security = snapshot.moats.find((moat) => moat.moat_key === 'ai_security_layer');
        const regulatory = snapshot.moats.find((moat) => moat.moat_key === 'regulatory_claims_discipline');

        expect(workflow?.live_event_count).toBe(10);
        expect(workflow?.provenance_verified_count).toBe(12);
        expect(workflow?.evidence.source_tables).toContain('workflow_integration_run_events');
        expect(specialist?.live_event_count).toBe(10);
        expect(specialist?.outcome_confirmed_count).toBe(2);
        expect(amr?.live_event_count).toBe(10);
        expect(amr?.provenance_verified_count).toBe(8);
        expect(amr?.trust_scored_count).toBe(2);
        expect(security?.live_event_count).toBe(18);
        expect(security?.provenance_verified_count).toBe(7);
        expect(regulatory?.live_event_count).toBe(16);
        expect(regulatory?.provenance_verified_count).toBe(7);
    });

    it('scores federated learning from outcome eligibility, masked updates, promotion, and surveillance evidence', () => {
        const snapshot = buildMoatCompletionSnapshot(evidence({
            federation: {
                activation_events: 4,
                active_nodes: 3,
                attested_nodes: 3,
                secure_ready_nodes: 3,
                heartbeat_healthy_nodes: 3,
                outcome_eligibility_snapshots: 3,
                eligible_outcome_snapshots: 3,
                outcome_confirmed_rows: 42,
                provenance_verified_rows: 45,
                trust_scored_rows: 46,
                external_validation_events: 1,
                runtime_events: 12,
                task_events: 9,
                submitted_tasks: 6,
                update_submissions: 6,
                accepted_update_submissions: 6,
                signed_update_submissions: 6,
                promotion_events: 2,
                candidate_registered_events: 2,
                promotion_gate_required_events: 0,
                champion_surveillance_events: 1,
                last_signal_at: '2026-06-21T12:00:00.000Z',
            },
        }));

        const federation = snapshot.moats.find((moat) => moat.moat_key === 'federation_activation');

        expect(federation?.moat_name).toBe('Outcome-Confirmed Federated Learning');
        expect(federation?.completion_level).toBe('operating');
        expect(federation?.claim_posture).toBe('measured_activity');
        expect(federation?.live_event_count).toBe(37);
        expect(federation?.outcome_confirmed_count).toBe(42);
        expect(federation?.provenance_verified_count).toBe(56);
        expect(federation?.trust_scored_count).toBe(59);
        expect(federation?.external_validation_count).toBe(1);
        expect(federation?.missing_evidence).toContain('defensible_outcome_volume_50');
        expect(federation?.evidence.source_tables).toContain('federated_update_submissions');
        expect(federation?.evidence.source_tables).toContain('learning_audit_events');
    });
});

function emptyCounts() {
    return {
        live_event_count: 0,
        outcome_confirmed_count: 0,
        provenance_verified_count: 0,
        trust_scored_count: 0,
        external_validation_count: 0,
        last_signal_at: null,
    };
}

function evidence(overrides: {
    dataset?: Partial<MoatCompletionEvidence['dataset']>;
    inference?: Partial<MoatCompletionEvidence['inference']>;
    workflow?: Partial<MoatCompletionEvidence['workflow']>;
    ask_vetios?: Partial<MoatCompletionEvidence['ask_vetios']>;
    case_graph_promotion?: Partial<MoatCompletionEvidence['case_graph_promotion']>;
    amr?: Partial<MoatCompletionEvidence['amr']>;
    specialist_review?: Partial<MoatCompletionEvidence['specialist_review']>;
    federation?: Partial<MoatCompletionEvidence['federation']>;
    trust_ops?: Partial<MoatCompletionEvidence['trust_ops']>;
} = {}): MoatCompletionEvidence {
    return {
        generated_at: '2026-06-19T12:00:00.000Z',
        tenant_id: '11111111-1111-4111-8111-111111111111',
        warnings: [],
        dataset: {
            clinical_cases: 0,
            real_case_imports: 0,
            confirmed_labels: 0,
            learning_ready_cases: 0,
            calibration_ready_cases: 0,
            last_signal_at: '2026-06-19T12:00:00.000Z',
            ...overrides.dataset,
        },
        inference: {
            inference_events: 0,
            outcome_linked_inferences: 0,
            cire_sample_size: 0,
            cire_status: 'unavailable',
            last_signal_at: '2026-06-19T12:00:00.000Z',
            ...overrides.inference,
        },
        workflow: {
            passive_signal_events: 0,
            integration_run_events: 0,
            ready_integration_runs: 0,
            last_signal_at: null,
            ...overrides.workflow,
        },
        ask_vetios: {
            query_events: 0,
            case_graph_ready: 0,
            grounded_drafts: 0,
            retrieval_grounded: 0,
            workflow_ready: 0,
            human_review_required: 0,
            security_review_required: 0,
            security_test_events: 0,
            security_incident_events: 0,
            regulatory_reviewable: 0,
            regulatory_review_events: 0,
            regulatory_blocked_reviews: 0,
            last_signal_at: null,
            ...overrides.ask_vetios,
        },
        case_graph_promotion: {
            promotion_events: 0,
            promoted_to_case: 0,
            linked_to_outcome: 0,
            defensible_candidates: 0,
            last_signal_at: null,
            ...overrides.case_graph_promotion,
        },
        amr: {
            genomic_events: 0,
            stewardship_events: 0,
            culture_guided_events: 0,
            outcome_tracked_events: 0,
            resistance_suspected_events: 0,
            lab_feed_events: 0,
            normalized_lab_feed_events: 0,
            one_health_export_ready_events: 0,
            last_signal_at: null,
            ...overrides.amr,
        },
        specialist_review: {
            review_events: 0,
            completed_reviews: 0,
            corrected_or_partial_reviews: 0,
            learning_eligible_reviews: 0,
            pacs_linked_reviews: 0,
            operation_events: 0,
            assigned_operations: 0,
            outcome_closed_operations: 0,
            last_signal_at: null,
            ...overrides.specialist_review,
        },
        federation: {
            activation_events: 0,
            active_nodes: 0,
            ready_nodes: 0,
            attested_nodes: 0,
            secure_ready_nodes: 0,
            heartbeat_healthy_nodes: 0,
            outcome_eligibility_snapshots: 0,
            eligible_outcome_snapshots: 0,
            outcome_confirmed_rows: 0,
            provenance_verified_rows: 0,
            trust_scored_rows: 0,
            external_validation_events: 0,
            runtime_events: 0,
            online_runtime_events: 0,
            heartbeat_events: 0,
            task_events: 0,
            submitted_tasks: 0,
            update_submissions: 0,
            accepted_update_submissions: 0,
            signed_update_submissions: 0,
            promotion_events: 0,
            candidate_registered_events: 0,
            promotion_gate_required_events: 0,
            champion_surveillance_events: 0,
            rollback_required_surveillance_events: 0,
            last_signal_at: null,
            ...overrides.federation,
        },
        trust_ops: {
            external_attestations: 0,
            external_certifications: 0,
            external_validations: 0,
            last_signal_at: null,
            ...overrides.trust_ops,
        },
    };
}
