import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type {
    ApiCredential,
    ApiPartner,
    ChangelogEntry,
    CredentialScope,
    DeveloperAnalyticsOverview,
    DeveloperEndpointAnalytics,
    DeveloperErrorAnalytics,
    DeveloperQuotaUsage,
    DeveloperUsageTimeseriesPoint,
    PartnerPlan,
    PlanName,
    UsageEvent,
} from '@/lib/api/types';

type JsonRecord = Record<string, unknown>;

const SIMPLE_SCOPES: CredentialScope[] = ['inference', 'outcomes', 'dataset', 'petpass', 'simulation'];

export async function listPartnerPlans(client: SupabaseClient = getSupabaseServer()): Promise<PartnerPlan[]> {
    const { data, error } = await client
        .from('api_partner_plans')
        .select('*')
        .order('requests_per_minute', { ascending: true });

    if (error) {
        throw new Error(`Failed to load partner plans: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPartnerPlan(asRecord(row)));
}

export async function getPartnerPlanById(
    client: SupabaseClient,
    planId: string | null | undefined,
): Promise<PartnerPlan | null> {
    if (!planId) return null;

    const { data, error } = await client
        .from('api_partner_plans')
        .select('*')
        .eq('id', planId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load partner plan: ${error.message}`);
    }

    return data ? mapPartnerPlan(asRecord(data)) : null;
}

export async function getPartnerPlanByName(
    client: SupabaseClient,
    name: string,
): Promise<PartnerPlan | null> {
    const { data, error } = await client
        .from('api_partner_plans')
        .select('*')
        .eq('name', name)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load partner plan by name: ${error.message}`);
    }

    return data ? mapPartnerPlan(asRecord(data)) : null;
}

export async function getApiPartnerById(
    client: SupabaseClient,
    partnerId: string,
): Promise<ApiPartner | null> {
    const { data, error } = await client
        .from('api_partners')
        .select('*')
        .eq('id', partnerId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load API partner: ${error.message}`);
    }

    if (!data) return null;

    const partner = mapApiPartner(asRecord(data));
    const plan = await getPartnerPlanById(client, partner.planId);
    if (plan) {
        partner.plan = plan;
    }
    return partner;
}

export async function resolvePartnerBySessionTenant(
    client: SupabaseClient,
    tenantId: string,
): Promise<ApiPartner | null> {
    const { data, error } = await client
        .from('api_partners')
        .select('*')
        .contains('metadata', { owner_tenant_id: tenantId })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to resolve partner for tenant: ${error.message}`);
    }

    if (!data) return null;

    const partner = mapApiPartner(asRecord(data));
    const plan = await getPartnerPlanById(client, partner.planId);
    if (plan) {
        partner.plan = plan;
    }
    return partner;
}

export async function getApiCredentialByHash(
    client: SupabaseClient,
    keyHash: string,
): Promise<ApiCredential | null> {
    const { data, error } = await client
        .from('api_credentials')
        .select('*')
        .eq('key_hash', keyHash)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load API credential: ${error.message}`);
    }

    return data ? mapApiCredential(asRecord(data)) : null;
}

export async function getApiCredentialById(
    client: SupabaseClient,
    credentialId: string,
): Promise<ApiCredential | null> {
    const { data, error } = await client
        .from('api_credentials')
        .select('*')
        .eq('id', credentialId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load API credential: ${error.message}`);
    }

    return data ? mapApiCredential(asRecord(data)) : null;
}

export function touchCredentialLastUsed(
    client: SupabaseClient,
    credentialId: string,
): void {
    void client
        .from('api_credentials')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', credentialId);
}

export async function listPartnerCredentials(
    client: SupabaseClient,
    partnerId: string,
): Promise<ApiCredential[]> {
    const { data, error } = await client
        .from('api_credentials')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

    if (error) {
        throw new Error(`Failed to list partner credentials: ${error.message}`);
    }

    return (data ?? []).map((row) => mapApiCredential(asRecord(row)));
}

export async function revokePartnerCredential(
    client: SupabaseClient,
    partnerId: string,
    credentialId: string,
): Promise<ApiCredential> {
    const { data, error } = await client
        .from('api_credentials')
        .update({
            is_active: false,
            status: 'revoked',
            revoked_at: new Date().toISOString(),
        })
        .eq('partner_id', partnerId)
        .eq('id', credentialId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to revoke partner credential: ${error?.message ?? 'Unknown error'}`);
    }

    return mapApiCredential(asRecord(data));
}

