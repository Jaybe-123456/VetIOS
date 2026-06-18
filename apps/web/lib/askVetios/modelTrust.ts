import type { AskVetiosIntakeSummary } from '@/lib/askVetios/intake';
import type { AskVetiosCaseGraphSnapshot } from '@/lib/askVetios/caseGraph';

export type AskVetiosModelTrustStatus =
    | 'non_clinical'
    | 'needs_evidence'
    | 'needs_review'
    | 'grounded_draft';

export interface AskVetiosModelTrustSnapshot {
    schema_version: 'ask-vetios-model-trust-v1';
    status: AskVetiosModelTrustStatus;
    response_mode: string;
    governance_boundary: 'clinical_decision_support';
    calibration_status: 'needs_outcome';
    clinician_review_required: boolean;
    abstention_recommended: boolean;
    grounding: {
        rag_grounded: boolean;
        citation_count: number;
        source_reference_count: number;
        citation_quality: 'none' | 'partial' | 'grounded';
    };
    safety: {
        red_flag_count: number;
        emergency_flagged: boolean;
        missing_field_count: number;
        follow_up_question_count: number;
    };
    output_quality: {
        differential_count: number;
        top_confidence: number | null;
        confidence_band: 'none' | 'low' | 'moderate' | 'high';
        hallucination_risk: 'low' | 'medium' | 'high';
    };
    case_graph: {
        draft_key: string | null;
        status: string | null;
        ready_for_promotion: boolean;
    };
    warnings: string[];
}

interface BuildAskVetiosModelTrustSnapshotInput {
    mode: string;
    metadata: Record<string, unknown>;
    intake: AskVetiosIntakeSummary;
    caseGraphSnapshot?: AskVetiosCaseGraphSnapshot | null;
}

export function buildAskVetiosModelTrustSnapshot(
    input: BuildAskVetiosModelTrustSnapshotInput,
): AskVetiosModelTrustSnapshot {
    const metadata = input.metadata;
    const citations = readArray(metadata.rag_citations);
    const sourceReferences = readArray(metadata.source_references);
    const redFlags = mergeStrings(
        readStringArray(metadata.red_flags),
        input.intake.case_draft.red_flags,
    );
    const missingFields = mergeStrings(
        readStringArray(metadata.missing_fields),
        input.intake.missing_fields,
    );
    const followUpQuestions = mergeStrings(
        readStringArray(metadata.follow_up_questions),
        input.intake.follow_up_questions,
    );
    const differentials = readDifferentials(metadata.diagnosis_ranked);
    const topConfidence = differentials[0]?.confidence ?? null;
    const ragGrounded = metadata.rag_grounded === true;
    const citationCount = citations.length;
    const sourceReferenceCount = sourceReferences.length;
    const citationQuality = ragGrounded && citationCount > 0
        ? 'grounded'
        : citationCount > 0 || sourceReferenceCount > 0 ? 'partial' : 'none';
    const clinical = input.mode === 'clinical' || input.intake.is_clinical_intake;
    const needsEvidence = clinical && citationQuality === 'none';
    const emergencyFlagged = redFlags.length > 0 || metadata.urgency_level === 'emergency';
    const abstentionRecommended = clinical && input.intake.status === 'needs_minimum';
    const clinicianReviewRequired = emergencyFlagged || abstentionRecommended || needsEvidence;
    const status: AskVetiosModelTrustStatus = !clinical
        ? 'non_clinical'
        : clinicianReviewRequired ? (needsEvidence ? 'needs_evidence' : 'needs_review') : 'grounded_draft';
    const warnings = buildWarnings({
        needsEvidence,
        emergencyFlagged,
        abstentionRecommended,
        topConfidence,
        missingFieldCount: missingFields.length,
        citationQuality,
    });

    return {
        schema_version: 'ask-vetios-model-trust-v1',
        status,
        response_mode: input.mode,
        governance_boundary: 'clinical_decision_support',
        calibration_status: 'needs_outcome',
        clinician_review_required: clinicianReviewRequired,
        abstention_recommended: abstentionRecommended,
        grounding: {
            rag_grounded: ragGrounded,
            citation_count: citationCount,
            source_reference_count: sourceReferenceCount,
            citation_quality: citationQuality,
        },
        safety: {
            red_flag_count: redFlags.length,
            emergency_flagged: emergencyFlagged,
            missing_field_count: missingFields.length,
            follow_up_question_count: followUpQuestions.length,
        },
        output_quality: {
            differential_count: differentials.length,
            top_confidence: topConfidence,
            confidence_band: confidenceBand(topConfidence),
            hallucination_risk: hallucinationRisk({ clinical, citationQuality, missingFieldCount: missingFields.length }),
        },
        case_graph: {
            draft_key: input.caseGraphSnapshot?.draft_key ?? null,
            status: input.caseGraphSnapshot?.status ?? null,
            ready_for_promotion: input.caseGraphSnapshot?.promotion.clinical_cases_ready === true,
        },
        warnings,
    };
}

function buildWarnings(input: {
    needsEvidence: boolean;
    emergencyFlagged: boolean;
    abstentionRecommended: boolean;
    topConfidence: number | null;
    missingFieldCount: number;
    citationQuality: 'none' | 'partial' | 'grounded';
}): string[] {
    const warnings: string[] = [];
    if (input.needsEvidence) warnings.push('Clinical answer lacks retrieval citations; keep as draft until evidence is attached.');
    if (input.emergencyFlagged) warnings.push('Emergency red flags require clinician review.');
    if (input.abstentionRecommended) warnings.push('Minimum case facts are incomplete; ask follow-up questions before relying on ranking.');
    if (input.topConfidence !== null && input.topConfidence >= 0.85) warnings.push('High confidence still needs outcome confirmation before calibration claims.');
    if (input.missingFieldCount > 0) warnings.push('Missing fields reduce case graph and calibration quality.');
    if (input.citationQuality === 'partial') warnings.push('Some references are present, but answer is not fully grounded by retrieved citations.');
    return warnings;
}

function hallucinationRisk(input: {
    clinical: boolean;
    citationQuality: 'none' | 'partial' | 'grounded';
    missingFieldCount: number;
}): 'low' | 'medium' | 'high' {
    if (!input.clinical) return 'low';
    if (input.citationQuality === 'none' && input.missingFieldCount >= 3) return 'high';
    if (input.citationQuality === 'none' || input.missingFieldCount >= 3) return 'medium';
    return 'low';
}

function confidenceBand(value: number | null): 'none' | 'low' | 'moderate' | 'high' {
    if (value === null) return 'none';
    if (value >= 0.75) return 'high';
    if (value >= 0.45) return 'moderate';
    return 'low';
}

function readDifferentials(value: unknown): Array<{ name: string; confidence: number | null }> {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 10).map((entry) => {
        const record = asRecord(entry);
        return {
            name: readString(record.name) ?? readString(record.disease) ?? 'Unknown',
            confidence: readNumber(record.confidence) ?? readNumber(record.probability),
        };
    });
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            .map((entry) => entry.trim())
        : [];
}

function mergeStrings(...groups: string[][]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    groups.flat().forEach((item) => {
        const normalized = item.trim();
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) return;
        seen.add(key);
        merged.push(normalized);
    });
    return merged;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
