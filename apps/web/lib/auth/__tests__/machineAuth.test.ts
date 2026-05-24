import { describe, expect, it } from 'vitest';
import {
    validateConnectorInstallationAccess,
    type ClinicalApiActor,
    type ConnectorInstallationRecord,
} from '../machineAuth';

describe('connector installation authorization', () => {
    it('allows a marketplace PIMS installation to use any supported passive connector type', () => {
        const actor = createConnectorActor({
            connector_type: 'recheck',
            vendor_name: 'ezyVet',
            vendor_account_ref: 'clinic-123',
            metadata: {
                passive_signal: {
                    supported_connector_types: ['recheck', 'referral', 'prescription_refill', 'imaging_report'],
                },
            },
        });

        expect(validateConnectorInstallationAccess({
            actor,
            connectorType: 'referral',
            vendorName: 'ezyvet',
            vendorAccountRef: 'clinic-123',
        })).toEqual({ ok: true });
    });

    it('rejects connector types outside the installation support set', () => {
        const actor = createConnectorActor({
            connector_type: 'recheck',
            vendor_name: 'ezyVet',
            vendor_account_ref: 'clinic-123',
            metadata: {
                passive_signal: {
                    supported_connector_types: ['recheck', 'referral'],
                },
            },
        });

        expect(validateConnectorInstallationAccess({
            actor,
            connectorType: 'lab_result',
            vendorName: 'ezyVet',
            vendorAccountRef: 'clinic-123',
        })).toMatchObject({
            ok: false,
            status: 403,
        });
    });
});

function createConnectorActor(
    patch: Partial<ConnectorInstallationRecord>,
): ClinicalApiActor {
    const installation: ConnectorInstallationRecord = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        installation_name: 'ezyVet Clinic Ops',
        connector_type: 'recheck',
        vendor_name: null,
        vendor_account_ref: null,
        status: 'active',
        metadata: {},
        created_by: null,
        last_used_at: null,
        created_at: '2026-05-23T00:00:00.000Z',
        updated_at: '2026-05-23T00:00:00.000Z',
        ...patch,
    };

    return {
        tenantId: installation.tenant_id,
        userId: null,
        authMode: 'connector_installation',
        scopes: ['signals:connect'],
        credentialId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        principalLabel: installation.installation_name,
        serviceAccountId: null,
        connectorInstallation: installation,
    };
}
