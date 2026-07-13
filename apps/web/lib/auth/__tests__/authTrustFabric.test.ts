import { describe, expect, it } from 'vitest';
import {
    authorizeVetiosAction,
    hashTrustSurfaceValue,
    writeAuthorizationDecisionEvent,
    writeHighRiskOperationChallengeEvent,
    type AuthTrustInsertClient,
} from '../authTrustFabric';

describe('auth trust fabric', () => {
    it('allows scoped machine credentials to write clinical inference events', () => {
        const packet = authorizeVetiosAction({
            tenantId: 'tenant_1',
            requestId: 'req_inference_1',
            actionKey: 'clinical.inference.write',
            resource: { type: 'clinical_case', id: 'case_1', tenantId: 'tenant_1' },
            subject: {
                type: 'service_account',
                authMode: 'service_account',
                credentialId: 'credential_1',
                subjectRef: 'service_account_1',
                grantedScopes: ['inference:write'],
                assuranceLevel: 'session',
            },
        });

        expect(packet.decision).toBe('allow');
        expect(packet.actionCategory).toBe('clinical_inference');
        expect(packet.blockers).toEqual([]);
        expect(packet.reasons).toContain('all_policy_requirements_satisfied');
    });

    it('challenges high-risk session users when recent MFA assurance is missing', () => {
        const packet = authorizeVetiosAction({
            tenantId: 'tenant_1',
            requestId: 'req_export_1',
            actionKey: 'dataset.export',
            resource: { type: 'dataset', id: 'dataset_1', tenantId: 'tenant_1' },
            subject: {
                type: 'session_user',
                authMode: 'session',
                userId: '00000000-0000-4000-8000-000000000001',
                role: 'admin',
                grantedScopes: ['*'],
                assuranceLevel: 'session',
            },
        });

        expect(packet.decision).toBe('challenge');
        expect(packet.riskLevel).toBe('critical');
        expect(packet.requiredAssuranceLevel).toBe('mfa');
        expect(packet.challengeType).toBe('mfa');
        expect(packet.blockers).toContain('assurance_too_low:session->mfa');
    });

    it('denies dev bypass in production even when the action is otherwise low risk', () => {
        const packet = authorizeVetiosAction({
            tenantId: 'tenant_1',
            requestId: 'req_dev_bypass_1',
            actionKey: 'clinical.inference.write',
            environment: 'production',
            resource: { type: 'clinical_case', id: 'case_1', tenantId: 'tenant_1' },
            subject: {
                type: 'dev_bypass',
                authMode: 'dev_bypass',
                grantedScopes: ['*'],
                assuranceLevel: 'anonymous',
            },
        });

        expect(packet.decision).toBe('deny');
        expect(packet.blockers).toContain('dev_bypass_forbidden_in_production');
    });

    it('denies machine actors when required scopes are missing', () => {
        const packet = authorizeVetiosAction({
            tenantId: 'tenant_1',
            requestId: 'req_scope_1',
            actionKey: 'federation.secure_aggregation.admin',
            resource: { type: 'federation', id: 'fed_1', tenantId: 'tenant_1' },
            subject: {
                type: 'service_account',
                authMode: 'service_account',
                subjectRef: 'service_account_1',
                grantedScopes: ['federation:read'],
                assuranceLevel: 'session',
            },
        });

        expect(packet.decision).toBe('deny');
        expect(packet.blockers).toContain('missing_scopes:secure_aggregation:write,federation:admin');
        expect(packet.blockers).toContain('assurance_too_low:session->workload_identity');
    });

    it('records authorization decisions and high-risk challenges to the correct ledgers', async () => {
        const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
        const client: AuthTrustInsertClient = {
            from(table: string) {
                return {
                    async insert(payload: Record<string, unknown>) {
                        writes.push({ table, payload });
                        return { error: null };
                    },
                };
            },
        };

        const packet = authorizeVetiosAction({
            tenantId: 'tenant_1',
            requestId: 'req_export_2',
            actionKey: 'dataset.export',
            resource: { type: 'dataset', id: 'dataset_1', tenantId: 'tenant_1' },
            subject: {
                type: 'session_user',
                authMode: 'session',
                userId: '00000000-0000-4000-8000-000000000001',
                role: 'admin',
                grantedScopes: ['*'],
                assuranceLevel: 'recent_auth',
            },
        });

        await writeAuthorizationDecisionEvent(client, packet);
        await writeHighRiskOperationChallengeEvent(client, packet, {
            expiresAt: '2026-07-12T12:15:00.000Z',
        });

        expect(writes).toHaveLength(2);
        expect(writes[0]).toMatchObject({
            table: 'authorization_decision_events',
            payload: {
                tenant_id: 'tenant_1',
                request_id: 'req_export_2',
                action_key: 'dataset.export',
                decision: 'challenge',
                required_assurance_level: 'mfa',
            },
        });
        expect(writes[1]).toMatchObject({
            table: 'high_risk_operation_challenge_events',
            payload: {
                tenant_id: 'tenant_1',
                request_id: 'req_export_2',
                action_key: 'dataset.export',
                challenge_type: 'mfa',
                challenge_status: 'required',
            },
        });
    });

    it('hashes request-surface values without storing raw IPs or user agents', () => {
        expect(hashTrustSurfaceValue('203.0.113.10')).toMatch(/^[a-f0-9]{64}$/);
        expect(hashTrustSurfaceValue('')).toBeNull();
    });
});
