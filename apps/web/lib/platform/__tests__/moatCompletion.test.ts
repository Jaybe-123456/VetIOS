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

    it('keeps stale high-volume evidence below defensible claim posture', () => {
        const digest = buildMoatCompletionAssessment({
            moat_key: 'stale_moat',
            moat_name: 'Stale Moat',
            value_capture_layer: 'data_provenance',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'not_replicable_short_term',
            scarcity_basis: ['confirmed_outcomes', 'verified_provenance'],
            assessed_at: '2026-07-20T12:00:00.000Z',
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

        expect(digest.completion_level).toBe('operating');
        expect(digest.claim_posture).toBe('measured_activity');
        expect(digest.missing_evidence).toContain('fresh_operating_signal_30d');
        expect(digest.next_unblock_action).toBe('Append a fresh live evidence event before making a defensible moat claim.');
        expect(digest.evidence.freshness).toMatchObject({
            status: 'stale',
            signal_age_days: 31,
            max_defensible_age_days: 30,
        });
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
                pims_workflow_runs: 2,
                lab_result_runs: 2,
                pacs_report_runs: 1,
                follow_up_runs: 1,
                operating_pims_workflow_runs: 1,
                operating_lab_result_runs: 1,
                operating_pacs_report_runs: 1,
                operating_follow_up_runs: 1,
            },
            inference: {
                outcome_linked_inferences: 1,
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
        expect(workflow?.outcome_confirmed_count).toBe(2);
        expect(workflow?.provenance_verified_count).toBe(16);
        expect(workflow?.trust_scored_count).toBe(4);
        expect(workflow?.evidence.source_tables).toContain('workflow_integration_run_events');
        expect(workflow?.evidence.full_operating_workflow_surface).toBe(true);
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

    it('keeps workflow integration at foundation when operating evidence is lab-only', () => {
        const snapshot = buildMoatCompletionSnapshot(evidence({
            workflow: {
                passive_signal_events: 8,
                integration_run_events: 16,
                ready_integration_runs: 12,
                pims_workflow_runs: 0,
                lab_result_runs: 16,
                pacs_report_runs: 0,
                follow_up_runs: 0,
                operating_pims_workflow_runs: 0,
                operating_lab_result_runs: 12,
                operating_pacs_report_runs: 0,
                operating_follow_up_runs: 0,
            },
            inference: {
                outcome_linked_inferences: 12,
                cire_sample_size: 12,
            },
            ask_vetios: {
                workflow_ready: 6,
            },
        }));

        const workflow = snapshot.moats.find((moat) => moat.moat_key === 'workflow_integration');

        expect(workflow?.completion_level).toBe('foundation');
        expect(workflow?.live_event_count).toBe(24);
        expect(workflow?.outcome_confirmed_count).toBe(0);
        expect(workflow?.trust_scored_count).toBe(0);
        expect(workflow?.provenance_verified_count).toBe(27);
        expect(workflow?.missing_evidence).toContain('outcome_confirmed_records');
        expect(workflow?.missing_evidence).toContain('trust_scored_records');
        expect(workflow?.evidence.workflow_capability_coverage).toBe(1);
        expect(workflow?.evidence.operating_workflow_capability_coverage).toBe(1);
        expect(workflow?.evidence.full_operating_workflow_surface).toBe(false);
    });

    it('requires broad attack-family coverage before AI security gets trust-score credit', () => {
        const snapshot = buildMoatCompletionSnapshot(evidence({
            ask_vetios: {
                query_events: 20,
                security_review_required: 2,
                security_test_events: 12,
                security_incident_events: 1,
                security_prompt_injection_tests: 12,
                security_rag_boundary_tests: 0,
                security_tool_abuse_tests: 0,
                security_data_exfiltration_tests: 0,
                security_incident_response_tests: 0,
                security_external_attestation_tests: 0,
                security_attack_detected_tests: 12,
                security_policy_blocked_tests: 12,
            },
            trust_ops: {
                external_validations: 1,
            },
        }));

        const security = snapshot.moats.find((moat) => moat.moat_key === 'ai_security_layer');

        expect(security?.completion_level).toBe('foundation');
        expect(security?.provenance_verified_count).toBe(15);
        expect(security?.trust_scored_count).toBe(0);
        expect(security?.missing_evidence).toContain('trust_scored_records');
        expect(security?.evidence.security_attack_family_coverage).toBe(1);
        expect(security?.evidence.full_security_attack_coverage).toBe(false);
    });

    it('credits AI security trust evidence only after prompt, RAG, tool, exfiltration, incident, and attestation tests exist', () => {
        const snapshot = buildMoatCompletionSnapshot(evidence({
            ask_vetios: {
                query_events: 20,
                security_review_required: 2,
                security_test_events: 12,
                security_incident_events: 2,
                security_prompt_injection_tests: 2,
                security_rag_boundary_tests: 2,
                security_tool_abuse_tests: 2,
                security_data_exfiltration_tests: 2,
                security_incident_response_tests: 2,
                security_external_attestation_tests: 2,
                security_attack_detected_tests: 10,
                security_policy_blocked_tests: 12,
            },
            trust_ops: {
                external_validations: 1,
            },
        }));

        const security = snapshot.moats.find((moat) => moat.moat_key === 'ai_security_layer');

        expect(security?.completion_level).toBe('operating');
        expect(security?.provenance_verified_count).toBe(20);
        expect(security?.trust_scored_count).toBe(18);
        expect(security?.evidence.security_attack_family_coverage).toBe(6);
        expect(security?.evidence.full_security_attack_coverage).toBe(true);
    });

    it('requires governed CDS, model-card, IFU, signoff, and attestation coverage before regulatory trust credit', () => {
        const partialSnapshot = buildMoatCompletionSnapshot(evidence({
            ask_vetios: {
                query_events: 20,
                grounded_drafts: 12,
                regulatory_reviewable: 8,
                regulatory_review_events: 8,
                regulatory_approval_events: 2,
                regulatory_cds_complete_reviews: 8,
                regulatory_model_card_approved_reviews: 0,
                regulatory_ifu_approved_reviews: 0,
                regulatory_clinical_signoff_approved_reviews: 0,
                regulatory_legal_signoff_approved_reviews: 0,
                regulatory_external_attestation_events: 0,
            },
            trust_ops: {
                external_validations: 1,
            },
        }));
        const completeSnapshot = buildMoatCompletionSnapshot(evidence({
            ask_vetios: {
                query_events: 20,
                grounded_drafts: 12,
                regulatory_reviewable: 8,
                regulatory_review_events: 8,
                regulatory_approval_events: 6,
                regulatory_cds_complete_reviews: 8,
                regulatory_model_card_approved_reviews: 2,
                regulatory_ifu_approved_reviews: 2,
                regulatory_clinical_signoff_approved_reviews: 2,
                regulatory_legal_signoff_approved_reviews: 2,
                regulatory_external_attestation_events: 1,
            },
        }));

        const partial = partialSnapshot.moats.find((moat) => moat.moat_key === 'regulatory_claims_discipline');
        const complete = completeSnapshot.moats.find((moat) => moat.moat_key === 'regulatory_claims_discipline');

        expect(partial?.completion_level).toBe('foundation');
        expect(partial?.trust_scored_count).toBe(0);
        expect(partial?.evidence.regulatory_artifact_coverage).toBe(1);
        expect(partial?.evidence.full_regulatory_approval_coverage).toBe(false);
        expect(complete?.completion_level).toBe('operating');
        expect(complete?.live_event_count).toBe(34);
        expect(complete?.provenance_verified_count).toBe(28);
        expect(complete?.trust_scored_count).toBe(18);
        expect(complete?.external_validation_count).toBe(1);
        expect(complete?.evidence.regulatory_artifact_coverage).toBe(6);
        expect(complete?.evidence.full_regulatory_approval_coverage).toBe(true);
    });

    it('graduates veterinary retrieval from corpus audit evidence, not only query grounding', () => {
        const snapshot = buildMoatCompletionSnapshot(evidence({
            dataset: {
                confirmed_labels: 4,
            },
            ask_vetios: {
                query_events: 3,
                retrieval_grounded: 2,
                grounded_drafts: 2,
            },
            retrieval_corpus: {
                audit_events: 4,
                operating_audits: 2,
                red_team_evaluations: 1,
                citation_quality_evaluations: 1,
                source_count: 18,
                document_count: 42,
                chunk_count: 640,
                high_authority_source_count: 7,
                authorized_source_count: 11,
                versioned_source_count: 10,
                covered_index_count: 2,
                red_team_case_count: 9,
                citation_quality_score: 0.82,
            },
        }));

        const retrieval = snapshot.moats.find((moat) => moat.moat_key === 'veterinary_retrieval');

        expect(retrieval?.completion_level).toBe('operating');
        expect(retrieval?.live_event_count).toBe(7);
        expect(retrieval?.provenance_verified_count).toBe(30);
        expect(retrieval?.trust_scored_count).toBe(14);
        expect(retrieval?.evidence.source_tables).toContain('veterinary_retrieval_corpus_audit_events');
        expect(retrieval?.evidence.operating_corpus_audits).toBe(2);
        expect(retrieval?.evidence.citation_quality_score).toBe(0.82);
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
    retrieval_corpus?: Partial<MoatCompletionEvidence['retrieval_corpus']>;
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
            pims_workflow_runs: 0,
            lab_result_runs: 0,
            pacs_report_runs: 0,
            follow_up_runs: 0,
            operating_pims_workflow_runs: 0,
            operating_lab_result_runs: 0,
            operating_pacs_report_runs: 0,
            operating_follow_up_runs: 0,
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
            security_prompt_injection_tests: 0,
            security_rag_boundary_tests: 0,
            security_tool_abuse_tests: 0,
            security_data_exfiltration_tests: 0,
            security_incident_response_tests: 0,
            security_external_attestation_tests: 0,
            security_attack_detected_tests: 0,
            security_policy_blocked_tests: 0,
            regulatory_reviewable: 0,
            regulatory_review_events: 0,
            regulatory_blocked_reviews: 0,
            regulatory_approved_reviews: 0,
            regulatory_cds_complete_reviews: 0,
            regulatory_model_card_approved_reviews: 0,
            regulatory_ifu_approved_reviews: 0,
            regulatory_clinical_signoff_approved_reviews: 0,
            regulatory_legal_signoff_approved_reviews: 0,
            regulatory_approval_events: 0,
            regulatory_external_attestation_events: 0,
            last_signal_at: null,
            ...overrides.ask_vetios,
        },
        retrieval_corpus: {
            audit_events: 0,
            operating_audits: 0,
            red_team_evaluations: 0,
            citation_quality_evaluations: 0,
            source_count: 0,
            document_count: 0,
            chunk_count: 0,
            high_authority_source_count: 0,
            authorized_source_count: 0,
            versioned_source_count: 0,
            covered_index_count: 0,
            red_team_case_count: 0,
            citation_quality_score: 0,
            last_signal_at: null,
            ...overrides.retrieval_corpus,
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
