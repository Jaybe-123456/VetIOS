import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { PartnerPlan, QuotaCheckResult } from '@/lib/api/types';

const WINDOW_SECONDS = 60;

export async function checkAndIncrementQuota(
    partnerId: string,
    plan: PartnerPlan,
    client: SupabaseClient = getSupabaseServer(),
): Promise<QuotaCheckResult> {
    const now = new Date();
    const minuteWindowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const monthWindowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const { data, error } = await client.rpc('increment_api_quota_counters', {
        p_partner_id: partnerId,
        p_minute_window_start: minuteWindowStart.toISOString(),
        p_month_window_start: monthWindowStart.toISOString(),
    });

    if (error) {
        throw new Error(`Failed to update partner quota counters: ${error.message}`);
    }

    const record = Array.isArray(data) ? data[0] : data;
    const minuteCount = readCount(record?.minute_count);
    const monthCount = readCount(record?.month_count);
    const retryAfterSeconds = secondsUntilNextMinute(now);
    const resetAt = firstSecondOfNextUtcMonth(now);

    if (minuteCount > plan.requestsPerMinute + plan.burstAllowance) {
        return {
            allowed: false,
            reason: 'rate_limit',
            minuteCount,
            monthCount,
            plan,
            retryAfterSeconds,
        };
    }

    if (monthCount > plan.requestsPerMonth) {
        return {
            allowed: false,
            reason: 'quota_exceeded',
            minuteCount,
            monthCount,
            plan,
            resetAt,
        };
    }

    return {
        allowed: true,
        minuteCount,
        monthCount,
        plan,
    };
}

export function buildQuotaHeaders(input: {
    plan: PartnerPlan;
    minuteCount: number;
    monthCount: number;
    now?: Date;
}): Record<string, string> {
    const now = input.now ?? new Date();
    const nextMinute = Math.floor((now.getTime() + secondsUntilNextMinute(now) * 1000) / 1000);
    const nextMonth = Math.floor(firstSecondOfNextUtcMonth(now).getTime() / 1000);

    return {
        'X-RateLimit-Limit': String(input.plan.requestsPerMinute),
        'X-RateLimit-Remaining': String(Math.max(0, input.plan.requestsPerMinute - input.minuteCount)),
        'X-RateLimit-Reset': String(nextMinute),
        'X-RateLimit-Policy': `${input.plan.requestsPerMinute};w=${WINDOW_SECONDS}`,
        'X-Quota-Limit': String(input.plan.requestsPerMonth),
        'X-Quota-Remaining': String(Math.max(0, input.plan.requestsPerMonth - input.monthCount)),
        'X-Quota-Reset': String(nextMonth),
        'X-Partner-Plan': input.plan.name,
    };
}

function secondsUntilNextMinute(now: Date): number {
    return Math.max(1, WINDOW_SECONDS - now.getUTCSeconds());
}

function firstSecondOfNextUtcMonth(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function readCount(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}
