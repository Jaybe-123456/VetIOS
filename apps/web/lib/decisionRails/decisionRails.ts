type DecisionRailsSupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult = Promise<{
    data: Array<Record<string, unknown>> | null;
    error: { message?: string } | null;
}>;

type ModuleStatus = 'operational' | 'ready' | 'awaiting_outcome' | 'needs_review' | 'blocked' | 'degraded' | 'missing' | 'unknown';
type DecisionPostureStatus = 'operational' | 'awaiting_outcome' | 'needs_review' | 'blocked' | 'degraded';
type ComputeRouteMode = 'cache_replay' | 'deterministic_first' | 'escalate_high_reasoning' | 'human_review_first';

export interface DecisionRailsInput {
    client: DecisionRailsSupabaseClient;
    tenantId: string;
    decisionId?: string | null;
    inferenceEventId?: string | null;
    requestId?: string | null;
    limit?: number;
}

export interface DecisionRailsModuleSnapshot {
    status: ModuleStatus;
    label: string;
    latest_event_at: string | null;
    event_count: number;
    signals: Record<string, unknown>;
    blockers: string[];
    warnings: string[];
}

export interface DecisionRailsPacket {
    schema_version: 'vetios_decision_rails_v1';
    decision_id: string;
    tenant_id: string;
    generated_at: string;
    anchor: {
        inference_event_id: string | null;
        request_id: string | null;
        clinical_case_id: string | null;
        top_label: string | null;
        confidence: number | null;
        phi_hat: number | null;
        source_module: string | null;
        model_version: string | null;
    };
    posture: {
        status: DecisionPostureStatus;
        next_required_action: string;
        rationale: string[];
        compute_strategy: {
            route_mode: ComputeRouteMode;
            cache_policy: 'reuse_idempotent_result' | 'read_through_cache' | 'no_cache';
            escalation_reason: string | null;
            cost_metering_required: boolean;
        };
    };
    modules: {
        inference: DecisionRailsModuleSnapshot;
        cire: DecisionRailsModuleSnapshot;
        action_gate: DecisionRailsModuleSnapshot;
        review_queue: DecisionRailsModuleSnapshot;
        outcome_learning: DecisionRailsModuleSnapshot;
        ontology: DecisionRailsModuleSnapshot;
        federation: DecisionRailsModuleSnapshot;
        workflow: DecisionRailsModuleSnapshot;
        specialist_review: DecisionRailsModuleSnapshot;
        amr: DecisionRailsModuleSnapshot;
        ai_security: DecisionRailsModuleSnapshot;
        regulatory: DecisionRailsModuleSnapshot;
    };
    timeline: Array<{
        at: string;
        module: keyof DecisionRailsPacket['modules'];
        status: string;
        label: string;
        event_ref: string | null;
    }>;
    blockers: string[];
    warnings: string[];
    query_errors: string[];
}

const DEFAULT_LIMIT = 25;

