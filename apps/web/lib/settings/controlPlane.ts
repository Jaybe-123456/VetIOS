import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { backfillTenantClinicalCaseLearningState } from '@/lib/clinicalCases/clinicalCaseBackfill';
import { collectClinicalDatasetDebugSnapshot } from '@/lib/dataset/clinicalDatasetDiagnostics';
import { evaluateDecisionEngine } from '@/lib/decisionEngine/service';
import {
    AI_INFERENCE_EVENTS,
    CLINICAL_OUTCOME_EVENTS,
    CONTROL_PLANE_ACTION_LOG,
    CONTROL_PLANE_ALERTS,
    CONTROL_PLANE_API_KEYS,
    CONTROL_PLANE_CONFIGS,
    MODEL_EVALUATION_EVENTS,
    TELEMETRY_EVENTS,
} from '@/lib/db/schemaContracts';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { applyExperimentRegistryAction, getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import type { ModelRegistryControlPlaneSnapshot, RegistryAuditLogRecord } from '@/lib/experiments/types';
import { getTopologySnapshot, resolveTopologySimulationTarget, syncControlPlaneAlerts } from '@/lib/intelligence/topologyService';
import type { TopologyAlert, TopologyControlPlaneState } from '@/lib/intelligence/types';
import { logSimulation } from '@/lib/logging/simulationLogger';
import {
    emitTelemetryEvent,
    getTelemetrySnapshot,
    resolveTelemetryRunId,
    telemetryEvaluationEventId,
    telemetryInferenceEventId,
    telemetrySimulationEventId,
} from '@/lib/telemetry/service';
import type { TelemetryEventRecord } from '@/lib/telemetry/types';
import type {
    ControlPlaneActionRecord,
    ControlPlaneActionStatus,
    ControlPlaneAlertRecord,
    ControlPlaneAlertSensitivity,
    ControlPlaneApiKeyRecord,
    ControlPlaneConfiguration,
    ControlPlaneDiagnostics,
    ControlPlaneGovernanceEntry,
    ControlPlaneGovernanceFamily,
    ControlPlaneLogRecord,
    ControlPlanePermissionSet,
    ControlPlanePipelineState,
    ControlPlaneProfile,
    ControlPlaneSimulationScenario,
    ControlPlaneSnapshot,
    ControlPlaneSystemHealth,
    ControlPlaneUserRole,
} from '@/lib/settings/types';

const DEFAULT_CONFIG: ControlPlaneConfiguration = {
    latency_threshold_ms: 900,
    drift_threshold: 0.2,
    confidence_threshold: 0.65,
    alert_sensitivity: 'balanced',
    simulation_enabled: false,
    decision_mode: 'observe',
    safe_mode_enabled: false,
    abstain_threshold: 0.8,
    auto_execute_confidence_threshold: 0.9,
    updated_at: null,
    updated_by: null,
};

const ROLE_PERMISSIONS: Record<ControlPlaneUserRole, string[]> = {
    admin: [
        'manage_profile',
        'manage_api_keys',
        'manage_models',
        'manage_configuration',
        'manage_infrastructure',
        'run_debug_tools',
        'run_simulations',
    ],
    developer: [
        'manage_profile',
        'run_debug_tools',
        'run_simulations',
        'view_governance',
        'view_alerts',
    ],
    researcher: [
        'manage_profile',
        'view_governance',
        'run_debug_tools',
        'view_alerts',
    ],
    clinician: [
        'manage_profile',
        'view_alerts',
        'view_governance',
    ],
};

type ControlPlaneUserContext = {
    user: User | null;
    token_expiry: string | null;
    auth_mode: 'session' | 'dev_bypass';
};

export async function getControlPlaneSnapshot(input: {
    client: SupabaseClient;
    tenantId: string;
    userId: string | null;
    userContext: ControlPlaneUserContext;
}): Promise<ControlPlaneSnapshot> {
    const experimentStore = createSupabaseExperimentTrackingStore(input.client);

    const [
        telemetrySnapshot,
        topologySnapshot,
        registrySnapshot,
        datasetDebug,
        configBundle,
        apiKeys,
        actions,
        telemetryEvents,
        latestEvaluationId,
    ] = await Promise.all([
        getTelemetrySnapshot(input.client, input.tenantId),
        getTopologySnapshot(input.client, input.tenantId, { window: '24h' }),
        getModelRegistryControlPlaneSnapshot(experimentStore, input.tenantId),
        collectClinicalDatasetDebugSnapshot(input.client, input.tenantId, input.userId),
        getControlPlaneConfigBundle(input.client, input.tenantId),
        listControlPlaneApiKeys(input.client, input.tenantId),
        listControlPlaneActions(input.client, input.tenantId),
        listTelemetryEvents(input.client, input.tenantId),
        findLatestEvaluationEventId(input.client, input.tenantId),
    ]);

    const decisionEngine = await evaluateDecisionEngine({
        client: input.client,
        tenantId: input.tenantId,
        topologySnapshot,
        registrySnapshot,
        triggerSource: 'settings_control_plane',
    });

    try {
        await syncControlPlaneAlerts(input.client, input.tenantId, topologySnapshot.alerts);
    } catch (error) {
        if (!isMissingRelationError(error, CONTROL_PLANE_ALERTS.TABLE)) {
            throw error;
        }
    }
    const persistedAlerts = await listControlPlaneAlerts(input.client, input.tenantId, topologySnapshot.alerts);
    const profile = buildProfile(input.userContext.user, input.userContext.auth_mode);
    const accessScope = buildAccessScope(profile.role, input.tenantId);
    const governanceFamilies = buildGovernanceFamilies(registrySnapshot);

    return {
        tenant_id: input.tenantId,
        profile,
        access_security: {
            tenant_id: input.tenantId,
            auth_mode: input.userContext.auth_mode,
            active_sessions: [
                {
                    session_id: input.userContext.user?.id ?? `dev-session-${input.tenantId}`,
                    label: input.userContext.user?.email ?? 'Current control-plane session',
                    current: true,
                    expires_at: input.userContext.token_expiry,
                    access_scope: accessScope,
                    tenant_isolation: `tenant_id=${input.tenantId}`,
                },
            ],
            token_expiry: input.userContext.token_expiry,
            access_scope: accessScope,
            api_keys: apiKeys,
        },
        system_health: buildSystemHealth(telemetrySnapshot, topologySnapshot, telemetryEvents),
        pipelines: buildPipelineStates(topologySnapshot),
        governance: {
            families: governanceFamilies,
            current_production_model: governanceFamilies
                .map((family) => family.current_production_model)
                .filter(Boolean)
                .join(' | ') || null,
            staging_candidate: governanceFamilies
                .map((family) => family.staging_candidate)
                .filter(Boolean)
                .join(' | ') || null,
            rollback_target: governanceFamilies
                .map((family) => family.rollback_target)
                .filter(Boolean)
                .join(' | ') || null,
        },
        diagnostics: buildDiagnostics(
            topologySnapshot.control_plane_state,
            topologySnapshot.summary,
            buildPipelineStates(topologySnapshot),
            configBundle.warnings,
        ),
        configuration: configBundle.config,
        decision_engine: {
            mode: decisionEngine.mode,
            safe_mode_enabled: decisionEngine.safe_mode_enabled,
            abstain_threshold: decisionEngine.abstain_threshold,
            auto_execute_confidence_threshold: decisionEngine.auto_execute_confidence_threshold,
            last_evaluated_at: decisionEngine.last_evaluated_at,
            active_decision_count: decisionEngine.active_decision_count,
            latest_trigger: decisionEngine.latest_trigger,
            latest_action: decisionEngine.latest_action,
            decisions: decisionEngine.decisions,
            audit_log: decisionEngine.audit_log,
            summary: decisionEngine.summary,
        },
        alerts: persistedAlerts,
        logs: buildControlPlaneLogs({
            telemetryEvents,
            actions,
            alerts: persistedAlerts,
            registryAudit: registrySnapshot.audit_history,
            decisionEngine,
        }),
        actions,
        debug: {
            latest_inference_event_id: extractLatestTelemetrySourceId(telemetryEvents, 'ai_inference_events'),
            latest_outcome_event_id: extractLatestTelemetrySourceId(telemetryEvents, 'clinical_outcome_events'),
            latest_evaluation_event_id: latestEvaluationId,
            dataset_row_count: datasetDebug.dataset_row_count,
            orphan_counts: datasetDebug.orphan_counts,
        },
        telemetry_events: telemetryEvents,
        refreshed_at: new Date().toISOString(),
    };
}

export async function getControlPlaneConfigBundle(client: SupabaseClient, tenantId: string): Promise<{
    config: ControlPlaneConfiguration;
    warnings: string[];
}> {
    const C = CONTROL_PLANE_CONFIGS.COLUMNS;
    try {
        const { data, error } = await client
            .from(CONTROL_PLANE_CONFIGS.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .maybeSingle();

        if (error) throw error;
        if (data) {
            return {
                config: mapControlPlaneConfig(data as Record<string, unknown>),
                warnings: [],
            };
        }

        const inserted = await client
            .from(CONTROL_PLANE_CONFIGS.TABLE)
            .insert({
                [C.tenant_id]: tenantId,
                [C.latency_threshold_ms]: DEFAULT_CONFIG.latency_threshold_ms,
                [C.drift_threshold]: DEFAULT_CONFIG.drift_threshold,
                [C.confidence_threshold]: DEFAULT_CONFIG.confidence_threshold,
                [C.alert_sensitivity]: DEFAULT_CONFIG.alert_sensitivity,
                [C.simulation_enabled]: DEFAULT_CONFIG.simulation_enabled,
                [C.decision_mode]: DEFAULT_CONFIG.decision_mode,
                [C.safe_mode_enabled]: DEFAULT_CONFIG.safe_mode_enabled,
                [C.abstain_threshold]: DEFAULT_CONFIG.abstain_threshold,
                [C.auto_execute_confidence_threshold]: DEFAULT_CONFIG.auto_execute_confidence_threshold,
            })
            .select('*')
            .single();

        if (inserted.error || !inserted.data) {
            throw inserted.error ?? new Error('Failed to initialize control-plane config');
        }

        return {
            config: mapControlPlaneConfig(inserted.data as Record<string, unknown>),
            warnings: [],
        };
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_CONFIGS.TABLE)) {
            return {
                config: DEFAULT_CONFIG,
                warnings: ['control_plane_configs table is missing; default settings are in use.'],
            };
        }
        throw error;
    }
}

