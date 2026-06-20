import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCireValidationReport } from '@/lib/cire/validation';
import { AI_INFERENCE_EVENTS, CLINICAL_CASES, CLINICAL_OUTCOME_EVENTS, PASSIVE_SIGNAL_EVENTS } from '@/lib/db/schemaContracts';

export const MOAT_COMPLETION_LEVELS = [
    'not_started',
    'foundation',
    'operating',
    'defensible',
    'blocked',
] as const;

export const MOAT_CLAIM_POSTURES = [
    'architecture_only',
    'measured_activity',
    'evidence_grade_claims',
    'restricted_claims',
] as const;

export const MOAT_VALUE_CAPTURE_LAYERS = [
    'interface',
    'workflow',
    'data_provenance',
    'trust_scoring',
    'federation',
    'surveillance',
] as const;

export const TWO_QUARTER_REPLICABILITY = [
    'unknown',
    'copyable_interface',
    'hard_to_replicate',
    'not_replicable_short_term',
] as const;

export type MoatCompletionLevel = typeof MOAT_COMPLETION_LEVELS[number];
export type MoatClaimPosture = typeof MOAT_CLAIM_POSTURES[number];
export type MoatValueCaptureLayer = typeof MOAT_VALUE_CAPTURE_LAYERS[number];
export type TwoQuarterReplicability = typeof TWO_QUARTER_REPLICABILITY[number];

export interface MoatCompletionCounts {
    live_event_count: number;
    outcome_confirmed_count: number;
    provenance_verified_count: number;
    trust_scored_count: number;
    external_validation_count: number;
    last_signal_at: string | null;
}

export interface MoatCompletionMinimums {
    live_event_count: number;
    outcome_confirmed_count: number;
    provenance_verified_count: number;
    trust_scored_count: number;
    external_validation_count: number;
}

export interface MoatCompletionAssessmentInput {
    moat_key: string;
    moat_name: string;
    value_capture_layer: MoatValueCaptureLayer;
    foundation_ready: boolean;
    hard_to_substitute: boolean;
    two_quarter_replicability: TwoQuarterReplicability;
    scarcity_basis: string[];
    requires_outcome_loop?: boolean;
    requires_provenance?: boolean;
    requires_trust_score?: boolean;
    requires_external_validation?: boolean;
    counts: MoatCompletionCounts;
    defensible_minimums: Partial<MoatCompletionMinimums>;
    evidence?: Record<string, unknown>;
    owner_label?: string | null;
}

export interface MoatCompletionDigest {
    moat_key: string;
    moat_name: string;
    value_capture_layer: MoatValueCaptureLayer;
    completion_level: MoatCompletionLevel;
    completion_score: number;
    claim_posture: MoatClaimPosture;
    hard_to_substitute: boolean;
    two_quarter_replicability: TwoQuarterReplicability;
    live_event_count: number;
    outcome_confirmed_count: number;
    provenance_verified_count: number;
    trust_scored_count: number;
    external_validation_count: number;
    last_signal_at: string | null;
    scarcity_basis: string[];
    missing_evidence: string[];
    evidence_requirements: {
        requires_outcome_loop: boolean;
        requires_provenance: boolean;
        requires_trust_score: boolean;
        requires_external_validation: boolean;
        defensible_minimums: MoatCompletionMinimums;
    };
    evidence: Record<string, unknown>;
    owner_label: string | null;
    next_unblock_action: string | null;
}

export interface MoatCompletionEvidence {
    generated_at: string;
    tenant_id: string;
    warnings: string[];
    dataset: {
        clinical_cases: number;
        real_case_imports: number;
        confirmed_labels: number;
        learning_ready_cases: number;
        calibration_ready_cases: number;
        last_signal_at: string | null;
    };
    inference: {
        inference_events: number;
        outcome_linked_inferences: number;
        cire_sample_size: number;
        cire_status: string;
        last_signal_at: string | null;
    };
    workflow: {
        passive_signal_events: number;
        last_signal_at: string | null;
    };
    ask_vetios: {
        query_events: number;
        case_graph_ready: number;
        grounded_drafts: number;
        retrieval_grounded: number;
        workflow_ready: number;
        human_review_required: number;
        security_review_required: number;
        regulatory_reviewable: number;
        last_signal_at: string | null;
    };
    case_graph_promotion: {
        promotion_events: number;
        promoted_to_case: number;
        linked_to_outcome: number;
        defensible_candidates: number;
        last_signal_at: string | null;
    };
    amr: {
        genomic_events: number;
        stewardship_events: number;
        culture_guided_events: number;
        outcome_tracked_events: number;
        resistance_suspected_events: number;
        last_signal_at: string | null;
    };
    specialist_review: {
        review_events: number;
        completed_reviews: number;
        corrected_or_partial_reviews: number;
        learning_eligible_reviews: number;
        pacs_linked_reviews: number;
        last_signal_at: string | null;
    };
    federation: {
        activation_events: number;
        active_nodes: number;
        ready_nodes: number;
        attested_nodes: number;
        secure_ready_nodes: number;
        heartbeat_healthy_nodes: number;
        last_signal_at: string | null;
    };
    trust_ops: {
        external_attestations: number;
        external_certifications: number;
        last_signal_at: string | null;
    };
}

export interface MoatCompletionSnapshot {
    tenant_id: string;
    generated_at: string;
    value_capture_principle: string;
    summary: {
        total_moats: number;
        foundation: number;
        operating: number;
        defensible: number;
        blocked: number;
        architecture_only: number;
        measured_activity: number;
        evidence_grade_claims: number;
        restricted_claims: number;
    };
    warnings: string[];
    evidence: MoatCompletionEvidence;
    moats: MoatCompletionDigest[];
}

