import { createHash, createHmac } from 'node:crypto';

export const EVIDENCE_NODE_MAPPING_SCHEMA = 'vetios.evidence-node.mapping.v1' as const;
export const EVIDENCE_NODE_AST_SCHEMA = 'vetios.amr.ast.v1' as const;

export type EvidenceNodeSourceFormat =
    | 'vetios_ast_json_v1'
    | 'hl7_v2_oru_r01'
    | 'fhir_r4_bundle'
    | 'rfc4180_csv';

export type EvidenceNodeTransport = 'webhook' | 'api_poll' | 'sftp' | 'file_drop';

export interface EvidenceNodeAntimicrobialDefinition {
    label: string;
    key?: string;
    drug_class?: string;
    code_system?: string;
    code?: string;
}

export interface EvidenceNodeMapping {
    schema: typeof EVIDENCE_NODE_MAPPING_SCHEMA;
    adapter_key: string;
    mapping_version: string;
    contract_id: string;
    contract_version: string;
    source_system: string;
    source_version?: string;
    defaults: {
        site_id: string;
        lab_site_id: string;
        connector_probe_event_id?: string;
        species?: string;
        breed?: string;
        production_class?: string;
        specimen_type?: string;
        anatomical_site?: string;
        country_code?: string;
        ast_method: string;
        interpretation_standard: string;
        interpretation_standard_version: string;
        qc_status?: 'passed' | 'warning' | 'failed' | 'not_reported';
        deidentified?: boolean;
        is_synthetic?: boolean;
    };
    fields?: Partial<Record<EvidenceNodeFieldKey, string>>;
    code_maps?: {
        species?: Record<string, string>;
        specimen?: Record<string, string>;
        organism?: Record<string, string>;
        organism_keys?: Record<string, string>;
        interpretation?: Record<string, EvidenceNodeASTInterpretation>;
        antimicrobials?: Record<string, EvidenceNodeAntimicrobialDefinition>;
    };
    hl7?: {
        organism_observation_codes: string[];
        antimicrobial_observation_codes?: Record<string, EvidenceNodeAntimicrobialDefinition>;
    };
    fhir?: {
        organism_observation_codes: string[];
        antimicrobial_observation_codes?: Record<string, EvidenceNodeAntimicrobialDefinition>;
    };
    csv?: {
        delimiter?: ',' | ';' | '\t';
    };
}

export type EvidenceNodeFieldKey =
    | 'accession_ref'
    | 'isolate_ref'
    | 'patient_ref'
    | 'case_id'
    | 'patient_episode_id'
    | 'species'
    | 'breed'
    | 'production_class'
    | 'specimen_type'
    | 'anatomical_site'
    | 'country_code'
    | 'admin_area'
    | 'organism_label'
    | 'organism_key'
    | 'organism_code_system'
    | 'organism_code'
    | 'culture_collected_at'
    | 'observed_at'
    | 'ast_method'
    | 'interpretation_standard'
    | 'interpretation_standard_version'
    | 'qc_status'
    | 'antimicrobial_label'
    | 'antimicrobial_key'
    | 'antimicrobial_code_system'
    | 'antimicrobial_code'
    | 'drug_class'
    | 'measurement_type'
    | 'mic_value'
    | 'mic_operator'
    | 'mic_unit'
    | 'zone_diameter_mm'
    | 'qualitative_result'
    | 'interpretation'
    | 'breakpoint_value'
    | 'breakpoint_unit'
    | 'breakpoint_basis';

export type EvidenceNodeASTInterpretation = 'S' | 'I' | 'R' | 'SDD' | 'NS' | 'IE' | 'UNKNOWN';

export interface EvidenceNodeRawSource {
    format: EvidenceNodeSourceFormat;
    transport: EvidenceNodeTransport;
    source_ref: string;
    content: string | Record<string, unknown>;
    received_at?: string;
}

export interface EvidenceNodeASTResult {
    antimicrobial_label: string;
    antimicrobial_key?: string;
    antimicrobial_code_system?: string;
    antimicrobial_code?: string;
    drug_class?: string;
    measurement_type: 'mic' | 'disk_diffusion' | 'qualitative';
    mic_value?: number;
    mic_operator?: '<' | '<=' | '=' | '>=' | '>';
    mic_unit?: string;
    zone_diameter_mm?: number;
    qualitative_result?: string;
    interpretation: EvidenceNodeASTInterpretation;
    breakpoint_value?: number;
    breakpoint_unit?: string;
    breakpoint_basis?: string;
    evidence?: Record<string, unknown>;
}

export interface EvidenceNodeCanonicalASTPacket {
    schema_version: typeof EVIDENCE_NODE_AST_SCHEMA;
    source_system: string;
    source_version?: string;
    source_record_digest: string;
    isolate_ref: string;
    patient_ref?: string;
    site_id: string;
    lab_site_id: string;
    connector_probe_event_id: string;
    species: string;
    breed?: string;
    production_class?: string;
    specimen_type: string;
    anatomical_site?: string;
    country_code?: string;
    admin_area?: string;
    organism_label: string;
    organism_key?: string;
    organism_code_system?: string;
    organism_code?: string;
    culture_collected_at?: string;
    observed_at: string;
    ast_method: string;
    interpretation_standard: string;
    interpretation_standard_version: string;
    qc_status: 'passed' | 'warning' | 'failed' | 'not_reported';
    deidentified: boolean;
    is_synthetic: boolean;
    results: EvidenceNodeASTResult[];
    evidence: Record<string, unknown>;
}

