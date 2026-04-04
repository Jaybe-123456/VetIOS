import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { buildQuotaHeaders, checkAndIncrementQuota } from '@/lib/api/quota-service';
import {
    getApiCredentialByHash,
    getApiPartnerById,
    getPartnerPlanById,
    touchCredentialLastUsed,
} from '@/lib/api/partner-service';
import type { ApiCredential, ApiPartner, AuthResult, CredentialScope, PartnerPlan } from '@/lib/api/types';

const RATE_LIMIT_DOCS = 'https://www.vetios.tech/docs/api/rate-limits';
const BILLING_UPGRADE_URL = 'https://www.vetios.tech/developer/billing';

export async function authenticatePartnerRequest(request: NextRequest): Promise<AuthResult> {
    const base = await resolvePartnerApiKeyAccess(request);
    if (!base.success || !base.partner || !base.credential || !base.plan) {
        return base;
    }

    const requestedScope = resolveScopeFromPath(new URL(request.url).pathname);
    if (requestedScope && !base.credential.scopes.includes(requestedScope)) {
        return {
            success: false,
            status: 403,
            error: 'Insufficient scope',
            partner: base.partner,
            credential: base.credential,
            plan: base.plan,
            quotaHeaders: buildQuotaHeaders({ plan: base.plan, minuteCount: 0, monthCount: 0 }),
        };
    }

    if (requestedScope && !planSupportsScope(base.plan, requestedScope)) {
        return {
            success: false,
            status: 403,
            error: `Plan does not include ${requestedScope} access`,
            partner: base.partner,
            credential: base.credential,
            plan: base.plan,
            quotaHeaders: buildQuotaHeaders({ plan: base.plan, minuteCount: 0, monthCount: 0 }),
        };
    }

    const quota = await checkAndIncrementQuota(base.partner.id, base.plan);
    const quotaHeaders = buildQuotaHeaders({
        plan: base.plan,
        minuteCount: quota.minuteCount,
        monthCount: quota.monthCount,
    });

    if (!quota.allowed) {
        return {
            success: false,
            status: 429,
            error: quota.reason === 'quota_exceeded' ? 'monthly_quota_exceeded' : 'rate_limit_exceeded',
            partner: base.partner,
            credential: base.credential,
            plan: base.plan,
            quotaHeaders,
        };
    }

    touchCredentialLastUsed(getSupabaseServer(), base.credential.id);

    return {
        success: true,
        partner: base.partner,
        credential: base.credential,
        plan: base.plan,
        quotaHeaders,
    };
}

export async function resolvePartnerApiKeyAccess(request: Request): Promise<AuthResult> {
    const rawKey = extractBearerApiKey(request);
    if (!rawKey) {
        return { success: false, status: 401, error: 'Invalid API key' };
    }

    const client = getSupabaseServer();
    const credential = await getApiCredentialByHash(client, sha256(rawKey));
    if (!credential) {
        return { success: false, status: 401, error: 'Invalid API key' };
    }

    if (!credential.isActive) {
        return { success: false, status: 401, error: 'Invalid API key' };
    }

    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
        return { success: false, status: 401, error: 'Invalid API key' };
    }

    if (!credential.partnerId) {
        return { success: false, status: 403, error: 'API key is not linked to a partner account' };
    }

    const partner = await getApiPartnerById(client, credential.partnerId);
    if (!partner) {
        return { success: false, status: 403, error: 'Partner account not found' };
    }

    if (partner.status === 'suspended') {
        return { success: false, status: 403, error: 'Partner account suspended', partner, credential };
    }

    if (partner.status === 'cancelled') {
        return { success: false, status: 403, error: 'Partner account cancelled', partner, credential };
    }

    const plan = partner.plan ?? await getPartnerPlanById(client, partner.planId);
    if (!plan || !plan.isActive) {
        return { success: false, status: 403, error: 'Partner plan is not available', partner, credential };
    }

    return {
        success: true,
        partner,
        credential,
        plan,
    };
}

export function buildPartnerAuthFailureResponse(result: AuthResult) {
    const headers = new Headers();
    if (result.quotaHeaders) {
        for (const [key, value] of Object.entries(result.quotaHeaders)) {
            headers.set(key, value);
        }
    }

    if (result.status === 429 && result.error === 'rate_limit_exceeded' && result.plan) {
        const retryAfter = deriveRetryAfterSeconds(headers);
        headers.set('Retry-After', String(retryAfter));
        return NextResponse.json({
            error: 'rate_limit_exceeded',
            message: `You have exceeded ${result.plan.requestsPerMinute} requests/minute`,
            retry_after: retryAfter,
            docs: RATE_LIMIT_DOCS,
        }, { status: 429, headers });
    }

    if (result.status === 429 && result.error === 'monthly_quota_exceeded' && result.plan) {
        const quotaReset = headers.get('X-Quota-Reset');
        const resetIso = quotaReset ? new Date(Number(quotaReset) * 1000).toISOString() : null;
        return NextResponse.json({
            error: 'monthly_quota_exceeded',
            message: `Your ${result.plan.name} plan allows ${result.plan.requestsPerMonth} requests/month`,
            quota_resets_at: resetIso,
            upgrade_url: BILLING_UPGRADE_URL,
        }, { status: 429, headers });
    }

    return NextResponse.json(
        { error: result.error ?? 'Unauthorized' },
        { status: result.status ?? 401, headers },
    );
}

function extractBearerApiKey(request: Request): string | null {
    const header = request.headers.get('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
        return null;
    }

    const token = header.slice(7).trim();
    return token.startsWith('vios_k1_') ? token : null;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function resolveScopeFromPath(pathname: string): CredentialScope | null {
    if (pathname.includes('/api/v1/inference/adversarial')) return 'simulation';
    if (pathname.includes('/api/v1/inference')) return 'inference';
    if (pathname.includes('/api/v1/outcomes')) return 'outcomes';
    if (pathname.includes('/api/v1/dataset')) return 'dataset';
    if (pathname.includes('/api/v1/models')) return 'inference';
    if (pathname.includes('/api/v1/petpass')) return 'petpass';
    return null;
}

function planSupportsScope(plan: PartnerPlan, scope: CredentialScope): boolean {
    return Boolean(plan.features[scope]);
}

function deriveRetryAfterSeconds(headers: Headers): number {
    const reset = headers.get('X-RateLimit-Reset');
    if (!reset) return 60;
    const resetSeconds = Number(reset);
    if (!Number.isFinite(resetSeconds)) return 60;
    return Math.max(1, Math.ceil(resetSeconds - Date.now() / 1000));
}
