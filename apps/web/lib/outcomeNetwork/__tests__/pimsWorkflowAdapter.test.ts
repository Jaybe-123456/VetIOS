import { describe, expect, it } from 'vitest';
import {
    PassiveConnectorBatchIngestRequestSchema,
    PassiveConnectorIngestRequestSchema,
} from '@/lib/http/schemas';
import { resolvePassiveConnectorWorkflow } from '../pimsWorkflowAdapter';

describe('PIMS workflow adapter', () => {
    it('maps ezyVet appointment events into recheck connector payloads', () => {
        const result = resolvePassiveConnectorWorkflow({
            vendorName: 'ezyVet',
            vendorEventType: 'appointment.completed',
            payload: {
                appointment_status: 'completed',
                start_at: '2026-05-23T15:00:00.000Z',
                reason: 'IMHA follow-up recheck',
                primary_condition_class: 'hematologic',
            },
        });

        expect(result.connectorType).toBe('recheck');
        expect(result.normalizedBy).toBe('pims_workflow_adapter');
        expect(result.payload.status).toBe('completed');
        expect(result.payload.scheduled_for).toBe('2026-05-23T15:00:00.000Z');
        expect(result.payload.primary_condition_class).toBe('hematologic');
        expect(result.payload.vendor_workflow).toMatchObject({
            vendor_name: 'ezyVet',
            event_type: 'appointment.completed',
            normalized_by: 'pims_workflow_adapter',
        });
    });

    it('maps Covetrus pharmacy events into prescription refill payloads', () => {
        const result = resolvePassiveConnectorWorkflow({
            vendorName: 'Covetrus',
            vendorEventType: 'pharmacy.refill_requested',
            payload: {
                product: { name: 'Prednisone' },
                days_remaining: '0',
                overdue: 'true',
            },
        });

        expect(result.connectorType).toBe('prescription_refill');
        expect(result.payload.medication).toBe('Prednisone');
        expect(result.payload.status).toBe('requested');
        expect(result.payload.days_remaining).toBe(0);
        expect(result.payload.overdue).toBe(true);
    });

    it('leaves explicit connector payloads in the legacy path', () => {
        const payload = { modality: 'radiograph', abnormal: true };
        const result = resolvePassiveConnectorWorkflow({
            connectorType: 'imaging_report',
            vendorName: 'Smart Flow',
            payload,
        });

        expect(result.connectorType).toBe('imaging_report');
        expect(result.normalizedBy).toBe('explicit_connector_type');
        expect(result.payload).toBe(payload);
    });

    it('requires an inferable workflow event when connector_type is omitted', () => {
        expect(() => resolvePassiveConnectorWorkflow({
            vendorName: 'Unknown PIMS',
            payload: { status: 'created' },
        })).toThrow(/could not be mapped/);
    });

    it('accepts workflow_event_type payloads in the connector ingest schema', () => {
        const parsed = PassiveConnectorIngestRequestSchema.safeParse({
            connector: {
                workflow_event_type: 'appointment.completed',
                vendor_name: 'ezyVet',
                payload: {
                    appointment_status: 'completed',
                },
            },
        });

        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.connector.connector_type).toBeUndefined();
    });

    it('accepts mixed workflow batches for adapter runtime submissions', () => {
        const parsed = PassiveConnectorBatchIngestRequestSchema.safeParse({
            connector_batch: {
                batch_id: 'adapter-run-20260627-001',
                vendor_name: 'ezyVet',
                vendor_account_ref: 'clinic-fleet-7',
                clinic_id: 'clinic-7',
                auto_reconcile: false,
                events: [
                    {
                        workflow_event_type: 'appointment.completed',
                        patient_id: '11111111-1111-4111-8111-111111111111',
                        payload: {
                            appointment_status: 'completed',
                            completed: true,
                            resolved: true,
                        },
                    },
                    {
                        connector_type: 'lab_result',
                        vendor_name: 'IDEXX',
                        patient_id: '22222222-2222-4222-8222-222222222222',
                        payload: {
                            source_format: 'hl7_v2_oru',
                            test_name: 'Urine culture',
                            abnormal_flag: 'H',
                        },
                    },
                ],
            },
        });

        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.connector_batch.events).toHaveLength(2);
        expect(parsed.success && parsed.data.connector_batch.events[0].auto_reconcile).toBeUndefined();
    });
});
