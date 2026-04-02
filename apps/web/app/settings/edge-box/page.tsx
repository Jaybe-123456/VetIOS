import EdgeBoxOperationsClient from '@/components/EdgeBoxOperationsClient';
import {
    getEdgeBoxControlPlaneSnapshot,
    type EdgeBoxControlPlaneSnapshot,
} from '@/lib/edgeBox/service';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function EdgeBoxOperationsPage() {
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
                        Admin role required for edge node provisioning, offline sync, and artifact staging.
                    </p>
                </div>
            </div>
        );
    }

    const tenantId = session?.tenantId ?? resolveDevTenantId();
    const initialSnapshot = tenantId
        ? await getEdgeBoxControlPlaneSnapshot(getSupabaseServer(), tenantId)
        : createEmptySnapshot();

    return (
        <EdgeBoxOperationsClient
            initialSnapshot={initialSnapshot}
            tenantId={tenantId ?? 'dev_tenant_001'}
        />
    );
}

function createEmptySnapshot(): EdgeBoxControlPlaneSnapshot {
    return {
        tenant_id: 'dev_tenant_001',
        edge_boxes: [],
        sync_jobs: [],
        sync_artifacts: [],
        summary: {
            online_nodes: 0,
            degraded_nodes: 0,
            queued_jobs: 0,
            failed_jobs: 0,
            staged_artifacts: 0,
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
