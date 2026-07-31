import { describe, expect, it } from 'vitest';
import {
    AMR_CONCORDANCE_ALGORITHM_VERSION,
    AMR_GENOMIC_EVIDENCE_SCHEMA_VERSION,
    assessAMRGenomicPipelineValidation,
    assessAMRInteroperability,
    buildAMRConcordanceEvents,
    buildAMREvidenceFabricSnapshot,
    buildAMRGenomicPipelineValidationRef,
    hashAMREvidenceValue,
    prepareAMRGenomicEvidence,
    type AMRASTIngestionEvidenceRow,
    type AMRASTResultEvidenceRow,
    type AMRGenomicEvidenceRow,
} from '@/lib/amr/evidenceFabric';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AST_INGESTION_ID = '22222222-2222-4222-8222-222222222222';
const GENOMIC_EVENT_ID = '33333333-3333-4333-8333-333333333333';
const LAB_SITE_ID = '44444444-4444-4444-8444-444444444444';
const VALIDATION_EVENT_ID = '66666666-6666-4666-8666-666666666666';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const ISOLATE_REF = 'private-isolate-reference';
const ISOLATE_HASH = hashAMREvidenceValue(ISOLATE_REF);

describe('AMR evidence fabric', () => {
    it('allows clinical use only for externally validated classical evidence linked to AST', () => {
        const prepared = prepareAMRGenomicEvidence({
            tenantId: TENANT_ID,
            requestId: '55555555-5555-4555-8555-555555555555',
            actorId: 'lab_connector',
            oauthClientId: 'oauth-client-1',
            pipelineValidation: validPipelineValidation(),
            packet: validGenomicPacket(),
        });

        expect(prepared).toMatchObject({
            recordable: true,
            clinical_use_allowed: true,
            blockers: [],
        });
        expect(prepared.evidence_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(prepared.event).toMatchObject({
            raw_sequence_stored: false,
            computation_class: 'classical_validated',
            clinical_use_allowed: true,
            isolate_ref_hash: ISOLATE_HASH,
            external_validation_event_id: VALIDATION_EVENT_ID,
        });
    });

    it('does not trust a connector self-attested external validation claim', () => {
        const prepared = prepareAMRGenomicEvidence({
            tenantId: TENANT_ID,
            requestId: '55555555-5555-4555-8555-555555555559',
            actorId: 'lab_connector',
            oauthClientId: 'oauth-client-1',
            packet: validGenomicPacket(),
        });

        expect(prepared.recordable).toBe(true);
        expect(prepared.clinical_use_allowed).toBe(false);
        expect(prepared.clinical_blockers).toContain(
            'external_validation_event_required',
        );
        expect(prepared.event).toMatchObject({
            validation_status: 'unvalidated',
            external_validation_event_id: null,
        });
    });

    it('records experimental computation as research evidence but excludes clinical use', () => {
        const packet = validGenomicPacket();
        packet.computation_class = 'quantum_experimental';
        packet.quantum_backend = 'research_photonic_simulator';

        const prepared = prepareAMRGenomicEvidence({
            tenantId: TENANT_ID,
            requestId: '55555555-5555-4555-8555-555555555556',
            actorId: 'lab_connector',
            packet,
        });

        expect(prepared.recordable).toBe(true);
        expect(prepared.clinical_use_allowed).toBe(false);
        expect(prepared.warnings).toContain(
            'experimental_computation_clinically_excluded',
        );
    });

    it('distinguishes concordance, discordance signals, and classes not assayed', () => {
        const events = buildAMRConcordanceEvents({
            tenantId: TENANT_ID,
            requestId: '55555555-5555-4555-8555-555555555557',
            actorId: 'materializer',
            ingestion: validIngestion(),
            results: [
                result('01', 'amoxicillin', 'beta_lactam', 'R'),
                result('02', 'doxycycline', 'tetracycline', 'S'),
                result('03', 'enrofloxacin', 'fluoroquinolone', 'R'),
                result('04', 'colistin', 'colistin', 'S'),
                result('05', 'azithromycin', 'macrolide', 'R'),
            ],
            genomic: validGenomicRow(),
        });

        expect(events.map((event) => event.concordance_status)).toEqual([
            'concordant_resistant',
            'concordant_susceptible',
            'phenotype_only_resistance',
            'genotype_only_signal',
            'indeterminate',
        ]);
        expect(events[0]).toMatchObject({
            clinical_actionability: 'surveillance_supported',
            algorithm_version: AMR_CONCORDANCE_ALGORITHM_VERSION,
        });
        expect(events[2]?.clinical_actionability).toBe('review_required');
        expect(events[3]?.warnings).toContain(
            'genotype_does_not_establish_phenotypic_resistance',
        );
        expect(events[4]).toMatchObject({
            genotype_status: 'not_assayed',
            clinical_actionability: 'research_only',
        });
        expect(events[4]?.blockers).toContain('drug_class_not_assayed');
    });

    it('reports mapping readiness without claiming official submission conformance', () => {
        const profiles = assessAMRInteroperability({
            ingestion: validIngestion(),
            results: [result('01', 'amoxicillin', 'beta_lactam', 'R')],
        });

        expect(profiles.find((profile) => profile.profile_key === 'whonet')).toMatchObject({
            status: 'mapping_ready',
        });
        expect(profiles.find((profile) => profile.profile_key === 'fao_infarm')).toMatchObject({
            status: 'mapping_ready',
        });
        expect(profiles.find((profile) => profile.profile_key === 'who_glass')).toMatchObject({
            status: 'not_applicable',
        });
        expect(profiles.find((profile) => profile.profile_key === 'woah_animuse')).toMatchObject({
            status: 'not_applicable',
            blockers: ['antimicrobial_use_or_sales_facts_required'],
        });
        expect(profiles.every((profile) => /only|requires|remain/i.test(profile.boundary)))
            .toBe(true);
    });

    it('detects any experimental computation incorrectly marked for clinical use', () => {
        const snapshot = buildAMREvidenceFabricSnapshot({
            ingestions: [validIngestion()],
            results: [result('01', 'amoxicillin', 'beta_lactam', 'R')],
            genomicEvents: [{
                ...validGenomicRow(),
                computation_class: 'quantum_experimental',
                clinical_use_allowed: true,
            }],
            concordanceEvents: [],
            generatedAt: '2026-07-30T12:00:00.000Z',
        });

        expect(snapshot.quantum_boundary).toMatchObject({
            clinical_decision_influence: false,
            status: 'violation_detected',
            clinical_events_from_experimental_compute: 1,
        });
        expect(snapshot.blockers).toContain(
            'experimental_compute_clinical_boundary_violation',
        );
        expect(snapshot.proof_hash).toMatch(/^[a-f0-9]{64}$/);
    });
});

function validGenomicPacket() {
    return {
        schema_version: AMR_GENOMIC_EVIDENCE_SCHEMA_VERSION,
        source_system: 'reference_lab_wgs',
        source_version: '2026.07',
        source_record_digest: SHA_A,
        sequence_hash: SHA_B,
        isolate_ref: ISOLATE_REF,
        amr_ast_ingestion_event_id: AST_INGESTION_ID,
        lab_site_id: LAB_SITE_ID,
        species: 'canine',
        pathogen_label: 'Escherichia coli',
        region: 'KE',
        resistance_genes: ['blaCTX-M-15', 'mcr-1'],
        resistance_classes: ['beta_lactam', 'colistin'],
        assayed_drug_classes: [
            'beta_lactam',
            'colistin',
            'tetracycline',
            'fluoroquinolone',
        ],
        pipeline_name: 'amrfinderplus',
        pipeline_version: '4.0.3',
        reference_database_versions: {
            ncbi_amrfinderplus: '2026-07-01',
        },
        quality_status: 'passed' as const,
        validation_status: 'externally_validated' as const,
        computation_class: 'classical_validated' as const,
        deidentified: true,
        is_synthetic: false,
        observed_at: '2026-07-30T10:00:00.000Z',
    };
}

function validPipelineValidation() {
    const targetRef = buildAMRGenomicPipelineValidationRef(validGenomicPacket());
    return assessAMRGenomicPipelineValidation({
        targetRef,
        event: {
            id: VALIDATION_EVENT_ID,
            validation_target_type: 'amr_stewardship',
            validation_target_ref: targetRef,
            attestor_kind: 'reference_lab',
            validation_scope: 'amr_signal',
            attestation_status: 'accepted',
            verification_status: 'signature_verified',
            evidence_grade: 'externally_verified',
            validation_score: 0.95,
        },
    });
}

function validIngestion(): AMRASTIngestionEvidenceRow {
    return {
        id: AST_INGESTION_ID,
        tenant_id: TENANT_ID,
        lab_site_id: LAB_SITE_ID,
        isolate_ref_hash: ISOLATE_HASH,
        source_record_digest: SHA_A,
        canonical_packet_hash: SHA_B,
        species: 'canine',
        specimen_type: 'urine',
        anatomical_site: 'urinary_tract',
        country_code: 'KE',
        organism_label: 'Escherichia coli',
        organism_key: 'escherichia_coli',
        organism_code_system: 'NCBI Taxonomy',
        organism_code: '562',
        ast_method: 'broth_microdilution',
        interpretation_standard: 'CLSI VET01S',
        interpretation_standard_version: '2026',
        qc_status: 'passed',
        ingestion_status: 'accepted',
        observed_at: '2026-07-30T09:00:00.000Z',
    };
}

function validGenomicRow(): AMRGenomicEvidenceRow {
    return {
        id: GENOMIC_EVENT_ID,
        tenant_id: TENANT_ID,
        amr_ast_ingestion_event_id: AST_INGESTION_ID,
        lab_site_id: LAB_SITE_ID,
        isolate_ref_hash: ISOLATE_HASH,
        species: 'canine',
        pathogen_label: 'escherichia_coli',
        resistance_genes: ['blaCTX-M-15', 'mcr-1'],
        resistance_classes: ['beta_lactam', 'colistin'],
        assayed_drug_classes: [
            'beta_lactam',
            'colistin',
            'tetracycline',
            'fluoroquinolone',
        ],
        sequence_hash: SHA_B,
        source_record_digest: SHA_A,
        pipeline_name: 'amrfinderplus',
        pipeline_version: '4.0.3',
        pipeline_validation_ref:
            buildAMRGenomicPipelineValidationRef(validGenomicPacket()),
        external_validation_event_id: VALIDATION_EVENT_ID,
        reference_database_versions: { ncbi_amrfinderplus: '2026-07-01' },
        quality_status: 'passed',
        validation_status: 'externally_validated',
        computation_class: 'classical_validated',
        clinical_use_allowed: true,
        clinical_blockers: [],
        deidentified: true,
        is_synthetic: false,
        evidence_hash: SHA_B,
        observed_at: '2026-07-30T10:00:00.000Z',
    };
}

function result(
    suffix: string,
    antimicrobialKey: string,
    drugClass: string,
    interpretation: string,
): AMRASTResultEvidenceRow {
    return {
        id: `77777777-7777-4777-8777-7777777777${suffix}`,
        tenant_id: TENANT_ID,
        ingestion_event_id: AST_INGESTION_ID,
        antimicrobial_label: antimicrobialKey,
        antimicrobial_key: antimicrobialKey,
        drug_class: drugClass,
        measurement_type: 'mic',
        mic_value: 8,
        mic_unit: 'ug/mL',
        interpretation,
        result_hash: suffix.padEnd(64, suffix[0] ?? '0'),
        observed_at: '2026-07-30T09:00:00.000Z',
    };
}
