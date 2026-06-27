import { createHash } from 'crypto';
import {
    normalizePassiveConnectorPayload,
    type PassiveConnectorNormalizationResult,
    type PassiveConnectorType,
} from '@/lib/outcomeNetwork/passiveConnectors';
import {
    resolvePassiveConnectorWorkflow,
    type PimsWorkflowNormalizationResult,
} from '@/lib/outcomeNetwork/pimsWorkflowAdapter';

export type WorkflowConnectorEvidenceStatus =
    | 'blocked'
    | 'insufficient_context'
    | 'workflow_signal_ready'
    | 'diagnostic_signal_ready'
    | 'outcome_signal_ready';

export type WorkflowConnectorIngestionProfile =
    | 'pims_history_sync'
    | 'appointment_follow_up_sync'
    | 'lab_result_import'
    | 'pacs_report_import'
    | 'referral_sync'
    | 'prescription_sync';

export type WorkflowConnectorSourceStandard =
    | 'vendor_webhook'
    | 'hl7_v2_oru'
    | 'fhir_r4'
    | 'dicomweb'
    | 'manual_file_drop';

export type WorkflowIntegrationMoatStatus = 'blocked' | 'foundation' | 'operating';

export type WorkflowIntegrationCapability =
    | 'pims_workflow_sync'
    | 'lab_result_import'
    | 'pacs_report_import'
    | 'follow_up_automation'
    | 'treatment_refill_signal'
    | 'specialist_referral_signal';

export type WorkflowIntegrationCapabilityStatus = 'ready' | 'thin' | 'missing' | 'blocked';

export interface WorkflowConnectorEvidenceInput {
    connectorType?: PassiveConnectorType | null;
    vendorName?: string | null;
    vendorAccountRef?: string | null;
    vendorEventType?: string | null;
    patientId?: string | null;
    encounterId?: string | null;
    caseId?: string | null;
    episodeId?: string | null;
    observedAt?: string | null;
    payload: Record<string, unknown>;
}

export interface WorkflowConnectorEvidencePacket {
    schema_version: 'workflow-connector-evidence-v1';
    evidence_status: WorkflowConnectorEvidenceStatus;
    moat_posture: 'interface_only' | 'provenance_foundation' | 'outcome_linkage_ready' | 'blocked_phi_risk';
    readiness_score: number;
    connector: {
        connector_type: PassiveConnectorType;
        ingestion_profile: WorkflowConnectorIngestionProfile;
        source_standard: WorkflowConnectorSourceStandard;
        vendor_name: string | null;
        vendor_account_ref_hash: string | null;
        workflow_event_type: string | null;
        normalized_by: PimsWorkflowNormalizationResult['normalizedBy'];
    };
    signal: Pick<
        PassiveConnectorNormalizationResult,
        'signalType'
        | 'signalSubtype'
        | 'observedAt'
        | 'confidence'
        | 'dedupeKey'
        | 'primaryConditionClass'
        | 'episodeStatus'
        | 'outcomeState'
        | 'resolvedAt'
    >;
    coverage: {
        source_identity: boolean;
        patient_reference: boolean;
        clinical_time: boolean;
        diagnostic_observation: boolean;
        workflow_status: boolean;
        outcome_signal: boolean;
        provenance_hash: boolean;
        deidentified: boolean;
        standard_aligned: boolean;
    };
    data_minimization: {
        raw_payload_stored: false;
        direct_phi_detected: boolean;
        detected_phi_paths: string[];
        free_text_fields_hashed: string[];
        safe_fact_keys: string[];
    };
    safe_facts: Record<string, unknown>;
    provenance: {
        source_payload_hash: string;
        source_record_digest: string;
        external_event_hash: string | null;
        patient_ref_hash: string | null;
        encounter_ref_hash: string | null;
        case_ref_hash: string | null;
        episode_ref_hash: string | null;
        text_field_hashes: Record<string, string>;
    };
    blockers: string[];
    warnings: string[];
}

export interface WorkflowIntegrationCapabilityCoverage {
    capability: WorkflowIntegrationCapability;
    required: boolean;
    status: WorkflowIntegrationCapabilityStatus;
    evidence_packets: number;
    ready_packets: number;
    latest_observed_at: string | null;
    source_standards: WorkflowConnectorSourceStandard[];
    connector_types: PassiveConnectorType[];
    blockers: string[];
    warnings: string[];
}

