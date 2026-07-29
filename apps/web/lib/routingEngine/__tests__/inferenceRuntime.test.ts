import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildInferenceRoutingMetadata,
    resolveInferenceRoutingModel,
    runInferenceWithRouting,
} from '@/lib/routingEngine/inferenceRuntime';
import {
    buildDefaultRoutingProfiles,
    mergeRoutingProfilesForTest,
} from '@/lib/routingEngine/service';
import type {
    RoutingModelProfile,
    RoutingPlan,
} from '@/lib/routingEngine/types';

const CLIENT = {} as SupabaseClient;
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
    delete process.env.VETIOS_ALLOW_UNGOVERNED_ROUTING_PROFILES;
});

describe('inference routing runtime', () => {
    it('executes and reports the model selected by the routing plan', async () => {
        const selected = profile('approved_robust', 'provider/robust');
        const plan = routingPlan(selected);
        const persistPlan = vi.fn(async () => undefined);
        const executor = vi.fn(async (model: string) => pipelineOutput(model));

        const runtime = await runInferenceWithRouting({
            client: CLIENT,
            tenantId: TENANT_ID,
            requestedModelName: 'provider/current',
            requestedModelVersion: 'current-v1',
            inputSignature: { species: 'canine', symptoms: ['fever'] },
            executor,
            dependencies: {
                plan: async () => plan,
                persistPlan,
            },
        });

        expect(executor).toHaveBeenCalledWith('provider/robust');
        expect(persistPlan).toHaveBeenCalledOnce();
        expect(runtime.status).toBe('routed');
        expect(resolveInferenceRoutingModel(runtime)).toEqual({
            modelName: 'provider/robust',
            modelVersion: 'approved_robust-v1',
        });
        expect(buildInferenceRoutingMetadata(runtime)).toMatchObject({
            routing_runtime_status: 'routed',
            routing_selected_model_id: 'approved_robust',
            routing_decision_recorded: true,
        });
    });

    it('uses the requested model when route planning is unavailable', async () => {
        const executor = vi.fn(async (model: string) => pipelineOutput(model));

        const runtime = await runInferenceWithRouting({
            client: CLIENT,
            tenantId: TENANT_ID,
            requestedModelName: 'provider/current',
            requestedModelVersion: 'current-v1',
            inputSignature: { species: 'feline', symptoms: ['anorexia'] },
            executor,
            dependencies: {
                plan: async () => {
                    throw new Error('control plane unavailable');
                },
            },
        });

        expect(executor).toHaveBeenCalledWith('provider/current');
        expect(runtime).toMatchObject({
            status: 'degraded_direct',
            degraded_reason: 'routing_plan_unavailable',
            plan: null,
            decision_recorded: false,
        });
    });

    it('uses the requested model without claiming an audit record when persistence fails', async () => {
        const selected = profile('approved_robust', 'provider/robust');
        const plan = routingPlan(selected);
        const executor = vi.fn(async (model: string) => pipelineOutput(model));

        const runtime = await runInferenceWithRouting({
            client: CLIENT,
            tenantId: TENANT_ID,
            requestedModelName: 'provider/current',
            requestedModelVersion: 'current-v1',
            inputSignature: { species: 'canine', symptoms: ['fever'] },
            executor,
            dependencies: {
                plan: async () => plan,
                persistPlan: async () => {
                    throw new Error('routing ledger unavailable');
                },
            },
        });

        expect(executor).toHaveBeenCalledOnce();
        expect(executor).toHaveBeenCalledWith('provider/current');
        expect(runtime).toMatchObject({
            status: 'degraded_direct',
            degraded_reason: 'routing_decision_persistence_failed',
            decision_recorded: false,
        });
        expect(buildInferenceRoutingMetadata(runtime)).toMatchObject({
            routing_runtime_status: 'degraded_direct',
            routing_decision_recorded: false,
        });
    });

    it('settles a failed routed execution as a direct requested-model fallback', async () => {
        const selected = profile('approved_robust', 'provider/robust');
        const plan = routingPlan(selected);
        const executor = vi.fn(async (model: string) => {
            if (model === 'provider/robust') throw new Error('provider failed');
            return pipelineOutput(model);
        });

        const runtime = await runInferenceWithRouting({
            client: CLIENT,
            tenantId: TENANT_ID,
            requestedModelName: 'provider/current',
            requestedModelVersion: 'current-v1',
            inputSignature: { species: 'equine', symptoms: ['colic'] },
            executor,
            dependencies: {
                plan: async () => plan,
                persistPlan: async () => undefined,
            },
        });

        expect(executor.mock.calls.map(([model]) => model)).toEqual([
            'provider/robust',
            'provider/current',
        ]);
        expect(runtime).toMatchObject({
            status: 'degraded_direct',
            degraded_reason: 'routing_execution_failed',
            decision_recorded: true,
        });
        expect(runtime.execution).toMatchObject({
            fallback_used: true,
            selected_model: {
                provider_model: 'provider/current',
            },
        });
    });

    it('keeps ungoverned alternate defaults pending unless explicitly enabled', () => {
        const guarded = buildDefaultRoutingProfiles({
            tenantId: TENANT_ID,
            family: 'diagnostics',
            requestedModelName: 'provider/current',
            requestedModelVersion: 'current-v1',
        });

        expect(guarded[0]).toMatchObject({
            provider_model: 'provider/current',
            approval_status: 'approved',
        });
        expect(guarded.slice(1).every((candidate) => candidate.approval_status === 'pending')).toBe(true);

        process.env.VETIOS_ALLOW_UNGOVERNED_ROUTING_PROFILES = 'true';
        const explicitlyEnabled = buildDefaultRoutingProfiles({
            tenantId: TENANT_ID,
            family: 'diagnostics',
            requestedModelName: 'provider/current',
            requestedModelVersion: 'current-v1',
        });
        expect(explicitlyEnabled.slice(1).every((candidate) => candidate.approval_status === 'approved')).toBe(true);
    });

    it('allows a higher-priority operator profile to block and deactivate a model', () => {
        const registryProfile = profile('approved_robust', 'provider/robust');
        const operatorBlock: RoutingModelProfile = {
            ...registryProfile,
            approval_status: 'blocked',
            active: false,
            metadata: {
                source: 'router_profile',
                block_reason: 'operator safety hold',
            },
        };

        expect(mergeRoutingProfilesForTest([
            registryProfile,
            operatorBlock,
        ])).toEqual([
            expect.objectContaining({
                model_id: 'approved_robust',
                approval_status: 'blocked',
                active: false,
                metadata: expect.objectContaining({
                    source: 'router_profile',
                    block_reason: 'operator safety hold',
                }),
            }),
        ]);
    });
});