export async function updatePartnerStatus(
    client: SupabaseClient,
    partnerId: string,
    status: ApiPartner['status'],
): Promise<ApiPartner> {
    const { data, error } = await client
        .from('api_partners')
        .update({ status })
        .eq('id', partnerId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to update partner status: ${error?.message ?? 'Unknown error'}`);
    }

    const partner = mapApiPartner(asRecord(data));
    const plan = await getPartnerPlanById(client, partner.planId);
    if (plan) {
        partner.plan = plan;
    }
    return partner;
}

export async function updatePartnerPlan(
    client: SupabaseClient,
    partnerId: string,
    planId: string,
): Promise<ApiPartner> {
    const { data, error } = await client
        .from('api_partners')
        .update({ plan_id: planId })
        .eq('id', partnerId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to update partner plan: ${error?.message ?? 'Unknown error'}`);
    }

    const partner = mapApiPartner(asRecord(data));
    const plan = await getPartnerPlanById(client, partner.planId);
    if (plan) {
        partner.plan = plan;
    }
    return partner;
}

export async function listPartnersWithUsageSummary(
    client: SupabaseClient = getSupabaseServer(),
): Promise<Array<ApiPartner & { usage_summary: { requests_30d: number; last_request_at: string | null } }>> {
    const { data, error } = await client
        .from('api_partners')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        throw new Error(`Failed to list API partners: ${error.message}`);
    }

    return Promise.all((data ?? []).map(async (row) => {
        const partner = mapApiPartner(asRecord(row));
        const [plan, usage] = await Promise.all([
            getPartnerPlanById(client, partner.planId),
            getUsageSummaryForPartner(client, partner.id, 30),
        ]);
        if (plan) {
            partner.plan = plan;
        }
        return {
            ...partner,
            usage_summary: {
                requests_30d: usage.total_requests,
                last_request_at: usage.last_request_at,
            },
        };
    }));
}

export async function listChangelogEntries(
    client: SupabaseClient = getSupabaseServer(),
): Promise<ChangelogEntry[]> {
    const { data, error } = await client
        .from('api_changelog')
        .select('*')
        .order('released_at', { ascending: false });

    if (error) {
        throw new Error(`Failed to load API changelog: ${error.message}`);
    }

    return (data ?? []).map((row) => mapChangelogEntry(asRecord(row)));
}

