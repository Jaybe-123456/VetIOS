import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seedExperimentTrackingBootstrap } from '../../apps/web/lib/experiments/bootstrap.ts';
import {
    applyExperimentRegistryAction,
    backfillSummaryExperimentRuns,
    buildExperimentMetricSeries,
    createExperimentRun,
    getEmptyMetricStateMessage,
    getExperimentComparison,
    getExperimentDashboardSnapshot,
    getModelRegistryControlPlaneSnapshot,
    getExperimentRunDetail,
    RegistryControlPlaneError,
    logExperimentMetrics,
    recordExperimentFailure,
    upsertAdversarialEvaluation,
    upsertCalibrationEvaluation,
    updateExperimentHeartbeat,
    verifyModelRegistryControlPlane,
} from '../../apps/web/lib/experiments/service.ts';
import type {
    AdversarialMetricRecord,
    CalibrationMetricRecord,
    DeploymentDecisionRecord,
    ExperimentArtifactRecord,
    ExperimentAuditEventRecord,
    ExperimentBenchmarkRecord,
    ExperimentFailureRecord,
    ExperimentMetricRecord,
    ExperimentRegistryLinkRecord,
    ExperimentRunRecord,
    ExperimentTrackingStore,
    ListExperimentRunsOptions,
    ModelRegistryRecord,
    PromotionRequirementsRecord,
    RegistryAuditLogRecord,
    RegistryRoutingPointerRecord,
    SubgroupMetricRecord,
} from '../../apps/web/lib/experiments/types.ts';

class InMemoryExperimentTrackingStore implements ExperimentTrackingStore {
    runs: ExperimentRunRecord[] = [];
    metrics: ExperimentMetricRecord[] = [];
    artifacts: ExperimentArtifactRecord[] = [];
    failures: ExperimentFailureRecord[] = [];
    benchmarks: ExperimentBenchmarkRecord[] = [];
    registryLinks: ExperimentRegistryLinkRecord[] = [];
    modelRegistry: ModelRegistryRecord[] = [];
    calibrationMetrics: CalibrationMetricRecord[] = [];
    adversarialMetrics: AdversarialMetricRecord[] = [];
    deploymentDecisions: DeploymentDecisionRecord[] = [];
    subgroupMetrics: SubgroupMetricRecord[] = [];
    auditEvents: ExperimentAuditEventRecord[] = [];
    promotionRequirements: PromotionRequirementsRecord[] = [];
    registryAuditLog: RegistryAuditLogRecord[] = [];
    registryRoutingPointers: RegistryRoutingPointerRecord[] = [];
    registryEntries: Array<Awaited<ReturnType<ExperimentTrackingStore['listModelRegistryEntries']>>[number]> = [];
    datasetVersions: Array<Awaited<ReturnType<ExperimentTrackingStore['listLearningDatasetVersions']>>[number]> = [];
    learningBenchmarks: Array<Awaited<ReturnType<ExperimentTrackingStore['listLearningBenchmarkReports']>>[number]> = [];
    learningCalibrations: Array<Awaited<ReturnType<ExperimentTrackingStore['listLearningCalibrationReports']>>[number]> = [];
    learningAudits: Array<Awaited<ReturnType<ExperimentTrackingStore['listLearningAuditEvents']>>[number]> = [];

    async listExperimentRuns(tenantId: string, options: ListExperimentRunsOptions = {}) {
        let rows = this.runs.filter((run) => run.tenant_id === tenantId);
        if (options.includeSummaryOnly === false) {
            rows = rows.filter((run) => !run.summary_only);
        }
        if (options.statuses?.length) {
            rows = rows.filter((run) => options.statuses?.includes(run.status));
        }
        return rows
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
            .slice(0, options.limit ?? 200)
            .map(clone);
    }

    async getExperimentRun(tenantId: string, runId: string) {
        const run = this.runs.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return run ? clone(run) : null;
    }

    async createExperimentRun(record: Omit<ExperimentRunRecord, 'id' | 'created_at' | 'updated_at'>) {
        const now = new Date().toISOString();
        const created: ExperimentRunRecord = {
            ...record,
            id: randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.runs.push(created);
        return clone(created);
    }

    async updateExperimentRun(runId: string, tenantId: string, patch: Partial<Omit<ExperimentRunRecord, 'id' | 'tenant_id' | 'run_id' | 'created_at'>>) {
        const run = this.runs.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        if (!run) throw new Error(`Experiment run not found: ${runId}`);
        Object.assign(run, patch, { updated_at: new Date().toISOString() });
        return clone(run);
    }

    async listExperimentMetrics(tenantId: string, runId: string, limit = 1_000) {
        return this.metrics
            .filter((row) => row.tenant_id === tenantId && row.run_id === runId)
            .sort((left, right) => left.metric_timestamp.localeCompare(right.metric_timestamp))
            .slice(0, limit)
            .map(clone);
    }

    async createExperimentMetrics(records: Array<Omit<ExperimentMetricRecord, 'id' | 'created_at'>>) {
        const created = records.map((record) => ({
            ...record,
            id: randomUUID(),
            created_at: new Date().toISOString(),
        }));
        this.metrics.push(...created);
        return created.map(clone);
    }

    async listExperimentArtifacts(tenantId: string, runId: string) {
        return this.artifacts.filter((row) => row.tenant_id === tenantId && row.run_id === runId).map(clone);
    }

    async upsertExperimentArtifact(record: Omit<ExperimentArtifactRecord, 'id' | 'created_at'> & { id?: string }) {
        const existing = record.id
            ? this.artifacts.find((row) => row.id === record.id)
            : undefined;
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: ExperimentArtifactRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: new Date().toISOString(),
        };
        this.artifacts.push(created);
        return clone(created);
    }

    async getExperimentFailure(tenantId: string, runId: string) {
        const failure = this.failures.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return failure ? clone(failure) : null;
    }

    async upsertExperimentFailure(record: Omit<ExperimentFailureRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.failures.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: ExperimentFailureRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.failures.push(created);
        return clone(created);
    }

    async listExperimentBenchmarks(tenantId: string, runId: string) {
        return this.benchmarks.filter((row) => row.tenant_id === tenantId && row.run_id === runId).map(clone);
    }

