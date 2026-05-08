const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS = 60_000;
const LIMIT = 60;

export function checkRateLimit(tenantId: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = rateLimitMap.get(tenantId);

    if (!entry || now - entry.windowStart > WINDOW_MS) {
        rateLimitMap.set(tenantId, { count: 1, windowStart: now });
        return { allowed: true, remaining: LIMIT - 1, resetAt: now + WINDOW_MS };
    }

    if (entry.count >= LIMIT) {
        return { allowed: false, remaining: 0, resetAt: entry.windowStart + WINDOW_MS };
    }

    entry.count += 1;
    return { allowed: true, remaining: LIMIT - entry.count, resetAt: entry.windowStart + WINDOW_MS };
}
