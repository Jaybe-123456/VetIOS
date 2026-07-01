import { createHash, randomUUID } from 'crypto';
import type { InferenceActionabilityGateResult } from './actionabilityGate';
import type { InferenceCalibrationSnapshot } from './calibrationSnapshot';
import { extractDifferentialDistribution } from './calibrationSnapshot';
import type { InferenceReviewQueueEvent } from './reviewQueue';

type ReliabilitySupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;

export type InferenceReliabilityState = 'trusted' | 'review' | 'hold' | 'suppress';

export interface InferenceReliabilityPacketInput {
    tenantId: string;
    inferenceEventId: string;
    requestId?: string | null;
    caseId?: string | null;
    modelName?: string | null;
    modelVersion?: string | null;
    schemaVersion?: string | null;
    sourceModule?: string | null;
    ranker?: string | null;
    outputPayload: Record<string, unknown>;
    confidenceScore?: number | null;
    phiHat?: number | null;
    latencyMs?: number | null;
    calibrationSnapshot?: InferenceCalibrationSnapshot | null;
    actionabilityGate?: InferenceActionabilityGateResult | null;
    reviewQueueEvent?: InferenceReviewQueueEvent | null;
}

export interface InferenceReliabilityPacket {
    id?: string;
    tenant_id: string;
    inference_event_id: string;
    request_id: string | null;
    case_id: string | null;
    packet_version: 'vetios_inference_reliability_packet_v1';
    final_state: InferenceReliabilityState;
    top_label: string | null;
    top_confidence: number;
    risk_class: 'routine' | 'elevated' | 'high' | 'critical';
    calibration_status: InferenceCalibrationSnapshot['calibration_status'];
    historical_sample_count: number;
    actionability_decision: InferenceActionabilityGateResult['decision'] | 'not_available';
    review_queue_event_id: string | null;
    training_eligible: boolean;
    reasons: string[];
    blockers: string[];
    warnings: string[];
    packet_digest: string;
    packet: Record<string, unknown>;
    created_at?: string;
}

export async function recordInferenceReliabilityPacket(
    client: ReliabilitySupabaseClient,
    input: InferenceReliabilityPacketInput,
): Promise<{ data: InferenceReliabilityPacket | null; error: string | null }> {
    const computed = buildInferenceReliabilityPacket(input);
    const insertRow = {
        tenant_id: computed.tenant_id,
        inference_event_id: computed.inference_event_id,
        request_id: computed.request_id,
        case_id: computed.case_id,
        packet_version: computed.packet_version,
        final_state: computed.final_state,
        top_label: computed.top_label,
        top_confidence: computed.top_confidence,
        risk_class: computed.risk_class,
        calibration_status: computed.calibration_status,
        historical_sample_count: computed.historical_sample_count,
        actionability_decision: computed.actionability_decision,
        review_queue_event_id: computed.review_queue_event_id,
        training_eligible: computed.training_eligible,
        reasons: computed.reasons,
        blockers: computed.blockers,
        warnings: computed.warnings,
        packet_digest: computed.packet_digest,
        packet: computed.packet,
    };

    const packetTable = client.from('inference_reliability_packets') as {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => QueryResult<Record<string, unknown>>;
            };
        };
    };

    const { data, error } = await packetTable
        .insert(insertRow)
        .select('id, tenant_id, inference_event_id, request_id, case_id, packet_version, final_state, top_label, top_confidence, risk_class, calibration_status, historical_sample_count, actionability_decision, review_queue_event_id, training_eligible, reasons, blockers, warnings, packet_digest, packet, created_at')
        .single();

    if (error) {
        console.warn(JSON.stringify({
            event: 'inference_reliability_packet_insert_failed',
            inference_event_id: input.inferenceEventId,
            error: error.message ?? 'unknown',
        }));
        return { data: null, error: error.message ?? 'inference_reliability_packet_insert_failed' };
    }

    const packet = data ? normalizeReliabilityPacketRow(data) : null;
    if (!packet) return { data: null, error: 'inference_reliability_packet_insert_returned_no_row' };

    await recordGateDecisionEvent(client, packet);
    return { data: packet, error: null };
}

