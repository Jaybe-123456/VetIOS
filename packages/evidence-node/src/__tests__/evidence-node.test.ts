import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    hashEvidenceNodeMapping,
    normalizeEvidenceNodeSource,
    parseRfc4180Csv,
    type EvidenceNodeMapping,
} from '../index.ts';
import { EvidenceNodeSpool } from '../spool.ts';
import { sanitizeEvidenceNodeRemoteReceipt } from '../runtime.ts';

const REFERENCE_KEY = Buffer.alloc(32, 7);
const REFERENCE_KEY_ID = 'fixture-references-v1';

const localReceipt = sanitizeEvidenceNodeRemoteReceipt({
    status: 200,
    request_id: 'remote-request-1',
    body: {
        accepted: true,
        cached: true,
        receipt_id: 'receipt-1',
        receipt_event_id: 'receipt-event-1',
        receipt_hash: 'a'.repeat(64),
        receipt_status: 'duplicate',
        ingestion_event_id: 'ingestion-1',
        identity_link_id: 'identity-1',
        identity_status: 'verified',
        amr_episode_id: 'episode-1',
        closure_task_id: 'task-1',
        reconciliation_event_id: 'reconciliation-1',
        lab_feed_event_ids: ['lab-feed-1'],
        canonical_packet_hash: 'b'.repeat(64),
    },
});
assert.equal(localReceipt.receipt_status, 'duplicate');
assert.equal(localReceipt.duplicate, true);
assert.equal(localReceipt.closure_task_id, 'task-1');
assert.deepEqual(localReceipt.lab_feed_event_ids, ['lab-feed-1']);

const mapping: EvidenceNodeMapping = {
    schema: 'vetios.evidence-node.mapping.v1',
    adapter_key: 'test-lab.adapter.v1',
    mapping_version: '1.0.0',
    contract_id: '11111111-1111-4111-8111-111111111111',
    contract_version: '1.0.0',
    source_system: 'synthetic-lis-fixture',
    source_version: '2026.08',
    defaults: {
        site_id: '22222222-2222-4222-8222-222222222222',
        lab_site_id: '33333333-3333-4333-8333-333333333333',
        connector_probe_event_id: '44444444-4444-4444-8444-444444444444',
        species: 'canine',
        specimen_type: 'urine',
        country_code: 'KE',
        ast_method: 'broth_microdilution',
        interpretation_standard: 'laboratory_reported_standard',
        interpretation_standard_version: '2026',
        qc_status: 'passed',
        deidentified: true,
        is_synthetic: false,
    },
    fields: {
        organism_label: 'organism',
        antimicrobial_label: 'antimicrobial',
    },
    code_maps: {
        species: { dog: 'canine' },
        interpretation: { susceptible: 'S', resistant: 'R' },
        antimicrobials: {
            AMP: { label: 'ampicillin', key: 'ampicillin', code_system: 'local-lis', code: 'AMP' },
            ENR: { label: 'enrofloxacin', key: 'enrofloxacin', code_system: 'local-lis', code: 'ENR' },
        },
    },
    hl7: {
        organism_observation_codes: ['ORG'],
        antimicrobial_observation_codes: {
            AMP: { label: 'ampicillin', key: 'ampicillin', code_system: 'local-lis', code: 'AMP' },
        },
    },
    fhir: {
        organism_observation_codes: ['ORG'],
        antimicrobial_observation_codes: {
            ENR: { label: 'enrofloxacin', key: 'enrofloxacin', code_system: 'local-lis', code: 'ENR' },
        },
    },
};

assert.equal(
    hashEvidenceNodeMapping(mapping),
    hashEvidenceNodeMapping({
        ...mapping,
        defaults: {
            ...mapping.defaults,
            connector_probe_event_id: '55555555-5555-4555-8555-555555555555',
        },
    }),
);

const parsedQuoted = parseRfc4180Csv('id,label\r\n1,"E. coli, canine"\r\n');
assert.equal(parsedQuoted[0]?.label, 'E. coli, canine');

