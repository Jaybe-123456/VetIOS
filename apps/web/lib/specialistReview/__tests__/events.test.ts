import { describe, expect, it } from 'vitest';
import {
    aggregateSpecialistReviewEvents,
    normalizeSpecialistReviewLabel,
    resolveSpecialistLearningEligibility,
    type SpecialistReviewEventRow,
} from '@/lib/specialistReview/events';

describe('specialist review moat', () => {
    it('normalizes specialist review labels for aggregate joins', () => {
        expect(normalizeSpecialistReviewLabel('Diagnostic Imaging / PACS')).toBe('diagnostic_imaging_pacs');
    });

    it('requires final review disposition and outcome context before learning eligibility', () => {
        expect(resolveSpecialistLearningEligibility({
            review_status: 'completed',
            ai_disposition: 'corrected',
            report_status: 'final',
            outcome_required: true,
            outcome_captured: true,
        })).toBe(true);

        expect(resolveSpecialistLearningEligibility({
            review_status: 'completed',
            ai_disposition: 'corrected',
            report_status: 'draft',
            outcome_required: true,
            outcome_captured: true,
        })).toBe(false);

        expect(resolveSpecialistLearningEligibility({
            review_status: 'completed',
            ai_disposition: 'not_reviewed',
            report_status: 'final',
            outcome_required: false,
            outcome_captured: false,
        })).toBe(false);
    });

    it('aggregates de-identified oversight signals without exposing review notes', () => {
        const aggregate = aggregateSpecialistReviewEvents([
            row({
                reviewer_route: 'diagnostic_imaging',
                urgency_level: 'urgent',
                review_status: 'completed',
                ai_disposition: 'corrected',
                clinician_action: 'additional_tests',
                report_status: 'final',
                pacs_status: 'linked',
                outcome_captured: true,
                learning_eligible: true,
                observed_at: '2026-06-19T10:00:00.000Z',
            }),
            row({
                reviewer_route: 'internal_medicine',
                urgency_level: 'routine',
                review_status: 'completed',
                ai_disposition: 'supported',
                clinician_action: 'accepted_ai',
                report_status: 'final',
                pacs_status: 'not_applicable',
                outcome_captured: false,
                learning_eligible: false,
                observed_at: '2026-06-19T11:00:00.000Z',
            }),
            row({
                reviewer_route: 'primary_clinician',
                urgency_level: 'routine',
                review_status: 'pending',
                ai_disposition: 'not_reviewed',
                clinician_action: 'none',
                report_status: 'draft',
                observed_at: '2026-06-19T12:00:00.000Z',
            }),
        ]);

        expect(aggregate.total_events).toBe(3);
        expect(aggregate.completed_reviews).toBe(2);
        expect(aggregate.specialist_reviews).toBe(2);
        expect(aggregate.ai_corrected_events).toBe(1);
        expect(aggregate.correction_rate).toBe(0.5);
        expect(aggregate.learning_eligible_rate).toBe(0.3333);
        expect(aggregate.pacs_linked_events).toBe(1);
        expect(aggregate.top_reviewer_routes[0]).toEqual({ reviewer_route: 'diagnostic_imaging', count: 1 });
        expect(aggregate.latest_observed_at).toBe('2026-06-19T12:00:00.000Z');
    });
});

function row(overrides: Partial<SpecialistReviewEventRow> = {}): SpecialistReviewEventRow {
    return {
        reviewer_route: 'primary_clinician',
        urgency_level: 'routine',
        review_stage: 'requested',
        review_status: 'pending',
        ai_disposition: 'not_reviewed',
        clinician_action: 'none',
        report_status: 'not_started',
        pacs_status: 'not_applicable',
        outcome_required: true,
        outcome_captured: false,
        learning_eligible: false,
        observed_at: '2026-06-19T09:00:00.000Z',
        ...overrides,
    };
}