export async function buildDecisionRailsPacket(input: DecisionRailsInput): Promise<DecisionRailsPacket> {
    const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 100));
    const [
        inferenceRows,
        reliabilityRows,
        gateRows,
        reviewRows,
        outcomeRows,
        ontologyCompletionRows,
        ontologyPopulationRows,
        ontologyReleaseRows,
        federationRuntimeRows,
        federatedSubmissionRows,
        workflowRows,
        specialistRows,
        specialistOperationRows,
        amrRows,
        securityRows,
        regulatoryRows,
    ] = await Promise.all([
        queryRows(input.client, 'ai_inference_events', input.tenantId, '*', limit),
        queryRows(input.client, 'inference_reliability_packets', input.tenantId, '*', limit),
        queryRows(input.client, 'gate_decision_events', input.tenantId, '*', limit),
        queryRows(input.client, 'inference_review_queue_events', input.tenantId, '*', limit),
        queryRows(input.client, 'clinical_outcome_events', input.tenantId, '*', limit),
        queryRows(input.client, 'global_biomedical_ontology_completion_snapshot_events', input.tenantId, '*', limit),
        queryRows(input.client, 'global_biomedical_ontology_population_snapshot_events', input.tenantId, '*', limit),
        queryRows(input.client, 'official_ontology_release_events', input.tenantId, '*', 200),
        queryRows(input.client, 'federation_node_runtime_events', input.tenantId, '*', limit),
        queryRows(input.client, 'federated_update_submissions', input.tenantId, '*', limit),
        queryRows(input.client, 'workflow_integration_run_events', input.tenantId, '*', limit),
        queryRows(input.client, 'specialist_review_events', input.tenantId, '*', limit),
        queryRows(input.client, 'specialist_review_operation_events', input.tenantId, '*', limit),
        queryRows(input.client, 'amr_lab_feed_surveillance_events', input.tenantId, '*', limit),
        queryRows(input.client, 'ai_security_test_events', input.tenantId, '*', limit),
        queryRows(input.client, 'regulatory_claim_review_events', input.tenantId, '*', limit),
    ]);

    const queryErrors = [
        inferenceRows,
        reliabilityRows,
        gateRows,
        reviewRows,
        outcomeRows,
        ontologyCompletionRows,
        ontologyPopulationRows,
        ontologyReleaseRows,
        federationRuntimeRows,
        federatedSubmissionRows,
        workflowRows,
        specialistRows,
        specialistOperationRows,
        amrRows,
        securityRows,
        regulatoryRows,
    ]
        .map((result) => result.error)
        .filter((value): value is string => Boolean(value));

    const anchorInference = findAnchorInference(inferenceRows.data, input);
    const anchorInferenceId = text(input.inferenceEventId) ?? text(anchorInference?.id);
    const anchorRequestId = text(input.requestId) ?? text(anchorInference?.request_id);
    const scopedReliability = filterAnchorRows(reliabilityRows.data, anchorInferenceId, anchorRequestId);
    const scopedGates = filterAnchorRows(gateRows.data, anchorInferenceId, anchorRequestId);
    const scopedReviews = filterAnchorRows(reviewRows.data, anchorInferenceId, anchorRequestId);
    const scopedOutcomes = filterOutcomeRows(outcomeRows.data, anchorInferenceId, anchorRequestId, text(anchorInference?.case_id));

    const inference = buildInferenceModule(anchorInference, inferenceRows.data);
    const cire = buildCireModule(scopedReliability, anchorInference);
    const actionGate = buildGateModule(scopedGates, scopedReliability);
    const reviewQueue = buildReviewModule(scopedReviews);
    const outcomeLearning = buildOutcomeModule(scopedOutcomes, anchorInference);
    const ontology = buildOntologyModule(ontologyCompletionRows.data, ontologyPopulationRows.data, ontologyReleaseRows.data);
    const federation = buildFederationModule(federationRuntimeRows.data, federatedSubmissionRows.data);
    const workflow = buildGenericOperationalModule('Workflow Integration', workflowRows.data, {
        statusKeys: ['run_status', 'workflow_status', 'integration_status'],
        positiveStatuses: ['completed', 'case_ready', 'synced', 'operational'],
        blockedStatuses: ['blocked', 'failed', 'error'],
    });
    const specialistReview = buildSpecialistModule(specialistRows.data, specialistOperationRows.data);
    const amr = buildGenericOperationalModule('AMR Surveillance', amrRows.data, {
        statusKeys: ['surveillance_status', 'feed_status', 'normalization_status'],
        positiveStatuses: ['export_ready', 'normalized', 'imported', 'ready'],
        blockedStatuses: ['blocked', 'failed', 'taxonomy_blocked'],
    });
    const aiSecurity = buildSecurityModule(securityRows.data);
    const regulatory = buildGenericOperationalModule('Regulatory Claims', regulatoryRows.data, {
        statusKeys: ['claim_review_status', 'approval_status', 'cds_evidence_pack_status'],
        positiveStatuses: ['approved', 'complete', 'attested'],
        blockedStatuses: ['blocked', 'rejected', 'failed'],
    });

    const modules = {
        inference,
        cire,
        action_gate: actionGate,
        review_queue: reviewQueue,
        outcome_learning: outcomeLearning,
        ontology,
        federation,
        workflow,
        specialist_review: specialistReview,
        amr,
        ai_security: aiSecurity,
        regulatory,
    };
    const blockers = unique(Object.values(modules).flatMap((module) => module.blockers));
    const warnings = unique(Object.values(modules).flatMap((module) => module.warnings));
    const posture = resolvePosture({
        modules,
        blockers,
        warnings,
        anchorInference,
        anchorInferenceId,
        anchorRequestId,
    });

    return {
        schema_version: 'vetios_decision_rails_v1',
        decision_id: buildDecisionId(input.decisionId, anchorInferenceId, anchorRequestId),
        tenant_id: input.tenantId,
        generated_at: new Date().toISOString(),
        anchor: {
            inference_event_id: anchorInferenceId,
            request_id: anchorRequestId,
            clinical_case_id: text(anchorInference?.case_id),
            top_label: readTopLabel(anchorInference, scopedReliability[0]),
            confidence: readConfidence(anchorInference, scopedReliability[0]),
            phi_hat: numberOrNull(anchorInference?.phi_hat) ?? readNestedNumber(anchorInference, ['output_payload', 'cire', 'phi_hat']),
            source_module: text(anchorInference?.source_module),
            model_version: text(anchorInference?.model_version),
        },
        posture,
        modules,
        timeline: buildTimeline(modules),
        blockers,
        warnings,
        query_errors: queryErrors,
    };
}

