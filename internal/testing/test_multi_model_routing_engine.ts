import assert from 'node:assert/strict';
import {
    analyzeRoutingInput,
    buildDefaultRoutingProfiles,
    buildRoutingTelemetryMetadata,
    executeRoutingPlan,
    rankRoutingCandidatesForTest,
    resolveRegistryProviderModelForTest,
    resolveRoutingPlanForTest,
} from '../../apps/web/lib/routingEngine/service.ts';
import type {
    RoutingCandidate,
    RoutingModelProfile,
    RoutingPlan,
    RoutingSystemState,
} from '../../apps/web/lib/routingEngine/types.ts';

const TENANT_ID = 'tenant-routing-test';

function makeSystemState(overrides: Partial<RoutingSystemState> = {}): RoutingSystemState {
    return {
        safe_mode_enabled: false,
        family_node_status: 'healthy',
        active_registry_role: 'champion',
        alert_pressure: 0,
        ...overrides,
    };
}

function makeLowComplexityInput() {
    return {
        species: 'dog',
        breed: 'beagle',
        symptoms: ['vomiting'],
        metadata: {},
    };
}

function makeHighComplexityInput() {
    return {
        species: 'dog',
        breed: 'german shepherd',
        symptoms: [
            'dyspnea',
            'tachycardia',
            'collapse',
            'weakness',
            'abdominal distension',
            'dry heaving',
            'hypersalivation',
        ],
        diagnostic_images: [{ file_name: 'abdomen.png' }],
        lab_results: [{ file_name: 'cbc.txt' }],
        metadata: {
            raw_note: 'Multiple acute changes with conflicting owner reports and emergent signs.',
            appetite_status: 'normal',
            duration: '3 days',
        },
    };
}

function makeContradictoryInput() {
    return {
        species: 'dog',
        breed: 'great dane',
        symptoms: ['dry heaving', 'distended abdomen', 'collapse'],
        metadata: {
            productive_vomiting: true,
            abdominal_distension: false,
            raw_note: 'Trying to vomit but also reported as productive vomiting elsewhere.',
        },
    };
}

function makeExecutorFailurePlan(profileA: RoutingModelProfile, profileB: RoutingModelProfile): RoutingPlan {
    return {
        routing_decision_id: 'route-fallback-test',
        tenant_id: TENANT_ID,
        requested_model_name: profileA.provider_model,
        requested_model_version: profileA.model_version,
        family: 'diagnostics',
        analysis: {
            family: 'diagnostics',
            complexity_score: 0.22,
            risk_score: 0.18,
            symptom_count: 2,
            contradiction_score: 0,
            confidence_expected: 0.86,
            emergency_level: 'LOW',
            high_risk: false,
            structured_signal_count: 1,
            attachment_count: 0,
            reasons: ['Simple presentation'],
        },
        route_mode: 'single',
        selected_models: [profileA],
        fallback_model: profileB,
        candidates: [],
        reason: 'Test fallback path',
        manual_override: false,
        system_state: makeSystemState(),
    };
}

function topCandidate(candidates: RoutingCandidate[]) {
    return candidates.find((candidate) => candidate.blocked_reason == null)?.profile.model_type ?? null;
}

