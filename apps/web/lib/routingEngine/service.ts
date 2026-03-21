import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractClinicalSignals } from '@/lib/ai/clinicalSignals';
import { detectContradictions } from '@/lib/ai/contradictionEngine';
import { evaluateEmergencyRules } from '@/lib/ai/emergencyRules';
import {
    CONTROL_PLANE_ALERTS,
    CONTROL_PLANE_CONFIGS,
    MODEL_ROUTER_PROFILES,
    MODEL_ROUTING_DECISIONS,
    TOPOLOGY_NODE_STATES,
} from '@/lib/db/schemaContracts';
import { getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import type {
    ModelFamily,
    ModelRegistryControlPlaneSnapshot,
    ModelRegistryRecord,
} from '@/lib/experiments/types';
import { extractPredictionLabel } from '@/lib/telemetry/service';
import type {
    RoutingCandidate,
    RoutingDecisionRecord,
    RoutingExecutionAttempt,
    RoutingExecutionResult,
    RoutingInputAnalysis,
    RoutingModelPerformance,
    RoutingModelProfile,
    RoutingMode,
    RoutingPlan,
    RoutingSystemState,
} from '@/lib/routingEngine/types';

const PERFORMANCE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ROUTING_DECISIONS = 400;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;

type RegistryFamilyGroup = ModelRegistryControlPlaneSnapshot['families'][number];

interface RoutingDirective {
    manual_override_model_id: string | null;
    force_ensemble: boolean;
    disable_ensemble: boolean;
}

interface RoutingPlanInput {
    client: SupabaseClient;
    tenantId: string;
    requestedModelName: string;
    requestedModelVersion: string;
    inputSignature: Record<string, unknown>;
    caseId?: string | null;
}

interface ExecuteRoutingPlanInput<T> {
    plan: RoutingPlan;
    executor: (profile: RoutingModelProfile) => Promise<T>;
}

interface RoutingExecutionEnvelope<T> {
    profile: RoutingModelProfile;
    output: T;
}

export async function planModelRoute(input: RoutingPlanInput): Promise<RoutingPlan> {
    const analysis = analyzeRoutingInput(input.inputSignature);
    const directive = readRoutingDirective(input.inputSignature);
    const store = createSupabaseExperimentTrackingStore(input.client);
    const [registrySnapshot, systemState, dbProfiles, performanceByModel] = await Promise.all([
        loadRoutingRegistrySnapshot(store, input.tenantId),
        loadRoutingSystemState(input.client, input.tenantId, analysis.family),
        loadRouterProfiles(input.client, input.tenantId, analysis.family),
        loadRoutingPerformance(input.client, input.tenantId),
    ]);
    const registryProfiles = buildRegistryProfiles(registrySnapshot, analysis.family);
    const defaultProfiles = buildDefaultRoutingProfiles({
        tenantId: input.tenantId,
        family: analysis.family,
        requestedModelName: input.requestedModelName,
        requestedModelVersion: input.requestedModelVersion,
    });
    const profiles = mergeProfiles([
        ...dbProfiles,
        ...registryProfiles,
        ...defaultProfiles,
    ]);
    const candidates = scoreRoutingCandidates({
        profiles,
        performanceByModel,
        registrySnapshot,
        analysis,
        systemState,
        requestedModelName: input.requestedModelName,
        requestedModelVersion: input.requestedModelVersion,
    });
    const availableCandidates = candidates.filter((candidate) => candidate.blocked_reason == null);
    const manualOverride = resolveManualOverrideCandidate(candidates, directive.manual_override_model_id);
    const routeMode = resolveRouteMode({
        analysis,
        directive,
        manualOverride,
        availableCandidates,
        systemState,
    });
    const selectedModels = resolveSelectedModels(routeMode, availableCandidates, manualOverride);
    const fallbackModel = resolveFallbackModel({
        selectedModels,
        candidates: availableCandidates,
        analysis,
    });

    return {
        routing_decision_id: randomUUID(),
        tenant_id: input.tenantId,
        requested_model_name: input.requestedModelName,
        requested_model_version: input.requestedModelVersion,
        family: analysis.family,
        analysis,
        route_mode: routeMode,
        selected_models: selectedModels,
        fallback_model: fallbackModel,
        candidates,
        reason: buildRoutingReason({
            analysis,
            routeMode,
            selectedModels,
            fallbackModel,
            manualOverride,
            systemState,
        }),
        manual_override: manualOverride != null,
        system_state: {
            ...systemState,
            active_registry_role: registrySnapshot.families.find((group) => group.model_family === analysis.family)?.active_model?.registry_role ?? null,
        },
    };
}

export function analyzeRoutingInput(inputSignature: Record<string, unknown>): RoutingInputAnalysis {
    const signals = extractClinicalSignals(inputSignature);
    const contradiction = detectContradictions(inputSignature);
    const emergency = evaluateEmergencyRules(inputSignature);
    const symptomCount = signals.symptoms.length;
    const structuredSignalCount = Object.values(signals.evidence).filter((evidence) => evidence.present).length;
    const attachmentCount = countAttachments(inputSignature);
    const complexityScore = clampNumber(
        0.08
            + Math.min(symptomCount, 10) * 0.055
            + Math.min(structuredSignalCount, 8) * 0.04
            + attachmentCount * 0.14
            + contradiction.contradiction_score * 0.22
            + (signals.duration_days != null && signals.duration_days > 7 ? 0.08 : 0)
            + (signals.free_text_fragments.length > 0 ? 0.06 : 0),
        0,
        1,
    );
    const riskScore = clampNumber(
        emergencyLevelToRisk(emergency.emergency_level)
            + contradiction.contradiction_score * 0.08
            + (signals.shock_pattern_strength >= 2 ? 0.12 : 0)
            + (signals.gdv_pattern_strength >= 2 ? 0.1 : 0)
            + (signals.distemper_pattern_strength >= 2 ? 0.06 : 0),
        0,
        1,
    );
    const highRisk = riskScore >= 0.7 || emergency.emergency_level === 'CRITICAL';
    const confidenceExpected = clampNumber(
        0.92 - (complexityScore * 0.28) - (contradiction.contradiction_score * 0.34) - (highRisk ? 0.08 : 0),
        0.25,
        0.95,
    );
    const reasons = [
        ...emergency.emergency_rule_reasons.slice(0, 2),
        ...contradiction.contradiction_reasons.slice(0, 2),
    ];

    if (complexityScore < 0.3) reasons.push('Case complexity is low enough for fast-path routing.');
    if (complexityScore > 0.7) reasons.push('Case complexity exceeds the deep-reasoning threshold.');
    if (contradiction.contradiction_score > 0) reasons.push('Input contradictions favor the robust routing path.');
    if (highRisk) reasons.push('Critical-risk presentation prioritizes recall over speed.');

    return {
        family: resolveModelFamily(inputSignature),
        complexity_score: roundNumber(complexityScore, 3),
        risk_score: roundNumber(riskScore, 3),
        symptom_count: symptomCount,
        contradiction_score: roundNumber(contradiction.contradiction_score, 3),
        confidence_expected: roundNumber(confidenceExpected, 3),
        emergency_level: emergency.emergency_level,
        high_risk: highRisk,
        structured_signal_count: structuredSignalCount,
        attachment_count: attachmentCount,
        reasons: dedupeStrings(reasons).slice(0, 6),
    };
}

export async function executeRoutingPlan<T>(
    input: ExecuteRoutingPlanInput<T>,
): Promise<RoutingExecutionResult<T>> {
    if (input.plan.selected_models.length === 0) {
        throw new Error('Routing engine could not find an approved model candidate for this case.');
    }

    if (input.plan.route_mode === 'ensemble') {
        return await executeEnsembleRoutingPlan(input);
    }

    return await executeSingleRoutingPlan(input);
}

export async function createRoutingDecisionRecord(
    client: SupabaseClient,
    plan: RoutingPlan,
    input: {
        caseId?: string | null;
    } = {},
): Promise<RoutingDecisionRecord> {
    const C = MODEL_ROUTING_DECISIONS.COLUMNS;
    const primary = plan.selected_models[0] ?? null;
    if (!primary) {
        throw new Error(buildRoutingUnavailableMessage(plan));
    }
    const payload = {
        [C.routing_decision_id]: plan.routing_decision_id,
        [C.tenant_id]: plan.tenant_id,
        [C.case_id]: input.caseId ?? null,
        [C.inference_event_id]: null,
        [C.outcome_event_id]: null,
        [C.evaluation_event_id]: null,
        [C.requested_model_name]: plan.requested_model_name,
        [C.requested_model_version]: plan.requested_model_version,
        [C.selected_model_id]: primary?.model_id ?? null,
        [C.selected_provider_model]: primary?.provider_model ?? null,
        [C.selected_model_version]: primary?.model_version ?? null,
        [C.selected_registry_id]: primary?.registry_id ?? null,
        [C.model_family]: plan.family,
        [C.route_mode]: plan.route_mode,
        [C.execution_status]: 'planned',
        [C.trigger_reason]: plan.reason,
        [C.analysis]: plan.analysis,
        [C.candidates]: plan.candidates.map(serializeCandidate),
        [C.fallback_chain]: serializeFallbackChain(plan),
        [C.consensus_payload]: null,
        [C.actual_latency_ms]: null,
        [C.prediction]: null,
        [C.prediction_confidence]: null,
        [C.outcome_correct]: null,
    };

    try {
        const { data, error } = await client
            .from(MODEL_ROUTING_DECISIONS.TABLE)
            .upsert(payload, {
                onConflict: C.routing_decision_id,
            })
            .select('*')
            .single();

        if (error || !data) {
            throw error ?? new Error('Missing routing decision record.');
        }

        return mapRoutingDecisionRow(data as Record<string, unknown>, plan);
    } catch (error) {
        if (isMissingRelationError(error, MODEL_ROUTING_DECISIONS.TABLE)) {
            return buildEphemeralRoutingDecision(plan, primary, input.caseId ?? null);
        }
        throw new Error(`Failed to persist routing decision: ${extractErrorMessage(error)}`);
    }
}

export async function finalizeRoutingDecisionRecord<T>(
    client: SupabaseClient,
    plan: RoutingPlan,
    execution: RoutingExecutionResult<T>,
    input: {
        inferenceEventId: string;
        caseId: string | null;
        actualLatencyMs: number;
        prediction: string | null;
        predictionConfidence: number | null;
    },
): Promise<void> {
    const C = MODEL_ROUTING_DECISIONS.COLUMNS;
    try {
        const { error } = await client
            .from(MODEL_ROUTING_DECISIONS.TABLE)
            .update({
                [C.case_id]: input.caseId,
                [C.inference_event_id]: input.inferenceEventId,
                [C.selected_model_id]: execution.selected_model.model_id,
                [C.selected_provider_model]: execution.selected_model.provider_model,
                [C.selected_model_version]: execution.selected_model.model_version,
                [C.selected_registry_id]: execution.selected_model.registry_id,
                [C.route_mode]: execution.route_mode,
                [C.execution_status]: execution.fallback_used ? 'fallback_executed' : 'executed',
                [C.fallback_chain]: execution.attempts.map(serializeAttempt),
                [C.consensus_payload]: execution.consensus,
                [C.actual_latency_ms]: roundNumber(input.actualLatencyMs, 1),
                [C.prediction]: input.prediction,
                [C.prediction_confidence]: input.predictionConfidence,
            })
            .eq(C.routing_decision_id, plan.routing_decision_id);

        if (error) throw error;
    } catch (error) {
        if (isMissingRelationError(error, MODEL_ROUTING_DECISIONS.TABLE)) return;
        throw new Error(`Failed to finalize routing decision: ${extractErrorMessage(error)}`);
    }
}

export async function failRoutingDecisionRecord(
    client: SupabaseClient,
    routingDecisionId: string,
    reason: string,
): Promise<void> {
    const C = MODEL_ROUTING_DECISIONS.COLUMNS;
    try {
        const { error } = await client
            .from(MODEL_ROUTING_DECISIONS.TABLE)
            .update({
                [C.execution_status]: 'failed',
                [C.trigger_reason]: reason,
            })
            .eq(C.routing_decision_id, routingDecisionId);

        if (error) throw error;
    } catch (error) {
        if (isMissingRelationError(error, MODEL_ROUTING_DECISIONS.TABLE)) return;
        throw new Error(`Failed to mark routing decision as failed: ${extractErrorMessage(error)}`);
    }
}

export async function attachRoutingOutcomeFeedback(input: {
    client: SupabaseClient;
    tenantId: string;
    inferenceEventId: string;
    outcomeEventId: string;
    evaluationEventId?: string | null;
    predictionCorrect?: boolean | null;
}): Promise<void> {
    const C = MODEL_ROUTING_DECISIONS.COLUMNS;
    try {
        const { error } = await input.client
            .from(MODEL_ROUTING_DECISIONS.TABLE)
            .update({
                [C.outcome_event_id]: input.outcomeEventId,
                [C.evaluation_event_id]: input.evaluationEventId ?? null,
                [C.outcome_correct]: input.predictionCorrect ?? null,
            })
            .eq(C.tenant_id, input.tenantId)
            .eq(C.inference_event_id, input.inferenceEventId);

        if (error) throw error;
    } catch (error) {
        if (isMissingRelationError(error, MODEL_ROUTING_DECISIONS.TABLE)) return;
        throw new Error(`Failed to attach routing outcome feedback: ${extractErrorMessage(error)}`);
    }
}

export function buildRoutingTelemetryMetadata<T>(input: {
    plan: RoutingPlan;
    execution: RoutingExecutionResult<T>;
}): Record<string, unknown> {
    const selectedModel = input.execution.selected_model;
    const shifted = normalizeModelKey(selectedModel.provider_model) !== normalizeModelKey(input.plan.requested_model_name)
        && normalizeModelKey(selectedModel.model_id) !== normalizeModelKey(input.plan.requested_model_name)
        && normalizeModelKey(selectedModel.model_name) !== normalizeModelKey(input.plan.requested_model_name);
    const consensusAgreement = numberOrNull(input.execution.consensus?.agreement_ratio);

    return {
        routing_decision_id: input.plan.routing_decision_id,
        routing_reason: input.plan.reason,
        routing_requested_model_name: input.plan.requested_model_name,
        routing_requested_model_version: input.plan.requested_model_version,
        routing_model_family: input.plan.family,
        routing_selected_model_id: selectedModel.model_id,
        routing_selected_provider_model: selectedModel.provider_model,
        routing_selected_model_name: selectedModel.model_name,
        routing_selected_model_version: selectedModel.model_version,
        routing_selected_registry_id: selectedModel.registry_id,
        routing_route_mode: input.execution.route_mode,
        routing_manual_override: input.plan.manual_override,
        routing_fallback_used: input.execution.fallback_used,
        routing_shifted: shifted,
        routing_complexity_score: input.plan.analysis.complexity_score,
        routing_risk_score: input.plan.analysis.risk_score,
        routing_contradiction_score: input.plan.analysis.contradiction_score,
        routing_confidence_expected: input.plan.analysis.confidence_expected,
        routing_emergency_level: input.plan.analysis.emergency_level,
        routing_high_risk: input.plan.analysis.high_risk,
        routing_candidate_count: input.plan.candidates.length,
        routing_executed_model_ids: input.execution.executed_models.map((model) => model.model_id),
        routing_attempts: input.execution.attempts.map(serializeAttempt),
        routing_consensus_agreement: consensusAgreement,
        routing_consensus_prediction: readString(input.execution.consensus?.selected_prediction),
    };
}

export function buildDefaultRoutingProfiles(input: {
    tenantId: string;
    family: ModelFamily;
    requestedModelName: string;
    requestedModelVersion: string;
}): RoutingModelProfile[] {
    const prefix = familyPrefix(input.family);
    const defaultProvider = process.env.AI_PROVIDER_DEFAULT_MODEL || input.requestedModelName;
    const fastProvider = process.env.AI_PROVIDER_FAST_MODEL || defaultProvider;
    const deepProvider = process.env.AI_PROVIDER_DEEP_MODEL || process.env.AI_PROVIDER_DEFAULT_MODEL || input.requestedModelName;
    const robustProvider = process.env.AI_PROVIDER_ROBUST_MODEL || deepProvider || fastProvider;
    const recallProvider = process.env.AI_PROVIDER_HIGH_RECALL_MODEL || robustProvider;

    return [
        buildRequestedModelProfile(input),
        {
            id: `${prefix}_small_v1`,
            tenant_id: input.tenantId,
            model_id: `${prefix}_small_v1`,
            model_family: input.family,
            model_type: 'fast',
            provider_model: fastProvider,
            model_name: `${prefix}_small_v1`,
            model_version: `${prefix}_small_v1`,
            registry_id: null,
            approval_status: 'approved',
            active: true,
            expected_latency_ms: 260,
            base_accuracy: input.family === 'vision' ? 0.79 : 0.76,
            base_cost: 0.18,
            robustness_score: 0.48,
            recall_score: 0.66,
            metadata: { source: 'routing_defaults' },
        },
        {
            id: `${prefix}_large_v1`,
            tenant_id: input.tenantId,
            model_id: `${prefix}_large_v1`,
            model_family: input.family,
            model_type: 'deep_reasoning',
            provider_model: deepProvider,
            model_name: `${prefix}_large_v1`,
            model_version: `${prefix}_large_v1`,
            registry_id: null,
            approval_status: 'approved',
            active: true,
            expected_latency_ms: 950,
            base_accuracy: 0.89,
            base_cost: 0.82,
            robustness_score: 0.72,
            recall_score: 0.84,
            metadata: { source: 'routing_defaults' },
        },
        {
            id: `${prefix}_robust_v1`,
            tenant_id: input.tenantId,
            model_id: `${prefix}_robust_v1`,
            model_family: input.family,
            model_type: 'adversarial_resistant',
            provider_model: robustProvider,
            model_name: `${prefix}_robust_v1`,
            model_version: `${prefix}_robust_v1`,
            registry_id: null,
            approval_status: 'approved',
            active: true,
            expected_latency_ms: 620,
            base_accuracy: 0.87,
            base_cost: 0.58,
            robustness_score: 0.94,
            recall_score: 0.9,
            metadata: { source: 'routing_defaults' },
        },
        {
            id: `${prefix}_recall_v1`,
            tenant_id: input.tenantId,
            model_id: `${prefix}_recall_v1`,
            model_family: input.family,
            model_type: 'high_recall',
            provider_model: recallProvider,
            model_name: `${prefix}_recall_v1`,
            model_version: `${prefix}_recall_v1`,
            registry_id: null,
            approval_status: 'approved',
            active: true,
            expected_latency_ms: 720,
            base_accuracy: 0.86,
            base_cost: 0.65,
            robustness_score: 0.82,
            recall_score: 0.95,
            metadata: { source: 'routing_defaults' },
        },
    ];
}

export function selectRoutingModeForTest(input: {
    analysis: RoutingInputAnalysis;
    systemState: RoutingSystemState;
    manualOverride: boolean;
    availableCandidateCount: number;
    forceEnsemble?: boolean;
    disableEnsemble?: boolean;
}): RoutingMode {
    return resolveRouteMode({
        analysis: input.analysis,
        directive: {
            manual_override_model_id: input.manualOverride ? 'manual' : null,
            force_ensemble: input.forceEnsemble === true,
            disable_ensemble: input.disableEnsemble === true,
        },
        manualOverride: input.manualOverride ? {} as RoutingCandidate : null,
        availableCandidates: new Array(input.availableCandidateCount).fill(null).map(() => ({
            profile: {} as RoutingModelProfile,
            score: 1,
            reason: 'test',
            blocked_reason: null,
            dynamic_accuracy: null,
            dynamic_latency_ms: null,
            registry_record: null,
        })),
        systemState: input.systemState,
    });
}

export function rankRoutingCandidatesForTest(input: {
    tenantId: string;
    family: ModelFamily;
    profiles: RoutingModelProfile[];
    analysis: RoutingInputAnalysis;
    systemState: RoutingSystemState;
    requestedModelName: string;
    requestedModelVersion: string;
    performanceByModel?: Map<string, RoutingModelPerformance>;
}): RoutingCandidate[] {
    return scoreRoutingCandidates({
        profiles: input.profiles,
        performanceByModel: input.performanceByModel ?? new Map(),
        registrySnapshot: {
            tenant_id: input.tenantId,
            families: [],
            routing_pointers: [],
            audit_history: [],
            refreshed_at: new Date().toISOString(),
        },
        analysis: {
            ...input.analysis,
            family: input.family,
        },
        systemState: input.systemState,
        requestedModelName: input.requestedModelName,
        requestedModelVersion: input.requestedModelVersion,
    });
}

export function resolveRoutingPlanForTest(input: {
    analysis: RoutingInputAnalysis;
    candidates: RoutingCandidate[];
    systemState: RoutingSystemState;
    manualOverrideModelId?: string | null;
    forceEnsemble?: boolean;
    disableEnsemble?: boolean;
}) {
    const manualOverride = resolveManualOverrideCandidate(
        input.candidates,
        input.manualOverrideModelId ?? null,
    );
    const availableCandidates = input.candidates.filter((candidate) => candidate.blocked_reason == null);
    const routeMode = resolveRouteMode({
        analysis: input.analysis,
        directive: {
            manual_override_model_id: input.manualOverrideModelId ?? null,
            force_ensemble: input.forceEnsemble === true,
            disable_ensemble: input.disableEnsemble === true,
        },
        manualOverride,
        availableCandidates,
        systemState: input.systemState,
    });
    const selectedModels = resolveSelectedModels(routeMode, availableCandidates, manualOverride);
    const fallbackModel = resolveFallbackModel({
        selectedModels,
        candidates: availableCandidates,
        analysis: input.analysis,
    });

    return {
        route_mode: routeMode,
        selected_models: selectedModels,
        fallback_model: fallbackModel,
        manual_override: manualOverride != null,
    };
}

async function executeSingleRoutingPlan<T>(
    input: ExecuteRoutingPlanInput<T>,
): Promise<RoutingExecutionResult<T>> {
    const attempts: RoutingExecutionAttempt[] = [];
    const chain = dedupeProfiles([
        input.plan.selected_models[0]!,
        input.plan.fallback_model,
    ]);

    let selectedEnvelope: RoutingExecutionEnvelope<T> | null = null;
    for (const profile of chain) {
        try {
            const output = await input.executor(profile);
            selectedEnvelope = { profile, output };
            attempts.push(buildSuccessAttempt(profile, output));
            break;
        } catch (error) {
            attempts.push({
                model_id: profile.model_id,
                model_version: profile.model_version,
                provider_model: profile.provider_model,
                status: 'failed',
                reason: extractErrorMessage(error),
                prediction: null,
                confidence: null,
            });
        }
    }

    if (!selectedEnvelope) {
        throw new Error(`Routing execution failed for all candidates: ${attempts.map((attempt) => `${attempt.model_id}:${attempt.reason ?? 'failed'}`).join(', ')}`);
    }

    return {
        routed_output: selectedEnvelope.output,
        selected_model: selectedEnvelope.profile,
        executed_models: [selectedEnvelope.profile],
        attempts,
        route_mode: input.plan.route_mode,
        fallback_used: selectedEnvelope.profile.model_id !== input.plan.selected_models[0]?.model_id,
        consensus: null,
    };
}

async function executeEnsembleRoutingPlan<T>(
    input: ExecuteRoutingPlanInput<T>,
): Promise<RoutingExecutionResult<T>> {
    const attempts: RoutingExecutionAttempt[] = [];
    const successful: Array<RoutingExecutionEnvelope<T>> = [];

    for (const profile of input.plan.selected_models) {
        try {
            const output = await input.executor(profile);
            successful.push({ profile, output });
            attempts.push(buildSuccessAttempt(profile, output));
        } catch (error) {
            attempts.push({
                model_id: profile.model_id,
                model_version: profile.model_version,
                provider_model: profile.provider_model,
                status: 'failed',
                reason: extractErrorMessage(error),
                prediction: null,
                confidence: null,
            });
        }
    }

    if (successful.length === 0 && input.plan.fallback_model) {
        try {
            const output = await input.executor(input.plan.fallback_model);
            successful.push({ profile: input.plan.fallback_model, output });
            attempts.push(buildSuccessAttempt(input.plan.fallback_model, output));
        } catch (error) {
            attempts.push({
                model_id: input.plan.fallback_model.model_id,
                model_version: input.plan.fallback_model.model_version,
                provider_model: input.plan.fallback_model.provider_model,
                status: 'failed',
                reason: extractErrorMessage(error),
                prediction: null,
                confidence: null,
            });
        }
    }

    if (successful.length === 0) {
        throw new Error(`Routing ensemble failed for every candidate: ${attempts.map((attempt) => `${attempt.model_id}:${attempt.reason ?? 'failed'}`).join(', ')}`);
    }

    const consensus = buildConsensus(successful);
    const selected = resolveConsensusSelection(successful, consensus);

    return {
        routed_output: selected.output,
        selected_model: selected.profile,
        executed_models: successful.map((entry) => entry.profile),
        attempts,
        route_mode: 'ensemble',
        fallback_used: input.plan.fallback_model != null && successful.some((entry) => entry.profile.model_id === input.plan.fallback_model?.model_id),
        consensus,
    };
}

async function loadRoutingRegistrySnapshot(
    store: ReturnType<typeof createSupabaseExperimentTrackingStore>,
    tenantId: string,
): Promise<ModelRegistryControlPlaneSnapshot> {
    try {
        return await getModelRegistryControlPlaneSnapshot(store, tenantId);
    } catch {
        return {
            tenant_id: tenantId,
            families: [],
            routing_pointers: [],
            audit_history: [],
            refreshed_at: new Date().toISOString(),
        };
    }
}

async function loadRoutingSystemState(
    client: SupabaseClient,
    tenantId: string,
    family: ModelFamily,
): Promise<RoutingSystemState> {
    const controlConfig = await loadRoutingConfig(client, tenantId);
    const [nodeStatus, alertPressure] = await Promise.all([
        loadFamilyNodeStatus(client, tenantId, family),
        loadAlertPressure(client, tenantId),
    ]);

    return {
        safe_mode_enabled: controlConfig.safe_mode_enabled,
        family_node_status: nodeStatus,
        active_registry_role: null,
        alert_pressure: alertPressure,
    };
}

async function loadRoutingConfig(
    client: SupabaseClient,
    tenantId: string,
): Promise<{ safe_mode_enabled: boolean }> {
    const C = CONTROL_PLANE_CONFIGS.COLUMNS;
    try {
        const { data, error } = await client
            .from(CONTROL_PLANE_CONFIGS.TABLE)
            .select(C.safe_mode_enabled)
            .eq(C.tenant_id, tenantId)
            .maybeSingle();

        if (error) throw error;
        const record = (data ?? null) as Record<string, unknown> | null;
        return {
            safe_mode_enabled: record?.[C.safe_mode_enabled] === true,
        };
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_CONFIGS.TABLE)) {
            return { safe_mode_enabled: false };
        }
        throw error;
    }
}

