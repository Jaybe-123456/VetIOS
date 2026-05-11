import { getSupabaseServer } from '@/lib/supabaseServer';
import { hashPrivacyValue, type UploadSecurityGateResult } from './uploadSecurityGate';

export interface UploadSecurityEventInput {
    req: Request;
    requestId: string;
    sessionId?: string | null;
    fileName: string;
    declaredMime: string;
    fileSizeBytes: number;
    result: Extract<UploadSecurityGateResult, { ok: false }>;
}

export function writeUploadSecurityEvent(input: UploadSecurityEventInput): void {
    const url = new URL(input.req.url);
    const ip =
        input.req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || input.req.headers.get('x-real-ip')
        || 'unknown';
    const userAgent = input.req.headers.get('user-agent') || 'unknown';

    const event = {
        request_id: input.requestId,
        tenant_id: null,
        event_type: 'ask_vetios_upload_security_violation',
        severity: violationSeverity(input.result.violationType),
        risk_score: violationRiskScore(input.result.violationType),
        clone_suspected: false,
        blocked: true,
        origin: input.req.headers.get('origin'),
        host: input.req.headers.get('host') ?? url.host,
        endpoint: url.pathname,
        method: input.req.method,
        ip_hash: hashPrivacyValue(ip).slice(0, 16),
        user_agent_hash: hashPrivacyValue(userAgent).slice(0, 12),
        fingerprint: null,
        signals: [
            {
                id: input.result.violationType,
                reason: input.result.reason,
                declared_mime: input.declaredMime,
                detected_mime: input.result.detectedMime,
                file_size_bytes: input.fileSizeBytes,
            },
        ],
        actions: ['REJECTED'],
        metadata: {
            session_id: input.sessionId ?? null,
            violation_type: input.result.violationType,
            file_name_hash: hashPrivacyValue(input.fileName),
            declared_mime: input.declaredMime,
            detected_mime: input.result.detectedMime,
            file_size_bytes: input.fileSizeBytes,
            action_taken: 'REJECTED',
            content_hash: input.result.contentHash,
        },
        created_at: new Date().toISOString(),
    };

    console.warn(JSON.stringify({ _type: 'upload_security', ...event }));
    try {
        const client = getSupabaseServer();
        void (async () => {
            try {
                const { error } = await client.from('vetios_security_events').insert(event);
                if (error) console.warn('[upload-security] DB write failed (non-fatal):', error.message);
            } catch (error) {
                console.warn('[upload-security] DB write failed (non-fatal):', error);
            }
        })();
    } catch (error) {
        console.warn('[upload-security] DB write failed (non-fatal):', error);
    }
}

function violationSeverity(violation: string): 'low' | 'medium' | 'high' | 'critical' {
    if (violation === 'FLAGGED_HASH' || violation === 'POLYGLOT_DETECTED') return 'critical';
    if (violation === 'ARCHIVE_DETECTED' || violation === 'EMBEDDED_SCRIPT') return 'high';
    if (violation === 'MAGIC_BYTE_MISMATCH') return 'medium';
    return 'low';
}

function violationRiskScore(violation: string): number {
    if (violation === 'FLAGGED_HASH') return 95;
    if (violation === 'POLYGLOT_DETECTED') return 90;
    if (violation === 'EMBEDDED_SCRIPT') return 85;
    if (violation === 'ARCHIVE_DETECTED') return 80;
    if (violation === 'MAGIC_BYTE_MISMATCH') return 65;
    if (violation === 'SIZE_EXCEEDED') return 45;
    return 35;
}
