/**
 * GET /api/telemetry
 *
 * Returns live system health metrics aggregated from real DB tables:
 *   - ai_inference_events → latency p95, error rate, confidence trend
 *   - model_evaluation_events → drift scores, calibration
 *   - edge_simulation_events → simulation count, failure modes
 *   - clinical_outcome_events → outcome count
 *
 * Rate limited: 30 req/min per IP
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export async function GET(req: Request) {
    // ── Guard ──
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    // ── Auth ──
    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 }
        );
    }
    const tenantId = session?.tenantId || 'dev_tenant_001';
    const supabase = getSupabaseServer();

    try {
        // Run all queries in parallel for speed
        const [
            inferenceStats,
            latencyTimeline,
            evalDriftData,
            simCount,
            outcomeCount,
        ] = await Promise.all([
            // 1) Inference aggregate stats (last 24h)
            supabase
                .from('ai_inference_events')
                .select('confidence_score, inference_latency_ms, created_at')
                .eq('tenant_id', tenantId)
                .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
                .order('created_at', { ascending: true })
                .limit(500),

            // 2) Latency timeline (last 40 events for chart)
            supabase
                .from('ai_inference_events')
                .select('inference_latency_ms, created_at')
                .eq('tenant_id', tenantId)
                .order('created_at', { ascending: true })
                .limit(40),

            // 3) Evaluation drift data (model_evaluation_events)
            supabase
                .from('model_evaluation_events')
                .select('drift_score, calibration_error, outcome_alignment_delta, created_at')
                .order('created_at', { ascending: true })
                .limit(40),

            // 4) Simulation count
            supabase
                .from('edge_simulation_events')
                .select('id', { count: 'exact', head: true }),

            // 5) Outcome count
            supabase
                .from('clinical_outcome_events')
                .select('id', { count: 'exact', head: true })
                .eq('tenant_id', tenantId),
        ]);

        // ── Compute aggregate metrics ──
        const inferences = inferenceStats.data ?? [];
        const totalInferences = inferences.length;

        // Average confidence
        const confidences = inferences
            .map(e => e.confidence_score)
            .filter((c): c is number => c != null);
        const avgConfidence = confidences.length > 0
            ? confidences.reduce((s, v) => s + v, 0) / confidences.length
            : null;

        // p95 latency
        const latencies = inferences
            .map(e => e.inference_latency_ms)
            .filter((l): l is number => l != null)
            .sort((a, b) => a - b);
        const p95Latency = latencies.length > 0
            ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1]
            : null;

        // Confidence drift (first half avg vs second half avg)
        let confidenceDrift: number | null = null;
        if (confidences.length >= 4) {
            const mid = Math.floor(confidences.length / 2);
            const firstHalf = confidences.slice(0, mid);
            const secondHalf = confidences.slice(mid);
            const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
            const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
            confidenceDrift = avgSecond - avgFirst;
        }

        // Latency chart data
        const latencyChart = (latencyTimeline.data ?? []).map(e => ({
            time: new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            latency: e.inference_latency_ms ?? 0,
        }));

        // Drift chart data
        const driftChart = (evalDriftData.data ?? []).map(e => ({
            time: new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            drift: e.drift_score ?? 0,
        }));

        const response = NextResponse.json({
            metrics: {
                total_inferences_24h: totalInferences,
                avg_confidence: avgConfidence,
                p95_latency_ms: p95Latency,
                confidence_drift_24h: confidenceDrift,
                total_simulations: simCount.count ?? 0,
                total_outcomes: outcomeCount.count ?? 0,
            },
            charts: {
                latency: latencyChart,
                drift: driftChart,
            },
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        console.error(`[${requestId}] GET /api/telemetry Error:`, err);
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 }
        );
    }
}
