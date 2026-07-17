import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type { RouteAuthorizationContext } from './authorization';
import type { ClinicalApiActor } from './machineAuth';
import type { PlatformActor } from '@/lib/platform/types';
import {
    authorizeVetiosAction,
    writeAuthorizationDecisionEvent,
    writeHighRiskOperationChallengeEvent,
    type AuthTrustAssuranceLevel,
    type AuthTrustEnvironment,
    type AuthTrustInsertClient,
    type AuthTrustResource,
    type AuthTrustRiskSignals,
    type AuthTrustSubject,
} from './authTrustFabric';

export interface VetiosHighRiskRouteGateInput {
    client: AuthTrustInsertClient;
    requestId: string;
    context: RouteAuthorizationContext;
    actionKey: string;
    resource: AuthTrustResource;
    environment?: AuthTrustEnvironment;
    assuranceLevel?: AuthTrustAssuranceLevel;
    riskSignals?: AuthTrustRiskSignals;
    evidence?: Record<string, unknown>;
}

export interface VetiosClinicalActorGateInput {
    client: AuthTrustInsertClient;
    requestId: string;
    actor: ClinicalApiActor;
    actionKey: string;
    resource: AuthTrustResource;
    environment?: AuthTrustEnvironment;
    riskSignals?: AuthTrustRiskSignals;
    evidence?: Record<string, unknown>;
}

export interface VetiosPlatformActorGateInput {
    client: AuthTrustInsertClient;
    requestId: string;
    actor: PlatformActor;
    tenantId: string | null;
    actionKey: string;
    resource: AuthTrustResource;
    environment?: AuthTrustEnvironment;
    riskSignals?: AuthTrustRiskSignals;
    evidence?: Record<string, unknown>;
}

export type VetiosHighRiskRouteGateResult =
    | {
        ok: true;
        packet: ReturnType<typeof authorizeVetiosAction>;
    }
    | {
        ok: false;
        packet: ReturnType<typeof authorizeVetiosAction>;
        response: NextResponse;
    };

export async function enforceVetiosHighRiskRouteGate(
    input: VetiosHighRiskRouteGateInput,
): Promise<VetiosHighRiskRouteGateResult> {
    const subject = buildAuthTrustSubjectFromRouteContext(input.context);
    if (input.assuranceLevel) {
        subject.assuranceLevel = input.assuranceLevel;
    }
    const packet = authorizeVetiosAction({
        tenantId: input.context.tenantId,
        requestId: input.requestId,
        subject,
        actionKey: input.actionKey,
        resource: input.resource,
        environment: input.environment ?? resolveDeploymentEnvironment(),
        permissionSnapshot: input.context.permissionSet as unknown as Record<string, unknown>,
        riskSignals: input.riskSignals,
        evidence: {
            auth_route_gate_version: 'auth_trust_route_gate_v1',
            ...input.evidence,
        },
    });

    await writeAuthorizationDecisionEvent(input.client, packet).catch(() => {
        // Authorization should enforce even if best-effort audit persistence is degraded.
    });

    if (packet.decision === 'challenge') {
        await writeHighRiskOperationChallengeEvent(input.client, packet, {
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            evidence: {
                route_gate: 'auth_trust_route_gate_v1',
            },
        }).catch(() => {
            // Step-up response should still be returned even if challenge ledger write fails.
        });
    }

    if (packet.decision === 'allow') {
        return { ok: true, packet };
    }

    const status = packet.decision === 'challenge' ? 428 : 403;
    const response = NextResponse.json(
        {
            error: packet.decision === 'challenge'
                ? 'step_up_required'
                : 'authorization_denied',
            code: packet.decision === 'challenge'
                ? 'VETIOS_STEP_UP_REQUIRED'
                : 'VETIOS_AUTH_TRUST_DENIED',
            request_id: packet.requestId,
            auth_trust: {
                decision: packet.decision,
                action_key: packet.actionKey,
                risk_level: packet.riskLevel,
                assurance_level: packet.assuranceLevel,
                required_assurance_level: packet.requiredAssuranceLevel,
                challenge_type: packet.challengeType,
                blockers: packet.blockers,
                reasons: packet.reasons,
            },
        },
        { status },
    );
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-vetios-auth-trust-decision', packet.decision);
    response.headers.set('x-vetios-auth-trust-action', packet.actionKey);
    if (packet.challengeType) {
        response.headers.set('x-vetios-step-up-type', packet.challengeType);
    }
    return { ok: false, packet, response };
}