async function loadFamilyNodeStatus(
    client: SupabaseClient,
    tenantId: string,
    family: ModelFamily,
): Promise<RoutingSystemState['family_node_status']> {
    const nodeId = FAMILY_TO_NODE[family];
    const C = TOPOLOGY_NODE_STATES.COLUMNS;
    try {
        const { data, error } = await client
            .from(TOPOLOGY_NODE_STATES.TABLE)
            .select(C.status)
            .eq(C.tenant_id, tenantId)
            .eq(C.node_id, nodeId)
            .maybeSingle();

        if (error) throw error;
        return readNodeStatus((data as Record<string, unknown> | null)?.[C.status] ?? null);
    } catch (error) {
        if (isMissingRelationError(error, TOPOLOGY_NODE_STATES.TABLE)) {
            return null;
        }
        throw error;
    }
}

async function loadAlertPressure(
    client: SupabaseClient,
    tenantId: string,
): Promise<number> {
    const C = CONTROL_PLANE_ALERTS.COLUMNS;
    try {
        const { count, error } = await client
            .from(CONTROL_PLANE_ALERTS.TABLE)
            .select(C.id, { count: 'exact', head: true })
            .eq(C.tenant_id, tenantId)
            .eq(C.resolved, false);

        if (error) throw error;
        return count ?? 0;
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_ALERTS.TABLE)) {
            return 0;
        }
        throw error;
    }
}

