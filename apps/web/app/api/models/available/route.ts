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
    blocked: boolean;
    block_reason: string | null;
    blocked_at: string | null;
    blocked_by_simulation_id: string | null;
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

        const tenantScope = actor.role !== 'system_admin' || tenantId ? tenantId : null;
        const [registryRows, inferenceRows] = await Promise.all([
            fetchRegistryRows(supabase, tenantScope),
            fetchInferenceRows(supabase, tenantScope),
        ]);

        const availableModels = buildAvailableModelRows({
            registryRows,
            inferenceRows,
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

async function fetchRegistryRows(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string | null,
) {
    const enrichedSelect = 'model_name,model_version,lifecycle_status,registry_role,updated_at,created_at,blocked,block_reason,blocked_at,blocked_by_simulation_id';
    const legacySelect = 'model_name,model_version,lifecycle_status,registry_role,updated_at,created_at';

    const enriched = await applyTenantScope(
        supabase.from('model_registry').select(enrichedSelect),
        tenantId,
    );

    if (!enriched.error) {
        return (enriched.data ?? []) as Array<Record<string, unknown>>;
    }

    if (isMissingRegistryColumn(enriched.error) || isMissingRegistryTable(enriched.error)) {
        if (isMissingRegistryTable(enriched.error)) {
            console.warn('[models/available] model_registry missing from schema cache, falling back to inference history only.');
            return [];
        }

        const legacy = await applyTenantScope(
            supabase.from('model_registry').select(legacySelect),
            tenantId,
        );
        if (!legacy.error) {
            console.warn('[models/available] model_registry is missing blocked-model columns; using legacy registry projection.');
            return (legacy.data ?? []) as Array<Record<string, unknown>>;
        }
        if (isMissingRegistryTable(legacy.error)) {
            console.warn('[models/available] model_registry missing from schema cache after legacy fallback, using inference history only.');
            return [];
        }
        throw legacy.error;
    }

    throw enriched.error;
}

async function fetchInferenceRows(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string | null,
) {
    const result = await applyTenantScope(
        supabase
            .from('ai_inference_events')
            .select('model_name,model_version,created_at')
            .order('created_at', { ascending: false })
            .limit(200),
        tenantId,
    );

    if (result.error) {
        throw result.error;
    }

    return (result.data ?? []) as Array<Record<string, unknown>>;
}

function applyTenantScope<T extends { eq: (column: string, value: string) => T }>(
    query: T,
    tenantId: string | null,
) {
    return tenantId ? query.eq('tenant_id', tenantId) : query;
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
        const isBlocked = row.blocked === true;
        const nextPriority = computeModelPriority({
            source: 'registry',
            lifecycleStatus,
            registryRole,
            blocked: isBlocked,
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
                preferred: nextPriority >= 4 && !isBlocked,
                blocked: isBlocked,
                block_reason: readText(row.block_reason),
                blocked_at: readText(row.blocked_at),
                blocked_by_simulation_id: readText(row.blocked_by_simulation_id),
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
            blocked: false,
            block_reason: null,
            blocked_at: null,
            blocked_by_simulation_id: null,
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
    blocked?: boolean;
}) {
    if (input.blocked) {
        return -1;
    }
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

function isMissingRegistryColumn(error: unknown) {
    const message = readErrorMessage(error);
    return message.includes('model_registry.blocked')
        || message.includes('block_reason')
        || message.includes('blocked_at')
        || message.includes('blocked_by_simulation_id');
}

function isMissingRegistryTable(error: unknown) {
    const message = readErrorMessage(error);
    return message.includes("could not find the table 'public.model_registry'")
        || message.includes('relation "public.model_registry" does not exist')
        || message.includes('relation "model_registry" does not exist');
}

function readErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message.toLowerCase();
    }
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') {
            return message.toLowerCase();
        }
    }
    return '';
}