async function main() {
    const simpleAnalysis = analyzeRoutingInput(makeLowComplexityInput());
    assert.equal(simpleAnalysis.family, 'diagnostics');
    assert.ok(simpleAnalysis.complexity_score < 0.3);

    const complexAnalysis = analyzeRoutingInput(makeHighComplexityInput());
    assert.ok(complexAnalysis.complexity_score > 0.7);
    assert.equal(complexAnalysis.high_risk, true);

    const contradictionAnalysis = analyzeRoutingInput(makeContradictoryInput());
    assert.ok(contradictionAnalysis.contradiction_score > 0);

    const multimodalDiagnosticsAnalysis = analyzeRoutingInput({
        species: 'dog',
        breed: 'labrador',
        symptoms: ['vomiting', 'lethargy'],
        diagnostic_images: [{ file_name: 'abdomen.png' }],
        metadata: {},
    });
    assert.equal(multimodalDiagnosticsAnalysis.family, 'diagnostics');

    const explicitVisionAnalysis = analyzeRoutingInput({
        species: 'dog',
        breed: 'labrador',
        symptoms: [],
        diagnostic_images: [{ file_name: 'retina.png' }],
        metadata: { route_hint: 'vision' },
    });
    assert.equal(explicitVisionAnalysis.family, 'vision');
    assert.equal(
        resolveRegistryProviderModelForTest('Transformer-Clinical-Small', 'diag_smoke_v1', 'fast'),
        process.env.AI_PROVIDER_FAST_MODEL || process.env.AI_PROVIDER_DEFAULT_MODEL || 'gpt-4o-mini',
    );
    assert.equal(
        resolveRegistryProviderModelForTest('gpt-4o-mini', 'diag_live_v2', 'fast'),
        'gpt-4o-mini',
    );

    const profiles = buildDefaultRoutingProfiles({
        tenantId: TENANT_ID,
        family: 'diagnostics',
        requestedModelName: 'gpt-4o-mini',
        requestedModelVersion: 'requested_v1',
    });
    const explicitlyApprovedProfiles = profiles.map((profile) => ({
        ...profile,
        metadata: {
            ...profile.metadata,
            explicitly_approved: true,
        },
    }));

    const unapprovedCandidates = rankRoutingCandidatesForTest({
        tenantId: TENANT_ID,
        family: 'diagnostics',
        profiles,
        analysis: simpleAnalysis,
        systemState: makeSystemState(),
        requestedModelName: 'gpt-4o-mini',
        requestedModelVersion: 'requested_v1',
    });
    assert.equal(
        unapprovedCandidates.every((candidate) => candidate.blocked_reason != null),
        true,
        'requested/default profiles should be blocked until explicitly approved or registry-backed',
    );

    const simpleCandidates = rankRoutingCandidatesForTest({
        tenantId: TENANT_ID,
        family: 'diagnostics',
        profiles: explicitlyApprovedProfiles,
        analysis: simpleAnalysis,
        systemState: makeSystemState(),
        requestedModelName: 'gpt-4o-mini',
        requestedModelVersion: 'requested_v1',
    });
    assert.equal(topCandidate(simpleCandidates), 'fast');

    const contradictoryCandidates = rankRoutingCandidatesForTest({
        tenantId: TENANT_ID,
        family: 'diagnostics',
        profiles: explicitlyApprovedProfiles,
        analysis: contradictionAnalysis,
        systemState: makeSystemState(),
        requestedModelName: 'gpt-4o-mini',
        requestedModelVersion: 'requested_v1',
    });
    assert.equal(topCandidate(contradictoryCandidates), 'adversarial_resistant');

    const criticalCandidates = rankRoutingCandidatesForTest({
        tenantId: TENANT_ID,
        family: 'diagnostics',
        profiles: explicitlyApprovedProfiles,
        analysis: complexAnalysis,
        systemState: makeSystemState({ safe_mode_enabled: true, alert_pressure: 3 }),
        requestedModelName: 'gpt-4o-mini',
        requestedModelVersion: 'requested_v1',
    });
    const criticalPlan = resolveRoutingPlanForTest({
        analysis: complexAnalysis,
        candidates: criticalCandidates,
        systemState: makeSystemState({ safe_mode_enabled: true, alert_pressure: 3 }),
    });
    assert.equal(criticalPlan.route_mode, 'ensemble');
    assert.ok(criticalPlan.selected_models.length >= 2);

    const blockedProfiles = explicitlyApprovedProfiles.map((profile) =>
        profile.model_type === 'fast'
            ? { ...profile, approval_status: 'blocked' as const }
            : profile,
    );
    const blockedCandidates = rankRoutingCandidatesForTest({
        tenantId: TENANT_ID,
        family: 'diagnostics',
        profiles: blockedProfiles,
        analysis: simpleAnalysis,
        systemState: makeSystemState(),
        requestedModelName: 'gpt-4o-mini',
        requestedModelVersion: 'requested_v1',
    });
    assert.notEqual(topCandidate(blockedCandidates), 'fast');
    const blockedPlan = resolveRoutingPlanForTest({
        analysis: simpleAnalysis,
        candidates: unapprovedCandidates,
        systemState: makeSystemState(),
    });
    assert.equal(blockedPlan.selected_models.length, 0);
    assert.equal(blockedPlan.fallback_model, null);

    const fastProfile = explicitlyApprovedProfiles.find((profile) => profile.model_type === 'fast');
    const robustProfile = explicitlyApprovedProfiles.find((profile) => profile.model_type === 'adversarial_resistant');
    assert.ok(fastProfile && robustProfile, 'expected fast and robust profiles');

    const fallbackPlan = makeExecutorFailurePlan(fastProfile!, robustProfile!);
    const fallbackExecution = await executeRoutingPlan({
        plan: fallbackPlan,
        executor: async (profile) => {
            if (profile.model_id === fastProfile!.model_id) {
                throw new Error('fast model unavailable');
            }

            return {
                output_payload: {
                    diagnosis: {
                        primary_condition_class: 'Mechanical',
                        top_differentials: [{ name: 'GDV' }],
                    },
                },
                confidence_score: 0.81,
            };
        },
    });
    assert.equal(fallbackExecution.fallback_used, true);
    assert.equal(fallbackExecution.selected_model.model_id, robustProfile!.model_id);
    assert.equal(fallbackExecution.attempts[0]?.status, 'failed');
    assert.equal(fallbackExecution.attempts[1]?.status, 'success');

    const telemetryMetadata = buildRoutingTelemetryMetadata({
        plan: fallbackPlan,
        execution: fallbackExecution,
    });
    assert.equal(telemetryMetadata.routing_fallback_used, true);
    assert.equal(telemetryMetadata.routing_selected_model_id, robustProfile!.model_id);

    console.log('Multi-model routing engine integration tests passed.');
}

void main();