export async function enforceVetiosClinicalActorGate(
    input: VetiosClinicalActorGateInput,
): Promise<VetiosHighRiskRouteGateResult> {
    const packet = authorizeVetiosAction({
        tenantId: input.actor.tenantId,
        requestId: input.requestId,
        subject: buildAuthTrustSubjectFromClinicalActor(input.actor),
        actionKey: input.actionKey,
        resource: input.resource,
        environment: input.environment ?? resolveDeploymentEnvironment(),
        permissionSnapshot: {
            auth_mode: input.actor.authMode,
            scopes: input.actor.scopes,
        },
        riskSignals: input.riskSignals,
        evidence: {
            auth_route_gate_version: 'auth_trust_clinical_actor_gate_v1',
            principal_label: input.actor.principalLabel,
            service_account_id: input.actor.serviceAccountId,
            connector_installation_id: input.actor.connectorInstallation?.id ?? null,
            ...input.evidence,
        },
    });

    await writeAuthorizationDecisionEvent(input.client, packet).catch(() => {
        // Authorization should enforce even if best-effort audit persistence is degraded.
    });

    if (packet.decision === 'challenge') {
        await writeHighRiskOperationChallengeEvent(input.client, packet, {
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            evidence: {
                route_gate: 'auth_trust_clinical_actor_gate_v1',
            },
        }).catch(() => {
            // Step-up response should still be returned even if challenge ledger write fails.
        });
    }

    if (packet.decision === 'allow') {
        return { ok: true, packet };
    }

    const response = buildAuthTrustFailureResponse(packet);
    return { ok: false, packet, response };
}

export async function enforceVetiosPlatformActorGate(
    input: VetiosPlatformActorGateInput,
): Promise<VetiosHighRiskRouteGateResult> {
    const packet = authorizeVetiosAction({
        tenantId: input.tenantId ?? input.actor.tenantId,
        requestId: input.requestId,
        subject: buildAuthTrustSubjectFromPlatformActor(input.actor),
        actionKey: input.actionKey,
        resource: input.resource,
        environment: input.environment ?? resolveDeploymentEnvironment(),
        permissionSnapshot: {
            platform_role: input.actor.role,
            auth_mode: input.actor.authMode,
            scopes: input.actor.scopes,
            tenant_scope: input.actor.tenantScope,
        },
        riskSignals: input.riskSignals,
        evidence: {
            auth_route_gate_version: 'auth_trust_platform_actor_gate_v1',
            ...input.evidence,
        },
    });

    await writeAuthorizationDecisionEvent(input.client, packet).catch(() => {
        // Authorization should enforce even if best-effort audit persistence is degraded.
    });

    if (packet.decision === 'challenge') {
        await writeHighRiskOperationChallengeEvent(input.client, packet, {
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            evidence: {
                route_gate: 'auth_trust_platform_actor_gate_v1',
            },
        }).catch(() => {
            // Step-up response should still be returned even if challenge ledger write fails.
        });
    }

    if (packet.decision === 'allow') {
        return { ok: true, packet };
    }

    const response = buildAuthTrustFailureResponse(packet);
    return { ok: false, packet, response };
}

export function buildAuthTrustSubjectFromRouteContext(context: RouteAuthorizationContext): AuthTrustSubject {
    if (context.authMode === 'internal_token') {
        return {
            type: 'internal_service',
            authMode: 'internal_token',
            subjectRef: 'internal_token',
            userId: context.userId,
            role: context.role,
            grantedScopes: ['*'],
            assuranceLevel: 'workload_identity',
        };
    }

    if (context.authMode === 'dev_bypass') {
        return {
            type: 'dev_bypass',
            authMode: 'dev_bypass',
            subjectRef: 'dev_bypass',
            userId: context.userId,
            role: context.role,
            grantedScopes: ['*'],
            assuranceLevel: 'anonymous',
        };
    }

    return {
        type: 'session_user',
        authMode: 'session',
        subjectRef: context.user?.email ?? context.userId,
        userId: context.userId,
        role: context.role,
        grantedScopes: ['*'],
        assuranceLevel: resolveUserAssuranceLevel(context.user),
    };
}

