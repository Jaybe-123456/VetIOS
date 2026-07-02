import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as inferencePost } from '../inference/route';
import { POST as outcomePost } from '../outcome/route';
import { GET as outboxFlushGet } from '../cron/outbox-flush/route';

const mocks = vi.hoisted(() => ({
    getSupabaseServer: vi.fn(),
    resolveClinicalApiActor: vi.fn(),
    runInference: vi.fn(),
    confirmOutcome: vi.fn(),
}));

vi.mock('@/lib/supabaseServer', () => ({
    getSupabaseServer: mocks.getSupabaseServer,
}));

vi.mock('@/lib/auth/machineAuth', () => ({
    resolveClinicalApiActor: mocks.resolveClinicalApiActor,
}));

vi.mock('@/lib/vetios-inference', () => ({
    runInference: mocks.runInference,
}));

vi.mock('@/lib/vectorStore/vetVectorStore', () => ({
    getVectorStore: () => ({
        confirmOutcome: mocks.confirmOutcome,
    }),
}));

const tenantId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const requestId = '11111111-1111-4111-8111-111111111111';
const inferenceEventId = '44444444-4444-4444-8444-444444444444';
const outcomeEventId = '55555555-5555-4555-8555-555555555555';

describe('core API regression suite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CRON_SECRET = 'cron-secret';
        mocks.resolveClinicalApiActor.mockResolvedValue({
            actor: {
                tenantId,
                userId,
                scopes: ['*'],
            },
        });
        mocks.confirmOutcome.mockResolvedValue(undefined);
    });

    it('Inference route: valid payload returns 200 with inference_event_id and confidence_score', async () => {
        mocks.getSupabaseServer.mockReturnValue(createSupabaseMock(({ table, action }) => {
            if (table === 'ai_inference_events' && action === 'select') {
                return { data: null, error: null };
            }
            return { data: null, error: null };
        }));
        mocks.runInference.mockResolvedValue({
            inference_event_id: inferenceEventId,
            clinical_case_id: null,
            data: {
                confidence_score: 0.82,
                differentials: [{ label: 'canine_pancreatitis', p: 0.82 }],
            },
            output_payload: { confidence_score: 0.82 },
            latency_ms: 12,
            cire: { safety_state: 'pass' },
            meta: { tenant_id: tenantId, request_id: requestId },
        });

        const response = await inferencePost(jsonRequest('/api/inference', {
            request_id: requestId,
            model: { name: 'gpt-4o-mini', version: 'gpt-4o-mini' },
            input: {
                input_signature: {
                    species: 'canine',
                    symptoms: ['vomiting', 'abdominal pain'],
                },
            },
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.inference_event_id).toBe(inferenceEventId);
        expect(body.data.confidence_score).toBe(0.82);
    });

    it('Inference route: missing species field returns 400 with validation error', async () => {
        mocks.getSupabaseServer.mockReturnValue(createSupabaseMock(() => ({ data: null, error: null })));

        const response = await inferencePost(jsonRequest('/api/inference', {
            request_id: requestId,
            model: { name: 'gpt-4o-mini', version: 'gpt-4o-mini' },
            input: {
                input_signature: {
                    symptoms: ['vomiting'],
                },
            },
        }));
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('invalid_input');
        expect(body.detail).toContain('species');
    });

    it('Inference route: duplicate request_id returns 200 with idempotent cached response', async () => {
        mocks.getSupabaseServer.mockReturnValue(createSupabaseMock(({ table, action }) => {
            if (table === 'ai_inference_events' && action === 'select') {
                return {
                    data: {
                        id: inferenceEventId,
                        tenant_id: tenantId,
                        request_id: requestId,
                        case_id: null,
                        output_payload: { confidence_score: 0.73, differentials: [{ label: 'cached', p: 0.73 }] },
                        differentials: [{ label: 'cached', p: 0.73 }],
                        confidence_score: 0.73,
                        inference_latency_ms: 9,
                        cire: {},
                    },
                    error: null,
                };
            }
            return { data: null, error: null };
        }));

        const response = await inferencePost(jsonRequest('/api/inference', {
            request_id: requestId,
            model: { name: 'gpt-4o-mini', version: 'gpt-4o-mini' },
            input: {
                input_signature: {
                    species: 'canine',
                    symptoms: ['vomiting'],
                },
            },
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.inference_event_id).toBe(inferenceEventId);
        expect(body.meta.idempotent).toBe(true);
        expect(mocks.runInference).not.toHaveBeenCalled();
    });

    it('Outcome route: valid inference_event_id returns 200 with outcome_event_id', async () => {
        mocks.getSupabaseServer.mockReturnValue(createOutcomeSupabaseMock({ inferenceFound: true }));

        const response = await outcomePost(jsonRequest('/api/outcome', {
            request_id: requestId,
            inference_event_id: inferenceEventId,
            outcome: {
                type: 'confirmed_diagnosis',
                payload: {
                    label: 'canine_pancreatitis',
                    confidence: 0.9,
                },
                timestamp: '2026-05-22T12:00:00.000Z',
            },
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.outcome_event_id).toBe(outcomeEventId);
    });

    it('Outcome route: calibration write failure does not block confirmed outcome capture', async () => {
        mocks.getSupabaseServer.mockReturnValue(createOutcomeSupabaseMock({
            inferenceFound: true,
            labelCalibrationUpsertError: true,
        }));

        const response = await outcomePost(jsonRequest('/api/outcome', {
            request_id: requestId,
            inference_event_id: inferenceEventId,
            outcome: {
                type: 'confirmed_diagnosis',
                payload: {
                    label: 'canine_pancreatitis',
                    confidence: 0.9,
                },
                timestamp: '2026-05-22T12:00:00.000Z',
            },
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.outcome_event_id).toBe(outcomeEventId);
        expect(body.derived_updates.warnings.some((warning: string) =>
            warning.includes('label_calibration_update_failed'),
        )).toBe(true);
    });

    it('Outcome route: duplicate request_id at insert returns cached outcome', async () => {
        mocks.getSupabaseServer.mockReturnValue(createOutcomeSupabaseMock({
            inferenceFound: true,
            duplicateOutcomeInsert: true,
            cachedOutcomeAfterDuplicate: true,
        }));

        const response = await outcomePost(jsonRequest('/api/outcome', {
            request_id: requestId,
            inference_event_id: inferenceEventId,
            outcome: {
                type: 'confirmed_diagnosis',
                payload: {
                    label: 'canine_pancreatitis',
                    confidence: 0.9,
                },
                timestamp: '2026-05-22T12:00:00.000Z',
            },
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.outcome_event_id).toBe(outcomeEventId);
        expect(body.meta.idempotent).toBe(true);
    });

    it('Outcome route: unknown inference_event_id returns 404', async () => {
        mocks.getSupabaseServer.mockReturnValue(createOutcomeSupabaseMock({ inferenceFound: false }));

        const response = await outcomePost(jsonRequest('/api/outcome', {
            request_id: requestId,
            inference_event_id: inferenceEventId,
            outcome: {
                type: 'confirmed_diagnosis',
                payload: {
                    label: 'canine_pancreatitis',
                    confidence: 0.9,
                },
                timestamp: '2026-05-22T12:00:00.000Z',
            },
        }));
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe('not_found');
    });

    it('Outbox cron: pending event processes and marks delivered', async () => {
        const updates: Array<Record<string, unknown>> = [];
        mocks.getSupabaseServer.mockReturnValue(createOutboxSupabaseMock({
            row: {
                id: '66666666-6666-4666-8666-666666666666',
                event_type: 'test.event',
                payload: {},
                status: 'pending',
                attempt_count: 0,
            },
            updates,
        }));

        const response = await outboxFlushGet(new Request('https://vetios.test/api/cron/outbox-flush', {
            headers: { Authorization: 'Bearer cron-secret' },
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.delivered).toBe(1);
        expect(updates.some((update) => update.status === 'delivered' && update.delivered_at)).toBe(true);
    });

    it('Outbox cron: failed event at 5 attempts marks dead_lettered', async () => {
        const updates: Array<Record<string, unknown>> = [];
        mocks.getSupabaseServer.mockReturnValue(createOutboxSupabaseMock({
            row: {
                id: '77777777-7777-4777-8777-777777777777',
                event_type: 'test.event',
                payload: { force_failure: true },
                status: 'pending',
                attempt_count: 4,
            },
            updates,
        }));

        const response = await outboxFlushGet(new Request('https://vetios.test/api/cron/outbox-flush', {
            headers: { Authorization: 'Bearer cron-secret' },
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.dead_lettered).toBe(1);
        expect(updates.some((update) => update.status === 'dead_lettered' && update.attempt_count === 5)).toBe(true);
    });

    it('Immutability trigger: UPDATE on ai_inference_events is blocked by migration trigger', () => {
        const migration = readFileSync(
            repoPath('supabase/migrations/20260522_enforce_immutability.sql'),
            'utf8',
        );

        expect(migration).toContain('before update or delete on public.ai_inference_events');
        expect(migration).toContain('raise exception');
    });

    it('RLS policy regression: anon is denied core event updates', () => {
        const migration = readFileSync(
            repoPath('supabase/migrations/20260522002000_core_event_rls_lockdown.sql'),
            'utf8',
        );

        expect(migration).toContain('revoke insert, update, delete on table public.ai_inference_events from anon');
        expect(migration).toContain('grant select, insert, update, delete on table public.ai_inference_events to service_role');
    });

    it('Governance lineage migration: inference events require prompt/schema/CIRE lineage', () => {
        const migration = readFileSync(
            repoPath('supabase/migrations/20260523000000_inference_lineage_governance.sql'),
            'utf8',
        );

        expect(migration).toContain('add column if not exists prompt_template_hash text');
        expect(migration).toContain('add column if not exists schema_version text');
        expect(migration).toContain('add column if not exists phi_hat double precision');
        expect(migration).toContain('alter column prompt_template_hash set not null');
        expect(migration).toContain('ai_inference_events_phi_hat_range_check');
    });
});

function jsonRequest(path: string, body: unknown) {
    return new Request(`https://vetios.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function repoPath(relativePath: string) {
    return process.cwd().replace(/\\/g, '/').endsWith('/apps/web')
        ? join(process.cwd(), '..', '..', relativePath)
        : join(process.cwd(), relativePath);
}

function createOutcomeSupabaseMock(input: {
    inferenceFound: boolean;
    duplicateOutcomeInsert?: boolean;
    cachedOutcomeAfterDuplicate?: boolean;
    labelCalibrationUpsertError?: boolean;
}) {
    let outcomeSelectCount = 0;

    return createSupabaseMock(({ table, action }) => {
        if (table === 'clinical_outcome_events' && action === 'select') {
            outcomeSelectCount += 1;
            if (input.cachedOutcomeAfterDuplicate && outcomeSelectCount > 1) {
                return {
                    data: {
                        id: outcomeEventId,
                        tenant_id: tenantId,
                        request_id: requestId,
                        case_id: null,
                        inference_event_id: inferenceEventId,
                        outcome_type: 'confirmed_diagnosis',
                        outcome_payload: {
                            prediction_correct: true,
                            calibration_delta: 0.2,
                        },
                        actual_label: 'canine_pancreatitis',
                        actual_confidence: 0.9,
                        calibration_delta: 0.2,
                        created_at: '2026-05-22T12:00:00.000Z',
                    },
                    error: null,
                };
            }
            return { data: null, error: null };
        }
        if (table === 'ai_inference_events' && action === 'select') {
            return {
                data: input.inferenceFound
                    ? {
                        id: inferenceEventId,
                        tenant_id: tenantId,
                        user_id: userId,
                        case_id: null,
                        input_signature: {
                            species: 'canine',
                            symptoms: ['vomiting'],
                        },
                        output_payload: {
                            differentials: [{ label: 'canine_pancreatitis', p: 0.7 }],
                        },
                        confidence_score: 0.7,
                        model_version: 'gpt-4o-mini',
                    }
                    : null,
                error: null,
            };
        }
        if (table === 'clinical_outcome_events' && action === 'insert') {
            if (input.duplicateOutcomeInsert) {
                return {
                    data: null,
                    error: {
                        code: '23505',
                        message: 'duplicate key value violates unique constraint "idx_clinical_outcome_events_request_id"',
                    },
                };
            }
            return { data: { id: outcomeEventId }, error: null };
        }
        if (table === 'label_calibration' && action === 'select') {
            return { data: null, error: null };
        }
        if (table === 'label_calibration' && action === 'upsert') {
            if (input.labelCalibrationUpsertError) {
                return {
                    data: null,
                    error: {
                        code: '42P01',
                        message: 'relation "public.label_calibration" does not exist',
                    },
                };
            }
            return { data: null, error: null };
        }
        if (table === 'diagnosis_records' && action === 'insert') {
            return { data: { id: '88888888-8888-4888-8888-888888888888' }, error: null };
        }
        if (table === 'active_learning_queue' && action === 'update') {
            return { data: null, error: null };
        }
        return { data: null, error: null };
    });
}

function createOutboxSupabaseMock(input: {
    row: Record<string, unknown>;
    updates: Array<Record<string, unknown>>;
}) {
    let selected = false;

    return createSupabaseMock(({ table, action, payload, terminal }) => {
        if (table !== 'outbox_events') return { data: null, error: null };
        if (action === 'select' && terminal === 'then') {
            if (selected) return { data: [], error: null };
            selected = true;
            return { data: [input.row], error: null };
        }
        if (action === 'update') {
            input.updates.push(payload as Record<string, unknown>);
            if ((payload as Record<string, unknown>).status === 'processing') {
                return { data: { ...input.row, status: 'processing' }, error: null };
            }
            return { data: null, error: null };
        }
        return { data: null, error: null };
    });
}

function createSupabaseMock(
    handler: (operation: {
        table: string;
        action: string;
        payload?: unknown;
        terminal: 'then' | 'single' | 'maybeSingle';
        filters: Array<{ column: string; value: unknown }>;
    }) => { data: unknown; error: null | { message: string; code?: string } },
) {
    return {
        from(table: string) {
            return createBuilder({
                table,
                action: 'select',
                filters: [],
            }, handler);
        },
    };
}

function createBuilder(
    state: {
        table: string;
        action: string;
        payload?: unknown;
        filters: Array<{ column: string; value: unknown }>;
    },
    handler: Parameters<typeof createSupabaseMock>[0],
): any {
    const builder: any = {
        select() {
            return builder;
        },
        eq(column: string, value: unknown) {
            state.filters.push({ column, value });
            return builder;
        },
        in(column: string, value: unknown) {
            state.filters.push({ column, value });
            return builder;
        },
        order() {
            return builder;
        },
        limit() {
            return builder;
        },
        insert(payload: unknown) {
            state.action = 'insert';
            state.payload = payload;
            return builder;
        },
        update(payload: unknown) {
            state.action = 'update';
            state.payload = payload;
            return builder;
        },
        upsert(payload: unknown) {
            state.action = 'upsert';
            state.payload = payload;
            return builder;
        },
        maybeSingle() {
            return Promise.resolve(handler({ ...state, terminal: 'maybeSingle' }));
        },
        single() {
            return Promise.resolve(handler({ ...state, terminal: 'single' }));
        },
        then(onFulfilled: any, onRejected: any) {
            return Promise.resolve(handler({ ...state, terminal: 'then' })).then(onFulfilled, onRejected);
        },
    };

    return builder;
}
