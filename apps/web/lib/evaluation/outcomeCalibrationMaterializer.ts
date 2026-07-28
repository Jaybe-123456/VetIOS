import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildOutcomeCalibrationBuckets,
    recordOutcomeCalibrationRun,
    type OutcomeCalibrationCase,
    type OutcomeCalibrationRunSummary,
} from '@/lib/inference/outcomeCalibration';

export const OUTCOME_CALIBRATION_MATERIALIZER_VERSION =
    'vetios_outcome_calibration_materializer_v1';

const LOG_LOSS_EPSILON = 1e-15;
const DEFAULT_SOURCE_LIMIT = 5_000;
const MAX_SOURCE_LIMIT = 20_000;
const EVIDENCE_GRADE_AUTHORITIES = new Set(['expert_reviewed', 'lab_confirmed']);

export type OutcomeMaterializationMode = 'dry_run' | 'commit';
export type OutcomeMaterializationStatus = 'materialized' | 'blocked';
export type OutcomeDistributionScope =
    | 'unavailable'
    | 'top_label_only'
    | 'complete_multiclass';

export interface OutcomeMaterializationInferenceRow {
    id?: unknown;
    tenant_id?: unknown;
    model_name?: unknown;
    model_version?: unknown;
    input_signature?: unknown;
    output_payload?: unknown;
    confidence_score?: unknown;
    differentials?: unknown;
    simulation_id?: unknown;
    is_synthetic?: unknown;
    created_at?: unknown;
}

export interface OutcomeMaterializationOutcomeRow {
    id?: unknown;
    tenant_id?: unknown;
    inference_event_id?: unknown;
    outcome_type?: unknown;
    outcome_payload?: unknown;
    outcome_timestamp?: unknown;
    label_type?: unknown;
    actual_label?: unknown;
    actual_confidence?: unknown;
    simulation_id?: unknown;
    is_synthetic?: unknown;
    source_module?: unknown;
    created_at?: unknown;
}

export interface OutcomeCalibrationMaterializationEvent {
    tenant_id: string;
    request_id: string;
    inference_event_id: string;
    outcome_event_id: string;
    algorithm_version: string;
    materialization_status: OutcomeMaterializationStatus;
    authority_type: string | null;
    canonical_label: string | null;
    predicted_label: string | null;
    top_label_confidence: number | null;
    top_label_correct: boolean | null;
    top_label_brier_score: number | null;
    top_label_log_loss: number | null;
    absolute_confidence_error: number | null;
    confirmed_label_probability: number | null;
    top_three_contains_confirmed: boolean | null;
    distribution_scope: OutcomeDistributionScope;
    multiclass_brier_score: number | null;
    multiclass_log_loss: number | null;
    is_canonical_at_materialization: boolean;
    blocker_codes: string[];
    warning_codes: string[];
    source_digest: string;
    evidence: Record<string, unknown>;
    observed_at: string;
}

export interface OutcomeCalibrationMaterializationBuild {
    algorithm_version: string;
    source_pair_count: number;
    source_inference_count: number;
    materialized_count: number;
    blocked_count: number;
    canonical_materialized_count: number;
    blocker_counts: Record<string, number>;
    warning_counts: Record<string, number>;
    source_digest: string;
    events: OutcomeCalibrationMaterializationEvent[];
    calibration_rows: OutcomeCalibrationCase[];
}

export interface OutcomeCalibrationMaterializationExecution {
    mode: OutcomeMaterializationMode;
    algorithm_version: string;
    source_pair_count: number;
    source_inference_count: number;
    materialized_count: number;
    blocked_count: number;
    canonical_materialized_count: number;
    blocker_counts: Record<string, number>;
    warning_counts: Record<string, number>;
    source_digest: string;
    source_limit: number;
    source_limit_reached: boolean;
    inserted_events: number;
    existing_events: number;
    aggregate_run_created: boolean;
    aggregate_run_reused: boolean;
    aggregate_run_id: string | null;
    aggregate: OutcomeCalibrationRunSummary;
}

export interface OutcomeCalibrationMaterializationSnapshot {
    execution: OutcomeCalibrationMaterializationExecution;
    persisted: {
        total_events: number;
        materialized_events: number;
        blocked_events: number;
        latest_materialized_at: string | null;
        recent_events: Array<Record<string, unknown>>;
    };
}

interface ParsedDifferential {
    label: string;
    probability: number;
}

interface PredictionEvidence {
    predictedLabel: string | null;
    topLabelConfidence: number | null;
    differentials: ParsedDifferential[];
    distributionScope: OutcomeDistributionScope;
    warnings: string[];
}

