/**
 * POST /api/simulate
 *
 * Runs an adversarial simulation through the real inference pipeline.
 *
 * Critical rule: This MUST call the inference pipeline.
 * Otherwise you don't generate adversarial inference data.
 *
 * Uses the shared runInference() function directly — NOT an HTTP call.
 * Auth: Requires authenticated session. tenant_id = auth.uid().
 */

import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { runInference } from '@/lib/ai/provider';
import { logInference } from '@/lib/logging/inferenceLogger';
import { logSimulation } from '@/lib/logging/simulationLogger';

interface SimulateRequestBody {
    tenant_id?: string; // Deprecated: now derived from session
    simulation: {
        type: string;
        parameters: Record<string, unknown>;
    };
    inference: {
        model: string;
        model_version?: string;
    };
}

export async function POST(req: Request) {
    // ── Auth check ──
    const session = await resolveSessionTenant();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { tenantId } = session;

    // ── Safe JSON parse (returns 400, never 500) ──
    const parsed = await safeJson<SimulateRequestBody>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.data;

    try {
        // ── Validate required fields ──
        if (!body.simulation?.type) {
            return NextResponse.json({ error: 'Missing simulation.type' }, { status: 400 });
        }
        if (!body.simulation?.parameters) {
            return NextResponse.json({ error: 'Missing simulation.parameters' }, { status: 400 });
        }
        if (!body.inference?.model) {
            return NextResponse.json({ error: 'Missing inference.model' }, { status: 400 });
        }

        // ── Build inference input from simulation parameters ──
        const inputSignature: Record<string, unknown> = {
            simulation_type: body.simulation.type,
            ...body.simulation.parameters,
        };

        // ── Start timer ──
        const startTime = Date.now();

        // ── Call the REAL inference pipeline (shared function, NOT HTTP) ──
        const inferenceResult = await runInference({
            model: body.inference.model,
            input_signature: inputSignature,
        });

        const latencyMs = Date.now() - startTime;

        const supabase = getSupabaseServer();

        // ── Log the inference (same path as /api/inference) ──
        const triggeredInferenceId = await logInference(supabase, {
            tenant_id: tenantId,
            model_name: body.inference.model,
            model_version: body.inference.model_version ?? body.inference.model,
            input_signature: inputSignature,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
        });

        // ── Log the simulation (matches actual DB columns) ──
        const simulationEventId = await logSimulation(supabase, {
            simulation_type: body.simulation.type,
            simulation_parameters: body.simulation.parameters,
            triggered_inference_id: triggeredInferenceId,
            stress_metrics: inferenceResult.output_payload,
            is_real_world: false,
        });

        return NextResponse.json({
            simulation_event_id: simulationEventId,
            triggered_inference_event_id: triggeredInferenceId,
            inference_output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            inference_latency_ms: latencyMs,
        });
    } catch (err) {
        console.error('[POST /api/simulate] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}