async function queryRows(
    client: DecisionRailsSupabaseClient,
    tableName: string,
    tenantId: string,
    columns: string,
    limit: number,
): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
    try {
        const table = client.from(tableName) as {
            select: (columns: string) => {
                eq: (column: string, value: string) => {
                    order: (column: string, options: { ascending: boolean }) => {
                        limit: (limit: number) => QueryResult;
                    };
                };
            };
        };
        const { data, error } = await table
            .select(columns)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(limit);

        return {
            data: Array.isArray(data) ? data : [],
            error: error?.message ? `${tableName}: ${error.message}` : null,
        };
    } catch (error) {
        return {
            data: [],
            error: `${tableName}: ${error instanceof Error ? error.message : 'query_failed'}`,
        };
    }
}

function findAnchorInference(rows: Record<string, unknown>[], input: DecisionRailsInput) {
    const inferenceEventId = text(input.inferenceEventId);
    const requestId = text(input.requestId);
    if (inferenceEventId) {
        return rows.find((row) => text(row.id) === inferenceEventId) ?? rows[0] ?? null;
    }
    if (requestId) {
        return rows.find((row) => text(row.request_id) === requestId) ?? rows[0] ?? null;
    }
    return rows[0] ?? null;
}

function filterAnchorRows(rows: Record<string, unknown>[], inferenceEventId: string | null, requestId: string | null) {
    if (!inferenceEventId && !requestId) return rows;
    const filtered = rows.filter((row) => (
        (inferenceEventId && text(row.inference_event_id) === inferenceEventId)
        || (requestId && text(row.request_id) === requestId)
    ));
    return filtered.length > 0 ? filtered : [];
}

function filterOutcomeRows(
    rows: Record<string, unknown>[],
    inferenceEventId: string | null,
    requestId: string | null,
    caseId: string | null,
) {
    if (!inferenceEventId && !requestId && !caseId) return rows;
    const filtered = rows.filter((row) => (
        (inferenceEventId && text(row.inference_event_id) === inferenceEventId)
        || (requestId && text(row.request_id) === requestId)
        || (caseId && text(row.case_id) === caseId)
    ));
    return filtered.length > 0 ? filtered : [];
}

