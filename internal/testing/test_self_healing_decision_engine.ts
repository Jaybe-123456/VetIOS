import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
    applyDecisionEngineToTopologySnapshot,
    buildDecisionCandidates,
    buildDecisionEngineSnapshot,
} from '../../apps/web/lib/decisionEngine/service.ts';
import type {
    DecisionAuditLogRecord,
    DecisionEngineConfiguration,
    DecisionEngineRecord,
} from '../../apps/web/lib/decisionEngine/types.ts';
import type {
    ModelRegistryControlPlaneSnapshot,
    ModelRegistryRecord,
} from '../../apps/web/lib/experiments/types.ts';
import type {
    TopologyNodeSnapshot,
    TopologySnapshot,
} from '../../apps/web/lib/intelligence/types.ts';

const NOW = new Date('2026-03-20T12:00:00.000Z').toISOString();

function makeConfig(overrides: Partial<DecisionEngineConfiguration> = {}): DecisionEngineConfiguration {
    return {
        latency_threshold_ms: 900,
        drift_threshold: 0.2,
        confidence_threshold: 0.65,
        mode: 'autonomous',
        safe_mode_enabled: false,
        abstain_threshold: 0.8,
        auto_execute_confidence_threshold: 0.9,
        ...overrides,
    };
}

function makeRegistryRecord(overrides: Partial<ModelRegistryRecord> = {}): ModelRegistryRecord {
    const modelFamily = overrides.model_family ?? 'diagnostics';
    const registryId = overrides.registry_id ?? `reg_${modelFamily}_${randomUUID().slice(0, 8)}`;
    const runId = overrides.run_id ?? `run_${modelFamily}`;
    const modelVersion = overrides.model_version ?? `${modelFamily}_v1`;

    return {
        registry_id: registryId,
        tenant_id: overrides.tenant_id ?? 'tenant-test',
        run_id: runId,
        model_name: overrides.model_name ?? `${modelFamily} model`,
        model_version: modelVersion,
        model_family: modelFamily,
        artifact_uri: null,
        dataset_version: 'dataset-v1',
        feature_schema_version: 'feature-v1',
        label_policy_version: 'label-v1',
        lifecycle_status: overrides.lifecycle_status ?? 'production',
        registry_role: overrides.registry_role ?? 'champion',
        deployed_at: NOW,
        archived_at: null,
        promoted_from: null,
        rollback_target: overrides.rollback_target ?? null,
        clinical_metrics: {
            global_accuracy: 0.91,
            macro_f1: 0.89,
            critical_recall: 0.82,
            false_reassurance_rate: 0.05,
            fn_critical_rate: 0.04,
            ece: 0.08,
            brier_score: 0.11,
            adversarial_degradation: 0.09,
            latency_p99: 420,
            ...overrides.clinical_metrics,
        },
        lineage: {
            run_id: runId,
            experiment_group: 'group-a',
            dataset_version: 'dataset-v1',
            benchmark_id: 'bench-1',
            calibration_report_uri: null,
            adversarial_report_uri: null,
            ...overrides.lineage,
        },
        rollback_metadata: null,
        artifact_path: null,
        status: overrides.status ?? overrides.lifecycle_status ?? 'production',
        role: overrides.role ?? overrides.registry_role ?? 'champion',
        created_at: NOW,
        created_by: 'system',
        updated_at: NOW,
        ...overrides,
    };
}

