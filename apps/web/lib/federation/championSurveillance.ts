import type { SupabaseClient } from '@supabase/supabase-js';
import { executeRollback } from '@/lib/learningEngine/rollbackGuard';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import type {
    LearningEvaluationEvent,
    LearningRollbackEventRecord,
    LearningTaskType,
    ModelRegistryEntryRecord,
} from '@/lib/learningEngine/types';

export interface FederatedChampionSurveillanceThresholds {
    minimumOutcomeLinkedEvents: number;
    maximumErrorRate: number;
    maximumDangerousFalseNegativeRate: number;
    maximumMeanCalibrationError: number;
    maximumMeanDriftScore: number;
    maximumMeanSimulationDegradation: number;
    watchFraction: number;
}

export interface FederatedChampionSurveillanceDecision {
    model_registry_id: string;
    model_version: string;
    task_type: LearningTaskType;
    surveillance_status: 'healthy' | 'watch' | 'rollback_required' | 'insufficient_evidence';
    rollback_recommended: boolean;
    rollback_executed: boolean;
    rollback_event: LearningRollbackEventRecord | null;
    metrics: {
        evaluation_events: number;
        outcome_linked_events: number;
        scored_events: number;
        correct_events: number;
        error_rate: number | null;
        dangerous_false_negative_rate: number | null;
        mean_calibration_error: number | null;
        mean_drift_score: number | null;
        mean_simulation_degradation: number | null;
    };
    blockers: string[];
    warnings: string[];
    next_required_actions: string[];
}

export interface RunFederatedChampionSurveillanceResult {
    decision: FederatedChampionSurveillanceDecision;
    audit_event: Record<string, unknown>;
}

const DEFAULT_THRESHOLDS: FederatedChampionSurveillanceThresholds = {
    minimumOutcomeLinkedEvents: 10,
    maximumErrorRate: 0.2,
    maximumDangerousFalseNegativeRate: 0.05,
    maximumMeanCalibrationError: 0.18,
    maximumMeanDriftScore: 0.35,
    maximumMeanSimulationDegradation: 0.3,
    watchFraction: 0.75,
};

const HIGH_RISK_LABELS = new Set([
    'critical',
    'emergency',
    'urgent',
    'life_threatening',
    'severe',
    'high',
]);

export async function runFederatedChampionSurveillance(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        modelRegistryId?: string | null;
        modelVersion?: string | null;
        taskType?: LearningTaskType | null;
        executeRollback?: boolean;
        windowHours?: number | null;
        thresholds?: Partial<FederatedChampionSurveillanceThresholds>;
    },
): Promise<RunFederatedChampionSurveillanceResult> {
    const store = createSupabaseLearningEngineStore(client);
    const registryEntries = await store.listModelRegistryEntries(input.tenantId, input.taskType ?? null);
    const champion = selectFederatedChampion(registryEntries, {
        modelRegistryId: input.modelRegistryId ?? null,
        modelVersion: input.modelVersion ?? null,
        taskType: input.taskType ?? null,
    });

    if (!champion) {
        throw new Error('No matching federated champion model was found for surveillance.');
    }

    const since = input.windowHours && input.windowHours > 0
        ? new Date(Date.now() - input.windowHours * 60 * 60 * 1000).toISOString()
        : null;
    const evaluationEvents = await store.listEvaluationEvents({
        tenantId: input.tenantId,
        from: since,
        limit: 500,
    });
    const matchingEvents = evaluationEvents.filter((event) => event.model_version === champion.model_version);
    const baseDecision = buildFederatedChampionSurveillanceDecision({
        champion,
        evaluationEvents: matchingEvents,
        thresholds: input.thresholds,
    });

    const rollbackEvent = input.executeRollback === true && baseDecision.rollback_recommended
        ? await executeRollback(store, input.tenantId, {
            reason: `Federated champion surveillance required rollback for ${champion.model_version}: ${baseDecision.blockers.join('; ')}`,
            taskType: champion.task_type,
        })
        : null;
    const decision: FederatedChampionSurveillanceDecision = {
        ...baseDecision,
        rollback_executed: Boolean(rollbackEvent),
        rollback_event: rollbackEvent,
        next_required_actions: buildNextActions(baseDecision, Boolean(rollbackEvent), input.executeRollback === true),
    };
    const auditEvent = await store.createAuditEvent({
        tenant_id: input.tenantId,
        learning_cycle_id: null,
        event_type: 'federated_champion_surveillance',
        event_payload: {
            model_registry_id: champion.id,
            model_version: champion.model_version,
            task_type: champion.task_type,
            actor: input.actor ?? 'federation_champion_surveillance',
            window_hours: input.windowHours ?? null,
            thresholds: { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) },
            decision,
        },
    });

    return {
        decision,
        audit_event: auditEvent as unknown as Record<string, unknown>,
    };
}

