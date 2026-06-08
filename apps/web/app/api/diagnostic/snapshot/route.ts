import { GET as getControlPlaneSnapshot } from '@/app/api/settings/control-plane/route';
import { apiGuard } from '@/lib/http/apiGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const sourceUrl = new URL(req.url);
    const targetUrl = new URL('/api/settings/control-plane', sourceUrl.origin);
    targetUrl.searchParams.set('view', sourceUrl.searchParams.get('view') ?? 'dashboard');

    const headers = new Headers(req.headers);
    headers.set('x-vetios-diagnostic-snapshot-proxy', '1');

    return getControlPlaneSnapshot(new Request(targetUrl, {
        method: 'GET',
        headers,
        signal: req.signal,
    }));
}
