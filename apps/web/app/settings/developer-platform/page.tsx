import DeveloperPlatformOperationsClient from '@/components/DeveloperPlatformOperationsClient';
import {
    getDeveloperPlatformSnapshot,
    type DeveloperPlatformSnapshot,
} from '@/lib/developerPlatform/service';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function DeveloperPlatformOperationsPage() {
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
                        Admin role required for partner onboarding, product publication, and credential issuance.
                    </p>
                </div>
            </div>
        );
    }

    const tenantId = session?.tenantId ?? resolveDevTenantId();
    const initialSnapshot = tenantId
        ? await getDeveloperPlatformSnapshot(getSupabaseServer(), tenantId)
        : createEmptySnapshot();

    return (
        <DeveloperPlatformOperationsClient
            initialSnapshot={initialSnapshot}
            tenantId={tenantId ?? 'dev_tenant_001'}
        />
    );
}

function createEmptySnapshot(): DeveloperPlatformSnapshot {
    return {
        tenant_id: 'dev_tenant_001',
        partners: [],
        api_products: [],
        onboarding_requests: [],
        partner_service_account_links: [],
        service_accounts: [],
        summary: {
            active_partners: 0,
            sandbox_partners: 0,
            published_products: 0,
            pending_requests: 0,
            approved_requests: 0,
            provisioned_service_accounts: 0,
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