export function buildOutcomeCalibrationMaterialization(
    input: {
        tenantId: string;
        requestId: string;
        inferenceEvents: OutcomeMaterializationInferenceRow[];
        outcomeEvents: OutcomeMaterializationOutcomeRow[];
        algorithmVersion?: string;
    },
): OutcomeCalibrationMaterializationBuild {
    const algorithmVersion =
        normalizeText(input.algorithmVersion) ?? OUTCOME_CALIBRATION_MATERIALIZER_VERSION;
    const inferenceById = new Map<string, OutcomeMaterializationInferenceRow>();

    for (const inference of input.inferenceEvents) {
        const inferenceId = normalizeText(inference.id);
        if (inferenceId) inferenceById.set(inferenceId, inference);
    }

    const outcomeGroups = groupOutcomesByInference(input.outcomeEvents);
    const canonicalOutcomeIds = new Set<string>();
    for (const outcomes of outcomeGroups.values()) {
        const canonical = selectCanonicalOutcome(outcomes);
        const canonicalId = normalizeText(canonical?.id);
        if (canonicalId) canonicalOutcomeIds.add(canonicalId);
    }

    const events = input.outcomeEvents
        .map((outcome) => buildMaterializationEvent({
            tenantId: input.tenantId,
            requestId: input.requestId,
            algorithmVersion,
            outcome,
            inference: inferenceById.get(normalizeText(outcome.inference_event_id) ?? '') ?? null,
            isCanonical: canonicalOutcomeIds.has(normalizeText(outcome.id) ?? ''),
        }))
        .sort(compareMaterializationEvents);

    const calibrationRows = events
        .filter((event) => (
            event.materialization_status === 'materialized'
            && event.is_canonical_at_materialization
        ))
        .map((event) => buildCalibrationCase(
            event,
            inferenceById.get(event.inference_event_id) ?? null,
        ));

    const blockerCounts = countCodes(events.flatMap((event) => event.blocker_codes));
    const warningCounts = countCodes(events.flatMap((event) => event.warning_codes));
    const sourceDigest = digestUnknown({
        algorithm_version: algorithmVersion,
        tenant_id: input.tenantId,
        event_digests: events.map((event) => event.source_digest),
    });

    return {
        algorithm_version: algorithmVersion,
        source_pair_count: events.length,
        source_inference_count: new Set(
            events.map((event) => event.inference_event_id),
        ).size,
        materialized_count: events.filter(
            (event) => event.materialization_status === 'materialized',
        ).length,
        blocked_count: events.filter(
            (event) => event.materialization_status === 'blocked',
        ).length,
        canonical_materialized_count: calibrationRows.length,
        blocker_counts: blockerCounts,
        warning_counts: warningCounts,
        source_digest: sourceDigest,
        events,
        calibration_rows: calibrationRows,
    };
}

