import ModelTrustOperationsClient from '@/components/ModelTrustOperationsClient';
import {
    getModelTrustSnapshot,
    type ModelTrustSnapshot,
} from '@/lib/modelTrust/service';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function ModelTrustOperationsPage() {
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
                        Admin role required for public model-card publication, certification, and attestation workflows.
                    </p>
                </div>
            </div>
        );
    }

    const tenantId = session?.tenantId ?? resolveDevTenantId();
    const initialSnapshot = tenantId
        ? await getModelTrustSnapshot(getSupabaseServer(), tenantId)
        : createEmptySnapshot();

    return (
        <ModelTrustOperationsClient
            initialSnapshot={initialSnapshot}
            tenantId={tenantId ?? 'dev_tenant_001'}
        />
    );
}

function createEmptySnapshot(): ModelTrustSnapshot {
    return {
        tenant_id: 'dev_tenant_001',
        registry_entries: [],
        publications: [],
        certifications: [],
        attestations: [],
        summary: {
            published_cards: 0,
            active_certifications: 0,
            accepted_attestations: 0,
            pending_reviews: 0,
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
