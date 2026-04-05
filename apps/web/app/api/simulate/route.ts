/**
 * POST /api/simulate
 *
 * Runs an integrity sweep over progressively perturbed variants of a base
 * clinical case, persists the sweep, and returns curve-ready collapse data.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { logSimulation } from '@/lib/logging/simulationLogger';
import {
    logAdversarialSimulationRunSteps,
    mapSimulationStepsToRows,
} from '@/lib/logging/adversarialSimulationRunLogger';
import {
    createSupabaseClinicalCaseStore,
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterSimulation,
} from '@/lib/clinicalCases/clinicalCaseManager';
import { logClinicalDatasetMutation } from '@/lib/dataset/clinicalDatasetDiagnostics';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { SimulateRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import {
    beginTelemetryExecutionSample,
    emitTelemetryEvent,
    extractPredictionLabel,
    extractSystemTelemetry,
    finishTelemetryExecutionSample,
    resolveTelemetryRunId,
    telemetrySimulationEventId,
} from '@/lib/telemetry/service';
import { evaluateDecisionEngine } from '@/lib/decisionEngine/service';
import { buildSimulationSummary } from '@/lib/simulation/collapseDetector';
import { normalizeClinicalBaseCase, sanitizeSimulationInput } from '@/lib/simulation/casePerturber';
import { runAdversarialSweep } from '@/lib/adversarial/adversarial-engine';
import { getConditionById } from '@/lib/inference/condition-registry';
import { runClinicalInferenceEngine } from '@/lib/inference/engine';
import type { SimulationMode, SimulationStep } from '@/lib/simulation/simulationTypes';
import type { AdversarialStabilityReport } from '@/lib/adversarial/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const STEP_TIMEOUT_MS = 25_000;

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['simulation:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }
    const { tenantId, userId } = auth.actor;

    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json(
            { error: parsed.error, request_id: requestId },
            { status: 400 },
        );
    }

    const result = SimulateRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 },
        );
    }

    const body = result.data;
    const normalizedRequest = normalizeSimulationRequest(body);
    const normalizedBaseCase = normalizeClinicalBaseCase(normalizedRequest.baseCase);

    try {
        const executionSample = beginTelemetryExecutionSample();
        const caseStore = createSupabaseClinicalCaseStore(supabase);
        const observedAt = new Date().toISOString();
        const simulationEventId = randomUUID();
        const telemetryRunId = resolveTelemetryRunId(
            normalizedRequest.modelVersion,
            resolveTelemetryRunCandidate(normalizedBaseCase),
        );

        const canonicalClinicalCase = await ensureCanonicalClinicalCase(caseStore, {
            tenantId,
            userId,
            clinicId: null,
            requestedCaseId: null,
            sourceModule: 'adversarial_simulation_sweep',
            inputSignature: sanitizeSimulationInput(normalizedBaseCase),
            observedAt,
        });

        const targetDisease = readString(asRecord(normalizedBaseCase.metadata).target_disease) ?? 'dirofilariosis_canine';
        const baselineInference = runClinicalInferenceEngine(normalizedBaseCase);
        const stabilityReport = await runAdversarialSweep(normalizedBaseCase, targetDisease, {
            target_condition: targetDisease,
            perturbation_types: ['symptom_noise', 'contradiction_pressure'],
            noise_levels: createSweepLevels(normalizedRequest.steps),
            contradiction_levels: createSweepLevels(normalizedRequest.steps),
            sweep_steps: normalizedRequest.steps,
        });
        const sweep = adaptStabilityReportToSimulation(stabilityReport, normalizedBaseCase);

        const executionMetrics = finishTelemetryExecutionSample(executionSample);
        const measuredLatencyMs = executionMetrics.latencyMs;
        const summary = buildSimulationSummary(sweep);
        const finalStep = sweep.steps[sweep.steps.length - 1] ?? null;

        const persistedSimulationEventId = await logSimulation(supabase, {
            id: simulationEventId,
            tenant_id: tenantId,
            user_id: userId,
            clinic_id: null,
            case_id: canonicalClinicalCase.id,
            source_module: 'adversarial_simulation_sweep',
            simulation_type: normalizedRequest.simulationType,
            simulation_parameters: {
                mode: normalizedRequest.mode,
                steps_requested: normalizedRequest.steps,
                model: normalizedRequest.model,
                model_version: normalizedRequest.modelVersion,
                base_case_summary: summarizeBaseCase(normalizedBaseCase),
            },
            triggered_inference_id: null,
            failure_mode: deriveFailureMode(sweep),
            stress_metrics: {
                ...summary,
                final_step: finalStep == null ? null : {
                    m: finalStep.m,
                    state: finalStep.integrity.state,
                    global_phi: finalStep.integrity.global_phi,
                    collapse_risk: finalStep.integrity.collapse_risk,
                    precliff_detected: finalStep.integrity.precliff_detected,
                    output: finalStep.output,
                },
            },
            is_real_world: false,
        });

        await logAdversarialSimulationRunSteps(
            supabase,
            mapSimulationStepsToRows(
                persistedSimulationEventId,
                tenantId,
                canonicalClinicalCase.id,
                sweep.steps,
            ),
        );

        try {
            await emitTelemetryEvent(supabase, {
                event_id: telemetrySimulationEventId(persistedSimulationEventId),
                tenant_id: tenantId,
                source_id: persistedSimulationEventId,
                source_table: 'edge_simulation_events',
                event_type: 'simulation',
                timestamp: observedAt,
                model_version: normalizedRequest.modelVersion,
                run_id: telemetryRunId,
                metrics: {
                    latency_ms: measuredLatencyMs,
                    confidence: readNumber(finalStep?.output.confidence_score) ?? finalStep?.integrity.global_phi ?? null,
                    prediction: finalStep == null
                        ? normalizedRequest.simulationType
                        : extractPredictionLabel(finalStep.output),
                },
                system: extractSystemTelemetry({}, executionMetrics.system),
                metadata: {
                    source_module: 'adversarial_simulation_sweep',
                    request_id: requestId,
                    simulation_event_id: persistedSimulationEventId,
                    case_id: canonicalClinicalCase.id,
                    mode: normalizedRequest.mode,
                    steps_requested: normalizedRequest.steps,
                    steps_executed: sweep.steps.length,
                    collapse_threshold: sweep.collapse_threshold ?? null,
                    precliff_regions: sweep.precliff_regions,
                    synthetic: true,
                    target_disease: targetDisease,
                },
            });
        } catch (telemetryErr) {
            console.error(`[${requestId}] Simulation telemetry emission failed (non-fatal):`, telemetryErr);
        }

        await finalizeClinicalCaseAfterSimulation(caseStore, canonicalClinicalCase, persistedSimulationEventId, {
            observedAt,
            userId,
            sourceModule: 'adversarial_simulation_sweep',
            simulationType: normalizedRequest.simulationType,
            stressMetrics: {
                ...(finalStep?.output ?? {}),
                integrity: finalStep?.integrity ?? null,
                collapse_threshold: sweep.collapse_threshold ?? null,
                precliff_regions: sweep.precliff_regions,
            },
            metadataPatch: {
                latest_simulation_type: normalizedRequest.simulationType,
                latest_simulation_timestamp: observedAt,
                latest_simulation_target_disease: targetDisease,
                latest_simulation_collapse_threshold: sweep.collapse_threshold ?? null,
                latest_simulation_mode: normalizedRequest.mode,
            },
        });

        logClinicalDatasetMutation({
            source: 'api/simulate',
            mutationType: 'simulation',
            authenticatedUserId: userId,
            resolvedTenantId: tenantId,
            writeTenantId: tenantId,
            caseId: canonicalClinicalCase.id,
            simulationEventId: persistedSimulationEventId,
        });
        revalidatePath('/dataset');

        try {
            await evaluateDecisionEngine({
                client: supabase,
                tenantId,
                triggerSource: 'simulation',
            });
        } catch (decisionErr) {
            console.error(`[${requestId}] Decision engine evaluation failed (non-fatal):`, decisionErr);
        }

        const targetEvaluation = buildTargetEvaluation(finalStep, targetDisease);
        const response = NextResponse.json({
            simulation_event_id: persistedSimulationEventId,
            triggered_inference_event_id: null,
            clinical_case_id: canonicalClinicalCase.id,
            inference_output: {
                diagnosis: baselineInference.diagnosis,
                differentials: baselineInference.differentials,
                inference_explanation: baselineInference.inference_explanation,
                treatment_plans: baselineInference.treatment_plans,
                ground_truth_summary: baselineInference.ground_truth_summary,
                abstain_recommendation: baselineInference.abstain_recommendation ?? false,
                abstain_reason: baselineInference.abstain_reason ?? null,
                competitive_differential: baselineInference.competitive_differential ?? false,
                urgent_confirmatory_testing: baselineInference.urgent_confirmatory_testing ?? false,
            },
            confidence_score: baselineInference.diagnosis.confidence_score,
            inference_latency_ms: measuredLatencyMs,
            contradiction_analysis: baselineInference.contradiction_analysis ?? null,
            differential_diagnosis: baselineInference.differentials,
            differential_spread: baselineInference.differential_spread ?? null,
            target_evaluation: targetEvaluation,
            stability_report: stabilityReport,
            simulation: {
                base_case: sweep.base_case,
                collapse_threshold: sweep.collapse_threshold ?? null,
                precliff_regions: sweep.precliff_regions,
                steps: sweep.steps.map((step) => ({
                    m: step.m,
                    perturbation_vector: step.perturbation_vector,
                    input_variant: step.input_variant,
                    output: step.output,
                    integrity: step.integrity,
                })),
            },
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        console.error(`[${requestId}] POST /api/simulate Error:`, err);

        if (err instanceof Error && err.message.startsWith('SIMULATION_STEP_TIMEOUT:')) {
            return NextResponse.json(
                { error: 'Simulation step timed out', request_id: requestId },
                { status: 504 },
            );
        }

        const message = err instanceof Error ? err.stack || err.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 },
        );
    }
}

function createSweepLevels(stepCount: number) {
    const totalSteps = Math.max(5, Math.min(15, Math.round(stepCount)));
    return Array.from({ length: totalSteps }, (_, index) => {
        if (totalSteps === 1) return 1;
        return Number((0.1 + ((0.9 * index) / (totalSteps - 1))).toFixed(3));
    });
}

function adaptStabilityReportToSimulation(
    report: AdversarialStabilityReport,
    normalizedBaseCase: Record<string, unknown>,
) {
    const steps: SimulationStep[] = report.step_results.map((step, index, allSteps) => {
        const previousPhi = index === 0 ? allSteps[0]?.phi ?? step.phi : allSteps[index - 1]?.phi ?? step.phi;
        const state =
            step.collapse_detected
                ? 'collapsed'
                : step.rank_inversions > 0 || step.phi < 0.85
                    ? 'metastable'
                    : step.phi < 0.92
                        ? 'fragile'
                        : 'stable';
        const outputSummary = {
            diagnosis: {
                top_differentials: step.differential_at_step.map((entry) => ({
                    name: getConditionById(entry.condition_id)?.canonical_name ?? entry.condition_id,
                    condition_id: entry.condition_id,
                    probability: entry.probability,
                    rank: entry.rank,
                })),
            },
            confidence_score: step.target_condition_probability,
            differential_spread: {
                spread: step.differential_at_step[0] && step.differential_at_step[1]
                    ? Number((step.differential_at_step[0].probability - step.differential_at_step[1].probability).toFixed(4))
                    : null,
            },
        };

        return {
            m: step.noise_level,
            perturbation_vector: {
                noise: step.noise_level,
                contradiction: step.contradiction_level,
                missingness: 0,
                ambiguity: 0,
                distribution_shift: 0,
            },
            input_variant: sanitizeSimulationInput(normalizedBaseCase),
            output: outputSummary,
            integrity: {
                perturbation: {
                    m: step.noise_level,
                    components: {
                        noise: step.noise_level,
                        contradiction: step.contradiction_level,
                        missingness: 0,
                        ambiguity: 0,
                        distribution_shift: 0,
                    },
                    reasoning: ['Symptom-only perturbation applied; objective tests, exposure history, and region preserved.'],
                },
                global_phi: step.phi,
                capabilities: [],
                instability: {
                    delta_phi: Number((step.phi - previousPhi).toFixed(4)),
                    curvature: 0,
                    variance_proxy: Number((step.rank_inversions / Math.max(1, step.differential_at_step.length)).toFixed(4)),
                    divergence: step.divergence_from_baseline,
                    critical_instability_index: Number((1 - step.phi).toFixed(4)),
                },
                state,
                collapse_risk: step.collapse_detected ? 1 : 0,
                precliff_detected: step.rank_inversions > 0 || step.phi < 0.85,
            },
        };
    });

    return {
        base_case: sanitizeSimulationInput(normalizedBaseCase),
        steps,
        collapse_threshold: report.collapse_conditions[0]?.collapse_threshold ?? null,
        precliff_regions: report.step_results
            .filter((step) => step.rank_inversions > 0 || step.phi < 0.85)
            .map((step) => step.noise_level),
    };
}

function normalizeSimulationRequest(body: {
    base_case?: Record<string, unknown>;
    steps?: number;
    mode?: SimulationMode;
    simulation?: { type: string; parameters: Record<string, unknown> };
    inference?: { model: string; model_version?: string };
}) {
    const baseCase = body.base_case != null
        ? body.base_case
        : buildBaseCaseFromLegacySimulation(body.simulation);
    const model = body.inference?.model ?? 'gpt-4o-mini';
    const modelVersion = body.inference?.model_version ?? model;

    return {
        baseCase,
        steps: Math.max(5, Math.min(15, body.steps ?? 10)),
        mode: body.mode ?? 'adaptive',
        model,
        modelVersion,
        simulationType: body.simulation?.type ?? `integrity_sweep_${body.mode ?? 'adaptive'}`,
    };
}

function buildBaseCaseFromLegacySimulation(
    simulation: { type: string; parameters: Record<string, unknown> } | undefined,
) {
    const parameters = simulation?.parameters ?? {};
    const edgeCases = readString(parameters.edge_cases);
    const contradictions = readString(parameters.contradictions);
    const targetDisease = readString(parameters.target_disease);
    const symptoms = [edgeCases, contradictions]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => value.split(/[,+;]/))
        .map((value) => value.trim())
        .filter(Boolean);

    return {
        species: readString(parameters.species) ?? 'canine',
        breed: readString(parameters.breed) ?? null,
        symptoms,
        metadata: {
            raw_note: edgeCases ?? 'Adversarial simulation base case generated from legacy simulation request.',
            history: contradictions ?? null,
            presenting_complaint: edgeCases ?? null,
            target_disease: targetDisease,
            simulation_iterations: parameters.iterations ?? null,
            legacy_simulation_type: simulation?.type ?? null,
        },
    };
}

function deriveFailureMode(result: { collapse_threshold?: number | null; precliff_regions: number[] }) {
    if (result.collapse_threshold != null) return 'integrity_collapse_detected';
    if (result.precliff_regions.length > 0) return 'metastability_region_detected';
    return null;
}

function summarizeBaseCase(baseCase: Record<string, unknown>) {
    return {
        species: readString(baseCase.species),
        breed: readString(baseCase.breed),
        symptom_count: Array.isArray(baseCase.symptoms) ? baseCase.symptoms.length : 0,
        has_history: Boolean(readString(asRecord(baseCase.metadata).history)),
        has_raw_note: Boolean(readString(asRecord(baseCase.metadata).raw_note)),
    };
}

function buildTargetEvaluation(step: SimulationStep | null, targetDisease: string | null) {
    if (!step || !targetDisease) return null;

    const differentials = readDifferentials(step.output);
    const topDiagnosis = readString(asRecord(differentials[0]).name);
    return {
        target_disease: targetDisease,
        top_diagnosis: topDiagnosis,
        target_matched_top: topDiagnosis?.toLowerCase().includes(targetDisease.toLowerCase()) ?? false,
    };
}

function readDifferentials(output: unknown) {
    const diagnosis = asRecord(asRecord(output).diagnosis);
    return Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
}

function resolveTelemetryRunCandidate(inputSignature: Record<string, unknown>): unknown {
    const metadata = asRecord(inputSignature.metadata);
    return inputSignature.run_id ?? metadata.run_id ?? null;
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

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
