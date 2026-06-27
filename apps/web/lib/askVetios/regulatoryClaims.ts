import { createHash } from 'crypto';
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

export type AskVetiosRegulatoryReviewQueue =
    | 'none'
    | 'clinical_cds_review'
    | 'clinical_claims_review'
    | 'legal_clinical_claims_review'
    | 'external_attestation';

export interface AskVetiosRegulatoryClaimReviewPacket {
    schema_version: 'ask-vetios-regulatory-claim-review-v1';
    review_queue: AskVetiosRegulatoryReviewQueue;
    claim_review_status: 'not_required' | 'ready_for_review' | 'pending' | 'blocked' | 'approved' | 'rejected';
    approval_status:
        | 'not_reviewed'
        | 'clinical_review_required'
        | 'legal_review_required'
        | 'external_attestation_required'
        | 'approved'
        | 'rejected';
    cds_evidence_pack_status: 'not_required' | 'incomplete' | 'complete';
    model_card_status: 'not_required' | 'draft_required' | 'drafted' | 'approved';
    ifu_status: 'not_required' | 'draft_required' | 'drafted' | 'approved';
    clinical_signoff_status: 'not_required' | 'pending' | 'approved' | 'rejected';
    legal_signoff_status: 'not_required' | 'pending' | 'approved' | 'rejected';
    regulatory_claims_status: AskVetiosRegulatoryClaimsStatus;
    regulatory_risk_level: 'low' | 'medium' | 'high';
    evidence_pack_hash: string;
    model_card_hash: string | null;
    ifu_hash: string | null;
    approval_packet_hash: string;
    blockers: string[];
    warnings: string[];
    next_actions: string[];
    evidence: {
        raw_output_stored: false;
        raw_prompt_stored: false;
        legal_advice_stored: false;
        evidence_pack_hash: string;
    };
}