export function buildInferenceReliabilityPacket(input: InferenceReliabilityPacketInput): InferenceReliabilityPacket {
    const distribution = extractDifferentialDistribution(input.outputPayload);
    const top = distribution[0] ?? null;
    const calibration = input.calibrationSnapshot ?? null;
    const gate = input.actionabilityGate ?? null;
    const topLabel = gate?.top_label ?? calibration?.top_label ?? top?.label ?? readString(asRecord(input.outputPayload.diagnosis).label);
    const topConfidence = clamp01(
        gate?.top_confidence
        ?? calibration?.top_confidence
        ?? input.confidenceScore
        ?? top?.probability
        ?? readNumber(input.outputPayload.confidence_score)
        ?? 0,
    );
    const phiHat = clamp01(gate?.phi_hat ?? calibration?.phi_hat ?? input.phiHat ?? readNumber(asRecord(input.outputPayload.cire).phi_hat) ?? 0);
    const contradictionScore = clamp01(
        gate?.contradiction_score
        ?? calibration?.contradiction_score
        ?? readNumber(input.outputPayload.contradiction_score)
        ?? readNumber(asRecord(input.outputPayload.contradiction_analysis).contradiction_score)
        ?? 0,
    );
    const calibrationStatus = gate?.calibration_status ?? calibration?.calibration_status ?? 'indeterminate';
    const historicalSampleCount = Math.max(0, Math.trunc(gate?.historical_sample_count ?? calibration?.historical_sample_count ?? 0));
    const actionabilityDecision = gate?.decision ?? 'not_available';
    const riskClass = classifyRisk(input.outputPayload);
    const evidence = deriveEvidenceState(input.outputPayload);
    const rag = deriveRagState(input.outputPayload);
    const security = deriveSecurityState(input.outputPayload);
    const amr = deriveAmrState(input.outputPayload);

    const blockers: string[] = [];
    const warnings: string[] = [];
    const reasons: string[] = [];

    if (actionabilityDecision === 'suppressed') blockers.push('actionability_gate_suppressed');
    if (gate?.reliability_badge === 'SUPPRESSED' || phiHat < 0.25) blockers.push('cire_reliability_suppressed');
    if (security.phiLeakage || security.promptInjection || security.toolAbuse || security.ragBoundaryViolation) blockers.push('security_boundary_failed');
    if (security.fabricatedCitation) blockers.push('fabricated_citation_risk');
    if (contradictionScore >= 0.75 || gate?.abstain_recommendation === true) blockers.push('high_contradiction_or_abstain');

    if (actionabilityDecision === 'hold_for_evidence') blockers.push('actionability_gate_hold');
    if (topConfidence >= 0.8 && calibrationStatus === 'needs_outcome' && historicalSampleCount < 5) blockers.push('high_confidence_without_outcome_calibration');
    if (riskClass === 'critical' && evidence.inputCompleteness < 0.5) blockers.push('critical_case_insufficient_evidence');
    if (evidence.labContradiction) blockers.push('lab_contradiction_detected');
    if (rag.citationRequired && rag.sourceAuthorityScore < 0.65) blockers.push('source_authority_below_trust_threshold');
    if (amr.antimicrobialSuggested && amr.stewardshipRisk !== 'low' && !amr.cultureRecommended) blockers.push('amr_stewardship_justification_missing');

    if (actionabilityDecision === 'review_before_action') warnings.push('actionability_gate_review');
    if (calibrationStatus === 'needs_outcome') warnings.push('needs_outcome_calibration');
    if (historicalSampleCount > 0 && historicalSampleCount < 30) warnings.push('low_outcome_bucket_count');
    if (evidence.counterfactualFragility) warnings.push('counterfactual_fragility');
    if (rag.citationRequired && rag.citationQualityScore < 0.85) warnings.push('citation_quality_borderline');
    if (evidence.novelPattern) warnings.push('novel_species_diagnosis_or_tenant_pattern');

    const finalState = classifyFinalState({ blockers, warnings, actionabilityDecision });
    reasons.push(...blockers, ...warnings);
    if (reasons.length === 0) reasons.push('all_available_reliability_gates_passed');

    const packet = {
        model: {
            provider: 'vetios-clinical-engine',
            model_name: input.modelName ?? readString(asRecord(input.outputPayload.governance_lineage).model_name),
            model_version: input.modelVersion ?? readString(asRecord(input.outputPayload.governance_lineage).model_version),
            schema_version: input.schemaVersion ?? readString(asRecord(input.outputPayload.governance_lineage).schema_version),
            ranker: input.ranker ?? readString(input.outputPayload.ranker),
        },
        clinical_context: {
            species: readSpecies(input.outputPayload),
            diagnosis_top1: topLabel,
            top_confidence: roundMetric(topConfidence),
            risk_class: riskClass,
            evidence_type: evidence.evidenceTypes,
            source_module: input.sourceModule,
        },
        calibration: {
            status: calibrationStatus,
            bucket_label_count: historicalSampleCount,
            expected_calibration_error: calibration?.expected_calibration_error ?? null,
            brier_score: null,
            overconfidence_flag: calibrationStatus === 'overconfident',
        },
        drift: {
            replay_required: finalState !== 'trusted' || topConfidence >= 0.8 || riskClass === 'critical',
            tenant_drift_score: null,
            species_drift_score: null,
            diagnosis_drift_score: null,
            model_version_shift_flag: false,
        },
        counterfactual_stability: {
            stability_score: evidence.counterfactualStabilityScore,
            fragility_flag: evidence.counterfactualFragility,
            fragile_features: evidence.fragileFeatures,
        },
        rag_grounding: {
            citation_required: rag.citationRequired,
            citation_quality_score: roundMetric(rag.citationQualityScore),
            source_authority_score: roundMetric(rag.sourceAuthorityScore),
            citation_faithfulness_score: roundMetric(rag.citationFaithfulnessScore),
            contradictory_source_flag: rag.contradictorySource,
            source_versions_present: rag.sourceVersionsPresent,
        },
        lab_contradictions: {
            contradiction_detected: evidence.labContradiction,
            negative_test_conflict: evidence.negativeTestConflict,
            unit_normalization_confidence: evidence.unitNormalizationConfidence,
        },
        amr_stewardship: amr,
        security,
        gate: {
            final_state: finalState,
            reasons,
            review_task_id: input.reviewQueueEvent?.id ?? null,
            training_eligible: finalState === 'trusted' && calibrationStatus !== 'needs_outcome',
            actionability_decision: actionabilityDecision,
        },
        policy_basis: {
            version: 'vetios_reliability_orchestrator_v1',
            design_principles: [
                'total_product_lifecycle_monitoring',
                'runtime_risk_governance',
                'human_oversight_and_deferral',
                'source_faithfulness_before_trust',
                'outcome_calibration_before_high_confidence',
            ],
            attachment_review: 'Accepted: the research signal correctly maps FDA/NIST/OWASP/FHIR-style monitoring discipline into VetIOS runtime packets, review queues, drift checks, citation enforcement, lab normalization, and treatment feedback loops.',
            privacy_boundary: 'no raw clinical narrative, raw documents, owner identifiers, contacts, microchip IDs, or raw model deltas stored in this packet',
        },
    };
    const digest = digestUnknown(packet);

    return {
        tenant_id: input.tenantId,
        inference_event_id: input.inferenceEventId,
        request_id: input.requestId ?? null,
        case_id: input.caseId ?? null,
        packet_version: 'vetios_inference_reliability_packet_v1',
        final_state: finalState,
        top_label: topLabel,
        top_confidence: roundMetric(topConfidence),
        risk_class: riskClass,
        calibration_status: calibrationStatus,
        historical_sample_count: historicalSampleCount,
        actionability_decision: actionabilityDecision,
        review_queue_event_id: input.reviewQueueEvent?.id ?? null,
        training_eligible: finalState === 'trusted' && calibrationStatus !== 'needs_outcome',
        reasons,
        blockers,
        warnings,
        packet_digest: digest,
        packet,
    };
}