async function loadRouterProfiles(
    client: SupabaseClient,
    tenantId: string,
    family: ModelFamily,
): Promise<RoutingModelProfile[]> {
    const C = MODEL_ROUTER_PROFILES.COLUMNS;
    try {
        const { data, error } = await client
            .from(MODEL_ROUTER_PROFILES.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .eq(C.model_family, family)
            .order(C.updated_at, { ascending: false });

        if (error) throw error;
        return (data ?? []).map((row) => mapRoutingProfileRow(row as Record<string, unknown>)).filter(Boolean) as RoutingModelProfile[];
    } catch (error) {
        if (isMissingRelationError(error, MODEL_ROUTER_PROFILES.TABLE)) {
            return [];
        }
        throw error;
    }
}

async function loadRoutingPerformance(
    client: SupabaseClient,
    tenantId: string,
): Promise<Map<string, RoutingModelPerformance>> {
    const since = new Date(Date.now() - PERFORMANCE_WINDOW_MS).toISOString();
    const C = MODEL_ROUTING_DECISIONS.COLUMNS;
    try {
        const { data, error } = await client
            .from(MODEL_ROUTING_DECISIONS.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .gte(C.created_at, since)
            .order(C.created_at, { ascending: false })
            .limit(MAX_ROUTING_DECISIONS);

        if (error) throw error;

        const grouped = new Map<string, Array<Record<string, unknown>>>();
        for (const row of (data ?? []) as Record<string, unknown>[]) {
            const modelId = readString(row[C.selected_model_id]);
            if (!modelId) continue;
            const existing = grouped.get(modelId) ?? [];
            existing.push(row);
            grouped.set(modelId, existing);
        }

        const performance = new Map<string, RoutingModelPerformance>();
        for (const [modelId, rows] of grouped.entries()) {
            const latencies = rows
                .map((row) => numberOrNull(row[C.actual_latency_ms]))
                .filter((value): value is number => value != null);
            const correctness = rows
                .map((row) => booleanOrNull(row[C.outcome_correct]))
                .filter((value): value is boolean => value != null);
            const highRiskRows = rows.filter((row) => booleanOrFalse(asRecord(row[C.analysis]).high_risk));
            const fallbackRows = rows.filter((row) => readString(row[C.execution_status]) === 'fallback_executed');
            const ensembleRows = rows.filter((row) => readString(row[C.route_mode]) === 'ensemble');
            const modelVersion = readString(rows[0]?.[C.selected_model_version]) ?? modelId;
            const highRiskCorrectness = highRiskRows
                .map((row) => booleanOrNull(row[C.outcome_correct]))
                .filter((value): value is boolean => value != null);

            performance.set(modelId, {
                model_id: modelId,
                model_version: modelVersion,
                inference_count: rows.length,
                avg_latency_ms: latencies.length > 0 ? roundNumber(mean(latencies) ?? 0, 1) : null,
                accuracy: correctness.length > 0 ? roundNumber(ratio(correctness.filter(Boolean).length, correctness.length) ?? 0, 3) : null,
                high_risk_accuracy: highRiskCorrectness.length > 0
                    ? roundNumber(ratio(highRiskCorrectness.filter(Boolean).length, highRiskCorrectness.length) ?? 0, 3)
                    : null,
                fallback_rate: rows.length > 0 ? roundNumber(ratio(fallbackRows.length, rows.length) ?? 0, 3) : null,
                ensemble_rate: rows.length > 0 ? roundNumber(ratio(ensembleRows.length, rows.length) ?? 0, 3) : null,
            });
        }

        return performance;
    } catch (error) {
        if (isMissingRelationError(error, MODEL_ROUTING_DECISIONS.TABLE)) {
            return new Map();
        }
        throw error;
    }
}

function scoreRoutingCandidates(input: {
    profiles: RoutingModelProfile[];
    performanceByModel: Map<string, RoutingModelPerformance>;
    registrySnapshot: ModelRegistryControlPlaneSnapshot;
    analysis: RoutingInputAnalysis;
    systemState: RoutingSystemState;
    requestedModelName: string;
    requestedModelVersion: string;
}): RoutingCandidate[] {
    const familyGroup = input.registrySnapshot.families.find((group) => group.model_family === input.analysis.family) ?? null;
    const systemState = {
        ...input.systemState,
        active_registry_role: familyGroup?.active_model?.registry_role ?? null,
    };

    return input.profiles
        .map((profile) => {
            const performance = input.performanceByModel.get(profile.model_id) ?? null;
            const registryRecord = resolveRegistryRecordForProfile(familyGroup, profile);
            const blockedReason = resolveBlockedReason(profile, registryRecord);
            const dynamicAccuracy = performance?.accuracy ?? null;
            const dynamicLatency = performance?.avg_latency_ms ?? null;
            const score = blockedReason != null
                ? 0
                : computeRoutingScore({
                    profile,
                    performance,
                    analysis: input.analysis,
                    systemState,
                    requestedModelName: input.requestedModelName,
                    requestedModelVersion: input.requestedModelVersion,
                });

            return {
                profile,
                score,
                reason: buildCandidateReason({
                    profile,
                    analysis: input.analysis,
                    systemState,
                    requestedModelName: input.requestedModelName,
                    performance,
                }),
                blocked_reason: blockedReason,
                dynamic_accuracy: dynamicAccuracy,
                dynamic_latency_ms: dynamicLatency,
                registry_record: registryRecord,
            } satisfies RoutingCandidate;
        })
        .sort((left, right) => {
            if ((left.blocked_reason == null) !== (right.blocked_reason == null)) {
                return left.blocked_reason == null ? -1 : 1;
            }
            return right.score - left.score;
        });
}

function buildRegistryProfiles(
    snapshot: ModelRegistryControlPlaneSnapshot,
    family: ModelFamily,
): RoutingModelProfile[] {
    const familyGroup = snapshot.families.find((entry) => entry.model_family === family);
    if (!familyGroup) return [];

    return familyGroup.entries.map((entry) => {
        const registry = entry.registry;
        const type = inferRoutingModelType(registry.model_name, registry.model_version, registry.registry_role);
        const approvalStatus = inferRegistryApprovalStatus(entry.registry, entry.is_active_route, entry.promotion_gating.promotion_allowed);

        return {
            id: registry.registry_id,
            tenant_id: registry.tenant_id,
            model_id: registry.model_version,
            model_family: registry.model_family,
            model_type: type,
            provider_model: registry.model_name || registry.model_version,
            model_name: registry.model_name || registry.model_version,
            model_version: registry.model_version,
            registry_id: registry.registry_id,
            approval_status: approvalStatus,
            active: registry.lifecycle_status !== 'archived',
            expected_latency_ms: clampNumber(registry.clinical_metrics.latency_p99 ?? expectedLatencyForType(type), 180, 2_500),
            base_accuracy: clampNumber(
                registry.clinical_metrics.global_accuracy
                    ?? registry.clinical_metrics.macro_f1
                    ?? defaultAccuracyForType(type),
                0.4,
                0.99,
            ),
            base_cost: defaultCostForType(type),
            robustness_score: clampNumber(
                1 - (registry.clinical_metrics.adversarial_degradation ?? 0.18),
                0.2,
                0.98,
            ),
            recall_score: clampNumber(
                registry.clinical_metrics.critical_recall
                    ?? defaultRecallForType(type),
                0.3,
                0.99,
            ),
            metadata: {
                source: 'model_registry',
                lifecycle_status: registry.lifecycle_status,
                registry_role: registry.registry_role,
                is_active_route: entry.is_active_route,
                promotion_allowed: entry.promotion_gating.promotion_allowed,
            },
        };
    });
}

function buildRequestedModelProfile(input: {
    tenantId: string;
    family: ModelFamily;
    requestedModelName: string;
    requestedModelVersion: string;
}): RoutingModelProfile {
    const inferredType = inferRoutingModelType(input.requestedModelName, input.requestedModelVersion, null);
    return {
        id: `requested_${normalizeModelKey(input.requestedModelName) || 'model'}`,
        tenant_id: input.tenantId,
        model_id: input.requestedModelName,
        model_family: input.family,
        model_type: inferredType,
        provider_model: input.requestedModelName,
        model_name: input.requestedModelName,
        model_version: input.requestedModelVersion,
        registry_id: null,
        approval_status: 'approved',
        active: true,
        expected_latency_ms: expectedLatencyForType(inferredType),
        base_accuracy: defaultAccuracyForType(inferredType),
        base_cost: defaultCostForType(inferredType),
        robustness_score: defaultRobustnessForType(inferredType),
        recall_score: defaultRecallForType(inferredType),
        metadata: {
            source: 'requested_model',
        },
    };
}

function resolveManualOverrideCandidate(
    candidates: RoutingCandidate[],
    manualOverrideModelId: string | null,
): RoutingCandidate | null {
    if (!manualOverrideModelId) return null;
    return candidates.find((candidate) =>
        candidate.blocked_reason == null && (
            normalizeModelKey(candidate.profile.model_id) === normalizeModelKey(manualOverrideModelId)
            || normalizeModelKey(candidate.profile.provider_model) === normalizeModelKey(manualOverrideModelId)
            || normalizeModelKey(candidate.profile.model_name) === normalizeModelKey(manualOverrideModelId)
        )
    ) ?? null;
}

function resolveRouteMode(input: {
    analysis: RoutingInputAnalysis;
    directive: RoutingDirective;
    manualOverride: RoutingCandidate | null;
    availableCandidates: RoutingCandidate[];
    systemState: RoutingSystemState;
}): RoutingMode {
    if (input.manualOverride) return 'manual_override';
    if (input.directive.disable_ensemble || input.availableCandidates.length < 2) return 'single';
    if (input.directive.force_ensemble) return 'ensemble';
    if (input.analysis.high_risk && input.analysis.confidence_expected <= DEFAULT_CONFIDENCE_THRESHOLD) return 'ensemble';
    if (input.analysis.high_risk && input.analysis.complexity_score >= 0.65) return 'ensemble';
    if (input.analysis.emergency_level === 'CRITICAL' && input.availableCandidates.length >= 2) return 'ensemble';
    if (input.systemState.safe_mode_enabled && input.analysis.high_risk) return 'ensemble';
    return 'single';
}

function resolveSelectedModels(
    routeMode: RoutingMode,
    availableCandidates: RoutingCandidate[],
    manualOverride: RoutingCandidate | null,
): RoutingModelProfile[] {
    if (manualOverride) {
        return [manualOverride.profile];
    }

    if (routeMode !== 'ensemble') {
        return availableCandidates.slice(0, 1).map((candidate) => candidate.profile);
    }

    const selected: RoutingCandidate[] = [];
    const primary = availableCandidates[0];
    if (primary) selected.push(primary);

    const robust = availableCandidates.find((candidate) => candidate.profile.model_type === 'adversarial_resistant' && candidate.profile.model_id !== primary?.profile.model_id);
    const recall = availableCandidates.find((candidate) => candidate.profile.model_type === 'high_recall' && candidate.profile.model_id !== primary?.profile.model_id);
    const diverseSecondary = robust ?? recall ?? availableCandidates.find((candidate) => candidate.profile.model_id !== primary?.profile.model_id) ?? null;
    if (diverseSecondary) selected.push(diverseSecondary);

    return dedupeProfiles(selected.map((candidate) => candidate.profile)).slice(0, 2);
}

function resolveFallbackModel(input: {
    selectedModels: RoutingModelProfile[];
    candidates: RoutingCandidate[];
    analysis: RoutingInputAnalysis;
}): RoutingModelProfile | null {
    const selectedIds = new Set(input.selectedModels.map((model) => model.model_id));
    const robustFallback = input.candidates.find((candidate) =>
        candidate.blocked_reason == null
        && candidate.profile.model_type === 'adversarial_resistant'
        && !selectedIds.has(candidate.profile.model_id),
    );
    if (robustFallback) return robustFallback.profile;

    const highRecallFallback = input.analysis.high_risk
        ? input.candidates.find((candidate) =>
            candidate.blocked_reason == null
            && candidate.profile.model_type === 'high_recall'
            && !selectedIds.has(candidate.profile.model_id),
        )
        : null;
    if (highRecallFallback) return highRecallFallback.profile;

    return input.candidates.find((candidate) => candidate.blocked_reason == null && !selectedIds.has(candidate.profile.model_id))?.profile ?? null;
}

function buildRoutingReason(input: {
    analysis: RoutingInputAnalysis;
    routeMode: RoutingMode;
    selectedModels: RoutingModelProfile[];
    fallbackModel: RoutingModelProfile | null;
    manualOverride: RoutingCandidate | null;
    systemState: RoutingSystemState;
}) {
    if (input.manualOverride) {
        return `Manual override selected ${input.manualOverride.profile.model_id}.`;
    }

    const primary = input.selectedModels[0];
    if (!primary) {
        return 'No approved routing candidate was available.';
    }

    const reasons: string[] = [];
    if (input.analysis.contradiction_score > 0) reasons.push('contradiction-aware routing');
    if (input.analysis.complexity_score > 0.7) reasons.push('deep reasoning required');
    if (input.analysis.complexity_score < 0.3) reasons.push('fast path eligible');
    if (input.analysis.high_risk) reasons.push('recall prioritized');
    if (input.systemState.safe_mode_enabled) reasons.push('safe mode bias');
    if (input.routeMode === 'ensemble') reasons.push('ensemble consensus enabled');
    if (input.fallbackModel) reasons.push(`fallback ready: ${input.fallbackModel.model_id}`);

    return `${primary.model_id} selected via ${dedupeStrings(reasons).join(', ') || 'balanced routing'}.`;
}

function buildRoutingUnavailableMessage(plan: RoutingPlan): string {
    const blockerSummary = plan.candidates
        .filter((candidate) => candidate.blocked_reason != null)
        .slice(0, 3)
        .map((candidate) => `${candidate.profile.model_id}: ${candidate.blocked_reason}`)
        .join(' | ');

    return blockerSummary
        ? `Routing engine could not find an approved model candidate for this case. ${blockerSummary}`
        : 'Routing engine could not find an approved model candidate for this case.';
}

function buildCandidateReason(input: {
    profile: RoutingModelProfile;
    analysis: RoutingInputAnalysis;
    systemState: RoutingSystemState;
    requestedModelName: string;
    performance: RoutingModelPerformance | null;
}) {
    const reasons: string[] = [];
    if (input.analysis.complexity_score < 0.3 && input.profile.model_type === 'fast') reasons.push('low complexity');
    if (input.analysis.complexity_score > 0.7 && input.profile.model_type === 'deep_reasoning') reasons.push('high complexity');
    if (input.analysis.contradiction_score > 0 && input.profile.model_type === 'adversarial_resistant') reasons.push('contradiction handling');
    if (input.analysis.high_risk && (input.profile.model_type === 'high_recall' || input.profile.model_type === 'adversarial_resistant')) reasons.push('high-risk recall');
    if (input.systemState.safe_mode_enabled && input.profile.model_type !== 'fast') reasons.push('safe mode');
    if (normalizeModelKey(input.profile.provider_model) === normalizeModelKey(input.requestedModelName)) reasons.push('matches requested provider');
    if (input.performance?.accuracy != null) reasons.push(`accuracy=${roundNumber(input.performance.accuracy, 3)}`);
    return reasons.join(', ') || 'balanced candidate';
}

function computeRoutingScore(input: {
    profile: RoutingModelProfile;
    performance: RoutingModelPerformance | null;
    analysis: RoutingInputAnalysis;
    systemState: RoutingSystemState;
    requestedModelName: string;
    requestedModelVersion: string;
}) {
    const dynamicAccuracy = input.performance?.accuracy ?? input.profile.base_accuracy;
    const dynamicLatency = input.performance?.avg_latency_ms ?? input.profile.expected_latency_ms;
    const dynamicHighRiskAccuracy = input.performance?.high_risk_accuracy ?? dynamicAccuracy;
    const latencyScore = 1 - clampNumber(dynamicLatency / 2_000, 0, 1);
    let score =
        (dynamicAccuracy * 0.34)
        + (latencyScore * (input.analysis.high_risk ? 0.06 : 0.18))
        + (input.profile.robustness_score * Math.min(0.34, input.analysis.contradiction_score * 0.48))
        + (input.profile.recall_score * (input.analysis.high_risk ? 0.22 : input.analysis.risk_score * 0.14))
        + (dynamicHighRiskAccuracy * (input.analysis.high_risk ? 0.14 : 0.04));
    score -= input.profile.base_cost * (input.analysis.high_risk ? 0.01 : 0.08);

    if (input.profile.model_type === 'fast') {
        score += input.analysis.complexity_score < 0.3 ? 0.38 : -0.08;
    }
    if (input.profile.model_type === 'deep_reasoning') {
        score += input.analysis.complexity_score > 0.7 ? 0.24 : input.analysis.complexity_score < 0.3 ? -0.05 : 0.03;
    }
    if (input.profile.model_type === 'adversarial_resistant') {
        score += input.analysis.contradiction_score > 0
            ? 0.27
            : input.analysis.high_risk
                ? 0.08
                : -0.08;
    }
    if (input.profile.model_type === 'high_recall') {
        score += input.analysis.high_risk ? 0.26 : -0.06;
    }

    if (input.systemState.family_node_status === 'critical' && input.profile.model_type === 'fast') {
        score -= 0.16;
    }
    if (input.systemState.safe_mode_enabled && input.profile.model_type === 'fast') {
        score -= 0.22;
    }
    if (input.systemState.alert_pressure >= 3) {
        score += input.profile.robustness_score * 0.08;
    }
    if (
        normalizeModelKey(input.profile.provider_model) === normalizeModelKey(input.requestedModelName)
        || normalizeModelKey(input.profile.model_id) === normalizeModelKey(input.requestedModelName)
    ) {
        score += 0.05;
    }
    if (normalizeModelKey(input.profile.model_version) === normalizeModelKey(input.requestedModelVersion)) {
        score += 0.03;
    }
    if (input.performance?.fallback_rate != null) {
        score -= input.performance.fallback_rate * 0.12;
    }

    return roundNumber(score, 4);
}

function buildConsensus<T>(
    successful: Array<RoutingExecutionEnvelope<T>>,
): Record<string, unknown> {
    const buckets = new Map<string, { count: number; confidenceSum: number; modelIds: string[] }>();

    for (const execution of successful) {
        const output = asRecord(execution.output);
        const prediction = extractPredictionLabel(asRecord(output.output_payload))
            ?? readString(asRecord(output.output_payload).prediction)
            ?? execution.profile.model_id;
        const confidence = numberOrNull(output.confidence_score) ?? 0;
        const bucket = buckets.get(prediction) ?? { count: 0, confidenceSum: 0, modelIds: [] };
        bucket.count += 1;
        bucket.confidenceSum += confidence;
        bucket.modelIds.push(execution.profile.model_id);
        buckets.set(prediction, bucket);
    }

    const ordered = Array.from(buckets.entries())
        .map(([prediction, bucket]) => ({
            prediction,
            agreement_count: bucket.count,
            agreement_ratio: successful.length > 0 ? roundNumber(bucket.count / successful.length, 3) : null,
            avg_confidence: successful.length > 0 ? roundNumber(bucket.confidenceSum / bucket.count, 3) : null,
            model_ids: bucket.modelIds,
        }))
        .sort((left, right) => (right.agreement_count - left.agreement_count) || ((right.avg_confidence ?? 0) - (left.avg_confidence ?? 0)));

    const winner = ordered[0] ?? null;
    return {
        selected_prediction: winner?.prediction ?? null,
        agreement_ratio: winner?.agreement_ratio ?? null,
        candidates: ordered,
        model_count: successful.length,
    };
}

function resolveConsensusSelection<T>(
    successful: Array<RoutingExecutionEnvelope<T>>,
    consensus: Record<string, unknown>,
): RoutingExecutionEnvelope<T> {
    const selectedPrediction = readString(consensus.selected_prediction);
    if (selectedPrediction) {
        const agreeing = successful.filter((execution) =>
            extractPredictionLabel(asRecord(asRecord(execution.output).output_payload)) === selectedPrediction,
        );
        const robustWinner = agreeing.find((execution) => execution.profile.model_type === 'adversarial_resistant');
        if (robustWinner) return robustWinner;
        const highRecallWinner = agreeing.find((execution) => execution.profile.model_type === 'high_recall');
        if (highRecallWinner) return highRecallWinner;
        const highestConfidenceAgreeing = agreeing
            .slice()
            .sort((left, right) =>
                (numberOrNull(asRecord(right.output).confidence_score) ?? 0)
                - (numberOrNull(asRecord(left.output).confidence_score) ?? 0),
            )[0];
        if (highestConfidenceAgreeing) return highestConfidenceAgreeing;
    }

    const robust = successful.find((execution) => execution.profile.model_type === 'adversarial_resistant');
    if (robust) return robust;
    return successful
        .slice()
        .sort((left, right) =>
            (numberOrNull(asRecord(right.output).confidence_score) ?? 0)
            - (numberOrNull(asRecord(left.output).confidence_score) ?? 0),
        )[0]!;
}

function serializeCandidate(candidate: RoutingCandidate) {
    return {
        model_id: candidate.profile.model_id,
        provider_model: candidate.profile.provider_model,
        model_type: candidate.profile.model_type,
        score: candidate.score,
        reason: candidate.reason,
        blocked_reason: candidate.blocked_reason,
        dynamic_accuracy: candidate.dynamic_accuracy,
        dynamic_latency_ms: candidate.dynamic_latency_ms,
        registry_id: candidate.registry_record?.registry_id ?? candidate.profile.registry_id,
    };
}

function serializeFallbackChain(plan: RoutingPlan) {
    return dedupeProfiles([
        ...plan.selected_models,
        plan.fallback_model,
    ])
        .map((profile) => ({
            model_id: profile.model_id,
            provider_model: profile.provider_model,
            model_version: profile.model_version,
            model_type: profile.model_type,
        }));
}

function serializeAttempt(attempt: RoutingExecutionAttempt) {
    return {
        model_id: attempt.model_id,
        model_version: attempt.model_version,
        provider_model: attempt.provider_model,
        status: attempt.status,
        reason: attempt.reason,
        prediction: attempt.prediction,
        confidence: attempt.confidence,
    };
}

function buildEphemeralRoutingDecision(
    plan: RoutingPlan,
    primary: RoutingModelProfile | null,
    caseId: string | null,
): RoutingDecisionRecord {
    const now = new Date().toISOString();
    return {
        routing_decision_id: plan.routing_decision_id,
        tenant_id: plan.tenant_id,
        case_id: caseId,
        inference_event_id: null,
        outcome_event_id: null,
        evaluation_event_id: null,
        requested_model_name: plan.requested_model_name,
        requested_model_version: plan.requested_model_version,
        selected_model_id: primary?.model_id ?? 'unassigned',
        selected_provider_model: primary?.provider_model ?? 'unassigned',
        selected_model_version: primary?.model_version ?? 'unassigned',
        selected_registry_id: primary?.registry_id ?? null,
        model_family: plan.family,
        route_mode: plan.route_mode,
        execution_status: 'planned',
        trigger_reason: plan.reason,
        analysis: {
            ...plan.analysis,
        },
        candidates: plan.candidates.map(serializeCandidate),
        fallback_chain: serializeFallbackChain(plan),
        consensus_payload: null,
        actual_latency_ms: null,
        prediction: null,
        prediction_confidence: null,
        outcome_correct: null,
        created_at: now,
        updated_at: now,
    };
}

function mapRoutingDecisionRow(
    row: Record<string, unknown>,
    plan?: RoutingPlan,
): RoutingDecisionRecord {
    const C = MODEL_ROUTING_DECISIONS.COLUMNS;
    return {
        routing_decision_id: readString(row[C.routing_decision_id]) ?? plan?.routing_decision_id ?? randomUUID(),
        tenant_id: readString(row[C.tenant_id]) ?? plan?.tenant_id ?? '',
        case_id: readString(row[C.case_id]),
        inference_event_id: readString(row[C.inference_event_id]),
        outcome_event_id: readString(row[C.outcome_event_id]),
        evaluation_event_id: readString(row[C.evaluation_event_id]),
        requested_model_name: readString(row[C.requested_model_name]) ?? plan?.requested_model_name ?? 'unknown',
        requested_model_version: readString(row[C.requested_model_version]) ?? plan?.requested_model_version ?? 'unknown',
        selected_model_id: readString(row[C.selected_model_id]) ?? plan?.selected_models[0]?.model_id ?? 'unknown',
        selected_provider_model: readString(row[C.selected_provider_model]) ?? plan?.selected_models[0]?.provider_model ?? 'unknown',
        selected_model_version: readString(row[C.selected_model_version]) ?? plan?.selected_models[0]?.model_version ?? 'unknown',
        selected_registry_id: readString(row[C.selected_registry_id]),
        model_family: readModelFamily(row[C.model_family]) ?? plan?.family ?? 'diagnostics',
        route_mode: readRouteMode(row[C.route_mode]) ?? plan?.route_mode ?? 'single',
        execution_status: readExecutionStatus(row[C.execution_status]),
        trigger_reason: readString(row[C.trigger_reason]) ?? plan?.reason ?? 'routing',
        analysis: asRecord(row[C.analysis]),
        candidates: asRecordArray(row[C.candidates]),
        fallback_chain: asRecordArray(row[C.fallback_chain]),
        consensus_payload: recordOrNull(row[C.consensus_payload]),
        actual_latency_ms: numberOrNull(row[C.actual_latency_ms]),
        prediction: readString(row[C.prediction]),
        prediction_confidence: numberOrNull(row[C.prediction_confidence]),
        outcome_correct: booleanOrNull(row[C.outcome_correct]),
        created_at: readString(row[C.created_at]) ?? new Date().toISOString(),
        updated_at: readString(row[C.updated_at]) ?? new Date().toISOString(),
    };
}

function mapRoutingProfileRow(row: Record<string, unknown>): RoutingModelProfile | null {
    const C = MODEL_ROUTER_PROFILES.COLUMNS;
    const modelFamily = readModelFamily(row[C.model_family]);
    const modelType = readRoutingModelType(row[C.model_type]);
    const modelId = readString(row[C.model_id]);
    const providerModel = readString(row[C.provider_model]);
    const modelName = readString(row[C.model_name]);
    const modelVersion = readString(row[C.model_version]);

    if (!modelFamily || !modelType || !modelId || !providerModel || !modelVersion) {
        return null;
    }

    const metadata = asRecord(row[C.metadata]);
    return {
        id: readString(row[C.id]) ?? modelId,
        tenant_id: readString(row[C.tenant_id]) ?? '',
        model_id: modelId,
        model_family: modelFamily,
        model_type: modelType,
        provider_model: providerModel,
        model_name: modelName ?? modelId,
        model_version: modelVersion,
        registry_id: readString(row[C.registry_id]),
        approval_status: readRoutingApprovalStatus(row[C.approval_status]),
        active: row[C.active] !== false,
        expected_latency_ms: clampNumber(numberOrNull(row[C.expected_latency_ms]) ?? expectedLatencyForType(modelType), 80, 5_000),
        base_accuracy: clampNumber(numberOrNull(row[C.base_accuracy]) ?? defaultAccuracyForType(modelType), 0.25, 0.99),
        base_cost: clampNumber(numberOrNull(row[C.base_cost]) ?? defaultCostForType(modelType), 0, 1),
        robustness_score: clampNumber(numberOrNull(row[C.robustness_score]) ?? defaultRobustnessForType(modelType), 0, 1),
        recall_score: clampNumber(numberOrNull(row[C.recall_score]) ?? defaultRecallForType(modelType), 0, 1),
        metadata: {
            source: readString(metadata.source) ?? 'router_profile',
            ...metadata,
        },
    };
}

function resolveRegistryRecordForProfile(
    familyGroup: RegistryFamilyGroup | null,
    profile: RoutingModelProfile,
): ModelRegistryRecord | null {
    if (!familyGroup) return null;
    return familyGroup.entries.find((entry) =>
        entry.registry.registry_id === profile.registry_id
        || normalizeModelKey(entry.registry.model_version) === normalizeModelKey(profile.model_version)
        || normalizeModelKey(entry.registry.model_name) === normalizeModelKey(profile.model_name)
    )?.registry ?? null;
}

function resolveBlockedReason(
    profile: RoutingModelProfile,
    registryRecord: ModelRegistryRecord | null,
) {
    if (!profile.active) {
        return 'Model is not active in the router profile.';
    }
    if (profile.approval_status !== 'approved') {
        return profile.approval_status === 'pending'
            ? 'Model approval is still pending.'
            : 'Model has been blocked from routing.';
    }
    if (!registryRecord) {
        return isExplicitlyApprovedUngovernedProfile(profile)
            ? null
            : 'Ungoverned requested/default models cannot receive routed traffic until they are approved in the router profile or model registry.';
    }
    if (registryRecord.registry_role === 'at_risk') {
        return 'Registry marks this model as at_risk.';
    }
    if (registryRecord.lifecycle_status === 'archived') {
        return 'Archived registry models cannot receive traffic.';
    }
    if (registryRecord.lifecycle_status !== 'production' && registryRecord.registry_role !== 'rollback_target') {
        return 'Only production or approved rollback-safe models may receive routed traffic.';
    }
    return null;
}

function isExplicitlyApprovedUngovernedProfile(profile: RoutingModelProfile) {
    const source = readString(profile.metadata.source);
    if (profile.metadata.explicitly_approved === true) return true;
    return source === 'router_profile' || source === 'model_registry';
}

function readRoutingDirective(inputSignature: Record<string, unknown>): RoutingDirective {
    const metadata = asRecord(inputSignature.metadata);
    const routing = asRecord(metadata.routing);
    return {
        manual_override_model_id:
            readString(routing.force_model_id)
            ?? readString(routing.manual_override_model_id)
            ?? readString(metadata.force_model_id),
        force_ensemble: routing.force_ensemble === true,
        disable_ensemble: routing.disable_ensemble === true,
    };
}

function resolveModelFamily(inputSignature: Record<string, unknown>): ModelFamily {
    const metadata = asRecord(inputSignature.metadata);
    const rawTaskType = readString(inputSignature.task_type) ?? readString(metadata.task_type) ?? '';
    const rawTargetType = readString(inputSignature.target_type) ?? readString(metadata.target_type) ?? '';
    const familyHint = readString(metadata.model_family) ?? readString(metadata.family);
    const routeHint = `${readString(metadata.route_hint) ?? ''} ${readString(metadata.workflow) ?? ''}`.toLowerCase();
    if (familyHint === 'vision' || familyHint === 'therapeutics' || familyHint === 'diagnostics') {
        return familyHint;
    }

    const lowerTask = rawTaskType.toLowerCase();
    const lowerTarget = rawTargetType.toLowerCase();
    const hasImages = countArray(inputSignature.diagnostic_images) > 0;
    const hasClinicalSymptoms = countArray(inputSignature.symptoms) > 0;
    const therapeuticText = `${lowerTask} ${lowerTarget} ${routeHint}`.toLowerCase();
    const visionHint = `${lowerTask} ${lowerTarget} ${routeHint}`.toLowerCase();

    if (
        lowerTask.includes('vision')
        || lowerTarget.includes('vision')
        || lowerTarget.includes('image')
        || visionHint.includes('vision')
        || visionHint.includes('image_only')
        || (hasImages && !hasClinicalSymptoms && !therapeuticText.includes('diagnos'))
    ) {
        return 'vision';
    }
    if (therapeuticText.includes('therapeut') || therapeuticText.includes('treatment') || therapeuticText.includes('medication')) {
        return 'therapeutics';
    }
    return 'diagnostics';
}

function countAttachments(inputSignature: Record<string, unknown>) {
    return countArray(inputSignature.diagnostic_images) + countArray(inputSignature.lab_results);
}

function mergeProfiles(profiles: RoutingModelProfile[]) {
    const merged = new Map<string, RoutingModelProfile>();
    for (const profile of profiles) {
        const key = normalizeModelKey(profile.model_id) || normalizeModelKey(profile.model_version);
        if (!key) continue;
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, profile);
            continue;
        }
        merged.set(key, {
            ...existing,
            ...profile,
            metadata: {
                ...existing.metadata,
                ...profile.metadata,
            },
            active: existing.active || profile.active,
            approval_status: profile.approval_status === 'approved' || existing.approval_status !== 'approved'
                ? profile.approval_status
                : existing.approval_status,
        });
    }
    return Array.from(merged.values());
}

