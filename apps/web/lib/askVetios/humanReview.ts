import type { AskVetiosCaseGraphSnapshot } from '@/lib/askVetios/caseGraph';
import type { AskVetiosIntakeSummary } from '@/lib/askVetios/intake';

export type AskVetiosHumanReviewStatus =
    | 'not_required'
    | 'clinician_review_required'
    | 'specialist_review_recommended'
    | 'emergency_review_required';

export type AskVetiosReviewerRoute =
    | 'none'
    | 'primary_clinician'
    | 'emergency_veterinarian'
    | 'internal_medicine'
    | 'diagnostic_imaging'
    | 'toxicology';

export interface AskVetiosHumanReviewSnapshot {
    schema_version: 'ask-vetios-human-review-v1';
    status: AskVetiosHumanReviewStatus;
    review_boundary: 'human_in_the_loop_clinical_review';
    review_required: boolean;
    reviewer_route: AskVetiosReviewerRoute;
    escalation: {
        emergency: boolean;
        specialist: boolean;
        clinician_confirmation_required: boolean;
        reason_count: number;
    };
    triggers: string[];
    case_context: {
        species: string | null;
        clinical_sign_count: number;
        labs_present: boolean;
        imaging_present: boolean;
        treatment_present: boolean;
        outcome_present: boolean;
        red_flag_count: number;
        top_confidence: number | null;
        evidence_status: string | null;
        model_trust_status: string | null;
        workflow_status: string | null;
    };
    handoff: {
        case_draft_key: string | null;
        clinical_case_href: string | null;
        inference_href: string | null;
        case_graph_ready: boolean;
        clinician_confirmation_status: 'not_captured';
    };
    next_actions: string[];
}

interface BuildAskVetiosHumanReviewSnapshotInput {
    mode: string;
    metadata: Record<string, unknown>;
    intake: AskVetiosIntakeSummary;
    caseGraphSnapshot?: AskVetiosCaseGraphSnapshot | null;
}

export function buildAskVetiosHumanReviewSnapshot(
    input: BuildAskVetiosHumanReviewSnapshotInput,
): AskVetiosHumanReviewSnapshot {
    const draft = input.intake.case_draft;
    const clinical = input.mode === 'clinical' || input.intake.is_clinical_intake;
    const redFlags = mergeStrings(readStringArray(input.metadata.red_flags), draft.red_flags);
    const urgency = readString(input.metadata.urgency_level);
    const evidenceStatus = readString(input.metadata.veterinary_retrieval_status);
    const modelTrustStatus = readString(input.metadata.model_trust_status);
    const workflowStatus = readString(input.metadata.workflow_integration_status);
    const topConfidence = readTopConfidence(input.metadata.diagnosis_ranked);
    const outcomePresent = draft.outcome_signals.length > 0;
    const graphReady = input.caseGraphSnapshot?.promotion.clinical_cases_ready === true;
    const toxicologySignal = hasToxicologySignal(redFlags, draft.raw_note);
    const emergency = clinical && (
        redFlags.length > 0
        || urgency === 'emergency'
        || urgency === 'critical'
    );
    const specialist = clinical && !emergency && (
        toxicologySignal
        || draft.imaging.length > 0
        || evidenceStatus === 'ungrounded'
        || evidenceStatus === 'needs_curated_sources'
        || evidenceStatus === 'partially_grounded'
        || modelTrustStatus === 'needs_evidence'
        || modelTrustStatus === 'needs_review'
        || (topConfidence !== null && topConfidence >= 0.85 && !outcomePresent)
    );
    const status = determineStatus({ clinical, emergency, specialist });
    const reviewerRoute = determineReviewerRoute({
        status,
        toxicologySignal,
        imagingPresent: draft.imaging.length > 0,
        labsPresent: draft.labs_or_tests.length > 0,
        treatmentPresent: draft.treatments.length > 0,
    });
    const triggers = buildTriggers({
        clinical,
        emergency,
        specialist,
        toxicologySignal,
        imagingPresent: draft.imaging.length > 0,
        labsPresent: draft.labs_or_tests.length > 0,
        treatmentPresent: draft.treatments.length > 0,
        outcomePresent,
        graphReady,
        intakeComplete: input.intake.status === 'case_ready' || input.intake.status === 'strong',
        evidenceStatus,
        modelTrustStatus,
        topConfidence,
    });

    return {
        schema_version: 'ask-vetios-human-review-v1',
        status,
        review_boundary: 'human_in_the_loop_clinical_review',
        review_required: status !== 'not_required',
        reviewer_route: reviewerRoute,
        escalation: {
            emergency,
            specialist: status === 'specialist_review_recommended',
            clinician_confirmation_required: clinical,
            reason_count: triggers.length,
        },
        triggers,
        case_context: {
            species: draft.species === 'unknown' ? null : draft.species,
            clinical_sign_count: draft.clinical_signs.length,
            labs_present: draft.labs_or_tests.length > 0,
            imaging_present: draft.imaging.length > 0,
            treatment_present: draft.treatments.length > 0,
            outcome_present: outcomePresent,
            red_flag_count: redFlags.length,
            top_confidence: topConfidence,
            evidence_status: evidenceStatus,
            model_trust_status: modelTrustStatus,
            workflow_status: workflowStatus,
        },
        handoff: {
            case_draft_key: input.caseGraphSnapshot?.draft_key ?? null,
            clinical_case_href: input.intake.case_handoff.ready ? input.intake.case_handoff.clinical_case_href : null,
            inference_href: input.intake.case_handoff.ready ? input.intake.case_handoff.inference_href : null,
            case_graph_ready: graphReady,
            clinician_confirmation_status: 'not_captured',
        },
        next_actions: buildNextActions({
            status,
            reviewerRoute,
            graphReady,
            outcomePresent,
            evidenceStatus,
            modelTrustStatus,
        }),
    };
}