const DEFAULT_MINIMUMS: MoatCompletionMinimums = {
    live_event_count: 25,
    outcome_confirmed_count: 25,
    provenance_verified_count: 25,
    trust_scored_count: 25,
    external_validation_count: 1,
};

const VALUE_CAPTURE_PRINCIPLE =
    'Moats graduate only when the scarce layer is producing outcome-linked, provenance-verified, trust-scored evidence that a well-funded competitor cannot copy in two quarters.';

export async function loadMoatCompletionEvidence(
    client: SupabaseClient,
    tenantId: string,
): Promise<MoatCompletionEvidence> {
    const warnings: string[] = [];
    const generatedAt = new Date().toISOString();

    const [
        dataset,
        inference,
        workflow,
        askVetios,
        caseGraphPromotion,
        amr,
        specialistReview,
        federation,
        trustOps,
    ] = await Promise.all([
        loadDatasetEvidence(client, tenantId, warnings),
        loadInferenceEvidence(client, tenantId, warnings),
        loadWorkflowEvidence(client, tenantId, warnings),
        loadAskVetiosEvidence(client, tenantId, warnings),
        loadCaseGraphPromotionEvidence(client, tenantId, warnings),
        loadAmrEvidence(client, tenantId, warnings),
        loadSpecialistReviewEvidence(client, tenantId, warnings),
        loadFederationEvidence(client, tenantId, warnings),
        loadTrustOpsEvidence(client, tenantId, warnings),
    ]);

    return {
        generated_at: generatedAt,
        tenant_id: tenantId,
        warnings,
        dataset,
        inference,
        workflow,
        ask_vetios: askVetios,
        case_graph_promotion: caseGraphPromotion,
        amr,
        specialist_review: specialistReview,
        federation,
        trust_ops: trustOps,
    };
}

export function buildMoatCompletionSnapshot(
    evidence: MoatCompletionEvidence,
): MoatCompletionSnapshot {
    const moats = buildMoatCompletionDigests(evidence);
    const summary = moats.reduce<MoatCompletionSnapshot['summary']>((acc, moat) => {
        acc.total_moats += 1;
        if (moat.completion_level === 'foundation') acc.foundation += 1;
        if (moat.completion_level === 'operating') acc.operating += 1;
        if (moat.completion_level === 'defensible') acc.defensible += 1;
        if (moat.completion_level === 'blocked') acc.blocked += 1;
        if (moat.claim_posture === 'architecture_only') acc.architecture_only += 1;
        if (moat.claim_posture === 'measured_activity') acc.measured_activity += 1;
        if (moat.claim_posture === 'evidence_grade_claims') acc.evidence_grade_claims += 1;
        if (moat.claim_posture === 'restricted_claims') acc.restricted_claims += 1;
        return acc;
    }, {
        total_moats: 0,
        foundation: 0,
        operating: 0,
        defensible: 0,
        blocked: 0,
        architecture_only: 0,
        measured_activity: 0,
        evidence_grade_claims: 0,
        restricted_claims: 0,
    });

    return {
        tenant_id: evidence.tenant_id,
        generated_at: evidence.generated_at,
        value_capture_principle: VALUE_CAPTURE_PRINCIPLE,
        summary,
        warnings: evidence.warnings,
        evidence,
        moats,
    };
}