export interface WorkflowIntegrationReadinessSnapshot {
    schema_version: 'workflow-integration-readiness-v1';
    generated_at: string;
    moat_status: WorkflowIntegrationMoatStatus;
    readiness_score: number;
    packets_evaluated: number;
    ready_packets: number;
    blocked_packets: number;
    outcome_linked_packets: number;
    diagnostic_packets: number;
    required_capabilities: number;
    required_capabilities_ready: number;
    capability_coverage: WorkflowIntegrationCapabilityCoverage[];
    source_standard_counts: Record<WorkflowConnectorSourceStandard, number>;
    blockers: string[];
    warnings: string[];
    privacy_contract: string[];
}

const SAFE_FACT_KEYS = [
    'connector_type',
    'vendor_name',
    'analyte',
    'value',
    'units',
    'reference_range',
    'abnormal',
    'critical',
    'abnormal_flag',
    'result_status',
    'modality',
    'study_type',
    'image_count',
    'series_count',
    'body_region',
    'medication',
    'refill_status',
    'days_remaining',
    'overdue',
    'adherent',
    'recheck_status',
    'scheduled_for',
    'completed',
    'missed',
    'resolved',
    'urgency',
    'accepted',
    'primary_condition_class',
] as const;

const FREE_TEXT_KEYS = [
    'owner_notes',
    'notes',
    'summary',
    'memo',
    'impression',
    'findings',
    'report_text',
    'report_body',
    'reason',
    'referral_reason',
    'conclusion',
] as const;

const DIRECT_PHI_KEY_PATTERNS = [
    /owner.*name/i,
    /client.*name/i,
    /owner.*email/i,
    /client.*email/i,
    /email/i,
    /phone/i,
    /address/i,
    /street/i,
    /zip/i,
    /postal/i,
    /patient.*name/i,
    /pet.*name/i,
    /animal.*name/i,
    /microchip/i,
    /rabies.*tag/i,
    /license.*number/i,
] as const;

const EMAIL_VALUE_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_VALUE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/;

const SOURCE_STANDARDS: WorkflowConnectorSourceStandard[] = [
    'vendor_webhook',
    'hl7_v2_oru',
    'fhir_r4',
    'dicomweb',
    'manual_file_drop',
];

const CAPABILITY_DEFINITIONS: Array<{
    capability: WorkflowIntegrationCapability;
    required: boolean;
    matches: (packet: WorkflowConnectorEvidencePacket) => boolean;
    ready: (packet: WorkflowConnectorEvidencePacket) => boolean;
}> = [
    {
        capability: 'pims_workflow_sync',
        required: true,
        matches: (packet) => packet.connector.normalized_by === 'pims_workflow_adapter',
        ready: (packet) => isPacketReady(packet) && packet.coverage.workflow_status,
    },
    {
        capability: 'lab_result_import',
        required: true,
        matches: (packet) => packet.connector.ingestion_profile === 'lab_result_import',
        ready: (packet) => isPacketReady(packet) && packet.coverage.diagnostic_observation,
    },
    {
        capability: 'pacs_report_import',
        required: true,
        matches: (packet) => packet.connector.ingestion_profile === 'pacs_report_import',
        ready: (packet) => isPacketReady(packet) && packet.coverage.diagnostic_observation,
    },
    {
        capability: 'follow_up_automation',
        required: true,
        matches: (packet) => packet.connector.ingestion_profile === 'appointment_follow_up_sync',
        ready: (packet) => isPacketReady(packet) && (packet.coverage.outcome_signal || packet.coverage.workflow_status),
    },
    {
        capability: 'treatment_refill_signal',
        required: false,
        matches: (packet) => packet.connector.ingestion_profile === 'prescription_sync',
        ready: (packet) => isPacketReady(packet) && packet.coverage.workflow_status,
    },
    {
        capability: 'specialist_referral_signal',
        required: false,
        matches: (packet) => packet.connector.ingestion_profile === 'referral_sync',
        ready: (packet) => isPacketReady(packet) && packet.coverage.workflow_status,
    },
];

