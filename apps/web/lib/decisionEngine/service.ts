import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    CONTROL_PLANE_ACTION_LOG,
    CONTROL_PLANE_ALERTS,
    CONTROL_PLANE_CONFIGS,
    DECISION_AUDIT_LOG,
    DECISION_ENGINE,
    MODEL_EVALUATION_EVENTS,
    TOPOLOGY_NODE_STATES,
} from '@/lib/db/schemaContracts';
import { applyExperimentRegistryAction, getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import type {
    ModelFamily,
    ModelRegistryControlPlaneSnapshot,
    ModelRegistryRecord,
    RegistryRoutingPointerRecord,
} from '@/lib/experiments/types';
import { getTopologySnapshot } from '@/lib/intelligence/topologyService';
import type { TopologyAlertSeverity, TopologyNodeSnapshot, TopologySnapshot } from '@/lib/intelligence/types';
import { logSimulation } from '@/lib/logging/simulationLogger';
import { emitTelemetryEvent, telemetrySimulationEventId } from '@/lib/telemetry/service';
import type {
    DecisionActionKind,
    DecisionActionPlan,
    DecisionAuditLogRecord,
    DecisionAuditResult,
    DecisionEngineCandidate,
    DecisionEngineConfiguration,
    DecisionEngineMode,
    DecisionEngineRecord,
    DecisionEngineSnapshot,
    DecisionExecutionStatus,
    DecisionTriggerEvent,
} from '@/lib/decisionEngine/types';

const DEFAULT_DECISION_CONFIG: DecisionEngineConfiguration = {
    latency_threshold_ms: 900,
    drift_threshold: 0.2,
    confidence_threshold: 0.65,
    mode: 'observe',
    safe_mode_enabled: false,
    abstain_threshold: 0.8,
    auto_execute_confidence_threshold: 0.9,
};

const SYSTEM_ACTOR = 'system';
const DECISION_LIMIT = 40;
const AUDIT_LIMIT = 80;
const DECISION_COOLDOWN_MS = 10 * 60 * 1000;
const FEEDBACK_WINDOW_MS = 20 * 60 * 1000;
const CRITICAL_DRIFT_AUTO_THRESHOLD = 0.5;
const CRITICAL_RECALL_AUTO_ROLLBACK_THRESHOLD = 0.7;
const ACCURACY_DROP_THRESHOLD = 0.78;
const SAFE_MODE_ABSTAIN_FLOOR = 0.85;

const FAMILY_TO_NODE: Record<ModelFamily, string> = {
    diagnostics: 'diagnostics_model',
    vision: 'vision_model',
    therapeutics: 'therapeutics_model',
};

type EvaluationMetricRow = {
    model_version: string | null;
    prediction_correct: boolean | null;
};

type DecisionActionExecution = {
    kind: DecisionActionKind;
    success: boolean;
    message: string;
    metadata?: Record<string, unknown>;
};

export async function evaluateDecisionEngine(input: {
    client: SupabaseClient;
    tenantId: string;
    topologySnapshot?: TopologySnapshot;
    registrySnapshot?: ModelRegistryControlPlaneSnapshot;
    triggerSource?: string;
}): Promise<DecisionEngineSnapshot> {
    const now = new Date().toISOString();
    const store = createSupabaseExperimentTrackingStore(input.client);
    const [config, topologySnapshot, registrySnapshot, evaluationRows, existingDecisions] = await Promise.all([
        getDecisionEngineConfiguration(input.client, input.tenantId),
        input.topologySnapshot ?? getTopologySnapshot(input.client, input.tenantId, { window: '24h' }),
        input.registrySnapshot ?? getModelRegistryControlPlaneSnapshot(store, input.tenantId),
        loadEvaluationMetrics(input.client, input.tenantId),
        listDecisionEngineRecords(input.client, input.tenantId),
    ]);

    await syncTopologyNodeStates(input.client, input.tenantId, topologySnapshot.nodes);
    const candidates = buildDecisionCandidates({
        topologySnapshot,
        registrySnapshot,
        config,
        evaluationRows,
    });

    for (const candidate of candidates) {
        const existing = existingDecisions.find((entry) => entry.decision_key === candidate.decision_key) ?? null;
        const record = await upsertDecisionRecord({
            client: input.client,
            tenantId: input.tenantId,
            config,
            candidate,
            now,
            existing,
            triggerSource: input.triggerSource ?? null,
        });

        await maybeExecuteDecision({
            client: input.client,
            tenantId: input.tenantId,
            config,
            candidate,
            record,
            existing,
            store,
            registrySnapshot,
            topologySnapshot,
        });
    }

    await reconcileDecisionFeedback({
        client: input.client,
        tenantId: input.tenantId,
        topologySnapshot,
        now,
    });

    const [decisions, auditLog] = await Promise.all([
        listDecisionEngineRecords(input.client, input.tenantId),
        listDecisionAuditLog(input.client, input.tenantId),
    ]);

    return buildDecisionEngineSnapshot(config, topologySnapshot, decisions, auditLog, now);
}

export async function getDecisionEngineConfiguration(
    client: SupabaseClient,
    tenantId: string,
): Promise<DecisionEngineConfiguration> {
    const C = CONTROL_PLANE_CONFIGS.COLUMNS;
    try {
        const { data, error } = await client
            .from(CONTROL_PLANE_CONFIGS.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .maybeSingle();

        if (error) throw error;
        if (!data) return DEFAULT_DECISION_CONFIG;

        return {
            latency_threshold_ms: numberOrNull((data as Record<string, unknown>)[C.latency_threshold_ms]) ?? DEFAULT_DECISION_CONFIG.latency_threshold_ms,
            drift_threshold: numberOrNull((data as Record<string, unknown>)[C.drift_threshold]) ?? DEFAULT_DECISION_CONFIG.drift_threshold,
            confidence_threshold: numberOrNull((data as Record<string, unknown>)[C.confidence_threshold]) ?? DEFAULT_DECISION_CONFIG.confidence_threshold,
            mode: readDecisionMode((data as Record<string, unknown>)[C.decision_mode]),
            safe_mode_enabled: booleanOrFalse((data as Record<string, unknown>)[C.safe_mode_enabled]),
            abstain_threshold: clampNumber(numberOrNull((data as Record<string, unknown>)[C.abstain_threshold]) ?? DEFAULT_DECISION_CONFIG.abstain_threshold, 0, 1),
            auto_execute_confidence_threshold: clampNumber(
                numberOrNull((data as Record<string, unknown>)[C.auto_execute_confidence_threshold]) ?? DEFAULT_DECISION_CONFIG.auto_execute_confidence_threshold,
                0,
                1,
            ),
        };
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_CONFIGS.TABLE)) {
            return DEFAULT_DECISION_CONFIG;
        }
        throw error;
    }
}