export interface EvidenceNodeSubmissionDraft {
    action: 'ingest_evidence_node_packet';
    request_id: string;
    contract_id: string;
    contract_version: string;
    adapter_key: string;
    mapping_version: string;
    mapping_hash: string;
    reference_key_id: string;
    source_transport: EvidenceNodeTransport;
    source_format: EvidenceNodeSourceFormat;
    source_ref_hash: string;
    accession_ref_hash: string;
    packet: EvidenceNodeCanonicalASTPacket;
    reconciliation: {
        case_id: string | null;
        patient_episode_id: string | null;
    };
}

export interface EvidenceNodeNormalizationResult {
    accepted: boolean;
    submissions: EvidenceNodeSubmissionDraft[];
    blockers: string[];
    warnings: string[];
    rejected_records: Array<{
        record_index: number;
        blockers: string[];
    }>;
    mapping_hash: string;
    source_record_digest: string;
    direct_identifier_paths_removed: string[];
}

interface ParsedRecord {
    accession_ref: string | null;
    isolate_ref: string | null;
    patient_ref: string | null;
    case_id: string | null;
    patient_episode_id: string | null;
    species: string | null;
    breed: string | null;
    production_class: string | null;
    specimen_type: string | null;
    anatomical_site: string | null;
    country_code: string | null;
    admin_area: string | null;
    organism_label: string | null;
    organism_key: string | null;
    organism_code_system: string | null;
    organism_code: string | null;
    culture_collected_at: string | null;
    observed_at: string | null;
    ast_method: string | null;
    interpretation_standard: string | null;
    interpretation_standard_version: string | null;
    qc_status: EvidenceNodeCanonicalASTPacket['qc_status'] | null;
    results: EvidenceNodeASTResult[];
}

const DEFAULT_FIELDS: Record<EvidenceNodeFieldKey, string> = {
    accession_ref: 'accession_id',
    isolate_ref: 'isolate_id',
    patient_ref: 'patient_id',
    case_id: 'case_id',
    patient_episode_id: 'patient_episode_id',
    species: 'species',
    breed: 'breed',
    production_class: 'production_class',
    specimen_type: 'specimen_type',
    anatomical_site: 'anatomical_site',
    country_code: 'country_code',
    admin_area: 'admin_area',
    organism_label: 'organism_label',
    organism_key: 'organism_key',
    organism_code_system: 'organism_code_system',
    organism_code: 'organism_code',
    culture_collected_at: 'culture_collected_at',
    observed_at: 'observed_at',
    ast_method: 'ast_method',
    interpretation_standard: 'interpretation_standard',
    interpretation_standard_version: 'interpretation_standard_version',
    qc_status: 'qc_status',
    antimicrobial_label: 'antimicrobial_label',
    antimicrobial_key: 'antimicrobial_key',
    antimicrobial_code_system: 'antimicrobial_code_system',
    antimicrobial_code: 'antimicrobial_code',
    drug_class: 'drug_class',
    measurement_type: 'measurement_type',
    mic_value: 'mic_value',
    mic_operator: 'mic_operator',
    mic_unit: 'mic_unit',
    zone_diameter_mm: 'zone_diameter_mm',
    qualitative_result: 'qualitative_result',
    interpretation: 'interpretation',
    breakpoint_value: 'breakpoint_value',
    breakpoint_unit: 'breakpoint_unit',
    breakpoint_basis: 'breakpoint_basis',
};

const DIRECT_IDENTIFIER_KEYS = new Set([
    'owner_name',
    'owner_email',
    'owner_phone',
    'owner_address',
    'client_name',
    'client_email',
    'client_phone',
    'patient_name',
    'animal_name',
    'microchip_number',
]);