export function buildMoatCompletionAssessment(
    input: MoatCompletionAssessmentInput,
): MoatCompletionDigest {
    const minimums = normalizeMinimums(input.defensible_minimums);
    const requiresOutcomeLoop = input.requires_outcome_loop ?? true;
    const requiresProvenance = input.requires_provenance ?? true;
    const requiresTrustScore = input.requires_trust_score ?? true;
    const requiresExternalValidation = input.requires_external_validation ?? false;

    const missingEvidence = new Set<string>();
    if (!input.foundation_ready) missingEvidence.add('technical_foundation');
    if (input.counts.live_event_count <= 0) missingEvidence.add('live_usage_events');
    if (requiresOutcomeLoop && input.counts.outcome_confirmed_count <= 0) {
        missingEvidence.add('outcome_confirmed_records');
    }
    if (requiresProvenance && input.counts.provenance_verified_count <= 0) {
        missingEvidence.add('provenance_verified_records');
    }
    if (requiresTrustScore && input.counts.trust_scored_count <= 0) {
        missingEvidence.add('trust_scored_records');
    }
    if (requiresExternalValidation && input.counts.external_validation_count <= 0) {
        missingEvidence.add('external_validation');
    }

    const defensibleReady = input.foundation_ready
        && input.hard_to_substitute
        && input.counts.live_event_count >= minimums.live_event_count
        && (!requiresOutcomeLoop || input.counts.outcome_confirmed_count >= minimums.outcome_confirmed_count)
        && (!requiresProvenance || input.counts.provenance_verified_count >= minimums.provenance_verified_count)
        && (!requiresTrustScore || input.counts.trust_scored_count >= minimums.trust_scored_count)
        && (!requiresExternalValidation || input.counts.external_validation_count >= minimums.external_validation_count);

    if (!defensibleReady) {
        if (input.counts.live_event_count < minimums.live_event_count) {
            missingEvidence.add(`defensible_live_volume_${minimums.live_event_count}`);
        }
        if (requiresOutcomeLoop && input.counts.outcome_confirmed_count < minimums.outcome_confirmed_count) {
            missingEvidence.add(`defensible_outcome_volume_${minimums.outcome_confirmed_count}`);
        }
        if (requiresProvenance && input.counts.provenance_verified_count < minimums.provenance_verified_count) {
            missingEvidence.add(`defensible_provenance_volume_${minimums.provenance_verified_count}`);
        }
        if (requiresTrustScore && input.counts.trust_scored_count < minimums.trust_scored_count) {
            missingEvidence.add(`defensible_trust_score_volume_${minimums.trust_scored_count}`);
        }
        if (requiresExternalValidation && input.counts.external_validation_count < minimums.external_validation_count) {
            missingEvidence.add(`defensible_external_validation_${minimums.external_validation_count}`);
        }
    }

    const operatingReady = input.foundation_ready
        && input.counts.live_event_count > 0
        && (!requiresOutcomeLoop || input.counts.outcome_confirmed_count > 0)
        && (!requiresProvenance || input.counts.provenance_verified_count > 0)
        && (!requiresTrustScore || input.counts.trust_scored_count > 0)
        && (!requiresExternalValidation || input.counts.external_validation_count > 0);

    const completionLevel: MoatCompletionLevel = !input.foundation_ready
        ? 'blocked'
        : defensibleReady ? 'defensible'
            : operatingReady ? 'operating'
                : 'foundation';
    const claimPosture = resolveClaimPosture(completionLevel);

    return {
        moat_key: input.moat_key,
        moat_name: input.moat_name,
        value_capture_layer: input.value_capture_layer,
        completion_level: completionLevel,
        completion_score: scoreCompletion({
            foundationReady: input.foundation_ready,
            hardToSubstitute: input.hard_to_substitute,
            counts: input.counts,
            minimums,
            requiresOutcomeLoop,
            requiresProvenance,
            requiresTrustScore,
            requiresExternalValidation,
        }),
        claim_posture: claimPosture,
        hard_to_substitute: input.hard_to_substitute,
        two_quarter_replicability: input.two_quarter_replicability,
        live_event_count: input.counts.live_event_count,
        outcome_confirmed_count: input.counts.outcome_confirmed_count,
        provenance_verified_count: input.counts.provenance_verified_count,
        trust_scored_count: input.counts.trust_scored_count,
        external_validation_count: input.counts.external_validation_count,
        last_signal_at: input.counts.last_signal_at,
        scarcity_basis: uniqueStrings(input.scarcity_basis),
        missing_evidence: Array.from(missingEvidence).sort(),
        evidence_requirements: {
            requires_outcome_loop: requiresOutcomeLoop,
            requires_provenance: requiresProvenance,
            requires_trust_score: requiresTrustScore,
            requires_external_validation: requiresExternalValidation,
            defensible_minimums: minimums,
        },
        evidence: input.evidence ?? {},
        owner_label: normalizeOptionalText(input.owner_label),
        next_unblock_action: resolveNextUnblockAction(Array.from(missingEvidence)),
    };
}

