import type { LearningEngineStore } from '@/lib/learningEngine/types';

export async function logLearningAuditEvent(
    store: LearningEngineStore,
    input: {
        tenantId: string;
        learningCycleId?: string | null;
        eventType: string;
        payload: Record<string, unknown>;
    },
) {
    return store.createAuditEvent({
        tenant_id: input.tenantId,
        learning_cycle_id: input.learningCycleId ?? null,
        event_type: input.eventType,
        event_payload: input.payload,
    });
}

export async function logLearningDatasetSnapshot(
    store: LearningEngineStore,
    input: {
        tenantId: string;
        learningCycleId?: string | null;
        datasetVersion: string;
        summary: Record<string, unknown>;
        filters: Record<string, unknown>;
    },
) {
    return logLearningAuditEvent(store, {
        tenantId: input.tenantId,
        learningCycleId: input.learningCycleId,
        eventType: 'dataset_snapshot',
        payload: {
            dataset_version: input.datasetVersion,
            summary: input.summary,
            filters: input.filters,
        },
    });
}

export async function logLearningPromotionDecision(
    store: LearningEngineStore,
    input: {
        tenantId: string;
        learningCycleId?: string | null;
        candidateModelVersion: string;
        championModelVersion: string | null;
        decision: string;
        reasons: string[];
    },
) {
    return logLearningAuditEvent(store, {
        tenantId: input.tenantId,
        learningCycleId: input.learningCycleId,
        eventType: 'promotion_decision',
        payload: {
            candidate_model_version: input.candidateModelVersion,
            champion_model_version: input.championModelVersion,
            decision: input.decision,
            reasons: input.reasons,
        },
    });
}
