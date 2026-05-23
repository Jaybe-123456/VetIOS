import { describe, expect, it } from 'vitest';
import { upsertTenantLearningConsent } from '../consent';

describe('tenant learning consent service', () => {
    it('writes a granted deidentified-training consent with actor lineage', async () => {
        const upserts: Array<Record<string, unknown>> = [];
        const client = {
            from: (table: string) => {
                expect(table).toBe('tenant_learning_consents');
                return {
                    upsert: (payload: Record<string, unknown>) => {
                        upserts.push(payload);
                        return {
                            select: () => ({
                                single: () => Promise.resolve({
                                    data: { id: 'consent_1', created_at: 'now', ...payload },
                                    error: null,
                                }),
                            }),
                        };
                    },
                };
            },
        } as any;

        const record = await upsertTenantLearningConsent(client, {
            tenantId: 'tenant_1',
            actorUserId: 'user_1',
            consentScope: 'deidentified_training',
            status: 'granted',
            policySnapshot: { policy: 'clinic_partner_v1' },
        });

        expect(upserts[0]).toMatchObject({
            tenant_id: 'tenant_1',
            consent_scope: 'deidentified_training',
            status: 'granted',
            consent_version: 'vetios_learning_consent_v1',
            granted_by: 'user_1',
            revoked_by: null,
            revoked_at: null,
            policy_snapshot: { policy: 'clinic_partner_v1' },
        });
        expect(record.status).toBe('granted');
        expect(record.granted_by).toBe('user_1');
    });
});