export function buildMoatCompletionDigests(evidence: MoatCompletionEvidence): MoatCompletionDigest[] {
    const externalValidationCount = evidence.trust_ops.external_attestations + evidence.trust_ops.external_certifications;
    const lastCoreSignal = latestIso([
        evidence.dataset.last_signal_at,
        evidence.inference.last_signal_at,
        evidence.workflow.last_signal_at,
    ]);
    const lastAskSignal = latestIso([
        evidence.ask_vetios.last_signal_at,
        evidence.case_graph_promotion.last_signal_at,
    ]);
    const outcomeLinkedTrust = evidence.inference.outcome_linked_inferences + evidence.inference.cire_sample_size;

    return [
        buildMoatCompletionAssessment({
            moat_key: 'outcome_provenance_layer',
            moat_name: 'Outcome-Linked Provenance Layer',
            value_capture_layer: 'data_provenance',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'not_replicable_short_term',
            scarcity_basis: [
                'real_clinic_followup_required',
                'confirmed_diagnosis_lineage',
                'deidentified_learning_consent',
            ],
            counts: {
                live_event_count: evidence.dataset.clinical_cases,
                outcome_confirmed_count: evidence.dataset.confirmed_labels,
                provenance_verified_count: evidence.dataset.learning_ready_cases + evidence.dataset.real_case_imports,
                trust_scored_count: outcomeLinkedTrust,
                external_validation_count: externalValidationCount,
                last_signal_at: lastCoreSignal,
            },
            defensible_minimums: {
                live_event_count: 100,
                outcome_confirmed_count: 50,
                provenance_verified_count: 50,
                trust_scored_count: 30,
            },
            evidence: {
                source_tables: ['clinical_cases', 'clinical_outcome_events', 'ai_inference_events'],
                clinical_cases: evidence.dataset.clinical_cases,
                confirmed_labels: evidence.dataset.confirmed_labels,
                cire_status: evidence.inference.cire_status,
            },
            owner_label: 'Clinical Data Ops',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'ask_vetios_case_graph',
            moat_name: 'Ask VetIOS Case Graph Promotion',
            value_capture_layer: 'data_provenance',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'hard_to_replicate',
            scarcity_basis: [
                'structured_intake_to_case_graph',
                'clinician_confirmed_promotion',
                'species_specific_context',
            ],
            counts: {
                live_event_count: evidence.ask_vetios.query_events + evidence.case_graph_promotion.promotion_events,
                outcome_confirmed_count: evidence.case_graph_promotion.linked_to_outcome,
                provenance_verified_count: evidence.ask_vetios.case_graph_ready + evidence.case_graph_promotion.promoted_to_case,
                trust_scored_count: evidence.ask_vetios.grounded_drafts + evidence.case_graph_promotion.defensible_candidates,
                external_validation_count: 0,
                last_signal_at: lastAskSignal,
            },
            defensible_minimums: {
                live_event_count: 100,
                outcome_confirmed_count: 30,
                provenance_verified_count: 50,
                trust_scored_count: 30,
            },
            evidence: {
                source_tables: ['ask_vetios_queries', 'clinical_cases'],
                case_graph_ready: evidence.ask_vetios.case_graph_ready,
                promotion_events: evidence.case_graph_promotion.promotion_events,
                promoted_to_case: evidence.case_graph_promotion.promoted_to_case,
                linked_to_outcome: evidence.case_graph_promotion.linked_to_outcome,
                public_or_tenant_queries: evidence.ask_vetios.query_events,
            },
            owner_label: 'Ask VetIOS',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'model_trust_layer',
            moat_name: 'Model Trust and CIRE Layer',
            value_capture_layer: 'trust_scoring',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'hard_to_replicate',
            scarcity_basis: [
                'outcome_linked_reliability_measurement',
                'calibration_samples',
                'failure_and_abstention_tracking',
            ],
            counts: {
                live_event_count: evidence.inference.inference_events,
                outcome_confirmed_count: evidence.inference.outcome_linked_inferences,
                provenance_verified_count: evidence.dataset.calibration_ready_cases,
                trust_scored_count: evidence.inference.cire_sample_size,
                external_validation_count: externalValidationCount,
                last_signal_at: latestIso([evidence.inference.last_signal_at, evidence.trust_ops.last_signal_at]),
            },
            defensible_minimums: {
                live_event_count: 100,
                outcome_confirmed_count: 30,
                provenance_verified_count: 30,
                trust_scored_count: 30,
            },
            evidence: {
                source_tables: ['ai_inference_events', 'clinical_outcome_events', 'model_attestations'],
                cire_status: evidence.inference.cire_status,
                external_validation_count: externalValidationCount,
            },
            owner_label: 'Trust Ops',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'veterinary_retrieval',
            moat_name: 'Veterinary-Specific Retrieval',
            value_capture_layer: 'data_provenance',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'hard_to_replicate',
            scarcity_basis: [
                'licensed_or_reviewed_veterinary_sources',
                'species_scoped_grounding',
                'reviewed_case_corpus_feedback',
            ],
            counts: {
                live_event_count: evidence.ask_vetios.query_events,
                outcome_confirmed_count: evidence.dataset.confirmed_labels,
                provenance_verified_count: evidence.ask_vetios.retrieval_grounded,
                trust_scored_count: evidence.ask_vetios.grounded_drafts,
                external_validation_count: 0,
                last_signal_at: latestIso([lastAskSignal, evidence.dataset.last_signal_at]),
            },
            defensible_minimums: {
                live_event_count: 100,
                outcome_confirmed_count: 30,
                provenance_verified_count: 50,
                trust_scored_count: 50,
            },
            evidence: {
                source_tables: ['ask_vetios_queries', 'agentic_rag_moat_snapshots'],
                retrieval_grounded: evidence.ask_vetios.retrieval_grounded,
                grounded_drafts: evidence.ask_vetios.grounded_drafts,
            },
            owner_label: 'Retrieval Ops',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'workflow_integration',
            moat_name: 'Workflow Integration Evidence',
            value_capture_layer: 'workflow',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'hard_to_replicate',
            scarcity_basis: [
                'passive_clinic_signal_collection',
                'pims_and_lab_workflow_context',
                'outcome_followup_hooks',
            ],
            counts: {
                live_event_count: evidence.workflow.passive_signal_events + evidence.dataset.clinical_cases,
                outcome_confirmed_count: evidence.inference.outcome_linked_inferences,
                provenance_verified_count: evidence.workflow.passive_signal_events + evidence.ask_vetios.workflow_ready,
                trust_scored_count: evidence.inference.cire_sample_size,
                external_validation_count: 0,
                last_signal_at: latestIso([evidence.workflow.last_signal_at, lastAskSignal, evidence.dataset.last_signal_at]),
            },
            defensible_minimums: {
                live_event_count: 100,
                outcome_confirmed_count: 30,
                provenance_verified_count: 50,
                trust_scored_count: 30,
            },
            evidence: {
                source_tables: ['passive_signal_events', 'ask_vetios_queries', 'clinical_cases'],
                passive_signal_events: evidence.workflow.passive_signal_events,
                workflow_ready_queries: evidence.ask_vetios.workflow_ready,
            },
            owner_label: 'Workflow Ops',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'specialist_review_loop',
            moat_name: 'Specialist and Human Review Loop',
            value_capture_layer: 'data_provenance',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'hard_to_replicate',
            scarcity_basis: [
                'clinician_correction_capture',
                'specialist_disposition_lineage',
                'outcome_linked_review_eligibility',
            ],
            counts: {
                live_event_count: evidence.specialist_review.review_events + evidence.ask_vetios.human_review_required,
                outcome_confirmed_count: evidence.specialist_review.learning_eligible_reviews,
                provenance_verified_count: evidence.specialist_review.completed_reviews,
                trust_scored_count: evidence.specialist_review.corrected_or_partial_reviews,
                external_validation_count: 0,
                last_signal_at: latestIso([evidence.specialist_review.last_signal_at, lastAskSignal]),
            },
            defensible_minimums: {
                live_event_count: 50,
                outcome_confirmed_count: 20,
                provenance_verified_count: 20,
                trust_scored_count: 5,
            },
            evidence: {
                source_tables: ['specialist_review_events', 'ask_vetios_queries'],
                completed_reviews: evidence.specialist_review.completed_reviews,
                learning_eligible_reviews: evidence.specialist_review.learning_eligible_reviews,
            },
            owner_label: 'Clinical Review Ops',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'amr_stewardship',
            moat_name: 'AMR Stewardship and Surveillance Loop',
            value_capture_layer: 'surveillance',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'not_replicable_short_term',
            scarcity_basis: [
                'culture_guided_antimicrobial_decisions',
                'species_specific_drug_outcomes',
                'resistance_signal_followup',
            ],
            counts: {
                live_event_count: evidence.amr.stewardship_events + evidence.amr.genomic_events,
                outcome_confirmed_count: evidence.amr.outcome_tracked_events,
                provenance_verified_count: evidence.amr.culture_guided_events + evidence.amr.genomic_events,
                trust_scored_count: evidence.amr.resistance_suspected_events,
                external_validation_count: 0,
                last_signal_at: evidence.amr.last_signal_at,
            },
            defensible_minimums: {
                live_event_count: 50,
                outcome_confirmed_count: 20,
                provenance_verified_count: 20,
                trust_scored_count: 5,
            },
            evidence: {
                source_tables: ['amr_stewardship_events', 'amr_genomic_events'],
                culture_guided_events: evidence.amr.culture_guided_events,
                outcome_tracked_events: evidence.amr.outcome_tracked_events,
            },
            owner_label: 'AMR Ops',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'federation_activation',
            moat_name: 'Outcome-Confirmed Federation Activation',
            value_capture_layer: 'federation',
            foundation_ready: true,
            hard_to_substitute: true,
            two_quarter_replicability: 'not_replicable_short_term',
            scarcity_basis: [
                'multi_clinic_participant_activation',
                'attested_secure_aggregation',
                'fresh_node_heartbeat_evidence',
            ],
            counts: {
                live_event_count: evidence.federation.activation_events,
                outcome_confirmed_count: evidence.federation.active_nodes,
                provenance_verified_count: evidence.federation.attested_nodes,
                trust_scored_count: evidence.federation.secure_ready_nodes + evidence.federation.heartbeat_healthy_nodes,
                external_validation_count: 0,
                last_signal_at: evidence.federation.last_signal_at,
            },
            defensible_minimums: {
                live_event_count: 25,
                outcome_confirmed_count: 3,
                provenance_verified_count: 3,
                trust_scored_count: 3,
            },
            evidence: {
                source_tables: ['federation_activation_events'],
                active_nodes: evidence.federation.active_nodes,
                attested_nodes: evidence.federation.attested_nodes,
                secure_ready_nodes: evidence.federation.secure_ready_nodes,
            },
            owner_label: 'Federation Ops',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'ai_security_layer',
            moat_name: 'AI Security and Abuse-Resistance Layer',
            value_capture_layer: 'trust_scoring',
            foundation_ready: true,
            hard_to_substitute: false,
            two_quarter_replicability: 'copyable_interface',
            scarcity_basis: [
                'prompt_injection_and_abuse_logging',
                'rate_limit_and_tool_boundary_evidence',
                'security_review_queue',
            ],
            requires_outcome_loop: false,
            requires_trust_score: false,
            counts: {
                live_event_count: evidence.ask_vetios.query_events,
                outcome_confirmed_count: 0,
                provenance_verified_count: evidence.ask_vetios.security_review_required,
                trust_scored_count: 0,
                external_validation_count: externalValidationCount,
                last_signal_at: latestIso([lastAskSignal, evidence.trust_ops.last_signal_at]),
            },
            defensible_minimums: {
                live_event_count: 100,
                provenance_verified_count: 10,
                external_validation_count: 1,
            },
            requires_external_validation: true,
            evidence: {
                source_tables: ['ask_vetios_queries', 'model_attestations'],
                security_review_required: evidence.ask_vetios.security_review_required,
                external_validation_count: externalValidationCount,
            },
            owner_label: 'Security Ops',
        }),
        buildMoatCompletionAssessment({
            moat_key: 'regulatory_claims_discipline',
            moat_name: 'Regulatory and Claims Discipline',
            value_capture_layer: 'trust_scoring',
            foundation_ready: true,
            hard_to_substitute: false,
            two_quarter_replicability: 'copyable_interface',
            scarcity_basis: [
                'cds_reviewability_boundary',
                'diagnosis_treatment_claim_control',
                'review_required_snapshotting',
            ],
            requires_outcome_loop: false,
            counts: {
                live_event_count: evidence.ask_vetios.query_events,
                outcome_confirmed_count: 0,
                provenance_verified_count: evidence.ask_vetios.regulatory_reviewable,
                trust_scored_count: evidence.ask_vetios.grounded_drafts,
                external_validation_count: externalValidationCount,
                last_signal_at: latestIso([lastAskSignal, evidence.trust_ops.last_signal_at]),
            },
            defensible_minimums: {
                live_event_count: 100,
                provenance_verified_count: 30,
                trust_scored_count: 30,
                external_validation_count: 1,
            },
            requires_external_validation: true,
            evidence: {
                source_tables: ['ask_vetios_queries', 'model_attestations'],
                regulatory_reviewable: evidence.ask_vetios.regulatory_reviewable,
                external_validation_count: externalValidationCount,
            },
            owner_label: 'Trust Ops',
        }),
    ];
}

