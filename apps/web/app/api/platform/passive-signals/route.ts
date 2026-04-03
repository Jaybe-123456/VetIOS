import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    configurePassiveConnectorInstallation,
    getPassiveSignalOperationsSnapshot,
    installMarketplacePassiveConnector,
    requestPassiveConnectorSync,
    runDuePassiveConnectorSyncs,
} from '@/lib/passiveSignals/service';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

type PassiveSignalsAction =
    | {
        action: 'install_marketplace_connector';
        marketplace_id?: string;
        installation_name?: string | null;
        vendor_account_ref?: string | null;
        webhook_url?: string | null;
        interval_hours?: number | string | null;
    }
    | {
        action: 'update_connector_installation';
        connector_installation_id?: string;
        installation_name?: string | null;
        vendor_account_ref?: string | null;
        webhook_url?: string | null;
        sync_mode?: 'webhook_push' | 'scheduled_pull' | 'manual_file_drop' | null;
        interval_hours?: number | string | null;
        scheduler_enabled?: boolean | string | null;
        status?: 'active' | 'paused' | 'revoked' | null;
    }
    | {
        action: 'run_connector_sync';
        connector_installation_id?: string;
    }
    | {
        action: 'run_due_syncs';
    };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolvePassiveSignalsRouteContext(session);
    if (authContext.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: 'api/platform/passive-signals:GET',
            requirement: 'admin',
        });
    }

    const snapshot = await getPassiveSignalOperationsSnapshot(adminClient, authContext.tenantId);
    const response = NextResponse.json({ snapshot, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const parsed = await safeJson<PassiveSignalsAction>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolvePassiveSignalsRouteContext(session);
    if (authContext.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: `api/platform/passive-signals:${parsed.data.action ?? 'unknown'}`,
            requirement: 'admin',
        });
    }

    try {
        let result: Record<string, unknown> = {};
        if (parsed.data.action === 'install_marketplace_connector') {
            const created = await installMarketplacePassiveConnector({
                client: adminClient,
                tenantId: authContext.tenantId,
                actor: authContext.userId,
                marketplaceId: requireText(parsed.data.marketplace_id, 'marketplace_id'),
                installationName: parsed.data.installation_name ?? null,
                vendorAccountRef: parsed.data.vendor_account_ref ?? null,
                webhookUrl: parsed.data.webhook_url ?? null,
                intervalHours: normalizePositiveInteger(parsed.data.interval_hours),
            });
            result = {
                connector_installation: created.installation,
                generated_api_key: created.generated_api_key,
            };
        } else if (parsed.data.action === 'update_connector_installation') {
            result = {
                connector_installation: await configurePassiveConnectorInstallation({
                    client: adminClient,
                    tenantId: authContext.tenantId,
                    connectorInstallationId: requireText(parsed.data.connector_installation_id, 'connector_installation_id'),
                    installationName: parsed.data.installation_name ?? null,
                    vendorAccountRef: parsed.data.vendor_account_ref ?? null,
                    webhookUrl: parsed.data.webhook_url ?? undefined,
                    syncMode: normalizeSyncMode(parsed.data.sync_mode),
                    intervalHours: normalizePositiveInteger(parsed.data.interval_hours),
                    schedulerEnabled: normalizeBoolean(parsed.data.scheduler_enabled),
                    status: normalizeInstallationStatus(parsed.data.status),
                }),
            };
        } else if (parsed.data.action === 'run_connector_sync') {
            result = await requestPassiveConnectorSync({
                client: adminClient,
                tenantId: authContext.tenantId,
                actor: authContext.userId,
                connectorInstallationId: requireText(parsed.data.connector_installation_id, 'connector_installation_id'),
                reason: 'manual',
            });
        } else if (parsed.data.action === 'run_due_syncs') {
            result = {
                sync_runs: await runDuePassiveConnectorSyncs({
                    client: adminClient,
                    tenantId: authContext.tenantId,
                    actor: authContext.userId,
                }),
            };
        } else {
            return NextResponse.json({ error: 'Unsupported passive-signals action.', request_id: requestId }, { status: 400 });
        }

        const response = NextResponse.json({
            ...result,
            snapshot: await getPassiveSignalOperationsSnapshot(adminClient, authContext.tenantId),
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Passive-signal operation failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolvePassiveSignalsRouteContext(session: Awaited<ReturnType<typeof resolveSessionTenant>>): Promise<RouteAuthorizationContext> {
    if (session) {
        const actor = resolveRequestActor(session);
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'session',
            user,
        });
    }

    return buildRouteAuthorizationContext({
        tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        userId: process.env.VETIOS_DEV_USER_ID ?? null,
        authMode: process.env.VETIOS_DEV_BYPASS === 'true' ? 'dev_bypass' : 'session',
        user: null,
    });
}

function requireText(value: string | undefined, field: string): string {
    if (!value || value.trim().length === 0) {
        throw new Error(`${field} is required.`);
    }
    return value.trim();
}

function normalizePositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return null;
}

function normalizeBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return null;
}

function normalizeSyncMode(value: unknown): 'webhook_push' | 'scheduled_pull' | 'manual_file_drop' | null {
    return value === 'webhook_push' || value === 'scheduled_pull' || value === 'manual_file_drop'
        ? value
        : null;
}

function normalizeInstallationStatus(value: unknown): 'active' | 'paused' | 'revoked' | undefined {
    return value === 'active' || value === 'paused' || value === 'revoked'
        ? value
        : undefined;
}
