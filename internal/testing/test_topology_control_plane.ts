import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvaluationEvent } from '../../apps/web/lib/evaluation/evaluationEngine.ts';
import {
    buildTopologyAlertsForTest,
    classifyTopologyControlPlaneState,
    computeTopologyDriftSignal,
    computeTopologyNetworkHealth,
} from '../../apps/web/lib/intelligence/topologyService.ts';
import type { TopologyNodeSnapshot } from '../../apps/web/lib/intelligence/types.ts';
import {
    emitTelemetryEvent,
    telemetryEvaluationEventId,
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

    constructor(
        private readonly tables: Map<string, Record<string, unknown>[]>,
        private readonly table: string,
    ) {}

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
            diagnosis: 'Parvovirus',
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

    await emitTelemetryEvent(client as any, {
        event_id: telemetryEvaluationEventId(evaluation.evaluation_event_id),
        tenant_id: tenantId,
        linked_event_id: 'evt_inference_test',
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

    const telemetryRows = client.tables.get('telemetry_events') ?? [];
    assert.equal(telemetryRows.length, 2, 'expected evaluation and simulation telemetry events');
    assert.equal(telemetryRows[0]?.event_type, 'evaluation');
    assert.equal(telemetryRows[1]?.event_type, 'simulation');

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

    const noTelemetryState = classifyTopologyControlPlaneState({
        now: new Date().toISOString(),
        telemetry_event_timestamps: [],
        evaluation_event_count: 0,
        evaluation_events_table_exists: true,
    });
    assert.equal(noTelemetryState.control_plane_state, 'NO_TELEMETRY_EVENTS');

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
