import { resolveSessionTenant } from '@/lib/supabaseServer';

export type PublicCatalogSource = 'public_env' | 'session' | 'dev_bypass' | 'none';

export async function resolvePublicCatalogTenant(): Promise<{ tenantId: string | null; source: PublicCatalogSource }> {
    const publicTenantId = process.env.VETIOS_PUBLIC_TENANT_ID?.trim();
    if (publicTenantId) {
        return { tenantId: publicTenantId, source: 'public_env' };
    }

    const session = await resolveSessionTenant();
    if (session?.tenantId) {
        return { tenantId: session.tenantId, source: 'session' };
    }

    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        const devTenantId = process.env.VETIOS_DEV_TENANT_ID?.trim();
        if (devTenantId) {
            return { tenantId: devTenantId, source: 'dev_bypass' };
        }
    }

    return { tenantId: null, source: 'none' };
}
