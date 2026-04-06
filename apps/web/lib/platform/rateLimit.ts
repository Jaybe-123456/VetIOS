import type { SupabaseClient } from '@supabase/supabase-js';

type RateLimitKind = 'inference' | 'evaluation' | 'simulate';

type RateWindowBucket = {
    timestamps: number[];
};

type TenantRateLimitRow = {
    tenant_id: string;
    inference_requests_per_minute: number;
    evaluation_requests_per_minute: number;
    simulate_requests_per_minute: number;
};

declare global {
    // eslint-disable-next-line no-var
    var __vetiosTenantRateLimitStore: Map<string, RateWindowBucket> | undefined;
}

const WINDOW_SECONDS = 60;

const DEFAULT_LIMITS: Record<RateLimitKind, number> = {
    inference: 60,
    evaluation: 120,
    simulate: 10,
};

function getRateLimitStore() {
    if (!globalThis.__vetiosTenantRateLimitStore) {
        globalThis.__vetiosTenantRateLimitStore = new Map<string, RateWindowBucket>();
    }

    return globalThis.__vetiosTenantRateLimitStore;
}

export async function enforceTenantRateLimit(
    client: SupabaseClient,
    tenantId: string,
    kind: RateLimitKind,
    overrideLimit?: number | null,
) {
    const config = await getTenantRateLimitConfig(client, tenantId);
    const limit = normalizePositiveInteger(
        overrideLimit ?? resolveLimit(config, kind),
        resolveLimit(config, kind),
    );
    const now = Date.now();
    const windowStart = now - (WINDOW_SECONDS * 1000);
    const key = `${tenantId}:${kind}`;
    const store = getRateLimitStore();
    const existing = store.get(key) ?? { timestamps: [] };
    const activeTimestamps = existing.timestamps.filter((timestamp) => timestamp > windowStart);

    if (activeTimestamps.length >= limit) {
        const retryAfterSeconds = Math.max(
            1,
            Math.ceil(((activeTimestamps[0] ?? now) + (WINDOW_SECONDS * 1000) - now) / 1000),
        );

        store.set(key, { timestamps: activeTimestamps });
        return {
            allowed: false,
            tenantId,
            limit,
            windowSeconds: WINDOW_SECONDS,
            retryAfterSeconds,
        } as const;
    }

    activeTimestamps.push(now);
    store.set(key, { timestamps: activeTimestamps });

    return {
        allowed: true,
        tenantId,
        limit,
        windowSeconds: WINDOW_SECONDS,
        retryAfterSeconds: 0,
    } as const;
}

export async function getTenantRateLimitConfig(
    client: SupabaseClient,
    tenantId: string,
) {
    const { data, error } = await client
        .from('tenant_rate_limits')
        .upsert({
            tenant_id: tenantId,
            inference_requests_per_minute: DEFAULT_LIMITS.inference,
            evaluation_requests_per_minute: DEFAULT_LIMITS.evaluation,
            simulate_requests_per_minute: DEFAULT_LIMITS.simulate,
        }, {
            onConflict: 'tenant_id',
            ignoreDuplicates: false,
        })
        .select('tenant_id,inference_requests_per_minute,evaluation_requests_per_minute,simulate_requests_per_minute')
        .single();

    if (error || !data) {
        throw new Error(`Failed to resolve tenant rate limits: ${error?.message ?? 'Unknown error'}`);
    }

    return data as TenantRateLimitRow;
}

export async function updateTenantRateLimitConfig(
    client: SupabaseClient,
    tenantId: string,
    patch: Partial<{
        inference_requests_per_minute: number;
        evaluation_requests_per_minute: number;
        simulate_requests_per_minute: number;
    }>,
) {
    const payload: Record<string, number | string> = {
        tenant_id: tenantId,
    };

    if (typeof patch.inference_requests_per_minute === 'number') {
        payload.inference_requests_per_minute = normalizePositiveInteger(
            patch.inference_requests_per_minute,
            DEFAULT_LIMITS.inference,
        );
    }
    if (typeof patch.evaluation_requests_per_minute === 'number') {
        payload.evaluation_requests_per_minute = normalizePositiveInteger(
            patch.evaluation_requests_per_minute,
            DEFAULT_LIMITS.evaluation,
        );
    }
    if (typeof patch.simulate_requests_per_minute === 'number') {
        payload.simulate_requests_per_minute = normalizePositiveInteger(
            patch.simulate_requests_per_minute,
            DEFAULT_LIMITS.simulate,
        );
    }

    const { data, error } = await client
        .from('tenant_rate_limits')
        .upsert(payload, { onConflict: 'tenant_id' })
        .select('tenant_id,inference_requests_per_minute,evaluation_requests_per_minute,simulate_requests_per_minute')
        .single();

    if (error || !data) {
        throw new Error(`Failed to update tenant rate limits: ${error?.message ?? 'Unknown error'}`);
    }

    return data as TenantRateLimitRow;
}

function resolveLimit(config: TenantRateLimitRow, kind: RateLimitKind) {
    if (kind === 'evaluation') {
        return normalizePositiveInteger(
            config.evaluation_requests_per_minute,
            DEFAULT_LIMITS.evaluation,
        );
    }

    if (kind === 'simulate') {
        return normalizePositiveInteger(
            config.simulate_requests_per_minute,
            DEFAULT_LIMITS.simulate,
        );
    }

    return normalizePositiveInteger(
        config.inference_requests_per_minute,
        DEFAULT_LIMITS.inference,
    );
}

function normalizePositiveInteger(value: number, fallback: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return fallback;
    }

    return Math.max(1, Math.round(value));
}