export async function updateControlPlaneConfig(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    patch: Partial<Pick<ControlPlaneConfiguration, 'latency_threshold_ms' | 'drift_threshold' | 'confidence_threshold' | 'alert_sensitivity' | 'simulation_enabled' | 'decision_mode' | 'safe_mode_enabled' | 'abstain_threshold' | 'auto_execute_confidence_threshold'>>;
}): Promise<ControlPlaneConfiguration> {
    const C = CONTROL_PLANE_CONFIGS.COLUMNS;
    const { data, error } = await input.client
        .from(CONTROL_PLANE_CONFIGS.TABLE)
        .upsert(stripUndefined({
            [C.tenant_id]: input.tenantId,
            [C.latency_threshold_ms]: input.patch.latency_threshold_ms,
            [C.drift_threshold]: input.patch.drift_threshold,
            [C.confidence_threshold]: input.patch.confidence_threshold,
            [C.alert_sensitivity]: input.patch.alert_sensitivity,
            [C.simulation_enabled]: input.patch.simulation_enabled,
            [C.decision_mode]: input.patch.decision_mode,
            [C.safe_mode_enabled]: input.patch.safe_mode_enabled,
            [C.abstain_threshold]: input.patch.abstain_threshold,
            [C.auto_execute_confidence_threshold]: input.patch.auto_execute_confidence_threshold,
            [C.updated_by]: input.actor,
        }), {
            onConflict: C.tenant_id,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to update control-plane config: ${error?.message ?? 'Unknown error'}`);
    }

    return mapControlPlaneConfig(data as Record<string, unknown>);
}

export async function listControlPlaneApiKeys(
    client: SupabaseClient,
    tenantId: string,
): Promise<ControlPlaneApiKeyRecord[]> {
    const C = CONTROL_PLANE_API_KEYS.COLUMNS;
    try {
        const { data, error } = await client
            .from(CONTROL_PLANE_API_KEYS.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .order(C.created_at, { ascending: false })
            .limit(50);

        if (error) throw error;
        return (data ?? []).map((row) => mapControlPlaneApiKey(row as Record<string, unknown>));
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_API_KEYS.TABLE)) {
            return [];
        }
        throw error;
    }
}

export async function createControlPlaneApiKey(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    label: string;
    scopes: string[];
}): Promise<{ key: string; record: ControlPlaneApiKeyRecord }> {
    const plainKey = `vetios_cp_${randomBytes(24).toString('hex')}`;
    const hash = createHash('sha256').update(plainKey).digest('hex');
    const prefix = plainKey.slice(0, 14);
    const C = CONTROL_PLANE_API_KEYS.COLUMNS;

    const { data, error } = await input.client
        .from(CONTROL_PLANE_API_KEYS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.label]: input.label,
            [C.key_prefix]: prefix,
            [C.key_hash]: hash,
            [C.scopes]: input.scopes,
            [C.status]: 'active',
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create control-plane API key: ${error?.message ?? 'Unknown error'}`);
    }

    return {
        key: plainKey,
        record: mapControlPlaneApiKey(data as Record<string, unknown>),
    };
}