function inferRoutingModelType(
    modelName: string | null,
    modelVersion: string | null,
    registryRole: string | null,
): RoutingModelProfile['model_type'] {
    const label = `${modelName ?? ''} ${modelVersion ?? ''} ${registryRole ?? ''}`.toLowerCase();
    if (label.includes('robust') || label.includes('adversarial')) return 'adversarial_resistant';
    if (label.includes('recall') || label.includes('safety')) return 'high_recall';
    if (label.includes('large') || label.includes('deep') || label.includes('reason')) return 'deep_reasoning';
    if (label.includes('small') || label.includes('fast') || label.includes('mini')) return 'fast';
    return registryRole === 'rollback_target' ? 'adversarial_resistant' : 'deep_reasoning';
}

function inferRegistryApprovalStatus(
    registry: ModelRegistryRecord,
    isActiveRoute: boolean,
    promotionAllowed: boolean,
): RoutingModelProfile['approval_status'] {
    if (registry.registry_role === 'at_risk' || registry.lifecycle_status === 'archived') return 'blocked';
    if (registry.lifecycle_status === 'production' || isActiveRoute || promotionAllowed || registry.registry_role === 'rollback_target') return 'approved';
    return 'pending';
}

function expectedLatencyForType(modelType: RoutingModelProfile['model_type']) {
    switch (modelType) {
        case 'fast':
            return 260;
        case 'adversarial_resistant':
            return 620;
        case 'high_recall':
            return 720;
        default:
            return 950;
    }
}

