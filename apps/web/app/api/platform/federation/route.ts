import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    enrollFederationTenant,
    getFederationControlPlaneSnapshot,
    publishFederatedSiteSnapshots,
    runDueFederationAutomation,
    runFederationAutomation,
    runFederationRound,
    setFederationGovernancePolicy,
    upsertFederationMembership,
    type FederationMembershipStatus,
    type FederationParticipationMode,
} from '@/lib/federation/service';
import type { FederationGovernancePolicy } from '@/lib/federation/policy';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

type FederationAction =
    | {
        action?: 'upsert_membership';
        federation_key?: string | null;
        coordinator_tenant_id?: string | null;
        participation_mode?: FederationParticipationMode | null;
        status?: FederationMembershipStatus | null;
        weight?: number | string | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'publish_snapshot';
        federation_key?: string | null;
    }
    | {
        action: 'run_round';
        federation_key?: string | null;
        snapshot_max_age_hours?: number | string | null;
    }
    | {
        action: 'enroll_tenant';
        federation_key?: string | null;
        target_tenant_id?: string | null;
        participation_mode?: FederationParticipationMode | null;
        status?: FederationMembershipStatus | null;
        weight?: number | string | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'set_governance';
        federation_key?: string | null;
        enrollment_mode?: string | null;
        auto_enroll_enabled?: boolean | string | null;
        approved_tenant_ids?: string[] | string | null;
        auto_publish_snapshots?: boolean | string | null;
        auto_run_rounds?: boolean | string | null;
        round_interval_hours?: number | string | null;
        snapshot_max_age_hours?: number | string | null;
        minimum_participants?: number | string | null;
        minimum_benchmark_pass_rate?: number | string | null;
        maximum_calibration_avg_ece?: number | string | null;
        allow_shadow_participants?: boolean | string | null;
    }
    | {
        action: 'run_automation';
        federation_key?: string | null;
        force?: boolean | string | null;
    }
    | {
        action: 'run_due_automation';
        federation_key?: string | null;
    };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const url = new URL(req.url);
    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: url.searchParams.get('tenant_id'),
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolveFederationAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: 'api/platform/federation:GET',
            requirement: 'admin',
        });
    }

    const federationKey = normalizeFederationKey(url.searchParams.get('federation_key'));
    const snapshot = await getFederationControlPlaneSnapshot(adminClient, authContext.tenantId, {
        federationKey,
    });

    const response = NextResponse.json({
        snapshot,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<FederationAction>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolveFederationAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: `api/platform/federation:${body.data.action ?? 'upsert_membership'}`,
            requirement: 'admin',
        });
    }

    try {
        const action = body.data.action ?? 'upsert_membership';
        const federationKey = normalizeRequiredFederationKey(body.data.federation_key);
        let result: Record<string, unknown>;

        if (action === 'upsert_membership') {
            const membershipBody = body.data as Extract<FederationAction, { action?: 'upsert_membership' }>;
            result = {
                membership: await upsertFederationMembership(adminClient, {
                    federationKey,
                    tenantId: authContext.tenantId,
                    coordinatorTenantId: normalizeTenantId(membershipBody.coordinator_tenant_id) ?? authContext.tenantId,
                    actor: authContext.userId,
                    participationMode: normalizeParticipationMode(membershipBody.participation_mode) ?? 'full',
                    status: normalizeMembershipStatus(membershipBody.status) ?? 'active',
                    weight: normalizePositiveNumber(membershipBody.weight) ?? 1,
                    metadata: asRecord(membershipBody.metadata),
                }),
            };
        } else if (action === 'publish_snapshot') {
            result = {
                published_snapshots: await publishFederatedSiteSnapshots(adminClient, {
                    tenantId: authContext.tenantId,
                    actor: authContext.userId,
                    federationKey,
                }),
            };
        } else if (action === 'run_round') {
            const roundBody = body.data as Extract<FederationAction, { action: 'run_round' }>;
            result = await runFederationRound(adminClient, {
                federationKey,
                actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                actor: authContext.userId,
                snapshotMaxAgeHours: normalizePositiveNumber(roundBody.snapshot_max_age_hours) ?? 24,
            });
        } else if (action === 'enroll_tenant') {
            const enrollmentBody = body.data as Extract<FederationAction, { action: 'enroll_tenant' }>;
            const targetTenantId = normalizeTenantId(enrollmentBody.target_tenant_id);
            if (!targetTenantId) {
                throw new Error('target_tenant_id is required for federation enrollment.');
            }
            result = {
                membership: await enrollFederationTenant(adminClient, {
                    federationKey,
                    actorTenantId: authContext.tenantId,
                    actor: authContext.userId,
                    targetTenantId,
                    participationMode: normalizeParticipationMode(enrollmentBody.participation_mode) ?? 'full',
                    status: normalizeMembershipStatus(enrollmentBody.status) ?? 'active',
                    weight: normalizePositiveNumber(enrollmentBody.weight) ?? 1,
                    metadata: asRecord(enrollmentBody.metadata),
                }),
            };
        } else if (action === 'set_governance') {
            const governanceBody = body.data as Extract<FederationAction, { action: 'set_governance' }>;
            result = {
                membership: await setFederationGovernancePolicy(adminClient, {
                    federationKey,
                    actorTenantId: authContext.tenantId,
                    actor: authContext.userId,
                    policy: buildGovernancePolicyPatch(governanceBody),
                }),
            };
        } else if (action === 'run_automation') {
            const automationBody = body.data as Extract<FederationAction, { action: 'run_automation' }>;
            result = {
                automation: await runFederationAutomation(adminClient, {
                    federationKey,
                    actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    actor: authContext.userId,
                    force: normalizeBoolean(automationBody.force) ?? false,
                }),
            };
        } else if (action === 'run_due_automation') {
            result = {
                automations: await runDueFederationAutomation(adminClient, {
                    tenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    federationKey,
                    actor: authContext.userId,
                }),
            };
        } else {
            return NextResponse.json({ error: 'Unsupported federation action.', request_id: requestId }, { status: 400 });
        }

        const response = NextResponse.json({
            ...result,
            snapshot: await getFederationControlPlaneSnapshot(adminClient, authContext.tenantId, {
                federationKey,
            }),
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Federation action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolveFederationAuthorizationContext(
    actor: Awaited<ReturnType<typeof resolveExperimentApiActor>>,
): Promise<RouteAuthorizationContext> {
    if (actor?.authMode === 'internal_token') {
        return buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'internal_token',
            user: null,
        });
    }

    const session = await resolveSessionTenant();
    if (session) {
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId: session.tenantId,
            userId: session.userId,
            authMode: 'session',
            user,
        });
    }

    return buildRouteAuthorizationContext({
        tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        userId: process.env.VETIOS_DEV_USER_ID ?? null,
        authMode: process.env.VETIOS_DEV_BYPASS === 'true' ? 'dev_bypass' : 'session',
        user: null,
    });
}

