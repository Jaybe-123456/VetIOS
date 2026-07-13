import { createHash, randomUUID } from 'crypto';

export type AuthTrustSubjectType =
    | 'session_user'
    | 'service_account'
    | 'connector_installation'
    | 'oauth_client'
    | 'internal_service'
    | 'dev_bypass';

export type AuthTrustAuthMode =
    | 'session'
    | 'dev_bypass'
    | 'service_account'
    | 'connector_installation'
    | 'oauth_client'
    | 'internal_token'
    | 'workload_identity';

export type AuthTrustActionCategory =
    | 'clinical_inference'
    | 'outcome_learning'
    | 'dataset_export'
    | 'federation_admin'
    | 'api_credential_management'
    | 'model_governance'
    | 'billing_admin'
    | 'cross_tenant_surveillance'
    | 'ontology_ingestion'
    | 'infrastructure_admin'
    | 'read_only';

export type AuthTrustRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AuthTrustAssuranceLevel =
    | 'anonymous'
    | 'session'
    | 'recent_auth'
    | 'mfa'
    | 'passkey'
    | 'workload_identity';
export type AuthTrustDecision = 'allow' | 'deny' | 'challenge';
export type AuthTrustEnvironment = 'sandbox' | 'staging' | 'production';

export interface AuthTrustSubject {
    type: AuthTrustSubjectType;
    authMode: AuthTrustAuthMode;
    subjectRef?: string | null;
    userId?: string | null;
    credentialId?: string | null;
    role?: string | null;
    grantedScopes?: readonly string[] | ['*'] | null;
    assuranceLevel?: AuthTrustAssuranceLevel | null;
}

export interface AuthTrustResource {
    type: string;
    id?: string | null;
    tenantId?: string | null;
}

export interface AuthTrustRiskSignals {
    leakedCredential?: boolean;
    impossibleTravel?: boolean;
    suspiciousIp?: boolean;
    crossTenantAccess?: boolean;
    productionWrite?: boolean;
}

export interface VetiosAuthorizationInput {
    tenantId: string | null | undefined;
    requestId?: string | null;
    subject: AuthTrustSubject;
    actionKey: string;
    resource: AuthTrustResource;
    environment?: AuthTrustEnvironment;
    permissionSnapshot?: Record<string, unknown>;
    riskSignals?: AuthTrustRiskSignals;
    evidence?: Record<string, unknown>;
    observedAt?: string;
}

export interface AuthTrustActionRequirement {
    actionKey: string;
    actionCategory: AuthTrustActionCategory;
    riskLevel: AuthTrustRiskLevel;
    requiredAssuranceLevel: AuthTrustAssuranceLevel;
    requiredScopes: string[];
    allowedRoles?: string[];
    challengeType?: 'recent_auth' | 'mfa' | 'passkey' | 'workload_identity' | 'admin_approval';
}

export interface AuthTrustDecisionPacket {
    tenantId: string;
    requestId: string;
    subjectType: AuthTrustSubjectType;
    subjectRef: string | null;
    actorUserId: string | null;
    credentialId: string | null;
    authMode: AuthTrustAuthMode;
    actionKey: string;
    actionCategory: AuthTrustActionCategory;
    resourceType: string;
    resourceId: string | null;
    resourceTenantId: string | null;
    decision: AuthTrustDecision;
    riskLevel: AuthTrustRiskLevel;
    assuranceLevel: AuthTrustAssuranceLevel;
    requiredAssuranceLevel: AuthTrustAssuranceLevel;
    requiredScopes: string[];
    grantedScopes: string[];
    role: string | null;
    permissionSnapshot: Record<string, unknown>;
    reasons: string[];
    blockers: string[];
    evidence: Record<string, unknown>;
    challengeType: AuthTrustActionRequirement['challengeType'] | null;
    observedAt: string;
}

export interface AuthTrustInsertClient {
    from(table: string): {
        insert(payload: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
    };
}

const ASSURANCE_RANK: Record<AuthTrustAssuranceLevel, number> = {
    anonymous: 0,
    session: 1,
    recent_auth: 2,
    mfa: 3,
    passkey: 4,
    workload_identity: 4,
};

const RISK_RANK: Record<AuthTrustRiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};