export function buildWorkflowConnectorEvidence(
    input: WorkflowConnectorEvidenceInput,
): WorkflowConnectorEvidencePacket {
    const workflow = resolvePassiveConnectorWorkflow({
        connectorType: input.connectorType ?? null,
        vendorName: input.vendorName ?? null,
        vendorEventType: input.vendorEventType ?? null,
        payload: input.payload,
    });
    const normalized = normalizePassiveConnectorPayload({
        connectorType: workflow.connectorType,
        vendorName: input.vendorName ?? null,
        patientId: input.patientId ?? null,
        observedAt: input.observedAt ?? null,
        payload: workflow.payload,
    });
    const phiPaths = findDirectPhiPaths(input.payload);
    const textFieldHashes = hashFreeTextFields(workflow.payload);
    const safeFacts = buildSafeFacts(normalized.normalizedFacts, workflow.payload);
    const sourcePayloadHash = hashJson(input.payload);
    const sourceRecordDigest = hashJson({
        connector_type: workflow.connectorType,
        vendor_name: normalizeOptionalText(input.vendorName),
        workflow_event_type: workflow.vendorEventType,
        observed_at: normalized.observedAt,
        dedupe_key: normalized.dedupeKey,
        safe_facts: safeFacts,
        text_field_hashes: textFieldHashes,
    });
    const blockers = new Set<string>();
    const warnings = new Set<string>(workflow.warnings);

    if (phiPaths.length > 0) blockers.add('direct_phi_detected_in_connector_payload');
    if (!input.patientId) warnings.add('patient_reference_missing_or_external_only');
    if (Object.keys(textFieldHashes).length > 0) warnings.add('free_text_fields_hashed_not_stored');
    if (!hasSourceIdentity(input, workflow)) warnings.add('connector_source_identity_incomplete');
    if (!normalized.primaryConditionClass) warnings.add('primary_condition_class_missing');

    const coverage = buildCoverage({
        input,
        workflow,
        normalized,
        sourceRecordDigest,
        phiPaths,
    });
    const readinessScore = scoreCoverage(coverage, blockers.size);
    const evidenceStatus = resolveEvidenceStatus(workflow.connectorType, normalized, coverage, blockers.size);

    return {
        schema_version: 'workflow-connector-evidence-v1',
        evidence_status: evidenceStatus,
        moat_posture: resolveMoatPosture(evidenceStatus, readinessScore, blockers.size),
        readiness_score: readinessScore,
        connector: {
            connector_type: workflow.connectorType,
            ingestion_profile: resolveIngestionProfile(workflow.connectorType),
            source_standard: inferSourceStandard(input.payload, workflow),
            vendor_name: normalizeOptionalText(input.vendorName),
            vendor_account_ref_hash: hashOptional(input.vendorAccountRef),
            workflow_event_type: workflow.vendorEventType,
            normalized_by: workflow.normalizedBy,
        },
        signal: {
            signalType: normalized.signalType,
            signalSubtype: normalized.signalSubtype,
            observedAt: normalized.observedAt,
            confidence: normalized.confidence,
            dedupeKey: normalized.dedupeKey,
            primaryConditionClass: normalized.primaryConditionClass,
            episodeStatus: normalized.episodeStatus,
            outcomeState: normalized.outcomeState,
            resolvedAt: normalized.resolvedAt,
        },
        coverage,
        data_minimization: {
            raw_payload_stored: false,
            direct_phi_detected: phiPaths.length > 0,
            detected_phi_paths: phiPaths,
            free_text_fields_hashed: Object.keys(textFieldHashes).sort(),
            safe_fact_keys: Object.keys(safeFacts).sort(),
        },
        safe_facts: safeFacts,
        provenance: {
            source_payload_hash: sourcePayloadHash,
            source_record_digest: sourceRecordDigest,
            external_event_hash: hashOptional(readText(input.payload, [
                'external_id',
                'event_id',
                'accession_id',
                'appointment_id',
                'report_id',
                'id',
            ])),
            patient_ref_hash: hashOptional(input.patientId),
            encounter_ref_hash: hashOptional(input.encounterId),
            case_ref_hash: hashOptional(input.caseId),
            episode_ref_hash: hashOptional(input.episodeId),
            text_field_hashes: textFieldHashes,
        },
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
    };
}

