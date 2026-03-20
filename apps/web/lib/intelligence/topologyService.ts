import type { SupabaseClient } from '@supabase/supabase-js';
import { CLINICAL_CASES, TELEMETRY_EVENTS } from '@/lib/db/schemaContracts';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import type { ModelRegistryFamilyGroup } from '@/lib/experiments/types';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import type {
    LearningEvaluationEvent,
    LearningSimulationEvent,
} from '@/lib/learningEngine/types';
import type {
    TopologyAlert,
    TopologyEdgeSnapshot,
    TopologyFailureImpact,
    TopologyNodeGovernance,
    TopologyNodeSnapshot,
    TopologyNodeState,
    TopologyRecommendation,
    TopologySimulationScenario,
    TopologySnapshot,
    TopologyWindow,
} from '@/lib/intelligence/types';

type ModelFamily = 'diagnostics' | 'vision' | 'therapeutics';
type NodeId =
    | 'control_plane'
    | 'registry_control'
    | 'telemetry_observer'
    | 'clinic_network'
    | 'dataset_hub'
    | 'diagnostics_model'
    | 'vision_model'
    | 'therapeutics_model'
    | 'decision_fabric'
    | 'outcome_feedback'
    | 'simulation_cluster';

interface ControlGraphTelemetryEvent {
    event_id: string;
    linked_event_id: string | null;
    event_type: 'inference' | 'outcome' | 'system' | 'training';
    timestamp: string;
    model_version: string;
    run_id: string;
    metrics: {
        latency_ms: number | null;
        confidence: number | null;
        prediction: string | null;
        ground_truth: string | null;
        correct: boolean | null;
    };
    system: {
        cpu: number | null;
        gpu: number | null;
        memory: number | null;
    };
    metadata: Record<string, unknown>;
}

interface CaseEvent {
    case_id: string;
    clinic_id: string | null;
    invalid_case: boolean;
    diagnosis_confidence: number | null;
    prediction_correct: boolean | null;
    updated_at: string;
    telemetry_status: string | null;
    calibration_status: string | null;
}

interface NodeOverride {
    target_node_id: NodeId;
    scenario: TopologySimulationScenario | null;
    status: TopologyNodeState['status'] | null;
    latency: number | null;
    throughput: number | null;
    error_rate: number | null;
    drift_score: number | null;
    confidence_avg: number | null;
    timestamp: string;
}

interface FamilyTelemetryContext {
    family: ModelFamily;
    group: ModelRegistryFamilyGroup;
    versions: Set<string>;
    inference_events: ControlGraphTelemetryEvent[];
    outcome_pairs: Array<{
        timestamp: string;
        prediction: string;
        ground_truth: string;
        correct: boolean;
    }>;
    evaluation_drift: number | null;
}

const WINDOW_TO_MS: Record<TopologyWindow, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
};

const DRIFT_WARNING_THRESHOLD = 0.12;
const DRIFT_CRITICAL_THRESHOLD = 0.25;
const ERROR_WARNING_THRESHOLD = 0.05;
const ERROR_CRITICAL_THRESHOLD = 0.12;
const LATENCY_WARNING_THRESHOLD = 800;
const LATENCY_CRITICAL_THRESHOLD = 2_000;
const OFFLINE_THRESHOLD_MS = 30 * 60 * 1000;

const NODE_POSITIONS: Record<NodeId, { x: number; y: number }> = {
    control_plane: { x: 560, y: 40 },
    registry_control: { x: 220, y: 110 },
    telemetry_observer: { x: 900, y: 110 },
    clinic_network: { x: 80, y: 320 },
    dataset_hub: { x: 320, y: 320 },
    diagnostics_model: { x: 560, y: 230 },
    vision_model: { x: 760, y: 320 },
    therapeutics_model: { x: 560, y: 420 },
    decision_fabric: { x: 900, y: 320 },
    outcome_feedback: { x: 1080, y: 420 },
    simulation_cluster: { x: 760, y: 520 },
};

const FAMILY_TO_NODE: Record<ModelFamily, NodeId> = {
    diagnostics: 'diagnostics_model',
    vision: 'vision_model',
    therapeutics: 'therapeutics_model',
};

const NODE_LABELS: Record<NodeId, string> = {
    control_plane: 'VetIOS Control Plane',
    registry_control: 'Registry Governance',
    telemetry_observer: 'Telemetry Observer',
    clinic_network: 'Clinic Network',
    dataset_hub: 'Clinical Data Hub',
    diagnostics_model: 'Diagnostics Inference',
    vision_model: 'Vision Inference',
    therapeutics_model: 'Therapeutics Inference',
    decision_fabric: 'Decision Fabric',
    outcome_feedback: 'Outcome Feedback',
    simulation_cluster: 'Adversarial Simulation',
};

const EDGE_LAYOUT: Array<{ id: string; source: NodeId; target: NodeId; label: string }> = [
    { id: 'e-clinic-dataset', source: 'clinic_network', target: 'dataset_hub', label: 'case ingestion' },
    { id: 'e-dataset-diagnostics', source: 'dataset_hub', target: 'diagnostics_model', label: 'diagnostic requests' },
    { id: 'e-dataset-vision', source: 'dataset_hub', target: 'vision_model', label: 'imaging requests' },
    { id: 'e-dataset-therapeutics', source: 'dataset_hub', target: 'therapeutics_model', label: 'therapy requests' },
    { id: 'e-registry-diagnostics', source: 'registry_control', target: 'diagnostics_model', label: 'routing pointer' },
    { id: 'e-registry-vision', source: 'registry_control', target: 'vision_model', label: 'routing pointer' },
    { id: 'e-registry-therapeutics', source: 'registry_control', target: 'therapeutics_model', label: 'routing pointer' },
    { id: 'e-diagnostics-decision', source: 'diagnostics_model', target: 'decision_fabric', label: 'clinical decisions' },
    { id: 'e-vision-decision', source: 'vision_model', target: 'decision_fabric', label: 'image findings' },
    { id: 'e-therapeutics-decision', source: 'therapeutics_model', target: 'decision_fabric', label: 'treatment policy' },
    { id: 'e-decision-outcome', source: 'decision_fabric', target: 'outcome_feedback', label: 'decision propagation' },
    { id: 'e-outcome-dataset', source: 'outcome_feedback', target: 'dataset_hub', label: 'label feedback' },
    { id: 'e-sim-diagnostics', source: 'simulation_cluster', target: 'diagnostics_model', label: 'stress tests' },
    { id: 'e-sim-vision', source: 'simulation_cluster', target: 'vision_model', label: 'stress tests' },
    { id: 'e-sim-therapeutics', source: 'simulation_cluster', target: 'therapeutics_model', label: 'stress tests' },
    { id: 'e-diagnostics-telemetry', source: 'diagnostics_model', target: 'telemetry_observer', label: 'runtime telemetry' },
    { id: 'e-vision-telemetry', source: 'vision_model', target: 'telemetry_observer', label: 'runtime telemetry' },
    { id: 'e-therapeutics-telemetry', source: 'therapeutics_model', target: 'telemetry_observer', label: 'runtime telemetry' },
    { id: 'e-telemetry-control', source: 'telemetry_observer', target: 'control_plane', label: 'health signal' },
    { id: 'e-registry-control', source: 'registry_control', target: 'control_plane', label: 'deployment governance' },
];