export async function listDecisionEngineRecords(
    client: SupabaseClient,
    tenantId: string,
): Promise<DecisionEngineRecord[]> {
    const C = DECISION_ENGINE.COLUMNS;
    try {
        const { data, error } = await client
            .from(DECISION_ENGINE.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .order(C.timestamp, { ascending: false })
            .limit(DECISION_LIMIT);

        if (error) throw error;
        return (data ?? []).map((row) => mapDecisionRecord(row as Record<string, unknown>));
    } catch (error) {
        if (isMissingRelationError(error, DECISION_ENGINE.TABLE)) return [];
        throw error;
    }
}

export async function listDecisionAuditLog(
    client: SupabaseClient,
    tenantId: string,
): Promise<DecisionAuditLogRecord[]> {
    const C = DECISION_AUDIT_LOG.COLUMNS;
    try {
        const { data, error } = await client
            .from(DECISION_AUDIT_LOG.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .order(C.executed_at, { ascending: false })
            .limit(AUDIT_LIMIT);

        if (error) throw error;
        return (data ?? []).map((row) => mapDecisionAuditRecord(row as Record<string, unknown>));
    } catch (error) {
        if (isMissingRelationError(error, DECISION_AUDIT_LOG.TABLE)) return [];
        throw error;
    }
}

export async function syncTopologyNodeStates(
    client: SupabaseClient,
    tenantId: string,
    nodes: TopologyNodeSnapshot[],
): Promise<void> {
    const C = TOPOLOGY_NODE_STATES.COLUMNS;
    try {
        if (nodes.length === 0) return;
        const rows = nodes.map((node) => ({
            [C.tenant_id]: tenantId,
            [C.node_id]: node.id,
            [C.node_type]: mapTopologyNodeType(node),
            [C.status]: node.state.status,
            [C.latency]: node.state.latency,
            [C.throughput]: node.state.throughput,
            [C.error_rate]: node.state.error_rate,
            [C.drift_score]: node.state.drift_score,
            [C.confidence_avg]: node.state.confidence_avg,
            [C.last_updated]: node.state.last_updated,
            [C.metadata]: {
                governance: node.governance,
                alert_count: node.alert_count,
                propagated_risk: node.propagated_risk,
                impact_sources: node.impact_sources,
                recommendations: node.recommendations,
            },
        }));

        const { error } = await client
            .from(TOPOLOGY_NODE_STATES.TABLE)
            .upsert(rows, {
                onConflict: `${C.tenant_id},${C.node_id}`,
            });

        if (error) throw error;
    } catch (error) {
        if (isMissingRelationError(error, TOPOLOGY_NODE_STATES.TABLE)) return;
        throw error;
    }
}

export function buildDecisionCandidates(input: {
    topologySnapshot: TopologySnapshot;
    registrySnapshot: ModelRegistryControlPlaneSnapshot;
    config: DecisionEngineConfiguration;
    evaluationRows: EvaluationMetricRow[];
}): DecisionEngineCandidate[] {
    const candidates: DecisionEngineCandidate[] = [];
    const accuracyByFamily = buildAccuracyByFamily(input.registrySnapshot, input.evaluationRows);

    if (input.topologySnapshot.control_plane_state === 'STREAM_DISCONNECTED'
        || input.topologySnapshot.control_plane_state === 'NO_TELEMETRY_EVENTS') {
        candidates.push({
            decision_key: 'system_disconnected:control_plane',
            trigger_event: 'system_disconnected',
            condition: `control_plane_state=${input.topologySnapshot.control_plane_state}`,
            actions: [
                { kind: 'restart_pipeline', label: 'restart_pipeline()' },
                { kind: 'enable_safe_mode', label: 'enable_safe_mode()' },
                { kind: 'raise_alert', label: 'raise_alert()' },
            ],
            confidence: 0.98,
            source_node_id: 'control_plane',
            source_node_type: 'master',
            model_family: null,
            registry_id: null,
            run_id: null,
            requires_approval: false,
            severity: 'critical',
            node_status: 'critical',
            metadata: {
                topology_state: input.topologySnapshot.control_plane_state,
            },
        });
    }

    for (const family of input.registrySnapshot.families) {
        const nodeId = FAMILY_TO_NODE[family.model_family];
        const node = input.topologySnapshot.nodes.find((entry) => entry.id === nodeId);
        if (!node) continue;

        const accuracy = accuracyByFamily.get(family.model_family) ?? null;
        const active = family.active_model;
        const lastStable = family.last_stable_model;
        const fallbackReady = active != null && lastStable != null && lastStable.run_id !== active.run_id;
        const criticalRecall = active?.clinical_metrics.critical_recall ?? null;

        if (node.state.drift_score != null && node.state.drift_score > input.config.drift_threshold) {
            candidates.push(buildDriftCandidate(node, family, input.config, fallbackReady, criticalRecall));
        }

        if (node.state.latency != null && node.state.latency > input.config.latency_threshold_ms) {
            candidates.push(buildLatencyCandidate(node, family, input.config, fallbackReady));
        }

        if (node.state.confidence_avg != null && node.state.confidence_avg < input.config.abstain_threshold) {
            candidates.push(buildConfidenceCandidate(node, family, input.config));
        }

        if (accuracy != null && accuracy < ACCURACY_DROP_THRESHOLD) {
            candidates.push(buildAccuracyCandidate(node, family, accuracy, fallbackReady, input.registrySnapshot, input.evaluationRows));
        }
    }

    return dedupeCandidates(candidates);
}

export function applyDecisionEngineToTopologySnapshot(
    snapshot: TopologySnapshot,
    decisionSnapshot: DecisionEngineSnapshot,
): TopologySnapshot {
    const topDecision = decisionSnapshot.decisions[0] ?? null;
    if (!topDecision) return snapshot;

    const candidateSeverity: TopologyAlertSeverity = topDecision.metadata.severity === 'critical' ? 'critical' : 'warning';
    const decisionSeverity: TopologyAlertSeverity = topDecision.status === 'executed' ? 'info' : candidateSeverity;
    const decisionAlert = {
        id: `decision_${topDecision.decision_id}`,
        node_id: topDecision.source_node_id ?? 'decision_fabric',
        severity: decisionSeverity,
        category: 'decision' as const,
        title: `Decision Engine ${topDecision.trigger_event}`,
        message: topDecision.status === 'executed'
            ? `Executed ${topDecision.action}`
            : topDecision.blocked_reason ?? topDecision.action,
        timestamp: topDecision.timestamp,
    };

    return {
        ...snapshot,
        summary: {
            where_failing: topDecision.source_node_id ?? snapshot.summary.where_failing,
            root_cause: topDecision.trigger_event,
            impact: buildDecisionImpact(topDecision, snapshot),
            next_action: topDecision.status === 'executed'
                ? `Executed ${topDecision.action}`
                : topDecision.blocked_reason ?? topDecision.action,
        },
        alerts: [decisionAlert, ...snapshot.alerts].slice(0, 24),
        nodes: snapshot.nodes.map((node) => patchTopologyNodeWithDecision(node, topDecision, decisionSnapshot)),
        diagnostics: {
            ...snapshot.diagnostics,
            active_alert_count: snapshot.diagnostics.active_alert_count + 1,
        },
    };
}

export function buildDecisionEngineSnapshot(
    config: DecisionEngineConfiguration,
    topologySnapshot: TopologySnapshot,
    decisions: DecisionEngineRecord[],
    auditLog: DecisionAuditLogRecord[],
    now: string,
): DecisionEngineSnapshot {
    const latest = decisions[0] ?? null;
    return {
        mode: config.mode,
        safe_mode_enabled: config.safe_mode_enabled,
        abstain_threshold: config.abstain_threshold,
        auto_execute_confidence_threshold: config.auto_execute_confidence_threshold,
        last_evaluated_at: now,
        active_decision_count: decisions.filter((decision) => decision.status !== 'executed').length,
        latest_trigger: latest?.trigger_event ?? null,
        latest_action: latest?.action ?? null,
        decisions,
        audit_log: auditLog,
        summary: {
            where_failing: latest?.source_node_id ?? topologySnapshot.summary.where_failing,
            root_cause: latest?.trigger_event ?? topologySnapshot.summary.root_cause,
            impact: buildDecisionImpact(latest, topologySnapshot),
            next_action: latest
                ? latest.status === 'executed'
                    ? `Executed ${latest.action}`
                    : latest.blocked_reason ?? latest.action
                : topologySnapshot.summary.next_action,
        },
    };
}

async function maybeExecuteDecision(input: {
    client: SupabaseClient;
    tenantId: string;
    config: DecisionEngineConfiguration;
    candidate: DecisionEngineCandidate;
    record: DecisionEngineRecord;
    existing: DecisionEngineRecord | null;
    store: ReturnType<typeof createSupabaseExperimentTrackingStore>;
    registrySnapshot: ModelRegistryControlPlaneSnapshot;
    topologySnapshot: TopologySnapshot;
}): Promise<DecisionEngineRecord> {
    const execution = resolveExecutionPolicy(input.config, input.candidate, input.existing);
    if (!execution.shouldExecute) {
        return await updateDecisionStatus(input.client, input.record, execution.status, execution.reason);
    }

    const results: DecisionActionExecution[] = [];
    for (const action of input.candidate.actions) {
        const outcome = await executeDecisionAction({
            client: input.client,
            tenantId: input.tenantId,
            store: input.store,
            config: input.config,
            record: input.record,
            candidate: input.candidate,
            action,
            registrySnapshot: input.registrySnapshot,
            topologySnapshot: input.topologySnapshot,
        });
        results.push(outcome);

        await recordDecisionAudit({
            client: input.client,
            decisionId: input.record.decision_id,
            tenantId: input.tenantId,
            trigger: input.candidate.trigger_event,
            action: action.label,
            result: outcome.success ? 'success' : 'failed',
            actor: 'system',
            metadata: {
                message: outcome.message,
                ...outcome.metadata,
            },
        });

        await recordControlPlaneAction({
            client: input.client,
            tenantId: input.tenantId,
            actionType: `decision_engine:${action.kind}`,
            status: outcome.success ? 'completed' : 'failed',
            targetType: input.candidate.source_node_type,
            targetId: input.candidate.source_node_id,
            metadata: {
                decision_id: input.record.decision_id,
                trigger_event: input.candidate.trigger_event,
                message: outcome.message,
                ...outcome.metadata,
            },
        });
    }

    const failed = results.find((result) => !result.success) ?? null;
    return await updateDecisionStatus(
        input.client,
        input.record,
        failed ? 'blocked' : 'executed',
        failed?.message ?? null,
        {
            execution_results: results,
            last_executed_at: new Date().toISOString(),
        },
    );
}

function resolveExecutionPolicy(
    config: DecisionEngineConfiguration,
    candidate: DecisionEngineCandidate,
    existing: DecisionEngineRecord | null,
): { shouldExecute: boolean; status: DecisionExecutionStatus; reason: string | null } {
    if (config.mode === 'observe') {
        return { shouldExecute: false, status: 'pending', reason: null };
    }

    if (config.mode === 'assist') {
        return {
            shouldExecute: false,
            status: 'blocked',
            reason: 'Assist mode requires operator approval before corrective actions execute.',
        };
    }

    if (existing?.status === 'executed' && existing.updated_at) {
        const ageMs = Date.now() - new Date(existing.updated_at).getTime();
        if (ageMs < DECISION_COOLDOWN_MS) {
            return { shouldExecute: false, status: 'executed', reason: null };
        }
    }

    if (candidate.requires_approval && candidate.confidence < config.auto_execute_confidence_threshold) {
        return {
            shouldExecute: false,
            status: 'blocked',
            reason: `Autonomous guardrail held action because confidence ${formatMetric(candidate.confidence)} is below ${formatMetric(config.auto_execute_confidence_threshold)}.`,
        };
    }

    return { shouldExecute: true, status: 'executed', reason: null };
}

async function executeDecisionAction(input: {
    client: SupabaseClient;
    tenantId: string;
    store: ReturnType<typeof createSupabaseExperimentTrackingStore>;
    config: DecisionEngineConfiguration;
    record: DecisionEngineRecord;
    candidate: DecisionEngineCandidate;
    action: DecisionActionPlan;
    registrySnapshot: ModelRegistryControlPlaneSnapshot;
    topologySnapshot: TopologySnapshot;
}): Promise<DecisionActionExecution> {
    try {
        switch (input.action.kind) {
            case 'mark_model_at_risk':
                return await markModelAtRisk(input);
            case 'switch_model':
                return await switchModel(input);
            case 'rollback_to_previous':
                return await rollbackToPrevious(input);
            case 'block_model_promotion':
                return await blockModelPromotion(input);
            case 'enable_safe_mode':
                return await enableSafeMode(input);
            case 'trigger_simulation':
                return await triggerSimulation(input);
            case 'restart_pipeline':
                return await restartPipeline(input);
            case 'raise_alert':
                return await raiseDecisionAlert(input);
            default:
                return {
                    kind: input.action.kind,
                    success: false,
                    message: `Unsupported action: ${input.action.kind}`,
                };
        }
    } catch (error) {
        return {
            kind: input.action.kind,
            success: false,
            message: error instanceof Error ? error.message : 'Unknown decision action failure',
        };
    }
}

async function markModelAtRisk(input: Parameters<typeof executeDecisionAction>[0]): Promise<DecisionActionExecution> {
    const target = findTargetRegistry(input.registrySnapshot, input.candidate);
    if (!target) {
        return { kind: 'mark_model_at_risk', success: false, message: 'No target registry record is available to mark at risk.' };
    }

    const updated = await input.store.upsertModelRegistry(buildRegistryPatch(target, {
        registry_role: 'at_risk',
        role: 'at_risk',
    }));
    await input.store.createRegistryAuditLog({
        event_id: `evt_registry_at_risk_${updated.registry_id}_${Date.now()}`,
        tenant_id: input.tenantId,
        registry_id: updated.registry_id,
        run_id: updated.run_id,
        event_type: 'at_risk_marked',
        timestamp: new Date().toISOString(),
        actor: SYSTEM_ACTOR,
        metadata: {
            decision_id: input.record.decision_id,
            trigger_event: input.candidate.trigger_event,
        },
    });

    await emitDecisionSystemEvent(input.client, input.tenantId, {
        decision_id: input.record.decision_id,
        target_node_id: input.candidate.source_node_id ?? FAMILY_TO_NODE[target.model_family],
        injected_status: 'critical',
        injected_drift_score: target.clinical_metrics.adversarial_degradation ?? numberOrNull(input.candidate.metadata.drift_score),
        injected_confidence_avg: target.clinical_metrics.global_accuracy,
        action: 'mark_model_at_risk',
    });

    return {
        kind: 'mark_model_at_risk',
        success: true,
        message: `Marked ${updated.model_version} as at_risk.`,
        metadata: {
            registry_id: updated.registry_id,
            run_id: updated.run_id,
        },
    };
}

async function blockModelPromotion(input: Parameters<typeof executeDecisionAction>[0]): Promise<DecisionActionExecution> {
    const target = findTargetRegistry(input.registrySnapshot, input.candidate);
    if (!target) {
        return { kind: 'block_model_promotion', success: false, message: 'No target registry record is available to block promotion.' };
    }

    const existingRequirements = await input.store.getPromotionRequirements(input.tenantId, target.run_id);
    const requirements = await input.store.upsertPromotionRequirements({
        id: existingRequirements?.id,
        tenant_id: input.tenantId,
        registry_id: target.registry_id,
        run_id: target.run_id,
        calibration_pass: existingRequirements?.calibration_pass ?? null,
        adversarial_pass: existingRequirements?.adversarial_pass ?? null,
        safety_pass: existingRequirements?.safety_pass ?? null,
        benchmark_pass: existingRequirements?.benchmark_pass ?? null,
        manual_approval: false,
    });

    const existingDecision = await input.store.getDeploymentDecision(input.tenantId, target.run_id);
    await input.store.upsertDeploymentDecision({
        id: existingDecision?.id,
        tenant_id: input.tenantId,
        run_id: target.run_id,
        decision: existingDecision?.decision ?? 'pending',
        reason: `Blocked by self-healing decision engine: ${input.candidate.trigger_event}`,
        calibration_pass: existingDecision?.calibration_pass ?? requirements.calibration_pass,
        adversarial_pass: existingDecision?.adversarial_pass ?? requirements.adversarial_pass,
        safety_pass: existingDecision?.safety_pass ?? requirements.safety_pass,
        benchmark_pass: existingDecision?.benchmark_pass ?? requirements.benchmark_pass,
        manual_approval: false,
        approved_by: SYSTEM_ACTOR,
        timestamp: new Date().toISOString(),
    });

    return {
        kind: 'block_model_promotion',
        success: true,
        message: `Blocked promotion for ${target.model_version}.`,
        metadata: {
            registry_id: target.registry_id,
            run_id: target.run_id,
        },
    };
}

async function rollbackToPrevious(input: Parameters<typeof executeDecisionAction>[0]): Promise<DecisionActionExecution> {
    const target = findTargetRegistry(input.registrySnapshot, input.candidate);
    if (!target) {
        return { kind: 'rollback_to_previous', success: false, message: 'No active registry record is available for rollback.' };
    }

    const updated = await applyExperimentRegistryAction(
        input.store,
        input.tenantId,
        target.run_id,
        'rollback',
        SYSTEM_ACTOR,
        {
            reason: `Self-healing rollback after ${input.candidate.trigger_event}.`,
            incidentId: input.record.decision_id,
        },
    );

    await emitDecisionSystemEvent(input.client, input.tenantId, {
        decision_id: input.record.decision_id,
        target_node_id: input.candidate.source_node_id ?? FAMILY_TO_NODE[target.model_family],
        injected_status: 'healthy',
        injected_latency_ms: updated.clinical_metrics.latency_p99,
        injected_confidence_avg: updated.clinical_metrics.global_accuracy,
        action: 'rollback_to_previous',
    });

    return {
        kind: 'rollback_to_previous',
        success: true,
        message: `Rolled back to ${updated.model_version}.`,
        metadata: {
            registry_id: updated.registry_id,
            run_id: updated.run_id,
        },
    };
}

async function switchModel(input: Parameters<typeof executeDecisionAction>[0]): Promise<DecisionActionExecution> {
    const fallback = findFallbackRegistry(input.registrySnapshot, input.candidate);
    const target = fallback ?? findTargetRegistry(input.registrySnapshot, input.candidate);
    if (!target || !input.candidate.model_family) {
        return { kind: 'switch_model', success: false, message: 'No fallback registry target is available for traffic switching.' };
    }

    const pointer = findRoutingPointer(input.registrySnapshot, input.candidate.model_family);
    const updatedPointer = await input.store.upsertRegistryRoutingPointer({
        id: pointer?.id,
        tenant_id: input.tenantId,
        model_family: input.candidate.model_family,
        active_registry_id: target.registry_id,
        active_run_id: target.run_id,
        updated_by: SYSTEM_ACTOR,
    });

    await input.store.createRegistryAuditLog({
        event_id: `evt_registry_switch_${updatedPointer.model_family}_${Date.now()}`,
        tenant_id: input.tenantId,
        registry_id: target.registry_id,
        run_id: target.run_id,
        event_type: 'routing_switched',
        timestamp: new Date().toISOString(),
        actor: SYSTEM_ACTOR,
        metadata: {
            decision_id: input.record.decision_id,
            trigger_event: input.candidate.trigger_event,
            active_registry_id: target.registry_id,
        },
    });

    await emitDecisionSystemEvent(input.client, input.tenantId, {
        decision_id: input.record.decision_id,
        target_node_id: input.candidate.source_node_id ?? FAMILY_TO_NODE[target.model_family],
        injected_status: 'degraded',
        injected_latency_ms: target.clinical_metrics.latency_p99,
        injected_confidence_avg: target.clinical_metrics.global_accuracy,
        action: 'switch_model',
    });

    return {
        kind: 'switch_model',
        success: true,
        message: `Switched route to ${target.model_version}.`,
        metadata: {
            registry_id: target.registry_id,
            run_id: target.run_id,
        },
    };
}

async function enableSafeMode(input: Parameters<typeof executeDecisionAction>[0]): Promise<DecisionActionExecution> {
    const C = CONTROL_PLANE_CONFIGS.COLUMNS;
    const nextAbstainThreshold = clampNumber(Math.max(input.config.abstain_threshold, SAFE_MODE_ABSTAIN_FLOOR), 0, 1);

    const { error } = await input.client
        .from(CONTROL_PLANE_CONFIGS.TABLE)
        .upsert({
            [C.tenant_id]: input.tenantId,
            [C.latency_threshold_ms]: input.config.latency_threshold_ms,
            [C.drift_threshold]: input.config.drift_threshold,
            [C.confidence_threshold]: input.config.confidence_threshold,
            [C.decision_mode]: input.config.mode,
            [C.safe_mode_enabled]: true,
            [C.abstain_threshold]: nextAbstainThreshold,
            [C.auto_execute_confidence_threshold]: input.config.auto_execute_confidence_threshold,
        }, {
            onConflict: C.tenant_id,
        });

    if (error && !isMissingRelationError(error, CONTROL_PLANE_CONFIGS.TABLE)) {
        throw error;
    }

    await emitDecisionSystemEvent(input.client, input.tenantId, {
        decision_id: input.record.decision_id,
        target_node_id: 'control_plane',
        injected_status: 'degraded',
        injected_confidence_avg: numberOrNull(input.candidate.metadata.avg_confidence),
        action: 'enable_safe_mode',
    });

    return {
        kind: 'enable_safe_mode',
        success: true,
        message: `Enabled safe mode with abstain threshold ${formatMetric(nextAbstainThreshold)}.`,
        metadata: {
            abstain_threshold: nextAbstainThreshold,
        },
    };
}

async function restartPipeline(input: Parameters<typeof executeDecisionAction>[0]): Promise<DecisionActionExecution> {
    await emitDecisionSystemEvent(input.client, input.tenantId, {
        decision_id: input.record.decision_id,
        target_node_id: input.candidate.source_node_id ?? 'telemetry_observer',
        injected_status: 'degraded',
        action: 'restart_pipeline',
    });

    return {
        kind: 'restart_pipeline',
        success: true,
        message: `Issued a restart signal for ${input.candidate.source_node_id ?? 'telemetry_observer'}.`,
    };
}

async function triggerSimulation(input: Parameters<typeof executeDecisionAction>[0]): Promise<DecisionActionExecution> {
    const targetRegistry = findTargetRegistry(input.registrySnapshot, input.candidate);
    const simulationEventId = randomUUID();
    const now = new Date().toISOString();
    const scenario = input.candidate.trigger_event === 'latency_degradation'
        ? 'failure'
        : input.candidate.trigger_event === 'model_drift_detected'
            ? 'drift'
            : 'adversarial_attack';

    await logSimulation(input.client, {
        id: simulationEventId,
        tenant_id: input.tenantId,
        user_id: SYSTEM_ACTOR,
        clinic_id: null,
        case_id: null,
        source_module: 'decision_engine',
        simulation_type: `decision_${scenario}`,
        simulation_parameters: {
            decision_id: input.record.decision_id,
            target_node_id: input.candidate.source_node_id,
            trigger_event: input.candidate.trigger_event,
        },
        triggered_inference_id: null,
        failure_mode: scenario,
        stress_metrics: {
            decision_id: input.record.decision_id,
            trigger_event: input.candidate.trigger_event,
        },
        is_real_world: false,
    });

    await emitTelemetryEvent(input.client, {
        event_id: telemetrySimulationEventId(simulationEventId),
        tenant_id: input.tenantId,
        linked_event_id: null,
        source_id: simulationEventId,
        source_table: 'edge_simulation_events',
        event_type: 'simulation',
        timestamp: now,
        model_version: targetRegistry?.model_version ?? 'decision-engine',
        run_id: targetRegistry?.run_id ?? 'decision-engine',
        metrics: {
            latency_ms: numberOrNull(input.candidate.metadata.p95_latency),
            confidence: numberOrNull(input.candidate.metadata.avg_confidence),
            prediction: input.candidate.source_node_id,
        },
        metadata: {
            source_module: 'decision_engine',
            decision_id: input.record.decision_id,
            target_node_id: input.candidate.source_node_id,
            scenario,
            synthetic: true,
            injected_status: input.candidate.severity === 'critical' ? 'critical' : 'degraded',
            injected_latency_ms: numberOrNull(input.candidate.metadata.p95_latency),
            injected_error_rate: numberOrNull(input.candidate.metadata.error_rate),
            injected_drift_score: numberOrNull(input.candidate.metadata.drift_score),
            injected_confidence_avg: numberOrNull(input.candidate.metadata.avg_confidence),
        },
    });

    return {
        kind: 'trigger_simulation',
        success: true,
        message: `Triggered ${scenario} simulation for ${input.candidate.source_node_id ?? 'control_plane'}.`,
        metadata: {
            simulation_event_id: simulationEventId,
        },
    };
}

async function raiseDecisionAlert(input: Parameters<typeof executeDecisionAction>[0]): Promise<DecisionActionExecution> {
    const C = CONTROL_PLANE_ALERTS.COLUMNS;
    const now = new Date().toISOString();
    const { error } = await input.client
        .from(CONTROL_PLANE_ALERTS.TABLE)
        .upsert({
            [C.alert_key]: `decision_${input.record.decision_id}`,
            [C.tenant_id]: input.tenantId,
            [C.severity]: input.candidate.severity,
            [C.title]: `Decision Engine ${input.candidate.trigger_event}`,
            [C.message]: `${input.candidate.condition} -> ${input.candidate.actions.map((action) => action.label).join(', ')}`,
            [C.node_id]: input.candidate.source_node_id,
            [C.resolved]: false,
            [C.resolved_at]: null,
            [C.metadata]: {
                category: 'decision',
                timestamp: now,
                decision_id: input.record.decision_id,
                trigger_event: input.candidate.trigger_event,
                mode: input.config.mode,
            },
        }, {
            onConflict: `${C.tenant_id},${C.alert_key}`,
        });

    if (error && !isMissingRelationError(error, CONTROL_PLANE_ALERTS.TABLE)) {
        throw error;
    }

    return {
        kind: 'raise_alert',
        success: true,
        message: `Raised decision alert for ${input.candidate.trigger_event}.`,
    };
}

async function emitDecisionSystemEvent(
    client: SupabaseClient,
    tenantId: string,
    metadata: {
        decision_id: string;
        target_node_id: string;
        injected_status?: string | null;
        injected_latency_ms?: number | null;
        injected_error_rate?: number | null;
        injected_drift_score?: number | null;
        injected_confidence_avg?: number | null;
        action: string;
    },
) {
    const timestamp = new Date().toISOString();
    await emitTelemetryEvent(client, {
        event_id: `evt_decision_${metadata.action}_${metadata.decision_id}_${Date.now()}`,
        tenant_id: tenantId,
        event_type: 'system',
        timestamp,
        model_version: 'decision-engine',
        run_id: 'decision-engine',
        metrics: {},
        system: {},
        metadata: {
            source_module: 'decision_engine',
            decision_id: metadata.decision_id,
            target_node_id: metadata.target_node_id,
            injected_status: metadata.injected_status ?? null,
            injected_latency_ms: metadata.injected_latency_ms ?? null,
            injected_error_rate: metadata.injected_error_rate ?? null,
            injected_drift_score: metadata.injected_drift_score ?? null,
            injected_confidence_avg: metadata.injected_confidence_avg ?? null,
            action: metadata.action,
        },
    });
}

async function upsertDecisionRecord(input: {
    client: SupabaseClient;
    tenantId: string;
    config: DecisionEngineConfiguration;
    candidate: DecisionEngineCandidate;
    now: string;
    existing: DecisionEngineRecord | null;
    triggerSource: string | null;
}): Promise<DecisionEngineRecord> {
    const C = DECISION_ENGINE.COLUMNS;
    const payload = {
        [C.decision_id]: input.existing?.decision_id ?? randomUUID(),
        [C.tenant_id]: input.tenantId,
        [C.decision_key]: input.candidate.decision_key,
        [C.trigger_event]: input.candidate.trigger_event,
        [C.condition]: input.candidate.condition,
        [C.action]: input.candidate.actions.map((action) => action.label).join(' -> '),
        [C.confidence]: input.candidate.confidence,
        [C.mode]: input.config.mode,
        [C.source_node_id]: input.candidate.source_node_id,
        [C.source_node_type]: input.candidate.source_node_type,
        [C.model_family]: input.candidate.model_family,
        [C.registry_id]: input.candidate.registry_id,
        [C.run_id]: input.candidate.run_id,
        [C.timestamp]: input.now,
        [C.status]: input.existing?.status ?? 'pending',
        [C.requires_approval]: input.candidate.requires_approval,
        [C.blocked_reason]: null,
        [C.metadata]: {
            ...(input.existing?.metadata ?? {}),
            ...input.candidate.metadata,
            trigger_source: input.triggerSource,
            severity: input.candidate.severity,
            actions: input.candidate.actions,
            node_status: input.candidate.node_status,
        },
    };

    try {
        const { data, error } = await input.client
            .from(DECISION_ENGINE.TABLE)
            .upsert(payload, {
                onConflict: `${C.tenant_id},${C.decision_key}`,
            })
            .select('*')
            .single();

        if (error || !data) throw error ?? new Error('Failed to persist decision record');
        return mapDecisionRecord(data as Record<string, unknown>);
    } catch (error) {
        if (isMissingRelationError(error, DECISION_ENGINE.TABLE)) {
            return mapDecisionRecord({
                ...payload,
                created_at: input.existing?.created_at ?? input.now,
                updated_at: input.now,
            });
        }
        throw error;
    }
}

async function updateDecisionStatus(
    client: SupabaseClient,
    record: DecisionEngineRecord,
    status: DecisionExecutionStatus,
    blockedReason: string | null,
    metadataPatch?: Record<string, unknown>,
): Promise<DecisionEngineRecord> {
    const C = DECISION_ENGINE.COLUMNS;
    try {
        const { data, error } = await client
            .from(DECISION_ENGINE.TABLE)
            .update({
                [C.status]: status,
                [C.blocked_reason]: blockedReason,
                [C.metadata]: {
                    ...record.metadata,
                    ...(metadataPatch ?? {}),
                },
            })
            .eq(C.decision_id, record.decision_id)
            .select('*')
            .single();

        if (error || !data) throw error ?? new Error('Failed to update decision status');
        return mapDecisionRecord(data as Record<string, unknown>);
    } catch (error) {
        if (isMissingRelationError(error, DECISION_ENGINE.TABLE)) {
            return {
                ...record,
                status,
                blocked_reason: blockedReason,
                metadata: {
                    ...record.metadata,
                    ...(metadataPatch ?? {}),
                },
                updated_at: new Date().toISOString(),
            };
        }
        throw error;
    }
}

async function recordDecisionAudit(input: {
    client: SupabaseClient;
    decisionId: string;
    tenantId: string;
    trigger: DecisionTriggerEvent;
    action: string;
    result: DecisionAuditResult;
    actor: 'system' | 'user';
    metadata?: Record<string, unknown>;
}) {
    const C = DECISION_AUDIT_LOG.COLUMNS;
    try {
        const { error } = await input.client
            .from(DECISION_AUDIT_LOG.TABLE)
            .insert({
                [C.decision_id]: input.decisionId,
                [C.tenant_id]: input.tenantId,
                [C.trigger]: input.trigger,
                [C.action]: input.action,
                [C.executed_at]: new Date().toISOString(),
                [C.result]: input.result,
                [C.actor]: input.actor,
                [C.metadata]: input.metadata ?? {},
            });

        if (error) throw error;
    } catch (error) {
        if (isMissingRelationError(error, DECISION_AUDIT_LOG.TABLE)) return;
        throw error;
    }
}

async function recordControlPlaneAction(input: {
    client: SupabaseClient;
    tenantId: string;
    actionType: string;
    status: 'requested' | 'completed' | 'failed';
    targetType: string | null;
    targetId: string | null;
    metadata?: Record<string, unknown>;
}) {
    const C = CONTROL_PLANE_ACTION_LOG.COLUMNS;
    try {
        const { error } = await input.client
            .from(CONTROL_PLANE_ACTION_LOG.TABLE)
            .insert({
                [C.tenant_id]: input.tenantId,
                [C.actor]: SYSTEM_ACTOR,
                [C.action_type]: input.actionType,
                [C.target_type]: input.targetType,
                [C.target_id]: input.targetId,
                [C.status]: input.status,
                [C.requires_confirmation]: false,
                [C.metadata]: input.metadata ?? {},
            });

        if (error) throw error;
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_ACTION_LOG.TABLE)) return;
        throw error;
    }
}