export function buildWorkflowIntegrationReadiness(input: {
    packets: WorkflowConnectorEvidencePacket[];
    now?: string;
}): WorkflowIntegrationReadinessSnapshot {
    const now = input.now ?? new Date().toISOString();
    const packets = input.packets;
    const requiredCapabilities = CAPABILITY_DEFINITIONS.filter((definition) => definition.required);
    const capabilityCoverage = CAPABILITY_DEFINITIONS.map((definition) =>
        buildCapabilityCoverage(definition, packets),
    );
    const requiredReady = capabilityCoverage.filter((coverage) => coverage.required && coverage.status === 'ready').length;
    const readyPackets = packets.filter(isPacketReady).length;
    const blockedPackets = packets.filter((packet) => packet.evidence_status === 'blocked').length;
    const outcomeLinkedPackets = packets.filter((packet) => packet.evidence_status === 'outcome_signal_ready').length;
    const diagnosticPackets = packets.filter((packet) => packet.evidence_status === 'diagnostic_signal_ready').length;
    const blockers = buildWorkflowIntegrationBlockers({
        packets,
        capabilityCoverage,
        blockedPackets,
    });
    const warnings = buildWorkflowIntegrationWarnings(capabilityCoverage);
    const readinessScore = scoreWorkflowIntegrationReadiness({
        requiredReady,
        requiredCapabilities: requiredCapabilities.length,
        packets,
        outcomeLinkedPackets,
        blockedPackets,
    });

    return {
        schema_version: 'workflow-integration-readiness-v1',
        generated_at: now,
        moat_status: resolveWorkflowIntegrationMoatStatus({
            packets,
            blockers,
            requiredReady,
            requiredCapabilities: requiredCapabilities.length,
            readinessScore,
        }),
        readiness_score: readinessScore,
        packets_evaluated: packets.length,
        ready_packets: readyPackets,
        blocked_packets: blockedPackets,
        outcome_linked_packets: outcomeLinkedPackets,
        diagnostic_packets: diagnosticPackets,
        required_capabilities: requiredCapabilities.length,
        required_capabilities_ready: requiredReady,
        capability_coverage: capabilityCoverage,
        source_standard_counts: countSourceStandards(packets),
        blockers,
        warnings,
        privacy_contract: [
            'Workflow integration readiness is derived from normalized evidence packets, not raw vendor payload retention.',
            'PIMS, lab, PACS, and follow-up evidence must carry source identity, patient reference hashes, clinical time, provenance hashes, and de-identification coverage.',
            'Owner contact details, patient names, microchips, and raw report text block readiness until transformed into hashes or safe facts.',
            'Operating status requires actual workflow/lab/PACS/follow-up packets, not marketplace connector configuration alone.',
        ],
    };
}

function buildCapabilityCoverage(
    definition: (typeof CAPABILITY_DEFINITIONS)[number],
    packets: WorkflowConnectorEvidencePacket[],
): WorkflowIntegrationCapabilityCoverage {
    const matchingPackets = packets.filter(definition.matches);
    const readyPackets = matchingPackets.filter(definition.ready);
    const blockedPackets = matchingPackets.filter((packet) => packet.evidence_status === 'blocked');
    const status = resolveCapabilityStatus(matchingPackets.length, readyPackets.length, blockedPackets.length);
    const blockers = [
        ...(definition.required && matchingPackets.length === 0 ? ['capability_evidence_missing'] : []),
        ...(blockedPackets.length > 0 ? ['capability_payloads_blocked'] : []),
        ...(matchingPackets.length > 0 && readyPackets.length === 0 ? ['capability_evidence_not_ready'] : []),
    ];
    const sourceStandards = uniqueValues(matchingPackets.map((packet) => packet.connector.source_standard));

    return {
        capability: definition.capability,
        required: definition.required,
        status,
        evidence_packets: matchingPackets.length,
        ready_packets: readyPackets.length,
        latest_observed_at: newestTimestamp(matchingPackets.map((packet) => packet.signal.observedAt)),
        source_standards: sourceStandards,
        connector_types: uniqueValues(matchingPackets.map((packet) => packet.connector.connector_type)),
        blockers: uniqueNonEmpty(blockers).sort(),
        warnings: buildCapabilityWarnings(definition, matchingPackets, sourceStandards),
    };
}

function resolveCapabilityStatus(
    packetCount: number,
    readyPacketCount: number,
    blockedPacketCount: number,
): WorkflowIntegrationCapabilityStatus {
    if (packetCount === 0) return 'missing';
    if (readyPacketCount > 0) return 'ready';
    if (blockedPacketCount > 0) return 'blocked';
    return 'thin';
}