export async function revokeControlPlaneApiKey(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    apiKeyId: string;
}): Promise<ControlPlaneApiKeyRecord> {
    const C = CONTROL_PLANE_API_KEYS.COLUMNS;
    const { data, error } = await input.client
        .from(CONTROL_PLANE_API_KEYS.TABLE)
        .update({
            [C.status]: 'revoked',
            [C.revoked_at]: new Date().toISOString(),
            [C.revoked_by]: input.actor,
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, input.apiKeyId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to revoke control-plane API key: ${error?.message ?? 'Unknown error'}`);
    }

    return mapControlPlaneApiKey(data as Record<string, unknown>);
}

export async function listControlPlaneActions(
    client: SupabaseClient,
    tenantId: string,
): Promise<ControlPlaneActionRecord[]> {
    const C = CONTROL_PLANE_ACTION_LOG.COLUMNS;
    try {
        const { data, error } = await client
            .from(CONTROL_PLANE_ACTION_LOG.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .order(C.created_at, { ascending: false })
            .limit(80);

        if (error) throw error;
        return (data ?? []).map((row) => mapControlPlaneAction(row as Record<string, unknown>));
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_ACTION_LOG.TABLE)) {
            return [];
        }
        throw error;
    }
}

export async function recordControlPlaneAction(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    actionType: string;
    status: ControlPlaneActionStatus;
    targetType?: string | null;
    targetId?: string | null;
    requiresConfirmation?: boolean;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const C = CONTROL_PLANE_ACTION_LOG.COLUMNS;
    try {
        const { error } = await input.client
            .from(CONTROL_PLANE_ACTION_LOG.TABLE)
            .insert({
                [C.tenant_id]: input.tenantId,
                [C.actor]: input.actor,
                [C.action_type]: input.actionType,
                [C.target_type]: input.targetType ?? null,
                [C.target_id]: input.targetId ?? null,
                [C.status]: input.status,
                [C.requires_confirmation]: input.requiresConfirmation === true,
                [C.metadata]: input.metadata ?? {},
            });

        if (error) throw error;
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_ACTION_LOG.TABLE)) {
            return;
        }
        throw error;
    }
}

export async function listTelemetryEvents(client: SupabaseClient, tenantId: string): Promise<TelemetryEventRecord[]> {
    const C = TELEMETRY_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(TELEMETRY_EVENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.timestamp, { ascending: false })
        .limit(360);

    if (error) {
        if (isMissingRelationError(error, TELEMETRY_EVENTS.TABLE)) return [];
        throw new Error(`Failed to list telemetry events: ${error.message}`);
    }

    return (data ?? []).map((row) => mapTelemetryEvent(row as Record<string, unknown>));
}

export async function listControlPlaneAlerts(
    client: SupabaseClient,
    tenantId: string,
    fallbackAlerts: TopologyAlert[],
): Promise<ControlPlaneAlertRecord[]> {
    const C = CONTROL_PLANE_ALERTS.COLUMNS;
    try {
        const { data, error } = await client
            .from(CONTROL_PLANE_ALERTS.TABLE)
            .select('*')
            .eq(C.tenant_id, tenantId)
            .order(C.created_at, { ascending: false })
            .limit(80);

        if (error) throw error;
        return (data ?? []).map((row) => mapControlPlaneAlert(row as Record<string, unknown>));
    } catch (error) {
        if (isMissingRelationError(error, CONTROL_PLANE_ALERTS.TABLE)) {
            return fallbackAlerts.map((alert) => ({
                id: alert.id,
                severity: alert.severity,
                source: alert.category,
                title: alert.title,
                message: alert.message,
                node_id: alert.node_id,
                timestamp: alert.timestamp,
                resolved: false,
                metadata: {},
            }));
        }
        throw error;
    }
}

export async function markControlPlaneAlertResolved(input: {
    client: SupabaseClient;
    tenantId: string;
    alertId: string;
}): Promise<void> {
    const C = CONTROL_PLANE_ALERTS.COLUMNS;
    const { error } = await input.client
        .from(CONTROL_PLANE_ALERTS.TABLE)
        .update({
            [C.resolved]: true,
            [C.resolved_at]: new Date().toISOString(),
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.alert_key, input.alertId);

    if (error) {
        throw new Error(`Failed to resolve control-plane alert: ${error.message}`);
    }
}

export async function updateControlPlaneProfile(input: {
    adminClient: SupabaseClient;
    userId: string;
    currentUser: User | null;
    organization?: string | null;
    role?: ControlPlaneUserRole;
}): Promise<void> {
    const currentMetadata = asRecord(input.currentUser?.user_metadata);
    const nextMetadata = {
        ...currentMetadata,
        organization: input.organization ?? currentMetadata.organization ?? null,
        role: input.role ?? currentMetadata.role ?? null,
    };

    const { error } = await input.adminClient.auth.admin.updateUserById(input.userId, {
        user_metadata: nextMetadata,
    });

    if (error) {
        throw new Error(`Failed to update profile: ${error.message}`);
    }
}

export async function backfillEvaluationEvents(input: {
    client: SupabaseClient;
    tenantId: string;
}): Promise<{ created: number }> {
    const outcomeColumns = CLINICAL_OUTCOME_EVENTS.COLUMNS;
    const inferenceColumns = AI_INFERENCE_EVENTS.COLUMNS;
    const evaluationColumns = MODEL_EVALUATION_EVENTS.COLUMNS;
    const { data, error } = await input.client
        .from(CLINICAL_OUTCOME_EVENTS.TABLE)
        .select(`
            ${outcomeColumns.id},
            ${outcomeColumns.case_id},
            ${outcomeColumns.inference_event_id},
            ${outcomeColumns.outcome_payload},
            ${outcomeColumns.outcome_timestamp},
            inference:${AI_INFERENCE_EVENTS.TABLE}!${outcomeColumns.inference_event_id} (
                ${inferenceColumns.id},
                ${inferenceColumns.model_name},
                ${inferenceColumns.model_version},
                ${inferenceColumns.output_payload},
                ${inferenceColumns.confidence_score}
            )
        `)
        .eq(outcomeColumns.tenant_id, input.tenantId)
        .order(outcomeColumns.outcome_timestamp, { ascending: false })
        .limit(200);

    if (error) {
        throw new Error(`Failed to load outcomes for evaluation backfill: ${error.message}`);
    }

    const existing = await input.client
        .from(MODEL_EVALUATION_EVENTS.TABLE)
        .select(`${evaluationColumns.outcome_event_id}`)
        .eq(evaluationColumns.tenant_id, input.tenantId)
        .not(evaluationColumns.outcome_event_id, 'is', null);

    if (existing.error) {
        throw new Error(`Failed to inspect existing evaluation events: ${existing.error.message}`);
    }

    const existingOutcomeIds = new Set(
        (existing.data ?? [])
            .map((row) => textOrNull((row as Record<string, unknown>).outcome_event_id))
            .filter((value): value is string => value != null),
    );

    let created = 0;
    for (const row of data ?? []) {
        const record = row as Record<string, unknown>;
        const outcomeEventId = textOrNull(record.id);
        if (!outcomeEventId || existingOutcomeIds.has(outcomeEventId)) continue;

        const inference = asRecord(record.inference);
        const inferenceId = textOrNull(inference.id);
        const modelName = textOrNull(inference.model_name);
        const modelVersion = textOrNull(inference.model_version);
        if (!inferenceId || !modelName || !modelVersion) continue;

        const outputPayload = asRecord(inference.output_payload);
        const outcomePayload = asRecord(record.outcome_payload);
        const predictedLabel = extractPredictionLabel(outputPayload);
        const groundTruth = resolveOutcomeGroundTruth(outcomePayload);
        const correct = predictedLabel && groundTruth ? predictedLabel === groundTruth : null;
        const recentEvaluations = await getRecentEvaluations(input.client, input.tenantId, modelName, 20);
        const evaluation = await createEvaluationEvent(input.client, {
            tenant_id: input.tenantId,
            trigger_type: 'outcome',
            inference_event_id: inferenceId,
            outcome_event_id: outcomeEventId,
            case_id: textOrNull(record.case_id),
            model_name: modelName,
            model_version: modelVersion,
            prediction: predictedLabel,
            ground_truth: groundTruth,
            predicted_confidence: numberOrNull(inference.confidence_score),
            actual_correctness: correct == null ? undefined : correct ? 1 : 0,
            predicted_output: outputPayload,
            actual_outcome: outcomePayload,
            recent_evaluations: recentEvaluations,
        });

        await emitTelemetryEvent(input.client, {
            event_id: telemetryEvaluationEventId(evaluation.evaluation_event_id),
            tenant_id: input.tenantId,
            linked_event_id: telemetryInferenceEventId(inferenceId),
            source_id: evaluation.evaluation_event_id,
            source_table: 'model_evaluation_events',
            event_type: 'evaluation',
            timestamp: textOrNull(record.outcome_timestamp) ?? new Date().toISOString(),
            model_version: modelVersion,
            run_id: resolveTelemetryRunId(modelVersion, textOrNull(asRecord(outputPayload.telemetry).run_id)),
            metrics: {
                confidence: numberOrNull(inference.confidence_score),
                prediction: predictedLabel,
                ground_truth: groundTruth,
                correct,
            },
            metadata: {
                source_module: 'settings_control_plane',
                inference_event_id: inferenceId,
                outcome_event_id: outcomeEventId,
                evaluation_event_id: evaluation.evaluation_event_id,
                backfilled: true,
            },
        });
        created += 1;
    }

    return { created };
}

export async function emitControlPlaneSystemEvent(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    action: 'restart_telemetry_stream' | 'reinitialize_pipelines';
}): Promise<void> {
    const timestamp = new Date().toISOString();
    await emitTelemetryEvent(input.client, {
        event_id: `evt_system_${input.action}_${timestamp}`,
        tenant_id: input.tenantId,
        event_type: 'system',
        timestamp,
        model_version: 'control-plane',
        run_id: 'control-plane',
        metrics: {},
        system: {},
        metadata: {
            source_module: 'settings_control_plane',
            action: input.action,
            actor: input.actor,
        },
    });
}

export async function injectControlPlaneSimulation(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    scenario: ControlPlaneSimulationScenario;
    targetNodeId: string;
    severity: 'degraded' | 'critical';
}): Promise<{ simulation_event_id: string; telemetry_event_id: string }> {
    const experimentStore = createSupabaseExperimentTrackingStore(input.client);
    const controlPlane = await getModelRegistryControlPlaneSnapshot(experimentStore, input.tenantId);
    const target = resolveTopologySimulationTarget(controlPlane, input.targetNodeId);
    const profile = buildSimulationProfile(input.scenario, input.severity, input.targetNodeId);
    const simulationEventId = cryptoRandomId();
    const timestamp = new Date().toISOString();

    await logSimulation(input.client, {
        id: simulationEventId,
        tenant_id: input.tenantId,
        user_id: input.actor,
        source_module: 'settings_control_plane',
        simulation_type: `settings_${input.scenario}`,
        simulation_parameters: {
            target_node_id: input.targetNodeId,
            severity: input.severity,
        },
        triggered_inference_id: null,
        failure_mode: input.severity === 'critical' ? input.scenario : null,
        stress_metrics: {
            ...profile,
            model_version: target.model_version,
            run_id: target.run_id,
        },
        is_real_world: false,
    });

    const telemetryEventId = telemetrySimulationEventId(simulationEventId);
    await emitTelemetryEvent(input.client, {
        event_id: telemetryEventId,
        tenant_id: input.tenantId,
        linked_event_id: null,
        source_id: simulationEventId,
        source_table: 'edge_simulation_events',
        event_type: 'simulation',
        timestamp,
        model_version: target.model_version,
        run_id: target.run_id,
        metrics: {
            latency_ms: profile.latency_ms,
            confidence: profile.confidence_avg,
            prediction: input.targetNodeId,
        },
        system: {
            cpu: profile.cpu,
            gpu: profile.gpu,
            memory: profile.memory,
        },
        metadata: {
            source_module: 'settings_control_plane',
            target_node_id: input.targetNodeId,
            scenario: input.scenario,
            synthetic: true,
            injected_status: profile.status,
            injected_latency_ms: profile.latency_ms,
            injected_error_rate: profile.error_rate,
            injected_drift_score: profile.drift_score,
            injected_confidence_avg: profile.confidence_avg,
            simulation_event_id: simulationEventId,
        },
    });

    return {
        simulation_event_id: simulationEventId,
        telemetry_event_id: telemetryEventId,
    };
}

export async function runRegistryControlAction(input: {
    client: SupabaseClient;
    tenantId: string;
    runId: string;
    actor: string | null;
    action: 'promote_to_staging' | 'promote_to_production' | 'archive' | 'rollback';
    reason?: string;
    incidentId?: string | null;
}) {
    const store = createSupabaseExperimentTrackingStore(input.client);
    return applyExperimentRegistryAction(
        store,
        input.tenantId,
        input.runId,
        input.action,
        input.actor,
        {
            reason: input.reason,
            incidentId: input.incidentId ?? null,
        },
    );
}

export async function runDatasetBackfill(client: SupabaseClient, tenantId: string) {
    return backfillTenantClinicalCaseLearningState(client, tenantId);
}

function buildProfile(user: User | null, authMode: 'session' | 'dev_bypass'): ControlPlaneProfile {
    const role = resolveRole(user, authMode);
    const permissions = ROLE_PERMISSIONS[role];
    return {
        user_id: user?.id ?? null,
        email: user?.email ?? null,
        role,
        organization: textOrNull(asRecord(user?.user_metadata).organization) ?? (authMode === 'dev_bypass' ? 'VetIOS Development Tenant' : null),
        permissions,
        permission_set: buildPermissionSet(role),
        last_login: textOrNull((user as { last_sign_in_at?: string | null } | null)?.last_sign_in_at ?? null),
    };
}

function buildPermissionSet(role: ControlPlaneUserRole): ControlPlanePermissionSet {
    const has = new Set(ROLE_PERMISSIONS[role]);
    return {
        can_manage_profile: has.has('manage_profile'),
        can_manage_api_keys: has.has('manage_api_keys'),
        can_manage_models: has.has('manage_models'),
        can_manage_configuration: has.has('manage_configuration'),
        can_manage_infrastructure: has.has('manage_infrastructure'),
        can_run_debug_tools: has.has('run_debug_tools'),
        can_run_simulations: has.has('run_simulations'),
    };
}

function resolveRole(user: User | null, authMode: 'session' | 'dev_bypass'): ControlPlaneUserRole {
    if (authMode === 'dev_bypass') return 'admin';
    const metadata = asRecord(user?.user_metadata);
    const appMetadata = asRecord(user?.app_metadata);
    const candidate = textOrNull(metadata.role) ?? textOrNull(appMetadata.role);
    if (candidate === 'admin' || candidate === 'researcher' || candidate === 'clinician' || candidate === 'developer') {
        return candidate;
    }
    return 'developer';
}

function buildAccessScope(role: ControlPlaneUserRole, tenantId: string) {
    return [`tenant:${tenantId}`, `role:${role}`, ...ROLE_PERMISSIONS[role]];
}

function buildSystemHealth(
    telemetrySnapshot: Awaited<ReturnType<typeof getTelemetrySnapshot>>,
    topologySnapshot: Awaited<ReturnType<typeof getTopologySnapshot>>,
    telemetryEvents: TelemetryEventRecord[],
): ControlPlaneSystemHealth {
    const warnings: string[] = [];
    if (!topologySnapshot.diagnostics.latest_inference_timestamp) warnings.push('No inference activity observed yet.');
    if (!topologySnapshot.diagnostics.latest_outcome_timestamp) warnings.push('No outcome activity observed yet.');
    if (!topologySnapshot.diagnostics.latest_evaluation_timestamp) warnings.push('No evaluation events observed yet.');
    if (topologySnapshot.control_plane_state === 'MISSING_EVALUATION_EVENTS_TABLE') {
        warnings.push('model_evaluation_events storage is unavailable.');
    }
    if (topologySnapshot.control_plane_state === 'STREAM_DISCONNECTED') {
        warnings.push('Topology stream is disconnected.');
    }

    return {
        telemetry_status: topologySnapshot.diagnostics.telemetry_stream_connected ? 'connected' : 'disconnected',
        topology_state: topologySnapshot.control_plane_state,
        event_ingestion_rate: ratePerMinute(telemetryEvents.map((event) => event.timestamp), 15),
        network_health_score: topologySnapshot.network_health_score,
        last_inference_timestamp: topologySnapshot.diagnostics.latest_inference_timestamp,
        last_outcome_timestamp: topologySnapshot.diagnostics.latest_outcome_timestamp,
        last_evaluation_event_timestamp: topologySnapshot.diagnostics.latest_evaluation_timestamp,
        last_simulation_timestamp: topologySnapshot.diagnostics.latest_simulation_timestamp,
        warnings: [
            ...warnings,
            ...(telemetrySnapshot.system_state === 'STALE' ? ['Telemetry heartbeat is stale.'] : []),
        ],
    };
}

function buildPipelineStates(
    topologySnapshot: Awaited<ReturnType<typeof getTopologySnapshot>>,
): ControlPlanePipelineState[] {
    const { control_plane_state: controlPlaneState, alerts, diagnostics, refreshed_at } = topologySnapshot;

    return [
        {
            key: 'inference',
            label: 'Inference Pipeline',
            status: classifyPipelineStatus(diagnostics.latest_inference_timestamp, alerts, ['latency', 'error_rate', 'heartbeat', 'governance'], 'diagnostics_model'),
            last_successful_event: diagnostics.latest_inference_timestamp,
            error_logs: collectAlertMessages(alerts, ['latency', 'error_rate', 'heartbeat', 'governance'], 'diagnostics_model'),
        },
        {
            key: 'outcome',
            label: 'Outcome Pipeline',
            status: diagnostics.latest_outcome_timestamp ? 'ACTIVE' : 'INITIALIZING',
            last_successful_event: diagnostics.latest_outcome_timestamp,
            error_logs: collectAlertMessages(alerts, ['evaluation'], 'outcome_feedback'),
        },
        {
            key: 'evaluation',
            label: 'Evaluation Pipeline',
            status: controlPlaneState === 'WAITING_FOR_EVALUATION_EVENTS'
                || controlPlaneState === 'MISSING_EVALUATION_EVENTS_TABLE'
                ? 'FAILED'
                : diagnostics.latest_evaluation_timestamp
                    ? classifyPipelineStatus(diagnostics.latest_evaluation_timestamp, alerts, ['evaluation'], 'outcome_feedback')
                    : 'INITIALIZING',
            last_successful_event: diagnostics.latest_evaluation_timestamp,
            error_logs: collectAlertMessages(alerts, ['evaluation']),
        },
        {
            key: 'telemetry_stream',
            label: 'Telemetry Stream',
            status: diagnostics.telemetry_stream_connected ? 'ACTIVE' : 'FAILED',
            last_successful_event: diagnostics.latest_telemetry_timestamp,
            error_logs: collectAlertMessages(alerts, ['stream'], 'telemetry_observer'),
        },
        {
            key: 'topology_stream',
            label: 'Topology Stream',
            status: controlPlaneState === 'STREAM_DISCONNECTED' ? 'FAILED' : 'ACTIVE',
            last_successful_event: refreshed_at,
            error_logs: collectAlertMessages(alerts, ['stream', 'heartbeat']),
        },
    ];
}

function buildGovernanceFamilies(snapshot: ModelRegistryControlPlaneSnapshot): ControlPlaneGovernanceFamily[] {
    return snapshot.families.map((family) => ({
        model_family: family.model_family,
        current_production_model: family.active_model?.model_version ?? null,
        staging_candidate: family.entries.find((entry) => entry.registry.lifecycle_status === 'staging')?.registry.model_version ?? null,
        rollback_target: family.last_stable_model?.model_version ?? null,
        active_registry_id: family.active_registry_id,
        entries: family.entries.map((entry) => mapGovernanceEntry(entry)),
    }));
}

function mapGovernanceEntry(entry: ModelRegistryControlPlaneSnapshot['families'][number]['entries'][number]): ControlPlaneGovernanceEntry {
    return {
        registry_id: entry.registry.registry_id,
        run_id: entry.registry.run_id,
        model_version: entry.registry.model_version,
        lifecycle_status: entry.registry.lifecycle_status,
        registry_role: entry.registry.registry_role,
        is_active_route: entry.is_active_route,
        promotion_allowed: entry.promotion_gating.promotion_allowed,
        deployment_decision: entry.decision_panel.deployment_decision,
        blockers: entry.promotion_gating.blockers,
        gating: entry.promotion_gating.gates,
    };
}

function buildDiagnostics(
    controlPlaneState: TopologyControlPlaneState,
    summary: Awaited<ReturnType<typeof getTopologySnapshot>>['summary'],
    pipelines: ControlPlanePipelineState[],
    configWarnings: string[],
): ControlPlaneDiagnostics {
    return {
        missing_tables: controlPlaneState === 'MISSING_EVALUATION_EVENTS_TABLE' ? ['model_evaluation_events'] : [],
        disconnected_streams: controlPlaneState === 'STREAM_DISCONNECTED' ? ['topology_stream', 'telemetry_stream'] : [],
        failing_pipelines: pipelines.filter((pipeline) => pipeline.status === 'FAILED').map((pipeline) => pipeline.key),
        warnings: configWarnings,
        root_cause: summary.root_cause,
        where_failing: summary.where_failing,
        impact: summary.impact,
        next_action: summary.next_action,
    };
}

function buildControlPlaneLogs(input: {
    telemetryEvents: TelemetryEventRecord[];
    actions: ControlPlaneActionRecord[];
    alerts: ControlPlaneAlertRecord[];
    registryAudit: RegistryAuditLogRecord[];
    decisionEngine: ControlPlaneSnapshot['decision_engine'];
}): ControlPlaneLogRecord[] {
    const telemetryLogs = input.telemetryEvents.map<ControlPlaneLogRecord>((event) => ({
        id: event.event_id,
        category: event.event_type,
        level: event.event_type === 'system'
            ? (textOrNull(event.metadata.action) === 'heartbeat' ? 'INFO' : 'WARN')
            : 'INFO',
        message: formatTelemetryMessage(event),
        timestamp: event.timestamp,
        run_id: event.run_id,
        model_version: event.model_version,
        event_type: event.event_type,
    }));
    const actionLogs = input.actions.map<ControlPlaneLogRecord>((action) => ({
        id: action.id,
        category: 'control',
        level: action.status === 'failed' ? 'ERROR' : action.status === 'requested' ? 'WARN' : 'INFO',
        message: `[CONTROL] ${action.action_type.toUpperCase()} ${action.status.toUpperCase()}`,
        timestamp: action.created_at,
        run_id: textOrNull(action.metadata.run_id),
        model_version: textOrNull(action.metadata.model_version),
        event_type: action.action_type,
    }));
    const alertLogs = input.alerts.map<ControlPlaneLogRecord>((alert) => ({
        id: alert.id,
        category: 'error',
        level: alert.severity === 'critical' ? 'ERROR' : alert.severity === 'warning' ? 'WARN' : 'INFO',
        message: `[ALERT] ${alert.title} ${alert.resolved ? '(RESOLVED)' : ''}`.trim(),
        timestamp: alert.timestamp,
        run_id: null,
        model_version: null,
        event_type: alert.source,
    }));
    const registryLogs = input.registryAudit.map<ControlPlaneLogRecord>((event) => ({
        id: event.event_id,
        category: 'registry',
        level: event.event_type === 'rolled_back' ? 'WARN' : 'INFO',
        message: `[REGISTRY] ${event.event_type.toUpperCase()} ${event.registry_id}`,
        timestamp: event.timestamp,
        run_id: event.run_id,
        model_version: textOrNull(event.metadata.model_version),
        event_type: event.event_type,
    }));
    const decisionLogs = input.decisionEngine.audit_log.map<ControlPlaneLogRecord>((event) => ({
        id: event.id,
        category: 'system',
        level: event.result === 'failed' ? 'ERROR' : 'INFO',
        message: `[DECISION] ${event.trigger.toUpperCase()} -> ${event.action} (${event.result.toUpperCase()})`,
        timestamp: event.executed_at,
        run_id: textOrNull(event.metadata.run_id),
        model_version: textOrNull(event.metadata.model_version),
        event_type: 'decision',
    }));

    return [...telemetryLogs, ...actionLogs, ...alertLogs, ...registryLogs, ...decisionLogs]
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, 200);
}

function mapControlPlaneConfig(row: Record<string, unknown>): ControlPlaneConfiguration {
    return {
        latency_threshold_ms: numberOrNull(row.latency_threshold_ms) ?? DEFAULT_CONFIG.latency_threshold_ms,
        drift_threshold: numberOrNull(row.drift_threshold) ?? DEFAULT_CONFIG.drift_threshold,
        confidence_threshold: numberOrNull(row.confidence_threshold) ?? DEFAULT_CONFIG.confidence_threshold,
        alert_sensitivity: readAlertSensitivity(row.alert_sensitivity),
        simulation_enabled: booleanOrFalse(row.simulation_enabled),
        decision_mode: readDecisionMode(row.decision_mode),
        safe_mode_enabled: booleanOrFalse(row.safe_mode_enabled),
        abstain_threshold: numberOrNull(row.abstain_threshold) ?? DEFAULT_CONFIG.abstain_threshold,
        auto_execute_confidence_threshold: numberOrNull(row.auto_execute_confidence_threshold) ?? DEFAULT_CONFIG.auto_execute_confidence_threshold,
        updated_at: textOrNull(row.updated_at),
        updated_by: textOrNull(row.updated_by),
    };
}

function mapControlPlaneApiKey(row: Record<string, unknown>): ControlPlaneApiKeyRecord {
    return {
        id: textOrNull(row.id) ?? cryptoRandomId(),
        label: textOrNull(row.label) ?? 'Unnamed key',
        key_prefix: textOrNull(row.key_prefix) ?? 'unknown',
        scopes: asStringArray(row.scopes),
        status: textOrNull(row.status) === 'revoked' ? 'revoked' : 'active',
        created_at: textOrNull(row.created_at) ?? new Date().toISOString(),
        created_by: textOrNull(row.created_by),
        revoked_at: textOrNull(row.revoked_at),
        revoked_by: textOrNull(row.revoked_by),
        last_used_at: textOrNull(row.last_used_at),
    };
}

function mapControlPlaneAction(row: Record<string, unknown>): ControlPlaneActionRecord {
    return {
        id: textOrNull(row.id) ?? cryptoRandomId(),
        actor: textOrNull(row.actor),
        action_type: textOrNull(row.action_type) ?? 'unknown',
        target_type: textOrNull(row.target_type),
        target_id: textOrNull(row.target_id),
        status: readActionStatus(row.status),
        requires_confirmation: booleanOrFalse(row.requires_confirmation),
        metadata: asRecord(row.metadata),
        created_at: textOrNull(row.created_at) ?? new Date().toISOString(),
    };
}

function mapControlPlaneAlert(row: Record<string, unknown>): ControlPlaneAlertRecord {
    const metadata = asRecord(row.metadata);
    return {
        id: textOrNull(row.alert_key) ?? textOrNull(row.id) ?? cryptoRandomId(),
        severity: readAlertSeverity(row.severity),
        source: textOrNull(metadata.category) ?? 'system',
        title: textOrNull(row.title) ?? 'Alert',
        message: textOrNull(row.message) ?? 'Unknown alert',
        node_id: textOrNull(row.node_id),
        timestamp: textOrNull(metadata.timestamp) ?? textOrNull(row.created_at) ?? new Date().toISOString(),
        resolved: booleanOrFalse(row.resolved),
        metadata,
    };
}

function mapTelemetryEvent(row: Record<string, unknown>): TelemetryEventRecord {
    return {
        event_id: textOrNull(row.event_id) ?? cryptoRandomId(),
        tenant_id: textOrNull(row.tenant_id) ?? '',
        linked_event_id: textOrNull(row.linked_event_id),
        source_id: textOrNull(row.source_id),
        source_table: textOrNull(row.source_table),
        event_type: readTelemetryEventType(row.event_type),
        timestamp: textOrNull(row.timestamp) ?? new Date().toISOString(),
        model_version: textOrNull(row.model_version) ?? 'unknown',
        run_id: textOrNull(row.run_id) ?? 'unknown',
        metrics: {
            latency_ms: numberOrNull(asRecord(row.metrics).latency_ms),
            confidence: numberOrNull(asRecord(row.metrics).confidence),
            prediction: textOrNull(asRecord(row.metrics).prediction),
            ground_truth: textOrNull(asRecord(row.metrics).ground_truth),
            correct: booleanOrNull(asRecord(row.metrics).correct),
        },
        system: {
            cpu: numberOrNull(asRecord(row.system).cpu),
            gpu: numberOrNull(asRecord(row.system).gpu),
            memory: numberOrNull(asRecord(row.system).memory),
        },
        metadata: asRecord(row.metadata),
        created_at: textOrNull(row.created_at) ?? new Date().toISOString(),
    };
}

async function findLatestEvaluationEventId(client: SupabaseClient, tenantId: string): Promise<string | null> {
    const C = MODEL_EVALUATION_EVENTS.COLUMNS;
    try {
        const { data, error } = await client
            .from(MODEL_EVALUATION_EVENTS.TABLE)
            .select(`${C.evaluation_event_id},${C.id}`)
            .eq(C.tenant_id, tenantId)
            .order(C.created_at, { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        const record = (data ?? null) as Record<string, unknown> | null;
        return record ? textOrNull(record.evaluation_event_id) ?? textOrNull(record.id) : null;
    } catch (error) {
        if (isMissingRelationError(error, MODEL_EVALUATION_EVENTS.TABLE)) {
            return null;
        }
        throw error;
    }
}

function classifyPipelineStatus(timestamp: string | null, alerts: TopologyAlert[], categories: string[], nodeId?: string) {
    if (!timestamp) return 'INITIALIZING' as const;
    const hasFailure = alerts.some((alert) =>
        categories.includes(alert.category)
        && alert.severity === 'critical'
        && (nodeId == null || alert.node_id === nodeId),
    );
    return hasFailure ? 'FAILED' : 'ACTIVE';
}

function collectAlertMessages(alerts: TopologyAlert[], categories: string[], nodeId?: string) {
    return alerts
        .filter((alert) => categories.includes(alert.category) && (nodeId == null || alert.node_id === nodeId))
        .map((alert) => alert.message)
        .slice(0, 4);
}

function ratePerMinute(timestamps: string[], minutes: number) {
    if (timestamps.length === 0) return null;
    const now = Date.now();
    const windowStart = now - (minutes * 60 * 1000);
    const count = timestamps.filter((timestamp) => {
        const value = new Date(timestamp).getTime();
        return Number.isFinite(value) && value >= windowStart;
    }).length;
    return Number((count / minutes).toFixed(2));
}

function formatTelemetryMessage(event: TelemetryEventRecord) {
    if (event.event_type === 'inference') {
        return `[INFERENCE] ${event.event_id} latency=${formatNumber(event.metrics.latency_ms)}ms confidence=${formatNumber(event.metrics.confidence)}`;
    }
    if (event.event_type === 'outcome') {
        return `[OUTCOME] ${event.event_id} correct=${String(event.metrics.correct)}`;
    }
    if (event.event_type === 'evaluation') {
        return `[EVALUATION] ${event.event_id} prediction=${event.metrics.prediction ?? 'unknown'} ground_truth=${event.metrics.ground_truth ?? 'unknown'}`;
    }
    if (event.event_type === 'simulation') {
        return `[SIMULATION] ${event.event_id} target=${textOrNull(event.metadata.target_node_id) ?? 'control_plane'} scenario=${textOrNull(event.metadata.scenario) ?? 'unknown'}`;
    }
    if (event.event_type === 'system') {
        const action = textOrNull(event.metadata.action) ?? 'control-plane';
        if (action === 'heartbeat') {
            return `[HEARTBEAT] ${textOrNull(event.metadata.target_node_id) ?? 'telemetry_observer'} source=${textOrNull(event.metadata.source_module) ?? 'control_plane'} interval_ms=${numberOrNull(event.metadata.heartbeat_interval_ms)?.toFixed(0) ?? '15000'}`;
        }
        if (action.startsWith('routing')) {
            return `[ROUTING] ${textOrNull(event.metadata.routing_decision_id) ?? event.event_id} model=${textOrNull(event.metadata.routing_selected_model_id) ?? textOrNull(event.metadata.routing_selected_model_name) ?? 'unknown'} mode=${textOrNull(event.metadata.routing_route_mode) ?? 'single'} fallback=${String(event.metadata.routing_fallback_used === true)}`;
        }
        return `[SYSTEM] ${event.event_id} action=${action}`;
    }
    return `[${event.event_type.toUpperCase()}] ${event.event_id}`;
}

function extractLatestTelemetrySourceId(events: TelemetryEventRecord[], sourceTable: string) {
    return events.find((event) => event.source_table === sourceTable)?.source_id ?? null;
}

function buildSimulationProfile(
    scenario: ControlPlaneSimulationScenario,
    severity: 'degraded' | 'critical',
    targetNodeId: string,
) {
    const isCritical = severity === 'critical';
    if (scenario === 'drift') {
        return {
            status: isCritical ? 'critical' : 'degraded',
            latency_ms: isCritical ? 1180 : 760,
            error_rate: isCritical ? 0.17 : 0.08,
            drift_score: isCritical ? 0.36 : 0.19,
            confidence_avg: isCritical ? 0.45 : 0.62,
            cpu: 0.72,
            gpu: 0.67,
            memory: 0.7,
            target_node_id: targetNodeId,
        };
    }
    if (scenario === 'adversarial_attack') {
        return {
            status: 'critical',
            latency_ms: 2480,
            error_rate: 0.24,
            drift_score: 0.28,
            confidence_avg: 0.39,
            cpu: 0.92,
            gpu: 0.89,
            memory: 0.85,
            target_node_id: targetNodeId,
        };
    }
    if (scenario === 'incorrect_outcome_burst') {
        return {
            status: isCritical ? 'critical' : 'degraded',
            latency_ms: isCritical ? 820 : 540,
            error_rate: isCritical ? 0.29 : 0.14,
            drift_score: isCritical ? 0.31 : 0.17,
            confidence_avg: isCritical ? 0.42 : 0.58,
            cpu: 0.58,
            gpu: 0.52,
            memory: 0.61,
            target_node_id: targetNodeId,
        };
    }
    return {
        status: isCritical ? 'critical' : 'degraded',
        latency_ms: isCritical ? 2250 : 980,
        error_rate: isCritical ? 0.18 : 0.09,
        drift_score: isCritical ? 0.14 : 0.07,
        confidence_avg: isCritical ? 0.47 : 0.64,
        cpu: isCritical ? 0.84 : 0.66,
        gpu: isCritical ? 0.76 : 0.56,
        memory: isCritical ? 0.8 : 0.63,
        target_node_id: targetNodeId,
    };
}

function extractPredictionLabel(output: Record<string, unknown>) {
    const diagnosis = asRecord(output.diagnosis);
    const topDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    const topDiagnosis = topDifferentials[0];
    if (typeof topDiagnosis === 'object' && topDiagnosis !== null) {
        const candidate = textOrNull((topDiagnosis as Record<string, unknown>).name);
        if (candidate) return candidate;
    }
    return textOrNull(diagnosis.primary_condition_class) ?? textOrNull(output.prediction);
}

function resolveOutcomeGroundTruth(outcome: Record<string, unknown>) {
    return textOrNull(outcome.confirmed_diagnosis)
        ?? textOrNull(outcome.final_diagnosis)
        ?? textOrNull(outcome.diagnosis)
        ?? textOrNull(outcome.primary_condition_class);
}

function readTelemetryEventType(value: unknown): TelemetryEventRecord['event_type'] {
    if (value === 'outcome' || value === 'evaluation' || value === 'simulation' || value === 'system' || value === 'training') {
        return value;
    }
    return 'inference';
}

function readActionStatus(value: unknown): ControlPlaneActionStatus {
    if (value === 'requested' || value === 'failed') return value;
    return 'completed';
}

function readAlertSeverity(value: unknown) {
    if (value === 'critical' || value === 'warning') return value;
    return 'info';
}

function readAlertSensitivity(value: unknown): ControlPlaneAlertSensitivity {
    if (value === 'low' || value === 'high') return value;
    return 'balanced';
}

function readDecisionMode(value: unknown): ControlPlaneConfiguration['decision_mode'] {
    return value === 'assist' || value === 'autonomous' ? value : 'observe';
}

function asStringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isMissingRelationError(error: unknown, relation: string) {
    const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message)
            : '';
    return message.includes(relation) && (
        message.includes('does not exist')
        || message.includes('Could not find table')
        || message.includes('relation')
    );
}

function textOrNull(value: unknown) {
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

function formatNumber(value: number | null | undefined) {
    return typeof value === 'number' ? value.toFixed(2) : 'n/a';
}

function cryptoRandomId() {
    return randomBytes(8).toString('hex');
}
