import { runInferencePipeline } from '@/lib/ai/inferenceOrchestrator';
import { evaluateClinicalIntegrity } from '@/lib/integrity/clinicalIntegrityEngine';
import type { ClinicalIntegrityHistoryEntry } from '@/lib/integrity/types';
import { sanitizeSimulationInput, perturbClinicalCase, normalizeClinicalBaseCase } from '@/lib/simulation/casePerturber';
import { detectCollapseThreshold, detectPrecliffRegions } from '@/lib/simulation/collapseDetector';
import { generatePerturbationVector } from '@/lib/simulation/perturbationEngine';
import type {
    IntegritySweepConfig,
    SimulationResult,
    SimulationStep,
} from '@/lib/simulation/simulationTypes';

export async function runIntegritySweep(
    baseCase: Record<string, unknown>,
    config: IntegritySweepConfig,
): Promise<SimulationResult> {
    const normalizedBaseCase = normalizeClinicalBaseCase(baseCase);
    const evaluatedSteps = new Map<number, SimulationStep>();
    const linearSweepPoints = createLinearSweepPoints(config.steps);

    await evaluateSweepPoints(normalizedBaseCase, linearSweepPoints, config, evaluatedSteps);

    if (config.mode === 'adaptive') {
        const maxSteps = Math.max(config.steps, config.maxAdaptiveSteps ?? Math.min(15, config.steps + 5));
        let guard = 0;
        while (evaluatedSteps.size < maxSteps && guard < 3) {
            const proposedMidpoints = collectAdaptiveMidpoints(
                Array.from(evaluatedSteps.values()),
                maxSteps - evaluatedSteps.size,
            );
            if (proposedMidpoints.length === 0) break;
            await evaluateSweepPoints(normalizedBaseCase, proposedMidpoints, config, evaluatedSteps);
            guard += 1;
        }
    }

    const steps = Array.from(evaluatedSteps.values()).sort((a, b) => a.m - b.m);
    const collapseThreshold = detectCollapseThreshold(steps);
    const precliffRegions = detectPrecliffRegions(steps);

    return {
        base_case: sanitizeSimulationInput(normalizedBaseCase),
        steps,
        collapse_threshold: collapseThreshold ?? undefined,
        precliff_regions: precliffRegions,
    };
}

async function evaluateSweepPoints(
    baseCase: Record<string, unknown>,
    sweepPoints: number[],
    config: IntegritySweepConfig,
    evaluatedSteps: Map<number, SimulationStep>,
) {
    const sortedTargets = sweepPoints
        .map(roundSigned)
        .filter((m, index, values) => values.indexOf(m) === index)
        .filter((m) => !evaluatedSteps.has(m))
        .sort((a, b) => a - b);

    for (const m of sortedTargets) {
        const history = buildSimulatedHistory(Array.from(evaluatedSteps.values()), m);
        const step = await evaluateSweepStep(baseCase, m, config, history);
        evaluatedSteps.set(step.m, step);
    }
}

async function evaluateSweepStep(
    baseCase: Record<string, unknown>,
    m: number,
    config: IntegritySweepConfig,
    recentHistory: ClinicalIntegrityHistoryEntry[],
): Promise<SimulationStep> {
    const perturbationVector = generatePerturbationVector(m);
    const inputVariant = sanitizeSimulationInput(perturbClinicalCase(baseCase, perturbationVector));

    const inferenceResult = await Promise.race([
        runInferencePipeline({
            model: config.model,
            rawInput: inputVariant,
            inputMode: 'json',
        }),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`SIMULATION_STEP_TIMEOUT:${m}`)), config.timeoutMs),
        ),
    ]);

    const integrityEvaluation = evaluateClinicalIntegrity(
        {
            inputSignature: inputVariant,
            outputPayload: inferenceResult.output_payload,
            confidenceScore: inferenceResult.confidence_score,
            uncertaintyMetrics: asNullableRecord(inferenceResult.uncertainty_metrics),
            contradictionAnalysis: asNullableRecord(inferenceResult.contradiction_analysis),
        },
        { recentHistory },
    );

    return {
        m: roundMetric(m),
        perturbation_vector: perturbationVector,
        input_variant: inputVariant,
        output: summarizeSimulationOutput(inferenceResult),
        integrity: integrityEvaluation.integrity,
    };
}

function summarizeSimulationOutput(inferenceResult: Awaited<ReturnType<typeof runInferencePipeline>>) {
    const payload = inferenceResult.output_payload;
    return {
        diagnosis: asRecord(payload.diagnosis),
        risk_assessment: asRecord(payload.risk_assessment),
        uncertainty_notes: Array.isArray(payload.uncertainty_notes) ? payload.uncertainty_notes : [],
        contradiction_analysis: asNullableRecord(inferenceResult.contradiction_analysis),
        differential_spread: asNullableRecord(payload.differential_spread),
        confidence_score: inferenceResult.confidence_score,
        abstain_recommendation: Boolean(payload.abstain_recommendation),
    };
}

function collectAdaptiveMidpoints(
    steps: SimulationStep[],
    remainingCapacity: number,
) {
    if (remainingCapacity <= 0) return [] as number[];

    const orderedSteps = [...steps].sort((a, b) => a.m - b.m);
    const proposals: number[] = [];

    for (let index = 1; index < orderedSteps.length; index += 1) {
        const previous = orderedSteps[index - 1];
        const current = orderedSteps[index];
        const gap = current.m - previous.m;
        if (gap < 0.08) continue;

        const phiDrop = current.integrity.global_phi - previous.integrity.global_phi;
        const refine = phiDrop < -0.12
            || current.integrity.state === 'metastable'
            || current.integrity.precliff_detected
            || current.integrity.instability.delta_phi < -0.12;

        if (!refine) continue;
        proposals.push(roundMetric((previous.m + current.m) / 2));
        if (proposals.length >= remainingCapacity) break;
    }

    return Array.from(new Set(proposals)).sort((a, b) => a - b);
}

function createLinearSweepPoints(stepCount: number) {
    const totalSteps = Math.max(5, Math.min(15, Math.round(stepCount)));
    return Array.from({ length: totalSteps }, (_, index) => {
        if (totalSteps === 1) return 0;
        return roundMetric(index / (totalSteps - 1));
    });
}

function buildSimulatedHistory(existingSteps: SimulationStep[], currentM: number): ClinicalIntegrityHistoryEntry[] {
    return existingSteps
        .filter((step) => step.m < currentM)
        .sort((a, b) => b.m - a.m)
        .slice(0, 6)
        .map((step) => ({
            global_phi: step.integrity.global_phi,
            perturbation_score_m: step.integrity.perturbation.m,
            details: {
                capabilities: step.integrity.capabilities,
                instability: step.integrity.instability,
                precliff_detected: step.integrity.precliff_detected,
            },
            created_at: null,
        }));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function roundMetric(value: number) {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function roundSigned(value: number) {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