export function normalizeEvidenceNodeSource(input: {
    mapping: EvidenceNodeMapping;
    source: EvidenceNodeRawSource;
    referenceKey: Buffer;
    referenceKeyId: string;
    connectorProbeEventId?: string;
}): EvidenceNodeNormalizationResult {
    const mappingBlockers = validateEvidenceNodeMapping(input.mapping);
    const mappingHash = hashEvidenceNodeMapping(input.mapping);
    if (input.referenceKey.length !== 32) {
        throw new Error('Evidence Node reference pseudonymization key must be exactly 32 bytes.');
    }
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(input.referenceKeyId)) {
        throw new Error('Evidence Node referenceKeyId must be a stable non-secret identifier.');
    }
    const sourceText = typeof input.source.content === 'string'
        ? input.source.content
        : stableStringify(input.source.content);
    const sourceRecordDigest = sha256(sourceText);
    const directIdentifierPathsRemoved = typeof input.source.content === 'string'
        ? []
        : findDirectIdentifierPaths(input.source.content);
    const warnings = new Set<string>();
    const blockers = new Set<string>(mappingBlockers);
    const connectorProbeEventId = input.connectorProbeEventId
        ?? input.mapping.defaults.connector_probe_event_id;
    if (!isUuid(connectorProbeEventId)) blockers.add('connector_probe_event_id_invalid');

    if (sourceText.length === 0) blockers.add('source_payload_empty');
    if (sourceText.length > 10 * 1024 * 1024) blockers.add('source_payload_exceeds_10mb');
    if (directIdentifierPathsRemoved.length > 0) {
        warnings.add('direct_identifiers_removed_at_evidence_node');
    }

    let records: ParsedRecord[] = [];
    try {
        if (input.source.format === 'rfc4180_csv') {
            records = parseCsvSource(sourceText, input.mapping);
        } else if (input.source.format === 'hl7_v2_oru_r01') {
            records = parseHl7Source(sourceText, input.mapping);
        } else if (input.source.format === 'fhir_r4_bundle') {
            records = parseFhirSource(parseJsonObject(sourceText), input.mapping);
        } else {
            records = parseJsonSource(parseJsonObject(sourceText), input.mapping);
        }
    } catch (error) {
        blockers.add(`source_parse_failed:${normalizeErrorCode(error)}`);
    }

    if (records.length === 0 && blockers.size === 0) blockers.add('no_ast_records_mapped');
    const submissions: EvidenceNodeSubmissionDraft[] = [];
    const rejectedRecords: EvidenceNodeNormalizationResult['rejected_records'] = [];
    records.forEach((record, index) => {
        const packetBlockers = validateParsedRecord(record, input.mapping);
        if (packetBlockers.length > 0) {
            rejectedRecords.push({ record_index: index, blockers: packetBlockers });
            return;
        }

        const observedAt = normalizeTimestamp(record.observed_at) ?? new Date().toISOString();
        const recordDigest = records.length === 1
            ? sourceRecordDigest
            : sha256(`${sourceRecordDigest}:${record.accession_ref ?? record.isolate_ref}:${index}`);
        const packet: EvidenceNodeCanonicalASTPacket = {
            schema_version: EVIDENCE_NODE_AST_SCHEMA,
            source_system: input.mapping.source_system,
            source_version: input.mapping.source_version,
            source_record_digest: recordDigest,
            isolate_ref: pseudonymizeReference(
                input.referenceKey,
                'isolate',
                record.isolate_ref ?? record.accession_ref!,
            ),
            patient_ref: record.patient_ref
                ? pseudonymizeReference(input.referenceKey, 'patient', record.patient_ref)
                : undefined,
            site_id: input.mapping.defaults.site_id,
            lab_site_id: input.mapping.defaults.lab_site_id,
            connector_probe_event_id: connectorProbeEventId
                ?? '00000000-0000-4000-8000-000000000000',
            species: mapCode(record.species ?? input.mapping.defaults.species!, input.mapping.code_maps?.species),
            breed: record.breed ?? input.mapping.defaults.breed,
            production_class: record.production_class ?? input.mapping.defaults.production_class,
            specimen_type: mapCode(record.specimen_type ?? input.mapping.defaults.specimen_type!, input.mapping.code_maps?.specimen),
            anatomical_site: record.anatomical_site ?? input.mapping.defaults.anatomical_site,
            country_code: (record.country_code ?? input.mapping.defaults.country_code)?.toUpperCase(),
            admin_area: record.admin_area ?? undefined,
            organism_label: mapCode(record.organism_label!, input.mapping.code_maps?.organism),
            organism_key: record.organism_key
                ?? mapCode(record.organism_label!, input.mapping.code_maps?.organism_keys),
            organism_code_system: record.organism_code_system ?? undefined,
            organism_code: record.organism_code ?? undefined,
            culture_collected_at: normalizeTimestamp(record.culture_collected_at) ?? undefined,
            observed_at: observedAt,
            ast_method: record.ast_method ?? input.mapping.defaults.ast_method,
            interpretation_standard: record.interpretation_standard
                ?? input.mapping.defaults.interpretation_standard,
            interpretation_standard_version: record.interpretation_standard_version
                ?? input.mapping.defaults.interpretation_standard_version,
            qc_status: record.qc_status ?? input.mapping.defaults.qc_status ?? 'not_reported',
            deidentified: input.mapping.defaults.deidentified ?? true,
            is_synthetic: input.mapping.defaults.is_synthetic ?? false,
            results: record.results,
            evidence: {
                evidence_node: {
                    schema: 'vetios.evidence-node.provenance.v1',
                    adapter_key: input.mapping.adapter_key,
                    mapping_version: input.mapping.mapping_version,
                    mapping_hash: mappingHash,
                    contract_id: input.mapping.contract_id,
                    contract_version: input.mapping.contract_version,
                    source_transport: input.source.transport,
                    source_format: input.source.format,
                    source_ref_hash: sha256(input.source.source_ref),
                    source_payload_hash: sourceRecordDigest,
                    direct_identifier_fields_removed: directIdentifierPathsRemoved.length,
                    source_references_pseudonymized: true,
                    reference_pseudonymization: 'hmac-sha256-v1',
                    reference_key_id: input.referenceKeyId,
                    raw_payload_stored_centrally: false,
                    breakpoints_computed_by_vetios: false,
                },
            },
        };
        submissions.push({
            action: 'ingest_evidence_node_packet',
            request_id: deterministicUuid(`${input.mapping.contract_id}:${recordDigest}:${mappingHash}`),
            contract_id: input.mapping.contract_id,
            contract_version: input.mapping.contract_version,
            adapter_key: input.mapping.adapter_key,
            mapping_version: input.mapping.mapping_version,
            mapping_hash: mappingHash,
            reference_key_id: input.referenceKeyId,
            source_transport: input.source.transport,
            source_format: input.source.format,
            source_ref_hash: sha256(input.source.source_ref),
            accession_ref_hash: pseudonymizeReference(
                input.referenceKey,
                'accession',
                record.accession_ref ?? record.isolate_ref!,
            ),
            packet,
            reconciliation: {
                case_id: normalizeUuid(record.case_id),
                patient_episode_id: normalizeUuid(record.patient_episode_id),
            },
        });
    });
    if (rejectedRecords.length > 0) warnings.add(`records_rejected:${rejectedRecords.length}`);
    if (records.length > 0 && submissions.length === 0 && blockers.size === 0) {
        blockers.add('no_valid_ast_records_mapped');
    }

    return {
        accepted: blockers.size === 0 && submissions.length > 0,
        submissions: blockers.size === 0 ? submissions : [],
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        rejected_records: rejectedRecords,
        mapping_hash: mappingHash,
        source_record_digest: sourceRecordDigest,
        direct_identifier_paths_removed: directIdentifierPathsRemoved,
    };
}