function defaultAccuracyForType(modelType: RoutingModelProfile['model_type']) {
    switch (modelType) {
        case 'fast':
            return 0.76;
        case 'adversarial_resistant':
            return 0.87;
        case 'high_recall':
            return 0.85;
        default:
            return 0.89;
    }
}

function defaultCostForType(modelType: RoutingModelProfile['model_type']) {
    switch (modelType) {
        case 'fast':
            return 0.18;
        case 'adversarial_resistant':
            return 0.58;
        case 'high_recall':
            return 0.65;
        default:
            return 0.82;
    }
}

function defaultRobustnessForType(modelType: RoutingModelProfile['model_type']) {
    switch (modelType) {
        case 'fast':
            return 0.48;
        case 'adversarial_resistant':
            return 0.94;
        case 'high_recall':
            return 0.82;
        default:
            return 0.72;
    }
}

function defaultRecallForType(modelType: RoutingModelProfile['model_type']) {
    switch (modelType) {
        case 'fast':
            return 0.66;
        case 'adversarial_resistant':
            return 0.9;
        case 'high_recall':
            return 0.95;
        default:
            return 0.84;
    }
}

function emergencyLevelToRisk(level: RoutingInputAnalysis['emergency_level']) {
    switch (level) {
        case 'CRITICAL':
            return 0.84;
        case 'HIGH':
            return 0.66;
        case 'MODERATE':
            return 0.44;
        default:
            return 0.2;
    }
}