function determineStatus(input: {
    clinical: boolean;
    emergency: boolean;
    specialist: boolean;
}): AskVetiosHumanReviewStatus {
    if (!input.clinical) return 'not_required';
    if (input.emergency) return 'emergency_review_required';
    if (input.specialist) return 'specialist_review_recommended';
    return 'clinician_review_required';
}

function determineReviewerRoute(input: {
    status: AskVetiosHumanReviewStatus;
    toxicologySignal: boolean;
    imagingPresent: boolean;
    labsPresent: boolean;
    treatmentPresent: boolean;
}): AskVetiosReviewerRoute {
    if (input.status === 'not_required') return 'none';
    if (input.status === 'emergency_review_required') return 'emergency_veterinarian';
    if (input.status === 'clinician_review_required') return 'primary_clinician';
    if (input.toxicologySignal) return 'toxicology';
    if (input.imagingPresent) return 'diagnostic_imaging';
    if (input.labsPresent || input.treatmentPresent) return 'internal_medicine';
    return 'primary_clinician';
}

function buildTriggers(input: {
    clinical: boolean;
    emergency: boolean;
    specialist: boolean;
    toxicologySignal: boolean;
    imagingPresent: boolean;
    labsPresent: boolean;
    treatmentPresent: boolean;
    outcomePresent: boolean;
    graphReady: boolean;
    intakeComplete: boolean;
    evidenceStatus: string | null;
    modelTrustStatus: string | null;
    topConfidence: number | null;
}): string[] {
    if (!input.clinical) return [];

    const triggers: string[] = ['clinician_confirmation_missing'];
    if (input.emergency) triggers.push('emergency_red_flags_present');
    if (input.specialist) triggers.push('specialist_review_recommended');
    if (input.toxicologySignal) triggers.push('suspected_toxicology_or_poisoning');
    if (input.imagingPresent) triggers.push('imaging_review_needed');
    if (input.labsPresent) triggers.push('labs_need_clinician_interpretation');
    if (input.treatmentPresent) triggers.push('treatment_plan_requires_confirmation');
    if (!input.outcomePresent) triggers.push('outcome_missing');
    if (!input.graphReady) triggers.push('case_graph_not_ready');
    if (!input.intakeComplete) triggers.push('minimum_intake_incomplete');
    if (input.evidenceStatus && input.evidenceStatus !== 'veterinary_grounded' && input.evidenceStatus !== 'non_clinical') {
        triggers.push('veterinary_retrieval_not_grounded');
    }
    if (input.modelTrustStatus && input.modelTrustStatus !== 'grounded_draft' && input.modelTrustStatus !== 'non_clinical') {
        triggers.push('model_trust_review_needed');
    }
    if (input.topConfidence !== null && input.topConfidence >= 0.85 && !input.outcomePresent) {
        triggers.push('high_confidence_requires_outcome_confirmation');
    }
    return unique(triggers);
}

function buildNextActions(input: {
    status: AskVetiosHumanReviewStatus;
    reviewerRoute: AskVetiosReviewerRoute;
    graphReady: boolean;
    outcomePresent: boolean;
    evidenceStatus: string | null;
    modelTrustStatus: string | null;
}): string[] {
    if (input.status === 'not_required') return [];

    const actions: string[] = [];
    if (input.status === 'emergency_review_required') actions.push('emergency_veterinary_review_now');
    if (input.reviewerRoute === 'toxicology') actions.push('toxicology_consult');
    if (input.reviewerRoute === 'diagnostic_imaging') actions.push('specialist_imaging_review');
    if (input.reviewerRoute === 'internal_medicine') actions.push('internal_medicine_review');
    if (input.evidenceStatus !== 'veterinary_grounded') actions.push('attach_veterinary_evidence');
    if (input.modelTrustStatus !== 'grounded_draft') actions.push('review_model_trust_flags');
    if (!input.graphReady) actions.push('complete_case_graph_fields');
    if (!input.outcomePresent) actions.push('capture_outcome');
    actions.push('clinician_confirmation');
    actions.push('save_review_notes');
    return unique(actions);
}

function hasToxicologySignal(redFlags: string[], rawNote: string): boolean {
    const value = [...redFlags, rawNote].join(' ').toLowerCase();
    return /\b(toxin|toxic|poison|poisoning|rodenticide|chocolate|ingested|xylitol|antifreeze|ethylene glycol)\b/.test(value);
}

function readTopConfidence(value: unknown): number | null {
    if (!Array.isArray(value)) return null;
    const first = asRecord(value[0]);
    const confidence = first.confidence;
    return typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null;
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

function unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
}
