import { randomUUID } from 'crypto';
import { getEvidenceChallenger, type ChallengerResult } from '@/lib/counterfactual/evidenceChallenger';
import type { InferenceRequest } from '@/lib/inference/types';

type CounterfactualSupabaseClient = {
    from: (table: string) => unknown;
};

export interface CounterfactualStabilityResult {
    session_id: string;
    source_inference_event_id: string;
    stability_verdict: 'stable' | 'fragile' | 'unstable' | 'indeterminate';
    stability_score: number;
    baseline_primary: string;
    baseline_confidence: number;
    findings_challenged: number;
    diagnoses_tested: number;
    top_load_bearing_finding: string | null;
    top_cpg_scores: Array<{
        finding: string;
        finding_type: string;
        diagnosis: string;
        cpg: number;
        probability_baseline: number;
        probability_counterfactual: number;
        diagnosis_dropped_out: boolean;
    }>;
    clinical_summary: string;
    latency_ms: number;
}

interface SourceInferenceEvent {
    id: string;
    tenant_id: string;
    case_id: string | null;
    input_signature: Record<string, unknown>;
}

export async function runCounterfactualStabilityForInference(input: {
    client: CounterfactualSupabaseClient;
    tenantId: string;
    inferenceEventId: string;
}): Promise<{ data: CounterfactualStabilityResult | null; error: string | null }> {
    const source = await loadSourceInferenceEvent(input.client, input.tenantId, input.inferenceEventId);
    if (!source) return { data: null, error: 'source_inference_not_found' };

    const request = buildInferenceRequestFromInputSignature(source.input_signature);
    if ((request.presenting_signs ?? []).length === 0 && Object.keys(request.diagnostic_tests ?? {}).length === 0) {
        return { data: null, error: 'insufficient_challenge_findings' };
    }

    const challenger = getEvidenceChallenger();
    const result = await challenger.challenge({
        tenantId: input.tenantId,
        caseId: source.case_id ?? `inference:${source.id}`,
        inferenceEventId: source.id,
        multiAgentSessionId: `cf_${randomUUID()}`,
        request,
        maxDiagnosesToChallenge: 3,
        minFindingsToChallenge: 1,
    });

    return {
        data: summarizeChallengerResult(source.id, result),
        error: null,
    };
}

export function buildInferenceRequestFromInputSignature(input: Record<string, unknown>): InferenceRequest {
    const metadata = asRecord(input.metadata);
    const presentingSigns = readStringArray(input.presenting_signs)
        .concat(readStringArray(input.symptoms))
        .filter((entry, index, entries) => entries.indexOf(entry) === index);

    return {
        species: readString(input.species) ?? 'canine',
        breed: readString(input.breed) ?? readString(metadata.breed) ?? undefined,
        age_years: readNumber(input.age_years) ?? readNumber(metadata.age_years) ?? undefined,
        weight_kg: readNumber(input.weight_kg) ?? readNumber(metadata.weight_kg) ?? undefined,
        presenting_signs: presentingSigns,
        symptom_vector: presentingSigns,
        diagnostic_tests: asOptionalRecord(input.diagnostic_tests),
        physical_exam: asOptionalRecord(input.physical_exam),
        preventive_history: asOptionalRecord(input.preventive_history),
        history: asOptionalRecord(input.history),
    } as InferenceRequest;
}

export function summarizeChallengerResult(
    sourceInferenceEventId: string,
    result: ChallengerResult,
): CounterfactualStabilityResult {
    return {
        session_id: result.sessionId,
        source_inference_event_id: sourceInferenceEventId,
        stability_verdict: result.stabilityVerdict,
        stability_score: roundMetric(result.stabilityScore),
        baseline_primary: result.baselinePrimary,
        baseline_confidence: roundMetric(result.baselineConfidence),
        findings_challenged: result.findingschallenged,
        diagnoses_tested: result.diagnosesTested,
        top_load_bearing_finding: result.topLoadBearingFinding,
        top_cpg_scores: result.cpgScores
            .slice()
            .sort((left, right) => Math.abs(right.cpg) - Math.abs(left.cpg))
            .slice(0, 5)
            .map((score) => ({
                finding: score.finding,
                finding_type: score.findingType,
                diagnosis: score.diagnosis,
                cpg: roundMetric(score.cpg),
                probability_baseline: roundMetric(score.probabilityBaseline),
                probability_counterfactual: roundMetric(score.probabilityCounterfactual),
                diagnosis_dropped_out: score.diagnosisDroppedOut,
            })),
        clinical_summary: result.clinicalSummary,
        latency_ms: result.latencyMs,
    };
}

async function loadSourceInferenceEvent(
    client: CounterfactualSupabaseClient,
    tenantId: string,
    inferenceEventId: string,
): Promise<SourceInferenceEvent | null> {
    const query = client.from('ai_inference_events') as {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                eq: (column: string, value: string) => {
                    maybeSingle: () => PromiseLike<{ data: unknown | null; error: { message?: string } | null }>;
                };
            };
        };
    };

    const { data, error } = await query
        .select('id, tenant_id, case_id, input_signature')
        .eq('tenant_id', tenantId)
        .eq('id', inferenceEventId)
        .maybeSingle();

    if (error || !data) return null;
    const record = asRecord(data);
    return {
        id: readString(record.id) ?? inferenceEventId,
        tenant_id: readString(record.tenant_id) ?? tenantId,
        case_id: readString(record.case_id),
        input_signature: asRecord(record.input_signature),
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
    const record = asRecord(value);
    return Object.keys(record).length > 0 ? record : undefined;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(readString)
        .filter((entry): entry is string => Boolean(entry));
}

function roundMetric(value: number): number {
    return Number(value.toFixed(4));
}
