import PassiveSignalOperationsClient from '@/components/PassiveSignalOperationsClient';
import { getPassiveSignalOperationsSnapshot, type PassiveSignalOperationsSnapshot } from '@/lib/passiveSignals/service';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function PassiveSignalOperationsPage() {
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
                        Admin role required for connector installation, scheduler, and passive-signal sync operations.
                    </p>
                </div>
            </div>
        );
    }

    const tenantId = session?.tenantId ?? resolveDevTenantId();
    const initialSnapshot = tenantId
        ? await getPassiveSignalOperationsSnapshot(getSupabaseServer(), tenantId)
        : createEmptySnapshot();

    return (
        <PassiveSignalOperationsClient
            initialSnapshot={initialSnapshot}
            tenantId={tenantId ?? 'dev_tenant_001'}
        />
    );
}

function createEmptySnapshot(): PassiveSignalOperationsSnapshot {
    return {
        tenant_id: 'dev_tenant_001',
        marketplace: [],
        native_adapters: [],
        installations: [],
        native_connections: [],
        recent_native_sync_runs: [],
        recent_delivery_attempts: [],
        summary: {
            marketplace_templates: 0,
            live_templates: 0,
            native_adapter_templates: 0,
            native_active_connections: 0,
            native_authorization_required: 0,
            native_queued_syncs: 0,
            active_installations: 0,
            scheduled_installations: 0,
            webhook_installations: 0,
            recent_failed_syncs: 0,
            ready_connector_types: 0,
            missing_connector_types: 0,
            recent_signals_24h: 0,
            stale_signal_sources: 0,
        },
        readiness: {
            required_connector_types: 0,
            ready_connector_types: 0,
            quiet_connector_types: 0,
            stale_connector_types: 0,
            missing_connector_types: 0,
            recent_signals_24h: 0,
            recent_signals_7d: 0,
            stale_signal_sources: 0,
            coverage: [],
            privacy_contract: [],
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