export interface AskVetiosRegulatoryClaimReviewEventDraft {
    tenant_id: string | null;
    request_id: string;
    ask_vetios_query_id: string | null;
    review_queue: AskVetiosRegulatoryReviewQueue;
    claim_review_status: AskVetiosRegulatoryClaimReviewPacket['claim_review_status'];
    approval_status: AskVetiosRegulatoryClaimReviewPacket['approval_status'];
    cds_evidence_pack_status: AskVetiosRegulatoryClaimReviewPacket['cds_evidence_pack_status'];
    model_card_status: AskVetiosRegulatoryClaimReviewPacket['model_card_status'];
    ifu_status: AskVetiosRegulatoryClaimReviewPacket['ifu_status'];
    clinical_signoff_status: AskVetiosRegulatoryClaimReviewPacket['clinical_signoff_status'];
    legal_signoff_status: AskVetiosRegulatoryClaimReviewPacket['legal_signoff_status'];
    regulatory_claims_status: AskVetiosRegulatoryClaimsStatus;
    regulatory_risk_level: AskVetiosRegulatoryClaimReviewPacket['regulatory_risk_level'];
    diagnosis_or_treatment_claim_present: boolean;
    treatment_or_prescribing_claim_present: boolean;
    professional_review_required: boolean;
    independent_review_basis_available: boolean;
    citations_present: boolean;
    rationale_present: boolean;
    diagnostic_alternatives_present: boolean;
    outcome_confirmation_required: boolean;
    evidence_pack_hash: string;
    model_card_hash: string | null;
    ifu_hash: string | null;
    approval_packet_hash: string;
    review_packet: AskVetiosRegulatoryClaimReviewPacket;
    blockers: string[];
    warnings: string[];
    next_actions: string[];
    evidence: Record<string, unknown>;
    observed_at: string;
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

export function buildAskVetiosRegulatoryClaimReviewPacket(
    snapshot: AskVetiosRegulatoryClaimsSnapshot,
): AskVetiosRegulatoryClaimReviewPacket {
    const reviewQueue = determineReviewQueue(snapshot);
    const regulatoryRiskLevel = snapshot.claims_policy.device_claim_risk;
    const cdsEvidencePackStatus = determineCdsEvidencePackStatus(snapshot);
    const artifactRequired = snapshot.status !== 'non_clinical';
    const evidencePack = {
        regulatory_boundary: snapshot.regulatory_boundary,
        intended_user: snapshot.intended_user,
        claims_policy: snapshot.claims_policy,
        reviewability: snapshot.reviewability,
        fda_cds_alignment: snapshot.fda_cds_alignment,
        blocked_claims: snapshot.blocked_claims,
    };
    const evidencePackHash = hashJson(evidencePack);
    const modelCardHash = artifactRequired ? hashJson({
        artifact: 'model_card',
        status: snapshot.status,
        intended_user: snapshot.intended_user,
        claims_policy: snapshot.claims_policy,
        reviewability: snapshot.reviewability,
    }) : null;
    const ifuHash = artifactRequired ? hashJson({
        artifact: 'instructions_for_use',
        posture: snapshot.claims_policy.allowed_user_posture,
        professional_review_required: snapshot.claims_policy.professional_review_required,
        blocked_claims: snapshot.blocked_claims,
        warnings: snapshot.warnings,
    }) : null;
    const blockers = buildReviewBlockers(snapshot, cdsEvidencePackStatus);
    const warnings = unique([
        ...snapshot.warnings,
        ...(artifactRequired ? ['Model-card and IFU metadata must stay current with approved clinical claim posture.'] : []),
    ]);
    const nextActions = unique([
        ...snapshot.next_actions,
        ...(reviewQueue !== 'none' ? ['open_regulatory_claim_review_queue'] : []),
        ...(artifactRequired ? ['generate_model_card_draft', 'generate_ifu_draft'] : []),
        ...(snapshot.status === 'restricted_claims' ? ['require_legal_signoff_before_release'] : []),
    ]);
    const partialPacket = {
        schema_version: 'ask-vetios-regulatory-claim-review-v1' as const,
        review_queue: reviewQueue,
        claim_review_status: determineClaimReviewStatus(snapshot, cdsEvidencePackStatus),
        approval_status: determineApprovalStatus(snapshot),
        cds_evidence_pack_status: cdsEvidencePackStatus,
        model_card_status: artifactRequired ? 'draft_required' as const : 'not_required' as const,
        ifu_status: artifactRequired ? 'draft_required' as const : 'not_required' as const,
        clinical_signoff_status: snapshot.claims_policy.professional_review_required ? 'pending' as const : 'not_required' as const,
        legal_signoff_status: snapshot.status === 'restricted_claims' ? 'pending' as const : 'not_required' as const,
        regulatory_claims_status: snapshot.status,
        regulatory_risk_level: regulatoryRiskLevel,
        evidence_pack_hash: evidencePackHash,
        model_card_hash: modelCardHash,
        ifu_hash: ifuHash,
        blockers,
        warnings,
        next_actions: nextActions,
        evidence: {
            raw_output_stored: false as const,
            raw_prompt_stored: false as const,
            legal_advice_stored: false as const,
            evidence_pack_hash: evidencePackHash,
        },
    };

    return {
        ...partialPacket,
        approval_packet_hash: hashJson(partialPacket),
    };
}

export function buildAskVetiosRegulatoryClaimReviewEventDraft(input: {
    tenantId?: string | null;
    requestId: string;
    askVetiosQueryId?: string | null;
    snapshot: AskVetiosRegulatoryClaimsSnapshot;
    packet?: AskVetiosRegulatoryClaimReviewPacket;
    evidence?: Record<string, unknown>;
    observedAt?: Date;
}): AskVetiosRegulatoryClaimReviewEventDraft {
    const packet = input.packet ?? buildAskVetiosRegulatoryClaimReviewPacket(input.snapshot);
    return {
        tenant_id: input.tenantId ?? null,
        request_id: input.requestId,
        ask_vetios_query_id: input.askVetiosQueryId ?? null,
        review_queue: packet.review_queue,
        claim_review_status: packet.claim_review_status,
        approval_status: packet.approval_status,
        cds_evidence_pack_status: packet.cds_evidence_pack_status,
        model_card_status: packet.model_card_status,
        ifu_status: packet.ifu_status,
        clinical_signoff_status: packet.clinical_signoff_status,
        legal_signoff_status: packet.legal_signoff_status,
        regulatory_claims_status: packet.regulatory_claims_status,
        regulatory_risk_level: packet.regulatory_risk_level,
        diagnosis_or_treatment_claim_present: input.snapshot.claims_policy.diagnosis_or_treatment_claim_present,
        treatment_or_prescribing_claim_present: input.snapshot.claims_policy.treatment_or_prescribing_claim_present,
        professional_review_required: input.snapshot.claims_policy.professional_review_required,
        independent_review_basis_available: input.snapshot.claims_policy.independent_review_basis_available,
        citations_present: input.snapshot.reviewability.citations_present,
        rationale_present: input.snapshot.reviewability.rationale_present,
        diagnostic_alternatives_present: input.snapshot.reviewability.diagnostic_alternatives_present,
        outcome_confirmation_required: input.snapshot.reviewability.outcome_confirmation_required,
        evidence_pack_hash: packet.evidence_pack_hash,
        model_card_hash: packet.model_card_hash,
        ifu_hash: packet.ifu_hash,
        approval_packet_hash: packet.approval_packet_hash,
        review_packet: packet,
        blockers: packet.blockers,
        warnings: packet.warnings,
        next_actions: packet.next_actions,
        evidence: {
            ...packet.evidence,
            ...(input.evidence ?? {}),
        },
        observed_at: (input.observedAt ?? new Date()).toISOString(),
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

function determineReviewQueue(snapshot: AskVetiosRegulatoryClaimsSnapshot): AskVetiosRegulatoryReviewQueue {
    if (snapshot.status === 'non_clinical') return 'none';
    if (snapshot.status === 'restricted_claims') return 'legal_clinical_claims_review';
    if (snapshot.status === 'claims_review_required') return 'clinical_claims_review';
    return 'clinical_cds_review';
}

function determineCdsEvidencePackStatus(
    snapshot: AskVetiosRegulatoryClaimsSnapshot,
): AskVetiosRegulatoryClaimReviewPacket['cds_evidence_pack_status'] {
    if (snapshot.status === 'non_clinical') return 'not_required';
    return snapshot.claims_policy.independent_review_basis_available ? 'complete' : 'incomplete';
}

function determineClaimReviewStatus(
    snapshot: AskVetiosRegulatoryClaimsSnapshot,
    cdsEvidencePackStatus: AskVetiosRegulatoryClaimReviewPacket['cds_evidence_pack_status'],
): AskVetiosRegulatoryClaimReviewPacket['claim_review_status'] {
    if (snapshot.status === 'non_clinical') return 'not_required';
    if (snapshot.status === 'restricted_claims') return 'blocked';
    if (snapshot.status === 'claims_review_required') return 'pending';
    return cdsEvidencePackStatus === 'complete' ? 'ready_for_review' : 'pending';
}

function determineApprovalStatus(
    snapshot: AskVetiosRegulatoryClaimsSnapshot,
): AskVetiosRegulatoryClaimReviewPacket['approval_status'] {
    if (snapshot.status === 'non_clinical') return 'not_reviewed';
    if (snapshot.status === 'restricted_claims') return 'legal_review_required';
    if (snapshot.status === 'claims_review_required') return 'clinical_review_required';
    return snapshot.claims_policy.device_claim_risk === 'high'
        ? 'external_attestation_required'
        : 'clinical_review_required';
}

function buildReviewBlockers(
    snapshot: AskVetiosRegulatoryClaimsSnapshot,
    cdsEvidencePackStatus: AskVetiosRegulatoryClaimReviewPacket['cds_evidence_pack_status'],
): string[] {
    const blockers: string[] = [];
    if (snapshot.status === 'restricted_claims') blockers.push('restricted_claims_require_legal_and_clinical_review');
    if (snapshot.status === 'claims_review_required') blockers.push('clinical_claims_review_required');
    if (cdsEvidencePackStatus === 'incomplete') blockers.push('cds_evidence_pack_incomplete');
    if (!snapshot.reviewability.citations_present && snapshot.status !== 'non_clinical') blockers.push('citations_missing');
    if (!snapshot.reviewability.diagnostic_alternatives_present && snapshot.status !== 'non_clinical') blockers.push('diagnostic_alternatives_missing');
    return unique(blockers);
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

function hashJson(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
        .join(',')}}`;
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
