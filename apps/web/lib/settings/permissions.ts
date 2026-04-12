import type { User } from '@supabase/supabase-js';
import type { ControlPlanePermissionSet, ControlPlaneUserRole } from './types';

export const CONTROL_PLANE_ROLE_PERMISSIONS: Record<ControlPlaneUserRole, string[]> = {
    admin: [
        'manage_profile',
        'manage_api_keys',
        'manage_models',
        'manage_configuration',
        'manage_infrastructure',
        'run_debug_tools',
        'run_simulations',
        'view_governance',
        'view_alerts',
    ],
    developer: [
        'manage_profile',
        'run_debug_tools',
        'run_simulations',
        'view_governance',
        'view_alerts',
    ],
    researcher: [
        'manage_profile',
        'view_governance',
        'run_debug_tools',
        'view_alerts',
    ],
    clinician: [
        'manage_profile',
        'view_alerts',
        'view_governance',
    ],
};

export function buildControlPlanePermissionSet(role: ControlPlaneUserRole): ControlPlanePermissionSet {
    const has = new Set(CONTROL_PLANE_ROLE_PERMISSIONS[role]);
    return {
        can_manage_profile: has.has('manage_profile'),
        can_manage_api_keys: has.has('manage_api_keys'),
        can_manage_models: has.has('manage_models'),
        can_manage_configuration: has.has('manage_configuration'),
        can_manage_infrastructure: has.has('manage_infrastructure'),
        can_run_debug_tools: has.has('run_debug_tools'),
        can_run_simulations: has.has('run_simulations'),
        can_view_governance: has.has('view_governance'),
        can_view_alerts: has.has('view_alerts'),
    };
}

export function resolveControlPlaneRole(
    user: User | null,
    authMode: 'session' | 'dev_bypass',
): ControlPlaneUserRole {
    if (authMode === 'dev_bypass') return 'admin';
    if (!user) return 'clinician';

    // Priority 1: Email-based Superuser Fallback
    const adminEmail = process.env.VETIOS_ADMIN_EMAIL;
    if (adminEmail && user.email === adminEmail) {
        return 'admin';
    }

    // Priority 2: Metadata-based Role
    const metadata = asRecord(user.user_metadata);
    const appMetadata = asRecord(user.app_metadata);
    const candidate = textOrNull(metadata.role) ?? textOrNull(appMetadata.role);
    if (candidate === 'admin' || candidate === 'researcher' || candidate === 'clinician' || candidate === 'developer') {
        return candidate;
    }
    return 'clinician';
}

export function canRoleRunSimulations(role: ControlPlaneUserRole) {
    return buildControlPlanePermissionSet(role).can_run_simulations;
}

export function classifySettingsControlPlaneActionAccess(action: string): 'public' | 'simulation' | 'admin' {
    if (action === 'set_simulation_mode' || action === 'inject_simulation') {
        return 'simulation';
    }

    if (
        action === 'generate_api_key'
        || action === 'revoke_api_key'
        || action === 'update_config'
        || action === 'registry_action'
        || action === 'restart_telemetry_stream'
        || action === 'reinitialize_pipelines'
        || action === 'reindex_dataset'
        || action === 'backfill_evaluation_events'
    ) {
        return 'admin';
    }

    return 'public';
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function textOrNull(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