export function hashEvidenceNodeMapping(mapping: EvidenceNodeMapping): string {
    const { connector_probe_event_id: _transientProbe, ...stableDefaults } = mapping.defaults;
    return hashStable({ ...mapping, defaults: stableDefaults });
}

function pseudonymizeReference(key: Buffer, domain: 'accession' | 'isolate' | 'patient', value: string): string {
    return createHmac('sha256', key).update(`${domain}:`).update(value.trim()).digest('hex');
}

export function validateEvidenceNodeMapping(mapping: EvidenceNodeMapping): string[] {
    const blockers = new Set<string>();
    if (mapping.schema !== EVIDENCE_NODE_MAPPING_SCHEMA) blockers.add('mapping_schema_invalid');
    if (!mapping.adapter_key?.trim()) blockers.add('adapter_key_missing');
    if (!mapping.mapping_version?.trim()) blockers.add('mapping_version_missing');
    if (!isUuid(mapping.contract_id)) blockers.add('contract_id_invalid');
    if (!mapping.contract_version?.trim()) blockers.add('contract_version_missing');
    if (!mapping.source_system?.trim()) blockers.add('source_system_missing');
    if (!isUuid(mapping.defaults?.site_id)) blockers.add('site_id_invalid');
    if (!isUuid(mapping.defaults?.lab_site_id)) blockers.add('lab_site_id_invalid');
    if (!mapping.defaults?.ast_method?.trim()) blockers.add('ast_method_missing');
    if (!mapping.defaults?.interpretation_standard?.trim()) blockers.add('interpretation_standard_missing');
    if (!mapping.defaults?.interpretation_standard_version?.trim()) {
        blockers.add('interpretation_standard_version_missing');
    }
    if (mapping.defaults?.is_synthetic === true) blockers.add('synthetic_mapping_not_operational');
    return Array.from(blockers).sort();
}

export function parseRfc4180Csv(text: string, delimiter: ',' | ';' | '\t' = ','): Record<string, string>[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];
        if (char === '"' && quoted && next === '"') {
            cell += '"';
            index += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === delimiter && !quoted) {
            row.push(cell);
            cell = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && next === '\n') index += 1;
            row.push(cell);
            if (row.some((value) => value.trim())) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }
    if (quoted) throw new Error('csv_unclosed_quote');
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    const [header = [], ...body] = rows;
    const keys = header.map((value) => value.trim());
    if (keys.length === 0 || keys.some((key) => !key)) throw new Error('csv_header_invalid');
    return body.map((cells) => Object.fromEntries(
        keys.map((key, index) => [key, cells[index]?.trim() ?? '']),
    ));
}

function parseCsvSource(text: string, mapping: EvidenceNodeMapping): ParsedRecord[] {
    const rows = parseRfc4180Csv(text, mapping.csv?.delimiter ?? ',');
    const fields = resolvedFields(mapping);
    const grouped = new Map<string, Record<string, unknown>[]>();
    rows.forEach((row, index) => {
        const key = readText(row, fields.accession_ref)
            ?? readText(row, fields.isolate_ref)
            ?? `row:${index}`;
        const values = grouped.get(key) ?? [];
        values.push(row);
        grouped.set(key, values);
    });
    return Array.from(grouped.values()).map((group) => {
        const first = group[0] ?? {};
        return {
            ...parseRecordFacts(first, mapping),
            results: group.map((row) => parseResult(row, mapping)).filter(isDefined),
        };
    });
}

function parseJsonSource(value: Record<string, unknown>, mapping: EvidenceNodeMapping): ParsedRecord[] {
    const records = Array.isArray(value.records)
        ? value.records.filter(isRecord)
        : [value];
    return records.map((record) => {
        const results = Array.isArray(record.results)
            ? record.results.filter(isRecord).map((row) => parseResult(row, mapping)).filter(isDefined)
            : [parseResult(record, mapping)].filter(isDefined);
        return { ...parseRecordFacts(record, mapping), results };
    });
}

