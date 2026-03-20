import {
    type BenchmarkSummary,
    type DiagnosisModelArtifact,
    type LearningEngineStore,
    type LearningTaskType,
    type ModelPromotionDecision,
    type ModelRegistryEntryRecord,
    type SeverityModelArtifact,
} from '@/lib/learningEngine/types';

export interface CandidateModelRegistrationInput {
    tenantId: string;
    diagnosisArtifact: DiagnosisModelArtifact | null;
    severityArtifact: SeverityModelArtifact | null;
    benchmarkSummary: BenchmarkSummary | null;
    labelPolicyVersion: string;
    featureSchemaVersion: string;
    latencyProfile?: Record<string, unknown> | null;
    resourceProfile?: Record<string, unknown> | null;
}

export async function getChampionRegistryEntries(
    store: LearningEngineStore,
    tenantId: string,
): Promise<Record<LearningTaskType, ModelRegistryEntryRecord | null>> {
    const entries = await store.listModelRegistryEntries(tenantId);
    return {
        diagnosis: entries.find((entry) => entry.task_type === 'diagnosis' && entry.is_champion) ?? null,
        severity: entries.find((entry) => entry.task_type === 'severity' && entry.is_champion) ?? null,
        hybrid: entries.find((entry) => entry.task_type === 'hybrid' && entry.is_champion) ?? null,
    };
}

export async function registerCandidateModels(
    store: LearningEngineStore,
    input: CandidateModelRegistrationInput,
): Promise<ModelRegistryEntryRecord[]> {
    const created: ModelRegistryEntryRecord[] = [];

    if (input.diagnosisArtifact) {
        created.push(await store.createModelRegistryEntry({
            tenant_id: input.tenantId,
            model_name: input.diagnosisArtifact.model_name,
            model_version: input.diagnosisArtifact.model_version,
            task_type: 'diagnosis',
            training_dataset_version: input.diagnosisArtifact.dataset_version,
            feature_schema_version: input.featureSchemaVersion,
            label_policy_version: input.labelPolicyVersion,
            artifact_payload: toJsonRecord(input.diagnosisArtifact),
            benchmark_scorecard: input.benchmarkSummary?.scorecard ?? {},
            calibration_report_id: null,
            promotion_status: 'candidate',
            is_champion: false,
            latency_profile: input.latencyProfile ?? null,
            resource_profile: input.resourceProfile ?? null,
            parent_model_version: null,
        }));
    }

    if (input.severityArtifact) {
        created.push(await store.createModelRegistryEntry({
            tenant_id: input.tenantId,
            model_name: input.severityArtifact.model_name,
            model_version: input.severityArtifact.model_version,
            task_type: 'severity',
            training_dataset_version: input.severityArtifact.dataset_version,
            feature_schema_version: input.featureSchemaVersion,
            label_policy_version: input.labelPolicyVersion,
            artifact_payload: toJsonRecord(input.severityArtifact),
            benchmark_scorecard: input.benchmarkSummary?.scorecard ?? {},
            calibration_report_id: null,
            promotion_status: 'candidate',
            is_champion: false,
            latency_profile: input.latencyProfile ?? null,
            resource_profile: input.resourceProfile ?? null,
            parent_model_version: null,
        }));
    }

    return created;
}

export async function applyPromotionDecisionToRegistry(
    store: LearningEngineStore,
    tenantId: string,
    entries: ModelRegistryEntryRecord[],
    decision: ModelPromotionDecision,
): Promise<ModelRegistryEntryRecord[]> {
    if (entries.length === 0) return [];

    const currentChampions = await getChampionRegistryEntries(store, tenantId);
    const updated: ModelRegistryEntryRecord[] = [];

    for (const entry of entries) {
        const currentChampion = currentChampions[entry.task_type];
        if (decision === 'promote') {
            if (currentChampion?.id && currentChampion.id !== entry.id) {
                await store.updateModelRegistryEntry(currentChampion.id, tenantId, {
                    is_champion: false,
                    promotion_status: 'archived',
                });
            }
            updated.push(await store.updateModelRegistryEntry(entry.id, tenantId, {
                is_champion: true,
                promotion_status: 'champion',
            }));
            continue;
        }

        updated.push(await store.updateModelRegistryEntry(entry.id, tenantId, {
            is_champion: false,
            promotion_status: decision === 'hold' ? 'challenger' : 'rejected',
        }));
    }

    return updated;
}

export function decodeDiagnosisArtifact(
    payload: Record<string, unknown> | null,
): DiagnosisModelArtifact | null {
    if (!payload || payload.task_type !== 'diagnosis' || !Array.isArray(payload.labels)) {
        return null;
    }
    return payload as unknown as DiagnosisModelArtifact;
}

export function decodeSeverityArtifact(
    payload: Record<string, unknown> | null,
): SeverityModelArtifact | null {
    if (!payload || payload.task_type !== 'severity' || typeof payload.average_severity !== 'number') {
        return null;
    }
    return payload as unknown as SeverityModelArtifact;
}

function toJsonRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    throw new Error('Model artifact payload must be a JSON object.');
}
