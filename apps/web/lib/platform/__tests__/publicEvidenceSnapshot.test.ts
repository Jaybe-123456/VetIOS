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
        });

        expect(integrity.status).toBe('collecting');
        expect(integrity.public_claim_posture).toBe('measured_activity');
        expect(integrity.ask_vetios_governed).toBe(true);
        expect(integrity.amr_loop_active).toBe(true);
        expect(integrity.outcome_confirmed_corpus).toBe(false);
    });

    it('allows evidence-grade claims only after outcome and CIRE thresholds are present', () => {
        const integrity = buildPublicEvidenceIntegrity({
            configured: true,
            dataset: dataset({ clinical_cases: 80, confirmed_labels: 40 }),
            inference: inference({
                inference_events: 100,
                outcome_linked_inferences: 40,
                cire_sample_size: 40,
                cire_status: 'validated',
            }),
            workflow: workflow({ passive_signal_events: 15 }),
            ask_vetios: askVetios({ query_events: 20, grounded_drafts: 5, regulatory_reviewable: 5 }),
            amr: amr({ stewardship_events: 10, outcome_tracked_events: 4 }),
        });

        expect(integrity.status).toBe('evidence_grade');
        expect(integrity.public_claim_posture).toBe('evidence_grade_claims');
        expect(integrity.outcome_confirmed_corpus).toBe(true);
        expect(integrity.cire_validation_ready).toBe(true);
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
        outcome_linked_inferences: 0,
        cire_sample_size: 0,
        cire_status: 'unconfigured',
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
