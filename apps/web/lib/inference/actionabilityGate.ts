import type { InferenceCalibrationSnapshot } from './calibrationSnapshot';
import { buildInferenceCalibrationSnapshot, extractDifferentialDistribution } from './calibrationSnapshot';

type ActionabilitySupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;

export type ActionabilityDecision =
    | 'actionable_with_confirmation'
    | 'review_before_action'
    | 'hold_for_evidence'
    | 'suppressed';

export interface InferenceActionabilityGateInput {
    tenantId: string;
    inferenceEventId: string;
    requestId?: string | null;
    caseId?: string | null;
    outputPayload: Record<string, unknown>;
    confidenceScore?: number | null;
    phiHat?: number | null;
    calibrationSnapshot?: InferenceCalibrationSnapshot | null;
}

export interface InferenceActionabilityGateResult {
    id?: string;
    inference_event_id: string;
    calibration_snapshot_id: string | null;
    decision: ActionabilityDecision;
    actionability_score: number;
    recommended_next_step: string;
    top_label: string | null;
    top_confidence: number;
    phi_hat: number;
    reliability_badge: 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';
    calibration_status: InferenceCalibrationSnapshot['calibration_status'];
    historical_sample_count: number;
    contradiction_score: number;
    margin_top2: number;
    differential_entropy: number;
    abstain_recommendation: boolean;
    urgent_confirmatory_testing: boolean;
    required_confirmatory_tests: string[];
    blockers: string[];
    warnings: string[];
    policy_snapshot: Record<string, unknown>;
    created_at?: string;
}

export async function recordInferenceActionabilityGateEvent(
    client: ActionabilitySupabaseClient,
    input: InferenceActionabilityGateInput,
): Promise<{ data: InferenceActionabilityGateResult | null; error: string | null }> {
    const computed = await buildInferenceActionabilityGate(client, input);
    const row = {
        tenant_id: input.tenantId,
        inference_event_id: input.inferenceEventId,
        calibration_snapshot_id: computed.calibration_snapshot_id,
        request_id: input.requestId ?? null,
        case_id: input.caseId ?? null,
        gate_version: 'vetios_actionability_gate_v1',
        decision: computed.decision,
        actionability_score: computed.actionability_score,
        recommended_next_step: computed.recommended_next_step,
        top_label: computed.top_label,
        top_confidence: computed.top_confidence,
        phi_hat: computed.phi_hat,
        reliability_badge: computed.reliability_badge,
        calibration_status: computed.calibration_status,
        historical_sample_count: computed.historical_sample_count,
        contradiction_score: computed.contradiction_score,
        margin_top2: computed.margin_top2,
        differential_entropy: computed.differential_entropy,
        abstain_recommendation: computed.abstain_recommendation,
        urgent_confirmatory_testing: computed.urgent_confirmatory_testing,
        required_confirmatory_tests: computed.required_confirmatory_tests,
        blockers: computed.blockers,
        warnings: computed.warnings,
        policy_snapshot: computed.policy_snapshot,
    };

    const table = client.from('inference_actionability_gate_events') as {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => QueryResult<Record<string, unknown>>;
            };
        };
    };

    const { data, error } = await table
        .insert(row)
        .select('id, inference_event_id, calibration_snapshot_id, decision, actionability_score, recommended_next_step, top_label, top_confidence, phi_hat, reliability_badge, calibration_status, historical_sample_count, contradiction_score, margin_top2, differential_entropy, abstain_recommendation, urgent_confirmatory_testing, required_confirmatory_tests, blockers, warnings, policy_snapshot, created_at')
        .single();

    if (error) {
        console.warn(JSON.stringify({
            event: 'inference_actionability_gate_insert_failed',
            inference_event_id: input.inferenceEventId,
            error: error.message ?? 'unknown',
        }));
        return { data: null, error: error.message ?? 'actionability_gate_insert_failed' };
    }

    if (!data) return { data: null, error: 'actionability_gate_insert_returned_no_row' };
    return { data: normalizeActionabilityRow(data), error: null };
}

export async function loadLatestInferenceActionabilityGateEvent(
    client: ActionabilitySupabaseClient,
    tenantId: string,
    inferenceEventId: string,
): Promise<{ data: InferenceActionabilityGateResult | null; error: string | null }> {
    const table = client.from('inference_actionability_gate_events') as {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                eq: (column: string, value: string) => {
                    order: (column: string, options: { ascending: boolean }) => {
                        limit: (count: number) => {
                            maybeSingle: () => QueryResult<Record<string, unknown>>;
                        };
                    };
                };
            };
        };
    };

    const { data, error } = await table
        .select('id, inference_event_id, calibration_snapshot_id, decision, actionability_score, recommended_next_step, top_label, top_confidence, phi_hat, reliability_badge, calibration_status, historical_sample_count, contradiction_score, margin_top2, differential_entropy, abstain_recommendation, urgent_confirmatory_testing, required_confirmatory_tests, blockers, warnings, policy_snapshot, created_at')
        .eq('tenant_id', tenantId)
        .eq('inference_event_id', inferenceEventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) return { data: null, error: error.message ?? 'actionability_gate_lookup_failed' };
    return { data: data ? normalizeActionabilityRow(data) : null, error: null };
}

