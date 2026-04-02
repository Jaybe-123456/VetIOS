import PetPassOperationsClient from '@/components/PetPassOperationsClient';
import {
    getPetPassControlPlaneSnapshot,
    type PetPassControlPlaneSnapshot,
} from '@/lib/petpass/service';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function PetPassOperationsPage() {
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
                        Admin role required for PetPass network provisioning and owner-notification operations.
                    </p>
                </div>
            </div>
        );
    }

    const tenantId = session?.tenantId ?? resolveDevTenantId();
    const initialSnapshot = tenantId
        ? await getPetPassControlPlaneSnapshot(getSupabaseServer(), tenantId, { limit: 24 })
        : createEmptySnapshot();

    return (
        <PetPassOperationsClient
            initialSnapshot={initialSnapshot}
            tenantId={tenantId ?? 'dev_tenant_001'}
        />
    );
}

function createEmptySnapshot(): PetPassControlPlaneSnapshot {
    return {
        tenant_id: 'dev_tenant_001',
        owners: [],
        pet_profiles: [],
        owner_pet_links: [],
        clinic_owner_links: [],
        consents: [],
        notification_preferences: [],
        timeline_entries: [],
        notification_deliveries: [],
        summary: {
            owner_accounts: 0,
            linked_pets: 0,
            clinic_links: 0,
            granted_consents: 0,
            active_alerts: 0,
            queued_notifications: 0,
            sent_notifications: 0,
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
