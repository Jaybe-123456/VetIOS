import { describe, expect, it } from 'vitest';
import type { RouteAuthorizationContext } from '../authorization';
import {
    buildAuthTrustSubjectFromClinicalActor,
    buildAuthTrustSubjectFromPlatformActor,
    buildAuthTrustSubjectFromRouteContext,
    enforceVetiosClinicalActorGate,
    enforceVetiosHighRiskRouteGate,
    enforceVetiosPlatformActorGate,
    mapDeveloperPlatformActionToAuthTrustAction,
    mapFederationActionToAuthTrustAction,
    mapMachineAuthActionToAuthTrustAction,
    mapSettingsControlPlaneActionToAuthTrustAction,
    resolveUserAssuranceLevel,
} from '../authTrustRouteGate';
import type { AuthTrustInsertClient } from '../authTrustFabric';
import type { ClinicalApiActor } from '../machineAuth';

describe('auth trust route gate', () => {
    it('challenges high-risk session routes when MFA assurance is absent', async () => {
        const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
        const result = await enforceVetiosHighRiskRouteGate({
            client: captureClient(writes),
            requestId: 'req_gate_1',
            context: routeContext({
                role: 'admin',
                app_metadata: {},
            }),
            actionKey: 'api_credential.create',
            resource: { type: 'api_credential', tenantId: 'tenant_1' },
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(428);
            const body = await result.response.json();
            expect(body.code).toBe('VETIOS_STEP_UP_REQUIRED');
            expect(body.auth_trust.required_assurance_level).toBe('mfa');
        }
        expect(writes.map((write) => write.table)).toEqual([
            'authorization_decision_events',
            'high_risk_operation_challenge_events',
        ]);
    });

    it('allows high-risk session routes when MFA assurance is present', async () => {
        const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
        const result = await enforceVetiosHighRiskRouteGate({
            client: captureClient(writes),
            requestId: 'req_gate_2',
            context: routeContext({
                role: 'admin',
                app_metadata: { vetios_assurance_level: 'mfa' },
            }),
            actionKey: 'api_credential.create',
            resource: { type: 'api_credential', tenantId: 'tenant_1' },
        });

        expect(result.ok).toBe(true);
        expect(result.packet.decision).toBe('allow');
        expect(writes).toHaveLength(1);
        expect(writes[0].payload).toMatchObject({
            action_key: 'api_credential.create',
            decision: 'allow',
            assurance_level: 'mfa',
        });
    });

    it('uses live session assurance when metadata has no MFA marker', async () => {
        const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
        const result = await enforceVetiosHighRiskRouteGate({
            client: captureClient(writes),
            requestId: 'req_gate_live_aal2',
            context: routeContext({
                role: 'admin',
                app_metadata: {},
            }),
            assuranceLevel: 'mfa',
            actionKey: 'api_credential.create',
            resource: { type: 'oauth_client', tenantId: 'tenant_1' },
        });

        expect(result.ok).toBe(true);
        expect(result.packet).toMatchObject({
            decision: 'allow',
            assuranceLevel: 'mfa',
        });
        expect(writes[0]?.payload).toMatchObject({
            decision: 'allow',
            assurance_level: 'mfa',
        });
    });

    it('allows internal workload identity for secure aggregation admin actions', async () => {
        const result = await enforceVetiosHighRiskRouteGate({
            client: captureClient([]),
            requestId: 'req_gate_3',
            context: routeContext({
                authMode: 'internal_token',
                role: 'admin',
                user: null,
            }),
            actionKey: 'federation.secure_aggregation.admin',
            resource: { type: 'federation_round', id: 'round_1', tenantId: 'tenant_1' },
        });

        expect(result.ok).toBe(true);
        expect(result.packet.assuranceLevel).toBe('workload_identity');
    });

    it('allows scoped machine actors to run ontology provider ingestion', async () => {
        const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
        const result = await enforceVetiosClinicalActorGate({
            client: captureClient(writes),
            requestId: 'req_gate_4',
            actor: clinicalActor({
                authMode: 'service_account',
                scopes: ['rag:write'],
                credentialId: '00000000-0000-4000-8000-000000000002',
                serviceAccountId: '00000000-0000-4000-8000-000000000003',
            }),
            actionKey: 'ontology.provider.ingest',
            resource: { type: 'ontology_provider', id: 'ncbi_pubmed', tenantId: 'tenant_1' },
        });

        expect(result.ok).toBe(true);
        expect(result.packet).toMatchObject({
            subjectType: 'service_account',
            actionKey: 'ontology.provider.ingest',
            assuranceLevel: 'workload_identity',
            decision: 'allow',
        });
        expect(writes).toHaveLength(1);
    });

    it('allows workload-identity platform actors to export simulation datasets', async () => {
        const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
        const result = await enforceVetiosPlatformActorGate({
            client: captureClient(writes),
            requestId: 'req_platform_export_1',
            actor: {
                userId: null,
                tenantId: 'tenant_1',
                role: 'tenant_user',
                authMode: 'oauth_client',
                scopes: ['simulation:write'],
                tenantScope: null,
            },
            tenantId: 'tenant_1',
            actionKey: 'dataset.simulation.export',
            resource: { type: 'simulation_export', id: 'sim_1', tenantId: 'tenant_1' },
        });

        expect(result.ok).toBe(true);
        expect(result.packet).toMatchObject({
            subjectType: 'oauth_client',
            actionKey: 'dataset.simulation.export',
            assuranceLevel: 'workload_identity',
            decision: 'allow',
        });
        expect(writes).toHaveLength(1);
    });

    it('denies session actors for workload-only ontology ingestion', async () => {
        const result = await enforceVetiosClinicalActorGate({
            client: captureClient([]),
            requestId: 'req_gate_5',
            actor: clinicalActor({ authMode: 'session', scopes: ['*'] }),
            actionKey: 'ontology.provider.ingest',
            resource: { type: 'ontology_provider', id: 'ncbi_pubmed', tenantId: 'tenant_1' },
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(403);
            expect(result.packet.blockers).toContain('assurance_too_low:session->workload_identity');
        }
    });

    it('resolves user assurance from explicit metadata, AMR, and recent-auth markers', () => {
        expect(resolveUserAssuranceLevel(user({ app_metadata: { aal: 'aal2' } }))).toBe('mfa');
        expect(resolveUserAssuranceLevel(user({ app_metadata: { amr: ['pwd', 'webauthn'] } }))).toBe('passkey');
        expect(resolveUserAssuranceLevel(user({
            app_metadata: { recent_auth_at: new Date().toISOString() },
        }))).toBe('recent_auth');
        expect(resolveUserAssuranceLevel(user({}))).toBe('session');
    });

    it('maps high-risk route actions to Auth Trust Fabric action keys', () => {
        expect(mapMachineAuthActionToAuthTrustAction('create_service_account')).toBe('api_credential.create');
        expect(mapMachineAuthActionToAuthTrustAction('revoke_api_credential')).toBe('api_credential.revoke');
        expect(mapDeveloperPlatformActionToAuthTrustAction('approve_onboarding_request')).toBe('api_credential.create');
        expect(mapSettingsControlPlaneActionToAuthTrustAction('registry_action')).toBe('model.promotion.approve');
        expect(mapSettingsControlPlaneActionToAuthTrustAction('reindex_dataset')).toBe('infrastructure.control.write');
        expect(mapFederationActionToAuthTrustAction('finalize_secure_aggregation')).toBe('federation.secure_aggregation.admin');
        expect(mapFederationActionToAuthTrustAction('set_governance')).toBe('federation.settings.write');
    });

    it('builds route subjects from authorization context without exposing raw session tokens', () => {
        const subject = buildAuthTrustSubjectFromRouteContext(routeContext({
            app_metadata: { aal: 'aal2' },
        }));

        expect(subject).toMatchObject({
            type: 'session_user',
            authMode: 'session',
            userId: '00000000-0000-4000-8000-000000000001',
            assuranceLevel: 'mfa',
            grantedScopes: ['*'],
        });
    });

    it('builds clinical actor subjects without storing raw API credentials', () => {
        const subject = buildAuthTrustSubjectFromClinicalActor(clinicalActor({
            authMode: 'connector_installation',
            scopes: ['signals:ingest', 'rag:write'],
            credentialId: '00000000-0000-4000-8000-000000000004',
        }));

        expect(subject).toMatchObject({
            type: 'connector_installation',
            authMode: 'connector_installation',
            credentialId: '00000000-0000-4000-8000-000000000004',
            assuranceLevel: 'workload_identity',
            grantedScopes: ['signals:ingest', 'rag:write'],
        });
    });

    it('builds platform actor subjects for trusted edge and OAuth export paths', () => {
        expect(buildAuthTrustSubjectFromPlatformActor({
            userId: 'platform-controller',
            tenantId: null,
            role: 'system_admin',
            authMode: 'jwt',
            scopes: [],
            tenantScope: null,
        })).toMatchObject({
            type: 'internal_service',
            authMode: 'internal_token',
            role: 'admin',
            assuranceLevel: 'workload_identity',
            grantedScopes: ['*'],
        });

        expect(buildAuthTrustSubjectFromPlatformActor({
            userId: null,
            tenantId: 'tenant_1',
            role: 'tenant_user',
            authMode: 'oauth_client',
            scopes: ['simulation:write'],
            tenantScope: null,
        })).toMatchObject({
            type: 'oauth_client',
            authMode: 'oauth_client',
            assuranceLevel: 'workload_identity',
            grantedScopes: ['simulation:write'],
        });
    });
});

function captureClient(writes: Array<{ table: string; payload: Record<string, unknown> }>): AuthTrustInsertClient {
    return {
        from(table: string) {
            return {
                async insert(payload: Record<string, unknown>) {
                    writes.push({ table, payload });
                    return { error: null };
                },
            };
        },
    };
}

function routeContext(input: {
    authMode?: RouteAuthorizationContext['authMode'];
    role?: RouteAuthorizationContext['role'];
    user?: RouteAuthorizationContext['user'];
    app_metadata?: Record<string, unknown>;
}): RouteAuthorizationContext {
    return {
        tenantId: 'tenant_1',
        userId: '00000000-0000-4000-8000-000000000001',
        authMode: input.authMode ?? 'session',
        role: input.role ?? 'admin',
        user: input.user === undefined ? user({ app_metadata: input.app_metadata ?? {} }) : input.user,
        permissionSet: {
            can_manage_profile: true,
            can_manage_api_keys: true,
            can_manage_models: true,
            can_manage_configuration: true,
            can_manage_infrastructure: true,
            can_run_debug_tools: true,
            can_run_simulations: true,
            can_view_governance: true,
            can_view_alerts: true,
        },
    };
}

function clinicalActor(input: {
    authMode: ClinicalApiActor['authMode'];
    scopes: ClinicalApiActor['scopes'];
    credentialId?: string | null;
    serviceAccountId?: string | null;
}): ClinicalApiActor {
    return {
        tenantId: 'tenant_1',
        userId: input.authMode === 'session' ? '00000000-0000-4000-8000-000000000001' : null,
        authMode: input.authMode,
        scopes: input.scopes,
        credentialId: input.credentialId ?? null,
        principalLabel: 'test_principal',
        serviceAccountId: input.serviceAccountId ?? null,
        connectorInstallation: input.authMode === 'connector_installation'
            ? {
                id: '00000000-0000-4000-8000-000000000005',
                tenant_id: 'tenant_1',
                installation_name: 'Lab connector',
                connector_type: 'lab',
                vendor_name: null,
                vendor_account_ref: null,
                status: 'active',
                metadata: {},
                created_by: null,
                last_used_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }
            : null,
    };
}

function user(input: {
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
}) {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'admin@example.test',
        app_metadata: input.app_metadata ?? {},
        user_metadata: input.user_metadata ?? {},
    } as RouteAuthorizationContext['user'];
}