function makeRegistrySnapshot(
    activeModel: ModelRegistryRecord,
    lastStableModel: ModelRegistryRecord | null,
): ModelRegistryControlPlaneSnapshot {
    return {
        tenant_id: activeModel.tenant_id,
        families: [
            {
                model_family: activeModel.model_family,
                active_registry_id: activeModel.registry_id,
                active_model: activeModel,
                last_stable_model: lastStableModel,
                entries: [
                    {
                        registry: activeModel,
                        run: null,
                        promotion_requirements: null,
                        decision_panel: {
                            promotion_eligibility: true,
                            deployment_decision: 'approved',
                            reasons: [],
                            missing_evaluations: [],
                        },
                        promotion_gating: {
                            can_promote: true,
                            promotion_allowed: true,
                            missing_requirements: [],
                            blockers: [],
                            gates: {
                                calibration: 'pass',
                                adversarial: 'pass',
                                safety: 'pass',
                                benchmark: 'pass',
                                manual_approval: 'pass',
                            },
                            tooltip: 'Ready',
                        },
                        clinical_scorecard: activeModel.clinical_metrics,
                        lineage: activeModel.lineage,
                        rollback_history: [],
                        latest_registry_events: [],
                        is_active_route: true,
                        last_stable_model: lastStableModel,
                    },
                    ...(lastStableModel ? [{
                        registry: lastStableModel,
                        run: null,
                        promotion_requirements: null,
                        decision_panel: {
                            promotion_eligibility: true,
                            deployment_decision: 'approved',
                            reasons: [],
                            missing_evaluations: [],
                        },
                        promotion_gating: {
                            can_promote: true,
                            promotion_allowed: true,
                            missing_requirements: [],
                            blockers: [],
                            gates: {
                                calibration: 'pass',
                                adversarial: 'pass',
                                safety: 'pass',
                                benchmark: 'pass',
                                manual_approval: 'pass',
                            },
                            tooltip: 'Stable',
                        },
                        clinical_scorecard: lastStableModel.clinical_metrics,
                        lineage: lastStableModel.lineage,
                        rollback_history: [],
                        latest_registry_events: [],
                        is_active_route: false,
                        last_stable_model: lastStableModel,
                    }] : []),
                ],
            },
        ],
        routing_pointers: [
            {
                id: `route_${activeModel.model_family}`,
                tenant_id: activeModel.tenant_id,
                model_family: activeModel.model_family,
                active_registry_id: activeModel.registry_id,
                active_run_id: activeModel.run_id,
                updated_at: NOW,
                updated_by: 'system',
            },
        ],
        audit_history: [],
        refreshed_at: NOW,
    };
}

function makeNode(overrides: Partial<TopologyNodeSnapshot> = {}): TopologyNodeSnapshot {
    return {
        id: overrides.id ?? 'diagnostics_model',
        label: overrides.label ?? 'Diagnostics Model',
        kind: overrides.kind ?? 'model',
        position: overrides.position ?? { x: 100, y: 100 },
        state: {
            status: 'healthy',
            latency: 320,
            throughput: 44,
            error_rate: 0.04,
            drift_score: 0.08,
            confidence_avg: 0.9,
            last_updated: NOW,
            ...overrides.state,
        },
        governance: overrides.governance ?? {
            model_version: 'diagnostics_v1',
            registry_role: 'champion',
            deployment_status: 'production',
            lifecycle_status: 'production',
            border_state: 'normal',
            promotion_blockers: [],
        },
        alert_count: overrides.alert_count ?? 0,
        propagated_risk: overrides.propagated_risk ?? false,
        impact_sources: overrides.impact_sources ?? [],
        connected_node_ids: overrides.connected_node_ids ?? ['clinic_ingest'],
        recent_errors: overrides.recent_errors ?? [],
        recommendations: overrides.recommendations ?? ['Monitor calibration'],
        metadata: overrides.metadata ?? {},
    };
}

function makeTopologySnapshot(overrides: Partial<TopologySnapshot> = {}): TopologySnapshot {
    const decisionNode = makeNode({
        id: 'decision_fabric',
        label: 'Decision Fabric',
        kind: 'decision',
        state: {
            status: 'healthy',
            latency: 40,
            throughput: 20,
            error_rate: 0,
            drift_score: null,
            confidence_avg: 1,
            last_updated: NOW,
        },
        governance: null,
        connected_node_ids: ['diagnostics_model'],
        recommendations: ['Observe control-plane state'],
    });
    const diagnosticsNode = makeNode();

    return {
        tenant_id: 'tenant-test',
        refreshed_at: NOW,
        window: '24h',
        mode: 'live',
        control_plane_state: 'READY',
        playback: {
            live_supported: true,
            current_until: NOW,
            event_timeline: [],
        },
        diagnostics: {
            telemetry_stream_connected: true,
            evaluation_events_table_exists: true,
            latest_inference_timestamp: NOW,
            latest_outcome_timestamp: NOW,
            latest_evaluation_timestamp: NOW,
            latest_simulation_timestamp: NOW,
            active_alert_count: 2,
        },
        network_health_score: 82,
        summary: {
            where_failing: 'none',
            root_cause: 'stable',
            impact: 'No major impact.',
            next_action: 'Continue monitoring.',
        },
        nodes: [decisionNode, diagnosticsNode],
        edges: [],
        alerts: [],
        failure_impacts: [
            {
                source_node_id: 'diagnostics_model',
                impacted_node_ids: ['clinic_ingest', 'outcome_learning_hub'],
                impacted_edge_ids: ['edge_1'],
                reason: 'Model node degradation propagates to clinic and outcome systems.',
            },
        ],
        recommendations: [],
        ...overrides,
        nodes: overrides.nodes ?? [decisionNode, diagnosticsNode],
    };
}