export const AUTH_TRUST_ACTION_REQUIREMENTS: Record<string, AuthTrustActionRequirement> = {
    'clinical.inference.write': {
        actionKey: 'clinical.inference.write',
        actionCategory: 'clinical_inference',
        riskLevel: 'medium',
        requiredAssuranceLevel: 'session',
        requiredScopes: ['inference:write'],
    },
    'outcome.confirm.write': {
        actionKey: 'outcome.confirm.write',
        actionCategory: 'outcome_learning',
        riskLevel: 'high',
        requiredAssuranceLevel: 'recent_auth',
        requiredScopes: ['outcome:write'],
        challengeType: 'recent_auth',
    },
    'dataset.export': {
        actionKey: 'dataset.export',
        actionCategory: 'dataset_export',
        riskLevel: 'critical',
        requiredAssuranceLevel: 'mfa',
        requiredScopes: ['machine:manage'],
        allowedRoles: ['admin'],
        challengeType: 'mfa',
    },
    'api_credential.create': {
        actionKey: 'api_credential.create',
        actionCategory: 'api_credential_management',
        riskLevel: 'critical',
        requiredAssuranceLevel: 'mfa',
        requiredScopes: ['machine:manage'],
        allowedRoles: ['admin'],
        challengeType: 'mfa',
    },
    'api_credential.revoke': {
        actionKey: 'api_credential.revoke',
        actionCategory: 'api_credential_management',
        riskLevel: 'high',
        requiredAssuranceLevel: 'recent_auth',
        requiredScopes: ['machine:manage'],
        allowedRoles: ['admin'],
        challengeType: 'recent_auth',
    },
    'federation.settings.write': {
        actionKey: 'federation.settings.write',
        actionCategory: 'federation_admin',
        riskLevel: 'critical',
        requiredAssuranceLevel: 'mfa',
        requiredScopes: ['federation:admin'],
        allowedRoles: ['admin'],
        challengeType: 'mfa',
    },
    'federation.secure_aggregation.admin': {
        actionKey: 'federation.secure_aggregation.admin',
        actionCategory: 'federation_admin',
        riskLevel: 'critical',
        requiredAssuranceLevel: 'workload_identity',
        requiredScopes: ['secure_aggregation:write', 'federation:admin'],
        challengeType: 'workload_identity',
    },
    'model.promotion.approve': {
        actionKey: 'model.promotion.approve',
        actionCategory: 'model_governance',
        riskLevel: 'critical',
        requiredAssuranceLevel: 'mfa',
        requiredScopes: ['evaluation:write'],
        allowedRoles: ['admin'],
        challengeType: 'mfa',
    },
    'billing.owner.update': {
        actionKey: 'billing.owner.update',
        actionCategory: 'billing_admin',
        riskLevel: 'critical',
        requiredAssuranceLevel: 'mfa',
        requiredScopes: ['machine:manage'],
        allowedRoles: ['admin'],
        challengeType: 'mfa',
    },
    'surveillance.cross_tenant.export': {
        actionKey: 'surveillance.cross_tenant.export',
        actionCategory: 'cross_tenant_surveillance',
        riskLevel: 'critical',
        requiredAssuranceLevel: 'mfa',
        requiredScopes: ['signals:read'],
        allowedRoles: ['admin'],
        challengeType: 'mfa',
    },
    'ontology.provider.ingest': {
        actionKey: 'ontology.provider.ingest',
        actionCategory: 'ontology_ingestion',
        riskLevel: 'high',
        requiredAssuranceLevel: 'workload_identity',
        requiredScopes: ['rag:write'],
        challengeType: 'workload_identity',
    },
    'infrastructure.control.write': {
        actionKey: 'infrastructure.control.write',
        actionCategory: 'infrastructure_admin',
        riskLevel: 'critical',
        requiredAssuranceLevel: 'mfa',
        requiredScopes: ['machine:manage'],
        allowedRoles: ['admin'],
        challengeType: 'mfa',
    },
};