function resolveClaimPosture(level: MoatCompletionLevel): MoatClaimPosture {
    if (level === 'defensible') return 'evidence_grade_claims';
    if (level === 'operating') return 'measured_activity';
    return 'architecture_only';
}

function scoreCompletion(input: {
    foundationReady: boolean;
    hardToSubstitute: boolean;
    counts: MoatCompletionCounts;
    minimums: MoatCompletionMinimums;
    requiresOutcomeLoop: boolean;
    requiresProvenance: boolean;
    requiresTrustScore: boolean;
    requiresExternalValidation: boolean;
}): number {
    let score = input.foundationReady ? 0.25 : 0;
    score += ratioScore(input.counts.live_event_count, input.minimums.live_event_count) * 0.15;
    score += input.requiresOutcomeLoop
        ? ratioScore(input.counts.outcome_confirmed_count, input.minimums.outcome_confirmed_count) * 0.2
        : 0.1;
    score += input.requiresProvenance
        ? ratioScore(input.counts.provenance_verified_count, input.minimums.provenance_verified_count) * 0.15
        : 0.08;
    score += input.requiresTrustScore
        ? ratioScore(input.counts.trust_scored_count, input.minimums.trust_scored_count) * 0.15
        : 0.08;
    score += input.requiresExternalValidation
        ? ratioScore(input.counts.external_validation_count, input.minimums.external_validation_count) * 0.05
        : 0.03;
    if (input.hardToSubstitute) score += 0.1;
    return roundScore(score);
}

