/**
 * API Guard — rate limiting + request size enforcement.
 *
 * In-memory sliding-window rate limiter keyed by IP address.
 * For production scale, migrate to @upstash/ratelimit + Vercel KV.
 *
 * Usage in route handlers:
 *   const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
 *   if (guard.blocked) return guard.response;
 */

import { NextResponse } from 'next/server';
import { getRequestId } from './requestId';

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_BODY_SIZE = 128 * 1024; // 128 KB

// ── In-memory rate limit store ───────────────────────────────────────────────

interface RateLimitEntry {
    timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Clean stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
        entry.timestamps = entry.timestamps.filter((t) => now - t < 120_000);
        if (entry.timestamps.length === 0) store.delete(key);
    }
}, 300_000);

// ── Rate Limiter ─────────────────────────────────────────────────────────────

function checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    let entry = store.get(key);

    if (!entry) {
        entry = { timestamps: [] };
        store.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
        const oldestInWindow = entry.timestamps[0];
        const resetMs = windowMs - (now - oldestInWindow);
        return { allowed: false, remaining: 0, resetMs };
    }

    entry.timestamps.push(now);
    return {
        allowed: true,
        remaining: maxRequests - entry.timestamps.length,
        resetMs: windowMs,
    };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface GuardOptions {
    /** Max requests per window (default: 10) */
    maxRequests?: number;
    /** Window duration in ms (default: 60_000 = 1 minute) */
    windowMs?: number;
    /** Max request body size in bytes (default: 128KB) */
    maxBodySize?: number;
}

export interface GuardResult {
    blocked: boolean;
    response: NextResponse | null;
    requestId: string;
    startTime: number;
}

/**
 * Run API guard checks: rate limit + request size enforcement.
 * Returns `blocked: true` with a ready-to-return 429/413 response if violated.
 */
export async function apiGuard(
    req: Request,
    options: GuardOptions = {}
): Promise<GuardResult> {
    const {
        maxRequests = 10,
        windowMs = 60_000,
        maxBodySize = MAX_BODY_SIZE,
    } = options;

    const requestId = getRequestId(req);
    const startTime = Date.now();

    // ── Rate limit check ──
    const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'unknown';

    const rateLimitKey = `${ip}:${new URL(req.url).pathname}`;
    const rateResult = checkRateLimit(rateLimitKey, maxRequests, windowMs);

    if (!rateResult.allowed) {
        const res = NextResponse.json(
            {
                error: 'Too many requests',
                request_id: requestId,
                retry_after_ms: rateResult.resetMs,
            },
            { status: 429 }
        );
        res.headers.set('x-request-id', requestId);
        res.headers.set('retry-after', String(Math.ceil(rateResult.resetMs / 1000)));
        res.headers.set('x-ratelimit-limit', String(maxRequests));
        res.headers.set('x-ratelimit-remaining', '0');
        return { blocked: true, response: res, requestId, startTime };
    }

    // ── Content-Length check ──
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxBodySize) {
        const res = NextResponse.json(
            {
                error: `Request body too large (max ${maxBodySize} bytes)`,
                request_id: requestId,
            },
            { status: 413 }
        );
        res.headers.set('x-request-id', requestId);
        return { blocked: true, response: res, requestId, startTime };
    }

    return { blocked: false, response: null, requestId, startTime };
}