async function reconcileDecisionFeedback(input: {
    client: SupabaseClient;
    tenantId: string;
    topologySnapshot: TopologySnapshot;
    now: string;
}) {
    const decisions = await listDecisionEngineRecords(input.client, input.tenantId);
    for (const decision of decisions) {
        if (decision.status !== 'executed') continue;
        const executedAt = textOrNull(decision.metadata.last_executed_at) ?? decision.updated_at;
        if (!executedAt) continue;
        const ageMs = Date.now() - new Date(executedAt).getTime();
        if (!Number.isFinite(ageMs) || ageMs > FEEDBACK_WINDOW_MS) continue;

        const node = decision.source_node_id
            ? input.topologySnapshot.nodes.find((entry) => entry.id === decision.source_node_id)
            : null;
        if (!node) continue;

        const preLatency = numberOrNull(decision.metadata.p95_latency);
        const preDrift = numberOrNull(decision.metadata.drift_score);
        const preConfidence = numberOrNull(decision.metadata.avg_confidence);
        const improved = (preLatency != null && node.state.latency != null && node.state.latency < preLatency)
            || (preDrift != null && node.state.drift_score != null && node.state.drift_score < preDrift)
            || (preConfidence != null && node.state.confidence_avg != null && node.state.confidence_avg > preConfidence);

        await updateDecisionStatus(input.client, decision, decision.status, decision.blocked_reason, {
            feedback_effect: improved ? 'stabilizing' : 'no_improvement',
            feedback_checked_at: input.now,
            current_node_state: node.state,
        });
    }
}

