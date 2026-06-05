import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import {
    DEFAULT_PRODUCT_PLAN_KEY,
    PRODUCT_PLANS,
    canAccessConsole,
    getProductPlan,
    isProductPlanKey,
    type ProductPlan,
    type ProductPlanKey,
} from '@/lib/billing/productPlans';

type JsonRecord = Record<string, unknown>;

export type ProductEntitlementStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'suspended';

export interface AccountEntitlement {
    tenantId: string;
    userId: string;
    planKey: ProductPlanKey;
    status: ProductEntitlementStatus;
    billingProvider: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    onboardingCompletedAt: string | null;
    metadata: JsonRecord;
}

export interface ProductUsageSummary {
    periodStart: string;
    periodEnd: string;
    diagnosesUsed: number;
    diagnosisLimit: number | null;
    diagnosisRemaining: number | null;
    diagnosisUsagePct: number | null;
}

export interface AccountProductSummary {
    entitlement: AccountEntitlement;
    plan: ProductPlan;
    usage: ProductUsageSummary;
    canAccessConsole: boolean;
}

export class BillingSchemaNotReadyError extends Error {
    constructor(message = 'Billing storage is not active on this deployment yet.') {
        super(message);
        this.name = 'BillingSchemaNotReadyError';
    }
}

export async function resolveCurrentAccountProductSummary(): Promise<AccountProductSummary | null> {
    const session = await resolveSessionTenant();
    if (!session) return null;

    return resolveAccountProductSummary({
        tenantId: session.tenantId,
        userId: session.userId,
        client: getSupabaseServer(),
    });
}

export async function resolveAccountProductSummary(input: {
    tenantId: string;
    userId: string;
    client?: SupabaseClient;
}): Promise<AccountProductSummary> {
    const client = input.client ?? getSupabaseServer();
    const entitlement = await getOrCreateAccountEntitlement(client, {
        tenantId: input.tenantId,
        userId: input.userId,
    });
    const plan = getProductPlan(entitlement.planKey);
    const usage = await getProductUsageSummary(client, input.tenantId, plan);

    return {
        entitlement,
        plan,
        usage,
        canAccessConsole: canAccessConsole(plan.key),
    };
}

export async function getOrCreateAccountEntitlement(
    client: SupabaseClient,
    input: {
        tenantId: string;
        userId: string;
    },
): Promise<AccountEntitlement> {
    const existing = await loadAccountEntitlement(client, input.tenantId);
    if (existing) return existing;

    const { data, error } = await client
        .from('account_entitlements')
        .upsert({
            tenant_id: input.tenantId,
            user_id: input.userId,
            plan_key: DEFAULT_PRODUCT_PLAN_KEY,
            status: 'active',
            billing_provider: 'internal',
            onboarding_completed_at: null,
        }, { onConflict: 'tenant_id' })
        .select('*')
        .single();

    if (error || !data) {
        return buildDefaultEntitlement(input.tenantId, input.userId);
    }

    return mapAccountEntitlement(asRecord(data), input.tenantId, input.userId);
}

export async function updateAccountPlan(input: {
    tenantId: string;
    userId: string;
    planKey: ProductPlanKey;
    billingProvider?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    status?: ProductEntitlementStatus;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    onboardingCompleted?: boolean;
    metadata?: JsonRecord;
    client?: SupabaseClient;
}): Promise<AccountEntitlement> {
    const client = input.client ?? getSupabaseServer();
    const patch: JsonRecord = {
        tenant_id: input.tenantId,
        user_id: input.userId,
        plan_key: input.planKey,
        status: input.status ?? 'active',
        billing_provider: input.billingProvider ?? 'internal',
    };

    if (input.stripeCustomerId !== undefined) patch.stripe_customer_id = input.stripeCustomerId;
    if (input.stripeSubscriptionId !== undefined) patch.stripe_subscription_id = input.stripeSubscriptionId;
    if (input.currentPeriodStart !== undefined) patch.current_period_start = input.currentPeriodStart;
    if (input.currentPeriodEnd !== undefined) patch.current_period_end = input.currentPeriodEnd;
    if (input.onboardingCompleted) patch.onboarding_completed_at = new Date().toISOString();
    if (input.metadata) patch.metadata = input.metadata;

    const { data, error } = await client
        .from('account_entitlements')
        .upsert(patch, { onConflict: 'tenant_id' })
        .select('*')
        .single();

    if (error || !data) {
        if (isBillingSchemaMissingError(error)) {
            throw new BillingSchemaNotReadyError();
        }
        throw new Error(`Failed to update account plan: ${error?.message ?? 'Unknown error'}`);
    }

    await syncUserMetadataForPlan(client, input.userId, input.planKey);

    return mapAccountEntitlement(asRecord(data), input.tenantId, input.userId);
}

export async function loadAccountEntitlement(
    client: SupabaseClient,
    tenantId: string,
): Promise<AccountEntitlement | null> {
    const { data, error } = await client
        .from('account_entitlements')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

    if (error || !data) return null;
    return mapAccountEntitlement(asRecord(data), tenantId, readString(asRecord(data).user_id) ?? tenantId);
}