function buildSuccessAttempt<T>(profile: RoutingModelProfile, output: T): RoutingExecutionAttempt {
    const result = asRecord(output);
    return {
        model_id: profile.model_id,
        model_version: profile.model_version,
        provider_model: profile.provider_model,
        status: 'success',
        reason: null,
        prediction: extractPredictionLabel(asRecord(result.output_payload)),
        confidence: numberOrNull(result.confidence_score),
    };
}

function familyPrefix(family: ModelFamily) {
    if (family === 'vision') return 'vision';
    if (family === 'therapeutics') return 'ther';
    return 'diag';
}

function countArray(value: unknown) {
    return Array.isArray(value) ? value.length : 0;
}

function dedupeProfiles<T extends RoutingModelProfile | null | undefined>(profiles: T[]) {
    const seen = new Set<string>();
    const output: RoutingModelProfile[] = [];
    for (const profile of profiles) {
        if (!profile) continue;
        if (seen.has(profile.model_id)) continue;
        seen.add(profile.model_id);
        output.push(profile);
    }
    return output;
}

function dedupeStrings(values: string[]) {
    return values.filter((value, index) => value.trim().length > 0 && values.indexOf(value) === index);
}

function readRoutingModelType(value: unknown): RoutingModelProfile['model_type'] | null {
    return value === 'fast' || value === 'deep_reasoning' || value === 'adversarial_resistant' || value === 'high_recall'
        ? value
        : null;
}