async function loadEvaluationMetrics(
    client: SupabaseClient,
    tenantId: string,
): Promise<EvaluationMetricRow[]> {
    const C = MODEL_EVALUATION_EVENTS.COLUMNS;
    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await client
            .from(MODEL_EVALUATION_EVENTS.TABLE)
            .select(`${C.model_version},${C.prediction_correct}`)
            .eq(C.tenant_id, tenantId)
            .gte(C.created_at, since)
            .order(C.created_at, { ascending: false })
            .limit(500);

        if (error) throw error;
        return (data ?? []).map((row) => {
            const record = row as Record<string, unknown>;
            return {
                model_version: textOrNull(record[C.model_version]),
                prediction_correct: booleanOrNull(record[C.prediction_correct]),
            };
        });
    } catch (error) {
        if (isMissingRelationError(error, MODEL_EVALUATION_EVENTS.TABLE)) return [];
        throw error;
    }
}

function buildAccuracyByFamily(
    registrySnapshot: ModelRegistryControlPlaneSnapshot,
    evaluationRows: EvaluationMetricRow[],
) {
    const accuracyByFamily = new Map<ModelFamily, number | null>();
    for (const family of registrySnapshot.families) {
        const versions = new Set(
            family.entries
                .map((entry) => entry.registry.model_version)
                .filter((value): value is string => value.length > 0),
        );
        if (family.active_model?.model_version) versions.add(family.active_model.model_version);
        const rows = evaluationRows.filter((row) => row.model_version != null && versions.has(row.model_version));
        if (rows.length === 0) {
            accuracyByFamily.set(family.model_family, null);
            continue;
        }
        const correct = rows.filter((row) => row.prediction_correct === true).length;
        accuracyByFamily.set(family.model_family, roundNumber(correct / rows.length, 3));
    }
    return accuracyByFamily;
}