export async function getTopologySnapshot(
    client: SupabaseClient,
    tenantId: string,
    input: {
        window: TopologyWindow;
        until?: string | null;
    },
): Promise<TopologySnapshot> {
    const until = resolveUntil(input.until);
    const windowMs = WINDOW_TO_MS[input.window];
    const from = new Date(until.getTime() - windowMs);
    const experimentStore = createSupabaseExperimentTrackingStore(client);
    const learningStore = createSupabaseLearningEngineStore(client);

    const [telemetryRows, caseRows, controlPlane, simulations, evaluations] = await Promise.all([
        loadTelemetryEvents(client, tenantId, from, until),
        loadClinicalCases(client, tenantId, from, until),
        getModelRegistryControlPlaneSnapshot(experimentStore, tenantId),
        learningStore.listSimulationEvents({
            tenantId,
            from: from.toISOString(),
            to: until.toISOString(),
            includeAdversarial: true,
            includeSynthetic: true,
            includeQuarantine: true,
            limit: 200,
        }),
        learningStore.listEvaluationEvents({
            tenantId,
            from: from.toISOString(),
            to: until.toISOString(),
            includeAdversarial: true,
            includeSynthetic: true,
            includeQuarantine: true,
            limit: 400,
        }),
    ]);

    const telemetryEvents = telemetryRows.map(mapTelemetryEvent);
    const nodeOverrides = buildNodeOverrides(telemetryEvents);
    const familyContexts = buildFamilyContexts(controlPlane.families, telemetryEvents, evaluations);
    const nodes = buildNodes({
        until,
        windowMs,
        controlPlane,
        familyContexts,
        caseRows,
        telemetryEvents,
        simulations,
        nodeOverrides,
    });
    const alerts = buildAlerts(nodes, telemetryEvents, until);
    const failureImpacts = buildFailureImpacts(nodes, alerts);
    const edges = buildEdges({
        nodes,
        familyContexts,
        telemetryEvents,
        controlPlane,
        simulations,
        failureImpacts,
        windowMs,
    });
    const enrichedNodes = finalizeNodes(nodes, edges, alerts, failureImpacts, controlPlane);
    const recommendations = buildRecommendations(enrichedNodes, alerts, controlPlane);
    const summary = buildSummary(enrichedNodes, alerts, failureImpacts, recommendations);

    return {
        tenant_id: tenantId,
        refreshed_at: new Date().toISOString(),
        window: input.window,
        mode: input.until ? 'historical' : 'live',
        playback: {
            live_supported: true,
            current_until: until.toISOString(),
            event_timeline: telemetryEvents
                .slice(-80)
                .map((event) => ({
                    event_id: event.event_id,
                    timestamp: event.timestamp,
                    event_type: event.event_type,
                    label: buildTimelineLabel(event),
                })),
        },
        network_health_score: computeNetworkHealthScore(enrichedNodes),
        summary,
        nodes: enrichedNodes,
        edges,
        alerts,
        failure_impacts: failureImpacts,
        recommendations,
    };
}