export async function runOutcomeCalibrationMaterialization(
    client: SupabaseClient,
    input: {
        tenantId: string;
        requestId: string;
        mode: OutcomeMaterializationMode;
        runKind?: 'outcome_write' | 'scheduled' | 'manual_recompute' | 'backfill';
        minimumRequiredOutcomes?: number;
        sourceLimit?: number;
    },
): Promise<OutcomeCalibrationMaterializationExecution> {
    const sourceLimit = normalizeSourceLimit(input.sourceLimit);
    const { outcomes, sourceLimitReached } = await loadOutcomeRows(
        client,
        input.tenantId,
        sourceLimit,
    );
    const inferenceIds = Array.from(new Set(
        outcomes
            .map((row) => normalizeText(row.inference_event_id))
            .filter((value): value is string => value != null),
    ));
    const inferences = await loadInferenceRows(client, input.tenantId, inferenceIds);
    const build = buildOutcomeCalibrationMaterialization({
        tenantId: input.tenantId,
        requestId: input.requestId,
        inferenceEvents: inferences,
        outcomeEvents: outcomes,
    });
    const aggregate = buildOutcomeCalibrationBuckets({
        tenantId: input.tenantId,
        requestId: input.requestId,
        runKind: input.runKind ?? 'manual_recompute',
        rows: build.calibration_rows,
        minimumRequiredOutcomes: normalizeMinimumOutcomes(input.minimumRequiredOutcomes),
    });

    const existingKeys = await loadExistingMaterializationKeys(
        client,
        input.tenantId,
        build.algorithm_version,
    );
    const pendingEvents = build.events.filter((event) => (
        !existingKeys.has(makeEventKey(event))
    ));

    let insertedEvents = 0;
    let aggregateRunCreated = false;
    let aggregateRunReused = false;
    let aggregateRunId: string | null = null;

    if (input.mode === 'commit') {
        insertedEvents = await insertMaterializationEvents(client, pendingEvents);
        const existingRun = await loadAggregateRunByDigest(
            client,
            input.tenantId,
            aggregate.source_digest,
        );

        if (existingRun) {
            aggregateRunReused = true;
            aggregateRunId = existingRun;
        } else {
            const result = await recordOutcomeCalibrationRun(client, {
                tenantId: input.tenantId,
                requestId: input.requestId,
                runKind: input.runKind ?? 'manual_recompute',
                rows: build.calibration_rows,
                minimumRequiredOutcomes: normalizeMinimumOutcomes(input.minimumRequiredOutcomes),
                materialization: {
                    algorithm_version: build.algorithm_version,
                    source_pair_count: build.source_pair_count,
                    materialized_count: build.materialized_count,
                    blocked_count: build.blocked_count,
                    canonical_materialized_count: build.canonical_materialized_count,
                    blocker_counts: build.blocker_counts,
                    source_digest: build.source_digest,
                },
            });
            if (result.error || !result.data) {
                throw new Error(result.error ?? 'outcome_calibration_aggregate_write_failed');
            }
            aggregateRunCreated = true;
            aggregateRunId = result.runId;
        }
    }

    return {
        mode: input.mode,
        algorithm_version: build.algorithm_version,
        source_pair_count: build.source_pair_count,
        source_inference_count: build.source_inference_count,
        materialized_count: build.materialized_count,
        blocked_count: build.blocked_count,
        canonical_materialized_count: build.canonical_materialized_count,
        blocker_counts: build.blocker_counts,
        warning_counts: build.warning_counts,
        source_digest: build.source_digest,
        source_limit: sourceLimit,
        source_limit_reached: sourceLimitReached,
        inserted_events: insertedEvents,
        existing_events: build.events.length - pendingEvents.length,
        aggregate_run_created: aggregateRunCreated,
        aggregate_run_reused: aggregateRunReused,
        aggregate_run_id: aggregateRunId,
        aggregate,
    };
}

