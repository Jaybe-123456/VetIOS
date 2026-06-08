import { describe, expect, it } from 'vitest';
import type { CaseSummary } from '@/lib/cases/caseWorkflow';
import type { ConfirmedCaseCollectionStats } from '@/lib/cases/confirmedCaseCollection';
import { buildOutcomeDataSnapshot } from '@/lib/cases/outcomeDataSnapshots';

const NOW = new Date('2026-06-08T12:00:00.000Z');

describe('outcome data moat snapshots', () => {
    it('builds an append-only snapshot payload from collection and closure metrics', () => {
        const snapshot = buildOutcomeDataSnapshot({
            tenantId: 'tenant-1',
            now: NOW,
            collectionStats: {
                total_cases: 4,
                confirmed_cases: 2,
                pending_cases: 2,
                outcome_events: 2,
                deidentified_learning_signals: 1,
                confirmed_last_7d: 1,
                label_count: 2,
                milestone_target: 200,
                milestone_percent: 1,
                ready_for_validation: false,
                top_labels: [
                    { label: 'canine_parvovirus', count: 2 },
                    { label: 'ehrlichiosis', count: 1 },
                ],
                warnings: ['clinical_outcome_events unavailable: test'],
                updated_at: NOW.toISOString(),
            } satisfies ConfirmedCaseCollectionStats,
            cases: [
                makeCase({
                    id: 'closed',
                    case_status: 'closed',
                    closed_at: '2026-06-08T11:00:00.000Z',
                    confirmed_diagnosis: 'canine_parvovirus',
                    latest_outcome_event_id: 'outcome-1',
                }),
                makeCase({
                    id: 'overdue-open',
                    created_at: '2026-06-07T07:00:00.000Z',
                    patient_name: 'Hidden from snapshot',
                }),
            ],
        });

        expect(snapshot.snapshot_date).toBe('2026-06-08');
        expect(snapshot.snapshot_key).toMatch(/^[a-f0-9]{64}$/);
        expect(snapshot.confirmed_cases).toBe(2);
        expect(snapshot.validation_progress).toBe(0.01);
        expect(snapshot.open_cases).toBe(1);
        expect(snapshot.closed_cases).toBe(1);
        expect(snapshot.overdue_open_cases).toBe(1);
        expect(snapshot.top_labels).toEqual([
            { label: 'canine_parvovirus', count: 2 },
            { label: 'ehrlichiosis', count: 1 },
        ]);
        expect(snapshot.closure_backlog).toEqual([
            expect.objectContaining({
                case_id: 'overdue-open',
                overdue: true,
                closure_ready: true,
            }),
        ]);
        expect(JSON.stringify(snapshot)).not.toContain('Hidden from snapshot');
    });
});

function makeCase(overrides: Partial<CaseSummary> = {}): CaseSummary {
    return {
        id: 'case-1',
        tenant_id: 'tenant-1',
        user_id: 'vet-a',
        clinic_id: 'clinic-1',
        patient_id: 'patient-1',
        created_at: '2026-06-08T08:00:00.000Z',
        updated_at: '2026-06-08T08:00:00.000Z',
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
        top_differentials: [],
        recommended_tests: [],
        reliability_score: 0.82,
        reliability_label: 'High',
        ...overrides,
    };
}
