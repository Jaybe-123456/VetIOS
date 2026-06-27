import { describe, expect, it } from 'vitest';
import {
    buildSpecialistReviewOperationEventDraft,
    buildSpecialistReviewOperationsPacket,
    type SpecialistReviewerProfile,
} from '@/lib/specialistReview/operations';

describe('specialist review operations', () => {
    it('keeps diagnostic imaging requests waiting until PACS evidence is linked', () => {
        const packet = buildSpecialistReviewOperationsPacket({
            reviewer_route: 'diagnostic_imaging',
            urgency_level: 'urgent',
            review_stage: 'requested',
            review_status: 'pending',
            ai_disposition: 'not_reviewed',
            clinician_action: 'none',
            report_status: 'not_started',
            pacs_status: 'pending',
            outcome_required: true,
            outcome_captured: false,
            evidence_pack: {
                pacs: {
                    study_instance_uid: '1.2.840.113619.2.55.3.604688435.781.171905',
                },
            },
            observed_at: '2026-06-22T10:00:00.000Z',
            now: '2026-06-22T11:00:00.000Z',
        });

        expect(packet.queue_status).toBe('awaiting_pacs');
        expect(packet.pacs_workflow).toMatchObject({
            required: true,
            pacs_status: 'pending',
            link_required: true,
        });
        expect(packet.pacs_workflow.pacs_reference_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.blockers).toContain('pacs_link_required');
        expect(packet.next_actions).toContain('link_pacs_or_report_reference');
    });

    it('assigns the available specialist with the lowest active case load', () => {
        const packet = buildSpecialistReviewOperationsPacket({
            reviewer_route: 'internal_medicine',
            urgency_level: 'priority',
            review_stage: 'requested',
            review_status: 'pending',
            ai_disposition: 'not_reviewed',
            clinician_action: 'none',
            report_status: 'not_started',
            pacs_status: 'not_applicable',
            outcome_required: true,
            outcome_captured: false,
            observed_at: '2026-06-22T10:00:00.000Z',
            now: '2026-06-22T11:00:00.000Z',
            reviewer_pool: [
                reviewer({ reviewer_ref: 'im-2', active_case_count: 4 }),
                reviewer({ reviewer_ref: 'im-1', active_case_count: 1 }),
                reviewer({ reviewer_ref: 'im-offline', availability: 'offline', active_case_count: 0 }),
            ],
        });

        expect(packet.queue_status).toBe('assigned');
        expect(packet.assignment).toMatchObject({
            assigned_reviewer_ref: 'im-1',
            assignment_status: 'assigned',
            candidate_reviewer_count: 2,
        });
        expect(packet.turnaround.sla_minutes).toBe(1440);
        expect(packet.blockers).toEqual([]);
    });

    it('escalates overdue unfinished emergency reviews', () => {
        const packet = buildSpecialistReviewOperationsPacket({
            reviewer_route: 'emergency_veterinarian',
            urgency_level: 'emergency',
            review_stage: 'in_review',
            review_status: 'pending',
            ai_disposition: 'not_reviewed',
            clinician_action: 'none',
            report_status: 'draft',
            pacs_status: 'not_applicable',
            outcome_required: true,
            outcome_captured: false,
            observed_at: '2026-06-22T10:00:00.000Z',
            now: '2026-06-22T12:30:00.000Z',
            reviewer_pool: [reviewer({
                reviewer_ref: 'er-1',
                reviewer_route: 'emergency_veterinarian',
                accepts_emergency: true,
            })],
        });

        expect(packet.queue_status).toBe('overdue');
        expect(packet.turnaround.overdue).toBe(true);
        expect(packet.blockers).toContain('specialist_review_sla_overdue');
        expect(packet.next_actions[0]).toBe('escalate_review_sla');
    });

    it('marks final outcome-linked reviews as learning ready without storing raw report text', () => {
        const packet = buildSpecialistReviewOperationsPacket({
            reviewer_route: 'diagnostic_imaging',
            specialty: 'Diagnostic Imaging / PACS',
            urgency_level: 'routine',
            review_stage: 'closed',
            review_status: 'completed',
            ai_disposition: 'corrected',
            clinician_action: 'additional_tests',
            report_status: 'final',
            pacs_status: 'linked',
            outcome_required: true,
            outcome_captured: true,
            deidentified_report: {
                report_ref: 'report-123',
                summary: 'Structured de-identified report summary.',
            },
            review_summary: 'Specialist corrected the AI impression after review.',
            observed_at: '2026-06-22T10:00:00.000Z',
            now: '2026-06-22T11:00:00.000Z',
        });

        expect(packet.queue_status).toBe('learning_ready');
        expect(packet.closure).toMatchObject({
            closure_ready: true,
            learning_eligible: true,
        });
        expect(packet.report_workflow.final_report_ready).toBe(true);
        expect(packet.report_workflow.review_summary_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.deidentification.raw_report_stored).toBe(false);
        expect(packet.next_actions).toContain('promote_specialist_review_learning_signal');
    });

    it('blocks packets that contain direct owner or patient identifiers', () => {
        const packet = buildSpecialistReviewOperationsPacket({
            reviewer_route: 'internal_medicine',
            urgency_level: 'routine',
            review_stage: 'requested',
            review_status: 'pending',
            ai_disposition: 'not_reviewed',
            clinician_action: 'none',
            report_status: 'not_started',
            pacs_status: 'not_applicable',
            outcome_required: true,
            outcome_captured: false,
            evidence_pack: {
                owner_name: 'Jane Example',
                patient_name: 'Milo',
            },
            observed_at: '2026-06-22T10:00:00.000Z',
            now: '2026-06-22T11:00:00.000Z',
        });

        expect(packet.queue_status).toBe('blocked');
        expect(packet.blockers).toContain('direct_identifier_risk_in_review_packet');
        expect(packet.deidentification.detected_identifier_paths).toEqual([
            'evidence_pack.owner_name',
            'evidence_pack.patient_name',
        ]);
    });

    it('builds a de-identified specialist operation event draft for queue persistence', () => {
        const operationsInput = {
            request_id: '55555555-5555-4555-8555-555555555555',
            reviewer_route: 'diagnostic_imaging' as const,
            specialty: 'Diagnostic Imaging / PACS',
            urgency_level: 'priority' as const,
            review_stage: 'closed' as const,
            review_status: 'completed' as const,
            ai_disposition: 'corrected' as const,
            clinician_action: 'additional_tests' as const,
            report_status: 'final' as const,
            pacs_status: 'linked' as const,
            outcome_required: true,
            outcome_captured: true,
            evidence_pack: {
                pacs: {
                    study_instance_uid: '1.2.840.113619.2.55.3.604688435.781.171905',
                },
            },
            deidentified_report: {
                report_ref: 'report-123',
                summary: 'Structured de-identified report summary.',
            },
            review_summary: 'Specialist corrected the AI impression after review.',
            observed_at: '2026-06-22T10:00:00.000Z',
            now: '2026-06-22T11:00:00.000Z',
        };

        const draft = buildSpecialistReviewOperationEventDraft({
            tenantId: '33333333-3333-4333-8333-333333333333',
            requestId: operationsInput.request_id,
            specialistReviewEventId: '66666666-6666-4666-8666-666666666666',
            caseId: '77777777-7777-4777-8777-777777777777',
            operationsInput,
            evidence: {
                endpoint: '/api/clinical/specialist-review',
            },
        });

        expect(draft.queue_status).toBe('learning_ready');
        expect(draft.assignment_status).toBe('needs_assignment');
        expect(draft.pacs_required).toBe(true);
        expect(draft.pacs_link_required).toBe(false);
        expect(draft.final_report_ready).toBe(true);
        expect(draft.closure_ready).toBe(true);
        expect(draft.learning_eligible).toBe(true);
        expect(draft.operation_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(draft.packet_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(draft.evidence_pack_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(draft.operations_packet.deidentification.raw_report_stored).toBe(false);
        expect(draft.evidence).toMatchObject({
            endpoint: '/api/clinical/specialist-review',
            raw_report_stored: false,
            raw_imaging_stored: false,
            raw_pacs_report_stored: false,
            raw_owner_or_patient_identifiers_stored: false,
        });
        expect(JSON.stringify(draft.operations_packet)).not.toContain('Specialist corrected the AI impression after review.');
    });
});

function reviewer(overrides: Partial<SpecialistReviewerProfile> = {}): SpecialistReviewerProfile {
    return {
        reviewer_ref: 'reviewer-1',
        reviewer_route: 'internal_medicine',
        availability: 'available',
        active_case_count: 0,
        max_active_case_count: 6,
        accepts_emergency: false,
        ...overrides,
    };
}
