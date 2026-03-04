/**
 * GET /api/ml/shadow-report
 *
 * Returns the latest shadow evaluation report, drift report,
 * and calibration data from the ML server.
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant } from '@/lib/supabaseServer';

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

export async function GET() {
    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [shadow, drift, calibration, health] = await Promise.all([
        fetchML('/shadow'),
        fetchML('/drift'),
        fetchML('/calibration'),
        fetchML('/health'),
    ]);

    return NextResponse.json({
        ml_server_reachable: health !== null,
        shadow_evaluation: shadow,
        drift_report: drift,
        calibration: calibration,
        generated_at: new Date().toISOString(),
    });
}
