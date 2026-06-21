import { describe, expect, it } from 'vitest';
import type { ClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    contributionRoleForTaskType,
    resolveFederationNodeIdentity,
} from '@/lib/federation/nodeRuntime';

describe('federation node runtime', () => {
    it('normalizes explicit node and partner references for live node calls', () => {
        const identity = resolveFederationNodeIdentity({
            actor: actor(),
            federationKey: 'One_Health_AMR',
            nodeRef: ' Clinic Node / A ',
            partnerRef: ' Partner@Clinic ',
        });

        expect(identity).toEqual({
            tenantId: '11111111-1111-4111-8111-111111111111',
            federationKey: 'one_health_amr',
            nodeRef: 'clinic_node_a',
            partnerRef: 'partner@clinic',
        });
    });

    it('falls back to service-account identity when node_ref is omitted', () => {
        const identity = resolveFederationNodeIdentity({
            actor: actor({
                serviceAccountId: 'fed-node-service-account',
                principalLabel: 'Federation Node API',
            }),
            federationKey: 'one_health_amr',
        });

        expect(identity.nodeRef).toBe('fed-node-service-account');
        expect(identity.partnerRef).toBe('federation_node_api');
    });

    it('maps node task types to update contribution roles', () => {
        expect(contributionRoleForTaskType('diagnosis_delta')).toBe('diagnosis');
        expect(contributionRoleForTaskType('severity_delta')).toBe('severity');
        expect(contributionRoleForTaskType('support_summary')).toBe('support');
        expect(contributionRoleForTaskType('secure_aggregation_key')).toBe('support');
        expect(contributionRoleForTaskType('unmask_share')).toBe('unmask_share');
    });
});

function actor(overrides: Partial<ClinicalApiActor> = {}): ClinicalApiActor {
    return {
        tenantId: '11111111-1111-4111-8111-111111111111',
        userId: null,
        authMode: 'service_account',
        scopes: ['federation:node', 'secure_aggregation:write'],
        credentialId: 'credential-001',
        principalLabel: 'Default Federation Node',
        serviceAccountId: null,
        connectorInstallation: null,
        ...overrides,
    };
}