export function buildAuthTrustSubjectFromPlatformActor(actor: PlatformActor): AuthTrustSubject {
    if (actor.authMode === 'jwt') {
        return {
            type: 'internal_service',
            authMode: 'internal_token',
            subjectRef: actor.userId ?? 'platform_jwt',
            userId: actor.userId,
            role: actor.role === 'system_admin' ? 'admin' : 'clinician',
            grantedScopes: actor.role === 'system_admin' ? ['*'] : actor.scopes,
            assuranceLevel: 'workload_identity',
        };
    }

    if (actor.authMode === 'service_account' || actor.authMode === 'connector_installation') {
        return {
            type: actor.authMode,
            authMode: actor.authMode,
            subjectRef: actor.userId ?? actor.authMode,
            userId: null,
            role: null,
            grantedScopes: actor.scopes,
            assuranceLevel: 'workload_identity',
        };
    }

    if (actor.authMode === 'oauth_client') {
        return {
            type: 'oauth_client',
            authMode: 'oauth_client',
            subjectRef: actor.userId ?? 'oauth_client',
            userId: null,
            role: null,
            grantedScopes: actor.scopes,
            assuranceLevel: 'workload_identity',
        };
    }

    if (actor.authMode === 'dev_bypass') {
        return {
            type: 'dev_bypass',
            authMode: 'dev_bypass',
            subjectRef: 'dev_bypass',
            userId: actor.userId,
            role: null,
            grantedScopes: actor.scopes,
            assuranceLevel: 'anonymous',
        };
    }

    return {
        type: 'session_user',
        authMode: 'session',
        subjectRef: actor.userId,
        userId: actor.userId,
        role: actor.role === 'system_admin' ? 'admin' : 'clinician',
        grantedScopes: ['*'],
        assuranceLevel: 'session',
    };
}

export function buildAuthTrustSubjectFromClinicalActor(actor: ClinicalApiActor): AuthTrustSubject {
    if (actor.authMode === 'service_account') {
        return {
            type: 'service_account',
            authMode: 'service_account',
            subjectRef: actor.serviceAccountId ?? actor.principalLabel,
            userId: null,
            credentialId: actor.credentialId,
            role: null,
            grantedScopes: actor.scopes,
            assuranceLevel: 'workload_identity',
        };
    }

    if (actor.authMode === 'connector_installation') {
        return {
            type: 'connector_installation',
            authMode: 'connector_installation',
            subjectRef: actor.connectorInstallation?.id ?? actor.principalLabel,
            userId: null,
            credentialId: actor.credentialId,
            role: null,
            grantedScopes: actor.scopes,
            assuranceLevel: 'workload_identity',
        };
    }

    if (actor.authMode === 'oauth_client') {
        return {
            type: 'oauth_client',
            authMode: 'oauth_client',
            subjectRef: actor.oauthClientId ?? actor.principalLabel,
            userId: null,
            credentialId: null,
            role: null,
            grantedScopes: actor.scopes,
            assuranceLevel: 'workload_identity',
        };
    }

    if (actor.authMode === 'dev_bypass') {
        return {
            type: 'dev_bypass',
            authMode: 'dev_bypass',
            subjectRef: 'dev_bypass',
            userId: actor.userId,
            credentialId: actor.credentialId,
            role: null,
            grantedScopes: actor.scopes,
            assuranceLevel: 'anonymous',
        };
    }

    return {
        type: 'session_user',
        authMode: 'session',
        subjectRef: actor.userId,
        userId: actor.userId,
        credentialId: null,
        role: null,
        grantedScopes: actor.scopes,
        assuranceLevel: 'session',
    };
}

export function resolveUserAssuranceLevel(user: User | null): AuthTrustAssuranceLevel {
    if (!user) return 'anonymous';

    const metadata = [
        asRecord(user.app_metadata),
        asRecord(user.user_metadata),
    ];
    const explicit = metadata
        .map((entry) =>
            readText(entry.vetios_assurance_level)
            ?? readText(entry.assurance_level)
            ?? readText(entry.aal)
            ?? readText(entry.authenticator_assurance_level))
        .find(Boolean);
    const normalizedExplicit = normalizeAssuranceText(explicit);
    if (normalizedExplicit) return normalizedExplicit;

    const amr = metadata.flatMap((entry) => readTextArray(entry.amr));
    if (amr.some((entry) => entry === 'passkey' || entry === 'webauthn')) return 'passkey';
    if (amr.some((entry) => entry === 'mfa' || entry === 'otp' || entry === 'totp')) return 'mfa';

    const recentAuthAt = metadata
        .map((entry) => readText(entry.recent_auth_at) ?? readText(entry.last_reauthentication_at))
        .find(Boolean);
    if (isRecentIsoTimestamp(recentAuthAt, 15 * 60_000)) return 'recent_auth';

    return 'session';
}

