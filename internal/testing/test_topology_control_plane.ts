import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvaluationEvent } from '../../apps/web/lib/evaluation/evaluationEngine.ts';
import {
    buildTopologyAlertsForTest,
    calculateInferenceErrorRateForTest,
    calculateSimulationErrorRateForTest,
    classifyTopologyControlPlaneState,
    computeTopologyDriftSignal,
    computeTopologyNetworkHealth,
    buildOperationalTelemetryRowsForTest,
} from '../../apps/web/lib/intelligence/topologyService.ts';
import type { TopologyNodeSnapshot } from '../../apps/web/lib/intelligence/types.ts';
import {
    buildTelemetrySnapshotForTest,
    emitTelemetryHeartbeat,
    emitTelemetryEvent,
    telemetryEvaluationEventId,
    telemetryInferenceEventId,
    telemetryOutcomeEventId,
    telemetrySimulationEventId,
} from '../../apps/web/lib/telemetry/service.ts';

class InMemorySupabaseClient {
    tables = new Map<string, Record<string, unknown>[]>();

    from(table: string) {
        return new InMemoryMutationBuilder(this.tables, table);
    }
}

class InMemoryMutationBuilder {
    private pendingRow: Record<string, unknown> | null = null;
    private selectedColumns: string | null = null;
    private readonly tables: Map<string, Record<string, unknown>[]>;
    private readonly table: string;

    constructor(
        tables: Map<string, Record<string, unknown>[]>,
        table: string,
    ) {
        this.tables = tables;
        this.table = table;
    }

    insert(row: Record<string, unknown>) {
        const record = { ...row };
        if (!record.id) record.id = randomUUID();
        if (!record.evaluation_event_id && this.table === 'model_evaluation_events') {
            record.evaluation_event_id = randomUUID();
        }
        if (!record.created_at) record.created_at = new Date().toISOString();
        const rows = this.tables.get(this.table) ?? [];
        rows.push(record);
        this.tables.set(this.table, rows);
        this.pendingRow = record;
        return this;
    }

    upsert(row: Record<string, unknown>) {
        const rows = this.tables.get(this.table) ?? [];
        const eventId = String(row.event_id);
        const existingIndex = rows.findIndex((candidate) => String(candidate.event_id) === eventId);
        if (existingIndex >= 0) {
            rows[existingIndex] = { ...rows[existingIndex], ...row };
            this.pendingRow = rows[existingIndex]!;
        } else {
            const record = { ...row, created_at: row.created_at ?? new Date().toISOString() };
            rows.push(record);
            this.pendingRow = record;
        }
        this.tables.set(this.table, rows);
        return this;
    }

    select(columns: string) {
        this.selectedColumns = columns;
        return this;
    }

    async single() {
        if (!this.pendingRow) {
            return { data: null, error: { message: 'No pending row' } };
        }

        if (!this.selectedColumns || this.selectedColumns === '*') {
            return { data: this.pendingRow, error: null };
        }

        const projected = this.selectedColumns
            .split(',')
            .map((column) => column.trim())
            .reduce<Record<string, unknown>>((accumulator, column) => {
                accumulator[column] = this.pendingRow?.[column];
                return accumulator;
            }, {});

        return { data: projected, error: null };
    }
}