function buildInferenceModule(anchorInference: Record<string, unknown> | null, rows: Record<string, unknown>[]): DecisionRailsModuleSnapshot {
    if (!anchorInference) {
        return moduleSnapshot('missing', 'Inference Anchor Missing', null, rows.length, {}, ['inference_anchor_missing'], []);
    }
    const outputPayload = record(anchorInference.output_payload);
    const latency = numberOrNull(anchorInference.inference_latency_ms);
    const cached = Boolean(anchorInference.idempotent) || Boolean(record(anchorInference.meta).idempotent);
    const warnings = latency != null && latency > 8000 ? ['inference_latency_above_8s'] : [];
    return moduleSnapshot('operational', 'Inference Anchor', latestAt([anchorInference]), rows.length, {
        model_version: text(anchorInference.model_version),
        confidence: readConfidence(anchorInference, null),
        top_label: readTopLabel(anchorInference, null),
        latency_ms: latency,
        cached,
        species: readSpecies(outputPayload),
    }, [], warnings);
}

function buildCireModule(rows: Record<string, unknown>[], anchorInference: Record<string, unknown> | null): DecisionRailsModuleSnapshot {
    const latest = rows[0] ?? null;
    const finalState = text(latest?.final_state);
    const packet = record(latest?.packet);
    const phiHat = numberOrNull(anchorInference?.phi_hat)
        ?? numberOrNull(record(record(anchorInference?.output_payload).cire).phi_hat)
        ?? readNestedNumber(packet, ['clinical_context', 'phi_hat']);
    const blockers = stringArray(latest?.blockers);
    const warnings = stringArray(latest?.warnings);
    if (!latest && !anchorInference) return moduleSnapshot('missing', 'CIRE Unavailable', null, 0, {}, ['cire_packet_missing'], []);
    if (!latest) {
        return moduleSnapshot('degraded', 'CIRE Reliability Gate', null, 0, {
            final_state: 'not_recorded',
            phi_hat: phiHat,
        }, [], ['cire_reliability_packet_missing']);
    }
    if (finalState === 'suppress' || finalState === 'hold') {
        return moduleSnapshot('blocked', 'CIRE Reliability Gate', latestAt(rows), rows.length, {
            final_state: finalState,
            phi_hat: phiHat,
            risk_class: text(latest?.risk_class),
            calibration_status: text(latest?.calibration_status),
        }, blockers.length ? blockers : [`cire_final_state_${finalState}`], warnings);
    }
    if (finalState === 'review') {
        return moduleSnapshot('needs_review', 'CIRE Reliability Gate', latestAt(rows), rows.length, {
            final_state: finalState,
            phi_hat: phiHat,
            risk_class: text(latest?.risk_class),
            calibration_status: text(latest?.calibration_status),
        }, blockers, warnings.length ? warnings : ['cire_review_state']);
    }
    const inferredStatus: ModuleStatus = phiHat != null && phiHat < 0.5 ? 'degraded' : 'operational';
    return moduleSnapshot(inferredStatus, 'CIRE Reliability Gate', latestAt(rows), rows.length, {
        final_state: finalState ?? 'not_recorded',
        phi_hat: phiHat,
        risk_class: text(latest?.risk_class),
        calibration_status: text(latest?.calibration_status),
    }, blockers, warnings);
}

function buildGateModule(rows: Record<string, unknown>[], reliabilityRows: Record<string, unknown>[]): DecisionRailsModuleSnapshot {
    const latest = rows[0] ?? null;
    const reliability = reliabilityRows[0] ?? null;
    const finalState = text(latest?.final_state) ?? text(reliability?.final_state);
    const blockers = unique([...stringArray(latest?.blockers), ...stringArray(reliability?.blockers)]);
    const warnings = unique([...stringArray(latest?.warnings), ...stringArray(reliability?.warnings)]);
    if (!latest && !reliability) {
        return moduleSnapshot('missing', 'Action Gate Missing', null, 0, {}, ['gate_decision_missing'], []);
    }
    const status: ModuleStatus = finalState === 'suppress' || finalState === 'hold'
        ? 'blocked'
        : finalState === 'review'
            ? 'needs_review'
            : 'operational';
    return moduleSnapshot(status, 'Actionability / Reliability Decision', latestAt([latest, reliability].filter(isRecord)), rows.length || reliabilityRows.length, {
        final_state: finalState,
        decision: text(latest?.decision) ?? text(reliability?.actionability_decision),
        gate_kind: text(latest?.gate_kind),
        packet_digest: text(latest?.packet_digest) ?? text(reliability?.packet_digest),
    }, blockers, warnings);
}