export async function getProductUsageSummary(
    client: SupabaseClient,
    tenantId: string,
    plan: ProductPlan,
): Promise<ProductUsageSummary> {
    const now = new Date();
    const periodStart = startOfUtcMonth(now);
    const periodEnd = startOfNextUtcMonth(now);

    const { data, error } = await client
        .from('product_usage_events')
        .select('quantity,event_type')
        .eq('tenant_id', tenantId)
        .gte('created_at', periodStart.toISOString())
        .lt('created_at', periodEnd.toISOString())
        .limit(10_000);

    const rows = error ? [] : data ?? [];
    const diagnosesUsed = rows
        .map((row) => asRecord(row))
        .filter((row) => readString(row.event_type) === 'diagnosis')
        .reduce((sum, row) => sum + (readNumber(row.quantity) ?? 0), 0);
    const diagnosisLimit = plan.monthlyDiagnosisLimit;
    const diagnosisRemaining = diagnosisLimit == null
        ? null
        : Math.max(0, diagnosisLimit - diagnosesUsed);
    const diagnosisUsagePct = diagnosisLimit == null || diagnosisLimit === 0
        ? null
        : Math.min(100, Math.round((diagnosesUsed / diagnosisLimit) * 100));

    return {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        diagnosesUsed,
        diagnosisLimit,
        diagnosisRemaining,
        diagnosisUsagePct,
    };
}

export async function recordProductUsageEvent(input: {
    tenantId: string;
    userId: string | null;
    eventType: 'diagnosis' | 'voice_extract' | 'ask_vetios' | 'api_request' | 'outcome_confirmation';
    source: 'clinical_case' | 'inference_api' | 'inference_console' | 'ask_vetios' | 'voice_mode' | 'developer_api' | 'outcome_api';
    requestId: string;
    quantity?: number;
    metadata?: JsonRecord;
    client?: SupabaseClient;
}): Promise<void> {
    try {
        const client = input.client ?? getSupabaseServer();
        await client.rpc('consume_product_usage_event', {
            p_tenant_id: input.tenantId,
            p_user_id: input.userId,
            p_event_type: input.eventType,
            p_source: input.source,
            p_request_id: input.requestId,
            p_quantity: input.quantity ?? 1,
            p_metadata: input.metadata ?? {},
        });
    } catch {
        // Usage metering must never break a clinical workflow.
    }
}

export function listPublicProductPlans(): ProductPlan[] {
    return PRODUCT_PLANS;
}

function mapAccountEntitlement(row: JsonRecord, fallbackTenantId: string, fallbackUserId: string): AccountEntitlement {
    const planKey = readString(row.plan_key);
    const status = readString(row.status);

    return {
        tenantId: readString(row.tenant_id) ?? fallbackTenantId,
        userId: readString(row.user_id) ?? fallbackUserId,
        planKey: isProductPlanKey(planKey) ? planKey : DEFAULT_PRODUCT_PLAN_KEY,
        status: isEntitlementStatus(status) ? status : 'active',
        billingProvider: readString(row.billing_provider),
        stripeCustomerId: readString(row.stripe_customer_id),
        stripeSubscriptionId: readString(row.stripe_subscription_id),
        currentPeriodStart: readString(row.current_period_start),
        currentPeriodEnd: readString(row.current_period_end),
        onboardingCompletedAt: readString(row.onboarding_completed_at),
        metadata: asRecord(row.metadata),
    };
}

function buildDefaultEntitlement(tenantId: string, userId: string): AccountEntitlement {
    return {
        tenantId,
        userId,
        planKey: DEFAULT_PRODUCT_PLAN_KEY,
        status: 'active',
        billingProvider: 'internal',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        onboardingCompletedAt: null,
        metadata: {},
    };
}

export function isBillingSchemaNotReadyError(error: unknown): error is BillingSchemaNotReadyError {
    return error instanceof BillingSchemaNotReadyError || isBillingSchemaMissingError(error);
}

function isBillingSchemaMissingError(error: unknown): boolean {
    const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message ?? '')
            : String(error ?? '');

    return message.includes('account_entitlements')
        && (
            message.includes('schema cache')
            || message.includes('Could not find the table')
            || message.includes('relation "public.account_entitlements" does not exist')
        );
}

async function syncUserMetadataForPlan(
    client: SupabaseClient,
    userId: string,
    planKey: ProductPlanKey,
): Promise<void> {
    try {
        const { data } = await client.auth.admin.getUserById(userId);
        const currentMetadata = asRecord(data.user?.user_metadata);
        const nextRole = canAccessConsole(planKey)
            ? planKey === 'developer'
                ? 'developer'
                : 'researcher'
            : 'clinician';

        await client.auth.admin.updateUserById(userId, {
            user_metadata: {
                ...currentMetadata,
                role: nextRole,
                vetios_plan_key: planKey,
            },
        });
    } catch {
        // Metadata sync is an access optimization. The database entitlement remains source of truth.
    }
}

function isEntitlementStatus(value: string | null): value is ProductEntitlementStatus {
    return value === 'active'
        || value === 'trialing'
        || value === 'past_due'
        || value === 'cancelled'
        || value === 'suspended';
}

function startOfUtcMonth(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfNextUtcMonth(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