function countFamilyEvaluations(
    registrySnapshot: ModelRegistryControlPlaneSnapshot,
    evaluationRows: EvaluationMetricRow[],
    family: ModelFamily,
) {
    const group = registrySnapshot.families.find((entry) => entry.model_family === family);
    if (!group) return 0;
    const versions = new Set(
        group.entries
            .map((entry) => entry.registry.model_version)
            .filter((value): value is string => value.length > 0),
    );
    if (group.active_model?.model_version) versions.add(group.active_model.model_version);
    return evaluationRows.filter((row) => row.model_version != null && versions.has(row.model_version)).length;
}

function dedupeCandidates(candidates: DecisionEngineCandidate[]) {
    const byKey = new Map<string, DecisionEngineCandidate>();
    for (const candidate of candidates) {
        const current = byKey.get(candidate.decision_key);
        if (!current || current.confidence < candidate.confidence) {
            byKey.set(candidate.decision_key, candidate);
        }
    }
    return Array.from(byKey.values()).sort((left, right) => right.confidence - left.confidence);
}

function buildDecisionImpact(
    latest: DecisionEngineRecord | null,
    topologySnapshot: TopologySnapshot,
) {
    if (!latest) return topologySnapshot.summary.impact;
    const node = latest.source_node_id
        ? topologySnapshot.nodes.find((entry) => entry.id === latest.source_node_id)
        : null;
    const blastRadius = topologySnapshot.failure_impacts.find((impact) => impact.source_node_id === latest.source_node_id);
    if (!node) return topologySnapshot.summary.impact;
    return `Impacts ${node.label}${blastRadius ? ` and ${blastRadius.impacted_node_ids.length} connected nodes` : ''}.`;
}