function buildReviewModule(rows: Record<string, unknown>[]): DecisionRailsModuleSnapshot {
    const latest = rows[0] ?? null;
    if (!latest) {
        return moduleSnapshot('ready', 'Review Queue Clear', null, 0, { open_reviews: 0 }, [], []);
    }
    const unresolved = rows.filter((row) => !['resolved', 'dismissed'].includes(text(row.review_status) ?? text(row.status) ?? ''));
    const blockers = unresolved.some((row) => text(row.severity) === 'critical') ? ['critical_review_unresolved'] : [];
    const warnings = unresolved.length > 0 ? ['clinical_review_pending'] : [];
    return moduleSnapshot(unresolved.length > 0 ? 'needs_review' : 'operational', 'Clinical Review Queue', latestAt(rows), rows.length, {
        open_reviews: unresolved.length,
        latest_status: text(latest.review_status) ?? text(latest.status),
        severity: text(latest.severity),
        review_reason: text(latest.review_reason),
    }, blockers, warnings);
}

function buildOutcomeModule(rows: Record<string, unknown>[], anchorInference: Record<string, unknown> | null): DecisionRailsModuleSnapshot {
    if (!anchorInference) {
        return moduleSnapshot('missing', 'Outcome Anchor Missing', null, rows.length, {}, ['inference_required_before_outcome'], []);
    }
    if (rows.length === 0) {
        return moduleSnapshot('awaiting_outcome', 'Outcome Learning Pending', null, 0, {
            linked_outcomes: 0,
            clinical_case_id: text(anchorInference.case_id),
        }, [], ['confirmed_outcome_missing']);
    }
    const latest = rows[0];
    return moduleSnapshot('operational', 'Outcome Learning Linked', latestAt(rows), rows.length, {
        linked_outcomes: rows.length,
        outcome_status: text(latest.outcome_status) ?? text(latest.confirmation_status) ?? text(latest.outcome_confirmation_status),
        confirmed_diagnosis: text(latest.confirmed_diagnosis) ?? text(latest.label),
    }, [], []);
}

function buildOntologyModule(
    completionRows: Record<string, unknown>[],
    populationRows: Record<string, unknown>[],
    releaseRows: Record<string, unknown>[],
): DecisionRailsModuleSnapshot {
    const completion = completionRows[0] ?? null;
    const population = populationRows[0] ?? null;
    const completionStatus = text(completion?.completion_status);
    const populationStatus = text(population?.population_status);
    const missingProviders = stringArray(completion?.missing_provider_keys);
    const blockers = unique([
        ...stringArray(completion?.blockers),
        ...stringArray(population?.blockers),
        ...missingProviders.map((provider) => `ontology_provider_missing:${provider}`),
    ]);
    const warnings = unique([
        ...stringArray(completion?.warnings),
        ...stringArray(population?.warnings),
        ...(releaseRows.length === 0 ? ['official_ontology_releases_missing'] : []),
    ]);
    const status: ModuleStatus = completionStatus === 'complete' || completionStatus === 'operational' || completionStatus === 'fully_populated'
        ? 'operational'
        : releaseRows.length > 0
            ? 'degraded'
            : 'blocked';
    return moduleSnapshot(status, 'Global One Health Ontology', latestAt([...completionRows, ...populationRows, ...releaseRows]), releaseRows.length, {
        completion_status: completionStatus,
        population_status: populationStatus,
        imported_provider_count: numberOrNull(completion?.imported_provider_count) ?? numberOrNull(population?.imported_provider_count) ?? 0,
        missing_provider_count: numberOrNull(completion?.missing_provider_count) ?? numberOrNull(population?.blocked_provider_count) ?? missingProviders.length,
        coverage_score: numberOrNull(completion?.latest_coverage_score),
        open_world_candidate_generation_status: text(completion?.open_world_candidate_generation_status),
        scoring_state: text(completion?.scoring_state),
    }, blockers, warnings);
}