function ratioScore(value: number, minimum: number): number {
    if (minimum <= 0) return 1;
    return Math.max(0, Math.min(1, value / minimum));
}

function normalizeMinimums(input: Partial<MoatCompletionMinimums>): MoatCompletionMinimums {
    return {
        live_event_count: normalizeCount(input.live_event_count, DEFAULT_MINIMUMS.live_event_count),
        outcome_confirmed_count: normalizeCount(input.outcome_confirmed_count, DEFAULT_MINIMUMS.outcome_confirmed_count),
        provenance_verified_count: normalizeCount(input.provenance_verified_count, DEFAULT_MINIMUMS.provenance_verified_count),
        trust_scored_count: normalizeCount(input.trust_scored_count, DEFAULT_MINIMUMS.trust_scored_count),
        external_validation_count: normalizeCount(input.external_validation_count, DEFAULT_MINIMUMS.external_validation_count),
    };
}

async function loadDatasetEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['dataset']> {
    const C = CLINICAL_CASES.COLUMNS;
    const [clinicalCases, realCaseImports, confirmedLabels, learningReadyCases, calibrationReadyCases, lastSignalAt] = await Promise.all([
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId), warnings, 'clinical cases'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).eq(C.source_module, 'real_case_import'), warnings, 'real case imports'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).not(C.confirmed_diagnosis, 'is', null), warnings, 'confirmed labels'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).eq(C.telemetry_status, 'learning_ready'), warnings, 'learning-ready cases'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).not(C.confidence_error, 'is', null), warnings, 'calibration-ready cases'),
        latestTimestamp(client, CLINICAL_CASES.TABLE, C.updated_at, (query) => query.eq(C.tenant_id, tenantId), warnings, 'clinical case latest signal'),
    ]);
    return {
        clinical_cases: clinicalCases,
        real_case_imports: realCaseImports,
        confirmed_labels: confirmedLabels,
        learning_ready_cases: learningReadyCases,
        calibration_ready_cases: calibrationReadyCases,
        last_signal_at: lastSignalAt,
    };
}

async function loadInferenceEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['inference']> {
    const I = AI_INFERENCE_EVENTS.COLUMNS;
    const O = CLINICAL_OUTCOME_EVENTS.COLUMNS;
    const [inferenceEvents, outcomeLinkedInferences, lastInferenceAt, lastOutcomeAt, cire] = await Promise.all([
        countRows(client, AI_INFERENCE_EVENTS.TABLE, (query) => query.eq(I.tenant_id, tenantId), warnings, 'inference events'),
        countRows(client, CLINICAL_OUTCOME_EVENTS.TABLE, (query) => query.eq(O.tenant_id, tenantId).not(O.inference_event_id, 'is', null), warnings, 'outcome-linked inferences'),
        latestTimestamp(client, AI_INFERENCE_EVENTS.TABLE, I.created_at, (query) => query.eq(I.tenant_id, tenantId), warnings, 'inference latest signal'),
        latestTimestamp(client, CLINICAL_OUTCOME_EVENTS.TABLE, O.outcome_timestamp, (query) => query.eq(O.tenant_id, tenantId), warnings, 'outcome latest signal'),
        loadCireValidationReport(client, { tenantId, minSampleSize: 30 }).catch((error) => {
            warnings.push(`CIRE validation unavailable: ${readErrorMessage(error)}`);
            return null;
        }),
    ]);
    return {
        inference_events: inferenceEvents,
        outcome_linked_inferences: outcomeLinkedInferences,
        cire_sample_size: cire?.sample_size ?? 0,
        cire_status: cire?.status ?? 'unavailable',
        last_signal_at: latestIso([lastInferenceAt, lastOutcomeAt]),
    };
}

async function loadWorkflowEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['workflow']> {
    const P = PASSIVE_SIGNAL_EVENTS.COLUMNS;
    const [passiveSignalEvents, lastSignalAt] = await Promise.all([
        countRows(client, PASSIVE_SIGNAL_EVENTS.TABLE, (query) => query.eq(P.tenant_id, tenantId), warnings, 'passive signal events'),
        latestTimestamp(client, PASSIVE_SIGNAL_EVENTS.TABLE, P.created_at, (query) => query.eq(P.tenant_id, tenantId), warnings, 'passive signal latest signal'),
    ]);
    return {
        passive_signal_events: passiveSignalEvents,
        last_signal_at: lastSignalAt,
    };
}