const csv = [
    'accession_id,isolate_id,patient_id,species,specimen_type,organism,observed_at,antimicrobial,antimicrobial_code,measurement_type,mic_value,mic_operator,mic_unit,interpretation',
    'ACC-1,ISO-1,PAT-LOCAL-1,dog,urine,Escherichia coli,2026-08-01T10:00:00Z,ampicillin,AMP,mic,16,>=,ug/mL,resistant',
    'ACC-1,ISO-1,PAT-LOCAL-1,dog,urine,Escherichia coli,2026-08-01T10:00:00Z,enrofloxacin,ENR,mic,0.25,<=,ug/mL,susceptible',
].join('\r\n');
const csvResult = normalizeEvidenceNodeSource({
    mapping,
    referenceKey: REFERENCE_KEY,
    referenceKeyId: REFERENCE_KEY_ID,
    source: {
        format: 'rfc4180_csv',
        transport: 'file_drop',
        source_ref: 'fixture.csv',
        content: csv,
    },
});
assert.equal(csvResult.accepted, true, csvResult.blockers.join(','));
assert.equal(csvResult.submissions.length, 1);
assert.equal(csvResult.submissions[0]?.packet.results.length, 2);
assert.equal(csvResult.submissions[0]?.packet.results[0]?.interpretation, 'R');
assert.match(csvResult.submissions[0]?.packet.isolate_ref ?? '', /^[a-f0-9]{64}$/);
assert.match(csvResult.submissions[0]?.packet.patient_ref ?? '', /^[a-f0-9]{64}$/);
assert.equal(JSON.stringify(csvResult.submissions).includes('PAT-LOCAL-1'), false);
assert.equal(JSON.stringify(csvResult.submissions).includes('ISO-1'), false);
assert.equal(csvResult.submissions[0]?.packet.evidence.evidence_node
    && (csvResult.submissions[0]?.packet.evidence.evidence_node as Record<string, unknown>).breakpoints_computed_by_vetios, false);

const mixedCsvResult = normalizeEvidenceNodeSource({
    mapping,
    referenceKey: REFERENCE_KEY,
    referenceKeyId: REFERENCE_KEY_ID,
    source: {
        format: 'rfc4180_csv',
        transport: 'file_drop',
        source_ref: 'mixed-fixture.csv',
        content: [
            csv.split('\r\n')[0],
            csv.split('\r\n')[1],
            'ACC-BLOCKED,ISO-BLOCKED,PAT-BLOCKED,dog,urine,,2026-08-01T10:00:00Z,ampicillin,AMP,mic,16,>=,ug/mL,resistant',
        ].join('\r\n'),
    },
});
assert.equal(mixedCsvResult.accepted, true, mixedCsvResult.blockers.join(','));
assert.equal(mixedCsvResult.submissions.length, 1);
assert.deepEqual(mixedCsvResult.rejected_records, [{
    record_index: 1,
    blockers: ['organism_missing'],
}]);
assert.ok(mixedCsvResult.warnings.includes('records_rejected:1'));

const jsonResult = normalizeEvidenceNodeSource({
    mapping,
    referenceKey: REFERENCE_KEY,
    referenceKeyId: REFERENCE_KEY_ID,
    source: {
        format: 'vetios_ast_json_v1',
        transport: 'webhook',
        source_ref: 'delivery-1',
        content: {
            accession_id: 'ACC-2',
            patient_id: 'PAT-LOCAL-2',
            patient_name: 'Must Not Leave Node',
            owner_email: 'private@example.test',
            species: 'dog',
            specimen_type: 'urine',
            organism: 'Escherichia coli',
            observed_at: '2026-08-01T11:00:00Z',
            results: [{
                antimicrobial: 'ampicillin',
                antimicrobial_code: 'AMP',
                measurement_type: 'mic',
                mic_value: 32,
                mic_unit: 'ug/mL',
                interpretation: 'R',
            }],
        },
    },
});
assert.equal(jsonResult.accepted, true, jsonResult.blockers.join(','));
assert.deepEqual(jsonResult.direct_identifier_paths_removed.sort(), ['owner_email', 'patient_name']);
assert.equal(JSON.stringify(jsonResult.submissions).includes('private@example.test'), false);
assert.equal(JSON.stringify(jsonResult.submissions).includes('Must Not Leave Node'), false);

const msh = ['MSH', '^~\\&', 'LIS', 'LAB', 'VETIOS', 'CONTROL', '20260801120000', '', 'ORU^R01', 'MSG-1', 'P', '2.5.1'];
const pid = Array(36).fill('');
pid[0] = 'PID';
pid[3] = 'PAT-HL7-1^^^LAB';
const spm = Array(18).fill('');
spm[0] = 'SPM';
spm[2] = 'ISO-HL7-1^^LAB';
spm[4] = 'UR^Urine^L';
spm[17] = '20260801100000';
const obr = Array(26).fill('');
obr[0] = 'OBR';
obr[3] = 'ACC-HL7-1^^LAB';
obr[7] = '20260801100000';
obr[22] = '20260801120000';
obr[25] = 'F';
const hl7 = [
    msh.join('|'),
    pid.join('|'),
    spm.join('|'),
    obr.join('|'),
    'OBX|1|CE|ORG^Organism^L||562^Escherichia coli^SCT||||||F',
    'OBX|2|NM|AMP^Ampicillin^L||16|ug/mL||R||||F',
].join('\r');
const hl7Result = normalizeEvidenceNodeSource({
    mapping,
    referenceKey: REFERENCE_KEY,
    referenceKeyId: REFERENCE_KEY_ID,
    source: { format: 'hl7_v2_oru_r01', transport: 'sftp', source_ref: 'message.hl7', content: hl7 },
});
assert.equal(hl7Result.accepted, true, hl7Result.blockers.join(','));
assert.equal(hl7Result.submissions[0]?.packet.organism_label, 'Escherichia coli');
assert.equal(hl7Result.submissions[0]?.packet.results[0]?.mic_value, 16);

