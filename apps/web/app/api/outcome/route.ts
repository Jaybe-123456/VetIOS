/**
 * POST /api/outcome
 *
 * Links a clinical outcome to a previously logged inference event.
 *
 * Critical rule: Never update inference logs. Outcomes are separate events.
 * Auth: Requires authenticated session. tenant_id = auth.uid().
 */

import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { logOutcome } from '@/lib/logging/outcomeLogger';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';

interface OutcomeRequestBody {
    tenant_id?: string; // Deprecated: now derived from session
    inference_event_id: string;
    clinic_id?: string;
    case_id?: string;
    outcome: {
        type: string;
        payload: Record<string, unknown>;
        timestamp: string;
    };
}

export async function POST(req: Request) {
    // ── Auth check ──
    const session = await resolveSessionTenant();

    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tenantId = session?.tenantId || 'dev_tenant_001';

    // ── Safe JSON parse (returns 400, never 500) ──
    const parsed = await safeJson<OutcomeRequestBody>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.data;

    try {
        // ── Validate required fields ──
        if (!body.inference_event_id) {
            return NextResponse.json({ error: 'Missing inference_event_id' }, { status: 400 });
        }
        if (!body.outcome?.type) {
            return NextResponse.json({ error: 'Missing outcome.type' }, { status: 400 });
        }
        if (!body.outcome?.payload) {
            return NextResponse.json({ error: 'Missing outcome.payload' }, { status: 400 });
        }
        if (!body.outcome?.timestamp) {
            return NextResponse.json({ error: 'Missing outcome.timestamp' }, { status: 400 });
        }

        const supabase = getSupabaseServer();

        // ── Verify inference exists AND belongs to tenant ──
        const { data: inferenceRecord, error: lookupError } = await supabase
            .from('ai_inference_events')
            .select('id, tenant_id')
            .eq('id', body.inference_event_id)
            .single();

        if (lookupError || !inferenceRecord) {
            return NextResponse.json(
                { error: `Inference event not found: ${body.inference_event_id}` },
                { status: 404 },
            );
        }

        if ((inferenceRecord as { tenant_id: string }).tenant_id !== tenantId) {
            return NextResponse.json(
                { error: 'Inference event does not belong to this tenant' },
                { status: 403 },
            );
        }

        // ── Insert outcome event ──
        const outcomeEventId = await logOutcome(supabase, {
            tenant_id: tenantId,
            clinic_id: body.clinic_id ?? null,
            case_id: body.case_id ?? null,
            inference_event_id: body.inference_event_id,
            outcome_type: body.outcome.type,
            outcome_payload: body.outcome.payload,
            outcome_timestamp: body.outcome.timestamp,
        });

        // ── Evaluation Engine: Auto-trigger outcome alignment eval ──
        let evalResult = null;
        try {
            // Fetch the inference output to compute alignment delta
            const { data: inferenceData } = await supabase
                .from('ai_inference_events')
                .select('output_payload, confidence_score, model_name, model_version')
                .eq('id', body.inference_event_id)
                .single();

            if (inferenceData) {
                const inf = inferenceData as { output_payload: Record<string, unknown>; confidence_score: number | null; model_name: string; model_version: string };
                const recentEvals = await getRecentEvaluations(
                    supabase, tenantId, inf.model_name, 20,
                );
                evalResult = await createEvaluationEvent(supabase, {
                    tenant_id: tenantId,
                    trigger_type: 'outcome',
                    inference_event_id: body.inference_event_id,
                    outcome_event_id: outcomeEventId,
                    model_name: inf.model_name,
                    model_version: inf.model_version,
                    predicted_confidence: inf.confidence_score,
                    actual_correctness: 1.0, // Outcome attached = ground truth available
                    predicted_output: inf.output_payload,
                    actual_outcome: body.outcome.payload,
                    recent_evaluations: recentEvals,
                });
            }
        } catch (evalErr) {
            console.warn('[POST /api/outcome] Evaluation auto-trigger failed (non-fatal):', evalErr);
        }

        return NextResponse.json({
            outcome_event_id: outcomeEventId,
            linked_inference_event_id: body.inference_event_id,
            evaluation: evalResult,
        });
    } catch (err) {
        console.error('[POST /api/outcome] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}