export async function loadOutcomeCalibrationMaterializationSnapshot(
    client: SupabaseClient,
    input: {
        tenantId: string;
        requestId: string;
        minimumRequiredOutcomes?: number;
        sourceLimit?: number;
    },
): Promise<OutcomeCalibrationMaterializationSnapshot> {
    const execution = await runOutcomeCalibrationMaterialization(client, {
        ...input,
        mode: 'dry_run',
        runKind: 'manual_recompute',
    });

    const [
        recentResult,
        totalResult,
        materializedResult,
        blockedResult,
        latestMaterializedResult,
    ] = await Promise.all([
        client
        .from('outcome_calibration_materialization_events')
        .select([
            'id',
            'inference_event_id',
            'outcome_event_id',
            'algorithm_version',
            'materialization_status',
            'authority_type',
            'canonical_label',
            'predicted_label',
            'top_label_confidence',
            'top_label_correct',
            'top_label_brier_score',
            'top_label_log_loss',
            'distribution_scope',
            'is_canonical_at_materialization',
            'blocker_codes',
            'warning_codes',
            'source_digest',
            'observed_at',
            'created_at',
        ].join(','))
        .eq('tenant_id', input.tenantId)
        .order('created_at', { ascending: false })
        .limit(50),
        client
            .from('outcome_calibration_materialization_events')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', input.tenantId),
        client
            .from('outcome_calibration_materialization_events')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', input.tenantId)
            .eq('materialization_status', 'materialized'),
        client
            .from('outcome_calibration_materialization_events')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', input.tenantId)
            .eq('materialization_status', 'blocked'),
        client
            .from('outcome_calibration_materialization_events')
            .select('created_at')
            .eq('tenant_id', input.tenantId)
            .eq('materialization_status', 'materialized')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);

    const firstError = [
        recentResult.error,
        totalResult.error,
        materializedResult.error,
        blockedResult.error,
        latestMaterializedResult.error,
    ].find((error) => error != null);
    if (firstError) {
        throw new Error(`outcome_calibration_snapshot_failed: ${firstError.message}`);
    }

    const rows = Array.isArray(recentResult.data)
        ? recentResult.data as unknown as Array<Record<string, unknown>>
        : [];

    return {
        execution,
        persisted: {
            total_events: totalResult.count ?? 0,
            materialized_events: materializedResult.count ?? 0,
            blocked_events: blockedResult.count ?? 0,
            latest_materialized_at:
                normalizeText(latestMaterializedResult.data?.created_at) ?? null,
            recent_events: rows,
        },
    };
}

function buildMaterializationEvent(input: {
    tenantId: string;
    requestId: string;
    algorithmVersion: string;
    outcome: OutcomeMaterializationOutcomeRow;
    inference: OutcomeMaterializationInferenceRow | null;
    isCanonical: boolean;
}): OutcomeCalibrationMaterializationEvent {
    const outcomeId = normalizeText(input.outcome.id) ?? 'missing_outcome_event_id';
    const inferenceId =
        normalizeText(input.outcome.inference_event_id)
        ?? normalizeText(input.inference?.id)
        ?? 'missing_inference_event_id';
    const outcomePayload = asRecord(input.outcome.outcome_payload);
    const authorityType = normalizeDimension(
        input.outcome.label_type ?? outcomePayload.label_type,
    );
    const canonicalLabel = resolveConfirmedLabel(input.outcome);
    const prediction = extractPredictionEvidence(input.inference);
    const blockers: string[] = [];
    const warnings = [...prediction.warnings];

    if (!input.inference) blockers.push('inference_event_missing');
    if (
        input.inference
        && normalizeText(input.inference.tenant_id) !== input.tenantId
    ) {
        blockers.push('inference_tenant_mismatch');
    }
    if (normalizeText(input.outcome.tenant_id) !== input.tenantId) {
        blockers.push('outcome_tenant_mismatch');
    }
    if (isSyntheticInference(input.inference)) blockers.push('synthetic_inference');
    if (isSyntheticOutcome(input.outcome)) blockers.push('synthetic_outcome');
    if (!authorityType || !EVIDENCE_GRADE_AUTHORITIES.has(authorityType)) {
        blockers.push('outcome_authority_not_evidence_grade');
    }
    if (!canonicalLabel) blockers.push('confirmed_label_missing');
    if (!prediction.predictedLabel) blockers.push('predicted_label_missing');
    if (prediction.topLabelConfidence == null) {
        blockers.push('top_label_confidence_missing');
    } else if (
        prediction.topLabelConfidence < 0
        || prediction.topLabelConfidence > 1
    ) {
        blockers.push('top_label_confidence_out_of_range');
    }

    const uniqueBlockers = Array.from(new Set(blockers)).sort();
    const uniqueWarnings = Array.from(new Set(warnings)).sort();
    const canScore = uniqueBlockers.length === 0
        && canonicalLabel != null
        && prediction.predictedLabel != null
        && prediction.topLabelConfidence != null;
    const correctness = canScore
        ? labelsMatch(prediction.predictedLabel as string, canonicalLabel as string)
        : null;
    const confidence = canScore
        ? clamp01(prediction.topLabelConfidence as number)
        : null;
    const actualProbability = canonicalLabel
        ? prediction.differentials.find(
            (entry) => labelsMatch(entry.label, canonicalLabel),
        )?.probability ?? null
        : null;
    const topThreeContainsConfirmed = canonicalLabel
        ? prediction.differentials
            .slice(0, 3)
            .some((entry) => labelsMatch(entry.label, canonicalLabel))
        : null;
    const multiclass = canScore
        && prediction.distributionScope === 'complete_multiclass'
        && canonicalLabel
        ? computeMulticlassScores(prediction.differentials, canonicalLabel)
        : null;
    const observedAt =
        normalizeTimestamp(input.outcome.outcome_timestamp)
        ?? normalizeTimestamp(input.outcome.created_at)
        ?? new Date(0).toISOString();
    const safeSource = {
        tenant_id: input.tenantId,
        inference_event_id: inferenceId,
        outcome_event_id: outcomeId,
        authority_type: authorityType,
        canonical_label: canonicalLabel,
        predicted_label: prediction.predictedLabel,
        top_label_confidence: prediction.topLabelConfidence,
        differential_distribution: prediction.differentials,
        distribution_scope: prediction.distributionScope,
        inference_model_name: normalizeText(input.inference?.model_name),
        inference_model_version: normalizeText(input.inference?.model_version),
        inference_created_at: normalizeTimestamp(input.inference?.created_at),
        outcome_observed_at: observedAt,
        inference_synthetic: isSyntheticInference(input.inference),
        outcome_synthetic: isSyntheticOutcome(input.outcome),
    };

    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        inference_event_id: inferenceId,
        outcome_event_id: outcomeId,
        algorithm_version: input.algorithmVersion,
        materialization_status: canScore ? 'materialized' : 'blocked',
        authority_type: authorityType,
        canonical_label: canonicalLabel,
        predicted_label: prediction.predictedLabel,
        top_label_confidence: confidence,
        top_label_correct: correctness,
        top_label_brier_score:
            confidence != null && correctness != null
                ? roundMetric((confidence - Number(correctness)) ** 2)
                : null,
        top_label_log_loss:
            confidence != null && correctness != null
                ? roundLoss(binaryLogLoss(confidence, correctness))
                : null,
        absolute_confidence_error:
            confidence != null && correctness != null
                ? roundMetric(Math.abs(confidence - Number(correctness)))
                : null,
        confirmed_label_probability:
            actualProbability == null ? null : roundMetric(actualProbability),
        top_three_contains_confirmed: topThreeContainsConfirmed,
        distribution_scope: prediction.distributionScope,
        multiclass_brier_score: multiclass?.brierScore ?? null,
        multiclass_log_loss: multiclass?.logLoss ?? null,
        is_canonical_at_materialization: input.isCanonical,
        blocker_codes: uniqueBlockers,
        warning_codes: uniqueWarnings,
        source_digest: digestUnknown(safeSource),
        evidence: {
            version: 'vetios_outcome_calibration_evidence_v1',
            metric_contract: {
                top_label_brier_score:
                    'binary Brier score for whether the top-ranked label is correct',
                top_label_log_loss:
                    'binary log loss for whether the top-ranked label is correct',
                absolute_confidence_error:
                    'per-event absolute confidence error; not expected calibration error',
                multiclass_scores:
                    'computed only when the response explicitly attests a complete probability distribution',
            },
            privacy_boundary:
                'event references, normalized labels, probabilities, lineage, hashes, and blocker codes only',
            inference_model_name: normalizeText(input.inference?.model_name),
            inference_model_version: normalizeText(input.inference?.model_version),
            differential_count: prediction.differentials.length,
            full_distribution_attested:
                prediction.distributionScope === 'complete_multiclass',
        },
        observed_at: observedAt,
    };
}