const fhirResult = normalizeEvidenceNodeSource({
    mapping,
    referenceKey: REFERENCE_KEY,
    referenceKeyId: REFERENCE_KEY_ID,
    source: {
        format: 'fhir_r4_bundle',
        transport: 'api_poll',
        source_ref: 'fhir-page-1',
        content: {
            resourceType: 'Bundle',
            type: 'collection',
            entry: [
                { resource: {
                    resourceType: 'Patient', id: 'animal-1', identifier: [{ value: 'PAT-FHIR-1' }],
                    extension: [{
                        url: 'http://hl7.org/fhir/StructureDefinition/patient-animal',
                        extension: [
                            { url: 'species', valueCodeableConcept: { coding: [{ code: '448771007', display: 'Canis lupus familiaris' }] } },
                            { url: 'breed', valueCodeableConcept: { text: 'German Shepherd Dog' } },
                        ],
                    }],
                } },
                { resource: {
                    resourceType: 'Specimen', id: 'specimen-1', identifier: [{ value: 'ISO-FHIR-1' }],
                    type: { coding: [{ code: 'UR', display: 'Urine' }] },
                    collection: { collectedDateTime: '2026-08-01T09:00:00Z' },
                } },
                { resource: {
                    resourceType: 'Observation', id: 'organism-1',
                    code: { coding: [{ code: 'ORG', display: 'Organism' }] },
                    valueCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code: '112283007', display: 'Escherichia coli' }] },
                } },
                { resource: {
                    resourceType: 'Observation', id: 'ast-1',
                    code: { coding: [{ system: 'urn:lis', code: 'ENR', display: 'Enrofloxacin' }] },
                    valueQuantity: { value: 0.25, unit: 'ug/mL' },
                    interpretation: [{ coding: [{ code: 'S', display: 'Susceptible' }] }],
                } },
                { resource: {
                    resourceType: 'DiagnosticReport', id: 'report-1', status: 'final',
                    identifier: [{ value: 'ACC-FHIR-1' }], subject: { reference: 'Patient/animal-1' },
                    specimen: [{ reference: 'Specimen/specimen-1' }],
                    result: [{ reference: 'Observation/organism-1' }, { reference: 'Observation/ast-1' }],
                    effectiveDateTime: '2026-08-01T12:00:00Z',
                } },
            ],
        },
    },
});
assert.equal(fhirResult.accepted, true, fhirResult.blockers.join(','));
assert.equal(fhirResult.submissions[0]?.packet.results[0]?.antimicrobial_label, 'enrofloxacin');
assert.equal(fhirResult.submissions[0]?.packet.organism_code_system, 'http://snomed.info/sct');

const spoolRoot = await mkdtemp(join(tmpdir(), 'vetios-evidence-node-'));
try {
    const spool = new EvidenceNodeSpool({ root: spoolRoot, encryptionKey: randomBytes(32) });
    const first = await spool.enqueue('fixture', {
        format: 'vetios_ast_json_v1',
        transport: 'file_drop',
        source_ref: 'private-source',
        content: { patient_name: 'Encrypted Local Name', accession_id: 'ACC-SPOOL' },
    });
    const duplicate = await spool.enqueue('fixture', first.job.source);
    const renamedDuplicate = await spool.enqueue('fixture', {
        ...first.job.source,
        source_ref: 'same-content-different-file-name',
    });
    const remapped = await spool.enqueue('fixture', first.job.source, 'fixture:mapping-v2');
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(renamedDuplicate.created, false);
    assert.equal(remapped.created, true);
    const pendingFiles = await readdir(join(spoolRoot, 'pending'));
    const encrypted = await readFile(join(spoolRoot, 'pending', pendingFiles[0]!), 'utf8');
    assert.equal(encrypted.includes('Encrypted Local Name'), false);
    const [leased] = await spool.lease(1);
    assert.ok(leased);
    await spool.deadLetter(leased!, 'fixture_blocker');
    assert.equal((await spool.snapshot()).dead_letter, 1);
    assert.equal((await spool.replayDeadLetters()).length, 1);
    const [replayed] = await spool.lease(1);
    const receipt = await spool.complete(replayed!, [{ receipt_id: 'receipt-1', status: 'accepted' }]);
    assert.match(receipt.receipt_hash, /^[a-f0-9]{64}$/);
    assert.equal((await spool.snapshot()).delivered, 1);
} finally {
    await rm(spoolRoot, { recursive: true, force: true });
}

process.stdout.write('Evidence Node parser, privacy, dedupe, spool, and replay tests passed.\n');