export function authorizeVetiosAction(input: VetiosAuthorizationInput): AuthTrustDecisionPacket {
    const tenantId = normalizeText(input.tenantId) ?? 'unknown_tenant';
    const requirement = AUTH_TRUST_ACTION_REQUIREMENTS[input.actionKey] ?? buildDefaultRequirement(input.actionKey);
    const environment = input.environment ?? 'production';
    const grantedScopes = normalizeGrantedScopes(input.subject.grantedScopes);
    const assuranceLevel = input.subject.assuranceLevel ?? inferSubjectAssurance(input.subject);
    const role = normalizeText(input.subject.role);
    const reasons: string[] = [];
    const blockers: string[] = [];
    let riskLevel = requirement.riskLevel;
    let decision: AuthTrustDecision = 'allow';

    if (!normalizeText(input.tenantId)) {
        blockers.push('tenant_missing');
    }

    if (input.subject.type === 'dev_bypass' || input.subject.authMode === 'dev_bypass') {
        reasons.push('dev_bypass_subject_detected');
        if (environment === 'production') {
            blockers.push('dev_bypass_forbidden_in_production');
        }
    }

    if (input.riskSignals?.leakedCredential) {
        riskLevel = 'critical';
        blockers.push('leaked_credential_signal');
    }

    if (input.riskSignals?.impossibleTravel || input.riskSignals?.suspiciousIp) {
        riskLevel = maxRisk(riskLevel, 'high');
        blockers.push(input.riskSignals.impossibleTravel ? 'impossible_travel_signal' : 'suspicious_ip_signal');
    }

    const crossTenant = isCrossTenant(input.tenantId, input.resource.tenantId) || input.riskSignals?.crossTenantAccess === true;
    if (crossTenant && requirement.actionCategory !== 'cross_tenant_surveillance') {
        riskLevel = maxRisk(riskLevel, 'critical');
        blockers.push('cross_tenant_resource_without_cross_tenant_action');
    }

    const missingScopes = missingRequiredScopes(grantedScopes, requirement.requiredScopes);
    if (missingScopes.length > 0 && input.subject.type !== 'session_user') {
        blockers.push(`missing_scopes:${missingScopes.join(',')}`);
    }

    if (missingScopes.length > 0 && input.subject.type === 'session_user') {
        reasons.push(`session_actor_missing_machine_scopes:${missingScopes.join(',')}`);
    }

    if (
        input.subject.type === 'session_user'
        && requirement.allowedRoles
        && (!role || !requirement.allowedRoles.includes(role))
    ) {
        blockers.push(`role_not_allowed:${role ?? 'unknown'}`);
    }

    const assuranceSatisfied = hasAssurance(assuranceLevel, requirement.requiredAssuranceLevel);
    if (!assuranceSatisfied) {
        const stepUpBlocker = `assurance_too_low:${assuranceLevel}->${requirement.requiredAssuranceLevel}`;
        if (canChallengeForAssurance(input.subject, requirement)) {
            decision = 'challenge';
            blockers.push(stepUpBlocker);
        } else {
            blockers.push(stepUpBlocker);
        }
    }

    if (blockers.length > 0 && decision !== 'challenge') {
        decision = 'deny';
    }

    if (decision === 'allow') {
        reasons.push('all_policy_requirements_satisfied');
    } else if (decision === 'challenge') {
        reasons.push('step_up_required_before_authorization');
    } else {
        reasons.push('one_or_more_policy_requirements_failed');
    }

    return {
        tenantId,
        requestId: normalizeText(input.requestId) ?? randomUUID(),
        subjectType: input.subject.type,
        subjectRef: normalizeText(input.subject.subjectRef),
        actorUserId: normalizeText(input.subject.userId),
        credentialId: normalizeText(input.subject.credentialId),
        authMode: input.subject.authMode,
        actionKey: requirement.actionKey,
        actionCategory: requirement.actionCategory,
        resourceType: normalizeText(input.resource.type) ?? 'unknown_resource',
        resourceId: normalizeText(input.resource.id),
        resourceTenantId: normalizeText(input.resource.tenantId),
        decision,
        riskLevel,
        assuranceLevel,
        requiredAssuranceLevel: requirement.requiredAssuranceLevel,
        requiredScopes: requirement.requiredScopes,
        grantedScopes,
        role,
        permissionSnapshot: input.permissionSnapshot ?? {},
        reasons,
        blockers,
        evidence: {
            environment,
            risk_signals: input.riskSignals ?? {},
            policy_version: 'auth_trust_fabric_v1',
            ...input.evidence,
        },
        challengeType: decision === 'challenge' ? requirement.challengeType ?? 'recent_auth' : null,
        observedAt: input.observedAt ?? new Date().toISOString(),
    };
}

export async function writeAuthorizationDecisionEvent(
    client: AuthTrustInsertClient,
    packet: AuthTrustDecisionPacket,
): Promise<void> {
    const { error } = await client.from('authorization_decision_events').insert({
        tenant_id: packet.tenantId,
        request_id: packet.requestId,
        subject_type: packet.subjectType,
        subject_ref: packet.subjectRef,
        actor_user_id: packet.actorUserId,
        credential_id: packet.credentialId,
        auth_mode: packet.authMode,
        action_key: packet.actionKey,
        action_category: packet.actionCategory,
        resource_type: packet.resourceType,
        resource_id: packet.resourceId,
        resource_tenant_id: packet.resourceTenantId,
        decision: packet.decision,
        risk_level: packet.riskLevel,
        assurance_level: packet.assuranceLevel,
        required_assurance_level: packet.requiredAssuranceLevel,
        required_scopes: packet.requiredScopes,
        granted_scopes: packet.grantedScopes,
        role: packet.role,
        permission_snapshot: packet.permissionSnapshot,
        reasons: packet.reasons,
        blockers: packet.blockers,
        evidence: packet.evidence,
        observed_at: packet.observedAt,
    });

    if (error) {
        throw new Error(`Failed to write authorization decision event: ${error.message}`);
    }
}

