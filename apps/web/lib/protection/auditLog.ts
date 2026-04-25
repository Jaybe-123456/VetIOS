/**
 * VetIOS Audit Logger
 *
 * Stamps every API call with: tenant identity, hashed IP, endpoint,
 * HTTP method, status code, response time, request ID, user agent hash,
 * and fingerprint. Logs are written to:
 *   1. Console (structured JSON — picked up by Vercel log drains)
 *   2. Supabase audit_log table (when available)
 *
 * Retention policy: 90 days minimum (enforced at DB level via row TTL
 * or a scheduled cleanup job — see supabase/migrations/).
 */

import { createHash } from 'crypto';
import { getSupabaseServer } from '@/lib/supabaseServer';

export interface AuditEvent {
    request_id: string;
    tenant_id?: string | null;
    endpoint: string;
    method: string;
    status_code: number;
    latency_ms: number;
    ip_hash: string;
    user_agent_hash: string;
    fingerprint?: string;
    content_hash?: string;
    mode?: string;           // clinical | educational | general
    blocked?: boolean;
    block_reason?: string;
    metadata?: Record<string, unknown>;
    timestamp: string;
}

/**
 * Write an audit event. Fire-and-forget — never throws, never blocks
 * the response path.
 */
export function writeAuditLog(event: AuditEvent): void {
    // 1. Structured console log — Vercel picks this up automatically
    console.log(JSON.stringify({ _type: 'audit', ...event }));

    // 2. Async DB write — non-blocking
    void persistAuditEvent(event).catch((err: unknown) => {
        console.warn('[audit] DB write failed (non-fatal):', err);
    });
}

async function persistAuditEvent(event: AuditEvent): Promise<void> {
    try {
        const client = getSupabaseServer();
        await client.from('vetios_audit_log').insert({
            request_id:     event.request_id,
            tenant_id:      event.tenant_id ?? null,
            endpoint:       event.endpoint,
            method:         event.method,
            status_code:    event.status_code,
            latency_ms:     event.latency_ms,
            ip_hash:        event.ip_hash,
            user_agent_hash: event.user_agent_hash,
            fingerprint:    event.fingerprint ?? null,
            content_hash:   event.content_hash ?? null,
            mode:           event.mode ?? null,
            blocked:        event.blocked ?? false,
            block_reason:   event.block_reason ?? null,
            metadata:       event.metadata ?? null,
            created_at:     event.timestamp,
        });
    } catch {
        // Supabase unavailable — log already written to console above.
    }
}

/**
 * Build the audit event fields derived from the request.
 */
export function buildAuditContext(req: Request): {
    ip_hash: string;
    user_agent_hash: string;
    endpoint: string;
    method: string;
} {
    const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'unknown';

    const ua = req.headers.get('user-agent') || 'unknown';
    const url = new URL(req.url);

    return {
        ip_hash: createHash('sha256').update(ip).digest('hex').slice(0, 16),
        user_agent_hash: createHash('sha256').update(ua).digest('hex').slice(0, 12),
        endpoint: url.pathname,
        method: req.method,
    };
}
