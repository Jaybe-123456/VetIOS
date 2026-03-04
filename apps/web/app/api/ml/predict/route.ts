/**
 * POST /api/ml/predict
 *
 * Proxies risk prediction requests to the Python ML inference server.
 * Includes circuit-breaker, timeout, and fallback behavior.
 *
 * Request body:
 *   { decision_count: number, override_count: number, species: string }
 *
 * Response:
 *   { risk_score, confidence, abstain, model_version, _fallback?, _reason? }
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant } from '@/lib/supabaseServer';
import { mlPredict, type MLPredictRequest } from '@/lib/ml/mlClient';

export async function POST(req: Request) {
    // ── Auth check ──
    const session = await resolveSessionTenant();

    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Parse request ──
    let body: MLPredictRequest;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { error: 'Invalid JSON body' },
            { status: 400 }
        );
    }

    // ── Validate required fields ──
    if (typeof body.decision_count !== 'number' || typeof body.override_count !== 'number') {
        return NextResponse.json(
            { error: 'decision_count and override_count are required numbers' },
            { status: 400 }
        );
    }

    // ── Call ML server (with circuit-breaker + fallback) ──
    const prediction = await mlPredict({
        decision_count: body.decision_count,
        override_count: body.override_count,
        species: body.species || 'canine',
    });

    return NextResponse.json(prediction);
}

/**
 * GET /api/ml/predict
 *
 * Returns ML server status for health-check dashboards.
 */
export async function GET() {
    const { mlHealth, mlModelInfo } = await import('@/lib/ml/mlClient');

    const [health, model] = await Promise.all([
        mlHealth(),
        mlModelInfo(),
    ]);

    return NextResponse.json({
        ml_server_reachable: health !== null,
        health,
        model,
    });
}
