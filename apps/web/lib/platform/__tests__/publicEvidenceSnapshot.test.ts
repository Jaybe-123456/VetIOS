import { describe, expect, it } from 'vitest';
import { buildPublicEvidenceIntegrity, type PublicEvidenceSnapshot } from '@/lib/platform/publicEvidenceSnapshot';

describe('public evidence snapshot integrity', () => {
    it('keeps public posture as architecture-only when no live evidence is configured', () => {
        const integrity = buildPublicEvidenceIntegrity({
            configured: false,
            dataset: dataset(),
            inference: inference(),
            workflow: workflow(),
            ask_vetios: askVetios(),
            amr: amr(),
            specialist_review: specialistReview(),
        });

        expect(integrity.status).toBe('not_configured');
        expect(integrity.public_claim_posture).toBe('architecture_only');
        expect(integrity.live_counts_available).toBe(false);
    });

    it('reports measured activity before outcome-confirmed reliability is evidence-grade', () => {
        const integrity = buildPublicEvidenceIntegrity({
            configured: true,
            dataset: dataset({ clinical_cases: 12 }),
            inference: inference({ inference_events: 20 }),
            workflow: workflow(),
            ask_vetios: askVetios({ query_events: 8, regulatory_reviewable: 3 }),
            amr: amr({ stewardship_events: 2 }),
            specialist_review: specialistReview({ review_events: 1, completed_reviews: 1 }),
        });

        expect(integrity.status).toBe('collecting');
        expect(integrity.public_claim_posture).toBe('measured_activity');
        expect(integrity.ask_vetios_governed).toBe(true);
        expect(integrity.amr_loop_active).toBe(true);
        expect(integrity.specialist_review_loop_active).toBe(true);
        expect(integrity.outcome_confirmed_corpus).toBe(false);
    });

    it('allows evidence-grade claims only after outcome and CIRE thresholds are present', () => {
        const integrity = buildPublicEvidenceIntegrity({
            configured: true,
            dataset: dataset({ clinical_cases: 80, confirmed_labels: 40 }),
            inference: inference({
                inference_events: 100,
                outcome_linked_inferences: 40,
                outcome_confirmed_inferences: 40,
                expert_reviewed_inferences: 30,
                lab_confirmed_inferences: 10,
                cire_sample_size: 220,
                cire_min_sample_size: 200,
                cire_status: 'validated',
                cire_validation_scope: 'real_clinical_outcomes',
            }),
            workflow: workflow({ passive_signal_events: 15 }),
            ask_vetios: askVetios({ query_events: 20, grounded_drafts: 5, regulatory_reviewable: 5 }),
            amr: amr({ stewardship_events: 10, outcome_tracked_events: 4 }),
            specialist_review: specialistReview({ review_events: 6, completed_reviews: 4, learning_eligible_reviews: 2 }),
        });

        expect(integrity.status).toBe('evidence_grade');
        expect(integrity.public_claim_posture).toBe('evidence_grade_claims');
        expect(integrity.outcome_confirmed_corpus).toBe(true);
        expect(integrity.cire_validation_ready).toBe(true);
    });

    it('does not permit evidence-grade claims for a large weak or inverse CIRE cohort', () => {
        const integrity = buildPublicEvidenceIntegrity({
            configured: true,
            dataset: dataset({ clinical_cases: 300, confirmed_labels: 250 }),
            inference: inference({
                inference_events: 400,
                outcome_confirmed_inferences: 250,
                cire_sample_size: 250,
                cire_min_sample_size: 200,
                cire_status: 'weak_signal',
                cire_validation_scope: 'real_clinical_outcomes',
            }),
            workflow: workflow(),
            ask_vetios: askVetios(),
            amr: amr(),
            specialist_review: specialistReview(),
        });

        expect(integrity.status).toBe('collecting');
        expect(integrity.cire_validation_ready).toBe(false);
        expect(integrity.public_claim_posture).toBe('measured_activity');
    });
});

function dataset(overrides: Partial<PublicEvidenceSnapshot['dataset']> = {}): PublicEvidenceSnapshot['dataset'] {
    return {
        clinical_cases: 0,
        real_case_imports: 0,
        confirmed_labels: 0,
        learning_ready_cases: 0,
        quarantined_cases: 0,
        calibration_ready_cases: 0,
        ...overrides,
    };
}

function inference(overrides: Partial<PublicEvidenceSnapshot['inference']> = {}): PublicEvidenceSnapshot['inference'] {
    return {
        inference_events: 0,
        real_inference_events: 0,
        outcome_linked_inferences: 0,
        outcome_confirmed_inferences: 0,
        expert_reviewed_inferences: 0,
        lab_confirmed_inferences: 0,
        calibration_ready_outcomes: 0,
        synthetic_inferences_excluded: 0,
        synthetic_outcome_inferences_excluded: 0,
        outcome_confirmation_rate: 0,
        latest_outcome_confirmed_at: null,
        outcome_metric_version: 'outcome_value_v1',
        cire_sample_size: 0,
        cire_min_sample_size: 200,
        cire_status: 'unconfigured',
        cire_validation_scope: 'real_clinical_outcomes',
        cire_spearman_r: null,
        ...overrides,
    };
}

function workflow(overrides: Partial<PublicEvidenceSnapshot['workflow']> = {}): PublicEvidenceSnapshot['workflow'] {
    return {
        passive_signal_events: 0,
        connector_templates: 0,
        pims_templates: 0,
        supported_connector_types: 0,
        ...overrides,
    };
}

function askVetios(overrides: Partial<PublicEvidenceSnapshot['ask_vetios']> = {}): PublicEvidenceSnapshot['ask_vetios'] {
    return {
        query_events: 0,
        case_graph_ready: 0,
        grounded_drafts: 0,
        regulatory_reviewable: 0,
        human_review_required: 0,
        security_review_required: 0,
        ...overrides,
    };
}

function amr(overrides: Partial<PublicEvidenceSnapshot['amr']> = {}): PublicEvidenceSnapshot['amr'] {
    return {
        genomic_events: 0,
        stewardship_events: 0,
        culture_guided_events: 0,
        outcome_tracked_events: 0,
        resistance_suspected_events: 0,
        ...overrides,
    };
}

function specialistReview(overrides: Partial<PublicEvidenceSnapshot['specialist_review']> = {}): PublicEvidenceSnapshot['specialist_review'] {
    return {
        review_events: 0,
        completed_reviews: 0,
        corrected_or_partial_reviews: 0,
        learning_eligible_reviews: 0,
        pacs_linked_reviews: 0,
        ...overrides,
    };
}
