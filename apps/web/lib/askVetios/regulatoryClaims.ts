import type { AskVetiosIntakeSummary } from '@/lib/askVetios/intake';

export type AskVetiosRegulatoryClaimsStatus =
    | 'non_clinical'
    | 'cds_reviewable'
    | 'claims_review_required'
    | 'restricted_claims';

export interface AskVetiosRegulatoryClaimsSnapshot {
    schema_version: 'ask-vetios-regulatory-claims-v1';
    status: AskVetiosRegulatoryClaimsStatus;
    regulatory_boundary: 'clinical_decision_support';
    intended_user: 'licensed_veterinary_professional';
    claims_policy: {
        diagnosis_or_treatment_claim_present: boolean;
        treatment_or_prescribing_claim_present: boolean;
        professional_review_required: boolean;
        independent_review_basis_available: boolean;
        device_claim_risk: 'low' | 'medium' | 'high';
        allowed_user_posture: 'informational' | 'cds_draft' | 'restricted_draft';
    };
    reviewability: {
        citations_present: boolean;
        rationale_present: boolean;
        differential_basis_present: boolean;
        diagnostic_alternatives_present: boolean;
        outcome_confirmation_required: boolean;
    };
    fda_cds_alignment: {
        animal_diagnosis_or_treatment_context: boolean;
        professional_can_independently_review_basis: boolean;
        output_is_not_autonomous_order: true;
        output_is_not_final_diagnosis: true;
    };
    blocked_claims: string[];
    warnings: string[];
    next_actions: string[];
}

interface BuildAskVetiosRegulatoryClaimsSnapshotInput {
    mode: string;
    content: string;
    metadata: Record<string, unknown>;
    intake: AskVetiosIntakeSummary;
}

export function buildAskVetiosRegulatoryClaimsSnapshot(
    input: BuildAskVetiosRegulatoryClaimsSnapshotInput,
): AskVetiosRegulatoryClaimsSnapshot {
    const clinical = input.mode === 'clinical' || input.intake.is_clinical_intake;
    const text = [
        input.content,
        readString(input.metadata.explanation),
        input.intake.case_draft.raw_note,
        readStringArray(input.metadata.recommended_tests).join(' '),
        readDifferentials(input.metadata.diagnosis_ranked).map((item) => item.name).join(' '),
    ].filter(Boolean).join(' ');
    const citations = readArray(input.metadata.rag_citations);
    const sourceReferences = readArray(input.metadata.source_references);
    const differentials = readDifferentials(input.metadata.diagnosis_ranked);
    const recommendedTests = readStringArray(input.metadata.recommended_tests);
    const diagnosisOrTreatmentClaim = clinical && (
        differentials.length > 0
        || DIAGNOSIS_CLAIM_PATTERNS.some((pattern) => pattern.test(text))
        || TREATMENT_CLAIM_PATTERNS.some((pattern) => pattern.test(text))
    );
    const treatmentOrPrescribingClaim = clinical && (
        input.intake.case_draft.treatments.length > 0
        || TREATMENT_CLAIM_PATTERNS.some((pattern) => pattern.test(text))
    );
    const citationsPresent = citations.length > 0 || sourceReferences.length > 0;
    const rationalePresent = Boolean(readString(input.metadata.explanation))
        || differentials.some((item) => Boolean(item.reasoning));
    const differentialBasisPresent = differentials.length > 0;
    const diagnosticAlternativesPresent = recommendedTests.length > 0 || differentials.length > 1;
    const independentlyReviewable = citationsPresent
        && (rationalePresent || differentialBasisPresent)
        && diagnosticAlternativesPresent;
    const status = determineStatus({
        clinical,
        diagnosisOrTreatmentClaim,
        treatmentOrPrescribingClaim,
        independentlyReviewable,
    });
    const deviceClaimRisk = determineDeviceClaimRisk({
        clinical,
        diagnosisOrTreatmentClaim,
        treatmentOrPrescribingClaim,
        independentlyReviewable,
    });

    return {
        schema_version: 'ask-vetios-regulatory-claims-v1',
        status,
        regulatory_boundary: 'clinical_decision_support',
        intended_user: 'licensed_veterinary_professional',
        claims_policy: {
            diagnosis_or_treatment_claim_present: diagnosisOrTreatmentClaim,
            treatment_or_prescribing_claim_present: treatmentOrPrescribingClaim,
            professional_review_required: clinical,
            independent_review_basis_available: independentlyReviewable,
            device_claim_risk: deviceClaimRisk,
            allowed_user_posture: allowedPosture(status),
        },
        reviewability: {
            citations_present: citationsPresent,
            rationale_present: rationalePresent,
            differential_basis_present: differentialBasisPresent,
            diagnostic_alternatives_present: diagnosticAlternativesPresent,
            outcome_confirmation_required: diagnosisOrTreatmentClaim,
        },
        fda_cds_alignment: {
            animal_diagnosis_or_treatment_context: diagnosisOrTreatmentClaim,
            professional_can_independently_review_basis: independentlyReviewable,
            output_is_not_autonomous_order: true,
            output_is_not_final_diagnosis: true,
        },
        blocked_claims: buildBlockedClaims({
            diagnosisOrTreatmentClaim,
            treatmentOrPrescribingClaim,
            independentlyReviewable,
        }),
        warnings: buildWarnings({
            clinical,
            diagnosisOrTreatmentClaim,
            treatmentOrPrescribingClaim,
            independentlyReviewable,
        }),
        next_actions: buildNextActions({
            clinical,
            status,
            citationsPresent,
            rationalePresent,
            diagnosticAlternativesPresent,
        }),
    };
}