export async function buildInferenceActionabilityGate(
    client: ActionabilitySupabaseClient,
    input: InferenceActionabilityGateInput,
): Promise<Omit<InferenceActionabilityGateResult, 'id' | 'created_at'>> {
    const calibration = input.calibrationSnapshot
        ?? await buildInferenceCalibrationSnapshot(client, {
            tenantId: input.tenantId,
            inferenceEventId: input.inferenceEventId,
            outputPayload: input.outputPayload,
            confidenceScore: input.confidenceScore,
            phiHat: input.phiHat,
        });
    const distribution = extractDifferentialDistribution(input.outputPayload);
    const top = distribution[0] ?? null;
    const topLabel = calibration.top_label ?? top?.label ?? null;
    const topConfidence = clamp01(calibration.top_confidence ?? input.confidenceScore ?? top?.probability ?? 0);
    const phiHat = clamp01(calibration.phi_hat ?? input.phiHat ?? 0);
    const contradictionScore = clamp01(calibration.contradiction_score);
    const marginTop2 = clamp01(calibration.margin_top2);
    const entropy = clamp01(calibration.differential_entropy);
    const reliabilityBadge = calibration.reliability_badge;
    const calibrationStatus = calibration.calibration_status;
    const abstain = readBoolean(input.outputPayload.abstain_recommendation)
        || readBoolean(asRecord(input.outputPayload.contradiction_analysis).abstain);
    const urgentConfirmatory = readBoolean(input.outputPayload.urgent_confirmatory_testing);
    const requiredTests = collectConfirmatoryTests(input.outputPayload);

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (reliabilityBadge === 'SUPPRESSED' || phiHat < 0.25) blockers.push('CIRE reliability suppressed or phi_hat below action threshold.');
    if (contradictionScore >= 0.75) blockers.push('High contradiction pressure requires clinician review.');
    if (abstain) blockers.push('Inference engine recommended abstention.');
    if (topConfidence < 0.35) blockers.push('Top confidence is below minimum actionability threshold.');
    if (marginTop2 < 0.08) blockers.push('Top differential is not sufficiently separated from alternatives.');

    if (calibrationStatus === 'needs_outcome') warnings.push('Label-specific calibration still needs confirmed outcomes.');
    if (calibrationStatus === 'overconfident') warnings.push('Historical outcomes suggest this label may be over-confident.');
    if (urgentConfirmatory) warnings.push('Engine requested urgent confirmatory testing.');
    if (entropy > 0.68) warnings.push('Differential distribution is broad; action should stay provisional.');
    if (requiredTests.length > 0) warnings.push('Confirmatory tests are available and should anchor the decision.');

    const score = computeActionabilityScore({
        topConfidence,
        phiHat,
        contradictionScore,
        marginTop2,
        entropy,
        calibrationReliability: calibration.calibration_reliability_score,
        abstain,
    });
    const decision = classifyDecision({
        score,
        blockers,
        warnings,
        reliabilityBadge,
        calibrationStatus,
        urgentConfirmatory,
    });

    return {
        inference_event_id: input.inferenceEventId,
        calibration_snapshot_id: readString((calibration as { id?: string | null }).id),
        decision,
        actionability_score: roundMetric(score),
        recommended_next_step: recommendedNextStep(decision, requiredTests),
        top_label: topLabel,
        top_confidence: roundMetric(topConfidence),
        phi_hat: roundMetric(phiHat),
        reliability_badge: reliabilityBadge,
        calibration_status: calibrationStatus,
        historical_sample_count: Math.max(0, Math.trunc(calibration.historical_sample_count)),
        contradiction_score: roundMetric(contradictionScore),
        margin_top2: roundMetric(marginTop2),
        differential_entropy: roundMetric(entropy),
        abstain_recommendation: abstain,
        urgent_confirmatory_testing: urgentConfirmatory,
        required_confirmatory_tests: requiredTests,
        blockers,
        warnings,
        policy_snapshot: {
            gate_version: 'vetios_actionability_gate_v1',
            thresholds: {
                min_phi_hat: 0.25,
                contradiction_hold: 0.75,
                min_top_confidence: 0.35,
                min_top2_margin: 0.08,
                broad_distribution_entropy: 0.68,
                actionable_score: 0.72,
            },
            inputs_used: [
                'top_confidence',
                'phi_hat',
                'contradiction_score',
                'top2_margin',
                'differential_entropy',
                'calibration_status',
                'abstain_recommendation',
                'urgent_confirmatory_testing',
            ],
            privacy_boundary: 'no raw clinical narrative, owner identifiers, patient names, contacts, or microchip IDs stored',
        },
    };
}

