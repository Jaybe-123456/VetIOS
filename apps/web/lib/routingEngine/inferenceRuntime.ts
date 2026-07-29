import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildDefaultRoutingProfiles,
    buildRoutingTelemetryMetadata,
    createRoutingDecisionRecord,
    executeRoutingPlan,
    failRoutingDecisionRecord,
    finalizeRoutingDecisionRecord,
    planModelRoute,
} from '@/lib/routingEngine/service';
import type {
    RoutingExecutionResult,
    RoutingModelProfile,
    RoutingPlan,
} from '@/lib/routingEngine/types';
import { extractPredictionLabel } from '@/lib/telemetry/service';

type RoutingRuntimeStatus = 'routed' | 'degraded_direct';

interface RoutingPlanningInput {
    client: SupabaseClient;
    tenantId: string;
    requestedModelName: string;
    requestedModelVersion: string;
    inputSignature: Record<string, unknown>;
    caseId?: string | null;
}

interface RoutingRuntimeDependencies {
    plan(input: RoutingPlanningInput): Promise<RoutingPlan>;
    persistPlan(
        client: SupabaseClient,
        plan: RoutingPlan,
        input: { caseId?: string | null },
    ): Promise<unknown>;
    execute<T>(input: {
        plan: RoutingPlan;
        executor: (profile: RoutingModelProfile) => Promise<T>;
    }): Promise<RoutingExecutionResult<T>>;
    fail(
        client: SupabaseClient,
        routingDecisionId: string,
        reason: string,
    ): Promise<void>;
}

export interface InferenceRoutingRuntimeResult<T> {
    output: T;
    status: RoutingRuntimeStatus;
    degraded_reason: string | null;
    requested_model_name: string;
    requested_model_version: string;
    plan: RoutingPlan | null;
    execution: RoutingExecutionResult<T> | null;
    decision_recorded: boolean;
}

export interface RunInferenceWithRoutingInput<T> {
    client: SupabaseClient;
    tenantId: string;
    requestedModelName: string;
    requestedModelVersion: string;
    inputSignature: Record<string, unknown>;
    caseId?: string | null;
    executor(model: string): Promise<T>;
    dependencies?: Partial<RoutingRuntimeDependencies>;
}

const DEFAULT_DEPENDENCIES: RoutingRuntimeDependencies = {
    plan: planModelRoute,
    persistPlan: createRoutingDecisionRecord,
    execute: executeRoutingPlan,
    fail: failRoutingDecisionRecord,
};

export async function runInferenceWithRouting<T>(
    input: RunInferenceWithRoutingInput<T>,
): Promise<InferenceRoutingRuntimeResult<T>> {
    const dependencies = {
        ...DEFAULT_DEPENDENCIES,
        ...input.dependencies,
    };
    let plan: RoutingPlan | null = null;

    try {
        plan = await dependencies.plan({
            client: input.client,
            tenantId: input.tenantId,
            requestedModelName: input.requestedModelName,
            requestedModelVersion: input.requestedModelVersion,
            inputSignature: input.inputSignature,
            caseId: input.caseId,
        });
    } catch {
        return runDirectFallback(input, {
            plan: null,
            decisionRecorded: false,
            degradedReason: 'routing_plan_unavailable',
            dependencies,
        });
    }

    try {
        await dependencies.persistPlan(input.client, plan, {
            caseId: input.caseId ?? null,
        });
    } catch {
        return runDirectFallback(input, {
            plan,
            decisionRecorded: false,
            degradedReason: 'routing_decision_persistence_failed',
            dependencies,
        });
    }

    try {
        const execution = await dependencies.execute({
            plan,
            executor: (profile) => input.executor(profile.provider_model),
        });
        return {
            output: execution.routed_output,
            status: 'routed',
            degraded_reason: null,
            requested_model_name: input.requestedModelName,
            requested_model_version: input.requestedModelVersion,
            plan,
            execution,
            decision_recorded: true,
        };
    } catch (error) {
        return runDirectFallback(input, {
            plan,
            decisionRecorded: true,
            degradedReason: 'routing_execution_failed',
            dependencies,
            routingError: error,
        });
    }
}

export async function finalizeInferenceRouting<T>(input: {
    client: SupabaseClient;
    runtime: InferenceRoutingRuntimeResult<T>;
    inferenceEventId: string;
    caseId: string | null;
    actualLatencyMs: number;
    prediction: string | null;
    predictionConfidence: number | null;
}): Promise<void> {
    if (!input.runtime.plan || !input.runtime.execution || !input.runtime.decision_recorded) {
        return;
    }

    await finalizeRoutingDecisionRecord(
        input.client,
        input.runtime.plan,
        input.runtime.execution,
        {
            inferenceEventId: input.inferenceEventId,
            caseId: input.caseId,
            actualLatencyMs: input.actualLatencyMs,
            prediction: input.prediction,
            predictionConfidence: input.predictionConfidence,
        },
    );
}

