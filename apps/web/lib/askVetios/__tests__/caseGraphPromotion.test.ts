import { describe, expect, it } from 'vitest';
import {
    aggregateAskVetiosCaseGraphPromotionEvents,
    buildAskVetiosCaseGraphPromotionAssessment,
} from '@/lib/askVetios/caseGraphPromotion';

describe('Ask VetIOS case graph promotion moat', () => {
    it('keeps incomplete drafts out of the case graph promotion path', () => {
        const assessment = buildAskVetiosCaseGraphPromotionAssessment({
            case_graph_status: 'draft',
            clinician_confirmation_status: 'not_reviewed',
            readiness_score: 42,
            missing_fields: ['species', 'clinical signs'],
        });

        expect(assessment.promotion_status).toBe('needs_more_information');
        expect(assessment.value_capture_status).toBe('foundation');
        expect(assessment.outcome_linkage_status).toBe('not_linked');
        expect(assessment.next_required_action).toBe('complete_case_graph_fields');
        expect(assessment.missing_fields).toEqual(['species', 'clinical_signs']);
    });

    it('requires clinician review before a ready draft becomes an operating case graph signal', () => {
        const assessment = buildAskVetiosCaseGraphPromotionAssessment({
            ask_vetios_query_id: '11111111-1111-4111-8111-111111111111',
            clinical_case_id: '22222222-2222-4222-8222-222222222222',
            draft_key: 'ask_case_test',
            case_graph_status: 'ready_for_case_graph',
            clinician_confirmation_status: 'confirmed',
            readiness_score: 88,
            promoted_fields: ['species', 'clinical signs', 'labs'],
            deidentified_case_graph_snapshot: {
                patient: { species: 'dog' },
                encounter: { clinical_signs: ['vomiting'] },
            },
            review_evidence: {
                reviewer_role: 'licensed_veterinarian',
            },
        });

        expect(assessment.promotion_status).toBe('promoted_to_case');
        expect(assessment.value_capture_status).toBe('operating');
        expect(assessment.outcome_linkage_status).toBe('pending');
        expect(assessment.next_required_action).toBe('capture_clinician_confirmed_outcome');
        expect(assessment.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('marks outcome-linked promoted cases as defensible candidates', () => {
        const assessment = buildAskVetiosCaseGraphPromotionAssessment({
            ask_vetios_query_id: '11111111-1111-4111-8111-111111111111',
            clinical_case_id: '22222222-2222-4222-8222-222222222222',
            clinical_outcome_id: '33333333-3333-4333-8333-333333333333',
            case_graph_status: 'ready_for_case_graph',
            clinician_confirmation_status: 'modified',
            readiness_score: 91,
            promoted_fields: ['species', 'clinical signs', 'outcome'],
        });

        expect(assessment.promotion_status).toBe('linked_to_outcome');
        expect(assessment.outcome_linkage_status).toBe('linked');
        expect(assessment.value_capture_status).toBe('defensible_candidate');
        expect(assessment.next_required_action).toBeNull();
    });

    it('aggregates promotion evidence without raw case content', () => {
        const aggregate = aggregateAskVetiosCaseGraphPromotionEvents([
            {
                promotion_status: 'review_required',
                value_capture_status: 'foundation',
                readiness_score: 70,
                missing_fields: ['clinician_confirmation'],
                observed_at: '2026-06-18T12:00:00.000Z',
            },
            {
                promotion_status: 'linked_to_outcome',
                value_capture_status: 'defensible_candidate',
                readiness_score: 90,
                missing_fields: [],
                observed_at: '2026-06-19T12:00:00.000Z',
            },
        ]);

        expect(aggregate.total_events).toBe(2);
        expect(aggregate.linked_to_outcome).toBe(1);
        expect(aggregate.defensible_candidates).toBe(1);
        expect(aggregate.average_readiness_score).toBe(80);
        expect(aggregate.top_missing_fields).toEqual([{ field: 'clinician_confirmation', count: 1 }]);
    });
});
