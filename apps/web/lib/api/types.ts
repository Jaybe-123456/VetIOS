export type PlanName = 'sandbox' | 'clinic' | 'research' | 'enterprise';
export type PartnerStatus = 'active' | 'suspended' | 'trial' | 'cancelled';
export type CredentialScope = 'inference' | 'outcomes' | 'dataset' | 'petpass' | 'simulation';
export type ChangeType = 'added' | 'changed' | 'deprecated' | 'removed';

export interface PartnerPlan {
    id: string;
    name: PlanName;
    displayName: string;
    requestsPerMinute: number;
    requestsPerMonth: number;
    burstAllowance: number;
    pricePer1kRequests: number | null;
    flatMonthlyUsd: number | null;
    stripePriceId: string | null;
    features: Record<CredentialScope, boolean>;
    isActive: boolean;
    createdAt: Date | null;
}

export interface ApiPartner {
    id: string;
    name: string;
    orgType: string | null;
    planId: string | null;
    plan?: PartnerPlan;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    billingEmail: string;
    status: PartnerStatus;
    trialEndsAt: Date | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    createdAt: Date | null;
    metadata: Record<string, unknown>;
}

export interface ApiCredential {
    id: string;
    partnerId: string | null;
    keyHash: string;
    keyPrefix: string;
    label: string | null;
    scopes: CredentialScope[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    isActive: boolean;
    createdAt: Date | null;
    revokedAt: Date | null;
}

export interface UsageEvent {
    id: string;
    partnerId: string | null;
    credentialId: string | null;
    endpoint: string;
    method: string;
    statusCode: number;
    responseTimeMs: number | null;
    requestSizeBytes: number | null;
    responseSizeBytes: number | null;
    region: string | null;
    aggregateType: string | null;
    isBillable: boolean;
    billedAt: Date | null;
    createdAt: Date | null;
}

export interface QuotaCheckResult {
    allowed: boolean;
    reason?: 'rate_limit' | 'quota_exceeded';
    minuteCount: number;
    monthCount: number;
    plan: PartnerPlan;
    retryAfterSeconds?: number;
    resetAt?: Date;
}

export interface AuthResult {
    success: boolean;
    status?: number;
    error?: string;
    partner?: ApiPartner;
    credential?: ApiCredential;
    plan?: PartnerPlan;
    quotaHeaders?: Record<string, string>;
}

export interface ChangelogEntry {
    id: string;
    version: string;
    releasedAt: Date | null;
    breaking: boolean;
    summary: string;
    changes: { type: ChangeType; description: string }[];
    sunsetVersion?: string | null;
    sunsetDate?: Date | null;
}

export interface DeveloperAnalyticsOverview {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    avg_response_time_ms: number;
    p95_response_time_ms: number;
    requests_by_day: Array<{ date: string; count: number }>;
    quota_used_pct: number;
    billable_requests: number;
    estimated_cost_usd: number;
    recent_credentials?: Array<{
        id: string;
        key_prefix: string;
        label: string | null;
        last_used_at: string | null;
        scopes: CredentialScope[];
        revoked_at: string | null;
    }>;
}

export interface DeveloperEndpointAnalytics {
    endpoint: string;
    method: string;
    count: number;
    success_rate: number;
    avg_ms: number;
    p95_ms: number;
}

export interface DeveloperErrorAnalytics {
    status_code: number;
    count: number;
    pct: number;
    sample_endpoint: string | null;
}

export interface DeveloperUsageTimeseriesPoint {
    window_start: string;
    count: number;
    avg_ms: number;
}

export interface DeveloperQuotaUsage {
    plan: PlanName;
    period_start: string;
    period_end: string;
    requests_used: number;
    requests_limit: number;
    pct_used: number;
    projected_month_end: number;
    on_track: boolean;
}
