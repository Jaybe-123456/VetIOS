/**
 * GET /api/ml/shadow-report
 *
 * Returns latest shadow evaluation, drift, and calibration data from ML server.
 *
 * Protections:
 *   - Rate limit: 15 req/min per IP
 *   - Request ID tracing
 *   - Error sanitization
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

const ML_SERVER_URL = process.env.ML_SERVER_URL || 'http://localhost:8000';

async function fetchML(path: string) {
    try {
        const res = await fetch(`${ML_SERVER_URL}${path}`, { next: { revalidate: 60 } });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 15, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 }
        );
    }

    const [shadow, drift, calibration, health] = await Promise.all([
        fetchML('/shadow'),
        fetchML('/drift'),
        fetchML('/calibration'),
        fetchML('/health'),
    ]);

    const response = NextResponse.json({
        ml_server_reachable: health !== null,
        shadow_evaluation: shadow,
        drift_report: drift,
        calibration: calibration,
        generated_at: new Date().toISOString(),
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