export async function writeHighRiskOperationChallengeEvent(
    client: AuthTrustInsertClient,
    packet: AuthTrustDecisionPacket,
    input: {
        authorizationDecisionEventId?: string | null;
        expiresAt?: string | null;
        evidence?: Record<string, unknown>;
    } = {},
): Promise<void> {
    if (packet.decision !== 'challenge') {
        return;
    }

    const { error } = await client.from('high_risk_operation_challenge_events').insert({
        tenant_id: packet.tenantId,
        request_id: packet.requestId,
        authorization_decision_event_id: input.authorizationDecisionEventId ?? null,
        subject_type: packet.subjectType,
        subject_ref: packet.subjectRef,
        actor_user_id: packet.actorUserId,
        action_key: packet.actionKey,
        resource_type: packet.resourceType,
        resource_id: packet.resourceId,
        challenge_type: packet.challengeType ?? 'recent_auth',
        challenge_status: 'required',
        required_assurance_level: packet.requiredAssuranceLevel,
        satisfied_assurance_level: null,
        expires_at: input.expiresAt ?? null,
        evidence: {
            decision_request_id: packet.requestId,
            blockers: packet.blockers,
            ...input.evidence,
        },
        observed_at: packet.observedAt,
    });

    if (error) {
        throw new Error(`Failed to write high-risk operation challenge event: ${error.message}`);
    }
}

export function hashTrustSurfaceValue(value: string | null | undefined): string | null {
    const normalized = normalizeText(value);
    return normalized ? createHash('sha256').update(normalized).digest('hex') : null;
}

function buildDefaultRequirement(actionKey: string): AuthTrustActionRequirement {
    return {
        actionKey,
        actionCategory: 'read_only',
        riskLevel: 'low',
        requiredAssuranceLevel: 'session',
        requiredScopes: [],
    };
}

function normalizeGrantedScopes(scopes: readonly string[] | ['*'] | null | undefined): string[] {
    if (!Array.isArray(scopes)) return [];
    if (scopes.includes('*')) return ['*'];
    return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
}

function missingRequiredScopes(grantedScopes: string[], requiredScopes: string[]): string[] {
    if (requiredScopes.length === 0 || grantedScopes.includes('*')) return [];
    const granted = new Set(grantedScopes);
    return requiredScopes.filter((scope) => !granted.has(scope));
}

function inferSubjectAssurance(subject: AuthTrustSubject): AuthTrustAssuranceLevel {
    if (subject.authMode === 'workload_identity' || subject.type === 'internal_service') {
        return 'workload_identity';
    }
    if (subject.authMode === 'service_account' || subject.authMode === 'connector_installation' || subject.authMode === 'oauth_client') {
        return 'session';
    }
    if (subject.authMode === 'dev_bypass') {
        return 'anonymous';
    }
    return 'session';
}

function hasAssurance(actual: AuthTrustAssuranceLevel, required: AuthTrustAssuranceLevel): boolean {
    if (required === 'workload_identity') {
        return actual === 'workload_identity';
    }
    return ASSURANCE_RANK[actual] >= ASSURANCE_RANK[required];
}

function canChallengeForAssurance(subject: AuthTrustSubject, requirement: AuthTrustActionRequirement): boolean {
    if (subject.type !== 'session_user') {
        return false;
    }
    return requirement.requiredAssuranceLevel === 'recent_auth'
        || requirement.requiredAssuranceLevel === 'mfa'
        || requirement.requiredAssuranceLevel === 'passkey';
}

function isCrossTenant(tenantId: string | null | undefined, resourceTenantId: string | null | undefined): boolean {
    const left = normalizeText(tenantId);
    const right = normalizeText(resourceTenantId);
    return Boolean(left && right && left !== right);
}

function maxRisk(left: AuthTrustRiskLevel, right: AuthTrustRiskLevel): AuthTrustRiskLevel {
    return RISK_RANK[right] > RISK_RANK[left] ? right : left;
}

function normalizeText(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