function buildFederationModule(runtimeRows: Record<string, unknown>[], submissionRows: Record<string, unknown>[]): DecisionRailsModuleSnapshot {
    const latestRuntime = runtimeRows[0] ?? null;
    const latestSubmission = submissionRows[0] ?? null;
    const blockers = unique([
        ...runtimeRows.flatMap((row) => stringArray(row.blockers)),
        ...(runtimeRows.length === 0 ? ['federation_node_runtime_missing'] : []),
    ]);
    const acceptedSubmissions = submissionRows.filter((row) => text(row.submission_status) === 'accepted').length;
    const onlineNodes = runtimeRows.filter((row) => text(row.node_status) === 'online').length;
    const readyAggregation = runtimeRows.some((row) => text(row.secure_aggregation_status) === 'ready');
    const status: ModuleStatus = blockers.length > 0 && runtimeRows.length === 0
        ? 'missing'
        : readyAggregation && acceptedSubmissions > 0
            ? 'operational'
            : runtimeRows.length > 0
                ? 'degraded'
                : 'missing';
    return moduleSnapshot(status, 'Federated Execution Rail', latestAt([...runtimeRows, ...submissionRows]), runtimeRows.length + submissionRows.length, {
        runtime_events: runtimeRows.length,
        update_submissions: submissionRows.length,
        accepted_update_submissions: acceptedSubmissions,
        online_nodes: onlineNodes,
        secure_aggregation_ready: readyAggregation,
        latest_runtime_event: text(latestRuntime?.runtime_event),
        latest_submission_status: text(latestSubmission?.submission_status),
    }, status === 'missing' ? blockers : [], status === 'degraded' ? ['federation_not_yet_materialized_for_this_tenant'] : []);
}

function buildSpecialistModule(reviewRows: Record<string, unknown>[], operationRows: Record<string, unknown>[]): DecisionRailsModuleSnapshot {
    const rows = [...reviewRows, ...operationRows];
    const openOperations = operationRows.filter((row) => !['completed', 'closed', 'cancelled'].includes(text(row.operation_status) ?? text(row.review_status) ?? '')).length;
    const status: ModuleStatus = openOperations > 0 ? 'needs_review' : rows.length > 0 ? 'operational' : 'missing';
    return moduleSnapshot(status, 'Specialist Review Operations', latestAt(rows), rows.length, {
        review_events: reviewRows.length,
        operation_events: operationRows.length,
        open_operations: openOperations,
        latest_review_status: text(reviewRows[0]?.review_status),
        latest_operation_status: text(operationRows[0]?.operation_status),
    }, [], openOperations > 0 ? ['specialist_review_turnaround_pending'] : []);
}

function buildSecurityModule(rows: Record<string, unknown>[]): DecisionRailsModuleSnapshot {
    if (rows.length === 0) {
        return moduleSnapshot('missing', 'AI Security Evidence Missing', null, 0, {}, ['ai_security_tests_missing'], []);
    }
    const incidents = rows.filter((row) => row.incident_required === true || text(row.test_status) === 'failed' || row.attack_detected === true);
    const blocked = incidents.some((row) => row.blocked_by_policy !== true);
    return moduleSnapshot(blocked ? 'blocked' : incidents.length > 0 ? 'needs_review' : 'operational', 'AI Security Evidence Layer', latestAt(rows), rows.length, {
        test_events: rows.length,
        incidents: incidents.length,
        latest_test_case_type: text(rows[0]?.test_case_type),
        latest_status: text(rows[0]?.test_status),
    }, blocked ? ['unblocked_ai_security_incident'] : [], incidents.length > 0 ? ['ai_security_incident_review_required'] : []);
}