function buildNodes(input: {
    until: Date;
    windowMs: number;
    controlPlane: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>;
    familyContexts: FamilyTelemetryContext[];
    caseRows: CaseEvent[];
    telemetryEvents: ControlGraphTelemetryEvent[];
    simulations: LearningSimulationEvent[];
    nodeOverrides: Map<NodeId, NodeOverride>;
}): TopologyNodeSnapshot[] {
    const windowMinutes = Math.max(1, input.windowMs / 60_000);
    const totalInferenceEvents = input.telemetryEvents.filter((event) => event.event_type === 'inference');
    const totalOutcomeEvents = input.telemetryEvents.filter((event) => event.event_type === 'outcome');
    const globalLatencyValues = totalInferenceEvents
        .map((event) => event.metrics.latency_ms)
        .filter((value): value is number => value != null && value <= 5_000);
    const globalConfidenceValues = totalInferenceEvents
        .map((event) => event.metrics.confidence)
        .filter((value): value is number => value != null);
    const globalOutcomePairs = collectOutcomePairs(totalInferenceEvents, totalOutcomeEvents);
    const globalDrift = globalOutcomePairs.length >= 2 ? computeDistributionDrift(globalOutcomePairs) : null;
    const invalidCaseCount = input.caseRows.filter((row) => row.invalid_case).length;
    const activeClinicCount = new Set(input.caseRows.map((row) => row.clinic_id).filter((value): value is string => !!value)).size;
    const caseConfidence = input.caseRows
        .map((row) => row.diagnosis_confidence)
        .filter((value): value is number => value != null);
    const simulationTelemetry = input.telemetryEvents.filter((event) => {
        const source = readString(event.metadata.source_module) ?? readString(event.metadata.source);
        return source === 'adversarial_simulation' || source === 'telemetry_stream_generator';
    });

    const registryNode = createNode({
        id: 'registry_control',
        kind: 'registry',
        state: applyOverride(buildRegistryState(input.controlPlane, input.until), input.nodeOverrides.get('registry_control'), input.until),
        governance: null,
        metadata: {
            active_families: input.controlPlane.families.map((family) => ({
                model_family: family.model_family,
                active_model_version: family.active_model?.model_version ?? null,
                pending_entries: family.entries.filter((entry) => entry.registry.lifecycle_status === 'staging').length,
            })),
        },
    });

    const telemetryNode = createNode({
        id: 'telemetry_observer',
        kind: 'telemetry',
        state: applyOverride({
            status: resolveNodeStatus({
                hasData: input.telemetryEvents.length > 0,
                lastUpdated: findLatestTimestamp(input.telemetryEvents.map((event) => event.timestamp)),
                latency: percentile(globalLatencyValues, 95),
                errorRate: calculateInferenceErrorRate(totalInferenceEvents, globalOutcomePairs),
                drift: globalDrift,
                confidence: mean(globalConfidenceValues),
                governanceFailure: false,
                governancePending: false,
                now: input.until,
            }),
            latency: percentile(globalLatencyValues, 95),
            throughput: roundNumber(totalInferenceEvents.length / windowMinutes, 2),
            error_rate: calculateInferenceErrorRate(totalInferenceEvents, globalOutcomePairs),
            drift_score: globalDrift,
            confidence_avg: mean(globalConfidenceValues),
            last_updated: findLatestTimestamp(input.telemetryEvents.map((event) => event.timestamp)),
        }, input.nodeOverrides.get('telemetry_observer'), input.until),
        governance: null,
        metadata: {
            last_event_timestamp: findLatestTimestamp(input.telemetryEvents.map((event) => event.timestamp)),
            stale: isStale(findLatestTimestamp(input.telemetryEvents.map((event) => event.timestamp)), input.until),
            total_events: input.telemetryEvents.length,
        },
    });

    const clinicNode = createNode({
        id: 'clinic_network',
        kind: 'clinic',
        state: applyOverride({
            status: resolveNodeStatus({
                hasData: input.caseRows.length > 0,
                lastUpdated: findLatestTimestamp(input.caseRows.map((row) => row.updated_at)),
                latency: percentile(globalLatencyValues, 95),
                errorRate: ratio(invalidCaseCount, input.caseRows.length),
                drift: globalDrift,
                confidence: mean(caseConfidence),
                governanceFailure: false,
                governancePending: false,
                now: input.until,
            }),
            latency: percentile(globalLatencyValues, 95),
            throughput: roundNumber(totalInferenceEvents.length / windowMinutes, 2),
            error_rate: ratio(invalidCaseCount, input.caseRows.length),
            drift_score: globalDrift,
            confidence_avg: mean(caseConfidence),
            last_updated: findLatestTimestamp(input.caseRows.map((row) => row.updated_at)),
        }, input.nodeOverrides.get('clinic_network'), input.until),
        governance: null,
        metadata: {
            active_clinics: activeClinicCount,
            invalid_case_count: invalidCaseCount,
            total_cases: input.caseRows.length,
        },
    });

    const datasetNode = createNode({
        id: 'dataset_hub',
        kind: 'data',
        state: applyOverride({
            status: resolveNodeStatus({
                hasData: input.caseRows.length > 0,
                lastUpdated: findLatestTimestamp(input.caseRows.map((row) => row.updated_at)),
                latency: datasetLatencyEstimate(globalLatencyValues, invalidCaseCount, input.caseRows.length),
                errorRate: ratio(invalidCaseCount, input.caseRows.length),
                drift: globalDrift,
                confidence: mean(caseConfidence),
                governanceFailure: false,
                governancePending: false,
                now: input.until,
            }),
            latency: datasetLatencyEstimate(globalLatencyValues, invalidCaseCount, input.caseRows.length),
            throughput: roundNumber(input.caseRows.length / windowMinutes, 2),
            error_rate: ratio(invalidCaseCount, input.caseRows.length),
            drift_score: globalDrift,
            confidence_avg: mean(caseConfidence),
            last_updated: findLatestTimestamp(input.caseRows.map((row) => row.updated_at)),
        }, input.nodeOverrides.get('dataset_hub'), input.until),
        governance: null,
        metadata: {
            label_feedback_ready_pct: ratio(totalOutcomeEvents.length, Math.max(totalInferenceEvents.length, 1)),
            invalid_case_count: invalidCaseCount,
        },
    });

    const familyNodes = input.familyContexts.map((familyContext) => {
        const nodeId = FAMILY_TO_NODE[familyContext.family];
        const governance = buildGovernanceState(familyContext.group);
        const latencyValues = familyContext.inference_events
            .map((event) => event.metrics.latency_ms)
            .filter((value): value is number => value != null && value <= 5_000);
        const confidenceValues = familyContext.inference_events
            .map((event) => event.metrics.confidence)
            .filter((value): value is number => value != null);
        const errorRate = calculateInferenceErrorRate(familyContext.inference_events, familyContext.outcome_pairs);
        const drift = familyContext.evaluation_drift ?? (familyContext.outcome_pairs.length >= 2 ? computeDistributionDrift(familyContext.outcome_pairs) : null);
        const lastUpdated = findLatestTimestamp(familyContext.inference_events.map((event) => event.timestamp));

        return createNode({
            id: nodeId,
            kind: 'model',
            state: applyOverride({
                status: resolveNodeStatus({
                    hasData: familyContext.group.active_model != null || familyContext.inference_events.length > 0,
                    lastUpdated,
                    latency: percentile(latencyValues, 95),
                    errorRate,
                    drift,
                    confidence: mean(confidenceValues),
                    governanceFailure: governance.border_state === 'failed',
                    governancePending: governance.border_state === 'pending',
                    now: input.until,
                }),
                latency: percentile(latencyValues, 95),
                throughput: roundNumber(familyContext.inference_events.length / windowMinutes, 2),
                error_rate: errorRate,
                drift_score: drift,
                confidence_avg: mean(confidenceValues),
                last_updated: lastUpdated,
            }, input.nodeOverrides.get(nodeId), input.until),
            governance,
            metadata: {
                model_family: familyContext.family,
                active_model_version: familyContext.group.active_model?.model_version ?? null,
                registry_id: familyContext.group.active_model?.registry_id ?? null,
                last_stable_model_version: familyContext.group.last_stable_model?.model_version ?? null,
                pending_entries: familyContext.group.entries
                    .filter((entry) => entry.registry.lifecycle_status === 'staging')
                    .map((entry) => entry.registry.model_version),
            },
        });
    });

    const decisionNode = createNode({
        id: 'decision_fabric',
        kind: 'decision',
        state: applyOverride({
            status: resolveAggregateStatus(familyNodes.map((node) => node.state.status)),
            latency: mean(familyNodes.map((node) => node.state.latency).filter((value): value is number => value != null)),
            throughput: roundNumber(totalInferenceEvents.length / windowMinutes, 2),
            error_rate: maxValue(familyNodes.map((node) => node.state.error_rate)),
            drift_score: maxValue(familyNodes.map((node) => node.state.drift_score)),
            confidence_avg: mean(familyNodes.map((node) => node.state.confidence_avg).filter((value): value is number => value != null)),
            last_updated: findLatestTimestamp(familyNodes.map((node) => node.state.last_updated).filter((value): value is string => value != null)),
        }, input.nodeOverrides.get('decision_fabric'), input.until),
        governance: null,
        metadata: {
            active_models: familyNodes.map((node) => ({
                node_id: node.id,
                model_version: node.governance?.model_version ?? null,
                status: node.state.status,
            })),
        },
    });

    const outcomeNode = createNode({
        id: 'outcome_feedback',
        kind: 'outcome',
        state: applyOverride({
            status: resolveNodeStatus({
                hasData: totalOutcomeEvents.length > 0,
                lastUpdated: findLatestTimestamp(totalOutcomeEvents.map((event) => event.timestamp)),
                latency: outcomeLoopLatency(totalInferenceEvents, totalOutcomeEvents),
                errorRate: globalOutcomePairs.length > 0 ? 1 - ratio(globalOutcomePairs.filter((pair) => pair.correct).length, globalOutcomePairs.length)! : null,
                drift: globalDrift,
                confidence: globalOutcomePairs.length > 0 ? ratio(globalOutcomePairs.filter((pair) => pair.correct).length, globalOutcomePairs.length) : null,
                governanceFailure: false,
                governancePending: false,
                now: input.until,
            }),
            latency: outcomeLoopLatency(totalInferenceEvents, totalOutcomeEvents),
            throughput: roundNumber(totalOutcomeEvents.length / windowMinutes, 2),
            error_rate: globalOutcomePairs.length > 0 ? 1 - ratio(globalOutcomePairs.filter((pair) => pair.correct).length, globalOutcomePairs.length)! : null,
            drift_score: globalDrift,
            confidence_avg: globalOutcomePairs.length > 0 ? ratio(globalOutcomePairs.filter((pair) => pair.correct).length, globalOutcomePairs.length) : null,
            last_updated: findLatestTimestamp(totalOutcomeEvents.map((event) => event.timestamp)),
        }, input.nodeOverrides.get('outcome_feedback'), input.until),
        governance: null,
        metadata: {
            linked_outcomes: globalOutcomePairs.length,
            raw_outcomes: totalOutcomeEvents.length,
        },
    });

    const simulationNode = createNode({
        id: 'simulation_cluster',
        kind: 'simulation',
        state: applyOverride({
            status: resolveNodeStatus({
                hasData: input.simulations.length > 0 || simulationTelemetry.length > 0,
                lastUpdated: findLatestTimestamp([
                    ...input.simulations.map((event) => event.created_at),
                    ...simulationTelemetry.map((event) => event.timestamp),
                ]),
                latency: percentile(
                    simulationTelemetry
                        .map((event) => event.metrics.latency_ms)
                        .filter((value): value is number => value != null && value <= 5_000),
                    95,
                ),
                errorRate: ratio(
                    input.simulations.filter((simulation) => simulation.failure_mode != null).length,
                    input.simulations.length,
                ),
                drift: maxValue(familyNodes.map((node) => node.state.drift_score)),
                confidence: mean(
                    simulationTelemetry
                        .map((event) => event.metrics.confidence)
                        .filter((value): value is number => value != null),
                ),
                governanceFailure: false,
                governancePending: false,
                now: input.until,
            }),
            latency: percentile(
                simulationTelemetry
                    .map((event) => event.metrics.latency_ms)
                    .filter((value): value is number => value != null && value <= 5_000),
                95,
            ),
            throughput: roundNumber(input.simulations.length / windowMinutes, 2),
            error_rate: ratio(
                input.simulations.filter((simulation) => simulation.failure_mode != null).length,
                input.simulations.length,
            ),
            drift_score: maxValue(familyNodes.map((node) => node.state.drift_score)),
            confidence_avg: mean(
                simulationTelemetry
                    .map((event) => event.metrics.confidence)
                    .filter((value): value is number => value != null),
            ),
            last_updated: findLatestTimestamp([
                ...input.simulations.map((event) => event.created_at),
                ...simulationTelemetry.map((event) => event.timestamp),
            ]),
        }, input.nodeOverrides.get('simulation_cluster'), input.until),
        governance: null,
        metadata: {
            recent_scenarios: input.simulations.slice(0, 6).map((simulation) => simulation.simulation_type),
            recent_failure_modes: input.simulations
                .map((simulation) => simulation.failure_mode)
                .filter((value): value is string => value != null),
        },
    });

    const controlNode = createNode({
        id: 'control_plane',
        kind: 'control',
        state: applyOverride({
            status: resolveAggregateStatus([
                registryNode.state.status,
                telemetryNode.state.status,
                decisionNode.state.status,
            ]),
            latency: mean([
                registryNode.state.latency,
                telemetryNode.state.latency,
                decisionNode.state.latency,
            ].filter((value): value is number => value != null)),
            throughput: roundNumber((totalInferenceEvents.length + input.controlPlane.audit_history.length) / windowMinutes, 2),
            error_rate: mean([
                registryNode.state.error_rate,
                telemetryNode.state.error_rate,
                decisionNode.state.error_rate,
            ].filter((value): value is number => value != null)),
            drift_score: maxValue(familyNodes.map((node) => node.state.drift_score)),
            confidence_avg: mean([
                decisionNode.state.confidence_avg,
                telemetryNode.state.confidence_avg,
            ].filter((value): value is number => value != null)),
            last_updated: findLatestTimestamp([
                registryNode.state.last_updated,
                telemetryNode.state.last_updated,
                decisionNode.state.last_updated,
            ].filter((value): value is string => value != null)),
        }, input.nodeOverrides.get('control_plane'), input.until),
        governance: null,
        metadata: {
            routing_pointers: input.controlPlane.routing_pointers.length,
            recent_registry_events: input.controlPlane.audit_history.slice(0, 5).map((event) => ({
                event_type: event.event_type,
                timestamp: event.timestamp,
                registry_id: event.registry_id,
            })),
        },
    });

    return [
        controlNode,
        registryNode,
        telemetryNode,
        clinicNode,
        datasetNode,
        ...familyNodes,
        decisionNode,
        outcomeNode,
        simulationNode,
    ];
}

