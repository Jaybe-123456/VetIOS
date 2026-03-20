import {
    type LearningEngineStore,
    type LearningRollbackEventRecord,
    type LearningTaskType,
    type RollbackGuardResult,
} from '@/lib/learningEngine/types';

export async function evaluateRollbackGuard(
    store: LearningEngineStore,
    tenantId: string,
    input: {
        calibrationFailure?: boolean;
        adversarialFailure?: boolean;
        dangerousFalseNegativeSpike?: boolean;
    } = {},
): Promise<RollbackGuardResult> {
    const [evaluations, registryEntries] = await Promise.all([
        store.listEvaluationEvents({ tenantId, limit: 50 }),
        store.listModelRegistryEntries(tenantId),
    ]);

    const reasons: string[] = [];
    const recentCalibrationErrors = evaluations
        .map((event) => event.calibration_error)
        .filter((value): value is number => typeof value === 'number');
    const recentDriftScores = evaluations
        .map((event) => event.drift_score)
        .filter((value): value is number => typeof value === 'number');
    const recentSimulationDegradation = evaluations
        .map((event) => event.simulation_degradation)
        .filter((value): value is number => typeof value === 'number');

    if (input.calibrationFailure || mean(recentCalibrationErrors) > 0.25) {
        reasons.push('Calibration error exceeded rollback threshold.');
    }
    if (mean(recentDriftScores) > 0.35) {
        reasons.push('Model drift exceeded rollback threshold.');
    }
    if (input.adversarialFailure || mean(recentSimulationDegradation) > 0.3) {
        reasons.push('Adversarial degradation exceeded rollback threshold.');
    }
    if (input.dangerousFalseNegativeSpike) {
        reasons.push('Dangerous false negative spike detected.');
    }

    const rollbackTarget = selectRollbackTarget(registryEntries);
    return {
        should_rollback: reasons.length > 0,
        reasons,
        rollback_target_model_registry_id: rollbackTarget?.id ?? null,
    };
}

export async function executeRollback(
    store: LearningEngineStore,
    tenantId: string,
    input: {
        reason: string;
        learningCycleId?: string | null;
        taskType?: LearningTaskType | null;
    },
): Promise<LearningRollbackEventRecord | null> {
    const registryEntries = await store.listModelRegistryEntries(tenantId, input.taskType ?? null);
    const currentChampion = registryEntries.find((entry) => entry.is_champion);
    const rollbackTarget = selectRollbackTarget(registryEntries, currentChampion?.task_type ?? input.taskType ?? null);

    if (!currentChampion || !rollbackTarget) {
        return null;
    }

    await store.updateModelRegistryEntry(currentChampion.id, tenantId, {
        is_champion: false,
        promotion_status: 'rolled_back',
    });
    await store.updateModelRegistryEntry(rollbackTarget.id, tenantId, {
        is_champion: true,
        promotion_status: 'champion',
    });

    return store.createRollbackEvent({
        tenant_id: tenantId,
        learning_cycle_id: input.learningCycleId ?? null,
        previous_model_registry_id: currentChampion.id,
        restored_model_registry_id: rollbackTarget.id,
        trigger_reason: input.reason,
        trigger_payload: {
            task_type: rollbackTarget.task_type,
            restored_model_version: rollbackTarget.model_version,
        },
    });
}

function selectRollbackTarget(
    entries: Awaited<ReturnType<LearningEngineStore['listModelRegistryEntries']>>,
    taskType: LearningTaskType | null = null,
) {
    return entries
        .filter((entry) =>
            !entry.is_champion &&
            entry.promotion_status !== 'rejected' &&
            entry.promotion_status !== 'rolled_back' &&
            (taskType ? entry.task_type === taskType : true),
        )
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null;
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