function makeDecisionRecord(overrides: Partial<DecisionEngineRecord> = {}): DecisionEngineRecord {
    return {
        decision_id: overrides.decision_id ?? randomUUID(),
        tenant_id: overrides.tenant_id ?? 'tenant-test',
        decision_key: overrides.decision_key ?? 'latency_degradation:diagnostics_model:active',
        trigger_event: overrides.trigger_event ?? 'latency_degradation',
        condition: overrides.condition ?? 'p95 latency exceeded threshold',
        action: overrides.action ?? 'switch_model(fallback_reg)',
        confidence: overrides.confidence ?? 0.94,
        mode: overrides.mode ?? 'autonomous',
        source_node_id: overrides.source_node_id ?? 'diagnostics_model',
        source_node_type: overrides.source_node_type ?? 'model',
        model_family: overrides.model_family ?? 'diagnostics',
        registry_id: overrides.registry_id ?? 'reg_diag_v1',
        run_id: overrides.run_id ?? 'run_diag_v1',
        timestamp: overrides.timestamp ?? NOW,
        status: overrides.status ?? 'executed',
        requires_approval: overrides.requires_approval ?? false,
        blocked_reason: overrides.blocked_reason ?? null,
        metadata: overrides.metadata ?? {},
        created_at: overrides.created_at ?? NOW,
        updated_at: overrides.updated_at ?? NOW,
    };
}

function makeAuditRecord(decisionId: string, action: string): DecisionAuditLogRecord {
    return {
        id: randomUUID(),
        decision_id: decisionId,
        tenant_id: 'tenant-test',
        trigger: 'latency_degradation',
        action,
        executed_at: NOW,
        result: 'success',
        actor: 'system',
        metadata: {},
        created_at: NOW,
    };
}