function profile(modelId: string, providerModel: string): RoutingModelProfile {
    return {
        id: modelId,
        tenant_id: TENANT_ID,
        model_id: modelId,
        model_family: 'diagnostics',
        model_type: 'adversarial_resistant',
        provider_model: providerModel,
        model_name: modelId,
        model_version: `${modelId}-v1`,
        registry_id: 'registry-1',
        approval_status: 'approved',
        active: true,
        expected_latency_ms: 600,
        base_accuracy: 0.88,
        base_cost: 0.6,
        robustness_score: 0.92,
        recall_score: 0.9,
        metadata: { source: 'model_registry' },
    };
}

function routingPlan(selected: RoutingModelProfile): RoutingPlan {
    return {
        routing_decision_id: '22222222-2222-4222-8222-222222222222',
        tenant_id: TENANT_ID,
        requested_model_name: 'provider/current',
        requested_model_version: 'current-v1',
        family: 'diagnostics',
        analysis: {
            family: 'diagnostics',
            complexity_score: 0.7,
            risk_score: 0.8,
            symptom_count: 1,
            contradiction_score: 0,
            confidence_expected: 0.6,
            emergency_level: 'HIGH',
            high_risk: true,
            structured_signal_count: 1,
            attachment_count: 0,
            reasons: ['high risk'],
        },
        route_mode: 'single',
        selected_models: [selected],
        fallback_model: null,
        candidates: [{
            profile: selected,
            score: 0.91,
            reason: 'approved robust model',
            blocked_reason: null,
            dynamic_accuracy: null,
            dynamic_latency_ms: null,
            registry_record: null,
        }],
        reason: 'approved robust model selected',
        manual_override: false,
        system_state: {
            safe_mode_enabled: false,
            family_node_status: 'healthy',
            active_registry_role: 'champion',
            alert_pressure: 0,
        },
    };
}

function pipelineOutput(model: string) {
    return {
        output_payload: {
            diagnosis: {
                top_differentials: [{ name: `${model}-diagnosis`, probability: 0.8 }],
            },
        },
        confidence_score: 0.8,
    };
}
