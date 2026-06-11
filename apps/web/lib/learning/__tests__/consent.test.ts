import { describe, expect, it } from 'vitest';
import { listTenantLearningConsents, upsertTenantLearningConsent } from '../consent';

describe('tenant learning consent service', () => {
    it('writes a granted deidentified-training consent with actor lineage', async () => {
        const upserts: Array<Record<string, unknown>> = [];
        const events: Array<Record<string, unknown>> = [];
        const tenantInserts: Array<Record<string, unknown>> = [];
        const client = {
            from: (table: string) => {
                if (table === 'tenants') {
                    const tenantQuery: any = {};
                    tenantQuery.eq = () => tenantQuery;
                    tenantQuery.maybeSingle = () => Promise.resolve({ data: null, error: null });
                    return {
                        select: () => tenantQuery,
                        insert: (payload: Record<string, unknown>) => {
                            tenantInserts.push(payload);
                            return Promise.resolve({ error: null });
                        },
                    };
                }

                if (table === 'tenant_learning_consent_events') {
                    return {
                        insert: (payload: Record<string, unknown>) => {
                            events.push(payload);
                            return Promise.resolve({ error: null });
                        },
                    };
                }

                expect(table).toBe('tenant_learning_consents');
                const previousQuery: any = {};
                previousQuery.eq = () => previousQuery;
                previousQuery.maybeSingle = () => Promise.resolve({
                        data: {
                            id: 'consent_previous',
                            tenant_id: 'tenant_1',
                            consent_scope: 'deidentified_training',
                            status: 'revoked',
                            consent_version: 'vetios_learning_consent_v1',
                            granted_by: null,
                            revoked_by: 'user_0',
                            policy_snapshot: {},
                            granted_at: null,
                            revoked_at: 'before',
                            created_at: 'before',
                            updated_at: 'before',
                        },
                        error: null,
                    });

                return {
                    select: () => previousQuery,
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
        expect(tenantInserts[0]).toMatchObject({
            id: 'tenant_1',
            settings: {
                source: 'learning_consent_upsert',
                tenant_model: 'v1_auth_user_id',
                created_for_fk_integrity: true,
            },
        });
        expect(record.status).toBe('granted');
        expect(record.granted_by).toBe('user_1');
        expect(events[0]).toMatchObject({
            tenant_id: 'tenant_1',
            consent_id: 'consent_1',
            consent_scope: 'deidentified_training',
            status: 'granted',
            previous_status: 'revoked',
            consent_version: 'vetios_learning_consent_v1',
            actor_user_id: 'user_1',
            event_source: 'clinical_dataset_network_learning_panel',
            policy_snapshot: { policy: 'clinic_partner_v1' },
        });
    });

    it('returns a migration-specific error when the consent table is missing', async () => {
        const client = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        order: () => Promise.resolve({
                            data: null,
                            error: {
                                code: 'PGRST205',
                                message: "Could not find the table 'public.tenant_learning_consents' in the schema cache",
                            },
                        }),
                    }),
                }),
            }),
        } as any;

        await expect(listTenantLearningConsents(client, 'tenant_1')).rejects.toThrow(
            'Apply supabase/migrations/20260609010000_tenant_learning_consents_repair.sql',
        );
    });

    it('does not mislabel permission or RLS errors as missing storage', async () => {
        const client = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        order: () => Promise.resolve({
                            data: null,
                            error: {
                                code: '42501',
                                message: 'permission denied for table tenant_learning_consents',
                            },
                        }),
                    }),
                }),
            }),
        } as any;

        await expect(listTenantLearningConsents(client, 'tenant_1')).rejects.toThrow(
            'Failed to list tenant learning consents: permission denied for table tenant_learning_consents',
        );
    });
});
