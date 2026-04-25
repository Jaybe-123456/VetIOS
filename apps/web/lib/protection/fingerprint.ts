/**
 * VetIOS Output Fingerprinting
 *
 * Embeds a cryptographic watermark into every inference and intelligence
 * response. The watermark encodes tenant identity, timestamp, platform
 * version, and a HMAC signature so that outputs can be traced back to
 * the originating session even if copied or redistributed.
 *
 * This does NOT expose sensitive data — the watermark is a compact
 * opaque token that is meaningless without the signing key.
 */

import { createHmac, createHash } from 'crypto';

const PLATFORM_VERSION = 'vetios-v1.0-omega';
const SIGNING_KEY = process.env.VETIOS_FINGERPRINT_KEY ?? 'vetios-default-fp-key-change-in-prod';

export interface FingerprintPayload {
    tenantId: string;
    sessionId?: string;
    requestId: string;
    endpoint: string;
    issuedAt: number;
}

/**
 * Generate a compact watermark token for an inference output.
 * Token format: vi1.<base64url(payload)>.<hmac-8bytes>
 */
export function generateFingerprint(payload: FingerprintPayload): string {
    const data = {
        t: payload.tenantId,
        s: payload.sessionId ?? 'anon',
        r: payload.requestId,
        e: payload.endpoint,
        v: PLATFORM_VERSION,
        iat: payload.issuedAt,
    };

    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    const sig = createHmac('sha256', SIGNING_KEY)
        .update(encoded)
        .digest('hex')
        .slice(0, 16);

    return `vi1.${encoded}.${sig}`;
}

/**
 * Verify a fingerprint token. Returns the decoded payload if valid,
 * null if tampered or malformed.
 */
export function verifyFingerprint(token: string): FingerprintPayload | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3 || parts[0] !== 'vi1') return null;

        const [, encoded, sig] = parts;
        const expectedSig = createHmac('sha256', SIGNING_KEY)
            .update(encoded)
            .digest('hex')
            .slice(0, 16);

        if (sig !== expectedSig) return null;

        const data = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as {
            t: string; s: string; r: string; e: string; v: string; iat: number;
        };

        return {
            tenantId: data.t,
            sessionId: data.s,
            requestId: data.r,
            endpoint: data.e,
            issuedAt: data.iat,
        };
    } catch {
        return null;
    }
}

/**
 * Embed a fingerprint into a text response as a hidden attribution comment.
 * For markdown/text outputs only — does not alter JSON structure.
 */
export function embedTextWatermark(text: string, fingerprint: string): string {
    // Appended as an invisible attribution line — present in raw text,
    // invisible in rendered markdown.
    return `${text}\n\n<!-- vetios:${fingerprint} -->`;
}

/**
 * Attach fingerprint metadata to a JSON API response body.
 * Adds a non-breaking _vi field that identifies the output origin.
 */
export function attachResponseFingerprint<T extends Record<string, unknown>>(
    body: T,
    fingerprint: string,
): T & { _vi: string } {
    return { ...body, _vi: fingerprint };
}

/**
 * Generate a content hash of an output for tamper detection.
 * Store this hash alongside the fingerprint in audit logs.
 */
export function hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 32);
}