function normalizeFederationKey(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9:_-]{2,63}$/.test(normalized)) {
        return null;
    }
    return normalized;
}

function normalizeRequiredFederationKey(value: unknown): string {
    const normalized = normalizeFederationKey(value);
    if (!normalized) {
        throw new Error('federation_key is required and must be 3-64 chars using letters, numbers, :, _, or -.');
    }
    return normalized;
}

function normalizeTenantId(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeParticipationMode(value: unknown): FederationParticipationMode | null {
    return value === 'full' || value === 'shadow' ? value : null;
}

function normalizeMembershipStatus(value: unknown): FederationMembershipStatus | null {
    return value === 'active' || value === 'paused' || value === 'revoked' ? value : null;
}

function buildGovernancePolicyPatch(
    body: Extract<FederationAction, { action: 'set_governance' }>,
): Partial<FederationGovernancePolicy> {
    const policy: Partial<FederationGovernancePolicy> = {};

    const enrollmentMode = normalizeEnrollmentMode(body.enrollment_mode);
    if (enrollmentMode) {
        policy.enrollment_mode = enrollmentMode;
    }

    const autoEnrollEnabled = normalizeBoolean(body.auto_enroll_enabled);
    if (autoEnrollEnabled != null) {
        policy.auto_enroll_enabled = autoEnrollEnabled;
    }

    if (body.approved_tenant_ids != null) {
        policy.approved_tenant_ids = normalizeTenantIdList(body.approved_tenant_ids);
    }

    const autoPublishSnapshots = normalizeBoolean(body.auto_publish_snapshots);
    if (autoPublishSnapshots != null) {
        policy.auto_publish_snapshots = autoPublishSnapshots;
    }

    const autoRunRounds = normalizeBoolean(body.auto_run_rounds);
    if (autoRunRounds != null) {
        policy.auto_run_rounds = autoRunRounds;
    }

    const roundIntervalHours = normalizePositiveNumber(body.round_interval_hours);
    if (roundIntervalHours != null) {
        policy.round_interval_hours = roundIntervalHours;
    }

    const snapshotMaxAgeHours = normalizePositiveNumber(body.snapshot_max_age_hours);
    if (snapshotMaxAgeHours != null) {
        policy.snapshot_max_age_hours = snapshotMaxAgeHours;
    }

    const minimumParticipants = normalizePositiveNumber(body.minimum_participants);
    if (minimumParticipants != null) {
        policy.minimum_participants = minimumParticipants;
    }

    if (body.minimum_benchmark_pass_rate != null) {
        policy.minimum_benchmark_pass_rate = normalizeFractionalNumber(body.minimum_benchmark_pass_rate);
    }

    if (body.maximum_calibration_avg_ece != null) {
        policy.maximum_calibration_avg_ece = normalizeFractionalNumber(body.maximum_calibration_avg_ece);
    }

    const allowShadowParticipants = normalizeBoolean(body.allow_shadow_participants);
    if (allowShadowParticipants != null) {
        policy.allow_shadow_participants = allowShadowParticipants;
    }

    return policy;
}

function normalizeEnrollmentMode(value: unknown): FederationGovernancePolicy['enrollment_mode'] | null {
    return value === 'coordinator_only' || value === 'allow_list' || value === 'open'
        ? value
        : null;
}

function normalizeBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return null;
}

function normalizePositiveNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
}

function normalizeFractionalNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value < 0) return null;
        if (value > 1 && value <= 100) return value / 100;
        return value <= 1 ? value : null;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return null;
        }
        if (parsed > 1 && parsed <= 100) {
            return parsed / 100;
        }
        return parsed <= 1 ? parsed : null;
    }
    return null;
}

function normalizeTenantIdList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => normalizeTenantId(entry))
            .filter((entry): entry is string => entry != null);
    }
    if (typeof value === 'string') {
        return value
            .split(/[\s,]+/)
            .map((entry) => normalizeTenantId(entry))
            .filter((entry): entry is string => entry != null);
    }
    return [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
