import { ModelRegistryControlPlaneClient } from '@/components/ModelRegistryControlPlaneClient';
import { getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import type { ModelFamily, ModelRegistryControlPlaneSnapshot } from '@/lib/experiments/types';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function ModelRegistryPage() {
    const session = await resolveSessionTenant();
    const user = session ? (await session.supabase.auth.getUser()).data.user ?? null : null;
    const role = resolveControlPlaneRole(user, session ? 'session' : 'dev_bypass');
    const permissionSet = buildControlPlanePermissionSet(role);
    if (!permissionSet.can_view_governance) {
        return (
            <div className="min-h-screen bg-background px-6 py-12 text-foreground">
                <div className="mx-auto max-w-3xl border border-grid bg-panel p-6">
                    <div className="font-mono text-sm uppercase tracking-[0.18em] text-danger">Access Denied</div>
                    <p className="mt-4 font-mono text-xs text-muted">
                        Governance viewer role required to access the model registry control plane.
                    </p>
                </div>
            </div>
        );
    }

    const tenantId = session?.tenantId ?? resolveDevTenantId();

    const initialSnapshot = tenantId
        ? await getModelRegistryControlPlaneSnapshot(
            createSupabaseExperimentTrackingStore(getSupabaseServer()),
            tenantId,
            { readOnly: false },
        )
        : createEmptySnapshot();

    return (
        <ModelRegistryControlPlaneClient
            initialSnapshot={initialSnapshot}
            canSystemAdminOverride={permissionSet.can_manage_models}
        />
    );
}

function createEmptySnapshot(): ModelRegistryControlPlaneSnapshot {
    const families: ModelFamily[] = ['diagnostics', 'vision', 'therapeutics'];
    return {
        tenant_id: '',
        families: families.map((modelFamily) => ({
            model_family: modelFamily,
            active_registry_id: null,
            active_model: null,
            last_stable_model: null,
            entries: [],
        })),
        routing_pointers: [],
        audit_history: [],
        registry_health: 'healthy',
        consistency_issues: [],
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