function buildDriftCandidate(
    node: TopologyNodeSnapshot,
    family: ModelRegistryControlPlaneSnapshot['families'][number],
    config: DecisionEngineConfiguration,
    fallbackReady: boolean,
    criticalRecall: number | null,
): DecisionEngineCandidate {
    const allowAutoRollback = fallbackReady
        && (node.state.drift_score ?? 0) > CRITICAL_DRIFT_AUTO_THRESHOLD
        && criticalRecall != null
        && criticalRecall < CRITICAL_RECALL_AUTO_ROLLBACK_THRESHOLD;
    const actions: DecisionActionPlan[] = [];
    if (allowAutoRollback) {
        actions.push({ kind: 'rollback_to_previous', label: 'rollback_to_previous()' });
    }
    actions.push({ kind: 'mark_model_at_risk', label: 'mark_model_at_risk()' });
    actions.push({ kind: 'block_model_promotion', label: 'block_model_promotion()' });
    actions.push({ kind: 'raise_alert', label: 'raise_alert()' });

    return {
        decision_key: `model_drift_detected:${node.id}:${family.active_registry_id ?? 'none'}`,
        trigger_event: 'model_drift_detected',
        condition: `drift_score=${formatMetric(node.state.drift_score)} threshold=${formatMetric(config.drift_threshold)}`,
        actions,
        confidence: clampNumber(0.6 + Math.min(0.35, ((node.state.drift_score ?? 0) - config.drift_threshold) * 1.2), 0.55, 0.99),
        source_node_id: node.id,
        source_node_type: 'model',
        model_family: family.model_family,
        registry_id: family.active_model?.registry_id ?? null,
        run_id: family.active_model?.run_id ?? null,
        requires_approval: !allowAutoRollback,
        severity: (node.state.drift_score ?? 0) > CRITICAL_DRIFT_AUTO_THRESHOLD ? 'critical' : 'warning',
        node_status: node.state.status,
        metadata: {
            node_label: node.label,
            drift_score: node.state.drift_score,
            drift_threshold: config.drift_threshold,
            rollback_target: family.last_stable_model?.registry_id ?? null,
            critical_recall: criticalRecall,
        },
    };
}

