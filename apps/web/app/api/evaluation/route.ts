/**
 * GET /api/evaluation
 *
 * Returns evaluation metrics for the authenticated tenant.
 * Query params:
 *   - model: filter by model name (optional)
 *   - limit: number of events (default 20)
 *   - trigger: filter by trigger_type (optional)
 *
 * POST /api/evaluation
 *
 * Manually trigger an evaluation event (for testing).
 *
 * Auth: Requires authenticated session. tenant_id = auth.uid().
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { safeJson } from '@/lib/http/safeJson';

export async function GET(req: Request) {
    const session = await resolveSessionTenant();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const model = url.searchParams.get('model');
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const trigger = url.searchParams.get('trigger');

    const supabase = getSupabaseServer();

    let query = supabase
        .from('model_evaluation_events')
        .select('*')
        .eq('tenant_id', session.tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (model) {
        query = query.eq('model_name', model);
    }
    if (trigger) {
        query = query.eq('trigger_type', trigger);
    }

    const { data, error } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Also return summary stats
    const recent = await getRecentEvaluations(supabase, session.tenantId, model ?? '', 50);
    const errors = recent.map(e => e.calibration_error).filter((e): e is number => e != null);
    const drifts = recent.map(e => e.drift_score).filter((e): e is number => e != null);

    const summary = {
        total_evaluations: data?.length ?? 0,
        mean_calibration_error: errors.length > 0
            ? errors.reduce((a, b) => a + b, 0) / errors.length
            : null,
        mean_drift_score: drifts.length > 0
            ? drifts.reduce((a, b) => a + b, 0) / drifts.length
            : null,
    };

    return NextResponse.json({
        evaluations: data,
        summary,
    });
}

export async function POST(req: Request) {
    const session = await resolveSessionTenant();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = await safeJson<{
        inference_event_id?: string;
        model_name: string;
        model_version: string;
        predicted_confidence?: number;
        trigger_type?: 'inference' | 'outcome' | 'simulation';
    }>(req);

    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const body = parsed.data;

    if (!body.model_name || !body.model_version) {
        return NextResponse.json({ error: 'Missing model_name or model_version' }, { status: 400 });
    }

    try {
        const supabase = getSupabaseServer();

        // Fetch recent evaluations for drift calculation
        const recentEvals = await getRecentEvaluations(
            supabase, session.tenantId, body.model_name, 20,
        );

        const result = await createEvaluationEvent(supabase, {
            tenant_id: session.tenantId,
            trigger_type: body.trigger_type ?? 'inference',
            inference_event_id: body.inference_event_id,
            model_name: body.model_name,
            model_version: body.model_version,
            predicted_confidence: body.predicted_confidence,
            recent_evaluations: recentEvals,
        });

        return NextResponse.json(result);
    } catch (err) {
        console.error('[POST /api/evaluation] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}