function classifyDecision(input: {
    score: number;
    blockers: string[];
    warnings: string[];
    reliabilityBadge: InferenceActionabilityGateResult['reliability_badge'];
    calibrationStatus: InferenceActionabilityGateResult['calibration_status'];
    urgentConfirmatory: boolean;
}): ActionabilityDecision {
    if (input.reliabilityBadge === 'SUPPRESSED') return 'suppressed';
    if (input.blockers.length > 0) return 'hold_for_evidence';
    if (
        input.score >= 0.72
        && input.warnings.length <= 1
        && input.calibrationStatus !== 'overconfident'
        && !input.urgentConfirmatory
    ) {
        return 'actionable_with_confirmation';
    }
    return 'review_before_action';
}

function computeActionabilityScore(input: {
    topConfidence: number;
    phiHat: number;
    contradictionScore: number;
    marginTop2: number;
    entropy: number;
    calibrationReliability: number;
    abstain: boolean;
}): number {
    const base = (input.topConfidence * 0.28)
        + (input.phiHat * 0.24)
        + ((1 - input.contradictionScore) * 0.2)
        + (input.marginTop2 * 0.14)
        + ((1 - input.entropy) * 0.08)
        + (clamp01(input.calibrationReliability) * 0.06);
    return clamp01(base - (input.abstain ? 0.18 : 0));
}

function recommendedNextStep(
    decision: ActionabilityDecision,
    tests: string[],
): string {
    const firstTest = tests[0];
    if (decision === 'suppressed') return 'Do not act on this output automatically; escalate to clinician review.';
    if (decision === 'hold_for_evidence') return firstTest
        ? `Hold definitive action until ${firstTest} or equivalent confirmatory evidence is reviewed.`
        : 'Hold definitive action until additional clinical evidence is collected.';
    if (decision === 'review_before_action') return firstTest
        ? `Clinician review required before action; prioritize ${firstTest}.`
        : 'Clinician review required before action; document rationale and outcome.';
    return firstTest
        ? `Action may proceed as clinical decision support while confirming with ${firstTest}.`
        : 'Action may proceed as clinical decision support with routine outcome confirmation.';
}

function collectConfirmatoryTests(outputPayload: Record<string, unknown>): string[] {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const groundTruth = asRecord(outputPayload.ground_truth_summary);
    const topDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    const clinicalIntelligence = asRecord(outputPayload.clinical_intelligence);
    return [
        ...readStringishArray(outputPayload.recommended_tests),
        ...readStringishArray(groundTruth.missing_confirmatory_tests),
        ...topDifferentials.flatMap((entry) => readStringishArray(asRecord(entry).recommended_confirmatory_tests)),
        ...readStringishArray(clinicalIntelligence.recommended_tests),
    ]
        .map((entry) => entry.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.toLowerCase() === entry.toLowerCase()) === index)
        .slice(0, 8);
}

function readStringishArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
        if (typeof entry === 'string') return entry;
        const record = asRecord(entry);
        return readString(record.test)
            ?? readString(record.name)
            ?? readString(record.label)
            ?? readString(record.prompt)
            ?? readString(record.title);
    }).filter((entry): entry is string => Boolean(entry));
}

function normalizeActionabilityRow(row: Record<string, unknown>): InferenceActionabilityGateResult {
    return {
        id: readString(row.id) ?? undefined,
        inference_event_id: readString(row.inference_event_id) ?? '',
        calibration_snapshot_id: readString(row.calibration_snapshot_id),
        decision: readDecision(row.decision),
        actionability_score: readNumber(row.actionability_score) ?? 0,
        recommended_next_step: readString(row.recommended_next_step) ?? 'Clinician review required before action.',
        top_label: readString(row.top_label),
        top_confidence: readNumber(row.top_confidence) ?? 0,
        phi_hat: readNumber(row.phi_hat) ?? 0,
        reliability_badge: readReliabilityBadge(row.reliability_badge),
        calibration_status: readCalibrationStatus(row.calibration_status),
        historical_sample_count: Math.max(0, Math.trunc(readNumber(row.historical_sample_count) ?? 0)),
        contradiction_score: readNumber(row.contradiction_score) ?? 0,
        margin_top2: readNumber(row.margin_top2) ?? 0,
        differential_entropy: readNumber(row.differential_entropy) ?? 0,
        abstain_recommendation: row.abstain_recommendation === true,
        urgent_confirmatory_testing: row.urgent_confirmatory_testing === true,
        required_confirmatory_tests: readStringArray(row.required_confirmatory_tests),
        blockers: readStringArray(row.blockers),
        warnings: readStringArray(row.warnings),
        policy_snapshot: asRecord(row.policy_snapshot),
        created_at: readString(row.created_at) ?? undefined,
    };
}

function readDecision(value: unknown): ActionabilityDecision {
    return value === 'actionable_with_confirmation'
        || value === 'review_before_action'
        || value === 'hold_for_evidence'
        || value === 'suppressed'
        ? value
        : 'review_before_action';
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

function readReliabilityBadge(value: unknown): InferenceActionabilityGateResult['reliability_badge'] {
    return value === 'HIGH' || value === 'REVIEW' || value === 'CAUTION' || value === 'SUPPRESSED'
        ? value
        : 'REVIEW';
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