function parseHl7Source(text: string, mapping: EvidenceNodeMapping): ParsedRecord[] {
    const messages = text
        .replace(/\u000b/g, '')
        .replace(/\u001c\r?/g, '')
        .split(/(?=MSH[|^~\\&])/)
        .map((message) => message.trim())
        .filter(Boolean);
    return messages.map((message) => {
        const segments = message.split(/\r\n|\n|\r/).filter(Boolean).map((line) => line.split('|'));
        const find = (name: string) => segments.find((segment) => segment[0] === name);
        const all = (name: string) => segments.filter((segment) => segment[0] === name);
        const msh = find('MSH');
        if (!msh || !String(msh[8] ?? '').includes('ORU')) throw new Error('hl7_message_not_oru');
        const pid = find('PID');
        const spm = find('SPM');
        const obr = find('OBR');
        const obx = all('OBX');
        const organismCodes = new Set((mapping.hl7?.organism_observation_codes ?? []).map(normalizeCode));
        let organismLabel: string | null = null;
        let organismCode: string | null = null;
        let organismCodeSystem: string | null = null;
        const results: EvidenceNodeASTResult[] = [];
        for (const segment of obx) {
            const identifier = parseHl7Coded(segment[3]);
            const code = normalizeCode(identifier.code ?? identifier.text);
            if (organismCodes.has(code)) {
                const organism = parseHl7Coded(segment[5]);
                organismLabel = organism.text ?? organism.code;
                organismCode = organism.code;
                organismCodeSystem = organism.system;
                continue;
            }
            const definition = lookupAntimicrobial(code, mapping.hl7?.antimicrobial_observation_codes, mapping);
            if (!definition) continue;
            const value = String(segment[5] ?? '').trim();
            const units = parseHl7Coded(segment[6]).text
                ?? (String(segment[6] ?? '').trim() || null);
            const interpretationRaw = String(segment[8] ?? value).trim();
            results.push(buildObservedResult({
                definition,
                value,
                units,
                interpretationRaw,
                codeSystem: identifier.system,
                code: identifier.code,
            }, mapping));
        }
        const species = parseHl7Coded(pid?.[35]).text ?? parseHl7Coded(pid?.[35]).code;
        const specimen = parseHl7Coded(spm?.[4]);
        const accession = parseHl7Coded(obr?.[3]).code ?? String(obr?.[3] ?? msh[9] ?? '').trim();
        return {
            accession_ref: accession || null,
            isolate_ref: parseHl7Coded(spm?.[2]).code ?? (accession || null),
            patient_ref: parseHl7Coded(pid?.[3]).code,
            case_id: null,
            patient_episode_id: null,
            species,
            breed: null,
            production_class: null,
            specimen_type: specimen.text ?? specimen.code,
            anatomical_site: null,
            country_code: null,
            admin_area: null,
            organism_label: organismLabel,
            organism_key: null,
            organism_code_system: organismCodeSystem,
            organism_code: organismCode,
            culture_collected_at: parseHl7Timestamp(spm?.[17] ?? obr?.[7]),
            observed_at: parseHl7Timestamp(obr?.[22] ?? obr?.[14] ?? obr?.[7] ?? msh[6]),
            ast_method: null,
            interpretation_standard: null,
            interpretation_standard_version: null,
            qc_status: String(obr?.[25] ?? '').toUpperCase() === 'F' ? 'passed' : 'not_reported',
            results,
        };
    });
}

function parseFhirSource(bundle: Record<string, unknown>, mapping: EvidenceNodeMapping): ParsedRecord[] {
    if (bundle.resourceType !== 'Bundle') throw new Error('fhir_bundle_required');
    const entries = Array.isArray(bundle.entry) ? bundle.entry.filter(isRecord) : [];
    const resources = entries.map((entry) => entry.resource).filter(isRecord);
    const byRef = new Map(resources.map((resource) => [
        `${String(resource.resourceType ?? '')}/${String(resource.id ?? '')}`,
        resource,
    ]));
    const reports = resources.filter((resource) => resource.resourceType === 'DiagnosticReport');
    return reports.map((report) => {
        const patient = resolveFhirReference(report.subject, byRef);
        const specimen = resolveFhirReference(
            Array.isArray(report.specimen) ? report.specimen[0] : report.specimen,
            byRef,
        );
        const observations = (Array.isArray(report.result) ? report.result : [])
            .map((reference) => resolveFhirReference(reference, byRef))
            .filter(isRecord);
        const organismCodes = new Set((mapping.fhir?.organism_observation_codes ?? []).map(normalizeCode));
        let organismLabel: string | null = null;
        let organismCode: string | null = null;
        let organismCodeSystem: string | null = null;
        const results: EvidenceNodeASTResult[] = [];
        for (const observation of observations) {
            const identifier = readFhirCodeable(observation.code);
            const code = normalizeCode(identifier.code ?? identifier.text);
            if (organismCodes.has(code)) {
                const organism = readFhirObservationValue(observation);
                organismLabel = organism.text ?? organism.code ?? organism.value;
                organismCode = organism.code;
                organismCodeSystem = organism.system;
                continue;
            }
            const definition = lookupAntimicrobial(code, mapping.fhir?.antimicrobial_observation_codes, mapping);
            if (!definition) continue;
            const observed = readFhirObservationValue(observation);
            const interpretation = readFhirCodeable(
                Array.isArray(observation.interpretation) ? observation.interpretation[0] : observation.interpretation,
            );
            results.push(buildObservedResult({
                definition,
                value: observed.value ?? observed.code ?? observed.text ?? '',
                units: observed.unit,
                interpretationRaw: interpretation.code ?? interpretation.text ?? observed.code ?? '',
                codeSystem: identifier.system,
                code: identifier.code,
            }, mapping));
        }
        const animal = readFhirAnimal(patient);
        const accession = readFhirIdentifier(report.identifier)
            ?? String(report.id ?? '').trim();
        const specimenCode = readFhirCodeable(specimen?.type);
        const organismFromConclusion = readFhirCodeable(
            Array.isArray(report.conclusionCode) ? report.conclusionCode[0] : report.conclusionCode,
        );
        return {
            accession_ref: accession || null,
            isolate_ref: readFhirIdentifier(specimen?.identifier)
                ?? (String(specimen?.id ?? accession).trim() || null),
            patient_ref: readFhirIdentifier(patient?.identifier)
                ?? (String(patient?.id ?? '').trim() || null),
            case_id: null,
            patient_episode_id: null,
            species: animal.species,
            breed: animal.breed,
            production_class: null,
            specimen_type: specimenCode.text ?? specimenCode.code,
            anatomical_site: readFhirCodeable(specimen?.collection && isRecord(specimen.collection)
                ? specimen.collection.bodySite
                : null).text,
            country_code: null,
            admin_area: null,
            organism_label: organismLabel ?? organismFromConclusion.text ?? organismFromConclusion.code,
            organism_key: null,
            organism_code_system: organismCodeSystem ?? organismFromConclusion.system,
            organism_code: organismCode ?? organismFromConclusion.code,
            culture_collected_at: readFhirDate(specimen?.collection && isRecord(specimen.collection)
                ? specimen.collection.collectedDateTime
                : null),
            observed_at: readFhirDate(report.effectiveDateTime ?? report.issued),
            ast_method: null,
            interpretation_standard: null,
            interpretation_standard_version: null,
            qc_status: report.status === 'final' ? 'passed' : 'not_reported',
            results,
        };
    });
}