function extractPredictionEvidence(
    inference: OutcomeMaterializationInferenceRow | null,
): PredictionEvidence {
    if (!inference) {
        return {
            predictedLabel: null,
            topLabelConfidence: null,
            differentials: [],
            distributionScope: 'unavailable',
            warnings: [],
        };
    }

    const output = asRecord(inference.output_payload);
    const diagnosis = asRecord(output.diagnosis);
    const rawDifferentials = firstArray(
        inference.differentials,
        output.differentials,
        diagnosis.top_differentials,
    );
    const parsed = rawDifferentials
        .map(parseDifferential)
        .filter((entry): entry is ParsedDifferential => entry != null)
        .sort((left, right) => right.probability - left.probability);
    const directPredictedLabel = firstText(
        output.top_diagnosis,
        output.predicted_label,
        diagnosis.primary_diagnosis,
        diagnosis.top_diagnosis,
        asRecord(output.primary_diagnosis).label,
        asRecord(output.primary_diagnosis).name,
    );
    const predictedLabel = parsed[0]?.label ?? directPredictedLabel;
    const storedConfidence = readFiniteNumber(
        inference.confidence_score,
        output.confidence_score,
        output.primary_confidence,
        diagnosis.confidence_score,
    );
    const topLabelConfidence = parsed[0]?.probability ?? storedConfidence;
    const warnings: string[] = [];

    if (
        parsed[0]
        && storedConfidence != null
        && Math.abs(parsed[0].probability - storedConfidence) > 0.05
    ) {
        warnings.push('stored_confidence_differs_from_top_probability');
    }

    const completeAttested = isCompleteDistributionAttested(output, diagnosis);
    const probabilitySum = parsed.reduce(
        (sum, entry) => sum + entry.probability,
        0,
    );
    const labelsUnique = new Set(
        parsed.map((entry) => normalizeLabel(entry.label)),
    ).size === parsed.length;
    const completeValid = completeAttested
        && parsed.length >= 2
        && labelsUnique
        && parsed.every((entry) => (
            entry.probability >= 0 && entry.probability <= 1
        ))
        && Math.abs(probabilitySum - 1) <= 0.001;

    if (completeAttested && !completeValid) {
        warnings.push('complete_distribution_attestation_invalid');
    }

    return {
        predictedLabel,
        topLabelConfidence,
        differentials: parsed,
        distributionScope: completeValid
            ? 'complete_multiclass'
            : predictedLabel && topLabelConfidence != null
                ? 'top_label_only'
                : 'unavailable',
        warnings,
    };
}