function buildEdges(input: {
    nodes: TopologyNodeSnapshot[];
    familyContexts: FamilyTelemetryContext[];
    telemetryEvents: ControlGraphTelemetryEvent[];
    controlPlane: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>;
    simulations: LearningSimulationEvent[];
    failureImpacts: TopologyFailureImpact[];
    windowMs: number;
}): TopologyEdgeSnapshot[] {
    const nodeMap = new Map(input.nodes.map((node) => [node.id, node]));
    const windowMinutes = Math.max(1, input.windowMs / 60_000);
    const impactedEdges = new Set(input.failureImpacts.flatMap((impact) => impact.impacted_edge_ids));
    const totalInference = input.telemetryEvents.filter((event) => event.event_type === 'inference');
    const totalOutcome = input.telemetryEvents.filter((event) => event.event_type === 'outcome');
    const familyByNode = new Map(input.familyContexts.map((context) => [FAMILY_TO_NODE[context.family], context]));

    return EDGE_LAYOUT.map((layout) => {
        const sourceNode = nodeMap.get(layout.source) ?? null;
        const targetNode = nodeMap.get(layout.target) ?? null;
        let requestsPerMinute: number | null = null;
        let latencyValues: number[] = [];
        let failureRate: number | null = null;

        if (layout.id === 'e-clinic-dataset') {
            requestsPerMinute = sourceNode?.state.throughput ?? targetNode?.state.throughput ?? null;
            latencyValues = totalInference
                .map((event) => event.metrics.latency_ms)
                .filter((value): value is number => value != null && value <= 5_000);
            failureRate = maxValue([sourceNode?.state.error_rate ?? null, targetNode?.state.error_rate ?? null]);
        } else if (layout.id.startsWith('e-dataset-') || layout.id.startsWith('e-registry-') || layout.id.startsWith('e-sim-') || layout.id.startsWith('e-diagnostics-') || layout.id.startsWith('e-vision-') || layout.id.startsWith('e-therapeutics-')) {
            const familyContext = familyByNode.get(layout.target) ?? familyByNode.get(layout.source) ?? null;
            requestsPerMinute = familyContext ? roundNumber(familyContext.inference_events.length / windowMinutes, 2) : null;
            latencyValues = familyContext
                ? familyContext.inference_events
                    .map((event) => event.metrics.latency_ms)
                    .filter((value): value is number => value != null && value <= 5_000)
                : [];
            if (layout.id.startsWith('e-sim-')) {
                requestsPerMinute = roundNumber(input.simulations.length / windowMinutes, 2);
                failureRate = ratio(
                    input.simulations.filter((simulation) => simulation.failure_mode != null).length,
                    input.simulations.length,
                );
            } else {
                failureRate = maxValue([sourceNode?.state.error_rate ?? null, targetNode?.state.error_rate ?? null]);
            }
        } else if (layout.id === 'e-decision-outcome' || layout.id === 'e-outcome-dataset') {
            requestsPerMinute = roundNumber(totalOutcome.length / windowMinutes, 2);
            latencyValues = totalOutcome
                .map((event) => linkedOutcomeLatency(event, totalInference))
                .filter((value): value is number => value != null);
            failureRate = maxValue([sourceNode?.state.error_rate ?? null, targetNode?.state.error_rate ?? null]);
        } else if (layout.id === 'e-telemetry-control' || layout.id === 'e-registry-control') {
            requestsPerMinute = sourceNode?.state.throughput ?? targetNode?.state.throughput ?? null;
            latencyValues = [
                sourceNode?.state.latency ?? null,
                targetNode?.state.latency ?? null,
            ].filter((value): value is number => value != null);
            failureRate = maxValue([sourceNode?.state.error_rate ?? null, targetNode?.state.error_rate ?? null]);
        }

        const latency = latencyValues.length > 0 ? percentile(latencyValues, 95) : mean([
            sourceNode?.state.latency ?? null,
            targetNode?.state.latency ?? null,
        ].filter((value): value is number => value != null));
        const status = impactedEdges.has(layout.id)
            ? 'failing'
            : resolveEdgeStatus({
                latency,
                failureRate,
                requestsPerMinute,
            });

        return {
            id: layout.id,
            source: layout.source,
            target: layout.target,
            label: layout.label,
            requests_per_min: requestsPerMinute,
            latency,
            failure_rate: failureRate,
            latency_distribution: {
                p50: latencyValues.length > 0 ? percentile(latencyValues, 50) : latency,
                p95: latency,
                max: latencyValues.length > 0 ? maxNumber(latencyValues) : latency,
            },
            status,
            animated: true,
            propagated_risk: impactedEdges.has(layout.id),
            metadata: {
                stroke_width_hint: edgeStrokeWidth(requestsPerMinute),
            },
        };
    });
}

function finalizeNodes(
    nodes: TopologyNodeSnapshot[],
    edges: TopologyEdgeSnapshot[],
    alerts: TopologyAlert[],
    impacts: TopologyFailureImpact[],
    controlPlane: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>,
): TopologyNodeSnapshot[] {
    const connectedByNode = new Map<NodeId, Set<string>>();
    for (const edge of edges) {
        if (!connectedByNode.has(edge.source as NodeId)) connectedByNode.set(edge.source as NodeId, new Set());
        if (!connectedByNode.has(edge.target as NodeId)) connectedByNode.set(edge.target as NodeId, new Set());
        connectedByNode.get(edge.source as NodeId)?.add(edge.target);
        connectedByNode.get(edge.target as NodeId)?.add(edge.source);
    }

    const alertsByNode = new Map<NodeId, TopologyAlert[]>();
    for (const alert of alerts) {
        const nodeId = alert.node_id as NodeId;
        if (!alertsByNode.has(nodeId)) alertsByNode.set(nodeId, []);
        alertsByNode.get(nodeId)?.push(alert);
    }

    const impactByNode = new Map<NodeId, Set<string>>();
    for (const impact of impacts) {
        for (const nodeId of impact.impacted_node_ids) {
            if (!impactByNode.has(nodeId as NodeId)) impactByNode.set(nodeId as NodeId, new Set());
            impactByNode.get(nodeId as NodeId)?.add(impact.source_node_id);
        }
    }

    return nodes.map((node) => {
        const familyGroup = node.kind === 'model'
            ? controlPlane.families.find((family) => FAMILY_TO_NODE[family.model_family] === node.id)
            : null;
        const recommendations = node.kind === 'model' && familyGroup?.last_stable_model?.model_version
            ? [`Rollback target available: ${familyGroup.last_stable_model.model_version}`]
            : [];

        return {
            ...node,
            alert_count: alertsByNode.get(node.id as NodeId)?.length ?? 0,
            propagated_risk: impactByNode.has(node.id as NodeId),
            impact_sources: Array.from(impactByNode.get(node.id as NodeId) ?? []),
            connected_node_ids: Array.from(connectedByNode.get(node.id as NodeId) ?? []),
            recent_errors: (alertsByNode.get(node.id as NodeId) ?? []).map((alert) => alert.message).slice(0, 5),
            recommendations: [
                ...recommendations,
                ...(node.governance?.promotion_blockers.slice(0, 2) ?? []),
            ],
            metadata: {
                ...node.metadata,
                drift_overlay: (node.state.drift_score ?? 0) >= DRIFT_WARNING_THRESHOLD,
            },
        };
    });
}

