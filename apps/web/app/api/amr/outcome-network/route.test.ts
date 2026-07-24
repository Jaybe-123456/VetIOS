import { describe, expect, it } from 'vitest';
import { validateAMREpisodeReferences } from '@/lib/amr/outcomeNetworkReferences';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const LAB_FEED_ID = '33333333-3333-4333-8333-333333333333';
const INFERENCE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_INFERENCE_ID = '55555555-5555-4555-8555-555555555555';
const OUTCOME_ID = '66666666-6666-4666-8666-666666666666';
const CASE_ID = '77777777-7777-4777-8777-777777777777';

describe('AMR outcome network reference validation', () => {
    it('rejects a linked laboratory event that is not owned by the tenant', async () => {
        const result = await validate({
            amr_lab_feed_surveillance_events: [{
                id: LAB_FEED_ID,
                tenant_id: OTHER_TENANT_ID,
            }],
        }, {
            amr_lab_feed_event_id: LAB_FEED_ID,
        });

        expect(result.error).toBe('amr_lab_feed_event_not_found_for_tenant');
        expect(result.storageError).toBeNull();
    });

    it('derives synthetic status from tenant-owned linked inference evidence', async () => {
        const result = await validate({
            clinical_outcome_events: [{
                id: OUTCOME_ID,
                tenant_id: TENANT_ID,
                case_id: CASE_ID,
                inference_event_id: INFERENCE_ID,
                label_type: 'clinician_confirmed',
                is_synthetic: false,
            }],
            ai_inference_events: [{
                id: INFERENCE_ID,
                tenant_id: TENANT_ID,
                case_id: CASE_ID,
                is_synthetic: true,
            }],
            clinical_cases: [{
                id: CASE_ID,
                tenant_id: TENANT_ID,
                label_type: 'outcome_confirmed',
                adversarial_case: false,
            }],
        }, {
            inference_event_id: INFERENCE_ID,
            clinical_outcome_id: OUTCOME_ID,
        });

        expect(result.error).toBeNull();
        expect(result.synthetic).toBe(true);
        expect(result.provenance).toMatchObject({
            tenant_reference_validation: 'passed',
            synthetic_status: 'server_derived',
            synthetic_sources: ['inference_event'],
        });
    });

    it('rejects an outcome that belongs to a different inference chain', async () => {
        const result = await validate({
            clinical_outcome_events: [{
                id: OUTCOME_ID,
                tenant_id: TENANT_ID,
                inference_event_id: OTHER_INFERENCE_ID,
                label_type: 'clinician_confirmed',
                is_synthetic: false,
            }],
        }, {
            inference_event_id: INFERENCE_ID,
            clinical_outcome_id: OUTCOME_ID,
        });

        expect(result.error).toBe('inference_reference_mismatch');
    });
});

async function validate(
    rows: Record<string, Array<Record<string, unknown>>>,
    overrides: Record<string, unknown>,
) {
    return validateAMREpisodeReferences({
        supabase: createSupabaseStub(rows) as never,
        tenantId: TENANT_ID,
        body: {
            action: 'record_episode_event',
            request_id: '88888888-8888-4888-8888-888888888888',
            event_type: 'outcome_confirmed',
            is_synthetic: false,
            deidentified: true,
            evidence: {},
            ...overrides,
        } as never,
        currentRows: [],
    });
}

function createSupabaseStub(rows: Record<string, Array<Record<string, unknown>>>) {
    return {
        from(table: string) {
            const filters = new Map<string, unknown>();
            const builder = {
                select() {
                    return builder;
                },
                eq(column: string, value: unknown) {
                    filters.set(column, value);
                    return builder;
                },
                async maybeSingle() {
                    const row = (rows[table] ?? []).find((candidate) => (
                        Array.from(filters.entries()).every(
                            ([column, value]) => candidate[column] === value,
                        )
                    ));
                    return { data: row ?? null, error: null };
                },
            };
            return builder;
        },
    };
}