export async function listPartnerUsageEvents(
    client: SupabaseClient,
    partnerId: string,
    options: {
        limit?: number;
        days?: number;
        endpoint?: string | null;
    } = {},
): Promise<UsageEvent[]> {
    const days = clampPositiveInteger(options.days, 30, 1, 365);
    const limit = clampPositiveInteger(options.limit, 250, 1, 10_000);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let query = client
        .from('api_usage_events')
        .select('*')
        .eq('partner_id', partnerId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (options.endpoint) {
        query = query.eq('endpoint', options.endpoint);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to load usage events: ${error.message}`);
    }

    return (data ?? []).map((row) => mapUsageEvent(asRecord(row)));
}

export function resolvePartnerOwnerTenantId(partner: ApiPartner | null | undefined): string | null {
    const candidate = partner?.metadata.owner_tenant_id;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
}

export function mapPartnerPlan(row: JsonRecord): PartnerPlan {
    return {
        id: readString(row.id) ?? '',
        name: normalizePlanName(readString(row.name)),
        displayName: readString(row.display_name) ?? 'Unknown',
        requestsPerMinute: readNumber(row.requests_per_minute) ?? 0,
        requestsPerMonth: readNumber(row.requests_per_month) ?? 0,
        burstAllowance: readNumber(row.burst_allowance) ?? 0,
        pricePer1kRequests: readNumber(row.price_per_1k_requests),
        flatMonthlyUsd: readNumber(row.flat_monthly_usd),
        stripePriceId: readString(row.stripe_price_id),
        features: normalizeFeatureFlags(asRecord(row.features)),
        isActive: readBoolean(row.is_active) ?? true,
        createdAt: readDate(row.created_at),
    };
}

export function mapApiPartner(row: JsonRecord): ApiPartner {
    return {
        id: readString(row.id) ?? '',
        name: readString(row.name) ?? 'Unknown partner',
        orgType: readString(row.org_type),
        planId: readString(row.plan_id),
        stripeCustomerId: readString(row.stripe_customer_id),
        stripeSubscriptionId: readString(row.stripe_subscription_id),
        billingEmail: readString(row.billing_email) ?? '',
        status: normalizePartnerStatus(readString(row.status)),
        trialEndsAt: readDate(row.trial_ends_at),
        currentPeriodStart: readDate(row.current_period_start),
        currentPeriodEnd: readDate(row.current_period_end),
        createdAt: readDate(row.created_at),
        metadata: asRecord(row.metadata),
    };
}

export function mapApiCredential(row: JsonRecord): ApiCredential {
    return {
        id: readString(row.id) ?? '',
        partnerId: readString(row.partner_id),
        keyHash: readString(row.key_hash) ?? '',
        keyPrefix: readString(row.key_prefix) ?? '',
        label: readString(row.label),
        scopes: normalizeCredentialScopes(readStringArray(row.scopes)),
        lastUsedAt: readDate(row.last_used_at),
        expiresAt: readDate(row.expires_at),
        isActive: readBoolean(row.is_active) ?? (readString(row.status) === 'active'),
        createdAt: readDate(row.created_at),
        revokedAt: readDate(row.revoked_at),
    };
}

export function mapUsageEvent(row: JsonRecord): UsageEvent {
    return {
        id: readString(row.id) ?? '',
        partnerId: readString(row.partner_id),
        credentialId: readString(row.credential_id),
        endpoint: readString(row.endpoint) ?? '',
        method: readString(row.method) ?? 'GET',
        statusCode: readNumber(row.status_code) ?? 0,
        responseTimeMs: readNumber(row.response_time_ms),
        requestSizeBytes: readNumber(row.request_size_bytes),
        responseSizeBytes: readNumber(row.response_size_bytes),
        region: readString(row.region),
        aggregateType: readString(row.aggregate_type),
        isBillable: readBoolean(row.is_billable) ?? true,
        billedAt: readDate(row.billed_at),
        createdAt: readDate(row.created_at),
    };
}

export function mapChangelogEntry(row: JsonRecord): ChangelogEntry {
    const changes = Array.isArray(row.changes) ? row.changes : [];
    return {
        id: readString(row.id) ?? '',
        version: readString(row.version) ?? '0.0.0',
        releasedAt: readDate(row.released_at),
        breaking: readBoolean(row.breaking) ?? false,
        summary: readString(row.summary) ?? '',
        changes: changes
            .map((change) => asRecord(change))
            .map((change) => ({
                type: normalizeChangeType(readString(change.type)),
                description: readString(change.description) ?? '',
            })),
        sunsetVersion: readString(row.sunset_version),
        sunsetDate: readDate(row.sunset_date),
    };
}

export function normalizeCredentialScopes(values: string[]): CredentialScope[] {
    const mapped = new Set<CredentialScope>();

    for (const value of values) {
        if (value === 'inference' || value === 'inference:write') mapped.add('inference');
        if (value === 'outcomes' || value === 'outcome:write') mapped.add('outcomes');
        if (value === 'dataset' || value === 'evaluation:read' || value === 'evaluation:write') mapped.add('dataset');
        if (value === 'petpass' || value === 'signals:connect' || value === 'signals:ingest') mapped.add('petpass');
        if (value === 'simulation' || value === 'simulation:write') mapped.add('simulation');
    }

    return SIMPLE_SCOPES.filter((scope) => mapped.has(scope));
}

function normalizeFeatureFlags(value: JsonRecord): Record<CredentialScope, boolean> {
    return {
        inference: readBoolean(value.inference) ?? false,
        outcomes: readBoolean(value.outcomes) ?? false,
        dataset: readBoolean(value.dataset) ?? false,
        petpass: readBoolean(value.petpass) ?? false,
        simulation: readBoolean(value.simulation) ?? false,
    };
}

function normalizePlanName(value: string | null): PlanName {
    if (value === 'clinic' || value === 'research' || value === 'enterprise') {
        return value;
    }
    return 'sandbox';
}

function normalizePartnerStatus(value: string | null): ApiPartner['status'] {
    if (value === 'suspended' || value === 'trial' || value === 'cancelled') {
        return value;
    }
    return 'active';
}

function normalizeChangeType(value: string | null): ChangelogEntry['changes'][number]['type'] {
    if (value === 'changed' || value === 'deprecated' || value === 'removed') {
        return value;
    }
    return 'added';
}

function clampPositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
    const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
    return Math.max(min, Math.min(max, candidate));
}

function asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function readDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

export async function getUsageSummaryForPartner(
    client: SupabaseClient,
    partnerId: string,
    days = 30,
): Promise<DeveloperAnalyticsOverview & { last_request_at: string | null }> {
    const rows = await listPartnerUsageEvents(client, partnerId, { days, limit: 10_000 });
    const currentQuota = await getQuotaUsageForPartner(client, partnerId);
    const recentCredentials = await listPartnerCredentials(client, partnerId);
    const responseTimes = rows
        .map((row) => row.responseTimeMs)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        .sort((left, right) => left - right);
    const successful = rows.filter((row) => row.statusCode >= 200 && row.statusCode < 400).length;
    const billableRequests = rows.filter((row) => row.isBillable).length;
    const plan = currentQuota.planDetails;
    const variableCost = plan?.pricePer1kRequests != null
        ? (billableRequests / 1000) * plan.pricePer1kRequests
        : 0;
    const flatCost = plan?.flatMonthlyUsd ?? 0;

    return {
        total_requests: rows.length,
        successful_requests: successful,
        failed_requests: rows.length - successful,
        avg_response_time_ms: responseTimes.length === 0
            ? 0
            : round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length, 2),
        p95_response_time_ms: responseTimes.length === 0 ? 0 : round(percentile(responseTimes, 0.95), 2),
        requests_by_day: groupByDay(rows),
        quota_used_pct: currentQuota.pct_used,
        billable_requests: billableRequests,
        estimated_cost_usd: round(flatCost + variableCost, 2),
        recent_credentials: recentCredentials.slice(0, 6).map((credential) => ({
            id: credential.id,
            key_prefix: credential.keyPrefix,
            label: credential.label,
            last_used_at: credential.lastUsedAt?.toISOString() ?? null,
            scopes: credential.scopes,
            revoked_at: credential.revokedAt?.toISOString() ?? null,
        })),
        last_request_at: rows[0]?.createdAt?.toISOString() ?? null,
    };
}

export async function getEndpointBreakdownForPartner(
    client: SupabaseClient,
    partnerId: string,
    days = 30,
): Promise<DeveloperEndpointAnalytics[]> {
    const rows = await listPartnerUsageEvents(client, partnerId, { days, limit: 10_000 });
    const grouped = new Map<string, UsageEvent[]>();

    for (const row of rows) {
        const key = `${row.method} ${row.endpoint}`;
        const existing = grouped.get(key) ?? [];
        existing.push(row);
        grouped.set(key, existing);
    }

    return [...grouped.entries()]
        .map(([key, events]) => {
            const [method, ...endpointParts] = key.split(' ');
            const responseTimes = events
                .map((event) => event.responseTimeMs)
                .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
                .sort((left, right) => left - right);
            const successCount = events.filter((event) => event.statusCode >= 200 && event.statusCode < 400).length;

            return {
                endpoint: endpointParts.join(' '),
                method,
                count: events.length,
                success_rate: events.length === 0 ? 0 : round((successCount / events.length) * 100, 2),
                avg_ms: responseTimes.length === 0
                    ? 0
                    : round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length, 2),
                p95_ms: responseTimes.length === 0 ? 0 : round(percentile(responseTimes, 0.95), 2),
            };
        })
        .sort((left, right) => right.count - left.count);
}

export async function getErrorBreakdownForPartner(
    client: SupabaseClient,
    partnerId: string,
    days = 30,
): Promise<DeveloperErrorAnalytics[]> {
    const rows = await listPartnerUsageEvents(client, partnerId, { days, limit: 10_000 });
    const errored = rows.filter((row) => row.statusCode >= 400);
    const total = errored.length || 1;
    const grouped = new Map<number, UsageEvent[]>();

    for (const row of errored) {
        const existing = grouped.get(row.statusCode) ?? [];
        existing.push(row);
        grouped.set(row.statusCode, existing);
    }

    return [...grouped.entries()]
        .map(([statusCode, events]) => ({
            status_code: statusCode,
            count: events.length,
            pct: round((events.length / total) * 100, 2),
            sample_endpoint: events[0]?.endpoint ?? null,
        }))
        .sort((left, right) => right.count - left.count);
}

export async function getUsageTimeseriesForPartner(
    client: SupabaseClient,
    partnerId: string,
    options: {
        days?: number;
        endpoint?: string | null;
        granularity?: 'hour' | 'day';
    } = {},
): Promise<DeveloperUsageTimeseriesPoint[]> {
    const days = clampPositiveInteger(options.days, 30, 1, 365);
    const granularity = options.granularity === 'hour' ? 'hour' : 'day';
    const { data, error } = await client.rpc('api_usage_timeseries', {
        p_partner_id: partnerId,
        p_days: days,
        p_endpoint: options.endpoint ?? null,
        p_granularity: granularity,
    });

    if (error) {
        throw new Error(`Failed to load usage timeseries: ${error.message}`);
    }

    return (data ?? []).map((row: unknown) => {
        const record = asRecord(row);
        return {
            window_start: readDate(record.window_start)?.toISOString() ?? new Date(0).toISOString(),
            count: readNumber(record.count) ?? 0,
            avg_ms: round(readNumber(record.avg_ms) ?? 0, 2),
        };
    });
}

export async function getQuotaUsageForPartner(
    client: SupabaseClient,
    partnerId: string,
): Promise<DeveloperQuotaUsage & { planDetails: PartnerPlan | null }> {
    const partner = await getApiPartnerById(client, partnerId);
    if (!partner || !partner.plan) {
        throw new Error('Partner or partner plan was not found.');
    }

    const now = new Date();
    const periodStart = startOfUtcMonth(now);
    const periodEnd = startOfNextUtcMonth(now);
    const { count, error } = await client
        .from('api_usage_events')
        .select('*', { count: 'exact', head: true })
        .eq('partner_id', partnerId)
        .gte('created_at', periodStart.toISOString())
        .lt('created_at', periodEnd.toISOString());

    if (error) {
        throw new Error(`Failed to load quota usage: ${error.message}`);
    }

    const requestsUsed = count ?? 0;
    const requestsLimit = partner.plan.requestsPerMonth;
    const pctUsed = requestsLimit === 0 ? 0 : round((requestsUsed / requestsLimit) * 100, 2);
    const elapsedDays = Math.max(1, Math.ceil((now.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)));
    const totalDays = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)));
    const projectedMonthEnd = Math.round((requestsUsed / elapsedDays) * totalDays);

    return {
        plan: partner.plan.name,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        requests_used: requestsUsed,
        requests_limit: requestsLimit,
        pct_used: pctUsed,
        projected_month_end: projectedMonthEnd,
        on_track: projectedMonthEnd <= requestsLimit,
        planDetails: partner.plan,
    };
}

function percentile(sortedValues: number[], percentileValue: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1));
    return sortedValues[index] ?? sortedValues[sortedValues.length - 1] ?? 0;
}

function groupByDay(rows: UsageEvent[]): Array<{ date: string; count: number }> {
    const grouped = new Map<string, number>();

    for (const row of rows) {
        const bucket = (row.createdAt ?? new Date(0)).toISOString().slice(0, 10);
        grouped.set(bucket, (grouped.get(bucket) ?? 0) + 1);
    }

    return [...grouped.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((left, right) => left.date.localeCompare(right.date));
}

function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function startOfUtcMonth(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfNextUtcMonth(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
