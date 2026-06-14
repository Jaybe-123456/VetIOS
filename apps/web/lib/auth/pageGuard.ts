import { redirect } from 'next/navigation';
import { buildVerifyEmailPath } from '@/lib/auth/emailVerification';
import { resolveSessionState } from '@/lib/supabaseServer';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';

function resolveDevBypassTenantId(): string | null {
    if (process.env.VETIOS_DEV_BYPASS !== 'true') {
        return null;
    }

    const configuredTenantId = process.env.VETIOS_DEV_TENANT_ID?.trim();
    return configuredTenantId || null;
}

export async function requirePageSession(nextPath: string) {
    const sessionState = await resolveSessionState();
    if (sessionState.status === 'authenticated') {
        return sessionState;
    }

    if (sessionState.status === 'pending_email_verification') {
        redirect(buildVerifyEmailPath(nextPath));
    }

    if (resolveDevBypassTenantId()) {
        return null;
    }

    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

export async function requireAdminPageSession(nextPath: string) {
    const sessionState = await requirePageSession(nextPath);
    if (sessionState === null) {
        return null;
    }

    const user = (await sessionState.supabase.auth.getUser()).data.user ?? null;
    const role = resolveControlPlaneRole(user, 'session');
    const permissions = buildControlPlanePermissionSet(role);
    if (permissions.can_manage_infrastructure) {
        return sessionState;
    }

    redirect('/dashboard?access=admin_required');
}