function buildCalibrationCase(
    event: OutcomeCalibrationMaterializationEvent,
    inference: OutcomeMaterializationInferenceRow | null,
): OutcomeCalibrationCase {
    const prediction = extractPredictionEvidence(inference);
    const inputSignature = asRecord(inference?.input_signature);
    const output = asRecord(inference?.output_payload);

    return {
        tenantId: event.tenant_id,
        outcomeEventId: event.outcome_event_id,
        inferenceEventId: event.inference_event_id,
        caseId: normalizeText(inputSignature.case_id),
        species: firstText(
            inputSignature.species,
            asRecord(inputSignature.patient).species,
            output.species,
        ),
        label: event.canonical_label as string,
        labelType: event.authority_type,
        predictedLabel: event.predicted_label,
        predictedProbability: event.top_label_confidence,
        actualProbability: event.confirmed_label_probability,
        actualConfidence: 1,
        calibrationDelta:
            event.confirmed_label_probability == null
                ? null
                : roundSigned(1 - event.confirmed_label_probability),
        topDifferentials: prediction.differentials,
        modelVersion: normalizeText(inference?.model_version),
        evidenceType: event.authority_type,
        severity: firstText(
            inputSignature.severity,
            output.severity,
            asRecord(output.risk_assessment).level,
        ),
        careEnvironment: firstText(
            inputSignature.care_environment,
            inputSignature.practice_type,
        ),
        region: firstText(
            inputSignature.region,
            inputSignature.country,
        ),
        abstained: output.abstain_recommendation === true,
        synthetic: false,
        sourceKind: 'outcome_calibration_materialization',
        observedAt: event.observed_at,
    };
}

function groupOutcomesByInference(
    rows: OutcomeMaterializationOutcomeRow[],
): Map<string, OutcomeMaterializationOutcomeRow[]> {
    const groups = new Map<string, OutcomeMaterializationOutcomeRow[]>();
    for (const row of rows) {
        const inferenceId =
            normalizeText(row.inference_event_id) ?? 'missing_inference_event_id';
        const group = groups.get(inferenceId) ?? [];
        group.push(row);
        groups.set(inferenceId, group);
    }
    return groups;
}

function selectCanonicalOutcome(
    outcomes: OutcomeMaterializationOutcomeRow[],
): OutcomeMaterializationOutcomeRow | null {
    return outcomes
        .slice()
        .sort((left, right) => {
            const authorityDifference =
                authorityRank(resolveAuthority(right))
                - authorityRank(resolveAuthority(left));
            if (authorityDifference !== 0) return authorityDifference;

            const timeDifference =
                Date.parse(resolveOutcomeTimestamp(right))
                - Date.parse(resolveOutcomeTimestamp(left));
            if (Number.isFinite(timeDifference) && timeDifference !== 0) {
                return timeDifference;
            }
            return (normalizeText(right.id) ?? '').localeCompare(
                normalizeText(left.id) ?? '',
            );
        })[0] ?? null;
}

function resolveAuthority(outcome: OutcomeMaterializationOutcomeRow): string | null {
    return normalizeDimension(
        outcome.label_type ?? asRecord(outcome.outcome_payload).label_type,
    );
}

function authorityRank(authority: string | null): number {
    if (authority === 'lab_confirmed') return 3;
    if (authority === 'expert_reviewed') return 2;
    return 1;
}

function resolveConfirmedLabel(
    outcome: OutcomeMaterializationOutcomeRow,
): string | null {
    const payload = asRecord(outcome.outcome_payload);
    const value = firstText(
        outcome.actual_label,
        payload.actual_label,
        payload.confirmed_diagnosis,
        payload.actual_diagnosis,
        payload.label,
        payload.final_diagnosis,
    );
    return value ? normalizeLabel(value) : null;
}

function resolveOutcomeTimestamp(
    outcome: OutcomeMaterializationOutcomeRow,
): string {
    return normalizeTimestamp(outcome.outcome_timestamp)
        ?? normalizeTimestamp(outcome.created_at)
        ?? new Date(0).toISOString();
}

function isSyntheticInference(
    inference: OutcomeMaterializationInferenceRow | null,
): boolean {
    if (!inference) return false;
    return inference.is_synthetic === true
        || normalizeText(inference.simulation_id) != null
        || asRecord(inference.input_signature).is_synthetic === true;
}

function isSyntheticOutcome(
    outcome: OutcomeMaterializationOutcomeRow,
): boolean {
    const payload = asRecord(outcome.outcome_payload);
    const labelType = normalizeDimension(outcome.label_type ?? payload.label_type);
    const sourceModule = normalizeDimension(outcome.source_module);
    return outcome.is_synthetic === true
        || normalizeText(outcome.simulation_id) != null
        || labelType === 'synthetic'
        || labelType === 'simulation'
        || sourceModule?.includes('simulation') === true
        || payload.is_synthetic === true;
}