function parseRecordFacts(record: Record<string, unknown>, mapping: EvidenceNodeMapping): Omit<ParsedRecord, 'results'> {
    const fields = resolvedFields(mapping);
    const text = (key: EvidenceNodeFieldKey) => readText(record, fields[key]);
    return {
        accession_ref: text('accession_ref'),
        isolate_ref: text('isolate_ref'),
        patient_ref: text('patient_ref'),
        case_id: text('case_id'),
        patient_episode_id: text('patient_episode_id'),
        species: text('species'),
        breed: text('breed'),
        production_class: text('production_class'),
        specimen_type: text('specimen_type'),
        anatomical_site: text('anatomical_site'),
        country_code: text('country_code'),
        admin_area: text('admin_area'),
        organism_label: text('organism_label'),
        organism_key: text('organism_key'),
        organism_code_system: text('organism_code_system'),
        organism_code: text('organism_code'),
        culture_collected_at: text('culture_collected_at'),
        observed_at: text('observed_at'),
        ast_method: text('ast_method'),
        interpretation_standard: text('interpretation_standard'),
        interpretation_standard_version: text('interpretation_standard_version'),
        qc_status: normalizeQcStatus(text('qc_status')),
    };
}

function parseResult(record: Record<string, unknown>, mapping: EvidenceNodeMapping): EvidenceNodeASTResult | null {
    const fields = resolvedFields(mapping);
    const text = (key: EvidenceNodeFieldKey) => readText(record, fields[key]);
    const antimicrobialCode = text('antimicrobial_code');
    const rawLabel = text('antimicrobial_label') ?? antimicrobialCode;
    if (!rawLabel) return null;
    const definition = lookupAntimicrobial(
        normalizeCode(antimicrobialCode ?? rawLabel),
        undefined,
        mapping,
    ) ?? { label: rawLabel };
    const measurementType = normalizeMeasurementType(text('measurement_type'), {
        mic: readNumber(record, fields.mic_value),
        zone: readNumber(record, fields.zone_diameter_mm),
    });
    return compact({
        antimicrobial_label: definition.label,
        antimicrobial_key: text('antimicrobial_key') ?? definition.key ?? normalizeLabel(definition.label),
        antimicrobial_code_system: text('antimicrobial_code_system') ?? definition.code_system,
        antimicrobial_code: antimicrobialCode ?? definition.code,
        drug_class: text('drug_class') ?? definition.drug_class,
        measurement_type: measurementType,
        mic_value: readNumber(record, fields.mic_value),
        mic_operator: normalizeMicOperator(text('mic_operator')),
        mic_unit: text('mic_unit'),
        zone_diameter_mm: readNumber(record, fields.zone_diameter_mm),
        qualitative_result: text('qualitative_result'),
        interpretation: mapInterpretation(text('interpretation'), mapping),
        breakpoint_value: readNumber(record, fields.breakpoint_value),
        breakpoint_unit: text('breakpoint_unit'),
        breakpoint_basis: text('breakpoint_basis'),
        evidence: {
            source_interpretation_preserved: true,
            breakpoint_computed_by_vetios: false,
        },
    }) as EvidenceNodeASTResult;
}

