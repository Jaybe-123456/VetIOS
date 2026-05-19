import { describe, expect, it } from 'vitest';
import type { CaseSummary } from '@/lib/cases/caseWorkflow';
import { buildOpenCaseClosureDigest, computeCaseClosureMetrics } from '@/lib/cases/caseClosureMetrics';

const NOW = new Date('2026-05-19T12:00:00.000Z');

describe('case closure metrics', () => {
    it('tracks inferred closure rate, backlog, overdue cases, and clinician cohorts', () => {
        const cases = [
            makeCase({
                id: 'closed-fast',
                user_id: 'vet-a',
                case_status: 'closed',
                created_at: '2026-05-19T08:00:00.000Z',
                closed_at: '2026-05-19T10:00:00.000Z',
                confirmed_diagnosis: 'canine_parvovirus',
                latest_outcome_event_id: 'outcome-1',
            }),
            makeCase({
                id: 'open-overdue',
                user_id: 'vet-a',
                created_at: '2026-05-18T08:00:00.000Z',
            }),
            makeCase({
                id: 'open-fresh',
                user_id: 'vet-b',
                created_at: '2026-05-19T09:00:00.000Z',
            }),
            makeCase({
                id: 'needs-inference',
                user_id: 'vet-b',
                created_at: '2026-05-19T09:00:00.000Z',
                latest_inference_event_id: null,
            }),
        ];

        const metrics = computeCaseClosureMetrics(cases, { now: NOW, overdueHours: 24 });

        expect(metrics.total_cases).toBe(4);
        expect(metrics.closed_cases).toBe(1);
        expect(metrics.open_cases).toBe(3);
        expect(metrics.overdue_open_cases).toBe(1);
        expect(metrics.closure_rate).toBe(0.25);
        expect(metrics.inferred_closure_rate).toBe(0.3333);
        expect(metrics.median_hours_to_closure).toBe(2);
        expect(metrics.by_clinician).toEqual([
            expect.objectContaining({ cohort_id: 'vet-b', open_cases: 2, closed_cases: 0 }),
            expect.objectContaining({ cohort_id: 'vet-a', open_cases: 1, closed_cases: 1 }),
        ]);
    });

    it('prioritizes overdue closure-ready cases in the digest', () => {
        const digest = buildOpenCaseClosureDigest([
            makeCase({
                id: 'fresh',
                created_at: '2026-05-19T10:00:00.000Z',
                patient_name: 'Fresh',
                diagnosis_confidence: 0.95,
            }),
            makeCase({
                id: 'overdue',
                created_at: '2026-05-18T07:00:00.000Z',
                patient_name: 'Overdue',
                diagnosis_confidence: 0.5,
            }),
            makeCase({
                id: 'missing-inference',
                created_at: '2026-05-17T07:00:00.000Z',
                patient_name: 'Needs Inference',
                latest_inference_event_id: null,
            }),
        ], { now: NOW, overdueHours: 24, limit: 2 });

        expect(digest.items.map((item) => item.case_id)).toEqual(['overdue', 'missing-inference']);
        expect(digest.items[0]).toEqual(expect.objectContaining({
            overdue: true,
            closure_ready: true,
            recommended_action: 'Confirm or correct the top differential, then submit outcome closure.',
        }));
        expect(digest.items[1]).toEqual(expect.objectContaining({
            closure_ready: false,
            recommended_action: 'Run inference before outcome closure can be submitted.',
        }));
        expect(digest.truncated).toBe(true);
    });
});

function makeCase(overrides: Partial<CaseSummary> = {}): CaseSummary {
    return {
        id: 'case-1',
        tenant_id: 'tenant-1',
        user_id: 'vet-a',
        clinic_id: 'clinic-1',
        created_at: '2026-05-19T08:00:00.000Z',
        updated_at: '2026-05-19T08:00:00.000Z',
        case_status: 'open',
        patient_name: 'Scout',
        species_display: 'canine',
        species_canonical: 'Canis lupus familiaris',
        breed: 'mixed',
        presenting_complaint: 'vomiting',
        symptom_summary: 'vomiting, lethargy',
        symptoms_normalized: ['vomiting', 'lethargy'],
        top_diagnosis: 'canine_parvovirus',
        confirmed_diagnosis: null,
        diagnosis_confidence: 0.82,
        latest_inference_event_id: 'inference-1',
        latest_outcome_event_id: null,
        closed_at: null,
        patient_metadata: {},
        latest_input_signature: {},
        ...overrides,
    };
}