async function main() {
    const tenantId = 'tenant-test';
    const client = new InMemorySupabaseClient();

    const evaluation = await createEvaluationEvent(client as any, {
        tenant_id: tenantId,
        trigger_type: 'outcome',
        inference_event_id: randomUUID(),
        outcome_event_id: randomUUID(),
        case_id: randomUUID(),
        model_name: 'VetIOS Diagnostics',
        model_version: 'diag-v2',
        prediction: 'Parvovirus',
        ground_truth: 'Parvovirus',
        condition_class_pred: 'gastrointestinal',
        condition_class_true: 'gastrointestinal',
        severity_pred: 'critical',
        severity_true: 'critical',
        contradiction_score: 0.11,
        adversarial_case: false,
        predicted_confidence: 0.93,
        actual_correctness: 1,
        predicted_output: {
            diagnosis: {
                primary_condition_class: 'gastrointestinal',
                top_differentials: [{ name: 'Parvovirus' }],
            },
        },
        actual_outcome: {
            actual_diagnosis: 'Parvovirus',
            primary_condition_class: 'gastrointestinal',
        },
        recent_evaluations: [
            {
                calibration_error: 0.08,
                drift_score: null,
                prediction: 'Parvovirus',
                ground_truth: 'Parvovirus',
                created_at: new Date(Date.now() - 30_000).toISOString(),
            },
            {
                calibration_error: 0.12,
                drift_score: null,
                prediction: 'Pancreatitis',
                ground_truth: 'Pancreatitis',
                created_at: new Date(Date.now() - 20_000).toISOString(),
            },
        ],
    });

    const evaluationRows = client.tables.get('model_evaluation_events') ?? [];
    assert.equal(evaluationRows.length, 1, 'expected evaluation event to be persisted');
    assert.equal(evaluation.prediction_correct, true);
    assert.equal(evaluation.ground_truth, 'Parvovirus');

    const inferenceTelemetry = await emitTelemetryEvent(client as any, {
        event_id: telemetryInferenceEventId(randomUUID()),
        tenant_id: tenantId,
        event_type: 'inference',
        model_version: 'diag-v2',
        run_id: 'run_diag_v2',
        metrics: {
            latency_ms: 5_400,
            confidence: 0.85,
            prediction: 'Parvovirus',
        },
        metadata: {
            synthetic: false,
        },
    });

    const outcomeTelemetry = await emitTelemetryEvent(client as any, {
        event_id: telemetryOutcomeEventId(randomUUID()),
        tenant_id: tenantId,
        linked_event_id: inferenceTelemetry.event_id,
        source_id: randomUUID(),
        source_table: 'clinical_outcome_events',
        event_type: 'outcome',
        model_version: 'diag-v2',
        run_id: 'run_diag_v2',
        metrics: {
            ground_truth: 'Parvovirus',
            correct: true,
        },
        metadata: {
            synthetic: false,
        },
    });

    const evaluationTelemetry = await emitTelemetryEvent(client as any, {
        event_id: telemetryEvaluationEventId(evaluation.evaluation_event_id),
        tenant_id: tenantId,
        linked_event_id: inferenceTelemetry.event_id,
        source_id: evaluation.evaluation_event_id,
        source_table: 'model_evaluation_events',
        event_type: 'evaluation',
        model_version: 'diag-v2',
        run_id: 'run_diag_v2',
        metrics: {
            prediction: evaluation.prediction,
            ground_truth: evaluation.ground_truth,
            confidence: evaluation.prediction_confidence,
            correct: evaluation.prediction_correct,
        },
        metadata: {
            synthetic: false,
        },
    });

    const snapshot = buildTelemetrySnapshotForTest([
        inferenceTelemetry,
        outcomeTelemetry,
        evaluationTelemetry,
    ]);
    assert.equal(snapshot.traffic_mode, 'production');
    assert.equal(snapshot.metrics.p95_latency_ms, 5400, 'anomalous inference latency should still appear in p95');
    assert.equal(snapshot.metrics.anomaly_count, 1, 'anomalous latency should still be counted separately');
    assert.equal(snapshot.metric_states.accuracy, 'READY');
    assert.equal(snapshot.metrics.accuracy, 1);
    assert.equal(snapshot.metric_states.drift_score, 'INSUFFICIENT_OUTCOMES');

    const syntheticInferenceA = {
        ...inferenceTelemetry,
        event_id: 'evt_sim_inference_a',
        timestamp: new Date().toISOString(),
        metrics: {
            latency_ms: 253.7,
            confidence: 0.832,
            prediction: 'Otitis externa',
            ground_truth: null,
            correct: null,
        },
        metadata: {
            synthetic: true,
            source: 'telemetry_stream_generator',
        },
    };
    const syntheticInferenceB = {
        ...inferenceTelemetry,
        event_id: 'evt_sim_inference_b',
        timestamp: new Date().toISOString(),
        metrics: {
            latency_ms: 130.0,
            confidence: 0.843,
            prediction: 'Pancreatitis',
            ground_truth: null,
            correct: null,
        },
        metadata: {
            synthetic: true,
            source: 'telemetry_stream_generator',
        },
    };
    const syntheticOutcomeA = {
        ...outcomeTelemetry,
        event_id: 'evt_sim_outcome_a',
        linked_event_id: syntheticInferenceA.event_id,
        timestamp: new Date().toISOString(),
        metrics: {
            ground_truth: 'Otitis externa',
            correct: true,
        },
        metadata: {
            synthetic: true,
            source: 'telemetry_stream_generator',
        },
    };
    const syntheticOutcomeB = {
        ...outcomeTelemetry,
        event_id: 'evt_sim_outcome_b',
        linked_event_id: syntheticInferenceB.event_id,
        timestamp: new Date().toISOString(),
        metrics: {
            ground_truth: 'Pancreatitis',
            correct: true,
        },
        metadata: {
            synthetic: true,
            source: 'telemetry_stream_generator',
        },
    };

    const simulationSnapshot = buildTelemetrySnapshotForTest([
        syntheticInferenceA,
        syntheticInferenceB,
        syntheticOutcomeA,
        syntheticOutcomeB,
    ], {
        trafficMode: 'simulation',
    });
    assert.equal(simulationSnapshot.traffic_mode, 'simulation');
    assert.equal(simulationSnapshot.metrics.inference_count, 2);
    assert.equal(simulationSnapshot.metrics.outcome_count, 2);
    assert.equal(simulationSnapshot.metrics.p95_latency_ms, 253.7);
    assert.equal(simulationSnapshot.metrics.anomaly_count, 0);
    assert.equal(simulationSnapshot.metrics.accuracy, 1);
    assert.equal(simulationSnapshot.metric_states.drift_score, 'READY');
    assert.equal(simulationSnapshot.metrics.drift_score, 0);

    await emitTelemetryEvent(client as any, {
        event_id: telemetrySimulationEventId(randomUUID()),
        tenant_id: tenantId,
        source_id: randomUUID(),
        source_table: 'edge_simulation_events',
        event_type: 'simulation',
        model_version: 'diag-v2',
        run_id: 'run_diag_v2',
        metrics: {
            latency_ms: 2_400,
            confidence: 0.42,
            prediction: 'adversarial_attack',
        },
        metadata: {
            synthetic: true,
            target_node_id: 'simulation_cluster',
        },
    });

    await emitTelemetryHeartbeat(client as any, {
        tenantId,
        source: 'topology_stream',
        targetNodeId: 'telemetry_observer',
        metadata: {
            stream: 'intelligence',
        },
    });
    await emitTelemetryHeartbeat(client as any, {
        tenantId,
        source: 'topology_stream',
        targetNodeId: 'telemetry_observer',
        metadata: {
            stream: 'intelligence',
        },
    });

    const telemetryRows = client.tables.get('telemetry_events') ?? [];
    assert.equal(telemetryRows.length, 6, 'expected inference, outcome, evaluation, simulation, and append-only heartbeat telemetry events');
    assert.equal(telemetryRows[0]?.event_type, 'inference');
    assert.equal(telemetryRows[1]?.event_type, 'outcome');
    assert.equal(telemetryRows[2]?.event_type, 'evaluation');
    assert.equal(telemetryRows[3]?.event_type, 'simulation');
    assert.equal(telemetryRows[4]?.event_type, 'system');
    assert.equal(telemetryRows[4]?.metadata?.action, 'heartbeat');
    assert.equal(telemetryRows[5]?.event_type, 'system');

    const directOperationalRows = buildOperationalTelemetryRowsForTest({
        inferenceRows: [{
            id: 'inf_direct_bridge',
            tenant_id: tenantId,
            clinic_id: 'clinic-a',
            case_id: 'case-a',
            source_module: 'inference_console',
            model_name: 'VetIOS Vision',
            model_version: 'vision-v3',
            output_payload: {
                diagnosis: {
                    top_differentials: [{ name: 'Retinal disease' }],
                },
                telemetry: {
                    run_id: 'vision-run-3',
                    routing_model_family: 'vision',
                    routing_selected_model_id: 'vision-primary',
                },
            },
            confidence_score: 0.91,
            inference_latency_ms: 321,
            compute_profile: {
                cpu: 0.42,
                memory: 0.55,
            },
            blocked: false,
            flagged: false,
            created_at: new Date().toISOString(),
        }],
        outcomeRows: [{
            id: 'out_direct_bridge',
            tenant_id: tenantId,
            clinic_id: 'clinic-a',
            case_id: 'case-a',
            source_module: 'outcome_learning',
            inference_event_id: 'inf_direct_bridge',
            outcome_type: 'diagnosis_confirmed',
            outcome_payload: {
                ground_truth: 'Retinal disease',
            },
            outcome_timestamp: new Date().toISOString(),
            label_type: 'confirmed',
            created_at: new Date().toISOString(),
        }],
    });
    const bridgedInference = directOperationalRows.find((row) => row['event_id'] === 'evt_inference_inf_direct_bridge');
    const bridgedOutcome = directOperationalRows.find((row) => row['event_id'] === 'evt_outcome_out_direct_bridge');
    assert.equal((bridgedInference?.['metadata'] as Record<string, unknown>).routing_model_family, 'vision');
    assert.equal((bridgedInference?.['metrics'] as Record<string, unknown>).latency_ms, 321);
    assert.equal(bridgedOutcome?.['linked_event_id'], 'evt_inference_inf_direct_bridge');
    assert.equal((bridgedOutcome?.['metrics'] as Record<string, unknown>).correct, true);

    const driftReady = computeTopologyDriftSignal([
        { prediction: 'Parvovirus', ground_truth: 'Parvovirus' },
        { prediction: 'Pancreatitis', ground_truth: 'Parvovirus' },
        { prediction: 'Otitis externa', ground_truth: 'Otitis externa' },
    ]);
    assert.equal(driftReady.drift_state, 'READY');
    assert.ok(driftReady.drift_score != null && driftReady.drift_score > 0);

    const driftInsufficient = computeTopologyDriftSignal([
        { prediction: 'Parvovirus', ground_truth: 'Parvovirus' },
        { prediction: 'Pancreatitis', ground_truth: 'Pancreatitis' },
    ]);
    assert.equal(driftInsufficient.drift_state, 'INSUFFICIENT_DATA');
    assert.equal(driftInsufficient.drift_score, null);

    const thinSampleErrorRate = calculateInferenceErrorRateForTest(
        [
            {
                ...inferenceTelemetry,
                metrics: {
                    latency_ms: 6_200,
                    confidence: 0.51,
                    prediction: 'Parvovirus',
                    ground_truth: null,
                    correct: null,
                },
            },
            {
                ...inferenceTelemetry,
                event_id: telemetryInferenceEventId(randomUUID()),
                metrics: {
                    latency_ms: 6_400,
                    confidence: 0.48,
                    prediction: 'Pancreatitis',
                    ground_truth: null,
                    correct: null,
                },
            },
        ],
        [],
    );
    assert.equal(thinSampleErrorRate, null, 'thin anomaly samples should not trigger topology error-rate alarms');

    const thinSimulationErrorRate = calculateSimulationErrorRateForTest([
        { failure_mode: 'adversarial_attack' },
    ]);
    assert.equal(thinSimulationErrorRate, null, 'single simulation failures should not trigger simulation error-rate alarms');

    const sustainedSimulationErrorRate = calculateSimulationErrorRateForTest([
        { failure_mode: 'adversarial_attack' },
        { failure_mode: 'latency_spike' },
        { failure_mode: null },
    ]);
    assert.equal(sustainedSimulationErrorRate, 0.6667);

    const noTelemetryState = classifyTopologyControlPlaneState({
        now: new Date().toISOString(),
        telemetry_event_timestamps: [],
        evaluation_event_count: 0,
        evaluation_events_table_exists: true,
    });
    assert.equal(noTelemetryState.control_plane_state, 'NO_TELEMETRY_EVENTS');

    const heartbeatOnlyState = classifyTopologyControlPlaneState({
        now: new Date().toISOString(),
        telemetry_event_timestamps: [],
        latest_telemetry_timestamp: new Date(Date.now() - 2_000).toISOString(),
        evaluation_event_count: 0,
        evaluation_events_table_exists: true,
    });
    assert.equal(heartbeatOnlyState.control_plane_state, 'CONTROL_PLANE_INITIALIZING');

    const idleButOperationalState = classifyTopologyControlPlaneState({
        now: new Date().toISOString(),
        telemetry_event_timestamps: [],
        latest_telemetry_timestamp: new Date(Date.now() - 2_000).toISOString(),
        latest_inference_timestamp: new Date(Date.now() - (45 * 60 * 1000)).toISOString(),
        latest_outcome_timestamp: new Date(Date.now() - (43 * 60 * 1000)).toISOString(),
        latest_evaluation_timestamp: new Date(Date.now() - (42 * 60 * 1000)).toISOString(),
        evaluation_event_count: 3,
        evaluation_events_table_exists: true,
    });
    assert.equal(idleButOperationalState.control_plane_state, 'READY');

    const readyState = classifyTopologyControlPlaneState({
        now: new Date().toISOString(),
        telemetry_event_timestamps: [
            new Date(Date.now() - 2_000).toISOString(),
        ],
        evaluation_event_count: 3,
        evaluation_events_table_exists: true,
        latest_outcome_timestamp: new Date(Date.now() - 2_500).toISOString(),
        latest_inference_timestamp: new Date(Date.now() - 5_000).toISOString(),
        latest_evaluation_timestamp: new Date(Date.now() - 1_000).toISOString(),
        latest_simulation_timestamp: new Date(Date.now() - 1_500).toISOString(),
    });
    assert.equal(readyState.control_plane_state, 'READY');

    const graceWindowState = classifyTopologyControlPlaneState({
        now: new Date().toISOString(),
        telemetry_event_timestamps: [
            new Date(Date.now() - 45_000).toISOString(),
        ],
        evaluation_event_count: 3,
        evaluation_events_table_exists: true,
        latest_outcome_timestamp: new Date(Date.now() - 30_000).toISOString(),
        latest_inference_timestamp: new Date(Date.now() - 45_000).toISOString(),
        latest_evaluation_timestamp: new Date(Date.now() - 25_000).toISOString(),
    });
    assert.notEqual(graceWindowState.control_plane_state, 'STREAM_DISCONNECTED', 'fresh heartbeat grace should not trip stream disconnects');

    const criticalNodes: TopologyNodeSnapshot[] = [
        makeNode('telemetry_observer', 'Telemetry Observer', {
            status: 'critical',
            latency: 2_300,
            throughput: 20,
            error_rate: 0.18,
            drift_score: 0.31,
            confidence_avg: 0.41,
        }),
        makeNode('diagnostics_model', 'Diagnostics Inference', {
            status: 'degraded',
            latency: 980,
            throughput: 14,
            error_rate: 0.09,
            drift_score: 0.22,
            confidence_avg: 0.64,
        }),
    ];

    const alerts = buildTopologyAlertsForTest({
        nodes: criticalNodes,
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.ok(alerts.some((alert) => alert.category === 'latency' && alert.node_id === 'telemetry_observer'));
    assert.ok(alerts.some((alert) => alert.category === 'drift'));

    const idleFamilyAlerts = buildTopologyAlertsForTest({
        nodes: [
            {
                ...makeNode('vision_model', 'Vision Inference', {
                    status: 'offline',
                    latency: null,
                    throughput: 0,
                    error_rate: null,
                    drift_score: null,
                    confidence_avg: null,
                }),
                metadata: {
                    observability_state: 'NO_DATA',
                },
            },
        ],
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(
        idleFamilyAlerts.some((alert) => alert.node_id === 'vision_model' && alert.category === 'heartbeat'),
        false,
        'idle model families should not raise heartbeat offline alerts',
    );

    const unroutedFamilyAlerts = buildTopologyAlertsForTest({
        nodes: [
            {
                ...makeNode('vision_model', 'Vision Inference', {
                    status: 'healthy',
                    latency: null,
                    throughput: 0,
                    error_rate: null,
                    drift_score: null,
                    confidence_avg: null,
                }),
                metadata: {
                    observability_state: 'UNROUTED',
                },
            },
        ],
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(
        unroutedFamilyAlerts.some((alert) => alert.node_id === 'vision_model' && alert.category === 'heartbeat'),
        false,
        'unrouted model families should not page as heartbeat outages',
    );

    const datasetHeartbeatAlerts = buildTopologyAlertsForTest({
        nodes: [
            {
                ...makeNode('dataset_hub', 'Clinical Data Hub', {
                    status: 'offline',
                    latency: null,
                    throughput: 0,
                    error_rate: null,
                    drift_score: null,
                    confidence_avg: null,
                }),
                kind: 'data',
            },
        ],
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(
        datasetHeartbeatAlerts.some((alert) => alert.node_id === 'dataset_hub' && alert.category === 'heartbeat'),
        false,
        'dataset hub should not raise heartbeat offline alerts',
    );

    const outcomeNoDataAlerts = buildTopologyAlertsForTest({
        nodes: [
            {
                ...makeNode('outcome_feedback', 'Outcome Feedback', {
                    status: 'healthy',
                    latency: null,
                    throughput: 0,
                    error_rate: null,
                    drift_score: null,
                    confidence_avg: null,
                }),
                kind: 'outcome',
                metadata: {
                    observability_state: 'NO_DATA',
                    raw_outcomes: 0,
                },
            },
        ],
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(
        outcomeNoDataAlerts.some((alert) => alert.node_id === 'outcome_feedback' && alert.category === 'heartbeat'),
        false,
        'outcome feedback should not page as offline before any outcomes exist',
    );

    const staleOutcomeDriftAlerts = buildTopologyAlertsForTest({
        nodes: [],
        now: new Date().toISOString(),
        diagnostics: {
            ...readyState,
            control_plane_state: 'INSUFFICIENT_OUTCOMES_FOR_DRIFT',
            latest_outcome_timestamp: new Date(Date.now() - 90_000).toISOString(),
            latest_evaluation_timestamp: new Date(Date.now() - 90_000).toISOString(),
        },
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(
        staleOutcomeDriftAlerts.some((alert) => alert.id === 'alert_insufficient_outcomes_for_drift'),
        false,
        'stale outcome windows should not raise insufficient-drift alerts',
    );

    const staleSimulationAlerts = buildTopologyAlertsForTest({
        nodes: [
            {
                ...makeNode('simulation_cluster', 'Adversarial Simulation', {
                    status: 'critical',
                    latency: 2_600,
                    throughput: 1,
                    error_rate: 0.34,
                    drift_score: 0.41,
                    confidence_avg: 0.31,
                }),
                kind: 'simulation',
                state: {
                    ...makeNode('simulation_cluster', 'Adversarial Simulation', {}).state,
                    status: 'critical',
                    latency: 2_600,
                    throughput: 1,
                    error_rate: 0.34,
                    drift_score: 0.41,
                    confidence_avg: 0.31,
                    last_updated: new Date(Date.now() - 90_000).toISOString(),
                },
            },
        ],
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(staleSimulationAlerts.length, 0, 'stale simulation alerts should auto-expire');

    const dedupedErrorAlerts = buildTopologyAlertsForTest({
        nodes: [
            makeNode('diagnostics_model', 'Diagnostics Inference', {
                status: 'critical',
                latency: 420,
                throughput: 12,
                error_rate: 0.21,
                drift_score: null,
                confidence_avg: 0.61,
            }),
            {
                ...makeNode('decision_fabric', 'Decision Fabric', {
                    status: 'critical',
                    latency: 430,
                    throughput: 12,
                    error_rate: 0.21,
                    drift_score: null,
                    confidence_avg: 0.61,
                }),
                kind: 'decision',
            },
            {
                ...makeNode('control_plane', 'VetIOS Control Plane', {
                    status: 'critical',
                    latency: 440,
                    throughput: 12,
                    error_rate: 0.21,
                    drift_score: null,
                    confidence_avg: 0.61,
                }),
                kind: 'control',
            },
        ],
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(
        dedupedErrorAlerts.filter((alert) => alert.category === 'error_rate').map((alert) => alert.node_id).join(','),
        'diagnostics_model',
        'aggregate nodes should not duplicate upstream error-rate alerts',
    );

    const registryOperationalAlerts = buildTopologyAlertsForTest({
        nodes: [
            {
                ...makeNode('registry_control', 'Registry Governance', {
                    status: 'degraded',
                    latency: 140,
                    throughput: 2,
                    error_rate: 0.4,
                    drift_score: 0.4,
                    confidence_avg: 0.88,
                }),
                kind: 'registry',
            },
        ],
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(
        registryOperationalAlerts.some((alert) => alert.node_id === 'registry_control' && (alert.category === 'error_rate' || alert.category === 'drift')),
        false,
        'registry governance should surface governance issues instead of runtime drift/error spikes',
    );

    const telemetryOperationalAlerts = buildTopologyAlertsForTest({
        nodes: [
            {
                ...makeNode('telemetry_observer', 'Telemetry Observer', {
                    status: 'critical',
                    latency: null,
                    throughput: 18,
                    error_rate: 0.34,
                    drift_score: 0.41,
                    confidence_avg: 0.42,
                }),
                kind: 'telemetry',
            },
        ],
        now: new Date().toISOString(),
        diagnostics: readyState,
        telemetry_event_timestamps: [new Date(Date.now() - 2_000).toISOString()],
    });
    assert.equal(
        telemetryOperationalAlerts.some((alert) => alert.node_id === 'telemetry_observer' && (alert.category === 'error_rate' || alert.category === 'drift')),
        false,
        'telemetry observer should surface stream health issues instead of downstream model error/drift spikes',
    );

    const networkHealth = computeTopologyNetworkHealth(criticalNodes, readyState);
    assert.ok(networkHealth < 70, `expected stressed network health, got ${networkHealth}`);

    console.log('topology control plane tests passed');
}

function makeNode(
    id: TopologyNodeSnapshot['id'],
    label: string,
    state: Partial<TopologyNodeSnapshot['state']>,
): TopologyNodeSnapshot {
    return {
        id,
        label,
        kind: id === 'telemetry_observer' ? 'telemetry' : 'model',
        position: { x: 0, y: 0 },
        state: {
            status: state.status ?? 'healthy',
            latency: state.latency ?? null,
            throughput: state.throughput ?? null,
            error_rate: state.error_rate ?? null,
            drift_score: state.drift_score ?? null,
            confidence_avg: state.confidence_avg ?? null,
            last_updated: new Date().toISOString(),
        },
        governance: null,
        alert_count: 0,
        propagated_risk: false,
        impact_sources: [],
        connected_node_ids: [],
        recent_errors: [],
        recommendations: [],
        metadata: {},
    };
}

void main();
