/**
 * VetIOS Origin Guard
 *
 * Enforces that API requests originate from authorised domains only.
 * Requests from unrecognised origins are rejected with a 403.
 *
 * This guards against:
 *   - Unauthorised clones of the frontend calling the real API
 *   - Third-party scrapers embedding the API in an unapproved surface
 *   - Cross-origin abuse from domains not in the allowlist
 *
 * Browser requests always send an Origin header. Server-to-server
 * calls (no Origin) are permitted but must carry a valid API key.
 */

import { NextResponse } from 'next/server';
import { getConfiguredSiteOrigin } from '@/lib/site';

const AUTHORISED_ORIGINS: ReadonlySet<string> = new Set([
    'https://www.vetios.tech',
    'https://vetios.tech',
    'https://app.vetios.tech',
    // Vercel preview deployments — matched by suffix below
]);

const AUTHORISED_PREVIEW_SUFFIX = '.vercel.app';

const DEV_ORIGINS: ReadonlySet<string> = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
]);

export function getAuthorisedOriginList(): string[] {
    const configured = getConfiguredSiteOrigin();
    const envOrigins = (process.env.VETIOS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => normalizeOrigin(origin))
        .filter((origin): origin is string => Boolean(origin));

    return [...new Set([
        ...AUTHORISED_ORIGINS,
        ...envOrigins,
        ...(configured ? [configured] : []),
    ])];
}

export function isAuthorisedOrigin(origin: string | null): boolean {
    if (!origin) {
        return true;
    }

    const normalized = normalizeOrigin(origin);
    if (!normalized) {
        return false;
    }

    const isDev = process.env.NODE_ENV === 'development' || process.env.VETIOS_DEV_BYPASS === 'true';
    return (
        getAuthorisedOriginList().includes(normalized) ||
        normalized.endsWith(AUTHORISED_PREVIEW_SUFFIX) ||
        (isDev && DEV_ORIGINS.has(normalized))
    );
}

export interface OriginGuardResult {
    allowed: boolean;
    origin: string | null;
    response: NextResponse | null;
}

/**
 * Check whether the request origin is authorised.
 *
 * Rules:
 *   1. No Origin header → server-to-server call → allowed (API key auth
 *      handles security for these separately via apiGuard).
 *   2. Origin matches allowlist → allowed.
 *   3. Origin ends with .vercel.app → Vercel preview → allowed.
 *   4. NODE_ENV === development → localhost allowed.
 *   5. Anything else → 403 Forbidden.
 */
export function checkOrigin(req: Request, requestId: string): OriginGuardResult {
    const origin = req.headers.get('origin');

    // No origin — server-to-server, let API key auth handle it
    if (!origin) {
        return { allowed: true, origin: null, response: null };
    }

    if (isAuthorisedOrigin(origin)) {
        return { allowed: true, origin, response: null };
    }

    // Unrecognised origin — block and log
    console.warn(JSON.stringify({
        _type: 'security',
        event: 'origin_blocked',
        origin,
        request_id: requestId,
        timestamp: new Date().toISOString(),
    }));

    const res = NextResponse.json(
        {
            error: 'Forbidden: request origin not authorised for this API.',
            request_id: requestId,
            code: 'ORIGIN_FORBIDDEN',
        },
        { status: 403 }
    );
    res.headers.set('x-request-id', requestId);
    res.headers.set('x-vetios-block-reason', 'origin_not_authorised');

    return { allowed: false, origin, response: res };
}

/**
 * Build CORS headers for allowed origins.
 */
export function buildCorsHeaders(origin: string | null): Record<string, string> {
    const normalized = normalizeOrigin(origin);
    const allowedOrigin = normalized && isAuthorisedOrigin(normalized) ? normalized : 'https://vetios.tech';

    return {
        'Access-Control-Allow-Origin':  allowedOrigin,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-vetios-api-key',
        'Access-Control-Max-Age':       '86400',
        'Vary':                         'Origin',
    };
}

function normalizeOrigin(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }

    try {
        return new URL(trimmed).origin;
    } catch {
        return null;
    }
}
