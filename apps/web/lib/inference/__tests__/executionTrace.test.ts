import { describe, expect, it } from 'vitest';
import {
    createInferenceExecutionTraceContext,
    digestUnknown,
    sanitizeTraceMetadata,
} from '../executionTrace';

describe('inference execution trace ledger', () => {
    it('redacts clinical and identity-bearing metadata keys', () => {
        const sanitized = sanitizeTraceMetadata({
            feature_count: 4,
            patient_name: 'Bella',
            owner_email: 'owner@example.com',
            raw_symptom_text: 'vomiting and diarrhea',
            nested: {
                contact_phone: '+1 555 123 4567',
                safe_flag: true,
            },
        });

        expect(sanitized).toEqual({
            feature_count: 4,
            nested: {
                safe_flag: true,
            },
        });
    });

    it('writes privacy-preserving trace rows with input and output digests', async () => {
        const rows: Array<Record<string, unknown>> = [];
        const client = {
            from: () => ({
                insert: async (payload: Array<Record<string, unknown>>) => {
                    rows.push(...payload);
                    return { error: null };
                },
            }),
        };
        const trace = createInferenceExecutionTraceContext({
            tenantId: 'tenant_1',
            requestId: '018f3ac0-4dd6-4efb-9ac5-b5d0e7fba001',
            sourceModule: 'clinical_api',
            modelName: 'VetIOS Diagnostics',
            modelVersion: 'latest',
            providerName: 'vetios-clinical-engine',
            schemaVersion: 'v1',
            inputDigestSource: { species: 'canine', symptoms: ['vomiting'] },
        });

        trace.recordCompleted('graph_priors', 'Knowledge graph prior enrichment', {
            graph_priors_enabled: true,
            patient_ref: 'clinic-patient-001',
        });
        await trace.flush(client as never, {
            inferenceEventId: '018f3ac0-4dd6-4efb-9ac5-b5d0e7fba002',
            ranker: 'classical',
            outputDigestSource: { top: 'Parvovirus' },
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            tenant_id: 'tenant_1',
            request_id: '018f3ac0-4dd6-4efb-9ac5-b5d0e7fba001',
            inference_event_id: '018f3ac0-4dd6-4efb-9ac5-b5d0e7fba002',
            stage_key: 'graph_priors',
            stage_status: 'completed',
            ranker: 'classical',
        });
        expect(rows[0]?.input_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(rows[0]?.output_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(rows[0]?.stage_metadata).toEqual({ graph_priors_enabled: true });
    });

    it('records failed stages without leaking raw contacts in error text', async () => {
        const rows: Array<Record<string, unknown>> = [];
        const client = {
            from: () => ({
                insert: async (payload: Array<Record<string, unknown>>) => {
                    rows.push(...payload);
                    return { error: null };
                },
            }),
        };
        const trace = createInferenceExecutionTraceContext({
            tenantId: 'tenant_1',
            requestId: '018f3ac0-4dd6-4efb-9ac5-b5d0e7fba003',
            sourceModule: 'clinical_api',
        });

        await expect(trace.measure(
            'clinical_inference_persist',
            'Clinical inference and persistence',
            async () => {
                throw new Error('Failed for john@example.com at +1 555 123 4567');
            },
            { raw_text: 'do not store this' },
        )).rejects.toThrow('Failed for');

        await trace.flush(client as never);
        const metadata = rows[0]?.stage_metadata as Record<string, unknown>;
        const error = metadata.error as Record<string, unknown>;

        expect(rows[0]?.stage_status).toBe('failed');
        expect(metadata.raw_text).toBeUndefined();
        expect(error.message).toBe('Failed for [email] at [phone]');
    });

    it('creates stable sha256 digests independent of object key order', () => {
        expect(digestUnknown({ b: 2, a: 1 })).toBe(digestUnknown({ a: 1, b: 2 }));
    });
});