function buildAlerts(
    nodes: TopologyNodeSnapshot[],
    telemetryEvents: ControlGraphTelemetryEvent[],
    now: Date,
): TopologyAlert[] {
    const alerts: TopologyAlert[] = [];
    const latestEventTimestamp = findLatestTimestamp(telemetryEvents.map((event) => event.timestamp));

    for (const node of nodes) {
        if (node.state.status === 'offline') {
            alerts.push({
                id: `alert_offline_${node.id}`,
                node_id: node.id,
                severity: 'critical',
                category: 'heartbeat',
                title: `${node.label} offline`,
                message: `${node.label} has not reported inside the operational heartbeat window.`,
                timestamp: node.state.last_updated ?? latestEventTimestamp ?? now.toISOString(),
            });
        }

        if ((node.state.latency ?? 0) >= LATENCY_CRITICAL_THRESHOLD) {
            alerts.push({
                id: `alert_latency_critical_${node.id}`,
                node_id: node.id,
                severity: 'critical',
                category: 'latency',
                title: `${node.label} latency spike`,
                message: `${node.label} latency is above ${LATENCY_CRITICAL_THRESHOLD}ms and is affecting request flow.`,
                timestamp: node.state.last_updated ?? now.toISOString(),
            });
        } else if ((node.state.latency ?? 0) >= LATENCY_WARNING_THRESHOLD) {
            alerts.push({
                id: `alert_latency_warning_${node.id}`,
                node_id: node.id,
                severity: 'warning',
                category: 'latency',
                title: `${node.label} latency stressed`,
                message: `${node.label} latency is above the degraded threshold.`,
                timestamp: node.state.last_updated ?? now.toISOString(),
            });
        }

        if ((node.state.drift_score ?? 0) >= DRIFT_CRITICAL_THRESHOLD) {
            alerts.push({
                id: `alert_drift_critical_${node.id}`,
                node_id: node.id,
                severity: 'critical',
                category: 'drift',
                title: `${node.label} drift spike`,
                message: `${node.label} drift is above the critical threshold.`,
                timestamp: node.state.last_updated ?? now.toISOString(),
            });
        } else if ((node.state.drift_score ?? 0) >= DRIFT_WARNING_THRESHOLD) {
            alerts.push({
                id: `alert_drift_warning_${node.id}`,
                node_id: node.id,
                severity: 'warning',
                category: 'drift',
                title: `${node.label} drift elevated`,
                message: `${node.label} drift needs review before it degrades confidence further.`,
                timestamp: node.state.last_updated ?? now.toISOString(),
            });
        }

        if ((node.state.error_rate ?? 0) >= ERROR_CRITICAL_THRESHOLD) {
            alerts.push({
                id: `alert_error_critical_${node.id}`,
                node_id: node.id,
                severity: 'critical',
                category: 'error_rate',
                title: `${node.label} error rate spike`,
                message: `${node.label} error rate is above the critical threshold.`,
                timestamp: node.state.last_updated ?? now.toISOString(),
            });
        } else if ((node.state.error_rate ?? 0) >= ERROR_WARNING_THRESHOLD) {
            alerts.push({
                id: `alert_error_warning_${node.id}`,
                node_id: node.id,
                severity: 'warning',
                category: 'error_rate',
                title: `${node.label} error rate stressed`,
                message: `${node.label} error rate is above the degraded threshold.`,
                timestamp: node.state.last_updated ?? now.toISOString(),
            });
        }

        if (node.governance?.border_state === 'pending') {
            alerts.push({
                id: `alert_gov_pending_${node.id}`,
                node_id: node.id,
                severity: 'warning',
                category: 'governance',
                title: `${node.label} governance pending`,
                message: `${node.label} has a pending registry promotion or hold state.`,
                timestamp: node.state.last_updated ?? now.toISOString(),
            });
        }

        if (node.governance?.border_state === 'failed') {
            alerts.push({
                id: `alert_gov_failed_${node.id}`,
                node_id: node.id,
                severity: 'critical',
                category: 'governance',
                title: `${node.label} governance rejected`,
                message: `${node.label} is blocked by registry governance and needs operator review.`,
                timestamp: node.state.last_updated ?? now.toISOString(),
            });
        }
    }

    return alerts
        .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.timestamp.localeCompare(left.timestamp))
        .slice(0, 18);
}

function buildFailureImpacts(
    nodes: TopologyNodeSnapshot[],
    alerts: TopologyAlert[],
): TopologyFailureImpact[] {
    const outgoing = new Map<NodeId, Array<{ edgeId: string; target: NodeId }>>();
    const incoming = new Map<NodeId, Array<{ edgeId: string; source: NodeId }>>();

    for (const edge of EDGE_LAYOUT) {
        if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
        if (!incoming.has(edge.target)) incoming.set(edge.target, []);
        outgoing.get(edge.source)?.push({ edgeId: edge.id, target: edge.target });
        incoming.get(edge.target)?.push({ edgeId: edge.id, source: edge.source });
    }

    const impacts: TopologyFailureImpact[] = [];
    const criticalSources = nodes.filter((node) => node.state.status === 'critical' || (node.state.drift_score ?? 0) >= DRIFT_CRITICAL_THRESHOLD);

    for (const source of criticalSources) {
        const impactedNodes = new Set<string>();
        const impactedEdges = new Set<string>();
        const queue: Array<{ nodeId: NodeId; depth: number }> = [{ nodeId: source.id as NodeId, depth: 0 }];
        const visited = new Set<string>([source.id]);

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) continue;

            if (current.depth < 2) {
                for (const edge of outgoing.get(current.nodeId) ?? []) {
                    impactedEdges.add(edge.edgeId);
                    impactedNodes.add(edge.target);
                    if (!visited.has(edge.target)) {
                        visited.add(edge.target);
                        queue.push({ nodeId: edge.target, depth: current.depth + 1 });
                    }
                }
            }

            if ((source.state.drift_score ?? 0) >= DRIFT_WARNING_THRESHOLD && current.depth < 1) {
                for (const edge of incoming.get(current.nodeId) ?? []) {
                    impactedEdges.add(edge.edgeId);
                    impactedNodes.add(edge.source);
                }
            }
        }

        const topAlert = alerts.find((alert) => alert.node_id === source.id);
        impacts.push({
            source_node_id: source.id,
            impacted_node_ids: Array.from(impactedNodes),
            impacted_edge_ids: Array.from(impactedEdges),
            reason: topAlert?.message ?? `${source.label} is cascading operational risk.`,
        });
    }

    return impacts;
}