function parseDifferential(value: unknown): ParsedDifferential | null {
    const record = asRecord(value);
    const label = firstText(
        record.label,
        record.condition,
        record.name,
        record.diagnosis,
        record.condition_name,
    );
    const probability = readFiniteNumber(
        record.probability,
        record.p,
        record.confidence,
    );
    if (!label || probability == null || probability < 0 || probability > 1) {
        return null;
    }
    return {
        label,
        probability,
    };
}

function isCompleteDistributionAttested(
    output: Record<string, unknown>,
    diagnosis: Record<string, unknown>,
): boolean {
    if (
        output.distribution_complete === true
        || output.probability_distribution_complete === true
        || diagnosis.distribution_complete === true
        || diagnosis.probability_distribution_complete === true
    ) {
        return true;
    }

    const scope = normalizeDimension(
        output.probability_scope ?? diagnosis.probability_scope,
    );
    return scope === 'complete_multiclass'
        || scope === 'complete_candidate_space'
        || scope === 'full_candidate_set'
        || scope === 'full_multiclass';
}

function computeMulticlassScores(
    differentials: ParsedDifferential[],
    actualLabel: string,
): { brierScore: number; logLoss: number } {
    const normalizedActual = normalizeLabel(actualLabel);
    let brierScore = 0;
    let actualProbability = 0;

    for (const differential of differentials) {
        const isActual = normalizeLabel(differential.label) === normalizedActual;
        if (isActual) actualProbability = differential.probability;
        brierScore += (differential.probability - Number(isActual)) ** 2;
    }

    return {
        brierScore: Number(brierScore.toFixed(6)),
        logLoss: roundLoss(-Math.log(clampProbability(actualProbability))),
    };
}

function binaryLogLoss(probability: number, actual: boolean): number {
    const p = clampProbability(probability);
    return actual ? -Math.log(p) : -Math.log(1 - p);
}

async function loadOutcomeRows(
    client: SupabaseClient,
    tenantId: string,
    sourceLimit: number,
): Promise<{
    outcomes: OutcomeMaterializationOutcomeRow[];
    sourceLimitReached: boolean;
}> {
    const rows: OutcomeMaterializationOutcomeRow[] = [];
    const target = sourceLimit + 1;
    const pageSize = Math.min(1_000, target);

    for (let offset = 0; offset < target; offset += pageSize) {
        const upperBound = Math.min(target, offset + pageSize) - 1;
        const { data, error } = await client
            .from('clinical_outcome_events')
            .select([
                'id',
                'tenant_id',
                'inference_event_id',
                'outcome_type',
                'outcome_payload',
                'outcome_timestamp',
                'label_type',
                'actual_label',
                'actual_confidence',
                'simulation_id',
                'is_synthetic',
                'source_module',
                'created_at',
            ].join(','))
            .eq('tenant_id', tenantId)
            .not('inference_event_id', 'is', null)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, upperBound);

        if (error) {
            throw new Error(`outcome_calibration_source_load_failed: ${error.message}`);
        }
        const page = Array.isArray(data)
            ? data as OutcomeMaterializationOutcomeRow[]
            : [];
        rows.push(...page);
        if (page.length < upperBound - offset + 1 || rows.length >= target) break;
    }

    return {
        outcomes: rows.slice(0, sourceLimit),
        sourceLimitReached: rows.length > sourceLimit,
    };
}

async function loadInferenceRows(
    client: SupabaseClient,
    tenantId: string,
    inferenceIds: string[],
): Promise<OutcomeMaterializationInferenceRow[]> {
    if (inferenceIds.length === 0) return [];

    const rows: OutcomeMaterializationInferenceRow[] = [];
    for (const chunk of chunkValues(inferenceIds, 200)) {
        const { data, error } = await client
            .from('ai_inference_events')
            .select([
                'id',
                'tenant_id',
                'model_name',
                'model_version',
                'input_signature',
                'output_payload',
                'confidence_score',
                'differentials',
                'simulation_id',
                'is_synthetic',
                'created_at',
            ].join(','))
            .eq('tenant_id', tenantId)
            .in('id', chunk);

        if (error) {
            throw new Error(`outcome_calibration_inference_load_failed: ${error.message}`);
        }
        if (Array.isArray(data)) {
            rows.push(...data as OutcomeMaterializationInferenceRow[]);
        }
    }
    return rows;
}