function readRoutingApprovalStatus(value: unknown): RoutingModelProfile['approval_status'] {
    return value === 'pending' || value === 'blocked' ? value : 'approved';
}

function readRouteMode(value: unknown): RoutingMode | null {
    return value === 'ensemble' || value === 'manual_override' || value === 'single'
        ? value
        : null;
}

function readExecutionStatus(value: unknown): RoutingDecisionRecord['execution_status'] {
    return value === 'executed' || value === 'fallback_executed' || value === 'failed' ? value : 'planned';
}

function readModelFamily(value: unknown): ModelFamily | null {
    return value === 'diagnostics' || value === 'vision' || value === 'therapeutics'
        ? value
        : null;
}

function readNodeStatus(value: unknown): RoutingSystemState['family_node_status'] {
    return value === 'healthy' || value === 'degraded' || value === 'critical' || value === 'offline'
        ? value
        : null;
}

function normalizeModelKey(value: string | null | undefined) {
    if (!value) return '';
    return value.trim().toLowerCase();
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function asRecordArray(value: unknown) {
    return Array.isArray(value)
        ? value
            .map((entry) => recordOrNull(entry))
            .filter((entry): entry is Record<string, unknown> => entry != null)
        : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function numberOrNull(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

function booleanOrFalse(value: unknown) {
    return value === true;
}

function mean(values: number[]) {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
    return numerator / denominator;
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number, digits: number) {
    return Number(value.toFixed(digits));
}

function extractErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        return String((error as { message?: unknown }).message ?? 'Unknown error');
    }
    return String(error ?? 'Unknown error');
}

function isMissingRelationError(error: unknown, table?: string) {
    const message = extractErrorMessage(error).toLowerCase();
    return message.includes('does not exist')
        && (table == null || message.includes(table.toLowerCase()));
}

const FAMILY_TO_NODE: Record<ModelFamily, string> = {
    diagnostics: 'diagnostics_model',
    vision: 'vision_model',
    therapeutics: 'therapeutics_model',
};
