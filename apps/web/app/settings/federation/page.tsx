import FederationControlPlaneClient from '@/components/FederationControlPlaneClient';
import {
    getFederationControlPlaneSnapshot,
    type FederationControlPlaneSnapshot,
} from '@/lib/federation/service';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function FederationOperationsPage() {
    const session = await resolveSessionTenant();
    const user = session ? (await session.supabase.auth.getUser()).data.user ?? null : null;
    const role = resolveControlPlaneRole(user, session ? 'session' : 'dev_bypass');
    const permissionSet = buildControlPlanePermissionSet(role);

    if (!permissionSet.can_manage_models) {
        return (
            <div className="min-h-screen bg-background px-6 py-12 text-foreground">
                <div className="mx-auto max-w-3xl border border-grid bg-panel p-6">
                    <div className="font-mono text-sm uppercase tracking-[0.18em] text-danger">Access Denied</div>
                    <p className="mt-4 font-mono text-xs text-muted">
                        Admin role required for federation rounds and cross-clinic learning operations.
                    </p>
                </div>
            </div>
        );
    }

    const tenantId = session?.tenantId ?? resolveDevTenantId();
    const initialSnapshot = tenantId
        ? await getFederationControlPlaneSnapshot(getSupabaseServer(), tenantId)
        : createEmptySnapshot();

    return (
        <FederationControlPlaneClient
            initialSnapshot={initialSnapshot}
            tenantId={tenantId ?? 'dev_tenant_001'}
        />
    );
}

function createEmptySnapshot(): FederationControlPlaneSnapshot {
    return {
        tenant_id: 'dev_tenant_001',
        memberships: [],
        recent_site_snapshots: [],
        recent_rounds: [],
        recent_artifacts: [],
        summary: {
            active_memberships: 0,
            coordinator_memberships: 0,
            active_federations: 0,
            visible_participants: 0,
            stale_snapshots: 0,
            completed_rounds: 0,
            latest_round_completed_at: null,
        },
        refreshed_at: new Date().toISOString(),
    };
}

function resolveDevTenantId(): string | null {
    if (process.env.VETIOS_DEV_BYPASS !== 'true') {
        return null;
    }

    const configuredTenantId = process.env.VETIOS_DEV_TENANT_ID?.trim();
    return configuredTenantId || null;
}
