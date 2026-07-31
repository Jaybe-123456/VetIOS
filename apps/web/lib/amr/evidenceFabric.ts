import { createHash } from 'crypto';
import {
    normalizeAMRDrugClassTaxonomy,
    normalizeAMRLabel,
} from '@/lib/amr/stewardship';

export const AMR_GENOMIC_EVIDENCE_SCHEMA_VERSION = 'vetios.amr.genomic-evidence.v1';
export const AMR_CONCORDANCE_ALGORITHM_VERSION =
    'vetios.amr.phenotype-genotype-concordance.v1';

export const AMR_COMPUTATION_CLASSES = [
    'classical_validated',
    'classical_heuristic',
    'quantum_experimental',
    'hybrid_experimental',
    'legacy_unclassified',
] as const;
export type AMRComputationClass = typeof AMR_COMPUTATION_CLASSES[number];

export const AMR_VALIDATION_STATUSES = [
    'unvalidated',
    'internally_validated',
    'externally_validated',
] as const;
export type AMRValidationStatus = typeof AMR_VALIDATION_STATUSES[number];

export type AMRPhenotypeStatus =
    | 'resistant'
    | 'non_susceptible'
    | 'susceptible'
    | 'intermediate'
    | 'unknown';

export type AMRGenotypeStatus = 'detected' | 'not_detected' | 'not_assayed' | 'unknown';

export type AMRConcordanceStatus =
    | 'concordant_resistant'
    | 'concordant_susceptible'
    | 'phenotype_only_resistance'
    | 'genotype_only_signal'
    | 'indeterminate'
    | 'not_comparable';

export type AMRClinicalActionability =
    | 'surveillance_supported'
    | 'review_required'
    | 'research_only';

export interface AMRGenomicEvidenceInput {
    schema_version: string;
    source_system: string;
    source_version?: string | null;
    source_record_digest: string;
    sequence_hash: string;
    isolate_ref: string;
    amr_ast_ingestion_event_id: string;
    lab_site_id: string;
    species: string;
    pathogen_label?: string | null;
    region?: string | null;
    resistance_genes: string[];
    resistance_classes: string[];
    assayed_drug_classes: string[];
    pipeline_name: string;
    pipeline_version: string;
    reference_database_versions: Record<string, string>;
    quality_status: 'passed' | 'warning' | 'failed' | 'not_reported';
    validation_status: AMRValidationStatus;
    computation_class: AMRComputationClass;
    quantum_backend?: string | null;
    deidentified: boolean;
    is_synthetic: boolean;
    observed_at: string;
    evidence?: Record<string, unknown> | null;
}

export interface PreparedAMRGenomicEvidence {
    recordable: boolean;
    clinical_use_allowed: boolean;
    blockers: string[];
    clinical_blockers: string[];
    warnings: string[];
    event: Record<string, unknown>;
    evidence_hash: string;
}