function buildObservedResult(input: {
    definition: EvidenceNodeAntimicrobialDefinition;
    value: string;
    units: string | null;
    interpretationRaw: string;
    codeSystem: string | null;
    code: string | null;
}, mapping: EvidenceNodeMapping): EvidenceNodeASTResult {
    const numeric = parseNumericObservation(input.value);
    const measurementType = normalizeMeasurementType(null, {
        mic: input.units && /(?:ug|mcg|mg)\/?m?l/i.test(input.units) ? numeric.value : null,
        zone: input.units && /^mm$/i.test(input.units) ? numeric.value : null,
    });
    return compact({
        antimicrobial_label: input.definition.label,
        antimicrobial_key: input.definition.key ?? normalizeLabel(input.definition.label),
        antimicrobial_code_system: input.definition.code_system ?? input.codeSystem,
        antimicrobial_code: input.definition.code ?? input.code,
        drug_class: input.definition.drug_class,
        measurement_type: measurementType,
        mic_value: measurementType === 'mic' ? numeric.value : undefined,
        mic_operator: measurementType === 'mic' ? numeric.operator : undefined,
        mic_unit: measurementType === 'mic' ? input.units ?? undefined : undefined,
        zone_diameter_mm: measurementType === 'disk_diffusion' ? numeric.value : undefined,
        qualitative_result: measurementType === 'qualitative' ? input.value : undefined,
        interpretation: mapInterpretation(input.interpretationRaw, mapping),
        evidence: {
            source_interpretation_preserved: true,
            breakpoint_computed_by_vetios: false,
        },
    }) as EvidenceNodeASTResult;
}

function validateParsedRecord(record: ParsedRecord, mapping: EvidenceNodeMapping): string[] {
    const blockers = new Set<string>();
    if (!record.accession_ref && !record.isolate_ref) blockers.add('accession_or_isolate_ref_missing');
    if (!(record.species ?? mapping.defaults.species)) blockers.add('species_missing');
    if (!(record.specimen_type ?? mapping.defaults.specimen_type)) blockers.add('specimen_type_missing');
    if (!record.organism_label) blockers.add('organism_missing');
    if (!normalizeTimestamp(record.observed_at)) blockers.add('observed_at_missing_or_invalid');
    if (record.results.length === 0) blockers.add('ast_results_missing');
    record.results.forEach((result, index) => {
        if (!result.antimicrobial_label) blockers.add(`result_${index}:antimicrobial_missing`);
        if (result.measurement_type === 'mic' && (result.mic_value == null || !result.mic_unit)) {
            blockers.add(`result_${index}:mic_measurement_incomplete`);
        }
        if (result.measurement_type === 'disk_diffusion' && result.zone_diameter_mm == null) {
            blockers.add(`result_${index}:zone_measurement_missing`);
        }
        if (result.measurement_type === 'qualitative' && !result.qualitative_result) {
            blockers.add(`result_${index}:qualitative_result_missing`);
        }
    });
    return Array.from(blockers).sort();
}

function resolvedFields(mapping: EvidenceNodeMapping): Record<EvidenceNodeFieldKey, string> {
    return { ...DEFAULT_FIELDS, ...(mapping.fields ?? {}) };
}

function lookupAntimicrobial(
    code: string,
    local: Record<string, EvidenceNodeAntimicrobialDefinition> | undefined,
    mapping: EvidenceNodeMapping,
): EvidenceNodeAntimicrobialDefinition | null {
    const candidates = [local, mapping.code_maps?.antimicrobials];
    for (const source of candidates) {
        if (!source) continue;
        for (const [raw, definition] of Object.entries(source)) {
            if (normalizeCode(raw) === code) return definition;
        }
    }
    return null;
}

function mapInterpretation(value: string | null, mapping: EvidenceNodeMapping): EvidenceNodeASTInterpretation {
    const normalized = normalizeCode(value);
    for (const [raw, mapped] of Object.entries(mapping.code_maps?.interpretation ?? {})) {
        if (normalizeCode(raw) === normalized) return mapped;
    }
    if (['S', 'SUSCEPTIBLE', 'SENSITIVE'].includes(normalized)) return 'S';
    if (['I', 'INTERMEDIATE'].includes(normalized)) return 'I';
    if (['R', 'RESISTANT'].includes(normalized)) return 'R';
    if (['SDD', 'SUSCEPTIBLE DOSE DEPENDENT'].includes(normalized)) return 'SDD';
    if (['NS', 'NONSUSCEPTIBLE', 'NON SUSCEPTIBLE'].includes(normalized)) return 'NS';
    if (['IE', 'INSUFFICIENT EVIDENCE'].includes(normalized)) return 'IE';
    return 'UNKNOWN';
}

function mapCode(value: string, mapping: Record<string, string> | undefined): string {
    const normalized = normalizeCode(value);
    for (const [raw, mapped] of Object.entries(mapping ?? {})) {
        if (normalizeCode(raw) === normalized) return mapped;
    }
    return value.trim();
}

function parseHl7Coded(value: unknown): { code: string | null; text: string | null; system: string | null } {
    const components = String(value ?? '').split('^');
    return {
        code: normalizeOptionalText(components[0]),
        text: normalizeOptionalText(components[1]),
        system: normalizeOptionalText(components[2]),
    };
}