function buildGenericOperationalModule(
    label: string,
    rows: Record<string, unknown>[],
    config: {
        statusKeys: string[];
        positiveStatuses: string[];
        blockedStatuses: string[];
    },
): DecisionRailsModuleSnapshot {
    if (rows.length === 0) return moduleSnapshot('missing', `${label} Missing`, null, 0, {}, [`${snake(label)}_events_missing`], []);
    const latest = rows[0];
    const statuses = rows.map((row) => firstText(config.statusKeys.map((key) => row[key]))).filter((entry): entry is string => Boolean(entry));
    const latestStatus = statuses[0] ?? null;
    const blocked = statuses.some((status) => config.blockedStatuses.includes(status));
    const positive = statuses.some((status) => config.positiveStatuses.includes(status));
    return moduleSnapshot(blocked ? 'blocked' : positive ? 'operational' : 'degraded', label, latestAt(rows), rows.length, {
        latest_status: latestStatus,
        latest_id: text(latest.id),
        event_count: rows.length,
    }, blocked ? [`${snake(label)}_blocked`] : [], positive ? [] : [`${snake(label)}_not_operational`]);
}

function resolvePosture(input: {
    modules: DecisionRailsPacket['modules'];
    blockers: string[];
    warnings: string[];
    anchorInference: Record<string, unknown> | null;
    anchorInferenceId: string | null;
    anchorRequestId: string | null;
}): DecisionRailsPacket['posture'] {
    const rationale: string[] = [];
    let status: DecisionPostureStatus = 'operational';
    let nextRequiredAction = 'continue_operational_monitoring';

    if (!input.anchorInference) {
        status = 'blocked';
        nextRequiredAction = 'run_or_select_inference_anchor';
        rationale.push('Decision Rails needs an inference event as the operational anchor.');
    } else if (input.modules.action_gate.status === 'blocked' || input.modules.cire.status === 'blocked' || input.blockers.length > 0) {
        status = 'blocked';
        nextRequiredAction = 'resolve_blockers_before_action';
        rationale.push('One or more hard blockers exist across CIRE, gate, ontology, security, or dependent ledgers.');
    } else if (input.modules.review_queue.status === 'needs_review' || input.modules.action_gate.status === 'needs_review' || input.modules.cire.status === 'needs_review') {
        status = 'needs_review';
        nextRequiredAction = 'complete_clinician_review';
        rationale.push('The reliability rail requires human review before action.');
    } else if (input.modules.outcome_learning.status === 'awaiting_outcome') {
        status = 'awaiting_outcome';
        nextRequiredAction = 'capture_confirmed_outcome';
        rationale.push('The inference is usable as decision support but cannot become calibrated learning evidence until outcome closure.');
    } else if (Object.values(input.modules).some((module) => module.status === 'degraded' || module.status === 'missing')) {
        status = 'degraded';
        nextRequiredAction = 'repair_missing_or_degraded_evidence_rails';
        rationale.push('The anchored decision is available, but one or more operating moats lack fresh evidence.');
    }

    return {
        status,
        next_required_action: nextRequiredAction,
        rationale: rationale.length > 0 ? rationale : ['All observed decision rails are operational for this anchor.'],
        compute_strategy: resolveComputeStrategy(input),
    };
}

function resolveComputeStrategy(input: {
    modules: DecisionRailsPacket['modules'];
    blockers: string[];
    warnings: string[];
    anchorInference: Record<string, unknown> | null;
    anchorInferenceId: string | null;
    anchorRequestId: string | null;
}): DecisionRailsPacket['posture']['compute_strategy'] {
    if (!input.anchorInference) {
        return {
            route_mode: 'human_review_first',
            cache_policy: 'no_cache',
            escalation_reason: 'inference_anchor_missing',
            cost_metering_required: true,
        };
    }
    const inferenceSignals = input.modules.inference.signals;
    const cached = inferenceSignals.cached === true || Boolean(input.anchorRequestId);
    const phiHat = numberOrNull(input.modules.cire.signals.phi_hat);
    const confidence = numberOrNull(inferenceSignals.confidence);
    if (input.modules.review_queue.status === 'needs_review' || input.modules.action_gate.status === 'blocked') {
        return {
            route_mode: 'human_review_first',
            cache_policy: cached ? 'read_through_cache' : 'no_cache',
            escalation_reason: 'clinical_review_or_gate_blocker',
            cost_metering_required: true,
        };
    }
    if (
        input.modules.ontology.status === 'blocked'
        || input.modules.ontology.status === 'degraded'
        || (phiHat != null && phiHat < 0.7)
        || (confidence != null && confidence >= 0.9 && input.modules.outcome_learning.status === 'awaiting_outcome')
    ) {
        return {
            route_mode: 'escalate_high_reasoning',
            cache_policy: cached ? 'read_through_cache' : 'no_cache',
            escalation_reason: 'ontology_or_reliability_uncertainty',
            cost_metering_required: true,
        };
    }
    return {
        route_mode: cached ? 'cache_replay' : 'deterministic_first',
        cache_policy: cached ? 'reuse_idempotent_result' : 'read_through_cache',
        escalation_reason: null,
        cost_metering_required: true,
    };
}