export interface AMRExternalValidationEvidenceRow {
    id: string;
    validation_target_type?: string | null;
    validation_target_ref?: string | null;
    attestor_kind?: string | null;
    validation_scope?: string | null;
    attestation_status?: string | null;
    verification_status?: string | null;
    evidence_grade?: string | null;
    validation_score?: number | string | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface AMRGenomicPipelineValidationAssessment {
    target_ref: string;
    external_validation_event_id: string | null;
    externally_verified: boolean;
    clinical_blockers: string[];
}

export interface AMRASTIngestionEvidenceRow {
    id: string;
    tenant_id: string;
    lab_site_id?: string | null;
    oauth_client_id?: string | null;
    isolate_ref_hash?: string | null;
    source_record_digest?: string | null;
    canonical_packet_hash?: string | null;
    species?: string | null;
    specimen_type?: string | null;
    anatomical_site?: string | null;
    country_code?: string | null;
    organism_label?: string | null;
    organism_key?: string | null;
    organism_code_system?: string | null;
    organism_code?: string | null;
    ast_method?: string | null;
    interpretation_standard?: string | null;
    interpretation_standard_version?: string | null;
    qc_status?: string | null;
    ingestion_status?: string | null;
    observed_at?: string | null;
}

export interface AMRASTResultEvidenceRow {
    id: string;
    tenant_id?: string | null;
    ingestion_event_id: string;
    antimicrobial_label?: string | null;
    antimicrobial_key?: string | null;
    antimicrobial_code_system?: string | null;
    antimicrobial_code?: string | null;
    drug_class?: string | null;
    measurement_type?: string | null;
    mic_value?: number | null;
    mic_operator?: string | null;
    mic_unit?: string | null;
    zone_diameter_mm?: number | null;
    qualitative_result?: string | null;
    interpretation?: string | null;
    breakpoint_value?: number | null;
    breakpoint_unit?: string | null;
    breakpoint_basis?: string | null;
    result_hash?: string | null;
    observed_at?: string | null;
}

export interface AMRGenomicEvidenceRow {
    id: string;
    tenant_id: string;
    request_id?: string | null;
    amr_ast_ingestion_event_id?: string | null;
    lab_site_id?: string | null;
    oauth_client_id?: string | null;
    external_validation_event_id?: string | null;
    pipeline_validation_ref?: string | null;
    isolate_ref_hash?: string | null;
    species?: string | null;
    pathogen_label?: string | null;
    region?: string | null;
    resistance_genes?: string[] | null;
    resistance_classes?: string[] | null;
    assayed_drug_classes?: string[] | null;
    sequence_hash?: string | null;
    source_record_digest?: string | null;
    pipeline_name?: string | null;
    pipeline_version?: string | null;
    reference_database_versions?: Record<string, string> | null;
    quality_status?: string | null;
    validation_status?: string | null;
    computation_class?: string | null;
    quantum_backend?: string | null;
    clinical_use_allowed?: boolean | null;
    deidentified?: boolean | null;
    is_synthetic?: boolean | null;
    evidence_hash?: string | null;
    blockers?: string[] | null;
    clinical_blockers?: string[] | null;
    warnings?: string[] | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface AMRConcordanceEventDraft {
    tenant_id: string;
    request_id: string;
    ast_ingestion_event_id: string;
    ast_result_event_id: string;
    genomic_event_id: string;
    isolate_ref_hash: string;
    antimicrobial_key: string;
    drug_class: string | null;
    phenotype_status: AMRPhenotypeStatus;
    genotype_status: AMRGenotypeStatus;
    concordance_status: AMRConcordanceStatus;
    clinical_actionability: AMRClinicalActionability;
    phenotype_result_hash: string;
    genomic_evidence_hash: string;
    resistance_genes: string[];
    interpretation_standard: string | null;
    interpretation_standard_version: string | null;
    algorithm_version: string;
    blockers: string[];
    warnings: string[];
    evidence: Record<string, unknown>;
    event_hash: string;
    observed_at: string;
    actor_id: string;
}

export interface AMRConcordanceEventRow extends AMRConcordanceEventDraft {
    id?: string | null;
    created_at?: string | null;
}

export interface AMRInteroperabilityProfileAssessment {
    profile_key:
        | 'whonet'
        | 'fao_infarm'
        | 'who_glass'
        | 'woah_animuse'
        | 'fhir_r5_diagnostics';
    status: 'mapping_ready' | 'blocked' | 'not_applicable';
    blockers: string[];
    mapped_fields: string[];
    boundary: string;
}

export interface AMREvidenceFabricSnapshot {
    schema_version: 'amr-evidence-fabric-v1';
    generated_at: string;
    genomics: {
        total: number;
        linked_to_ast: number;
        quality_passed: number;
        externally_validated: number;
        validation_evidence_linked: number;
        clinical_use_allowed: number;
        experimental_excluded: number;
        legacy_unclassified: number;
        rows: AMRGenomicEvidenceRow[];
    };
    concordance: {
        total: number;
        concordant_resistant: number;
        concordant_susceptible: number;
        phenotype_only_resistance: number;
        genotype_only_signal: number;
        indeterminate: number;
        not_comparable: number;
        review_required: number;
        surveillance_supported: number;
        rows: AMRConcordanceEventRow[];
    };
    interoperability: {
        profiles: Array<{
            profile_key: AMRInteroperabilityProfileAssessment['profile_key'];
            mapping_ready_records: number;
            blocked_records: number;
            not_applicable_records: number;
            blockers: string[];
            boundary: string;
        }>;
    };
    quantum_boundary: {
        clinical_decision_influence: false;
        experimental_events: number;
        clinical_events_from_experimental_compute: number;
        status: 'enforced' | 'violation_detected';
    };
    blockers: string[];
    next_actions: string[];
    proof_hash: string;
}

export function prepareAMRGenomicEvidence(input: {
    tenantId: string;
    requestId: string;
    actorId: string;
    oauthClientId?: string | null;
    pipelineValidation?: AMRGenomicPipelineValidationAssessment | null;
    packet: AMRGenomicEvidenceInput;
}): PreparedAMRGenomicEvidence {
    const packet = input.packet;
    const blockers = new Set<string>();
    const clinicalBlockers = new Set<string>();
    const warnings = new Set<string>();
    const observedAt = parseTimestamp(packet.observed_at);
    const referenceDatabaseVersions = normalizeVersionMap(packet.reference_database_versions);
    const resistanceGenes = normalizeStringList(packet.resistance_genes, false);
    const resistanceClasses = normalizeStringList(packet.resistance_classes, true);
    const assayedDrugClasses = normalizeStringList(packet.assayed_drug_classes, true);
    const experimental = isExperimentalComputation(packet.computation_class);
    const pipelineValidationRef = buildAMRGenomicPipelineValidationRef(packet);
    const pipelineValidation = input.pipelineValidation?.target_ref === pipelineValidationRef
        ? input.pipelineValidation
        : assessAMRGenomicPipelineValidation({
            targetRef: pipelineValidationRef,
            event: null,
        });

    if (packet.schema_version !== AMR_GENOMIC_EVIDENCE_SCHEMA_VERSION) {
        blockers.add('genomic_evidence_schema_mismatch');
    }
    if (!isSha256(packet.source_record_digest)) blockers.add('source_record_digest_invalid');
    if (!isSha256(packet.sequence_hash)) blockers.add('sequence_hash_invalid');
    if (!packet.deidentified) blockers.add('deidentification_required');
    if (packet.is_synthetic) blockers.add('synthetic_genomic_evidence_not_operational');
    if (packet.quality_status === 'failed') blockers.add('genomic_quality_failed');
    if (!observedAt) blockers.add('observed_at_invalid');
    if (observedAt && observedAt.getTime() > Date.now() + 5 * 60_000) {
        blockers.add('observed_at_in_future');
    }
    if (Object.keys(referenceDatabaseVersions).length === 0) {
        blockers.add('reference_database_version_required');
    }
    if (assayedDrugClasses.length === 0) {
        warnings.add('assayed_drug_classes_missing');
    }
    if (packet.quality_status === 'not_reported') warnings.add('genomic_quality_not_reported');
    if (!pipelineValidation.externally_verified) {
        warnings.add('external_validation_missing');
    }
    if (experimental) warnings.add('experimental_computation_clinically_excluded');
    if (packet.computation_class === 'classical_heuristic') {
        warnings.add('heuristic_screening_clinically_excluded');
    }
    if (packet.quantum_backend && !experimental) {
        blockers.add('quantum_backend_requires_experimental_computation_class');
    }

    if (packet.quality_status !== 'passed') {
        clinicalBlockers.add('genomic_quality_pass_required');
    }
    if (packet.computation_class !== 'classical_validated') {
        clinicalBlockers.add('validated_classical_computation_required');
    }
    for (const blocker of pipelineValidation.clinical_blockers) {
        clinicalBlockers.add(blocker);
    }
    if (!packet.amr_ast_ingestion_event_id) {
        clinicalBlockers.add('accepted_ast_ingestion_required');
    }
    if (assayedDrugClasses.length === 0) {
        clinicalBlockers.add('assayed_drug_classes_required');
    }
    if (!packet.deidentified) clinicalBlockers.add('deidentification_required');
    if (packet.is_synthetic) clinicalBlockers.add('synthetic_evidence_not_clinical');
    for (const blocker of blockers) clinicalBlockers.add(blocker);

    const clinicalUseAllowed = blockers.size === 0
        && clinicalBlockers.size === 0
        && packet.quality_status === 'passed'
        && pipelineValidation.externally_verified
        && packet.computation_class === 'classical_validated'
        && Boolean(packet.amr_ast_ingestion_event_id)
        && assayedDrugClasses.length > 0;
    const isolateRefHash = hashAMREvidenceValue(packet.isolate_ref);
    const normalizedCore = {
        schema_version: AMR_GENOMIC_EVIDENCE_SCHEMA_VERSION,
        source_system: normalizeAMRLabel(packet.source_system),
        source_version: normalizeOptionalText(packet.source_version),
        source_record_digest: packet.source_record_digest,
        sequence_hash: packet.sequence_hash,
        isolate_ref_hash: isolateRefHash,
        amr_ast_ingestion_event_id: packet.amr_ast_ingestion_event_id,
        lab_site_id: packet.lab_site_id,
        species: normalizeAMRLabel(packet.species),
        pathogen_label: normalizeOptionalLabel(packet.pathogen_label),
        region: normalizeOptionalText(packet.region)?.toUpperCase() ?? null,
        resistance_genes: resistanceGenes,
        resistance_classes: resistanceClasses,
        assayed_drug_classes: assayedDrugClasses,
        pipeline_name: packet.pipeline_name.trim(),
        pipeline_version: packet.pipeline_version.trim(),
        pipeline_validation_ref: pipelineValidationRef,
        external_validation_event_id:
            pipelineValidation.external_validation_event_id,
        reference_database_versions: referenceDatabaseVersions,
        quality_status: packet.quality_status,
        validation_status: pipelineValidation.externally_verified
            ? 'externally_validated'
            : packet.validation_status === 'externally_validated'
                ? 'unvalidated'
                : packet.validation_status,
        computation_class: packet.computation_class,
        quantum_backend: normalizeOptionalText(packet.quantum_backend),
        clinical_use_allowed: clinicalUseAllowed,
        deidentified: packet.deidentified,
        is_synthetic: packet.is_synthetic,
        raw_sequence_stored: false,
        observed_at: packet.observed_at,
    };
    const evidenceHash = hashAMREvidenceJson(normalizedCore);
    const event = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        ...normalizedCore,
        card_db_version: referenceDatabaseVersions.card ?? null,
        novel_pattern_score: null,
        evidence_hash: evidenceHash,
        blockers: Array.from(blockers).sort(),
        clinical_blockers: Array.from(clinicalBlockers).sort(),
        warnings: Array.from(warnings).sort(),
        evidence: {
            ...(packet.evidence ?? {}),
            claimed_validation_status: packet.validation_status,
            pipeline_validation: {
                target_ref: pipelineValidationRef,
                external_validation_event_id:
                    pipelineValidation.external_validation_event_id,
                externally_verified: pipelineValidation.externally_verified,
            },
            algorithm_boundary: {
                phenotype_required_for_clinical_interpretation: true,
                clinical_decision_influence: false,
                raw_sequence_stored: false,
            },
        },
        actor_id: input.actorId,
        oauth_client_id: input.oauthClientId ?? null,
    };