async function main() {
    const activeModel = makeRegistryRecord({
        registry_id: 'reg_diag_v2',
        run_id: 'run_diag_v2',
        model_version: 'diag_v2',
        clinical_metrics: {
            critical_recall: 0.61,
            global_accuracy: 0.72,
        },
    });
    const stableModel = makeRegistryRecord({
        registry_id: 'reg_diag_v1',
        run_id: 'run_diag_v1',
        model_version: 'diag_v1',
        registry_role: 'rollback_target',
        role: 'rollback_target',
        lifecycle_status: 'archived',
        status: 'archived',
        clinical_metrics: {
            critical_recall: 0.89,
            global_accuracy: 0.91,
        },
    });
    const registrySnapshot = makeRegistrySnapshot(activeModel, stableModel);

    const incidentSnapshot = makeTopologySnapshot({
        nodes: [
            makeNode({
                id: 'decision_fabric',
                label: 'Decision Fabric',
                kind: 'decision',
                state: {
                    status: 'healthy',
                    latency: 40,
                    throughput: 12,
                    error_rate: 0,
                    drift_score: null,
                    confidence_avg: 1,
                    last_updated: NOW,
                },
                governance: null,
                recommendations: ['Awaiting control decisions'],
            }),
            makeNode({
                id: 'diagnostics_model',
                label: 'Diagnostics Model',
                state: {
                    status: 'critical',
                    latency: 1820,
                    throughput: 31,
                    error_rate: 0.22,
                    drift_score: 0.61,
                    confidence_avg: 0.44,
                    last_updated: NOW,
                },
                recommendations: ['Inspect model health'],
            }),
        ],
    });

    const candidates = buildDecisionCandidates({
        topologySnapshot: incidentSnapshot,
        registrySnapshot,
        config: makeConfig(),
        evaluationRows: [
            { model_version: 'diag_v2', prediction_correct: true },
            { model_version: 'diag_v2', prediction_correct: false },
            { model_version: 'diag_v2', prediction_correct: false },
            { model_version: 'diag_v2', prediction_correct: false },
            { model_version: 'diag_v1', prediction_correct: true },
        ],
    });

    const driftCandidate = candidates.find((candidate) => candidate.trigger_event === 'model_drift_detected');
    assert.ok(driftCandidate, 'expected drift candidate');
    assert.equal(driftCandidate?.requires_approval, false);
    assert.deepEqual(
        driftCandidate?.actions.map((action) => action.kind).slice(0, 3),
        ['rollback_to_previous', 'mark_model_at_risk', 'block_model_promotion'],
    );

    const latencyCandidate = candidates.find((candidate) => candidate.trigger_event === 'latency_degradation');
    assert.ok(latencyCandidate, 'expected latency candidate');
    assert.equal(latencyCandidate?.actions[0]?.kind, 'switch_model');

    const confidenceCandidate = candidates.find((candidate) => candidate.trigger_event === 'confidence_collapse');
    assert.ok(confidenceCandidate, 'expected confidence-collapse candidate');
    assert.equal(confidenceCandidate?.requires_approval, false);

    const accuracyCandidate = candidates.find((candidate) => candidate.trigger_event === 'accuracy_drop');
    assert.ok(accuracyCandidate, 'expected accuracy-drop candidate');
    assert.equal(accuracyCandidate?.severity, 'critical');

    const disconnectedCandidates = buildDecisionCandidates({
        topologySnapshot: {
            ...incidentSnapshot,
            control_plane_state: 'STREAM_DISCONNECTED',
        },
        registrySnapshot,
        config: makeConfig(),
        evaluationRows: [],
    });
    const disconnected = disconnectedCandidates.find((candidate) => candidate.trigger_event === 'system_disconnected');
    assert.ok(disconnected, 'expected system-disconnected candidate');
    assert.deepEqual(
        disconnected?.actions.map((action) => action.kind),
        ['restart_pipeline', 'enable_safe_mode', 'raise_alert'],
    );

    const latestDecision = makeDecisionRecord({
        trigger_event: 'latency_degradation',
        action: 'switch_model(reg_diag_v1)',
        source_node_id: 'diagnostics_model',
        status: 'executed',
    });
    const blockedDecision = makeDecisionRecord({
        decision_key: 'model_drift_detected:diagnostics_model:reg_diag_v2',
        trigger_event: 'model_drift_detected',
        action: 'rollback_to_previous()',
        status: 'blocked',
        blocked_reason: 'Autonomous guardrail held action pending approval.',
        confidence: 0.81,
    });
    const decisionSnapshot = buildDecisionEngineSnapshot(
        makeConfig({ mode: 'autonomous' }),
        incidentSnapshot,
        [latestDecision, blockedDecision],
        [makeAuditRecord(latestDecision.decision_id, latestDecision.action)],
        NOW,
    );
    assert.equal(decisionSnapshot.active_decision_count, 1);
    assert.equal(decisionSnapshot.latest_trigger, 'latency_degradation');
    assert.equal(decisionSnapshot.summary.where_failing, 'diagnostics_model');

    const enriched = applyDecisionEngineToTopologySnapshot(incidentSnapshot, decisionSnapshot);
    assert.equal(enriched.summary.root_cause, 'latency_degradation');
    assert.equal(enriched.summary.next_action, 'Executed switch_model(reg_diag_v1)');
    assert.equal(enriched.alerts[0]?.category, 'decision');
    assert.equal(enriched.alerts[0]?.severity, 'info');
    assert.equal(enriched.diagnostics.active_alert_count, incidentSnapshot.diagnostics.active_alert_count + 1);

    const decisionNode = enriched.nodes.find((node) => node.id === 'decision_fabric');
    assert.equal(decisionNode?.metadata.latest_action, 'switch_model(reg_diag_v1)');
    assert.equal(decisionNode?.metadata.decision_mode, 'autonomous');

    const sourceNode = enriched.nodes.find((node) => node.id === 'diagnostics_model');
    assert.equal(sourceNode?.recommendations[0], 'switch_model(reg_diag_v1)');
    assert.match(sourceNode?.recent_errors[0] ?? '', /latency_degradation/);

    console.log('Self-healing decision engine integration tests passed.');
}

void main();
