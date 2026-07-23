import { describe, expect, it } from 'vitest';
import {
    evaluateApiCredentialUsePolicy,
    normalizeMachineCredentialScopes,
    validateConnectorInstallationAccess,
    type ApiCredentialRecord,
    type ClinicalApiActor,
    type ConnectorInstallationRecord,
} from '../machineAuth';

describe('machine credential scopes', () => {
    it('keeps federation node and secure aggregation scopes available for live partner nodes', () => {
        expect(normalizeMachineCredentialScopes([
            'federation:read',
            'federation:node',
            'secure_aggregation:write',
            'unsupported:scope',
        ])).toEqual([
            'federation:read',
            'federation:node',
            'secure_aggregation:write',
        ]);
    });
});

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

describe('API credential binding controls', () => {
    it('allows a credential when environment, origin, and CIDR bindings match', () => {
        const decision = evaluateApiCredentialUsePolicy(
            apiCredential({
                deployment_environment: 'production',
                allowed_origins: ['https://partner.example'],
                allowed_ip_cidrs: ['203.0.113.0/24'],
            }),
            new Request('https://vetios.test/api/signals/ingest', {
                headers: {
                    origin: 'https://partner.example',
                    'x-forwarded-for': '203.0.113.42',
                },
            }),
            'production',
        );

        expect(decision.allowed).toBe(true);
        expect(decision.blockers).toEqual([]);
    });

    it('blocks credential use when binding controls are violated', () => {
        const decision = evaluateApiCredentialUsePolicy(
            apiCredential({
                deployment_environment: 'production',
                allowed_origins: ['https://partner.example'],
                allowed_ip_cidrs: ['203.0.113.10'],
                rotation_due_at: '2020-01-01T00:00:00.000Z',
            }),
            new Request('https://vetios.test/api/signals/ingest', {
                headers: {
                    origin: 'https://unexpected.example',
                    'x-forwarded-for': '198.51.100.4',
                },
            }),
            'staging',
        );

        expect(decision.allowed).toBe(false);
        expect(decision.riskLevel).toBe('critical');
        expect(decision.blockers).toEqual([
            'credential_environment_mismatch',
            'credential_origin_not_allowed',
            'credential_ip_not_allowed',
            'credential_rotation_overdue',
        ]);
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
        role: null,
        assuranceLevel: 'workload_identity',
    };
}

function apiCredential(patch: Partial<ApiCredentialRecord>): ApiCredentialRecord {
    return {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        tenant_id: 'tenant_1',
        principal_type: 'service_account',
        service_account_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        connector_installation_id: null,
        label: 'Partner credential',
        key_prefix: 'vetios_sa_deadbeef',
        key_hash: 'a'.repeat(64),
        scopes: ['signals:ingest'],
        status: 'active',
        expires_at: null,
        deployment_environment: null,
        allowed_origins: [],
        allowed_ip_cidrs: [],
        rotation_due_at: null,
        risk_score: 0,
        last_risk_event_at: null,
        metadata: {},
        created_by: null,
        revoked_by: null,
        last_used_at: null,
        created_at: '2026-07-12T00:00:00.000Z',
        revoked_at: null,
        ...patch,
    };
}