    return {
        recordable: blockers.size === 0,
        clinical_use_allowed: clinicalUseAllowed,
        blockers: Array.from(blockers).sort(),
        clinical_blockers: Array.from(clinicalBlockers).sort(),
        warnings: Array.from(warnings).sort(),
        event,
        evidence_hash: evidenceHash,
    };
}

export function buildAMRGenomicPipelineValidationRef(
    packet: Pick<
        AMRGenomicEvidenceInput,
        'pipeline_name' | 'pipeline_version' | 'reference_database_versions'
    >,
): string {
    const digest = hashAMREvidenceJson({
        pipeline_name: normalizeAMRLabel(packet.pipeline_name),
        pipeline_version: packet.pipeline_version.trim(),
        reference_database_versions:
            normalizeVersionMap(packet.reference_database_versions),
    });
    return `amr_genomic_pipeline:${digest}`;
}

export function assessAMRGenomicPipelineValidation(input: {
    targetRef: string;
    event: AMRExternalValidationEvidenceRow | null;
}): AMRGenomicPipelineValidationAssessment {
    const event = input.event;
    const blockers = uniqueStrings([
        ...(!event ? ['external_validation_event_required'] : []),
        ...(event && event.validation_target_ref !== input.targetRef
            ? ['external_validation_target_mismatch']
            : []),
        ...(event && !['amr_stewardship', 'other'].includes(
            event.validation_target_type ?? '',
        )
            ? ['external_validation_target_type_invalid']
            : []),
        ...(event && ![
            'reference_lab',
            'university',
            'public_health',
            'government',
            'research_partner',
            'auditor',
        ].includes(event.attestor_kind ?? '')
            ? ['independent_external_attestor_required']
            : []),
        ...(event && !['amr_signal', 'data_quality'].includes(
            event.validation_scope ?? '',
        )
            ? ['amr_pipeline_validation_scope_required']
            : []),
        ...(event && event.attestation_status !== 'accepted'
            ? ['external_validation_not_accepted']
            : []),
        ...(event && !['signature_verified', 'reviewer_verified'].includes(
            event.verification_status ?? '',
        )
            ? ['external_validation_verification_required']
            : []),
        ...(event && event.evidence_grade !== 'externally_verified'
            ? ['externally_verified_evidence_grade_required']
            : []),
        ...(event && readFiniteNumber(event.validation_score) < 0.8
            ? ['external_validation_score_below_threshold']
            : []),
    ]);

    return {
        target_ref: input.targetRef,
        external_validation_event_id: blockers.length === 0 ? event?.id ?? null : null,
        externally_verified: blockers.length === 0,
        clinical_blockers: blockers,
    };
}

export function buildAMRConcordanceEvents(input: {
    tenantId: string;
    requestId: string;
    actorId: string;
    ingestion: AMRASTIngestionEvidenceRow;
    results: AMRASTResultEvidenceRow[];
    genomic: AMRGenomicEvidenceRow;
}): AMRConcordanceEventDraft[] {
    const genomicClasses = new Set(normalizeStringList(input.genomic.resistance_classes ?? [], true));
    const assayedClasses = new Set(normalizeStringList(input.genomic.assayed_drug_classes ?? [], true));
    const resistanceGenes = normalizeStringList(input.genomic.resistance_genes ?? [], false);
    const isolateMatches = Boolean(
        input.ingestion.isolate_ref_hash
        && input.genomic.isolate_ref_hash
        && input.ingestion.isolate_ref_hash === input.genomic.isolate_ref_hash,
    );
    const experimental = isExperimentalComputation(
        normalizeComputationClass(input.genomic.computation_class),
    );
    const genomicEvidenceHash = isSha256(input.genomic.evidence_hash)
        ? input.genomic.evidence_hash!
        : hashAMREvidenceJson({
            genomic_event_id: input.genomic.id,
            sequence_hash: input.genomic.sequence_hash ?? null,
            resistance_genes: resistanceGenes,
            resistance_classes: Array.from(genomicClasses).sort(),
        });

    return input.results.map((result, index) => {
        const drugClass = normalizeAMRDrugClassTaxonomy(result.drug_class);
        const phenotypeStatus = resolvePhenotypeStatus(result.interpretation);
        const genotypeStatus = resolveGenotypeStatus({
            drugClass,
            genomicClasses,
            assayedClasses,
            qualityStatus: input.genomic.quality_status,
        });
        const concordanceStatus = resolveConcordanceStatus({
            phenotypeStatus,
            genotypeStatus,
            comparable: Boolean(drugClass && isolateMatches),
        });
        const blockers = uniqueStrings([
            ...(input.genomic.clinical_blockers ?? []),
            ...(!isolateMatches ? ['isolate_reference_mismatch'] : []),
            ...(input.ingestion.ingestion_status !== 'accepted'
                ? ['accepted_ast_ingestion_required']
                : []),
            ...(input.genomic.quality_status !== 'passed'
                ? ['genomic_quality_pass_required']
                : []),
            ...(!input.genomic.clinical_use_allowed
                ? ['genomic_clinical_use_not_allowed']
                : []),
            ...(experimental ? ['experimental_computation_clinically_excluded'] : []),
            ...(!drugClass ? ['drug_class_mapping_missing'] : []),
            ...(genotypeStatus === 'not_assayed' ? ['drug_class_not_assayed'] : []),
        ]);
        const warnings = uniqueStrings([
            ...(concordanceStatus === 'phenotype_only_resistance'
                ? ['resistance_mechanism_unresolved']
                : []),
            ...(concordanceStatus === 'genotype_only_signal'
                ? ['genotype_does_not_establish_phenotypic_resistance']
                : []),
            ...(phenotypeStatus === 'intermediate'
                ? ['intermediate_phenotype_requires_specialist_review']
                : []),
        ]);
        const clinicalActionability = resolveClinicalActionability({
            concordanceStatus,
            blockers,
            clinicalUseAllowed: input.genomic.clinical_use_allowed === true,
        });
        const antimicrobialKey = normalizeAMRLabel(
            result.antimicrobial_key ?? result.antimicrobial_label ?? `result_${index + 1}`,
        );
        const phenotypeResultHash = isSha256(result.result_hash)
            ? result.result_hash!
            : hashAMREvidenceJson({
                result_id: result.id,
                interpretation: result.interpretation ?? null,
                mic_value: result.mic_value ?? null,
                zone_diameter_mm: result.zone_diameter_mm ?? null,
            });
        const eventCore = {
            tenant_id: input.tenantId,
            ast_ingestion_event_id: input.ingestion.id,
            ast_result_event_id: result.id,
            genomic_event_id: input.genomic.id,
            isolate_ref_hash: input.genomic.isolate_ref_hash ?? '',
            antimicrobial_key: antimicrobialKey,
            drug_class: drugClass,
            phenotype_status: phenotypeStatus,
            genotype_status: genotypeStatus,
            concordance_status: concordanceStatus,
            clinical_actionability: clinicalActionability,
            phenotype_result_hash: phenotypeResultHash,
            genomic_evidence_hash: genomicEvidenceHash,
            resistance_genes: resistanceGenes,
            interpretation_standard: input.ingestion.interpretation_standard ?? null,
            interpretation_standard_version:
                input.ingestion.interpretation_standard_version ?? null,
            algorithm_version: AMR_CONCORDANCE_ALGORITHM_VERSION,
            blockers,
            warnings,
            observed_at: latestTimestamp(
                result.observed_at,
                input.genomic.observed_at,
                input.ingestion.observed_at,
            ),
        };

        return {
            request_id: input.requestId,
            ...eventCore,
            evidence: {
                raw_ast_measurement_preserved: true,
                raw_sequence_stored: false,
                absence_requires_assayed_class: true,
                clinical_decision_influence: false,
            },
            event_hash: hashAMREvidenceJson(eventCore),
            actor_id: input.actorId,
        };
    });
}

export function assessAMRInteroperability(input: {
    ingestion: AMRASTIngestionEvidenceRow;
    results: AMRASTResultEvidenceRow[];
}): AMRInteroperabilityProfileAssessment[] {
    const ingestion = input.ingestion;
    const validMeasurements = input.results.filter(hasUsableASTMeasurement);
    const commonBlockers = uniqueStrings([
        ...(ingestion.ingestion_status !== 'accepted' ? ['accepted_ast_required'] : []),
        ...(!ingestion.organism_key ? ['organism_mapping_missing'] : []),
        ...(!ingestion.specimen_type ? ['specimen_type_missing'] : []),
        ...(!ingestion.ast_method ? ['ast_method_missing'] : []),
        ...(!ingestion.interpretation_standard ? ['interpretation_standard_missing'] : []),
        ...(!ingestion.interpretation_standard_version
            ? ['interpretation_standard_version_missing']
            : []),
        ...(validMeasurements.length === 0 ? ['quantitative_or_qualitative_ast_missing'] : []),
    ]);
    const mappedFields = uniqueStrings([
        ...(ingestion.species ? ['species'] : []),
        ...(ingestion.country_code ? ['country_code'] : []),
        ...(ingestion.specimen_type ? ['specimen_type'] : []),
        ...(ingestion.organism_key ? ['organism'] : []),
        ...(ingestion.organism_code ? ['organism_external_code'] : []),
        ...(ingestion.ast_method ? ['ast_method'] : []),
        ...(ingestion.interpretation_standard ? ['interpretation_standard'] : []),
        ...(ingestion.interpretation_standard_version
            ? ['interpretation_standard_version']
            : []),
        ...(validMeasurements.length > 0 ? ['ast_measurements'] : []),
    ]);
    const nonHuman = !['human', 'homo_sapiens'].includes(normalizeAMRLabel(ingestion.species ?? ''));
    const infarmBlockers = uniqueStrings([
        ...commonBlockers,
        ...(!nonHuman ? ['non_human_domain_required'] : []),
        ...(!ingestion.country_code ? ['country_code_missing'] : []),
    ]);
    const glassApplicable = !nonHuman;
    const glassBlockers = uniqueStrings([
        ...commonBlockers,
        ...(!ingestion.country_code ? ['country_code_missing'] : []),
    ]);
    const fhirBlockers = uniqueStrings([
        ...(ingestion.ingestion_status !== 'accepted' ? ['accepted_ast_required'] : []),
        ...(!ingestion.specimen_type ? ['specimen_resource_mapping_missing'] : []),
        ...(!ingestion.organism_key ? ['observation_organism_missing'] : []),
        ...(validMeasurements.length === 0 ? ['observation_results_missing'] : []),
    ]);

    return [
        profileAssessment(
            'whonet',
            commonBlockers,
            mappedFields,
            'Mapping readiness only. VetIOS does not claim WHONET certification or direct submission.',
        ),
        profileAssessment(
            'fao_infarm',
            infarmBlockers,
            mappedFields,
            'Mapping readiness only. Country review and FAO InFARM enrollment remain external.',
            nonHuman,
        ),
        profileAssessment(
            'who_glass',
            glassBlockers,
            mappedFields,
            'Human-domain mapping readiness only. National GLASS authority controls submission.',
            glassApplicable,
        ),
        {
            profile_key: 'woah_animuse',
            status: 'not_applicable',
            blockers: ['antimicrobial_use_or_sales_facts_required'],
            mapped_fields: [],
            boundary: 'ANIMUSE requires antimicrobial-use or sales facts; an AST record is not an AMU report.',
        },
        profileAssessment(
            'fhir_r5_diagnostics',
            fhirBlockers,
            mappedFields,
            'Maps to diagnostic resources; implementation-guide conformance requires external validation.',
        ),
    ];
}

export function buildAMREvidenceFabricSnapshot(input: {
    ingestions: AMRASTIngestionEvidenceRow[];
    results: AMRASTResultEvidenceRow[];
    genomicEvents: AMRGenomicEvidenceRow[];
    concordanceEvents: AMRConcordanceEventRow[];
    generatedAt?: string;
}): AMREvidenceFabricSnapshot {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const ingestions = input.ingestions.filter((row) => row.ingestion_status === 'accepted');
    const resultsByIngestion = groupBy(input.results, (row) => row.ingestion_event_id);
    const profileAssessments = ingestions.flatMap((ingestion) =>
        assessAMRInteroperability({
            ingestion,
            results: resultsByIngestion.get(ingestion.id) ?? [],
        }),
    );
    const profileKeys: AMRInteroperabilityProfileAssessment['profile_key'][] = [
        'whonet',
        'fao_infarm',
        'who_glass',
        'woah_animuse',
        'fhir_r5_diagnostics',
    ];
    const experimentalEvents = input.genomicEvents.filter((row) =>
        isExperimentalComputation(normalizeComputationClass(row.computation_class)),
    );
    const experimentalClinicalViolations = experimentalEvents.filter(
        (row) => row.clinical_use_allowed === true,
    );
    const concordanceRows = [...input.concordanceEvents]
        .sort((left, right) =>
            (right.observed_at ?? right.created_at ?? '').localeCompare(
                left.observed_at ?? left.created_at ?? '',
            ),
        );
    const blockers = uniqueStrings([
        ...(input.genomicEvents.length === 0 ? ['genomic_evidence_missing'] : []),
        ...(input.genomicEvents.every((row) => !row.amr_ast_ingestion_event_id)
            ? ['genomic_ast_linkage_missing']
            : []),
        ...(input.genomicEvents.some(
            (row) => row.validation_status === 'externally_validated'
                && !row.external_validation_event_id,
        )
            ? ['external_validation_lineage_missing']
            : []),
        ...(input.concordanceEvents.length === 0
            ? ['phenotype_genotype_concordance_missing']
            : []),
        ...(input.concordanceEvents.some((row) => row.clinical_actionability === 'review_required')
            ? ['concordance_review_queue_not_empty']
            : []),
        ...(experimentalClinicalViolations.length > 0
            ? ['experimental_compute_clinical_boundary_violation']
            : []),
        ...(profileAssessments.every((assessment) => assessment.status !== 'mapping_ready')
            ? ['interoperability_mapping_not_ready']
            : []),
    ]);
    const snapshotWithoutHash = {
        schema_version: 'amr-evidence-fabric-v1' as const,
        generated_at: generatedAt,
        genomics: {
            total: input.genomicEvents.length,
            linked_to_ast: input.genomicEvents.filter(
                (row) => Boolean(row.amr_ast_ingestion_event_id),
            ).length,
            quality_passed: input.genomicEvents.filter(
                (row) => row.quality_status === 'passed',
            ).length,
            externally_validated: input.genomicEvents.filter(
                (row) => row.validation_status === 'externally_validated',
            ).length,
            validation_evidence_linked: input.genomicEvents.filter(
                (row) => Boolean(row.external_validation_event_id),
            ).length,
            clinical_use_allowed: input.genomicEvents.filter(
                (row) => row.clinical_use_allowed === true,
            ).length,
            experimental_excluded: experimentalEvents.filter(
                (row) => row.clinical_use_allowed !== true,
            ).length,
            legacy_unclassified: input.genomicEvents.filter(
                (row) => normalizeComputationClass(row.computation_class)
                    === 'legacy_unclassified',
            ).length,
            rows: [...input.genomicEvents]
                .sort((left, right) =>
                    (right.observed_at ?? right.created_at ?? '').localeCompare(
                        left.observed_at ?? left.created_at ?? '',
                    ),
                )
                .slice(0, 100),
        },
        concordance: {
            total: concordanceRows.length,
            concordant_resistant: countStatus(concordanceRows, 'concordant_resistant'),
            concordant_susceptible: countStatus(concordanceRows, 'concordant_susceptible'),
            phenotype_only_resistance: countStatus(
                concordanceRows,
                'phenotype_only_resistance',
            ),
            genotype_only_signal: countStatus(concordanceRows, 'genotype_only_signal'),
            indeterminate: countStatus(concordanceRows, 'indeterminate'),
            not_comparable: countStatus(concordanceRows, 'not_comparable'),
            review_required: concordanceRows.filter(
                (row) => row.clinical_actionability === 'review_required',
            ).length,
            surveillance_supported: concordanceRows.filter(
                (row) => row.clinical_actionability === 'surveillance_supported',
            ).length,
            rows: concordanceRows.slice(0, 200),
        },
        interoperability: {
            profiles: profileKeys.map((profileKey) => {
                const rows = profileAssessments.filter(
                    (assessment) => assessment.profile_key === profileKey,
                );
                return {
                    profile_key: profileKey,
                    mapping_ready_records: rows.filter(
                        (assessment) => assessment.status === 'mapping_ready',
                    ).length,
                    blocked_records: rows.filter(
                        (assessment) => assessment.status === 'blocked',
                    ).length,
                    not_applicable_records: rows.filter(
                        (assessment) => assessment.status === 'not_applicable',
                    ).length,
                    blockers: uniqueStrings(rows.flatMap((assessment) => assessment.blockers)),
                    boundary: rows[0]?.boundary ?? profileBoundary(profileKey),
                };
            }),
        },
        quantum_boundary: {
            clinical_decision_influence: false as const,
            experimental_events: experimentalEvents.length,
            clinical_events_from_experimental_compute: experimentalClinicalViolations.length,
            status: experimentalClinicalViolations.length === 0
                ? 'enforced' as const
                : 'violation_detected' as const,
        },
        blockers,
        next_actions: buildNextActions({
            genomicEvents: input.genomicEvents,
            concordanceEvents: concordanceRows,
            profileAssessments,
            experimentalClinicalViolations,
        }),
    };

    return {
        ...snapshotWithoutHash,
        proof_hash: hashAMREvidenceJson(snapshotWithoutHash),
    };
}

export function hashAMREvidenceValue(value: string): string {
    return createHash('sha256').update(value.trim()).digest('hex');
}

export function hashAMREvidenceJson(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function isExperimentalComputation(value: AMRComputationClass): boolean {
    return value === 'quantum_experimental' || value === 'hybrid_experimental';
}

function resolvePhenotypeStatus(value: string | null | undefined): AMRPhenotypeStatus {
    const normalized = value?.trim().toUpperCase();
    if (normalized === 'R') return 'resistant';
    if (normalized === 'NS') return 'non_susceptible';
    if (normalized === 'S') return 'susceptible';
    if (normalized === 'I' || normalized === 'SDD') return 'intermediate';
    return 'unknown';
}

function resolveGenotypeStatus(input: {
    drugClass: string | null;
    genomicClasses: Set<string>;
    assayedClasses: Set<string>;
    qualityStatus?: string | null;
}): AMRGenotypeStatus {
    if (!input.drugClass || input.qualityStatus === 'failed') return 'unknown';
    if (input.genomicClasses.has(input.drugClass)) return 'detected';
    if (input.assayedClasses.has(input.drugClass)) return 'not_detected';
    return 'not_assayed';
}

function resolveConcordanceStatus(input: {
    phenotypeStatus: AMRPhenotypeStatus;
    genotypeStatus: AMRGenotypeStatus;
    comparable: boolean;
}): AMRConcordanceStatus {
    if (!input.comparable) return 'not_comparable';
    if (
        input.phenotypeStatus === 'unknown'
        || input.phenotypeStatus === 'intermediate'
        || input.genotypeStatus === 'unknown'
        || input.genotypeStatus === 'not_assayed'
    ) {
        return 'indeterminate';
    }
    const phenotypeResistant = input.phenotypeStatus === 'resistant'
        || input.phenotypeStatus === 'non_susceptible';
    if (phenotypeResistant && input.genotypeStatus === 'detected') {
        return 'concordant_resistant';
    }
    if (!phenotypeResistant && input.genotypeStatus === 'not_detected') {
        return 'concordant_susceptible';
    }
    if (phenotypeResistant && input.genotypeStatus === 'not_detected') {
        return 'phenotype_only_resistance';
    }
    if (!phenotypeResistant && input.genotypeStatus === 'detected') {
        return 'genotype_only_signal';
    }
    return 'indeterminate';
}

function resolveClinicalActionability(input: {
    concordanceStatus: AMRConcordanceStatus;
    blockers: string[];
    clinicalUseAllowed: boolean;
}): AMRClinicalActionability {
    if (!input.clinicalUseAllowed || input.blockers.length > 0) return 'research_only';
    if (
        input.concordanceStatus === 'phenotype_only_resistance'
        || input.concordanceStatus === 'genotype_only_signal'
        || input.concordanceStatus === 'indeterminate'
        || input.concordanceStatus === 'not_comparable'
    ) {
        return 'review_required';
    }
    return 'surveillance_supported';
}

function profileAssessment(
    profileKey: AMRInteroperabilityProfileAssessment['profile_key'],
    blockers: string[],
    mappedFields: string[],
    boundary: string,
    applicable = true,
): AMRInteroperabilityProfileAssessment {
    if (!applicable) {
        return {
            profile_key: profileKey,
            status: 'not_applicable',
            blockers: ['profile_domain_not_applicable'],
            mapped_fields: mappedFields,
            boundary,
        };
    }
    return {
        profile_key: profileKey,
        status: blockers.length === 0 ? 'mapping_ready' : 'blocked',
        blockers,
        mapped_fields: mappedFields,
        boundary,
    };
}

function hasUsableASTMeasurement(result: AMRASTResultEvidenceRow): boolean {
    if (result.measurement_type === 'mic') {
        return typeof result.mic_value === 'number'
            && Number.isFinite(result.mic_value)
            && Boolean(result.mic_unit);
    }
    if (result.measurement_type === 'disk_diffusion') {
        return typeof result.zone_diameter_mm === 'number'
            && Number.isFinite(result.zone_diameter_mm);
    }
    return Boolean(result.qualitative_result || result.interpretation);
}

function buildNextActions(input: {
    genomicEvents: AMRGenomicEvidenceRow[];
    concordanceEvents: AMRConcordanceEventRow[];
    profileAssessments: AMRInteroperabilityProfileAssessment[];
    experimentalClinicalViolations: AMRGenomicEvidenceRow[];
}): string[] {
    return uniqueStrings([
        ...(input.genomicEvents.length === 0
            ? ['ingest_first_isolate_linked_genomic_evidence']
            : []),
        ...(input.genomicEvents.some((row) => row.validation_status !== 'externally_validated')
            ? ['externally_validate_genomic_pipeline']
            : []),
        ...(input.concordanceEvents.length === 0
            ? ['materialize_first_phenotype_genotype_concordance']
            : []),
        ...(input.concordanceEvents.some(
            (row) => row.clinical_actionability === 'review_required',
        )
            ? ['resolve_concordance_review_queue']
            : []),
        ...(input.profileAssessments.some((assessment) => assessment.status === 'blocked')
            ? ['complete_interoperability_field_mappings']
            : []),
        ...(input.experimentalClinicalViolations.length > 0
            ? ['quarantine_experimental_compute_evidence']
            : []),
    ]);
}

function profileBoundary(
    key: AMRInteroperabilityProfileAssessment['profile_key'],
): string {
    if (key === 'woah_animuse') {
        return 'AMU facts are required; AST evidence alone is not applicable.';
    }
    return 'Mapping readiness only; external authority validation remains required.';
}

function countStatus(rows: AMRConcordanceEventRow[], status: AMRConcordanceStatus): number {
    return rows.filter((row) => row.concordance_status === status).length;
}

function normalizeStringList(values: string[], taxonomy: boolean): string[] {
    return uniqueStrings(values.map((value) => {
        if (!taxonomy) return value.trim();
        return normalizeAMRDrugClassTaxonomy(value) ?? normalizeAMRLabel(value);
    }));
}

function normalizeVersionMap(value: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, version]) => [normalizeAMRLabel(key), version.trim()] as const)
            .filter(([key, version]) => Boolean(key && version))
            .sort(([left], [right]) => left.localeCompare(right)),
    );
}

function normalizeComputationClass(value: string | null | undefined): AMRComputationClass {
    return AMR_COMPUTATION_CLASSES.includes(value as AMRComputationClass)
        ? value as AMRComputationClass
        : 'legacy_unclassified';
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function normalizeOptionalLabel(value: string | null | undefined): string | null {
    const normalized = normalizeOptionalText(value);
    return normalized ? normalizeAMRLabel(normalized) : null;
}

function latestTimestamp(...values: Array<string | null | undefined>): string {
    const valid = values
        .filter((value): value is string => Boolean(parseTimestamp(value)))
        .sort();
    return valid.at(-1) ?? new Date().toISOString();
}

function parseTimestamp(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isSha256(value: string | null | undefined): boolean {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function readFiniteNumber(value: number | string | null | undefined): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(
        new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
    ).sort();
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
        const value = key(row);
        grouped.set(value, [...(grouped.get(value) ?? []), row]);
    }
    return grouped;
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${stableStringify(record[key])}`,
    ).join(',')}}`;
}