    async upsertExperimentBenchmark(record: Omit<ExperimentBenchmarkRecord, 'id' | 'created_at'> & { id?: string }) {
        const existing = this.benchmarks.find((row) =>
            row.tenant_id === record.tenant_id &&
            row.run_id === record.run_id &&
            row.benchmark_family === record.benchmark_family,
        );
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: ExperimentBenchmarkRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: new Date().toISOString(),
        };
        this.benchmarks.push(created);
        return clone(created);
    }

    async getExperimentRegistryLink(tenantId: string, runId: string) {
        const link = this.registryLinks.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return link ? clone(link) : null;
    }

    async upsertExperimentRegistryLink(record: Omit<ExperimentRegistryLinkRecord, 'id' | 'linked_at' | 'updated_at'> & { id?: string }) {
        const existing = this.registryLinks.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: ExperimentRegistryLinkRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            linked_at: now,
            updated_at: now,
        };
        this.registryLinks.push(created);
        return clone(created);
    }

    async getModelRegistryForRun(tenantId: string, runId: string) {
        const record = this.modelRegistry.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async listModelRegistry(tenantId: string) {
        return this.modelRegistry
            .filter((row) => row.tenant_id === tenantId)
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
            .map(clone);
    }

    async upsertModelRegistry(record: Omit<ModelRegistryRecord, 'created_at' | 'updated_at'>) {
        const existing = this.modelRegistry.find((row) => row.registry_id === record.registry_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: ModelRegistryRecord = {
            ...record,
            created_at: now,
            updated_at: now,
        };
        this.modelRegistry.push(created);
        return clone(created);
    }

    async getPromotionRequirements(tenantId: string, runId: string) {
        const record = this.promotionRequirements.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async listPromotionRequirements(tenantId: string) {
        return this.promotionRequirements
            .filter((row) => row.tenant_id === tenantId)
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
            .map(clone);
    }

    async upsertPromotionRequirements(record: Omit<PromotionRequirementsRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.promotionRequirements.find((row) =>
            row.tenant_id === record.tenant_id &&
            row.run_id === record.run_id,
        );
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: PromotionRequirementsRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.promotionRequirements.push(created);
        return clone(created);
    }

    async getCalibrationMetrics(tenantId: string, runId: string) {
        const record = this.calibrationMetrics.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async upsertCalibrationMetrics(record: Omit<CalibrationMetricRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.calibrationMetrics.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: CalibrationMetricRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.calibrationMetrics.push(created);
        return clone(created);
    }

    async getAdversarialMetrics(tenantId: string, runId: string) {
        const record = this.adversarialMetrics.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async upsertAdversarialMetrics(record: Omit<AdversarialMetricRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.adversarialMetrics.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: AdversarialMetricRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.adversarialMetrics.push(created);
        return clone(created);
    }

    async getDeploymentDecision(tenantId: string, runId: string) {
        const record = this.deploymentDecisions.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async upsertDeploymentDecision(record: Omit<DeploymentDecisionRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.deploymentDecisions.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: DeploymentDecisionRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.deploymentDecisions.push(created);
        return clone(created);
    }

    async listSubgroupMetrics(tenantId: string, runId: string) {
        return this.subgroupMetrics
            .filter((row) => row.tenant_id === tenantId && row.run_id === runId)
            .map(clone);
    }

    async upsertSubgroupMetric(record: Omit<SubgroupMetricRecord, 'id' | 'created_at'> & { id?: string }) {
        const existing = this.subgroupMetrics.find((row) =>
            row.tenant_id === record.tenant_id &&
            row.run_id === record.run_id &&
            row.group === record.group &&
            row.group_value === record.group_value &&
            row.metric === record.metric,
        );
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: SubgroupMetricRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: new Date().toISOString(),
        };
        this.subgroupMetrics.push(created);
        return clone(created);
    }

    async listAuditLog(tenantId: string, limit = 200) {
        return this.auditEvents
            .filter((row) => row.tenant_id === tenantId)
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, limit)
            .map(clone);
    }

    async createAuditLog(record: Omit<ExperimentAuditEventRecord, 'created_at'>) {
        const existing = this.auditEvents.find((row) => row.event_id === record.event_id);
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: ExperimentAuditEventRecord = {
            ...record,
            created_at: new Date().toISOString(),
        };
        this.auditEvents.push(created);
        return clone(created);
    }

    async listRegistryAuditLog(tenantId: string, limit = 200) {
        return this.registryAuditLog
            .filter((row) => row.tenant_id === tenantId)
            .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
            .slice(0, limit)
            .map(clone);
    }

    async createRegistryAuditLog(record: Omit<RegistryAuditLogRecord, 'created_at'>) {
        const existing = this.registryAuditLog.find((row) => row.event_id === record.event_id);
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: RegistryAuditLogRecord = {
            ...record,
            created_at: new Date().toISOString(),
        };
        this.registryAuditLog.push(created);
        return clone(created);
    }

    async listRegistryRoutingPointers(tenantId: string) {
        return this.registryRoutingPointers
            .filter((row) => row.tenant_id === tenantId)
            .sort((left, right) => left.model_family.localeCompare(right.model_family))
            .map(clone);
    }

    async upsertRegistryRoutingPointer(record: Omit<RegistryRoutingPointerRecord, 'id' | 'updated_at'> & { id?: string }) {
        const existing = this.registryRoutingPointers.find((row) =>
            row.tenant_id === record.tenant_id &&
            row.model_family === record.model_family,
        );
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const created: RegistryRoutingPointerRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            updated_at: new Date().toISOString(),
        };
        this.registryRoutingPointers.push(created);
        return clone(created);
    }

    async promoteRegistryToProduction(input: {
        tenantId: string;
        runId: string;
        actor: string | null;
    }) {
        const now = new Date().toISOString();
        const target = this.modelRegistry.find((row) => row.tenant_id === input.tenantId && row.run_id === input.runId);
        if (!target) {
            throw new Error(`Model registry entry not found for run ${input.runId}.`);
        }

        const requirements = this.promotionRequirements.find((row) => row.tenant_id === input.tenantId && row.run_id === input.runId);
        const promotionAllowed = requirements?.calibration_pass === true &&
            requirements.adversarial_pass === true &&
            requirements.safety_pass === true &&
            requirements.benchmark_pass === true &&
            requirements.manual_approval === true;
        if (!promotionAllowed) {
            throw new Error(`Promotion requirements are not satisfied for registry ${target.registry_id}.`);
        }

        const previousChampion = this.modelRegistry.find((row) =>
            row.tenant_id === input.tenantId &&
            row.model_family === target.model_family &&
            row.lifecycle_status === 'production' &&
            row.registry_role === 'champion' &&
            row.registry_id !== target.registry_id,
        );

        if (previousChampion) {
            Object.assign(previousChampion, {
                lifecycle_status: 'archived',
                registry_role: 'rollback_target',
                status: 'archived',
                role: 'rollback_target',
                archived_at: now,
                rollback_metadata: null,
                updated_at: now,
            } satisfies Partial<ModelRegistryRecord>);

            const previousRun = this.runs.find((row) => row.tenant_id === input.tenantId && row.run_id === previousChampion.run_id);
            if (previousRun) {
                previousRun.registry_context = {
                    ...previousRun.registry_context,
                    registry_id: previousChampion.registry_id,
                    registry_link_state: 'linked',
                    registry_status: 'archived',
                    registry_role: 'rollback_target',
                    champion_or_challenger: 'rollback_target',
                    promotion_status: 'archived',
                    rollback_target: null,
                    model_family: previousChampion.model_family,
                };
                previousRun.updated_at = now;
            }

            const previousLink = this.registryLinks.find((row) => row.tenant_id === input.tenantId && row.run_id === previousChampion.run_id);
            if (previousLink) {
                Object.assign(previousLink, {
                    registry_candidate_id: previousChampion.registry_id,
                    champion_or_challenger: 'rollback_target',
                    promotion_status: 'archived',
                    deployment_eligibility: 'blocked',
                    updated_at: now,
                } satisfies Partial<ExperimentRegistryLinkRecord>);
            }

            await this.createRegistryAuditLog({
                event_id: `evt_archived_${previousChampion.registry_id}_${now}`,
                tenant_id: input.tenantId,
                registry_id: previousChampion.registry_id,
                run_id: previousChampion.run_id,
                event_type: 'archived',
                timestamp: now,
                actor: input.actor,
                metadata: {
                    reason: 'superseded_by_promotion',
                    replaced_by: target.registry_id,
                    model_family: previousChampion.model_family,
                },
            });
        }

        Object.assign(target, {
            lifecycle_status: 'production',
            registry_role: 'champion',
            status: 'production',
            role: 'champion',
            deployed_at: now,
            archived_at: null,
            promoted_from: previousChampion?.registry_id ?? target.promoted_from,
            rollback_target: previousChampion?.registry_id ?? target.rollback_target,
            rollback_metadata: null,
            artifact_path: target.artifact_uri ?? target.artifact_path,
            updated_at: now,
        } satisfies Partial<ModelRegistryRecord>);

        await this.upsertRegistryRoutingPointer({
            tenant_id: input.tenantId,
            model_family: target.model_family,
            active_registry_id: target.registry_id,
            active_run_id: target.run_id,
            updated_by: input.actor,
        });

        const promotedRun = this.runs.find((row) => row.tenant_id === input.tenantId && row.run_id === target.run_id);
        if (promotedRun) {
            promotedRun.status = 'promoted';
            promotedRun.registry_id = target.registry_id;
            promotedRun.registry_context = {
                ...promotedRun.registry_context,
                registry_id: target.registry_id,
                registry_link_state: 'linked',
                registry_status: 'production',
                registry_role: 'champion',
                champion_or_challenger: 'champion',
                promotion_status: 'production',
                rollback_target: previousChampion?.registry_id ?? null,
                model_family: target.model_family,
                active_routing_registry_id: target.registry_id,
            };
            promotedRun.updated_at = now;
        }

        const targetLink = this.registryLinks.find((row) => row.tenant_id === input.tenantId && row.run_id === target.run_id);
        if (targetLink) {
            Object.assign(targetLink, {
                registry_candidate_id: target.registry_id,
                champion_or_challenger: 'champion',
                promotion_status: 'production',
                benchmark_status: requirements?.benchmark_pass === true ? 'passed' : 'failed',
                manual_approval_status: 'passed',
                deployment_eligibility: 'eligible_review',
                updated_at: now,
            } satisfies Partial<ExperimentRegistryLinkRecord>);
        }

        await this.createRegistryAuditLog({
            event_id: `evt_promoted_${target.registry_id}_${now}`,
            tenant_id: input.tenantId,
            registry_id: target.registry_id,
            run_id: target.run_id,
            event_type: 'promoted',
            timestamp: now,
            actor: input.actor,
            metadata: {
                promoted_from: previousChampion?.registry_id ?? null,
                rollback_target: previousChampion?.registry_id ?? null,
                model_family: target.model_family,
            },
        });

        return clone(target);
    }

    async rollbackRegistryToTarget(input: {
        tenantId: string;
        runId: string;
        actor: string | null;
        reason: string;
        incidentId?: string | null;
    }) {
        const now = new Date().toISOString();
        const currentChampion = this.modelRegistry.find((row) =>
            row.tenant_id === input.tenantId &&
            row.run_id === input.runId &&
            row.lifecycle_status === 'production' &&
            row.registry_role === 'champion',
        );
        if (!currentChampion) {
            throw new Error(`Active production registry entry not found for run ${input.runId}.`);
        }

        const restoreTarget = (currentChampion.rollback_target
            ? this.modelRegistry.find((row) => row.tenant_id === input.tenantId && row.registry_id === currentChampion.rollback_target)
            : undefined)
            ?? this.modelRegistry
                .filter((row) =>
                    row.tenant_id === input.tenantId &&
                    row.model_family === currentChampion.model_family &&
                    row.registry_role === 'rollback_target',
                )
                .sort((left, right) => (right.deployed_at ?? right.updated_at ?? right.created_at).localeCompare(left.deployed_at ?? left.updated_at ?? left.created_at))[0];

        if (!restoreTarget) {
            throw new Error(`No rollback target exists for registry ${currentChampion.registry_id}.`);
        }

        const rollbackMetadata = {
            triggered_at: now,
            triggered_by: input.actor,
            reason: input.reason,
            incident_id: input.incidentId ?? null,
        };

        Object.assign(currentChampion, {
            lifecycle_status: 'archived',
            registry_role: 'experimental',
            status: 'archived',
            role: 'experimental',
            archived_at: now,
            rollback_metadata: rollbackMetadata,
            updated_at: now,
        } satisfies Partial<ModelRegistryRecord>);

        Object.assign(restoreTarget, {
            lifecycle_status: 'production',
            registry_role: 'champion',
            status: 'production',
            role: 'champion',
            deployed_at: now,
            archived_at: null,
            promoted_from: currentChampion.registry_id,
            rollback_target: currentChampion.registry_id,
            rollback_metadata: null,
            artifact_path: restoreTarget.artifact_uri ?? restoreTarget.artifact_path,
            updated_at: now,
        } satisfies Partial<ModelRegistryRecord>);

        await this.upsertRegistryRoutingPointer({
            tenant_id: input.tenantId,
            model_family: restoreTarget.model_family,
            active_registry_id: restoreTarget.registry_id,
            active_run_id: restoreTarget.run_id,
            updated_by: input.actor,
        });

        const rolledBackRun = this.runs.find((row) => row.tenant_id === input.tenantId && row.run_id === currentChampion.run_id);
        if (rolledBackRun) {
            rolledBackRun.status = 'rolled_back';
            rolledBackRun.registry_id = currentChampion.registry_id;
            rolledBackRun.registry_context = {
                ...rolledBackRun.registry_context,
                registry_id: currentChampion.registry_id,
                registry_link_state: 'linked',
                registry_status: 'archived',
                registry_role: 'experimental',
                champion_or_challenger: 'experimental',
                promotion_status: 'archived',
                rollback_target: restoreTarget.registry_id,
                model_family: currentChampion.model_family,
            };
            rolledBackRun.updated_at = now;
        }

        const restoredRun = this.runs.find((row) => row.tenant_id === input.tenantId && row.run_id === restoreTarget.run_id);
        if (restoredRun) {
            restoredRun.status = 'promoted';
            restoredRun.registry_id = restoreTarget.registry_id;
            restoredRun.registry_context = {
                ...restoredRun.registry_context,
                registry_id: restoreTarget.registry_id,
                registry_link_state: 'linked',
                registry_status: 'production',
                registry_role: 'champion',
                champion_or_challenger: 'champion',
                promotion_status: 'production',
                rollback_target: currentChampion.registry_id,
                model_family: restoreTarget.model_family,
                active_routing_registry_id: restoreTarget.registry_id,
            };
            restoredRun.updated_at = now;
        }

        const currentLink = this.registryLinks.find((row) => row.tenant_id === input.tenantId && row.run_id === currentChampion.run_id);
        if (currentLink) {
            Object.assign(currentLink, {
                registry_candidate_id: currentChampion.registry_id,
                champion_or_challenger: 'experimental',
                promotion_status: 'archived',
                deployment_eligibility: 'blocked',
                updated_at: now,
            } satisfies Partial<ExperimentRegistryLinkRecord>);
        }

        const restoreLink = this.registryLinks.find((row) => row.tenant_id === input.tenantId && row.run_id === restoreTarget.run_id);
        if (restoreLink) {
            Object.assign(restoreLink, {
                registry_candidate_id: restoreTarget.registry_id,
                champion_or_challenger: 'champion',
                promotion_status: 'production',
                deployment_eligibility: 'eligible_review',
                updated_at: now,
            } satisfies Partial<ExperimentRegistryLinkRecord>);
        }

        await this.createRegistryAuditLog({
            event_id: `evt_rollback_${currentChampion.registry_id}_${now}`,
            tenant_id: input.tenantId,
            registry_id: restoreTarget.registry_id,
            run_id: restoreTarget.run_id,
            event_type: 'rolled_back',
            timestamp: now,
            actor: input.actor,
            metadata: {
                restored_from: currentChampion.registry_id,
                rollback_metadata: rollbackMetadata,
                reason: input.reason,
                incident_id: input.incidentId ?? null,
            },
        });

        return clone(restoreTarget);
    }

    async listModelRegistryEntries(tenantId: string) {
        return this.registryEntries.filter((entry) => entry.tenant_id === tenantId).map(clone);
    }

    async listLearningDatasetVersions(tenantId: string) {
        return this.datasetVersions.filter((entry) => entry.id.startsWith(tenantId)).map(clone);
    }

    async listLearningBenchmarkReports(tenantId: string) {
        return this.learningBenchmarks.filter((entry) => entry.id.startsWith(tenantId)).map(clone);
    }

    async listLearningCalibrationReports(tenantId: string) {
        return this.learningCalibrations.filter((entry) => entry.id.startsWith(tenantId)).map(clone);
    }

    async listLearningAuditEvents(tenantId: string) {
        return this.learningAudits.filter((entry) => entry.id.startsWith(tenantId)).map(clone);
    }
}

async function main() {
    await testExperimentTrackingServiceFlow();
    await testHeartbeatStateConsistency();
    await testExperimentBootstrapSeed();
    await testRegistryGovernanceControlPlane();
    await testLiveChampionGovernanceConsistency();
    await testRegistryRegistrationValidationBlocksInvalidMetadata();
    await testRegistryPromotionBlockedReasons();
    await testRegistryControlPlaneVerificationMode();

    console.log('Experiment tracking integration tests passed.');
}

async function testExperimentTrackingServiceFlow() {
    const tenantId = makeUuid(1);
    const store = buildStore(tenantId);

    const run = await createExperimentRun(store, {
        tenantId,
        runId: 'run_diag_live_001',
        taskType: 'clinical_diagnosis',
        modality: 'tabular_clinical',
        targetType: 'diagnosis',
        modelArch: 'Transformer-Clinical-XL',
        modelVersion: 'diag_live_v2',
        datasetName: 'ldv_diag_2026_03_20',
        datasetVersion: 'ldv_diag_2026_03_20',
        featureSchemaVersion: 'clinical-case-vector-v1',
        epochsPlanned: 5,
        hyperparameters: { optimizer: 'adamw', learning_rate_init: 0.0001 },
        configSnapshot: {
            best_checkpoint_uri: 's3://artifacts/diag_live_v2/best.ckpt',
            log_uri: 's3://artifacts/diag_live_v2/logs',
        },
    });
    assert.equal(run.run_id, 'run_diag_live_001');

    const metrics = await logExperimentMetrics(store, tenantId, run.run_id, [
        {
            epoch: 1,
            global_step: 100,
            train_loss: 0.82,
            val_accuracy: 0.71,
            learning_rate: 0.0001,
            gradient_norm: 1.8,
            recall_critical: 0.8,
            false_negative_critical_rate: 0.12,
            dangerous_false_reassurance_rate: 0.05,
            abstain_accuracy: 0.74,
            contradiction_detection_rate: 0.68,
        },
        {
            epoch: 2,
            global_step: 200,
            train_loss: 0.61,
            val_accuracy: 0.78,
            learning_rate: 0.00008,
            gradient_norm: 1.2,
            macro_f1: 0.75,
            recall_critical: 0.86,
            false_negative_critical_rate: 0.08,
            dangerous_false_reassurance_rate: 0.03,
            abstain_accuracy: 0.8,
            contradiction_detection_rate: 0.72,
        },
    ]);
    assert.equal(metrics.length, 2);
    const series = buildExperimentMetricSeries(metrics);
    assert.equal(series.length, 2);
    assert.equal(series[1].val_accuracy, 0.78);

    const heartbeat = await updateExperimentHeartbeat(store, tenantId, run.run_id, {
        status: 'validating',
        progressPercent: 60,
        epochsCompleted: 3,
        resourceUsage: { gpu_utilization: 0.72 },
    });
    assert.equal(heartbeat.status, 'validating');
    assert.equal(heartbeat.epochs_completed, 3);

    const failure = await recordExperimentFailure(store, tenantId, run.run_id, {
        failureReason: 'exploded_gradient',
        failureEpoch: 4,
        failureStep: 412,
        lastTrainLoss: 1.92,
        lastGradientNorm: 1123.4,
        nanDetected: true,
    });
    assert.equal(failure.failure_reason, 'exploded_gradient');

    const detail = await getExperimentRunDetail(store, tenantId, run.run_id);
    assert.ok(detail);
    assert.equal(detail?.failure?.nan_detected, true);
    assert.equal(detail?.run.status, 'failed');
    assert.equal(detail?.deployment_decision?.decision, 'rejected');
    assert.ok((detail?.audit_history.length ?? 0) > 0);

    await backfillSummaryExperimentRuns(store, tenantId);
    const dashboard = await getExperimentDashboardSnapshot(store, tenantId, { runLimit: 20 });
    assert.ok(dashboard.summary.total_runs >= 2);
    assert.ok(dashboard.runs.some((row) => row.summary_only));

    const summaryOnlyRun = dashboard.runs.find((row) => row.summary_only)!;
    const summaryOnlyDetail = await getExperimentRunDetail(store, tenantId, summaryOnlyRun.run_id);
    assert.ok(summaryOnlyDetail);
    assert.equal(getEmptyMetricStateMessage(summaryOnlyDetail!.run, summaryOnlyDetail!.metrics).includes('summary-only historical run'), true);

    const comparison = await getExperimentComparison(store, tenantId, [run.run_id, summaryOnlyRun.run_id]);
    assert.ok(comparison);
    assert.equal(comparison?.runs.length, 2);
}

async function testExperimentBootstrapSeed() {
    const tenantId = makeUuid(2);
    const store = new InMemoryExperimentTrackingStore();

    const summary = await seedExperimentTrackingBootstrap(store, tenantId);
    assert.equal(summary.total_runs, 3);
    assert.equal(summary.active_runs, 1);
    assert.equal(summary.failed_runs, 1);
    assert.equal(summary.summary_only_runs, 0);
    assert.ok(summary.telemetry_coverage_pct > 0);

    const runs = await store.listExperimentRuns(tenantId, { limit: 10, includeSummaryOnly: true });
    assert.equal(runs.length, 3);
    assert.equal(runs.some((run) => run.run_id === 'run_diag_smoke_v1' && run.status === 'training'), true);
    assert.equal(runs.some((run) => run.run_id === 'run_diag_complete_v1' && run.status === 'completed'), true);
    assert.equal(runs.some((run) => run.run_id === 'run_diag_fail_v1' && run.status === 'failed'), true);

    const smokeRun = await store.getExperimentRun(tenantId, 'run_diag_smoke_v1');
    assert.ok(smokeRun);
    assert.ok(smokeRun?.last_heartbeat_at);

    for (const runId of ['run_diag_smoke_v1', 'run_diag_complete_v1', 'run_diag_fail_v1']) {
        const metrics = await store.listExperimentMetrics(tenantId, runId, 100);
        assert.ok(metrics.length > 0, `expected telemetry for ${runId}`);
        const series = buildExperimentMetricSeries(metrics);
        assert.equal(series.length, metrics.length);
    }

    const failedDetail = await getExperimentRunDetail(store, tenantId, 'run_diag_fail_v1');
    assert.ok(failedDetail?.failure);
    assert.equal(failedDetail?.failure?.failure_reason, 'exploded_gradient');
    assert.equal(failedDetail?.failure?.nan_detected, true);

    const completeDetail = await getExperimentRunDetail(store, tenantId, 'run_diag_complete_v1');
    assert.ok(completeDetail?.model_registry);
    assert.ok(completeDetail?.calibration_metrics);
    assert.ok(completeDetail?.adversarial_metrics);
    assert.ok(completeDetail?.deployment_decision);
    assert.ok((completeDetail?.subgroup_metrics.length ?? 0) > 0);
    assert.ok((completeDetail?.audit_history.length ?? 0) > 0);
    assert.equal(completeDetail?.registry_link_state, 'linked');
    assert.equal(completeDetail?.registry_role, 'experimental');
    assert.equal(completeDetail?.safety_coverage, 'partial');
    assert.equal(completeDetail?.promotion_gating.can_promote, false);

    const calibration = await upsertCalibrationEvaluation(store, tenantId, 'run_diag_complete_v1', {
        ece: 0.03,
        brierScore: 0.06,
        reliabilityBins: [
            { confidence: 0.2, accuracy: 0.18, count: 12 },
            { confidence: 0.5, accuracy: 0.52, count: 18 },
            { confidence: 0.8, accuracy: 0.82, count: 14 },
        ],
        confidenceHistogram: [
            { confidence: 0.2, count: 12 },
            { confidence: 0.5, count: 18 },
            { confidence: 0.8, count: 14 },
        ],
        calibrationPass: true,
        calibrationNotes: 'Manual QA override for governance validation.',
    }, 'qa_user');
    assert.equal(calibration.calibration_pass, true);
    assert.equal(calibration.confidence_histogram.length, 3);

    const adversarial = await upsertAdversarialEvaluation(store, tenantId, 'run_diag_complete_v1', {
        degradationScore: 0.14,
        contradictionRobustness: 0.88,
        criticalCaseRecall: 0.93,
        dangerousFalseReassuranceRate: 0.04,
        adversarialPass: true,
    }, 'qa_user');
    assert.equal(adversarial.adversarial_pass, true);
    assert.equal(adversarial.dangerous_false_reassurance_rate, 0.04);

    await logExperimentMetrics(store, tenantId, 'run_diag_complete_v1', [{
        epoch: 8,
        global_step: 97,
        train_loss: 0.47,
        val_loss: 0.45,
        val_accuracy: 0.85,
        learning_rate: 0.00005,
        gradient_norm: 0.6,
        macro_f1: 0.82,
        recall_critical: 0.95,
        false_negative_critical_rate: 0.05,
        dangerous_false_reassurance_rate: 0.03,
        abstain_accuracy: 0.84,
        contradiction_detection_rate: 0.88,
    }]);

    const stagingRegistry = await applyExperimentRegistryAction(store, tenantId, 'run_diag_complete_v1', 'promote_to_staging', 'qa_user');
    assert.equal(stagingRegistry.status, 'staging');

    const pendingDecision = await store.getDeploymentDecision(tenantId, 'run_diag_complete_v1');
    assert.equal(pendingDecision?.decision, 'pending');

    await applyExperimentRegistryAction(
        store,
        tenantId,
        'run_diag_complete_v1',
        'set_manual_approval',
        'qa_user',
        {
            manualApproval: true,
            reason: 'Clinical governance sign-off completed.',
        },
    );

    const decision = await store.getDeploymentDecision(tenantId, 'run_diag_complete_v1');
    assert.equal(decision?.decision, 'approved');

    const productionRegistry = await applyExperimentRegistryAction(store, tenantId, 'run_diag_complete_v1', 'promote_to_production', 'qa_user');
    assert.equal(productionRegistry.status, 'production');
    assert.equal(productionRegistry.role, 'champion');

    const promotedRun = await store.getExperimentRun(tenantId, 'run_diag_complete_v1');
    assert.equal(promotedRun?.status, 'promoted');
    assert.ok(promotedRun?.registry_id);

    const dashboard = await getExperimentDashboardSnapshot(store, tenantId, { runLimit: 10 });
    assert.equal(dashboard.summary.total_runs, 3);
    assert.equal(dashboard.summary.active_runs, 1);
    assert.equal(dashboard.summary.failed_runs, 1);
    assert.equal(dashboard.summary.summary_only_runs, 0);
    assert.equal(dashboard.selected_run_id, 'run_diag_smoke_v1');
    assert.ok(dashboard.selected_run_detail);
    assert.equal(dashboard.selected_run_detail?.metrics.length, 5);
    assert.ok(dashboard.summary.registry_link_coverage_pct > 0);
    assert.ok(dashboard.summary.safety_metric_coverage_pct > 0);
    assert.ok(dashboard.summary.safety_metric_coverage_pct <= 100);
    assert.equal(dashboard.selected_run_detail?.heartbeat_freshness, 'healthy');

    const auditTypes = new Set((await getExperimentRunDetail(store, tenantId, 'run_diag_complete_v1'))?.audit_history.map((event) => event.event_type));
    assert.ok(auditTypes.has('registry_candidate_created') || auditTypes.has('registry_synced'));
    assert.ok(auditTypes.has('calibration_completed'));
    assert.ok(auditTypes.has('adversarial_completed'));
    assert.ok(auditTypes.has('deployment_evaluated'));
    assert.ok(auditTypes.has('benchmark_completed'));
}

async function testRegistryGovernanceControlPlane() {
    const tenantId = makeUuid(4);
    const store = new InMemoryExperimentTrackingStore();

    await createPromotableDiagnosticRun(store, tenantId, {
        runId: 'run_diag_stable_001',
        modelVersion: 'diag_stable_v1',
        datasetVersion: 'ldv_diag_2026_03_20_a',
    });

    await applyExperimentRegistryAction(store, tenantId, 'run_diag_stable_001', 'promote_to_staging', 'qa_user');
    const stablePending = await getExperimentRunDetail(store, tenantId, 'run_diag_stable_001');
    assert.equal(stablePending?.promotion_gating.gates.manual_approval, 'pending');
    assert.equal(stablePending?.decision_panel.deployment_decision, 'hold');

    await applyExperimentRegistryAction(
        store,
        tenantId,
        'run_diag_stable_001',
        'set_manual_approval',
        'qa_user',
        {
            manualApproval: true,
            reason: 'Primary stable release approved.',
        },
    );
    const stableApproved = await getExperimentRunDetail(store, tenantId, 'run_diag_stable_001');
    assert.equal(stableApproved?.decision_panel.deployment_decision, 'approved');

    const stableChampion = await applyExperimentRegistryAction(store, tenantId, 'run_diag_stable_001', 'promote_to_production', 'qa_user');
    assert.equal(stableChampion.registry_role, 'champion');
    assert.equal(stableChampion.lifecycle_status, 'production');

    await createPromotableDiagnosticRun(store, tenantId, {
        runId: 'run_diag_candidate_002',
        modelVersion: 'diag_candidate_v2',
        datasetVersion: 'ldv_diag_2026_03_20_b',
    });
    await applyExperimentRegistryAction(store, tenantId, 'run_diag_candidate_002', 'promote_to_staging', 'qa_user');
    await applyExperimentRegistryAction(
        store,
        tenantId,
        'run_diag_candidate_002',
        'set_manual_approval',
        'qa_user',
        {
            manualApproval: true,
            reason: 'Challenger cleared governance review.',
        },
    );
    const candidateChampion = await applyExperimentRegistryAction(store, tenantId, 'run_diag_candidate_002', 'promote_to_production', 'qa_user');
    assert.equal(candidateChampion.run_id, 'run_diag_candidate_002');
    assert.equal(candidateChampion.rollback_target, stableChampion.registry_id);

    const previousChampion = await getExperimentRunDetail(store, tenantId, 'run_diag_stable_001');
    assert.equal(previousChampion?.model_registry?.registry_role, 'rollback_target');
    assert.equal(previousChampion?.model_registry?.lifecycle_status, 'archived');

    const snapshotBeforeRollback = await getModelRegistryControlPlaneSnapshot(store, tenantId);
    const diagnosticsBeforeRollback = snapshotBeforeRollback.families.find((family) => family.model_family === 'diagnostics');
    assert.equal(diagnosticsBeforeRollback?.active_model?.run_id, 'run_diag_candidate_002');
    assert.equal(diagnosticsBeforeRollback?.last_stable_model?.run_id, 'run_diag_stable_001');

    const restoredChampion = await applyExperimentRegistryAction(
        store,
        tenantId,
        'run_diag_candidate_002',
        'rollback',
        'incident_commander',
        {
            reason: 'Clinical drift exceeded safety threshold.',
            incidentId: 'INC-042',
        },
    );
    assert.equal(restoredChampion.run_id, 'run_diag_stable_001');
    assert.equal(restoredChampion.registry_role, 'champion');

    const rolledBackCandidate = await getExperimentRunDetail(store, tenantId, 'run_diag_candidate_002');
    assert.equal(rolledBackCandidate?.model_registry?.lifecycle_status, 'archived');
    assert.equal(rolledBackCandidate?.model_registry?.registry_role, 'experimental');
    assert.equal(rolledBackCandidate?.model_registry?.rollback_metadata?.reason, 'Clinical drift exceeded safety threshold.');

    const snapshotAfterRollback = await getModelRegistryControlPlaneSnapshot(store, tenantId);
    const diagnosticsAfterRollback = snapshotAfterRollback.families.find((family) => family.model_family === 'diagnostics');
    assert.equal(diagnosticsAfterRollback?.active_model?.run_id, 'run_diag_stable_001');
    assert.ok(snapshotAfterRollback.audit_history.some((event) => event.event_type === 'rolled_back'));
}

async function testLiveChampionGovernanceConsistency() {
    const tenantId = makeUuid(5);
    const store = new InMemoryExperimentTrackingStore();

    await createPromotableDiagnosticRun(store, tenantId, {
        runId: 'run_diag_live_champion_001',
        modelVersion: 'diag_live_champion_v1',
        datasetVersion: 'ldv_diag_2026_03_21_a',
    });

    await applyExperimentRegistryAction(store, tenantId, 'run_diag_live_champion_001', 'promote_to_staging', 'qa_user');
    await applyExperimentRegistryAction(
        store,
        tenantId,
        'run_diag_live_champion_001',
        'set_manual_approval',
        'qa_user',
        {
            manualApproval: true,
            reason: 'Champion promotion approved.',
        },
    );
    await applyExperimentRegistryAction(store, tenantId, 'run_diag_live_champion_001', 'promote_to_production', 'qa_user');

    await store.updateExperimentRun('run_diag_live_champion_001', tenantId, {
        status_reason: 'heartbeat_interrupted',
        last_heartbeat_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    });

    store.learningAudits.push({
        id: `${tenantId}_audit_archive_mismatch`,
        event_type: 'promoted',
        event_payload: {
            run_id: 'run_diag_live_champion_001',
            action: 'archive',
            registry_status: 'archived',
            registry_role: 'experimental',
        },
        created_at: new Date().toISOString(),
    });

    const detail = await getExperimentRunDetail(store, tenantId, 'run_diag_live_champion_001');
    assert.ok(detail);
    assert.equal(detail?.run.status, 'promoted');
    assert.equal(detail?.run.status_reason, null);
    assert.equal(detail?.heartbeat_freshness, 'interrupted');
    assert.equal(detail?.deployment_decision?.decision, 'approved');
    assert.equal(detail?.decision_panel.deployment_decision, 'approved');
    assert.equal(detail?.run.registry_context.deployment_eligibility, 'live_production');
    assert.ok(detail?.audit_history.some((event) => event.event_type === 'archived'));
}

async function testRegistryRegistrationValidationBlocksInvalidMetadata() {
    const tenantId = makeUuid(6);
    const store = new InMemoryExperimentTrackingStore();

    await createExperimentRun(store, {
        tenantId,
        runId: 'run_diag_invalid_artifact_001',
        taskType: 'clinical_diagnosis',
        modality: 'tabular_clinical',
        targetType: 'diagnosis',
        modelArch: 'Transformer-Clinical-Governed',
        modelVersion: 'diag_invalid_artifact_v1',
        datasetName: 'ldv_diag_invalid',
        datasetVersion: 'ldv_diag_invalid',
        featureSchemaVersion: 'clinical-case-vector-v2',
        createdBy: 'qa_user',
    });

    await assert.rejects(
        () => applyExperimentRegistryAction(store, tenantId, 'run_diag_invalid_artifact_001', 'promote_to_staging', 'qa_user'),
        (error: unknown) => {
            assert.ok(error instanceof RegistryControlPlaneError);
            assert.equal(error.code, 'INVALID_ARTIFACT_METADATA');
            return true;
        },
    );

    const auditEvents = await store.listAuditLog(tenantId, 50);
    assert.ok(auditEvents.some((event) => event.event_type === 'registration_blocked'));
}

async function testRegistryPromotionBlockedReasons() {
    const tenantId = makeUuid(7);
    const store = new InMemoryExperimentTrackingStore();

    await createPromotableDiagnosticRun(store, tenantId, {
        runId: 'run_diag_gate_blocked_001',
        modelVersion: 'diag_gate_blocked_v1',
        datasetVersion: 'ldv_diag_gate_blocked',
    });

    await applyExperimentRegistryAction(store, tenantId, 'run_diag_gate_blocked_001', 'promote_to_staging', 'qa_user');

    await assert.rejects(
        () => applyExperimentRegistryAction(store, tenantId, 'run_diag_gate_blocked_001', 'promote_to_production', 'qa_user'),
        (error: unknown) => {
            assert.ok(error instanceof RegistryControlPlaneError);
            assert.equal(error.code, 'PROMOTION_BLOCKED');
            assert.ok(Array.isArray(error.details.reason));
            assert.ok((error.details.reason as string[]).includes('missing_manual_approval'));
            return true;
        },
    );
}

async function testRegistryControlPlaneVerificationMode() {
    const tenantId = makeUuid(8);
    const store = new InMemoryExperimentTrackingStore();

    await createPromotableDiagnosticRun(store, tenantId, {
        runId: 'run_diag_verify_stable_001',
        modelVersion: 'diag_verify_stable_v1',
        datasetVersion: 'ldv_diag_verify_stable',
    });
    await applyExperimentRegistryAction(store, tenantId, 'run_diag_verify_stable_001', 'promote_to_staging', 'qa_user');
    await applyExperimentRegistryAction(store, tenantId, 'run_diag_verify_stable_001', 'set_manual_approval', 'qa_user', {
        manualApproval: true,
        reason: 'Stable model approved.',
    });
    await applyExperimentRegistryAction(store, tenantId, 'run_diag_verify_stable_001', 'promote_to_production', 'qa_user');

    await createPromotableDiagnosticRun(store, tenantId, {
        runId: 'run_diag_verify_candidate_002',
        modelVersion: 'diag_verify_candidate_v2',
        datasetVersion: 'ldv_diag_verify_candidate',
    });
    await applyExperimentRegistryAction(store, tenantId, 'run_diag_verify_candidate_002', 'promote_to_staging', 'qa_user');
    await applyExperimentRegistryAction(store, tenantId, 'run_diag_verify_candidate_002', 'set_manual_approval', 'qa_user', {
        manualApproval: true,
        reason: 'Candidate model approved.',
    });
    await applyExperimentRegistryAction(store, tenantId, 'run_diag_verify_candidate_002', 'promote_to_production', 'qa_user');

    const verification = await verifyModelRegistryControlPlane(store, tenantId);
    assert.equal(verification.status, 'PASS');
    assert.equal(verification.failed_checks.length, 0);
    assert.ok(verification.simulated_failures.every((item) => item.detected));

    const snapshot = await getModelRegistryControlPlaneSnapshot(store, tenantId);
    assert.equal(snapshot.registry_health, 'healthy');
    assert.equal(snapshot.consistency_issues.length, 0);
}

async function testHeartbeatStateConsistency() {
    const tenantId = makeUuid(3);
    const store = new InMemoryExperimentTrackingStore();

    await createExperimentRun(store, {
        tenantId,
        runId: 'run_stale_v1',
        taskType: 'clinical_diagnosis',
        modality: 'tabular_clinical',
        targetType: 'diagnosis',
        modelArch: 'Transformer-Clinical-Small',
        datasetName: 'vet_clinical_subset_b',
        status: 'training',
        lastHeartbeatAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    await createExperimentRun(store, {
        tenantId,
        runId: 'run_interrupted_v1',
        taskType: 'clinical_diagnosis',
        modality: 'tabular_clinical',
        targetType: 'diagnosis',
        modelArch: 'Transformer-Clinical-Small',
        datasetName: 'vet_clinical_subset_b',
        status: 'training',
        lastHeartbeatAt: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
    });

    const staleRun = await store.getExperimentRun(tenantId, 'run_stale_v1');
    const interruptedRun = await store.getExperimentRun(tenantId, 'run_interrupted_v1');
    assert.equal(staleRun?.status, 'stalled');
    assert.equal(interruptedRun?.status, 'interrupted');

    const snapshot = await getExperimentDashboardSnapshot(store, tenantId);
    assert.equal(snapshot.summary.active_runs, 0);

    const staleDetail = await getExperimentRunDetail(store, tenantId, 'run_stale_v1');
    const interruptedDetail = await getExperimentRunDetail(store, tenantId, 'run_interrupted_v1');
    assert.equal(staleDetail?.heartbeat_freshness, 'stale');
    assert.equal(interruptedDetail?.heartbeat_freshness, 'interrupted');
}

function buildStore(tenantId: string) {
    const store = new InMemoryExperimentTrackingStore();

    store.registryEntries = [{
        id: `${tenantId}_registry_diag`,
        tenant_id: tenantId,
        model_name: 'vetios_diagnosis_frequency_bayes',
        model_version: 'diag_registry_v1',
        task_type: 'diagnosis',
        training_dataset_version: 'ldv_diag_2026_03_20',
        feature_schema_version: 'clinical-case-vector-v1',
        label_policy_version: 'learning-label-policy-v1',
        artifact_payload: {
            model_name: 'Frequency Bayes Diagnosis',
            hyperparameters: { optimizer: 'adamw', batch_size: 32 },
            best_checkpoint_uri: 's3://artifacts/diag_registry_v1/best.ckpt',
            final_checkpoint_uri: 's3://artifacts/diag_registry_v1/final.ckpt',
            benchmark_report_uri: 's3://reports/diag_registry_v1/benchmark.json',
            training_summary: { epochs: 12, parameter_scale: '7B' },
        },
        benchmark_scorecard: { diagnosis_macro_f1: 0.82, diagnosis_accuracy: 0.86 },
        calibration_report_id: `${tenantId}_calibration_diag`,
        promotion_status: 'challenger',
        is_champion: false,
        latency_profile: { p95_ms: 120 },
        resource_profile: { gpu_memory_gb: 24 },
        parent_model_version: null,
        created_at: '2026-03-20T08:00:00.000Z',
        updated_at: '2026-03-20T08:20:00.000Z',
    }];

    store.datasetVersions = [{
        id: `${tenantId}_dataset_diag`,
        dataset_version: 'ldv_diag_2026_03_20',
        dataset_kind: 'diagnosis_training_set',
        row_count: 48,
        summary: {
            total_cases: 52,
            severity_training_cases: 31,
            adversarial_cases: 6,
            quarantined_cases: 2,
            label_composition: { expert_reviewed: 20, lab_confirmed: 18, synthetic: 10 },
        },
        created_at: '2026-03-20T08:00:00.000Z',
    }];

    store.learningBenchmarks = [{
        id: `${tenantId}_benchmark_diag`,
        model_registry_id: `${tenantId}_registry_diag`,
        benchmark_family: 'clean_labeled_diagnosis',
        task_type: 'diagnosis',
        summary_score: 0.86,
        pass_status: 'pass',
        report_payload: { accuracy: 0.86, macro_f1: 0.82 },
        created_at: '2026-03-20T08:21:00.000Z',
    }];

    store.learningCalibrations = [{
        id: `${tenantId}_calibration_diag`,
        model_registry_id: `${tenantId}_registry_diag`,
        task_type: 'diagnosis',
        brier_score: 0.08,
        ece_score: 0.04,
        report_payload: {
            recommendation: { status: 'pass' },
            expected_calibration_error: 0.04,
        },
        created_at: '2026-03-20T08:22:00.000Z',
    }];

    store.learningAudits = [{
        id: `${tenantId}_audit_diag`,
        event_type: 'promotion_reviewed',
        event_payload: { candidate_model_version: 'diag_registry_v1' },
        created_at: '2026-03-20T08:30:00.000Z',
    }];

    return store;
}

async function createPromotableDiagnosticRun(
    store: InMemoryExperimentTrackingStore,
    tenantId: string,
    input: {
        runId: string;
        modelVersion: string;
        datasetVersion: string;
    },
) {
    const run = await createExperimentRun(store, {
        tenantId,
        runId: input.runId,
        taskType: 'clinical_diagnosis',
        modality: 'tabular_clinical',
        targetType: 'diagnosis',
        modelArch: 'Transformer-Clinical-Governed',
        modelVersion: input.modelVersion,
        datasetName: input.datasetVersion,
        datasetVersion: input.datasetVersion,
        featureSchemaVersion: 'clinical-case-vector-v2',
        labelPolicyVersion: 'learning-label-policy-v2',
        epochsPlanned: 6,
        hyperparameters: { optimizer: 'adamw', learning_rate_init: 0.00008 },
        configSnapshot: {
            best_checkpoint_uri: `s3://vetios-experiments/${input.runId}/checkpoints/best.ckpt`,
            final_checkpoint_uri: `s3://vetios-experiments/${input.runId}/checkpoints/final.ckpt`,
            log_uri: `s3://vetios-experiments/${input.runId}/logs`,
        },
        createdBy: 'qa_user',
    });

    await logExperimentMetrics(store, tenantId, run.run_id, [
        {
            epoch: 1,
            global_step: 120,
            train_loss: 0.72,
            val_loss: 0.58,
            val_accuracy: 0.82,
            learning_rate: 0.00008,
            gradient_norm: 0.9,
            macro_f1: 0.8,
            recall_critical: 0.92,
            false_negative_critical_rate: 0.07,
            dangerous_false_reassurance_rate: 0.03,
            abstain_accuracy: 0.84,
            contradiction_detection_rate: 0.86,
        },
        {
            epoch: 2,
            global_step: 240,
            train_loss: 0.54,
            val_loss: 0.41,
            val_accuracy: 0.87,
            learning_rate: 0.00005,
            gradient_norm: 0.6,
            macro_f1: 0.84,
            recall_critical: 0.95,
            false_negative_critical_rate: 0.04,
            dangerous_false_reassurance_rate: 0.02,
            abstain_accuracy: 0.88,
            contradiction_detection_rate: 0.9,
        },
    ]);

    await updateExperimentHeartbeat(store, tenantId, run.run_id, {
        status: 'completed',
        progressPercent: 100,
        epochsCompleted: 6,
    });

    await store.upsertExperimentBenchmark({
        tenant_id: tenantId,
        run_id: run.run_id,
        benchmark_family: 'clean_labeled_diagnosis',
        task_type: 'diagnosis',
        summary_score: 0.88,
        pass_status: 'pass',
        report_payload: {
            macro_f1: 0.84,
            accuracy: 0.87,
        },
    });

    await upsertCalibrationEvaluation(store, tenantId, run.run_id, {
        ece: 0.03,
        brierScore: 0.05,
        reliabilityBins: [
            { confidence: 0.2, accuracy: 0.18, count: 16 },
            { confidence: 0.5, accuracy: 0.51, count: 21 },
            { confidence: 0.8, accuracy: 0.83, count: 19 },
        ],
        confidenceHistogram: [
            { confidence: 0.2, count: 16 },
            { confidence: 0.5, count: 21 },
            { confidence: 0.8, count: 19 },
        ],
        calibrationPass: true,
        calibrationNotes: 'Governance calibration validation complete.',
    }, 'qa_user');

    await upsertAdversarialEvaluation(store, tenantId, run.run_id, {
        degradationScore: 0.11,
        contradictionRobustness: 0.91,
        criticalCaseRecall: 0.95,
        dangerousFalseReassuranceRate: 0.03,
        adversarialPass: true,
    }, 'qa_user');

    return run;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function makeUuid(seed: number): string {
    return `00000000-0000-4000-a000-${String(seed).padStart(12, '0')}`;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