function buildRecommendations(
    nodes: TopologyNodeSnapshot[],
    alerts: TopologyAlert[],
    controlPlane: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>,
): TopologyRecommendation[] {
    const recommendations: TopologyRecommendation[] = [];

    for (const node of nodes) {
        if (node.id === 'dataset_hub' && (node.state.error_rate ?? 0) >= ERROR_WARNING_THRESHOLD) {
            recommendations.push({
                id: `rec_dataset_${node.id}`,
                severity: node.state.error_rate != null && node.state.error_rate >= ERROR_CRITICAL_THRESHOLD ? 'critical' : 'warning',
                message: 'Quarantine malformed clinic inputs and inspect dataset ingestion before additional promotion decisions.',
            });
        }

        if (node.id === 'telemetry_observer' && node.state.status !== 'healthy') {
            recommendations.push({
                id: `rec_telemetry_${node.id}`,
                severity: 'critical',
                message: 'Restore the telemetry observer first so downstream health and failure propagation remain trustworthy.',
            });
        }

        if (node.kind === 'model' && node.state.status === 'critical') {
            const familyGroup = controlPlane.families.find((family) => FAMILY_TO_NODE[family.model_family] === node.id);
            const rollbackVersion = familyGroup?.last_stable_model?.model_version ?? null;
            recommendations.push({
                id: `rec_model_${node.id}`,
                severity: 'critical',
                message: rollbackVersion
                    ? `Consider rolling ${node.label} back to ${rollbackVersion} while the critical condition is investigated.`
                    : `Stabilize ${node.label} before more clinical traffic is routed through it.`,
            });
        }

        if (node.governance?.border_state === 'pending') {
            recommendations.push({
                id: `rec_pending_${node.id}`,
                severity: 'warning',
                message: `Review registry blockers for ${node.label} before allowing more decision propagation.`,
            });
        }
    }

    if (alerts.length === 0) {
        recommendations.push({
            id: 'rec_nominal',
            severity: 'info',
            message: 'Network is nominal. Continue live monitoring and keep replay available for incident review.',
        });
    }

    return dedupeRecommendations(recommendations).slice(0, 6);
}

function buildSummary(
    nodes: TopologyNodeSnapshot[],
    alerts: TopologyAlert[],
    impacts: TopologyFailureImpact[],
    recommendations: TopologyRecommendation[],
): TopologySnapshot['summary'] {
    const topAlert = alerts[0] ?? null;
    const topNode = topAlert ? nodes.find((node) => node.id === topAlert.node_id) ?? null : null;
    const topImpact = topNode ? impacts.find((impact) => impact.source_node_id === topNode.id) ?? null : null;

    if (!topAlert || !topNode) {
        return {
            where_failing: 'No critical failures detected',
            root_cause: 'Latency, error rate, drift, and confidence remain within the healthy operating envelope.',
            impact: 'Decision propagation is stable across clinics, registry, and telemetry.',
            next_action: recommendations[0]?.message ?? 'Maintain live monitoring.',
        };
    }

    return {
        where_failing: topNode.label,
        root_cause: topAlert.message,
        impact: topImpact
            ? `${topImpact.impacted_node_ids.length} connected nodes and ${topImpact.impacted_edge_ids.length} edges are carrying propagated risk.`
            : 'Failure impact is currently localized to the originating node.',
        next_action: recommendations[0]?.message ?? 'Inspect the highlighted node and follow the attached alerts.',
    };
}

function buildFamilyContexts(
    families: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>['families'],
    telemetryEvents: ControlGraphTelemetryEvent[],
    evaluations: LearningEvaluationEvent[],
): FamilyTelemetryContext[] {
    const allVersionFamilies = buildVersionLookup(families);
    const inferenceEvents = telemetryEvents.filter((event) => event.event_type === 'inference');
    const inferenceById = new Map(inferenceEvents.map((event) => [event.event_id, event]));
    const outcomeEvents = telemetryEvents.filter((event) => event.event_type === 'outcome');

    return families.map((family) => {
        const versions = allVersionFamilies.get(family.model_family) ?? new Set<string>();
        const familyInference = inferenceEvents.filter((event) => resolveEventFamily(event.model_version, allVersionFamilies, families) === family.model_family);
        const familyInferenceIds = new Set(familyInference.map((event) => event.event_id));
        const familyOutcomes = outcomeEvents
            .filter((event) => event.linked_event_id != null && familyInferenceIds.has(event.linked_event_id))
            .map((event) => {
                const linkedInference = event.linked_event_id ? inferenceById.get(event.linked_event_id) ?? null : null;
                const prediction = linkedInference ? linkedInference.metrics.prediction : null;
                const groundTruth = event.metrics.ground_truth;
                const correct = event.metrics.correct;

                if (!prediction || !groundTruth || correct == null) {
                    return null;
                }

                return {
                    timestamp: event.timestamp,
                    prediction,
                    ground_truth: groundTruth,
                    correct,
                };
            })
            .filter((value): value is FamilyTelemetryContext['outcome_pairs'][number] => value != null);

        const modelVersions = Array.from(versions);
        const latestEvaluation = evaluations.find((evaluation) => evaluation.model_version != null && modelVersions.includes(evaluation.model_version));

        return {
            family: family.model_family,
            group: family,
            versions,
            inference_events: familyInference,
            outcome_pairs: familyOutcomes,
            evaluation_drift: latestEvaluation?.drift_score ?? null,
        };
    });
}

function buildVersionLookup(families: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>['families']) {
    const lookup = new Map<ModelFamily, Set<string>>();
    for (const family of families) {
        const versions = new Set<string>();
        for (const entry of family.entries) {
            if (entry.registry.model_version) versions.add(entry.registry.model_version);
        }
        if (family.active_model?.model_version) versions.add(family.active_model.model_version);
        lookup.set(family.model_family, versions);
    }
    return lookup;
}

function buildGovernanceState(group: ModelRegistryFamilyGroup): TopologyNodeGovernance {
    const active = group.active_model ?? group.entries[0]?.registry ?? null;
    const pendingEntries = group.entries.filter((entry) => entry.registry.lifecycle_status === 'staging');
    const failedEntries = group.entries.filter((entry) => entry.decision_panel.deployment_decision === 'rejected');
    const pendingBlockers = pendingEntries.flatMap((entry) => entry.promotion_gating.blockers).slice(0, 3);

    return {
        model_version: active?.model_version ?? null,
        registry_role: active?.registry_role ?? null,
        deployment_status: active?.status ?? null,
        lifecycle_status: active?.lifecycle_status ?? null,
        border_state: failedEntries.length > 0 ? 'failed' : pendingEntries.length > 0 ? 'pending' : 'normal',
        promotion_blockers: pendingBlockers,
    };
}

function buildRegistryState(
    controlPlane: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>,
    now: Date,
): TopologyNodeState {
    const activeCount = controlPlane.families.filter((family) => family.active_model != null).length;
    const pendingCount = controlPlane.families.flatMap((family) => family.entries).filter((entry) => entry.registry.lifecycle_status === 'staging').length;
    const rejectedCount = controlPlane.families.flatMap((family) => family.entries).filter((entry) => entry.decision_panel.deployment_decision === 'rejected').length;
    const latestAudit = controlPlane.audit_history[0]?.timestamp ?? controlPlane.refreshed_at;

    return {
        status: rejectedCount > 0 ? 'critical' : pendingCount > 0 ? 'degraded' : activeCount === 0 ? 'offline' : 'healthy',
        latency: Number((25 + pendingCount * 15 + rejectedCount * 40).toFixed(1)),
        throughput: Number((controlPlane.audit_history.length / 60).toFixed(2)),
        error_rate: ratio(rejectedCount, Math.max(controlPlane.families.length, 1)),
        drift_score: maxValue(controlPlane.families.map((family) => family.entries[0]?.registry.clinical_metrics.adversarial_degradation ?? null)),
        confidence_avg: mean(controlPlane.families.map((family) => family.active_model?.clinical_metrics.global_accuracy ?? null).filter((value): value is number => value != null)),
        last_updated: latestAudit ?? now.toISOString(),
    };
}