function determineStatus(input: {
    clinical: boolean;
    diagnosisOrTreatmentClaim: boolean;
    treatmentOrPrescribingClaim: boolean;
    independentlyReviewable: boolean;
}): AskVetiosRegulatoryClaimsStatus {
    if (!input.clinical) return 'non_clinical';
    if (input.treatmentOrPrescribingClaim && !input.independentlyReviewable) return 'restricted_claims';
    if (input.diagnosisOrTreatmentClaim && !input.independentlyReviewable) return 'claims_review_required';
    return 'cds_reviewable';
}

function determineDeviceClaimRisk(input: {
    clinical: boolean;
    diagnosisOrTreatmentClaim: boolean;
    treatmentOrPrescribingClaim: boolean;
    independentlyReviewable: boolean;
}): 'low' | 'medium' | 'high' {
    if (!input.clinical || !input.diagnosisOrTreatmentClaim) return 'low';
    if (input.treatmentOrPrescribingClaim && !input.independentlyReviewable) return 'high';
    if (!input.independentlyReviewable) return 'medium';
    return 'low';
}

function allowedPosture(status: AskVetiosRegulatoryClaimsStatus): 'informational' | 'cds_draft' | 'restricted_draft' {
    if (status === 'non_clinical') return 'informational';
    if (status === 'cds_reviewable') return 'cds_draft';
    return 'restricted_draft';
}

function buildBlockedClaims(input: {
    diagnosisOrTreatmentClaim: boolean;
    treatmentOrPrescribingClaim: boolean;
    independentlyReviewable: boolean;
}): string[] {
    const claims: string[] = [];
    if (input.diagnosisOrTreatmentClaim) claims.push('final_diagnosis_without_clinician_confirmation');
    if (input.treatmentOrPrescribingClaim) claims.push('autonomous_treatment_or_prescription_instruction');
    if (!input.independentlyReviewable) claims.push('unreviewable_basis_for_clinical_claim');
    return unique(claims);
}

function buildWarnings(input: {
    clinical: boolean;
    diagnosisOrTreatmentClaim: boolean;
    treatmentOrPrescribingClaim: boolean;
    independentlyReviewable: boolean;
}): string[] {
    const warnings: string[] = [];
    if (!input.clinical) return warnings;
    warnings.push('Ask VetIOS output is clinical decision support draft material for licensed veterinary review.');
    if (input.diagnosisOrTreatmentClaim) warnings.push('Do not present differential support as a final diagnosis without clinician confirmation.');
    if (input.treatmentOrPrescribingClaim) warnings.push('Do not present antimicrobial, drug, or treatment content as an autonomous prescription.');
    if (!input.independentlyReviewable) warnings.push('Attach citations, rationale, and diagnostic alternatives before relying on clinical claims.');
    return warnings;
}

function buildNextActions(input: {
    clinical: boolean;
    status: AskVetiosRegulatoryClaimsStatus;
    citationsPresent: boolean;
    rationalePresent: boolean;
    diagnosticAlternativesPresent: boolean;
}): string[] {
    if (!input.clinical) return ['keep_as_general_information'];
    const actions = ['clinician_review_required', 'preserve_basis_for_independent_review'];
    if (!input.citationsPresent) actions.push('attach_citations');
    if (!input.rationalePresent) actions.push('add_reasoning_basis');
    if (!input.diagnosticAlternativesPresent) actions.push('show_diagnostic_alternatives');
    if (input.status === 'restricted_claims') actions.push('remove_autonomous_treatment_language');
    if (input.status === 'claims_review_required') actions.push('claims_review_before_public_use');
    return unique(actions);
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
}

function readDifferentials(value: unknown): Array<{ name: string; reasoning: string | null }> {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 10).map((entry) => {
        const record = asRecord(entry);
        return {
            name: readString(record.name) ?? readString(record.disease) ?? 'unknown',
            reasoning: readString(record.reasoning),
        };
    });
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
}

const DIAGNOSIS_CLAIM_PATTERNS = [
    /\bdiagnos(?:is|e|tic)\b/i,
    /\bdifferentials?\b/i,
    /\bmost likely\b/i,
    /\bconsistent with\b/i,
    /\brule out\b/i,
];

const TREATMENT_CLAIM_PATTERNS = [
    /\btreat(?:ment|ed|ing)?\b/i,
    /\bprescrib(?:e|ed|ing)\b/i,
    /\bdos(?:e|ing|age)\b/i,
    /\bantibiotic\b/i,
    /\bantimicrobial\b/i,
    /\bamoxicillin\b/i,
    /\bdoxycycline\b/i,
    /\bcef(?:a|t|p)\w+\b/i,
    /\bsurgery\b/i,
];