function buildLatencyCandidate(
    node: TopologyNodeSnapshot,
    family: ModelRegistryControlPlaneSnapshot['families'][number],
    config: DecisionEngineConfiguration,
    fallbackReady: boolean,
): DecisionEngineCandidate {
    const severeLatency = (node.state.latency ?? 0) > config.latency_threshold_ms * 1.75;
    const actions: DecisionActionPlan[] = [];
    if (fallbackReady) {
        actions.push({
            kind: 'switch_model',
            label: `switch_model(${family.last_stable_model?.registry_id ?? 'fallback'})`,
            payload: {
                target_registry_id: family.last_stable_model?.registry_id,
                target_run_id: family.last_stable_model?.run_id,
            },
        });
    } else {
        actions.push({ kind: 'restart_pipeline', label: 'restart_pipeline()' });
    }
    actions.push({ kind: 'raise_alert', label: 'raise_alert()' });

    return {
        decision_key: `latency_degradation:${node.id}:${family.active_registry_id ?? 'none'}`,
        trigger_event: 'latency_degradation',
        condition: `p95_latency=${formatMetric(node.state.latency)}ms threshold=${formatMetric(config.latency_threshold_ms)}ms`,
        actions,
        confidence: clampNumber(0.58 + Math.min(0.35, ((node.state.latency ?? 0) - config.latency_threshold_ms) / Math.max(config.latency_threshold_ms, 1)), 0.55, 0.98),
        source_node_id: node.id,
        source_node_type: 'model',
        model_family: family.model_family,
        registry_id: family.active_model?.registry_id ?? null,
        run_id: family.active_model?.run_id ?? null,
        requires_approval: !severeLatency,
        severity: severeLatency ? 'critical' : 'warning',
        node_status: node.state.status,
        metadata: {
            node_label: node.label,
            p95_latency: node.state.latency,
            latency_threshold: config.latency_threshold_ms,
            fallback_registry_id: family.last_stable_model?.registry_id ?? null,
        },
    };
}

function buildConfidenceCandidate(
    node: TopologyNodeSnapshot,
    family: ModelRegistryControlPlaneSnapshot['families'][number],
    config: DecisionEngineConfiguration,
): DecisionEngineCandidate {
    const criticalConfidence = (node.state.confidence_avg ?? 1) < Math.min(config.confidence_threshold, 0.5);
    return {
        decision_key: `confidence_collapse:${node.id}:${family.active_registry_id ?? 'none'}`,
        trigger_event: 'confidence_collapse',
        condition: `avg_confidence=${formatMetric(node.state.confidence_avg)} threshold=${formatMetric(config.confidence_threshold)}`,
        actions: [
            { kind: 'enable_safe_mode', label: 'enable_safe_mode()' },
            { kind: 'trigger_simulation', label: 'trigger_simulation()' },
            { kind: 'raise_alert', label: 'raise_alert()' },
        ],
        confidence: clampNumber(0.55 + Math.min(0.3, (config.confidence_threshold - (node.state.confidence_avg ?? 0)) * 1.4), 0.5, 0.96),
        source_node_id: node.id,
        source_node_type: 'model',
        model_family: family.model_family,
        registry_id: family.active_model?.registry_id ?? null,
        run_id: family.active_model?.run_id ?? null,
        requires_approval: false,
        severity: criticalConfidence ? 'critical' : 'warning',
        node_status: node.state.status,
        metadata: {
            node_label: node.label,
            avg_confidence: node.state.confidence_avg,
            confidence_threshold: config.confidence_threshold,
            abstain_threshold: config.abstain_threshold,
        },
    };
}

function buildAccuracyCandidate(
    node: TopologyNodeSnapshot,
    family: ModelRegistryControlPlaneSnapshot['families'][number],
    accuracy: number,
    fallbackReady: boolean,
    registrySnapshot: ModelRegistryControlPlaneSnapshot,
    evaluationRows: EvaluationMetricRow[],
): DecisionEngineCandidate {
    const actions: DecisionActionPlan[] = [
        { kind: 'block_model_promotion', label: 'block_model_promotion()' },
        { kind: 'raise_alert', label: 'raise_alert()' },
    ];
    if (fallbackReady && accuracy < 0.7) {
        actions.unshift({ kind: 'rollback_to_previous', label: 'rollback_to_previous()' });
    } else {
        actions.push({ kind: 'trigger_simulation', label: 'trigger_simulation()' });
    }

    return {
        decision_key: `accuracy_drop:${node.id}:${family.active_registry_id ?? 'none'}`,
        trigger_event: 'accuracy_drop',
        condition: `accuracy=${formatMetric(accuracy)} threshold=${formatMetric(ACCURACY_DROP_THRESHOLD)}`,
        actions,
        confidence: clampNumber(0.56 + Math.min(0.32, (ACCURACY_DROP_THRESHOLD - accuracy) * 1.5), 0.52, 0.97),
        source_node_id: node.id,
        source_node_type: 'model',
        model_family: family.model_family,
        registry_id: family.active_model?.registry_id ?? null,
        run_id: family.active_model?.run_id ?? null,
        requires_approval: accuracy >= 0.7,
        severity: accuracy < 0.7 ? 'critical' : 'warning',
        node_status: node.state.status,
        metadata: {
            node_label: node.label,
            accuracy,
            evaluation_count: countFamilyEvaluations(registrySnapshot, evaluationRows, family.model_family),
        },
    };
}