function buildCapabilityWarnings(
    definition: (typeof CAPABILITY_DEFINITIONS)[number],
    packets: WorkflowConnectorEvidencePacket[],
    sourceStandards: WorkflowConnectorSourceStandard[],
): string[] {
    return uniqueNonEmpty([
        ...(!definition.required && packets.length === 0 ? ['optional_capability_not_observed'] : []),
        ...(packets.length > 0 && sourceStandards.every((standard) => standard === 'vendor_webhook') ? ['standard_specific_payload_not_detected'] : []),
        ...(packets.some((packet) => !packet.coverage.patient_reference) ? ['patient_reference_hash_missing'] : []),
        ...(packets.some((packet) => !packet.coverage.provenance_hash) ? ['provenance_hash_missing'] : []),
    ]).sort();
}

function buildWorkflowIntegrationBlockers(input: {
    packets: WorkflowConnectorEvidencePacket[];
    capabilityCoverage: WorkflowIntegrationCapabilityCoverage[];
    blockedPackets: number;
}): string[] {
    return uniqueNonEmpty([
        ...(input.packets.length === 0 ? ['workflow_connector_evidence_missing'] : []),
        ...(input.blockedPackets > 0 ? ['blocked_connector_payloads_present'] : []),
        ...input.capabilityCoverage
            .filter((coverage) => coverage.required && coverage.status !== 'ready')
            .map((coverage) => `required_capability_${coverage.status}:${coverage.capability}`),
    ]).sort();
}

function buildWorkflowIntegrationWarnings(
    capabilityCoverage: WorkflowIntegrationCapabilityCoverage[],
): string[] {
    return uniqueNonEmpty([
        ...capabilityCoverage
            .filter((coverage) => !coverage.required && coverage.status !== 'ready')
            .map((coverage) => `optional_capability_${coverage.status}:${coverage.capability}`),
        ...capabilityCoverage.flatMap((coverage) => coverage.warnings.map((warning) => `${coverage.capability}:${warning}`)),
    ]).sort();
}

function scoreWorkflowIntegrationReadiness(input: {
    requiredReady: number;
    requiredCapabilities: number;
    packets: WorkflowConnectorEvidencePacket[];
    outcomeLinkedPackets: number;
    blockedPackets: number;
}): number {
    if (input.packets.length === 0 || input.requiredCapabilities === 0) return 0;
    const requiredCoverage = input.requiredReady / input.requiredCapabilities;
    const readyPacketCoverage = input.packets.filter(isPacketReady).length / input.packets.length;
    const averagePacketReadiness = average(input.packets.map((packet) => packet.readiness_score));
    const outcomeCoverage = input.outcomeLinkedPackets > 0 ? 1 : 0;
    const blockedPenalty = input.blockedPackets * 0.12;

    return clampScore(
        requiredCoverage * 0.62
        + readyPacketCoverage * 0.16
        + averagePacketReadiness * 0.12
        + outcomeCoverage * 0.1
        - blockedPenalty,
    );
}

function resolveWorkflowIntegrationMoatStatus(input: {
    packets: WorkflowConnectorEvidencePacket[];
    blockers: string[];
    requiredReady: number;
    requiredCapabilities: number;
    readinessScore: number;
}): WorkflowIntegrationMoatStatus {
    if (input.packets.length === 0 || input.readinessScore < 0.35) return 'blocked';
    if (input.blockers.length === 0 && input.requiredReady === input.requiredCapabilities && input.readinessScore >= 0.78) {
        return 'operating';
    }
    return 'foundation';
}

function countSourceStandards(
    packets: WorkflowConnectorEvidencePacket[],
): Record<WorkflowConnectorSourceStandard, number> {
    const counts = Object.fromEntries(SOURCE_STANDARDS.map((standard) => [standard, 0])) as Record<WorkflowConnectorSourceStandard, number>;
    for (const packet of packets) {
        counts[packet.connector.source_standard] += 1;
    }
    return counts;
}

function isPacketReady(packet: WorkflowConnectorEvidencePacket): boolean {
    return packet.evidence_status !== 'blocked'
        && packet.readiness_score >= 0.68
        && packet.coverage.source_identity
        && packet.coverage.patient_reference
        && packet.coverage.clinical_time
        && packet.coverage.provenance_hash
        && packet.coverage.deidentified;
}

