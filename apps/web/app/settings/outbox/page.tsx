import OutboxOperationsClient from '@/components/OutboxOperationsClient';
import { getOutboxQueueSnapshot, type OutboxQueueSnapshot } from '@/lib/eventPlane/outbox';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function OutboxOperationsPage() {
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
                        Admin role required for scheduled dispatch and dead-letter operations.
                    </p>
                </div>
            </div>
        );
    }

    const tenantId = session?.tenantId ?? resolveDevTenantId();
    const initialSnapshot = tenantId
        ? await getOutboxQueueSnapshot(getSupabaseServer(), tenantId, { limit: 60 })
        : createEmptyOutboxSnapshot();

    return (
        <OutboxOperationsClient
            initialSnapshot={initialSnapshot}
            tenantId={tenantId ?? 'dev_tenant_001'}
            scheduler={{
                cronPath: '/api/cron/outbox-dispatch',
                cronSchedule: '*/1 * * * *',
                batchSize: resolvePositiveInteger(process.env.VETIOS_OUTBOX_BATCH_SIZE, 25),
                maxBatches: resolvePositiveInteger(process.env.VETIOS_OUTBOX_CRON_MAX_BATCHES, 4),
                cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
            }}
        />
    );
}

function createEmptyOutboxSnapshot(): OutboxQueueSnapshot {
    return {
        counts: {
            pending: 0,
            processing: 0,
            retryable: 0,
            delivered: 0,
            dead_letter: 0,
        },
        recent_events: [],
        recent_attempts: [],
    };
}

function resolveDevTenantId(): string | null {
    if (process.env.VETIOS_DEV_BYPASS !== 'true') {
        return null;
    }

    const configuredTenantId = process.env.VETIOS_DEV_TENANT_ID?.trim();
    return configuredTenantId || null;
}

function resolvePositiveInteger(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
