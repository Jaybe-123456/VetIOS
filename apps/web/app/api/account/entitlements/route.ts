import { NextResponse } from 'next/server';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { canAccessConsole, DEFAULT_PRODUCT_PLAN_KEY, getProductPlan } from '@/lib/billing/productPlans';
import { listPublicProductPlans, resolveAccountProductSummary, type AccountProductSummary } from '@/lib/billing/entitlements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTITLEMENT_TIMEOUT_MS = 4_500;

export async function GET() {
    const session = await resolveSessionTenant();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const summary = await withTimeout(
            resolveAccountProductSummary({
                tenantId: session.tenantId,
                userId: session.userId,
                client: getSupabaseServer(),
            }),
            ENTITLEMENT_TIMEOUT_MS,
            'account_entitlements_timeout',
        );

        return NextResponse.json({
            account: summary,
            plans: listPublicProductPlans(),
        });
    } catch (error) {
        console.warn('[billing] entitlement summary degraded:', error);
        return NextResponse.json({
            account: buildFallbackAccountSummary(session.tenantId, session.userId),
            plans: listPublicProductPlans(),
            degraded: true,
            error: error instanceof Error ? error.message : 'account_entitlements_unavailable',
        }, {
            headers: {
                'Cache-Control': 'no-store',
            },
        });
    }
}

function buildFallbackAccountSummary(tenantId: string, userId: string): AccountProductSummary {
    const plan = getProductPlan(DEFAULT_PRODUCT_PLAN_KEY);
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    const diagnosisLimit = plan.monthlyDiagnosisLimit;

    return {
        entitlement: {
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
        },
        plan,
        usage: {
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            diagnosesUsed: 0,
            diagnosisLimit,
            diagnosisRemaining: diagnosisLimit,
            diagnosisUsagePct: diagnosisLimit == null ? null : 0,
        },
        canAccessConsole: canAccessConsole(plan.key),
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}