async function loadAskVetiosEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['ask_vetios']> {
    const table = 'ask_vetios_queries';
    const askScope = (query: any) => applyAskVetiosTenantScope(query, tenantId);
    const [
        queryEvents,
        caseGraphReady,
        groundedDrafts,
        retrievalGrounded,
        workflowReady,
        humanReviewRequired,
        securityReviewRequired,
        regulatoryReviewable,
        lastSignalAt,
    ] = await Promise.all([
        countRows(client, table, askScope, warnings, 'Ask VetIOS queries'),
        countRows(client, table, (query) => askScope(query).eq('case_graph_status', 'ready_for_case_graph'), warnings, 'Ask VetIOS case graph ready'),
        countRows(client, table, (query) => askScope(query).eq('model_trust_status', 'grounded_draft'), warnings, 'Ask VetIOS grounded drafts'),
        countRows(client, table, (query) => askScope(query).eq('veterinary_retrieval_status', 'grounded_veterinary_context'), warnings, 'Ask VetIOS retrieval grounded'),
        countRows(client, table, (query) => askScope(query).eq('workflow_integration_status', 'case_ready'), warnings, 'Ask VetIOS workflow ready'),
        countRows(client, table, (query) => askScope(query).in('human_review_status', [
            'clinician_review_required',
            'specialist_review_recommended',
            'emergency_review_required',
        ]), warnings, 'Ask VetIOS human review required'),
        countRows(client, table, (query) => askScope(query).eq('ai_security_status', 'security_review_required'), warnings, 'Ask VetIOS security review required'),
        countRows(client, table, (query) => askScope(query).eq('regulatory_claims_status', 'cds_reviewable'), warnings, 'Ask VetIOS regulatory reviewable'),
        latestTimestamp(client, table, 'created_at', askScope, warnings, 'Ask VetIOS latest signal'),
    ]);

    return {
        query_events: queryEvents,
        case_graph_ready: caseGraphReady,
        grounded_drafts: groundedDrafts,
        retrieval_grounded: retrievalGrounded,
        workflow_ready: workflowReady,
        human_review_required: humanReviewRequired,
        security_review_required: securityReviewRequired,
        regulatory_reviewable: regulatoryReviewable,
        last_signal_at: lastSignalAt,
    };
}

async function loadCaseGraphPromotionEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['case_graph_promotion']> {
    const table = 'ask_vetios_case_graph_promotion_events';
    const [promotionEvents, promotedToCase, linkedToOutcome, defensibleCandidates, lastSignalAt] = await Promise.all([
        countRows(client, table, (query) => query.eq('tenant_id', tenantId), warnings, 'Ask VetIOS case graph promotion events'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('promotion_status', 'promoted_to_case'), warnings, 'Ask VetIOS promoted case graph events'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('promotion_status', 'linked_to_outcome'), warnings, 'Ask VetIOS outcome-linked case graph events'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('value_capture_status', 'defensible_candidate'), warnings, 'Ask VetIOS defensible case graph candidates'),
        latestTimestamp(client, table, 'observed_at', (query) => query.eq('tenant_id', tenantId), warnings, 'Ask VetIOS case graph promotion latest signal'),
    ]);

    return {
        promotion_events: promotionEvents,
        promoted_to_case: promotedToCase,
        linked_to_outcome: linkedToOutcome,
        defensible_candidates: defensibleCandidates,
        last_signal_at: lastSignalAt,
    };
}

async function loadAmrEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['amr']> {
    const [genomicEvents, stewardshipEvents, cultureGuidedEvents, outcomeTrackedEvents, resistanceSuspectedEvents, lastGenomicAt, lastStewardshipAt] = await Promise.all([
        countRows(client, 'amr_genomic_events', (query) => query.eq('tenant_id', tenantId), warnings, 'AMR genomic events'),
        countRows(client, 'amr_stewardship_events', (query) => query.eq('tenant_id', tenantId), warnings, 'AMR stewardship events'),
        countRows(client, 'amr_stewardship_events', (query) => query.eq('tenant_id', tenantId).eq('culture_collected', true), warnings, 'AMR culture-guided events'),
        countRows(client, 'amr_stewardship_events', (query) => query.eq('tenant_id', tenantId).not('outcome_status', 'is', null), warnings, 'AMR outcome-tracked events'),
        countRows(client, 'amr_stewardship_events', (query) => query.eq('tenant_id', tenantId).eq('resistance_suspected', true), warnings, 'AMR resistance-suspected events'),
        latestTimestamp(client, 'amr_genomic_events', 'created_at', (query) => query.eq('tenant_id', tenantId), warnings, 'AMR genomic latest signal'),
        latestTimestamp(client, 'amr_stewardship_events', 'observed_at', (query) => query.eq('tenant_id', tenantId), warnings, 'AMR stewardship latest signal'),
    ]);

    return {
        genomic_events: genomicEvents,
        stewardship_events: stewardshipEvents,
        culture_guided_events: cultureGuidedEvents,
        outcome_tracked_events: outcomeTrackedEvents,
        resistance_suspected_events: resistanceSuspectedEvents,
        last_signal_at: latestIso([lastGenomicAt, lastStewardshipAt]),
    };
}