function parseHl7Timestamp(value: unknown): string | null {
    const text = normalizeOptionalText(value);
    if (!text) return null;
    const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (!match) return normalizeTimestamp(text);
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
    return normalizeTimestamp(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

function resolveFhirReference(value: unknown, resources: Map<string, Record<string, unknown>>) {
    const reference = isRecord(value) ? normalizeOptionalText(value.reference) : null;
    return reference ? resources.get(reference) ?? null : null;
}

function readFhirIdentifier(value: unknown): string | null {
    const identifiers = Array.isArray(value) ? value.filter(isRecord) : isRecord(value) ? [value] : [];
    return identifiers.map((identifier) => normalizeOptionalText(identifier.value)).find(Boolean) ?? null;
}

function readFhirCodeable(value: unknown): { code: string | null; text: string | null; system: string | null } {
    if (!isRecord(value)) return { code: null, text: null, system: null };
    const coding = Array.isArray(value.coding) ? value.coding.find(isRecord) : null;
    return {
        code: normalizeOptionalText(coding?.code),
        text: normalizeOptionalText(coding?.display) ?? normalizeOptionalText(value.text),
        system: normalizeOptionalText(coding?.system),
    };
}

function readFhirObservationValue(observation: Record<string, unknown>) {
    if (isRecord(observation.valueQuantity)) {
        return {
            value: observation.valueQuantity.value == null ? null : String(observation.valueQuantity.value),
            unit: normalizeOptionalText(observation.valueQuantity.unit) ?? normalizeOptionalText(observation.valueQuantity.code),
            ...readFhirCodeable(null),
        };
    }
    if (isRecord(observation.valueCodeableConcept)) {
        return { ...readFhirCodeable(observation.valueCodeableConcept), value: null, unit: null };
    }
    return {
        value: normalizeOptionalText(observation.valueString),
        unit: null,
        code: null,
        text: null,
        system: null,
    };
}

function readFhirAnimal(patient: Record<string, unknown> | null) {
    const extensions = Array.isArray(patient?.extension) ? patient!.extension.filter(isRecord) : [];
    const animal = extensions.find((extension) => extension.url === 'http://hl7.org/fhir/StructureDefinition/patient-animal');
    const nested = Array.isArray(animal?.extension) ? animal!.extension.filter(isRecord) : [];
    return {
        species: readFhirCodeable(nested.find((entry) => entry.url === 'species')?.valueCodeableConcept).text,
        breed: readFhirCodeable(nested.find((entry) => entry.url === 'breed')?.valueCodeableConcept).text,
    };
}

function readFhirDate(value: unknown): string | null {
    return normalizeTimestamp(normalizeOptionalText(value));
}

function parseNumericObservation(value: string) {
    const match = value.trim().match(/^(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)/);
    return {
        operator: normalizeMicOperator(match?.[1] ?? null),
        value: match ? Number(match[2]) : undefined,
    };
}

function normalizeMeasurementType(
    value: string | null,
    evidence: { mic: number | null | undefined; zone: number | null | undefined },
): EvidenceNodeASTResult['measurement_type'] {
    const normalized = normalizeCode(value);
    if (['MIC', 'MINIMUM INHIBITORY CONCENTRATION'].includes(normalized) || evidence.mic != null) return 'mic';
    if (['DISK', 'DISK DIFFUSION', 'ZONE'].includes(normalized) || evidence.zone != null) return 'disk_diffusion';
    return 'qualitative';
}

function normalizeMicOperator(value: string | null): EvidenceNodeASTResult['mic_operator'] | undefined {
    return value === '<' || value === '<=' || value === '=' || value === '>=' || value === '>' ? value : undefined;
}

function normalizeQcStatus(value: string | null): EvidenceNodeCanonicalASTPacket['qc_status'] | null {
    const normalized = value?.trim().toLowerCase();
    return normalized === 'passed' || normalized === 'warning' || normalized === 'failed' || normalized === 'not_reported'
        ? normalized
        : null;
}

function readText(record: Record<string, unknown>, path: string): string | null {
    const value = readPath(record, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function readNumber(record: Record<string, unknown>, path: string): number | undefined {
    const value = readPath(record, path);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function readPath(record: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, record);
}

function findDirectIdentifierPaths(value: unknown, prefix = ''): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((entry, index) => findDirectIdentifierPaths(entry, `${prefix}[${index}]`));
    }
    if (!isRecord(value)) return [];
    return Object.entries(value).flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return [
            ...(DIRECT_IDENTIFIER_KEYS.has(key.toLowerCase()) ? [path] : []),
            ...findDirectIdentifierPaths(child, path),
        ];
    });
}

function parseJsonObject(text: string): Record<string, unknown> {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) throw new Error('json_object_required');
    return value;
}

function normalizeTimestamp(value: string | null | undefined): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCode(value: unknown): string {
    return String(value ?? '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toUpperCase();
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeUuid(value: string | null): string | null {
    return value && isUuid(value) ? value.toLowerCase() : null;
}

function isUuid(value: unknown): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | null | undefined): value is T {
    return value != null;
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function normalizeErrorCode(error: unknown): string {
    return (error instanceof Error ? error.message : 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 120) || 'unknown';
}

function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function hashStable(value: unknown): string {
    return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

function deterministicUuid(value: string): string {
    const hash = sha256(value);
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `4${hash.slice(13, 16)}`,
        `8${hash.slice(17, 20)}`,
        hash.slice(20, 32),
    ].join('-');
}
