import { describe, expect, it } from 'vitest';
import {
    buildEvidenceNodeCompatibilityExport,
    buildEvidenceNodeContractSummaries,
    buildEvidenceNodeOperationsSnapshot,
    type EvidenceNodeContractEventRow,
    type EvidenceNodeIngestionProjectionRow,
    type EvidenceNodeResultProjectionRow,
} from '@/lib/amr/evidenceNode';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';

describe('Evidence Node control-plane kernel', () => {
    it('derives active contract state only from the latest in-window event', () => {
        const rows = [
            contractEvent('drafted', '2026-08-01T00:00:00.000Z'),
            contractEvent('approved', '2026-08-01T00:01:00.000Z'),
            contractEvent('activated', '2026-08-01T00:02:00.000Z'),
        ];
        expect(buildEvidenceNodeContractSummaries(rows, new Date('2026-08-02T00:00:00.000Z'))[0]).toMatchObject({
            contract_id: CONTRACT_ID,
            status: 'activated',
            active: true,
            mapping_hash: SHA_A,
        });
        rows.push(contractEvent('suspended', '2026-08-02T00:01:00.000Z'));
        expect(buildEvidenceNodeContractSummaries(rows, new Date('2026-08-02T01:00:00.000Z'))[0]?.active).toBe(false);
    });

    it('computes connector, reconciliation, duplicate, closure, and export operating rates', () => {
        const snapshot = buildEvidenceNodeOperationsSnapshot({
            contracts: [contractEvent('activated', '2026-08-01T00:02:00.000Z')],
            receipts: [
                { id: 'r1', tenant_id: 't1', request_id: 'q1', receipt_id: 'x1', contract_id: CONTRACT_ID, ingestion_event_id: 'i1', receipt_status: 'accepted', result_count: 1, occurred_at: new Date().toISOString() },
                { id: 'r2', tenant_id: 't1', request_id: 'q2', receipt_id: 'x2', contract_id: CONTRACT_ID, ingestion_event_id: 'i1', receipt_status: 'duplicate', result_count: 1, occurred_at: new Date().toISOString() },
            ],
            identityLinks: [{ id: 'l1', tenant_id: 't1', link_id: 'link1', ingestion_event_id: 'i1', event_type: 'verified', occurred_at: new Date().toISOString() }],
            closureTasks: [
                { id: 'c1', tenant_id: 't1', task_id: 'task1', event_type: 'queued', task_type: 'confirm_treatment', occurred_at: '2026-08-01T00:00:00Z' },
                { id: 'c2', tenant_id: 't1', task_id: 'task1', event_type: 'completed', task_type: 'confirm_treatment', occurred_at: '2026-08-01T01:00:00Z' },
            ],
            exports: [{ id: 'e1', tenant_id: 't1', export_id: 'export1', event_type: 'accepted', export_profile: 'infarm_compat_v1', validation_scope: 'external_receiver', official_acceptance: true, occurred_at: new Date().toISOString() }],
            connectorProbes: [
                { site_id: 'lab-1', oauth_client_id: 'oauth-1', probe_status: 'passed', occurred_at: new Date().toISOString() },
                { site_id: 'lab-1', oauth_client_id: 'oauth-1', probe_status: 'failed', occurred_at: new Date().toISOString() },
                { site_id: 'unrelated-lab', oauth_client_id: 'oauth-other', probe_status: 'passed', occurred_at: new Date().toISOString() },
            ],
        });
        expect(snapshot).toMatchObject({
            active_contracts: 1,
            connector_probe_count: 2,
            connector_uptime_rate: 0.5,
            duplicate_rate: 0.5,
            reconciliation_rate: 1,
            closure_rate: 1,
            export_acceptance_rate: 1,
        });
    });

    it('builds provenance-preserving compatibility records without claiming acceptance', () => {
        const result = buildEvidenceNodeCompatibilityExport({
            profile: 'infarm_compat_v1',
            ingestions: [validIngestion()],
            results: [validResult()],
        });
        expect(result.validation_status).toBe('passed');
        expect(result.artifact).toMatchObject({
            official_acceptance: false,
            compatibility_only: true,
            validation_scope: 'vetios_internal_projection',
            compatibility_scope: 'infarm_data_preparation_candidate',
            receiver_schema_verified: false,
            receiver_acceptance_required: true,
            raw_vendor_codes_preserved: true,
            breakpoint_tables_embedded: false,
            record_count: 1,
        });
        expect(result.artifact.records[0]).toMatchObject({
            terminology: {
                source_system: 'reference-lis',
                organism_code_system: 'http://snomed.info/sct',
                antimicrobial_code_system: 'urn:lis',
            },
            ast: {
                interpretation: 'R',
                breakpoint_computed_by_vetios: false,
            },
            provenance: {
                deidentified: true,
                synthetic: false,
                raw_payload_included: false,
            },
        });
        expect(result.artifact_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.warnings).toContain('infarm_national_focal_point_validation_required');
    });

    it('excludes synthetic and identifiable ingestions from standards projections', () => {
        const synthetic = { ...validIngestion(), is_synthetic: true };
        const identifiable = { ...validIngestion(), id: 'ingestion-2', deidentified: false };
        const result = buildEvidenceNodeCompatibilityExport({
            profile: 'nahln_compat_v1',
            ingestions: [synthetic, identifiable],
            results: [validResult(), { ...validResult(), id: 'result-2', ingestion_event_id: 'ingestion-2' }],
        });
        expect(result.validation_status).toBe('blocked');
        expect(result.record_count).toBe(0);
        expect(result.blockers).toEqual(expect.arrayContaining([
            'ingestion_ingestion-1:synthetic_evidence_excluded',
            'ingestion_ingestion-2:deidentification_required',
            'no_export_eligible_records',
        ]));
    });
});