async function loadSpecialistReviewEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['specialist_review']> {
    const table = 'specialist_review_events';
    const [reviewEvents, completedReviews, correctedOrPartialReviews, learningEligibleReviews, pacsLinkedReviews, lastSignalAt] = await Promise.all([
        countRows(client, table, (query) => query.eq('tenant_id', tenantId), warnings, 'specialist review events'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('review_status', 'completed'), warnings, 'completed specialist reviews'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).in('ai_disposition', ['corrected', 'partially_supported']), warnings, 'specialist correction reviews'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('learning_eligible', true), warnings, 'learning-eligible specialist reviews'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('pacs_status', 'linked'), warnings, 'PACS-linked specialist reviews'),
        latestTimestamp(client, table, 'observed_at', (query) => query.eq('tenant_id', tenantId), warnings, 'specialist review latest signal'),
    ]);

    return {
        review_events: reviewEvents,
        completed_reviews: completedReviews,
        corrected_or_partial_reviews: correctedOrPartialReviews,
        learning_eligible_reviews: learningEligibleReviews,
        pacs_linked_reviews: pacsLinkedReviews,
        last_signal_at: lastSignalAt,
    };
}

async function loadFederationEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['federation']> {
    const table = 'federation_activation_events';
    const [activationEvents, activeNodes, readyNodes, attestedNodes, secureReadyNodes, heartbeatHealthyNodes, lastSignalAt] = await Promise.all([
        countRows(client, table, (query) => query.eq('tenant_id', tenantId), warnings, 'federation activation events'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('activation_status', 'active'), warnings, 'active federation nodes'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('activation_status', 'ready'), warnings, 'ready federation nodes'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('attestation_status', 'verified'), warnings, 'attested federation nodes'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('secure_aggregation_status', 'ready'), warnings, 'secure aggregation ready federation nodes'),
        countRows(client, table, (query) => query.eq('tenant_id', tenantId).eq('heartbeat_status', 'healthy'), warnings, 'healthy federation nodes'),
        latestTimestamp(client, table, 'observed_at', (query) => query.eq('tenant_id', tenantId), warnings, 'federation latest signal'),
    ]);

    return {
        activation_events: activationEvents,
        active_nodes: activeNodes,
        ready_nodes: readyNodes,
        attested_nodes: attestedNodes,
        secure_ready_nodes: secureReadyNodes,
        heartbeat_healthy_nodes: heartbeatHealthyNodes,
        last_signal_at: lastSignalAt,
    };
}

async function loadTrustOpsEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<MoatCompletionEvidence['trust_ops']> {
    const [externalAttestations, externalCertifications, lastAttestationAt, lastCertificationAt] = await Promise.all([
        countRows(client, 'model_attestations', (query) => query.eq('tenant_id', tenantId).eq('verification_status', 'verified'), warnings, 'verified model attestations'),
        countRows(client, 'model_certifications', (query) => query.eq('tenant_id', tenantId).eq('status', 'active'), warnings, 'active model certifications'),
        latestTimestamp(client, 'model_attestations', 'created_at', (query) => query.eq('tenant_id', tenantId), warnings, 'model attestation latest signal'),
        latestTimestamp(client, 'model_certifications', 'created_at', (query) => query.eq('tenant_id', tenantId), warnings, 'model certification latest signal'),
    ]);
    return {
        external_attestations: externalAttestations,
        external_certifications: externalCertifications,
        last_signal_at: latestIso([lastAttestationAt, lastCertificationAt]),
    };
}

async function countRows(
    client: SupabaseClient,
    table: string,
    applyFilters: (query: any) => any,
    warnings: string[],
    label: string,
): Promise<number> {
    const query = applyFilters(client.from(table).select('id', { count: 'exact', head: true }));
    const { count, error } = await query;
    if (error) {
        warnings.push(`${label} unavailable: ${readErrorMessage(error)}`);
        return 0;
    }
    return count ?? 0;
}

async function latestTimestamp(
    client: SupabaseClient,
    table: string,
    column: string,
    applyFilters: (query: any) => any,
    warnings: string[],
    label: string,
): Promise<string | null> {
    const query = applyFilters(client.from(table).select(column).order(column, { ascending: false }).limit(1));
    const { data, error } = await query.maybeSingle();
    if (error) {
        warnings.push(`${label} unavailable: ${readErrorMessage(error)}`);
        return null;
    }
    const value = (data as Record<string, unknown> | null)?.[column];
    return typeof value === 'string' ? value : null;
}

function applyAskVetiosTenantScope(query: any, tenantId: string) {
    if (UUID_PATTERN.test(tenantId)) {
        return query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
    }
    return query.is('tenant_id', null);
}

function resolveNextUnblockAction(missingEvidence: string[]): string | null {
    const missing = new Set(missingEvidence);
    if (missing.has('technical_foundation')) return 'Ship the technical foundation and tests before claiming live moat status.';
    if (missing.has('live_usage_events')) return 'Route real clinic or Ask VetIOS activity into the ledger.';
    if (missing.has('outcome_confirmed_records')) return 'Capture clinician-confirmed outcomes tied back to the source case or inference.';
    if (missing.has('provenance_verified_records')) return 'Attach provenance evidence: source table, reviewer, consent, culture, citation, or partner attestation.';
    if (missing.has('trust_scored_records')) return 'Run trust scoring or CIRE-style calibration on the outcome-linked records.';
    if (missing.has('external_validation')) return 'Add independent review, attestation, certification, or partner validation evidence.';
    const thresholdGap = missingEvidence.find((entry) => entry.startsWith('defensible_'));
    if (thresholdGap) return `Increase evidence volume for ${thresholdGap}.`;
    return null;
}

function latestIso(values: Array<string | null | undefined>): string | null {
    const timestamps = values
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => ({ value, ms: Date.parse(value) }))
        .filter((entry) => Number.isFinite(entry.ms))
        .sort((left, right) => right.ms - left.ms);
    return timestamps[0]?.value ?? null;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function normalizeOptionalText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeCount(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.round(value)
        : fallback;
}

function roundScore(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 10_000) / 10_000));
}

function readErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
        return error.message;
    }
    return 'query failed';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
