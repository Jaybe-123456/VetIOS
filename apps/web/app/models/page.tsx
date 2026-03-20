import { ModelRegistryControlPlaneClient } from '@/components/ModelRegistryControlPlaneClient';
import { getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import type { ModelFamily, ModelRegistryControlPlaneSnapshot } from '@/lib/experiments/types';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function ModelRegistryPage() {
    const session = await resolveSessionTenant();
    const tenantId = session?.tenantId ?? resolveDevTenantId();

    const initialSnapshot = tenantId
        ? await getModelRegistryControlPlaneSnapshot(
            createSupabaseExperimentTrackingStore(getSupabaseServer()),
            tenantId,
        )
        : createEmptySnapshot();

    return <ModelRegistryControlPlaneClient initialSnapshot={initialSnapshot} />;
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
