import { describe, expect, it } from 'vitest';
import { PassiveConnectorIngestRequestSchema } from '@/lib/http/schemas';
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
});