export function buildFederatedChampionSurveillanceDecision(input: {
    champion: ModelRegistryEntryRecord;
    evaluationEvents: LearningEvaluationEvent[];
    thresholds?: Partial<FederatedChampionSurveillanceThresholds>;
}): FederatedChampionSurveillanceDecision {
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
    const scoredEvents = input.evaluationEvents.filter((event) => typeof event.prediction_correct === 'boolean');
    const correctEvents = scoredEvents.filter((event) => event.prediction_correct === true);
    const outcomeLinkedEvents = input.evaluationEvents.filter((event) =>
        Boolean(event.outcome_event_id)
        || Boolean(event.ground_truth)
        || typeof event.prediction_correct === 'boolean',
    );
    const dangerousFalseNegativeEvents = scoredEvents.filter(isDangerousFalseNegative);
    const errorRate = scoredEvents.length > 0 ? roundRatio(1 - (correctEvents.length / scoredEvents.length)) : null;
    const dangerousFalseNegativeRate = scoredEvents.length > 0 ? roundRatio(dangerousFalseNegativeEvents.length / scoredEvents.length) : null;
    const meanCalibrationError = roundNullable(mean(input.evaluationEvents.map((event) => event.calibration_error)));
    const meanDriftScore = roundNullable(mean(input.evaluationEvents.map((event) => event.drift_score)));
    const meanSimulationDegradation = roundNullable(mean(input.evaluationEvents.map((event) => event.simulation_degradation)));
    const blockers = new Set<string>();
    const warnings = new Set<string>();

    if (outcomeLinkedEvents.length < thresholds.minimumOutcomeLinkedEvents) {
        warnings.add('outcome_linked_surveillance_events_below_minimum');
    }
    if (exceeds(errorRate, thresholds.maximumErrorRate)) {
        blockers.add('error_rate_above_threshold');
    } else if (nearThreshold(errorRate, thresholds.maximumErrorRate, thresholds.watchFraction)) {
        warnings.add('error_rate_near_threshold');
    }
    if (exceeds(dangerousFalseNegativeRate, thresholds.maximumDangerousFalseNegativeRate)) {
        blockers.add('dangerous_false_negative_rate_above_threshold');
    } else if (nearThreshold(dangerousFalseNegativeRate, thresholds.maximumDangerousFalseNegativeRate, thresholds.watchFraction)) {
        warnings.add('dangerous_false_negative_rate_near_threshold');
    }
    if (exceeds(meanCalibrationError, thresholds.maximumMeanCalibrationError)) {
        blockers.add('calibration_error_above_threshold');
    } else if (nearThreshold(meanCalibrationError, thresholds.maximumMeanCalibrationError, thresholds.watchFraction)) {
        warnings.add('calibration_error_near_threshold');
    }
    if (exceeds(meanDriftScore, thresholds.maximumMeanDriftScore)) {
        blockers.add('drift_score_above_threshold');
    } else if (nearThreshold(meanDriftScore, thresholds.maximumMeanDriftScore, thresholds.watchFraction)) {
        warnings.add('drift_score_near_threshold');
    }
    if (exceeds(meanSimulationDegradation, thresholds.maximumMeanSimulationDegradation)) {
        blockers.add('simulation_degradation_above_threshold');
    } else if (nearThreshold(meanSimulationDegradation, thresholds.maximumMeanSimulationDegradation, thresholds.watchFraction)) {
        warnings.add('simulation_degradation_near_threshold');
    }

    let status: FederatedChampionSurveillanceDecision['surveillance_status'] = 'healthy';
    if (blockers.size > 0) {
        status = 'rollback_required';
    } else if (outcomeLinkedEvents.length < thresholds.minimumOutcomeLinkedEvents) {
        status = 'insufficient_evidence';
    } else if (warnings.size > 0) {
        status = 'watch';
    }

    return {
        model_registry_id: input.champion.id,
        model_version: input.champion.model_version,
        task_type: input.champion.task_type,
        surveillance_status: status,
        rollback_recommended: status === 'rollback_required',
        rollback_executed: false,
        rollback_event: null,
        metrics: {
            evaluation_events: input.evaluationEvents.length,
            outcome_linked_events: outcomeLinkedEvents.length,
            scored_events: scoredEvents.length,
            correct_events: correctEvents.length,
            error_rate: errorRate,
            dangerous_false_negative_rate: dangerousFalseNegativeRate,
            mean_calibration_error: meanCalibrationError,
            mean_drift_score: meanDriftScore,
            mean_simulation_degradation: meanSimulationDegradation,
        },
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        next_required_actions: buildNextActions({
            surveillance_status: status,
            rollback_recommended: status === 'rollback_required',
            blockers: Array.from(blockers).sort(),
            warnings: Array.from(warnings).sort(),
        }, false, false),
    };
}