export function mapSettingsControlPlaneActionToAuthTrustAction(action: string): string | null {
    if (action === 'generate_api_key') return 'api_credential.create';
    if (action === 'revoke_api_key') return 'api_credential.revoke';
    if (action === 'registry_action') return 'model.promotion.approve';
    if (
        action === 'update_config'
        || action === 'restart_telemetry_stream'
        || action === 'reinitialize_pipelines'
        || action === 'reindex_dataset'
        || action === 'backfill_evaluation_events'
    ) {
        return 'infrastructure.control.write';
    }
    return null;
}

export function mapMachineAuthActionToAuthTrustAction(action: string): string | null {
    if (
        action === 'create_service_account'
        || action === 'issue_service_account_credential'
        || action === 'create_connector_installation'
        || action === 'issue_connector_installation_credential'
    ) {
        return 'api_credential.create';
    }
    if (action === 'revoke_api_credential') return 'api_credential.revoke';
    return null;
}

export function mapFederationActionToAuthTrustAction(action: string): string {
    if (
        action === 'finalize_secure_aggregation'
        || action === 'build_federated_aggregate_artifacts'
    ) {
        return 'federation.secure_aggregation.admin';
    }

    if (
        action === 'register_federated_candidate'
        || action === 'run_federated_promotion_automation'
        || action === 'generate_federated_candidate_evidence'
        || action === 'generate_federated_external_validation'
        || action === 'run_federated_champion_surveillance'
    ) {
        return 'model.promotion.approve';
    }

    return 'federation.settings.write';
}

export function mapModelTrustActionToAuthTrustAction(_action: string): string {
    return 'model.promotion.approve';
}

export function mapDeveloperPlatformActionToAuthTrustAction(action: string): string | null {
    if (action === 'approve_onboarding_request') return 'api_credential.create';
    if (action === 'create_api_product') return 'infrastructure.control.write';
    return null;
}

function resolveDeploymentEnvironment(): AuthTrustEnvironment {
    const value = process.env.VETIOS_DEPLOYMENT_ENVIRONMENT
        ?? process.env.VERCEL_ENV
        ?? process.env.NODE_ENV;
    if (value === 'sandbox' || value === 'staging' || value === 'production') {
        return value;
    }
    if (value === 'preview' || value === 'development' || value === 'test') {
        return 'staging';
    }
    return 'production';
}

function buildAuthTrustFailureResponse(packet: ReturnType<typeof authorizeVetiosAction>): NextResponse {
    const status = packet.decision === 'challenge' ? 428 : 403;
    const response = NextResponse.json(
        {
            error: packet.decision === 'challenge'
                ? 'step_up_required'
                : 'authorization_denied',
            code: packet.decision === 'challenge'
                ? 'VETIOS_STEP_UP_REQUIRED'
                : 'VETIOS_AUTH_TRUST_DENIED',
            request_id: packet.requestId,
            auth_trust: {
                decision: packet.decision,
                action_key: packet.actionKey,
                risk_level: packet.riskLevel,
                assurance_level: packet.assuranceLevel,
                required_assurance_level: packet.requiredAssuranceLevel,
                challenge_type: packet.challengeType,
                blockers: packet.blockers,
                reasons: packet.reasons,
            },
        },
        { status },
    );
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-vetios-auth-trust-decision', packet.decision);
    response.headers.set('x-vetios-auth-trust-action', packet.actionKey);
    if (packet.challengeType) {
        response.headers.set('x-vetios-step-up-type', packet.challengeType);
    }
    return response;
}

function normalizeAssuranceText(value: string | null | undefined): AuthTrustAssuranceLevel | null {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'aal2' || normalized === 'mfa' || normalized === 'multi_factor') return 'mfa';
    if (normalized === 'aal3' || normalized === 'passkey' || normalized === 'webauthn') return 'passkey';
    if (normalized === 'recent_auth' || normalized === 'recent') return 'recent_auth';
    if (normalized === 'workload_identity') return 'workload_identity';
    if (normalized === 'aal1' || normalized === 'session') return 'session';
    return null;
}

function isRecentIsoTimestamp(value: string | null | undefined, maxAgeMs: number): boolean {
    if (!value) return false;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return false;
    return Date.now() - parsed <= maxAgeMs;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readTextArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value
            .map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase() : null)
            .filter((entry): entry is string => Boolean(entry))
        : [];
}
