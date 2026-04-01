import { redirect } from 'next/navigation';
import { resolveSessionTenant } from '@/lib/supabaseServer';

function resolveDevBypassTenantId(): string | null {
    if (process.env.VETIOS_DEV_BYPASS !== 'true') {
        return null;
    }

    const configuredTenantId = process.env.VETIOS_DEV_TENANT_ID?.trim();
    return configuredTenantId || null;
}

export async function requirePageSession(nextPath: string) {
    const session = await resolveSessionTenant();
    if (session) {
        return session;
    }

    if (resolveDevBypassTenantId()) {
        return null;
    }

    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

