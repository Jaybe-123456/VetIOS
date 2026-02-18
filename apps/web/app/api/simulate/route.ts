/**
 * POST /api/simulate
 *
 * Runs an adversarial simulation through the real inference pipeline.
 *
 * Critical rule: This MUST call the inference pipeline.
 * Otherwise you don't generate adversarial inference data.
 *
 * Uses the shared runInference() function directly — NOT an HTTP call.
 */

import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runInference } from '@/lib/ai/provider';
import { logInference } from '@/lib/logging/inferenceLogger';
import { logSimulation } from '@/lib/logging/simulationLogger';

interface SimulateRequestBody {
    tenant_id: string;
    simulation: {
        type: string;
        parameters: Record<string, unknown>;
    };
    inference: {
        model: string;
        model_version?: string;
    };
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as SimulateRequestBody;

        // ── Validate required fields ──
        if (!body.tenant_id) {
            return NextResponse.json({ error: 'Missing tenant_id' }, { status: 400 });
        }
        if (!body.simulation?.type) {
            return NextResponse.json({ error: 'Missing simulation.type' }, { status: 400 });
        }
        if (!body.simulation?.parameters) {
            return NextResponse.json({ error: 'Missing simulation.parameters' }, { status: 400 });
        }
        if (!body.inference?.model) {
            return NextResponse.json({ error: 'Missing inference.model' }, { status: 400 });
        }

        // ── Generate scenario ──
        const scenario = {
            type: body.simulation.type,
            parameters: body.simulation.parameters,
            generated_at: new Date().toISOString(),
        };

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
            tenant_id: body.tenant_id,
            model_name: body.inference.model,
            model_version: body.inference.model_version ?? body.inference.model,
            input_signature: inputSignature,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            latency_ms: latencyMs,
        });

        // ── Log the simulation linking to the inference ──
        const simulationEventId = await logSimulation(supabase, {
            tenant_id: body.tenant_id,
            simulation_type: body.simulation.type,
            simulation_parameters: body.simulation.parameters,
            scenario,
            triggered_inference_id: triggeredInferenceId,
            inference_output: inferenceResult.output_payload,
        });

        return NextResponse.json({
            simulation_event_id: simulationEventId,
            triggered_inference_event_id: triggeredInferenceId,
            scenario,
            inference_output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            latency_ms: latencyMs,
        });
    } catch (err) {
        console.error('[POST /api/simulate] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}