function contractEvent(eventType: EvidenceNodeContractEventRow['event_type'], occurredAt: string): EvidenceNodeContractEventRow {
    return {
        id: `${eventType}-id`, tenant_id: 'tenant-1', request_id: `${eventType}-request`,
        contract_id: CONTRACT_ID, event_type: eventType, adapter_key: 'reference-lab.adapter.v1',
        contract_version: '1.0.0', mapping_version: '1.0.0', mapping_hash: SHA_A,
        reference_key_id: 'reference-lab-references-v1',
        clinic_site_id: 'clinic-1', lab_site_id: 'lab-1', oauth_client_id: 'oauth-1',
        mtls_cert_thumbprint_hash: SHA_B, source_system: 'reference-lis', source_version: '2026.1',
        permitted_transports: ['sftp'], permitted_formats: ['hl7_v2_oru_r01'],
        writeback_permitted: false, closure_destination_channel: 'manual_work_queue',
        purpose: 'AMR outcome network', terms_hash: SHA_A, data_use_agreement_hash: SHA_B,
        consent_basis: 'approved-network-protocol', deidentification_profile: 'vetios-amr-deid-v1',
        effective_at: '2026-08-01T00:00:00.000Z', expires_at: '2027-08-01T00:00:00.000Z',
        evidence: {}, event_hash: SHA_A, actor_id: 'actor-1', occurred_at: occurredAt, created_at: occurredAt,
    };
}

function validIngestion(): EvidenceNodeIngestionProjectionRow {
    return {
        id: 'ingestion-1', source_system: 'reference-lis', source_version: '2026.1',
        source_record_digest: SHA_A, canonical_packet_hash: SHA_B, species: 'canine', breed: null,
        production_class: null, specimen_type: 'urine', anatomical_site: 'bladder', country_code: 'KE',
        organism_label: 'Escherichia coli', organism_key: 'escherichia_coli',
        organism_code_system: 'http://snomed.info/sct', organism_code: '112283007',
        culture_collected_at: '2026-08-01T00:00:00Z', observed_at: '2026-08-01T01:00:00Z',
        ast_method: 'broth_microdilution', interpretation_standard: 'source-lab-standard',
        interpretation_standard_version: '2026', qc_status: 'passed', ingestion_status: 'accepted',
        deidentified: true, is_synthetic: false, raw_payload_stored: false,
    };
}

function validResult(): EvidenceNodeResultProjectionRow {
    return {
        id: 'result-1', ingestion_event_id: 'ingestion-1', result_index: 0,
        antimicrobial_label: 'ampicillin', antimicrobial_key: 'ampicillin',
        antimicrobial_code_system: 'urn:lis', antimicrobial_code: 'AMP', drug_class: 'beta_lactam',
        measurement_type: 'mic', mic_value: 16, mic_operator: '>=', mic_unit: 'ug/mL',
        zone_diameter_mm: null, qualitative_result: null, interpretation: 'R', breakpoint_value: 8,
        breakpoint_unit: 'ug/mL', breakpoint_basis: 'source laboratory reported interpretation',
        result_hash: SHA_A, observed_at: '2026-08-01T01:00:00Z',
    };
}