function buildTimeline(modules: DecisionRailsPacket['modules']): DecisionRailsPacket['timeline'] {
    return (Object.entries(modules) as Array<[keyof DecisionRailsPacket['modules'], DecisionRailsModuleSnapshot]>)
        .filter(([, module]) => module.latest_event_at)
        .map(([moduleKey, module]) => ({
            at: module.latest_event_at as string,
            module: moduleKey,
            status: module.status,
            label: module.label,
            event_ref: text(module.signals.latest_id),
        }))
        .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
        .slice(0, 30);
}

function moduleSnapshot(
    status: ModuleStatus,
    label: string,
    latestEventAt: string | null,
    eventCount: number,
    signals: Record<string, unknown>,
    blockers: string[],
    warnings: string[],
): DecisionRailsModuleSnapshot {
    return {
        status,
        label,
        latest_event_at: latestEventAt,
        event_count: eventCount,
        signals,
        blockers: unique(blockers),
        warnings: unique(warnings),
    };
}

function buildDecisionId(inputDecisionId: string | null | undefined, inferenceEventId: string | null, requestId: string | null) {
    return text(inputDecisionId)
        ?? (inferenceEventId ? `decision:inference:${inferenceEventId}` : null)
        ?? (requestId ? `decision:request:${requestId}` : null)
        ?? `decision:tenant:${Date.now()}`;
}

function latestAt(rows: Record<string, unknown>[]) {
    const times = rows
        .map((row) => text(row.created_at) ?? text(row.observed_at) ?? text(row.updated_at))
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => Date.parse(right) - Date.parse(left));
    return times[0] ?? null;
}

function readTopLabel(inference: Record<string, unknown> | null, reliability: Record<string, unknown> | null) {
    return text(reliability?.top_label)
        ?? text(record(inference?.output_payload).top_label)
        ?? text(record(record(inference?.output_payload).diagnosis).label)
        ?? readDifferentialLabel(record(inference?.output_payload));
}

function readDifferentialLabel(outputPayload: Record<string, unknown>) {
    const diagnosis = record(outputPayload.diagnosis);
    const differentials: unknown[] = Array.isArray(outputPayload.differentials)
        ? outputPayload.differentials
        : Array.isArray(diagnosis.top_differentials)
            ? diagnosis.top_differentials
            : [];
    const first = record(differentials[0]);
    return text(first.label) ?? text(first.diagnosis) ?? text(first.name);
}

function readConfidence(inference: Record<string, unknown> | null, reliability: Record<string, unknown> | null) {
    return numberOrNull(reliability?.top_confidence)
        ?? numberOrNull(inference?.confidence_score)
        ?? numberOrNull(record(inference?.output_payload).confidence_score)
        ?? numberOrNull(record(inference?.output_payload).primary_confidence);
}

function readSpecies(outputPayload: Record<string, unknown>) {
    return text(record(outputPayload.clinical_context).species)
        ?? text(record(record(outputPayload.governance_lineage).input_signature).species)
        ?? text(outputPayload.species);
}

function firstText(values: unknown[]) {
    for (const value of values) {
        const candidate = text(value);
        if (candidate) return candidate;
    }
    return null;
}

function readNestedNumber(recordValue: unknown, path: string[]) {
    let current: unknown = recordValue;
    for (const segment of path) current = record(current)[segment];
    return numberOrNull(current);
}

function unique(values: string[]) {
    return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function snake(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(text).filter((entry): entry is string => Boolean(entry))
        : [];
}