function newestTimestamp(values: Array<string | null | undefined>): string | null {
    let newest: string | null = null;
    for (const value of values) {
        if (!value) continue;
        if (!newest || Date.parse(value) > Date.parse(newest)) newest = value;
    }
    return newest;
}

function average(values: number[]): number {
    const valid = values.filter((value) => Number.isFinite(value));
    if (valid.length === 0) return 0;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function uniqueValues<T extends string>(values: T[]): T[] {
    return Array.from(new Set(values)).sort();
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter(Boolean)));
}

function buildCoverage(input: {
    input: WorkflowConnectorEvidenceInput;
    workflow: PimsWorkflowNormalizationResult;
    normalized: PassiveConnectorNormalizationResult;
    sourceRecordDigest: string;
    phiPaths: string[];
}): WorkflowConnectorEvidencePacket['coverage'] {
    return {
        source_identity: hasSourceIdentity(input.input, input.workflow),
        patient_reference: Boolean(input.input.patientId),
        clinical_time: Boolean(input.normalized.observedAt),
        diagnostic_observation: input.workflow.connectorType === 'lab_result' || input.workflow.connectorType === 'imaging_report',
        workflow_status: Boolean(
            readText(input.workflow.payload, ['status', 'appointment_status', 'result_status', 'refill_status'])
            ?? input.normalized.episodeStatus,
        ),
        outcome_signal: Boolean(input.normalized.outcomeState || input.normalized.resolvedAt),
        provenance_hash: input.sourceRecordDigest.length === 64,
        deidentified: input.phiPaths.length === 0,
        standard_aligned: inferSourceStandard(input.input.payload, input.workflow) !== 'vendor_webhook'
            || input.workflow.normalizedBy === 'pims_workflow_adapter',
    };
}

function resolveEvidenceStatus(
    connectorType: PassiveConnectorType,
    normalized: PassiveConnectorNormalizationResult,
    coverage: WorkflowConnectorEvidencePacket['coverage'],
    blockerCount: number,
): WorkflowConnectorEvidenceStatus {
    if (blockerCount > 0) return 'blocked';
    if (coverage.outcome_signal) return 'outcome_signal_ready';
    if (connectorType === 'lab_result' || connectorType === 'imaging_report') return 'diagnostic_signal_ready';
    if (coverage.source_identity && coverage.patient_reference && coverage.clinical_time) return 'workflow_signal_ready';
    if (normalized.dedupeKey) return 'workflow_signal_ready';
    return 'insufficient_context';
}

function resolveMoatPosture(
    status: WorkflowConnectorEvidenceStatus,
    score: number,
    blockerCount: number,
): WorkflowConnectorEvidencePacket['moat_posture'] {
    if (blockerCount > 0 || status === 'blocked') return 'blocked_phi_risk';
    if (status === 'outcome_signal_ready') return 'outcome_linkage_ready';
    if (score >= 0.72) return 'provenance_foundation';
    return 'interface_only';
}

function scoreCoverage(coverage: WorkflowConnectorEvidencePacket['coverage'], blockerCount: number): number {
    const score = [
        coverage.source_identity ? 0.12 : 0,
        coverage.patient_reference ? 0.12 : 0,
        coverage.clinical_time ? 0.1 : 0,
        coverage.diagnostic_observation ? 0.14 : 0,
        coverage.workflow_status ? 0.1 : 0,
        coverage.outcome_signal ? 0.14 : 0,
        coverage.provenance_hash ? 0.12 : 0,
        coverage.deidentified ? 0.1 : 0,
        coverage.standard_aligned ? 0.06 : 0,
    ].reduce((sum, value) => sum + value, 0);

    return clampScore(score - blockerCount * 0.35);
}

function resolveIngestionProfile(connectorType: PassiveConnectorType): WorkflowConnectorIngestionProfile {
    switch (connectorType) {
        case 'lab_result':
            return 'lab_result_import';
        case 'imaging_report':
            return 'pacs_report_import';
        case 'recheck':
            return 'appointment_follow_up_sync';
        case 'referral':
            return 'referral_sync';
        case 'prescription_refill':
            return 'prescription_sync';
        default:
            return 'pims_history_sync';
    }
}