export async function failInferenceRouting<T>(input: {
    client: SupabaseClient;
    runtime: InferenceRoutingRuntimeResult<T> | null;
    reason: string;
}): Promise<void> {
    if (!input.runtime?.plan || !input.runtime.decision_recorded) {
        return;
    }

    await failRoutingDecisionRecord(
        input.client,
        input.runtime.plan.routing_decision_id,
        input.reason,
    );
}

export function buildInferenceRoutingMetadata<T>(
    runtime: InferenceRoutingRuntimeResult<T>,
): Record<string, unknown> {
    if (runtime.plan && runtime.execution) {
        return {
            routing_runtime_status: runtime.status,
            routing_degraded_reason: runtime.degraded_reason,
            ...buildRoutingTelemetryMetadata({
                plan: runtime.plan,
                execution: runtime.execution,
            }),
            routing_selected_expected_latency_ms: runtime.execution.selected_model.expected_latency_ms,
            routing_selected_cost_index: runtime.execution.selected_model.base_cost,
            routing_selected_approval_status: runtime.execution.selected_model.approval_status,
            routing_decision_recorded: runtime.decision_recorded,
        };
    }

    return {
        routing_runtime_status: runtime.status,
        routing_degraded_reason: runtime.degraded_reason,
        routing_requested_model_name: runtime.requested_model_name,
        routing_requested_model_version: runtime.requested_model_version,
        routing_selected_provider_model: runtime.requested_model_name,
        routing_selected_model_version: runtime.requested_model_version,
        routing_route_mode: 'single',
        routing_fallback_used: true,
        routing_decision_recorded: false,
    };
}

export function resolveInferenceRoutingModel<T>(
    runtime: InferenceRoutingRuntimeResult<T>,
): { modelName: string; modelVersion: string } {
    const selected = runtime.execution?.selected_model;
    return {
        modelName: selected?.provider_model ?? runtime.requested_model_name,
        modelVersion: selected?.model_version ?? runtime.requested_model_version,
    };
}

async function runDirectFallback<T>(
    input: RunInferenceWithRoutingInput<T>,
    state: {
        plan: RoutingPlan | null;
        decisionRecorded: boolean;
        degradedReason: string;
        dependencies: RoutingRuntimeDependencies;
        routingError?: unknown;
    },
): Promise<InferenceRoutingRuntimeResult<T>> {
    try {
        const output = await input.executor(input.requestedModelName);
        const execution = state.plan
            ? buildDirectFallbackExecution({
                plan: state.plan,
                output,
                tenantId: input.tenantId,
                requestedModelName: input.requestedModelName,
                requestedModelVersion: input.requestedModelVersion,
            })
            : null;

        return {
            output,
            status: 'degraded_direct',
            degraded_reason: state.degradedReason,
            requested_model_name: input.requestedModelName,
            requested_model_version: input.requestedModelVersion,
            plan: state.plan,
            execution,
            decision_recorded: state.decisionRecorded,
        };
    } catch (directError) {
        if (state.plan && state.decisionRecorded) {
            const routingReason = extractErrorMessage(state.routingError);
            const directReason = extractErrorMessage(directError);
            await state.dependencies.fail(
                input.client,
                state.plan.routing_decision_id,
                `Routed execution failed (${routingReason}); direct fallback failed (${directReason}).`,
            ).catch(() => undefined);
        }
        throw directError;
    }
}

function buildDirectFallbackExecution<T>(input: {
    plan: RoutingPlan;
    output: T;
    tenantId: string;
    requestedModelName: string;
    requestedModelVersion: string;
}): RoutingExecutionResult<T> {
    const requestedProfile = buildDefaultRoutingProfiles({
        tenantId: input.tenantId,
        family: input.plan.family,
        requestedModelName: input.requestedModelName,
        requestedModelVersion: input.requestedModelVersion,
    })[0]!;
    const outputRecord = asRecord(input.output);
    const outputPayload = asRecord(outputRecord.output_payload);

    return {
        routed_output: input.output,
        selected_model: requestedProfile,
        executed_models: [requestedProfile],
        attempts: [{
            model_id: requestedProfile.model_id,
            model_version: requestedProfile.model_version,
            provider_model: requestedProfile.provider_model,
            status: 'success',
            reason: 'Direct requested-model fallback after routed execution failure.',
            prediction: extractPredictionLabel(outputPayload),
            confidence: readNumber(outputRecord.confidence_score),
        }],
        route_mode: 'single',
        fallback_used: true,
        consensus: null,
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message?: unknown }).message ?? 'unknown_error');
    }
    return String(error ?? 'unknown_error');
}