function selectFederatedChampion(
    entries: ModelRegistryEntryRecord[],
    input: {
        modelRegistryId: string | null;
        modelVersion: string | null;
        taskType: LearningTaskType | null;
    },
): ModelRegistryEntryRecord | null {
    const candidates = entries.filter((entry) =>
        entry.is_champion
        && (input.modelRegistryId ? entry.id === input.modelRegistryId : true)
        && (input.modelVersion ? entry.model_version === input.modelVersion : true)
        && (input.taskType ? entry.task_type === input.taskType : true)
        && isFederatedModel(entry),
    );
    return candidates[0] ?? null;
}

function isFederatedModel(entry: ModelRegistryEntryRecord): boolean {
    return readText(entry.artifact_payload.federation_round_id) != null
        || readText(entry.artifact_payload.federation_key) != null
        || entry.model_version.startsWith('fed-')
        || entry.training_dataset_version.startsWith('federated:');
}

function buildNextActions(
    decision: Pick<FederatedChampionSurveillanceDecision, 'surveillance_status' | 'rollback_recommended' | 'blockers' | 'warnings'>,
    rollbackExecuted: boolean,
    rollbackRequested: boolean,
): string[] {
    const actions = new Set<string>();
    if (decision.surveillance_status === 'healthy') {
        actions.add('continue_outcome_linked_surveillance');
    }
    if (decision.surveillance_status === 'watch') {
        actions.add('increase_outcome_review_sampling');
        actions.add('run_benchmark_calibration_adversarial_and_regression_evidence');
    }
    if (decision.surveillance_status === 'insufficient_evidence') {
        actions.add('collect_more_outcome_linked_evaluation_events');
    }
    if (decision.rollback_recommended) {
        actions.add(rollbackRequested ? 'rollback_requested_by_operator' : 'operator_review_required_before_rollback');
        actions.add('freeze_federated_champion_expansion_until_reviewed');
    }
    if (rollbackExecuted) {
        actions.add('rollback_executed_record_incident_review');
    }
    for (const warning of decision.warnings) {
        if (warning.includes('near_threshold')) {
            actions.add('tighten_monitoring_window');
        }
    }
    return Array.from(actions).sort();
}

function isDangerousFalseNegative(event: LearningEvaluationEvent): boolean {
    if (event.prediction_correct !== false) return false;
    const trueSeverity = normalizeRiskLabel(event.severity_true ?? event.condition_class_true ?? event.ground_truth);
    const predictedSeverity = normalizeRiskLabel(event.severity_pred ?? event.condition_class_pred ?? event.prediction);
    return trueSeverity != null
        && HIGH_RISK_LABELS.has(trueSeverity)
        && (predictedSeverity == null || !HIGH_RISK_LABELS.has(predictedSeverity));
}

function normalizeRiskLabel(value: string | null): string | null {
    if (!value) return null;
    return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function mean(values: Array<number | null>): number | null {
    const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (numbers.length === 0) return null;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function roundNullable(value: number | null): number | null {
    return value == null ? null : roundRatio(value);
}

function roundRatio(value: number): number {
    return Number(value.toFixed(4));
}

function exceeds(value: number | null, threshold: number): boolean {
    return value != null && value > threshold;
}

function nearThreshold(value: number | null, threshold: number, fraction: number): boolean {
    return value != null && value >= threshold * fraction && value <= threshold;
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