async function loadExistingMaterializationKeys(
    client: SupabaseClient,
    tenantId: string,
    algorithmVersion: string,
): Promise<Set<string>> {
    const rows: Array<Record<string, unknown>> = [];
    const pageSize = 1_000;
    for (let offset = 0; offset < MAX_SOURCE_LIMIT; offset += pageSize) {
        const { data, error } = await client
            .from('outcome_calibration_materialization_events')
            .select('inference_event_id,outcome_event_id,algorithm_version')
            .eq('tenant_id', tenantId)
            .eq('algorithm_version', algorithmVersion)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + pageSize - 1);

        if (error) {
            throw new Error(`outcome_calibration_materialization_lookup_failed: ${error.message}`);
        }
        const page = Array.isArray(data)
            ? data as unknown as Array<Record<string, unknown>>
            : [];
        rows.push(...page);
        if (page.length < pageSize) break;
    }

    return new Set(
        rows.map((row) => makeEventKey({
            inference_event_id: normalizeText(row.inference_event_id) ?? '',
            outcome_event_id: normalizeText(row.outcome_event_id) ?? '',
            algorithm_version: normalizeText(row.algorithm_version) ?? '',
        })),
    );
}

async function insertMaterializationEvents(
    client: SupabaseClient,
    events: OutcomeCalibrationMaterializationEvent[],
): Promise<number> {
    if (events.length === 0) return 0;

    let inserted = 0;
    for (const chunk of chunkValues(events, 250)) {
        const { data, error } = await client
            .from('outcome_calibration_materialization_events')
            .upsert(chunk, {
                onConflict:
                    'tenant_id,inference_event_id,outcome_event_id,algorithm_version',
                ignoreDuplicates: true,
            })
            .select('id');

        if (error) {
            throw new Error(`outcome_calibration_materialization_write_failed: ${error.message}`);
        }
        inserted += Array.isArray(data) ? data.length : 0;
    }
    return inserted;
}

async function loadAggregateRunByDigest(
    client: SupabaseClient,
    tenantId: string,
    sourceDigest: string,
): Promise<string | null> {
    const { data, error } = await client
        .from('outcome_calibration_runs')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('source_digest', sourceDigest)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`outcome_calibration_run_lookup_failed: ${error.message}`);
    }
    return normalizeText(data?.id);
}

function makeEventKey(input: {
    inference_event_id: string;
    outcome_event_id: string;
    algorithm_version: string;
}): string {
    return [
        input.inference_event_id,
        input.outcome_event_id,
        input.algorithm_version,
    ].join('|');
}

function compareMaterializationEvents(
    left: OutcomeCalibrationMaterializationEvent,
    right: OutcomeCalibrationMaterializationEvent,
): number {
    return left.inference_event_id.localeCompare(right.inference_event_id)
        || left.observed_at.localeCompare(right.observed_at)
        || left.outcome_event_id.localeCompare(right.outcome_event_id);
}

function countCodes(codes: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const code of codes) counts[code] = (counts[code] ?? 0) + 1;
    return Object.fromEntries(
        Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
    );
}

function normalizeMinimumOutcomes(value: number | undefined): number {
    const configured = Number(
        process.env.VETIOS_OUTCOME_CALIBRATION_MINIMUM_OUTCOMES ?? 20,
    );
    const candidate = value ?? configured;
    return Number.isFinite(candidate) ? Math.max(5, Math.trunc(candidate)) : 20;
}

function normalizeSourceLimit(value: number | undefined): number {
    const configured = Number(
        process.env.VETIOS_OUTCOME_CALIBRATION_MAX_ROWS ?? DEFAULT_SOURCE_LIMIT,
    );
    const candidate = value ?? configured;
    if (!Number.isFinite(candidate)) return DEFAULT_SOURCE_LIMIT;
    return Math.min(MAX_SOURCE_LIMIT, Math.max(1, Math.trunc(candidate)));
}

function chunkValues<T>(values: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

function labelsMatch(left: string, right: string): boolean {
    return normalizeLabel(left) === normalizeLabel(right);
}

function normalizeLabel(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeDimension(value: unknown): string | null {
    const text = normalizeText(value);
    return text ? normalizeLabel(text) : null;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeTimestamp(value: unknown): string | null {
    const text = normalizeText(value);
    if (!text) return null;
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function firstText(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
        const record = asRecord(value);
        const nested = normalizeText(record.label ?? record.name ?? record.value);
        if (nested) return nested;
    }
    return null;
}

function firstArray(...values: unknown[]): unknown[] {
    for (const value of values) {
        if (Array.isArray(value)) return value;
    }
    return [];
}

function readFiniteNumber(...values: unknown[]): number | null {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function clampProbability(value: number): number {
    return Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, value));
}

function roundMetric(value: number): number {
    return Number(clamp01(value).toFixed(6));
}

function roundLoss(value: number): number {
    return Number(value.toFixed(6));
}

function roundSigned(value: number): number {
    return Number(value.toFixed(6));
}

function digestUnknown(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
