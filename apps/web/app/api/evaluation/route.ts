import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

type SafetyDistribution = {
    nominal: number;
    review: number;
    hold: number;
};

export async function GET(req: Request) {
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = auth.actor.tenantId;
    const { data: inferenceRows, error: inferenceError } = await supabase
        .from('ai_inference_events')
        .select('confidence_score, output_payload, uncertainty_metrics')
        .eq('tenant_id', tenantId);

    if (inferenceError) {
        return NextResponse.json(
            { error: 'evaluation_query_failed', detail: inferenceError.message },
            { status: 500 },
        );
    }

    const { data: outcomeRows, error: outcomeError } = await supabase
        .from('clinical_outcome_events')
        .select('outcome_payload')
        .eq('tenant_id', tenantId);

    if (outcomeError) {
        return NextResponse.json(
            { error: 'outcome_query_failed', detail: outcomeError.message },
            { status: 500 },
        );
    }

    const { data: simulationRows, error: simulationError } = await supabase
        .from('edge_simulation_events')
        .select('simulation_parameters, stress_metrics')
        .eq('tenant_id', tenantId);

    if (simulationError) {
        return NextResponse.json(
            { error: 'simulation_query_failed', detail: simulationError.message },
            { status: 500 },
        );
    }

    const inferences = (inferenceRows ?? []).map((row) => row as Record<string, unknown>);
    const outcomes = (outcomeRows ?? []).map((row) => row as Record<string, unknown>);
    const simulations = (simulationRows ?? []).map((row) => row as Record<string, unknown>);
    const confidenceScores = inferences
        .map((row) => readNumber(row.confidence_score))
        .filter((value): value is number => value != null);
    const calibrationDeltas = outcomes
        .map((row) => readNumber(asRecord(row.outcome_payload).calibration_delta))
        .filter((value): value is number => value != null);
    const safetyDistribution = inferences.reduce<SafetyDistribution>(
        (acc, row) => {
            const state = readSafetyState(row);
            acc[state] += 1;
            return acc;
        },
        { nominal: 0, review: 0, hold: 0 },
    );
    const passRates = simulations
        .map((row) => {
            const stressMetrics = asRecord(row.stress_metrics);
            const stabilityReport = asRecord(stressMetrics.stability_report);
            const simulationParameters = asRecord(row.simulation_parameters);
            const passes = readNumber(stabilityReport.passes);
            const explicitSteps = readNumber(simulationParameters.steps);
            const failures = readNumber(stabilityReport.failures);
            const total = explicitSteps ?? ((passes ?? 0) + (failures ?? 0));
            return passes != null && total > 0 ? passes / total : null;
        })
        .filter((value): value is number => value != null);

    const payload = {
        tenant_id: tenantId,
        period: 'all_time',
        inference: {
            total: inferences.length,
            mean_confidence: roundMetric(average(confidenceScores)),
            outcomes_resolved: outcomes.length,
            mean_calibration_delta: calibrationDeltas.length > 0 ? roundMetric(average(calibrationDeltas)) : null,
        },
        safety_distribution: safetyDistribution,
        simulation: {
            total_runs: simulations.length,
            mean_pass_rate: passRates.length > 0 ? roundMetric(average(passRates)) : 0,
        },
    };

    const { error: evaluationInsertError } = await supabase
        .from('model_evaluation_events')
        .insert({
            tenant_id: tenantId,
            trigger_type: 'inference',
            model_name: 'VetIOS Diagnostics',
            model_version: 'aggregate',
            calibration_error: payload.inference.mean_calibration_delta == null
                ? null
                : Math.abs(payload.inference.mean_calibration_delta),
            calibrated_confidence: payload.inference.mean_confidence,
            evaluation_payload: {
                ...payload,
                request_id: randomUUID(),
                evaluated_at: new Date().toISOString(),
            },
        });

    if (evaluationInsertError) {
        return NextResponse.json(
            { error: 'evaluation_insert_failed', detail: evaluationInsertError.message },
            { status: 500 },
        );
    }

    return NextResponse.json(payload);
}

export async function POST(req: Request) {
    return GET(req);
}

function readSafetyState(row: Record<string, unknown>): 'nominal' | 'review' | 'hold' {
    const direct = asRecord(row.uncertainty_metrics);
    const outputPayload = asRecord(row.output_payload);
    const fallback = asRecord(outputPayload.cire);
    const directCire = asRecord(direct.cire);
    const value = readText(direct.safety_state)
        ?? readText(directCire.safety_state)
        ?? readText(fallback.safety_state);
    return value === 'nominal' || value === 'review' || value === 'hold' ? value : 'hold';
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMetric(value: number): number {
    return Number(value.toFixed(4));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
