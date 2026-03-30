import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { CONTROL_PLANE_ACTION_LOG } from '@/lib/db/schemaContracts';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import type { ControlPlanePermissionSet, ControlPlaneUserRole } from '@/lib/settings/types';

export type RouteAuthorizationRequirement =
    | 'authenticated'
    | 'view_governance'
    | 'run_debug_tools'
    | 'run_simulations'
    | 'manage_models'
    | 'manage_configuration'
    | 'admin';

export type RouteAuthorizationMode = 'session' | 'dev_bypass' | 'internal_token';

export interface RouteAuthorizationContext {
    tenantId: string;
    userId: string | null;
    role: ControlPlaneUserRole;
    permissionSet: ControlPlanePermissionSet;
    authMode: RouteAuthorizationMode;
    user: User | null;
}

export function buildRouteAuthorizationContext(input: {
    tenantId: string;
    userId: string | null;
    authMode: RouteAuthorizationMode;
    user: User | null;
}): RouteAuthorizationContext {
    const role = input.authMode === 'internal_token'
        ? 'admin'
        : resolveControlPlaneRole(input.user, input.authMode === 'dev_bypass' ? 'dev_bypass' : 'session');

    return {
        tenantId: input.tenantId,
        userId: input.userId,
        role,
        permissionSet: buildControlPlanePermissionSet(role),
        authMode: input.authMode,
        user: input.user,
    };
}

export function isRouteAuthorizationGranted(
    context: RouteAuthorizationContext,
    requirement: RouteAuthorizationRequirement,
): boolean {
    switch (requirement) {
        case 'authenticated':
            return true;
        case 'view_governance':
            return context.permissionSet.can_view_governance || context.permissionSet.can_manage_models;
        case 'run_debug_tools':
            return context.permissionSet.can_run_debug_tools;
        case 'run_simulations':
            return context.permissionSet.can_run_simulations;
        case 'manage_models':
            return context.permissionSet.can_manage_models;
        case 'manage_configuration':
            return context.permissionSet.can_manage_configuration;
        case 'admin':
            return context.role === 'admin';
        default:
            return false;
    }
}

export function buildAuthorizationErrorMessage(requirement: RouteAuthorizationRequirement): string {
    switch (requirement) {
        case 'view_governance':
            return 'Governance viewer role required for this route.';
        case 'run_debug_tools':
            return 'Developer or admin role required for this debug route.';
        case 'run_simulations':
            return 'Simulation operator role required for this route.';
        case 'manage_models':
            return 'Admin role required for model registry and promotion actions.';
        case 'manage_configuration':
            return 'Admin role required for this configuration route.';
        case 'admin':
            return 'Admin role required for this route.';
        case 'authenticated':
        default:
            return 'Unauthorized';
    }
}

export async function logRouteAuthorizationEvent(input: {
    client: SupabaseClient;
    tenantId: string | null;
    actor: string | null;
    route: string;
    requirement: RouteAuthorizationRequirement;
    outcome: 'denied' | 'granted';
    reason: string;
    requestId: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    if (!input.tenantId) {
        return;
    }

    const C = CONTROL_PLANE_ACTION_LOG.COLUMNS;
    try {
        await input.client
            .from(CONTROL_PLANE_ACTION_LOG.TABLE)
            .insert({
                [C.tenant_id]: input.tenantId,
                [C.actor]: input.actor,
                [C.action_type]: `authorization_${input.outcome}:${input.route}`,
                [C.target_type]: 'route',
                [C.target_id]: input.route,
                [C.status]: input.outcome === 'denied' ? 'failed' : 'completed',
                [C.requires_confirmation]: false,
                [C.metadata]: {
                    requirement: input.requirement,
                    reason: input.reason,
                    request_id: input.requestId,
                    ...input.metadata,
                },
            });
    } catch {
        // Best-effort security logging. Route auth should still enforce on failure.
    }
}

export async function buildForbiddenRouteResponse(input: {
    client: SupabaseClient;
    requestId: string;
    context: RouteAuthorizationContext;
    route: string;
    requirement: RouteAuthorizationRequirement;
    metadata?: Record<string, unknown>;
}) {
    const reason = buildAuthorizationErrorMessage(input.requirement);
    await logRouteAuthorizationEvent({
        client: input.client,
        tenantId: input.context.tenantId,
        actor: input.context.userId,
        route: input.route,
        requirement: input.requirement,
        outcome: 'denied',
        reason,
        requestId: input.requestId,
        metadata: {
            role: input.context.role,
            auth_mode: input.context.authMode,
            ...input.metadata,
        },
    });

    return NextResponse.json(
        { error: reason, request_id: input.requestId },
        { status: 403 },
    );
}