function inferSourceStandard(
    payload: Record<string, unknown>,
    workflow: PimsWorkflowNormalizationResult,
): WorkflowConnectorSourceStandard {
    const resourceType = readText(payload, ['resourceType', 'resource_type']);
    const eventType = workflow.vendorEventType?.toLowerCase() ?? '';
    const sourceFormat = readText(payload, ['source_format', 'format', 'standard'])?.toLowerCase() ?? '';
    const search = [resourceType, eventType, sourceFormat].filter(Boolean).join(' ').toLowerCase();

    if (search.includes('diagnosticreport') || search.includes('observation') || search.includes('fhir')) return 'fhir_r4';
    if (search.includes('oru') || search.includes('hl7_v2') || search.includes('hl7 v2')) return 'hl7_v2_oru';
    if (
        search.includes('dicom')
        || hasAnyKey(payload, ['study_instance_uid', 'series_instance_uid', 'sop_instance_uid', 'dicomweb_url'])
    ) {
        return 'dicomweb';
    }
    if (sourceFormat.includes('csv') || sourceFormat.includes('file')) return 'manual_file_drop';
    return 'vendor_webhook';
}

function buildSafeFacts(
    normalizedFacts: Record<string, unknown>,
    workflowPayload: Record<string, unknown>,
): Record<string, unknown> {
    const facts: Record<string, unknown> = {};
    for (const key of SAFE_FACT_KEYS) {
        const value = normalizedFacts[key] ?? workflowPayload[key];
        if (isSafeScalar(value)) facts[key] = value;
    }

    const studyInstanceUid = readText(workflowPayload, ['study_instance_uid', 'studyInstanceUID', 'StudyInstanceUID']);
    if (studyInstanceUid) facts.study_instance_uid_hash = hashValue(studyInstanceUid);

    const accessionId = readText(workflowPayload, ['accession_id', 'accession_number', 'accessionNumber']);
    if (accessionId) facts.accession_ref_hash = hashValue(accessionId);

    return facts;
}

function hashFreeTextFields(source: Record<string, unknown>): Record<string, string> {
    const hashes: Record<string, string> = {};
    visitRecord(source, '', (path, value) => {
        const key = path.split('.').at(-1) ?? path;
        if (!FREE_TEXT_KEYS.includes(key as (typeof FREE_TEXT_KEYS)[number])) return;
        if (typeof value === 'string' && value.trim().length > 0) hashes[path] = hashValue(value.trim());
    });
    return sortRecord(hashes);
}

function findDirectPhiPaths(source: Record<string, unknown>): string[] {
    const paths = new Set<string>();
    visitRecord(source, '', (path, value) => {
        const key = path.split('.').at(-1) ?? path;
        if (DIRECT_PHI_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
            paths.add(path);
            return;
        }
        if (typeof value === 'string' && (EMAIL_VALUE_PATTERN.test(value) || PHONE_VALUE_PATTERN.test(value))) {
            paths.add(path);
        }
    });
    return Array.from(paths).sort();
}

function visitRecord(
    value: unknown,
    path: string,
    visitor: (path: string, value: unknown) => void,
) {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => visitRecord(entry, `${path}[${index}]`, visitor));
        return;
    }
    if (typeof value === 'object' && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
            const nextPath = path ? `${path}.${key}` : key;
            visitor(nextPath, nested);
            visitRecord(nested, nextPath, visitor);
        }
    }
}

function hasSourceIdentity(
    input: WorkflowConnectorEvidenceInput,
    workflow: PimsWorkflowNormalizationResult,
): boolean {
    return Boolean(
        normalizeOptionalText(input.vendorName)
        || normalizeOptionalText(input.vendorAccountRef)
        || normalizeOptionalText(workflow.vendorEventType)
        || readText(input.payload, ['source_system', 'source', 'sender', 'vendor_name']),
    );
}

function hasAnyKey(source: Record<string, unknown>, keys: string[]): boolean {
    return keys.some((key) => readPath(source, key) != null);
}

function readText(source: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = readPath(source, key);
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return null;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[segment];
    }, source);
}

function isSafeScalar(value: unknown): value is string | number | boolean | null {
    return value == null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean';
}

function hashOptional(value: string | null | undefined): string | null {
    const normalized = normalizeOptionalText(value);
    return normalized ? hashValue(normalized) : null;
}

function hashJson(value: unknown): string {
    return hashValue(stableStringify(value));
}

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (typeof value === 'object' && value !== null) {
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function clampScore(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
