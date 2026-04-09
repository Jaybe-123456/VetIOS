import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AvailableModelRow = {
    model_version: string;
    model_name: string | null;
    lifecycle_status: string | null;
    registry_role: string | null;
    source: 'registry' | 'inference';
    last_seen_at: string | null;
    preferred: boolean;
};

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['inference:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });

        let registryQuery = supabase
            .from('model_registry')
            .select('model_name,model_version,lifecycle_status,registry_role,updated_at,created_at');
        let inferenceQuery = supabase
            .from('ai_inference_events')
            .select('model_name,model_version,created_at')
            .order('created_at', { ascending: false })
            .limit(200);

        if (actor.role !== 'system_admin' || tenantId) {
            registryQuery = registryQuery.eq('tenant_id', tenantId);
            inferenceQuery = inferenceQuery.eq('tenant_id', tenantId);
        }

        const [{ data: registryRows, error: registryError }, { data: inferenceRows, error: inferenceError }] = await Promise.all([
            registryQuery,
            inferenceQuery,
        ]);

        if (registryError) {
            throw registryError;
        }
        if (inferenceError) {
            throw inferenceError;
        }

        const availableModels = buildAvailableModelRows({
            registryRows: (registryRows ?? []) as Array<Record<string, unknown>>,
            inferenceRows: (inferenceRows ?? []) as Array<Record<string, unknown>>,
        });

        const response = NextResponse.json({
            data: availableModels,
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
                request_id: requestId,
            },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = error instanceof PlatformRateLimitError
            ? NextResponse.json({
                data: buildRateLimitErrorPayload(error),
                meta: {
                    tenant_id: error.tenantId,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error.code,
                    message: error.message,
                },
            }, { status: error.status })
            : NextResponse.json({
                data: null,
                meta: {
                    tenant_id: null,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error instanceof PlatformAuthError ? error.code : 'models_available_failed',
                    message: error instanceof Error ? error.message : 'Failed to load available model versions.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function buildAvailableModelRows(input: {
    registryRows: Array<Record<string, unknown>>;
    inferenceRows: Array<Record<string, unknown>>;
}): AvailableModelRow[] {
    const models = new Map<string, AvailableModelRow & { priority: number; timestamp_ms: number }>();

    for (const row of input.registryRows) {
        const modelVersion = readText(row.model_version);
        if (!modelVersion) continue;

        const lifecycleStatus = readText(row.lifecycle_status);
        const registryRole = readText(row.registry_role);
        const lastSeenAt = readText(row.updated_at) ?? readText(row.created_at);
        const nextPriority = computeModelPriority({
            source: 'registry',
            lifecycleStatus,
            registryRole,
        });
        const nextTimestamp = parseTimestamp(lastSeenAt);
        const existing = models.get(modelVersion);

        if (!existing || nextPriority > existing.priority || (nextPriority === existing.priority && nextTimestamp > existing.timestamp_ms)) {
            models.set(modelVersion, {
                model_version: modelVersion,
                model_name: readText(row.model_name),
                lifecycle_status: lifecycleStatus,
                registry_role: registryRole,
                source: 'registry',
                last_seen_at: lastSeenAt,
                preferred: nextPriority >= 4,
                priority: nextPriority,
                timestamp_ms: nextTimestamp,
            });
        }
    }

    for (const row of input.inferenceRows) {
        const modelVersion = readText(row.model_version);
        if (!modelVersion || models.has(modelVersion)) continue;

        const lastSeenAt = readText(row.created_at);
        const nextPriority = computeModelPriority({
            source: 'inference',
            lifecycleStatus: null,
            registryRole: null,
        });
        models.set(modelVersion, {
            model_version: modelVersion,
            model_name: readText(row.model_name),
            lifecycle_status: null,
            registry_role: null,
            source: 'inference',
            last_seen_at: lastSeenAt,
            preferred: false,
            priority: nextPriority,
            timestamp_ms: parseTimestamp(lastSeenAt),
        });
    }

    return Array.from(models.values())
        .sort((left, right) => {
            if (right.priority !== left.priority) return right.priority - left.priority;
            if (right.timestamp_ms !== left.timestamp_ms) return right.timestamp_ms - left.timestamp_ms;
            return right.model_version.localeCompare(left.model_version);
        })
        .map(({ priority: _priority, timestamp_ms: _timestampMs, ...row }) => row);
}

function computeModelPriority(input: {
    source: 'registry' | 'inference';
    lifecycleStatus: string | null;
    registryRole: string | null;
}) {
    if (input.source === 'registry') {
        if (input.lifecycleStatus === 'staging' && input.registryRole === 'challenger') return 6;
        if (input.lifecycleStatus === 'candidate') return 5;
        if (input.registryRole === 'challenger') return 5;
        if (input.lifecycleStatus === 'production' && input.registryRole === 'champion') return 4;
        if (input.lifecycleStatus === 'training') return 3;
        if (input.lifecycleStatus === 'archived') return 1;
        return 2;
    }

    return 0;
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseTimestamp(value: string | null) {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
