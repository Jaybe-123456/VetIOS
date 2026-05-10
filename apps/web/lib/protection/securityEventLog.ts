import { createHash } from 'crypto';
import type { VetiosSecurityAssessment } from './selfProtection';
import { getSupabaseServer } from '@/lib/supabaseServer';

export interface SelfProtectionEventInput {
    req: Request;
    requestId: string;
    tenantId?: string | null;
    assessment: VetiosSecurityAssessment;
    eventType?: string;
    fingerprint?: string | null;
    metadata?: Record<string, unknown>;
}

export function writeSelfProtectionEvent(input: SelfProtectionEventInput): void {
    const context = buildSecurityContext(input.req);
    const event = {
        request_id: input.requestId,
        tenant_id: input.tenantId ?? null,
        event_type: input.eventType ?? 'self_protection_assessment',
        severity: input.assessment.risk_level,
        risk_score: input.assessment.risk_score,
        clone_suspected: input.assessment.clone_suspected,
        blocked: input.assessment.blocked,
        origin: context.origin,
        host: context.host,
        endpoint: context.endpoint,
        method: context.method,
        ip_hash: context.ip_hash,
        user_agent_hash: context.user_agent_hash,
        fingerprint: input.fingerprint ?? null,
        signals: input.assessment.signals,
        actions: input.assessment.actions,
        metadata: input.metadata ?? {},
        created_at: new Date().toISOString(),
    };

    console.warn(JSON.stringify({ _type: 'security', ...event }));
    void persistSecurityEvent(event).catch((error: unknown) => {
        console.warn('[security] DB write failed (non-fatal):', error);
    });
}

function buildSecurityContext(req: Request): {
    origin: string | null;
    host: string | null;
    endpoint: string;
    method: string;
    ip_hash: string;
    user_agent_hash: string;
} {
    const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'unknown';
    const ua = req.headers.get('user-agent') || 'unknown';
    const url = new URL(req.url);

    return {
        origin: req.headers.get('origin'),
        host: req.headers.get('host') ?? url.host,
        endpoint: url.pathname,
        method: req.method,
        ip_hash: createHash('sha256').update(ip).digest('hex').slice(0, 16),
        user_agent_hash: createHash('sha256').update(ua).digest('hex').slice(0, 12),
    };
}

async function persistSecurityEvent(event: {
    request_id: string;
    tenant_id: string | null;
    event_type: string;
    severity: string;
    risk_score: number;
    clone_suspected: boolean;
    blocked: boolean;
    origin: string | null;
    host: string | null;
    endpoint: string;
    method: string;
    ip_hash: string;
    user_agent_hash: string;
    fingerprint: string | null;
    signals: unknown[];
    actions: string[];
    metadata: Record<string, unknown>;
    created_at: string;
}): Promise<void> {
    const client = getSupabaseServer();
    await client.from('vetios_security_events').insert(event);
}