function buildNodeOverrides(events: ControlGraphTelemetryEvent[]): Map<NodeId, NodeOverride> {
    const overrides = new Map<NodeId, NodeOverride>();

    for (const event of events) {
        const metadata = event.metadata;
        const targetNodeId = readString(metadata.target_node_id) as NodeId | null;
        if (!targetNodeId) continue;

        const override: NodeOverride = {
            target_node_id: targetNodeId,
            scenario: readString(metadata.scenario) as TopologySimulationScenario | null,
            status: readString(metadata.injected_status) as TopologyNodeState['status'] | null,
            latency: readNumber(metadata.injected_latency_ms),
            throughput: readNumber(metadata.injected_throughput),
            error_rate: readNumber(metadata.injected_error_rate),
            drift_score: readNumber(metadata.injected_drift_score),
            confidence_avg: readNumber(metadata.injected_confidence_avg),
            timestamp: event.timestamp,
        };

        const current = overrides.get(targetNodeId);
        if (!current || current.timestamp.localeCompare(override.timestamp) < 0) {
            overrides.set(targetNodeId, override);
        }
    }

    return overrides;
}

function applyOverride(
    state: TopologyNodeState,
    override: NodeOverride | undefined,
    now: Date,
): TopologyNodeState {
    if (!override) return state;
    if (new Date(now).getTime() - new Date(override.timestamp).getTime() > OFFLINE_THRESHOLD_MS) {
        return state;
    }

    return {
        status: override.status ?? state.status,
        latency: override.latency ?? state.latency,
        throughput: override.throughput ?? state.throughput,
        error_rate: override.error_rate ?? state.error_rate,
        drift_score: override.drift_score ?? state.drift_score,
        confidence_avg: override.confidence_avg ?? state.confidence_avg,
        last_updated: override.timestamp ?? state.last_updated,
    };
}

function createNode(input: {
    id: NodeId;
    kind: TopologyNodeSnapshot['kind'];
    state: TopologyNodeState;
    governance: TopologyNodeGovernance | null;
    metadata: Record<string, unknown>;
}): TopologyNodeSnapshot {
    return {
        id: input.id,
        label: NODE_LABELS[input.id],
        kind: input.kind,
        position: NODE_POSITIONS[input.id],
        state: input.state,
        governance: input.governance,
        alert_count: 0,
        propagated_risk: false,
        impact_sources: [],
        connected_node_ids: [],
        recent_errors: [],
        recommendations: [],
        metadata: input.metadata,
    };
}

function computeNetworkHealthScore(nodes: TopologyNodeSnapshot[]) {
    if (nodes.length === 0) return 0;

    const scores = nodes.map((node) => {
        const latencyScore = node.state.latency == null
            ? 0.8
            : clampNumber(1 - (node.state.latency / LATENCY_CRITICAL_THRESHOLD), 0, 1);
        const errorScore = node.state.error_rate == null
            ? 0.85
            : clampNumber(1 - (node.state.error_rate / 0.2), 0, 1);
        const driftScore = node.state.drift_score == null
            ? 0.8
            : clampNumber(1 - (node.state.drift_score / 0.4), 0, 1);
        const confidenceScore = node.state.confidence_avg == null
            ? 0.7
            : clampNumber(node.state.confidence_avg, 0, 1);

        return (latencyScore * 0.3) + (errorScore * 0.25) + (driftScore * 0.2) + (confidenceScore * 0.25);
    });

    return Math.round((mean(scores) ?? 0) * 100);
}

function calculateInferenceErrorRate(
    inferenceEvents: ControlGraphTelemetryEvent[],
    outcomePairs: Array<{ correct: boolean }>,
) {
    if (inferenceEvents.length === 0) return null;
    const anomalyCount = inferenceEvents.filter((event) => (event.metrics.latency_ms ?? 0) > 5_000).length;
    const incorrectCount = outcomePairs.filter((pair) => pair.correct === false).length;
    return roundNumber((anomalyCount + incorrectCount) / inferenceEvents.length, 4);
}

function collectOutcomePairs(
    inferenceEvents: ControlGraphTelemetryEvent[],
    outcomeEvents: ControlGraphTelemetryEvent[],
) {
    const inferenceById = new Map(inferenceEvents.map((event) => [event.event_id, event]));
    return outcomeEvents
        .map((event) => {
            const linkedInference = event.linked_event_id ? inferenceById.get(event.linked_event_id) ?? null : null;
            const prediction = linkedInference?.metrics.prediction ?? null;
            const groundTruth = event.metrics.ground_truth;
            const correct = event.metrics.correct;

            if (!prediction || !groundTruth || correct == null) {
                return null;
            }

            return {
                timestamp: event.timestamp,
                prediction,
                ground_truth: groundTruth,
                correct,
            };
        })
        .filter((value): value is { timestamp: string; prediction: string; ground_truth: string; correct: boolean } => value != null);
}

function computeDistributionDrift(
    pairs: Array<{ prediction: string; ground_truth: string }>,
) {
    const predicted = new Map<string, number>();
    const actual = new Map<string, number>();

    for (const pair of pairs) {
        predicted.set(pair.prediction, (predicted.get(pair.prediction) ?? 0) + 1);
        actual.set(pair.ground_truth, (actual.get(pair.ground_truth) ?? 0) + 1);
    }

    const labels = new Set([...predicted.keys(), ...actual.keys()]);
    const predictedTotal = Array.from(predicted.values()).reduce((sum, value) => sum + value, 0);
    const actualTotal = Array.from(actual.values()).reduce((sum, value) => sum + value, 0);
    if (predictedTotal === 0 || actualTotal === 0) return 0;

    let squared = 0;
    for (const label of labels) {
        const predictedProbability = (predicted.get(label) ?? 0) / predictedTotal;
        const actualProbability = (actual.get(label) ?? 0) / actualTotal;
        squared += (predictedProbability - actualProbability) ** 2;
    }

    return roundNumber(Math.sqrt(squared), 4);
}

function resolveNodeStatus(input: {
    hasData: boolean;
    lastUpdated: string | null;
    latency: number | null;
    errorRate: number | null;
    drift: number | null;
    confidence: number | null;
    governanceFailure: boolean;
    governancePending: boolean;
    now: Date;
}): TopologyNodeState['status'] {
    if (!input.hasData) return 'offline';
    if (isStale(input.lastUpdated, input.now)) return 'offline';
    if (
        input.governanceFailure ||
        (input.latency ?? 0) >= LATENCY_CRITICAL_THRESHOLD ||
        (input.errorRate ?? 0) >= ERROR_CRITICAL_THRESHOLD ||
        (input.drift ?? 0) >= DRIFT_CRITICAL_THRESHOLD ||
        (input.confidence != null && input.confidence < 0.55)
    ) {
        return 'critical';
    }
    if (
        input.governancePending ||
        (input.latency ?? 0) >= LATENCY_WARNING_THRESHOLD ||
        (input.errorRate ?? 0) >= ERROR_WARNING_THRESHOLD ||
        (input.drift ?? 0) >= DRIFT_WARNING_THRESHOLD ||
        (input.confidence != null && input.confidence < 0.72)
    ) {
        return 'degraded';
    }
    return 'healthy';
}

function resolveAggregateStatus(statuses: Array<TopologyNodeState['status']>) {
    if (statuses.includes('critical')) return 'critical';
    if (statuses.includes('degraded')) return 'degraded';
    if (statuses.every((status) => status === 'offline')) return 'offline';
    return 'healthy';
}

function resolveEdgeStatus(input: {
    latency: number | null;
    failureRate: number | null;
    requestsPerMinute: number | null;
}): TopologyEdgeSnapshot['status'] {
    if ((input.failureRate ?? 0) >= ERROR_CRITICAL_THRESHOLD || (input.latency ?? 0) >= LATENCY_CRITICAL_THRESHOLD) {
        return 'failing';
    }
    if ((input.failureRate ?? 0) >= ERROR_WARNING_THRESHOLD || (input.latency ?? 0) >= LATENCY_WARNING_THRESHOLD || (input.requestsPerMinute ?? 0) > 30) {
        return 'stressed';
    }
    return 'normal';
}

