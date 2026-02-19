/**
 * Safe JSON body parser for API routes.
 *
 * Prevents "Unexpected end of JSON input" errors from surfacing as 500s.
 * All routes use this instead of raw req.json().
 */

export type SafeJsonResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

export async function safeJson<T = unknown>(req: Request): Promise<SafeJsonResult<T>> {
    let text: string;

    try {
        text = await req.text();
    } catch {
        return { ok: false, error: 'Failed to read request body' };
    }

    if (!text || text.trim().length === 0) {
        return { ok: false, error: 'Missing JSON body' };
    }

    try {
        const data = JSON.parse(text) as T;
        return { ok: true, data };
    } catch {
        return { ok: false, error: 'Invalid JSON body' };
    }
}