async function recordGateDecisionEvent(
    client: ReliabilitySupabaseClient,
    packet: InferenceReliabilityPacket,
): Promise<void> {
    try {
        const table = client.from('gate_decision_events') as {
            insert: (payload: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
        };
        const { error } = await table.insert({
            tenant_id: packet.tenant_id,
            inference_event_id: packet.inference_event_id,
            reliability_packet_id: packet.id ?? null,
            request_id: packet.request_id,
            case_id: packet.case_id,
            gate_kind: 'inference_reliability',
            gate_version: packet.packet_version,
            final_state: packet.final_state,
            decision: packet.final_state,
            reasons: packet.reasons,
            blockers: packet.blockers,
            warnings: packet.warnings,
            packet_digest: packet.packet_digest,
            evidence: {
                top_label: packet.top_label,
                top_confidence: packet.top_confidence,
                calibration_status: packet.calibration_status,
                historical_sample_count: packet.historical_sample_count,
                actionability_decision: packet.actionability_decision,
                review_queue_event_id: packet.review_queue_event_id,
            },
        });
        if (error) {
            console.warn(JSON.stringify({
                event: 'gate_decision_event_insert_failed',
                inference_event_id: packet.inference_event_id,
                error: error.message ?? 'unknown',
            }));
        }
    } catch (error) {
        console.warn(JSON.stringify({
            event: 'gate_decision_event_insert_exception',
            inference_event_id: packet.inference_event_id,
            error: error instanceof Error ? error.message : 'unknown',
        }));
    }
}

function classifyFinalState(input: {
    blockers: string[];
    warnings: string[];
    actionabilityDecision: InferenceReliabilityPacket['actionability_decision'];
}): InferenceReliabilityState {
    const suppressBlockers = new Set([
        'actionability_gate_suppressed',
        'cire_reliability_suppressed',
        'security_boundary_failed',
        'fabricated_citation_risk',
        'high_contradiction_or_abstain',
    ]);
    if (input.blockers.some((blocker) => suppressBlockers.has(blocker))) return 'suppress';
    if (input.blockers.length > 0) return 'hold';
    if (input.actionabilityDecision === 'not_available') return 'review';
    if (input.warnings.length > 0) return 'review';
    return 'trusted';
}

function classifyRisk(outputPayload: Record<string, unknown>): InferenceReliabilityPacket['risk_class'] {
    const risk = readString(asRecord(outputPayload.risk_assessment).emergency_level)
        ?? readString(asRecord(outputPayload.severity).level)
        ?? readString(outputPayload.emergency_level);
    const normalized = risk?.toLowerCase();
    if (normalized === 'critical' || normalized === 'emergency') return 'critical';
    if (normalized === 'high' || normalized === 'urgent') return 'high';
    if (normalized === 'moderate' || normalized === 'elevated') return 'elevated';
    return 'routine';
}

function deriveEvidenceState(outputPayload: Record<string, unknown>): {
    evidenceTypes: string[];
    inputCompleteness: number;
    labContradiction: boolean;
    negativeTestConflict: boolean;
    unitNormalizationConfidence: number | null;
    counterfactualFragility: boolean;
    counterfactualStabilityScore: number | null;
    fragileFeatures: string[];
    novelPattern: boolean;
} {
    const intelligence = asRecord(outputPayload.clinical_intelligence);
    const reliability = asRecord(intelligence.reliability_breakdown);
    const normalization = asRecord(outputPayload.evidence_normalization);
    const labContradictions = readStringArray(outputPayload.lab_contradictions);
    const counterfactual = asRecord(outputPayload.counterfactual_stability);
    const evidenceTypes = new Set<string>();
    if (readRecordArray(normalization.normalized_findings).length > 0) evidenceTypes.add('normalized_labs');
    if (readRecordArray(asRecord(outputPayload.diagnosis).evidence_mapping).length > 0) evidenceTypes.add('clinical_evidence_mapping');
    if (readRecordArray(outputPayload.rag_citations).length > 0) evidenceTypes.add('rag_citations');
    if (readRecordArray(outputPayload.differentials).length > 0 || readRecordArray(asRecord(outputPayload.diagnosis).top_differentials).length > 0) evidenceTypes.add('differential_distribution');

    const stabilityScore = readNumber(counterfactual.stability_score);
    const stabilityVerdict = readString(counterfactual.stability_verdict);
    return {
        evidenceTypes: Array.from(evidenceTypes).sort(),
        inputCompleteness: clamp01(readNumber(reliability.input_completeness) ?? readNumber(intelligence.input_completeness) ?? 0.5),
        labContradiction: labContradictions.length > 0 || readBoolean(outputPayload.lab_contradiction_detected),
        negativeTestConflict: readBoolean(outputPayload.negative_test_conflict),
        unitNormalizationConfidence: readNumber(normalization.unit_normalization_confidence),
        counterfactualFragility: stabilityVerdict === 'fragile' || stabilityVerdict === 'unstable' || (stabilityScore != null && stabilityScore < 0.6),
        counterfactualStabilityScore: stabilityScore,
        fragileFeatures: readStringArray(counterfactual.fragile_features),
        novelPattern: readBoolean(outputPayload.novel_species_diagnosis_pair) || readBoolean(outputPayload.novel_tenant_pattern),
    };
}

function deriveRagState(outputPayload: Record<string, unknown>): {
    citationRequired: boolean;
    citationQualityScore: number;
    sourceAuthorityScore: number;
    citationFaithfulnessScore: number;
    contradictorySource: boolean;
    sourceVersionsPresent: boolean;
} {
    const rag = asRecord(outputPayload.rag_grounding);
    const citations = readRecordArray(outputPayload.rag_citations);
    const citationRequired = readBoolean(rag.citation_required) || citations.length > 0 || readBoolean(outputPayload.rag_grounded);
    return {
        citationRequired,
        citationQualityScore: citationRequired ? clamp01(readNumber(rag.citation_quality_score) ?? readNumber(outputPayload.citation_quality_score) ?? 0) : 1,
        sourceAuthorityScore: citationRequired ? clamp01(readNumber(rag.source_authority_score) ?? 0) : 1,
        citationFaithfulnessScore: citationRequired ? clamp01(readNumber(rag.citation_faithfulness_score) ?? 0) : 1,
        contradictorySource: readBoolean(rag.contradictory_source_flag),
        sourceVersionsPresent: !citationRequired || readBoolean(rag.source_versions_present) || citations.some((entry) => readString(entry.source_version) || readString(entry.document_hash)),
    };
}

function deriveSecurityState(outputPayload: Record<string, unknown>): {
    promptInjection: boolean;
    phiLeakage: boolean;
    toolAbuse: boolean;
    ragBoundaryViolation: boolean;
    fabricatedCitation: boolean;
} {
    const security = asRecord(outputPayload.security);
    return {
        promptInjection: readBoolean(security.prompt_injection_flag) || readBoolean(outputPayload.prompt_injection_flag),
        phiLeakage: readBoolean(security.phi_leakage_flag) || readBoolean(outputPayload.phi_leakage_flag),
        toolAbuse: readBoolean(security.tool_abuse_flag) || readBoolean(outputPayload.tool_abuse_flag),
        ragBoundaryViolation: readBoolean(security.rag_boundary_violation_flag) || readBoolean(outputPayload.rag_boundary_violation_flag),
        fabricatedCitation: readBoolean(security.fabricated_citation_flag) || readBoolean(outputPayload.fabricated_citation_flag),
    };
}

function deriveAmrState(outputPayload: Record<string, unknown>): {
    antimicrobialSuggested: boolean;
    stewardshipRisk: 'none' | 'low' | 'medium' | 'high';
    cultureRecommended: boolean;
    timeoutRequired48_72h: boolean;
    regulatoryNoteRequired: boolean;
} {
    const amr = asRecord(outputPayload.amr_stewardship);
    const treatment = asRecord(outputPayload.treatment_pathways);
    const antimicrobialSuggested = readBoolean(amr.antimicrobial_suggested)
        || readStringArray(treatment.recommended_classes).some((entry) => /antimicrobial|antibiotic/i.test(entry));
    const risk = readString(amr.stewardship_risk)?.toLowerCase();
    return {
        antimicrobialSuggested,
        stewardshipRisk: risk === 'high' || risk === 'medium' || risk === 'low'
            ? risk
            : antimicrobialSuggested ? 'medium' : 'none',
        cultureRecommended: readBoolean(amr.culture_recommended) || readBoolean(outputPayload.culture_recommended),
        timeoutRequired48_72h: antimicrobialSuggested,
        regulatoryNoteRequired: antimicrobialSuggested && readBoolean(amr.regulatory_note_required),
    };
}

function normalizeReliabilityPacketRow(row: Record<string, unknown>): InferenceReliabilityPacket {
    return {
        id: readString(row.id) ?? undefined,
        tenant_id: readString(row.tenant_id) ?? '',
        inference_event_id: readString(row.inference_event_id) ?? '',
        request_id: readString(row.request_id),
        case_id: readString(row.case_id),
        packet_version: 'vetios_inference_reliability_packet_v1',
        final_state: readFinalState(row.final_state),
        top_label: readString(row.top_label),
        top_confidence: readNumber(row.top_confidence) ?? 0,
        risk_class: readRiskClass(row.risk_class),
        calibration_status: readCalibrationStatus(row.calibration_status),
        historical_sample_count: Math.max(0, Math.trunc(readNumber(row.historical_sample_count) ?? 0)),
        actionability_decision: readActionabilityDecision(row.actionability_decision),
        review_queue_event_id: readString(row.review_queue_event_id),
        training_eligible: row.training_eligible === true,
        reasons: readStringArray(row.reasons),
        blockers: readStringArray(row.blockers),
        warnings: readStringArray(row.warnings),
        packet_digest: readString(row.packet_digest) ?? '',
        packet: asRecord(row.packet),
        created_at: readString(row.created_at) ?? undefined,
    };
}

function readSpecies(outputPayload: Record<string, unknown>): string | null {
    return readString(asRecord(outputPayload.clinical_context).species)
        ?? readString(asRecord(asRecord(outputPayload.governance_lineage).input_signature).species)
        ?? readString(outputPayload.species);
}

function readFinalState(value: unknown): InferenceReliabilityState {
    return value === 'trusted' || value === 'review' || value === 'hold' || value === 'suppress' ? value : 'review';
}

function readRiskClass(value: unknown): InferenceReliabilityPacket['risk_class'] {
    return value === 'routine' || value === 'elevated' || value === 'high' || value === 'critical' ? value : 'routine';
}

function readCalibrationStatus(value: unknown): InferenceCalibrationSnapshot['calibration_status'] {
    return value === 'needs_outcome'
        || value === 'calibrated'
        || value === 'underconfident'
        || value === 'overconfident'
        || value === 'indeterminate'
        ? value
        : 'indeterminate';
}

function readActionabilityDecision(value: unknown): InferenceReliabilityPacket['actionability_decision'] {
    return value === 'actionable_with_confirmation'
        || value === 'review_before_action'
        || value === 'hold_for_evidence'
        || value === 'suppressed'
        || value === 'not_available'
        ? value
        : 'not_available';
}

function digestUnknown(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
        ? value.map(asRecord).filter((entry) => Object.keys(entry).length > 0)
        : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

function readBoolean(value: unknown): boolean {
    return value === true || value === 'true';
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(readString).filter((entry): entry is string => Boolean(entry))
        : [];
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function roundMetric(value: number): number {
    return Number(clamp01(value).toFixed(4));
}

export function createReliabilityPacketRequestId(): string {
    return randomUUID();
}