function buildTimelineLabel(event: ControlGraphTelemetryEvent) {
    const target = readString(event.metadata.target_node_id);
    if (target) {
        return `${event.event_type.toUpperCase()} ${target}`;
    }
    const source = readString(event.metadata.source_module) ?? readString(event.metadata.source);
    return source
        ? `${event.event_type.toUpperCase()} ${source}`
        : `${event.event_type.toUpperCase()} ${event.model_version}`;
}

function resolveEventFamily(
    modelVersion: string,
    versionLookup: Map<ModelFamily, Set<string>>,
    families: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>['families'],
): ModelFamily {
    for (const [familyKey, versions] of versionLookup.entries()) {
        if (versions.has(modelVersion)) {
            const exactFamily = families.find((family) => family.model_family === familyKey);
            if (exactFamily) return exactFamily.model_family;
        }
    }

    const normalized = modelVersion.toLowerCase();
    if (normalized.includes('vision')) return 'vision';
    if (normalized.includes('therapeut')) return 'therapeutics';
    return 'diagnostics';
}

async function loadTelemetryEvents(
    client: SupabaseClient,
    tenantId: string,
    from: Date,
    until: Date,
) {
    const C = TELEMETRY_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(TELEMETRY_EVENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .gte(C.timestamp, from.toISOString())
        .lte(C.timestamp, until.toISOString())
        .order(C.timestamp, { ascending: true })
        .limit(2_500);

    if (error) {
        throw new Error(`Failed to load topology telemetry events: ${error.message}`);
    }

    return (data ?? []).map((row) => asRecord(row));
}

async function loadClinicalCases(
    client: SupabaseClient,
    tenantId: string,
    from: Date,
    until: Date,
): Promise<CaseEvent[]> {
    const C = CLINICAL_CASES.COLUMNS;
    const { data, error } = await client
        .from(CLINICAL_CASES.TABLE)
        .select([
            C.id,
            C.clinic_id,
            C.invalid_case,
            C.diagnosis_confidence,
            C.prediction_correct,
            C.updated_at,
            C.telemetry_status,
            C.calibration_status,
        ].join(','))
        .eq(C.tenant_id, tenantId)
        .gte(C.updated_at, from.toISOString())
        .lte(C.updated_at, until.toISOString())
        .order(C.updated_at, { ascending: false })
        .limit(1_000);

    if (error) {
        throw new Error(`Failed to load topology clinical cases: ${error.message}`);
    }

    return (data ?? []).map((row) => {
        const record = asRecord(row);
        return {
            case_id: readString(record.id) ?? '',
            clinic_id: readString(record.clinic_id),
            invalid_case: record.invalid_case === true,
            diagnosis_confidence: readNumber(record.diagnosis_confidence),
            prediction_correct: readBoolean(record.prediction_correct),
            updated_at: readString(record.updated_at) ?? new Date().toISOString(),
            telemetry_status: readString(record.telemetry_status),
            calibration_status: readString(record.calibration_status),
        };
    });
}

function mapTelemetryEvent(row: Record<string, unknown>): ControlGraphTelemetryEvent {
    const metrics = asRecord(row.metrics);
    const system = asRecord(row.system);

    return {
        event_id: readString(row.event_id) ?? 'evt_unknown',
        linked_event_id: readString(row.linked_event_id),
        event_type: resolveEventType(readString(row.event_type)),
        timestamp: readString(row.timestamp) ?? new Date().toISOString(),
        model_version: readString(row.model_version) ?? 'unknown',
        run_id: readString(row.run_id) ?? 'unknown',
        metrics: {
            latency_ms: readNumber(metrics.latency_ms),
            confidence: readNumber(metrics.confidence),
            prediction: readString(metrics.prediction),
            ground_truth: readString(metrics.ground_truth),
            correct: readBoolean(metrics.correct),
        },
        system: {
            cpu: readNumber(system.cpu),
            gpu: readNumber(system.gpu),
            memory: readNumber(system.memory),
        },
        metadata: asRecord(row.metadata),
    };
}

function resolveEventType(value: string | null): ControlGraphTelemetryEvent['event_type'] {
    if (value === 'outcome' || value === 'system' || value === 'training') return value;
    return 'inference';
}

function resolveUntil(until: string | null | undefined) {
    const date = until ? new Date(until) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function linkedOutcomeLatency(
    outcome: ControlGraphTelemetryEvent,
    inferenceEvents: ControlGraphTelemetryEvent[],
) {
    if (!outcome.linked_event_id) return null;
    const inference = inferenceEvents.find((event) => event.event_id === outcome.linked_event_id);
    if (!inference) return null;
    return roundNumber((new Date(outcome.timestamp).getTime() - new Date(inference.timestamp).getTime()) / 1000, 1);
}

function outcomeLoopLatency(
    inferenceEvents: ControlGraphTelemetryEvent[],
    outcomeEvents: ControlGraphTelemetryEvent[],
) {
    const latencies = outcomeEvents
        .map((event) => linkedOutcomeLatency(event, inferenceEvents))
        .filter((value): value is number => value != null);
    return latencies.length > 0 ? percentile(latencies, 95) : null;
}

function datasetLatencyEstimate(latencies: number[], invalidCount: number, total: number) {
    if (latencies.length === 0 && total === 0) return null;
    const base = percentile(latencies, 95) ?? 180;
    const penalty = ratio(invalidCount, total) ?? 0;
    return roundNumber(base * 0.6 + (penalty * 1_000), 1);
}

function isStale(timestamp: string | null, now: Date) {
    if (!timestamp) return true;
    return now.getTime() - new Date(timestamp).getTime() > OFFLINE_THRESHOLD_MS;
}

function findLatestTimestamp(values: string[]) {
    if (values.length === 0) return null;
    return values.slice().sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function percentile(values: number[], percentileRank: number) {
    if (values.length === 0) return null;
    const sorted = values.slice().sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1);
    return roundNumber(sorted[index] ?? sorted[sorted.length - 1] ?? 0, 1);
}

function mean(values: number[]) {
    if (values.length === 0) return null;
    return roundNumber(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function maxValue(values: Array<number | null>) {
    const filtered = values.filter((value): value is number => value != null);
    return filtered.length > 0 ? roundNumber(Math.max(...filtered), 4) : null;
}

function maxNumber(values: number[]) {
    return values.length > 0 ? roundNumber(Math.max(...values), 2) : null;
}

function ratio(numerator: number, denominator: number) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
    return roundNumber(numerator / denominator, 4);
}

function edgeStrokeWidth(requestsPerMinute: number | null) {
    if (requestsPerMinute == null) return 2;
    return clampNumber(2 + (requestsPerMinute / 8), 2, 8);
}

function severityRank(severity: TopologyAlert['severity']) {
    if (severity === 'critical') return 3;
    if (severity === 'warning') return 2;
    return 1;
}

function dedupeRecommendations(recommendations: TopologyRecommendation[]) {
    const seen = new Set<string>();
    return recommendations.filter((recommendation) => {
        if (seen.has(recommendation.message)) return false;
        seen.add(recommendation.message);
        return true;
    });
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number, digits: number) {
    return Number(value.toFixed(digits));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

export function resolveTopologySimulationTarget(
    controlPlane: Awaited<ReturnType<typeof getModelRegistryControlPlaneSnapshot>>,
    targetNodeId: string,
) {
    const nodeId = targetNodeId as NodeId;
    const family = (Object.entries(FAMILY_TO_NODE).find(([, value]) => value === nodeId)?.[0] ?? null) as ModelFamily | null;
    const familyGroup = family ? controlPlane.families.find((entry) => entry.model_family === family) ?? null : null;
    const activeModel = familyGroup?.active_model ?? null;

    return {
        node_id: nodeId,
        family,
        active_model: activeModel,
        run_id: activeModel?.run_id ?? readString(activeModel?.lineage?.run_id) ?? 'topology_control_graph',
        model_version: activeModel?.model_version ?? family ?? 'topology_control_graph',
    };
}