function patchTopologyNodeWithDecision(
    node: TopologyNodeSnapshot,
    topDecision: DecisionEngineRecord,
    decisionSnapshot: DecisionEngineSnapshot,
) {
    if (node.id === 'decision_fabric') {
        return {
            ...node,
            metadata: {
                ...node.metadata,
                decision_mode: decisionSnapshot.mode,
                safe_mode_enabled: decisionSnapshot.safe_mode_enabled,
                active_decision_count: decisionSnapshot.active_decision_count,
                latest_trigger: decisionSnapshot.latest_trigger,
                latest_action: decisionSnapshot.latest_action,
            },
            recommendations: [decisionSnapshot.summary.next_action, ...node.recommendations].filter(uniqueValue).slice(0, 5),
        };
    }

    if (topDecision.source_node_id && node.id === topDecision.source_node_id) {
        return {
            ...node,
            recent_errors: [`${topDecision.trigger_event}: ${topDecision.condition}`, ...node.recent_errors].filter(uniqueValue).slice(0, 5),
            recommendations: [topDecision.action, ...node.recommendations].filter(uniqueValue).slice(0, 5),
        };
    }

    return node;
}

function findTargetRegistry(
    registrySnapshot: ModelRegistryControlPlaneSnapshot,
    candidate: DecisionEngineCandidate,
): ModelRegistryRecord | null {
    const family = candidate.model_family
        ? registrySnapshot.families.find((entry) => entry.model_family === candidate.model_family)
        : null;
    if (!family) return null;
    if (candidate.registry_id) {
        return family.entries.find((entry) => entry.registry.registry_id === candidate.registry_id)?.registry
            ?? family.active_model
            ?? null;
    }
    return family.active_model ?? null;
}

function findFallbackRegistry(
    registrySnapshot: ModelRegistryControlPlaneSnapshot,
    candidate: DecisionEngineCandidate,
): ModelRegistryRecord | null {
    const family = candidate.model_family
        ? registrySnapshot.families.find((entry) => entry.model_family === candidate.model_family)
        : null;
    if (!family) return null;
    return family.last_stable_model ?? family.entries.find((entry) => entry.registry.registry_role === 'rollback_target')?.registry ?? null;
}

function findRoutingPointer(
    registrySnapshot: ModelRegistryControlPlaneSnapshot,
    family: ModelFamily,
): RegistryRoutingPointerRecord | null {
    return registrySnapshot.routing_pointers.find((pointer) => pointer.model_family === family) ?? null;
}

function buildRegistryPatch(
    registry: ModelRegistryRecord,
    patch: Partial<Pick<ModelRegistryRecord, 'registry_role' | 'role'>>,
): Omit<ModelRegistryRecord, 'created_at' | 'updated_at'> {
    const { created_at, updated_at, ...rest } = registry;
    return {
        ...rest,
        registry_role: patch.registry_role ?? registry.registry_role,
        role: patch.role ?? registry.role,
    };
}

function mapTopologyNodeType(node: TopologyNodeSnapshot) {
    if (node.id === 'control_plane') return 'master';
    if (node.kind === 'data') return 'dataset';
    if (node.kind === 'simulation') return 'simulation_cluster';
    return node.kind;
}

function mapDecisionRecord(row: Record<string, unknown>): DecisionEngineRecord {
    return {
        decision_id: textOrNull(row.decision_id) ?? randomUUID(),
        tenant_id: textOrNull(row.tenant_id) ?? '',
        decision_key: textOrNull(row.decision_key) ?? 'decision',
        trigger_event: readTriggerEvent(row.trigger_event),
        condition: textOrNull(row.condition) ?? 'No condition recorded.',
        action: textOrNull(row.action) ?? 'No action recorded.',
        confidence: clampNumber(numberOrNull(row.confidence) ?? 0, 0, 1),
        mode: readDecisionMode(row.mode),
        source_node_id: textOrNull(row.source_node_id),
        source_node_type: textOrNull(row.source_node_type),
        model_family: readModelFamily(row.model_family),
        registry_id: textOrNull(row.registry_id),
        run_id: textOrNull(row.run_id),
        timestamp: textOrNull(row.timestamp) ?? new Date().toISOString(),
        status: readDecisionStatus(row.status),
        requires_approval: booleanOrFalse(row.requires_approval),
        blocked_reason: textOrNull(row.blocked_reason),
        metadata: asRecord(row.metadata),
        created_at: textOrNull(row.created_at) ?? new Date().toISOString(),
        updated_at: textOrNull(row.updated_at) ?? new Date().toISOString(),
    };
}

function mapDecisionAuditRecord(row: Record<string, unknown>): DecisionAuditLogRecord {
    return {
        id: textOrNull(row.id) ?? randomUUID(),
        decision_id: textOrNull(row.decision_id) ?? '',
        tenant_id: textOrNull(row.tenant_id) ?? '',
        trigger: readTriggerEvent(row.trigger),
        action: textOrNull(row.action) ?? 'unknown',
        executed_at: textOrNull(row.executed_at) ?? new Date().toISOString(),
        result: readDecisionAuditResult(row.result),
        actor: readDecisionAuditActor(row.actor),
        metadata: asRecord(row.metadata),
        created_at: textOrNull(row.created_at) ?? new Date().toISOString(),
    };
}

function readDecisionMode(value: unknown): DecisionEngineMode {
    return value === 'assist' || value === 'autonomous' ? value : 'observe';
}

function readDecisionStatus(value: unknown): DecisionExecutionStatus {
    return value === 'executed' || value === 'blocked' ? value : 'pending';
}

function readTriggerEvent(value: unknown): DecisionTriggerEvent {
    if (
        value === 'model_drift_detected'
        || value === 'latency_degradation'
        || value === 'confidence_collapse'
        || value === 'accuracy_drop'
        || value === 'system_disconnected'
    ) {
        return value;
    }
    return 'system_disconnected';
}

function readDecisionAuditActor(value: unknown): 'system' | 'user' {
    return value === 'user' ? 'user' : 'system';
}

function readDecisionAuditResult(value: unknown): 'success' | 'failed' {
    return value === 'failed' ? 'failed' : 'success';
}

function readModelFamily(value: unknown): ModelFamily | null {
    return value === 'diagnostics' || value === 'vision' || value === 'therapeutics' ? value : null;
}

function isMissingRelationError(error: unknown, table?: string) {
    const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: unknown }).message)
            : String(error ?? '');
    return message.includes('does not exist') && (table == null || message.includes(table));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textOrNull(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function numberOrNull(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanOrFalse(value: unknown) {
    return value === true;
}

function booleanOrNull(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function roundNumber(value: number, digits = 3) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function formatMetric(value: number | null) {
    return value == null ? 'n/a' : roundNumber(value, 3).toString();
}

function uniqueValue(value: string, index: number, array: string[]) {
    return array.indexOf(value) === index;
}
