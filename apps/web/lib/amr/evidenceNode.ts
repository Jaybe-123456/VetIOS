import { hashAMRNetworkJson } from './outcomeNetwork';

export type EvidenceNodeContractEventType =
    | 'drafted'
    | 'approved'
    | 'activated'
    | 'suspended'
    | 'revoked'
    | 'expired';

export type EvidenceNodeExportProfile = 'infarm_compat_v1' | 'nahln_compat_v1' | 'kabs_compat_v1';
export type EvidenceNodeExportValidationScope = 'vetios_internal_projection' | 'external_receiver';

export interface EvidenceNodeContractEventRow {
    id: string;
    tenant_id: string;
    request_id: string;
    contract_id: string;
    event_type: EvidenceNodeContractEventType;
    adapter_key: string;
    contract_version: string;
    mapping_version: string;
    mapping_hash: string;
    reference_key_id: string;
    clinic_site_id: string;
    lab_site_id: string;
    oauth_client_id: string | null;
    mtls_cert_thumbprint_hash: string | null;
    source_system: string;
    source_version: string | null;
    permitted_transports: string[];
    permitted_formats: string[];
    writeback_permitted: boolean;
    closure_destination_channel: 'pims_writeback' | 'lis_writeback' | 'signed_webhook' | 'manual_work_queue';
    purpose: string;
    terms_hash: string;
    data_use_agreement_hash: string;
    consent_basis: string;
    deidentification_profile: string;
    effective_at: string | null;
    expires_at: string | null;
    evidence: Record<string, unknown>;
    event_hash: string;
    actor_id: string | null;
    occurred_at: string;
    created_at: string;
}

export interface EvidenceNodeReceiptRow {
    id: string;
    tenant_id: string;
    request_id: string;
    receipt_id: string;
    contract_id: string;
    ingestion_event_id: string | null;
    receipt_status: 'accepted' | 'duplicate' | 'blocked' | 'dead_letter';
    result_count: number;
    occurred_at: string;
}

export interface EvidenceNodeIdentityLinkRow {
    id: string;
    tenant_id: string;
    link_id: string;
    ingestion_event_id: string;
    event_type: 'proposed' | 'verified' | 'revoked';
    occurred_at: string;
}

export interface EvidenceNodeClosureTaskRow {
    id: string;
    tenant_id: string;
    task_id: string;
    event_type: 'queued' | 'dispatched' | 'acknowledged' | 'completed' | 'cancelled' | 'failed';
    task_type: string;
    occurred_at: string;
}

export interface EvidenceNodeExportEventRow {
    id: string;
    tenant_id: string;
    export_id: string;
    event_type: 'generated' | 'validated' | 'delivered' | 'accepted' | 'rejected';
    export_profile: EvidenceNodeExportProfile;
    validation_scope: EvidenceNodeExportValidationScope;
    official_acceptance: boolean;
    occurred_at: string;
}

export interface EvidenceNodeIngestionProjectionRow {
    id: string;
    source_system: string;
    source_version: string | null;
    source_record_digest: string;
    canonical_packet_hash: string;
    species: string;
    breed: string | null;
    production_class: string | null;
    specimen_type: string;
    anatomical_site: string | null;
    country_code: string | null;
    organism_label: string;
    organism_key: string;
    organism_code_system: string | null;
    organism_code: string | null;
    culture_collected_at: string | null;
    observed_at: string;
    ast_method: string;
    interpretation_standard: string;
    interpretation_standard_version: string;
    qc_status: string;
    ingestion_status: string;
    deidentified: boolean;
    is_synthetic: boolean;
    raw_payload_stored: boolean;
}

export interface EvidenceNodeResultProjectionRow {
    id: string;
    ingestion_event_id: string;
    result_index: number;
    antimicrobial_label: string;
    antimicrobial_key: string;
    antimicrobial_code_system: string | null;
    antimicrobial_code: string | null;
    drug_class: string | null;
    measurement_type: string;
    mic_value: number | null;
    mic_operator: string | null;
    mic_unit: string | null;
    zone_diameter_mm: number | null;
    qualitative_result: string | null;
    interpretation: string;
    breakpoint_value: number | null;
    breakpoint_unit: string | null;
    breakpoint_basis: string | null;
    result_hash: string;
    observed_at: string;
}

export interface EvidenceNodeContractSummary {
    contract_id: string;
    status: EvidenceNodeContractEventType;
    active: boolean;
    adapter_key: string;
    mapping_version: string;
    mapping_hash: string;
    reference_key_id: string;
    lab_site_id: string;
    clinic_site_id: string;
    source_system: string;
    source_version: string | null;
    oauth_client_id: string | null;
    permitted_transports: string[];
    permitted_formats: string[];
    writeback_permitted: boolean;
    closure_destination_channel: string;
    effective_at: string | null;
    expires_at: string | null;
    latest_event_id: string;
}

export function buildEvidenceNodeContractSummaries(
    rows: EvidenceNodeContractEventRow[],
    now = new Date(),
): EvidenceNodeContractSummary[] {
    const latest = latestBy(rows, (row) => row.contract_id);
    return Array.from(latest.values()).map((row) => ({
        contract_id: row.contract_id,
        status: row.event_type,
        active: row.event_type === 'activated'
            && (!row.effective_at || Date.parse(row.effective_at) <= now.getTime())
            && (!row.expires_at || Date.parse(row.expires_at) > now.getTime()),
        adapter_key: row.adapter_key,
        mapping_version: row.mapping_version,
        mapping_hash: row.mapping_hash,
        reference_key_id: row.reference_key_id,
        lab_site_id: row.lab_site_id,
        clinic_site_id: row.clinic_site_id,
        source_system: row.source_system,
        source_version: row.source_version,
        oauth_client_id: row.oauth_client_id,
        permitted_transports: row.permitted_transports,
        permitted_formats: row.permitted_formats,
        writeback_permitted: row.writeback_permitted,
        closure_destination_channel: row.closure_destination_channel,
        effective_at: row.effective_at,
        expires_at: row.expires_at,
        latest_event_id: row.id,
    })).sort((left, right) => left.adapter_key.localeCompare(right.adapter_key));
}

export function buildEvidenceNodeOperationsSnapshot(input: {
    contracts: EvidenceNodeContractEventRow[];
    receipts: EvidenceNodeReceiptRow[];
    identityLinks: EvidenceNodeIdentityLinkRow[];
    closureTasks: EvidenceNodeClosureTaskRow[];
    exports: EvidenceNodeExportEventRow[];
    connectorProbes: Array<{
        site_id: string;
        oauth_client_id: string | null;
        probe_status: string;
        occurred_at: string;
    }>;
    now?: Date;
}) {
    const now = input.now ?? new Date();
    const contracts = buildEvidenceNodeContractSummaries(input.contracts, now);
    const receipts = input.receipts;
    const accepted = receipts.filter((row) => row.receipt_status === 'accepted');
    const duplicateCount = receipts.filter((row) => row.receipt_status === 'duplicate').length;
    const blockedCount = receipts.filter((row) => ['blocked', 'dead_letter'].includes(row.receipt_status)).length;
    const latestIdentity = latestBy(input.identityLinks, (row) => row.ingestion_event_id);
    const reconciledCount = accepted.filter((receipt) => (
        receipt.ingestion_event_id
        && latestIdentity.get(receipt.ingestion_event_id)?.event_type === 'verified'
    )).length;
    const latestTasks = latestBy(input.closureTasks, (row) => row.task_id);
    const completedTasks = Array.from(latestTasks.values()).filter((row) => row.event_type === 'completed').length;
    const latestExports = latestBy(input.exports, (row) => row.export_id);
    const acceptedExports = Array.from(latestExports.values()).filter((row) => (
        row.event_type === 'accepted' && row.official_acceptance
    )).length;
    const probeWindowHours = 24;
    const minimumProbeTime = now.getTime() - probeWindowHours * 60 * 60 * 1_000;
    const contractBindings = new Set(contracts.flatMap((contract) => (
        contract.oauth_client_id
            ? [`${contract.lab_site_id}:${contract.oauth_client_id}`]
            : []
    )));
    const probes = input.connectorProbes.filter((probe) => {
        const occurredAt = Date.parse(probe.occurred_at);
        return contractBindings.has(`${probe.site_id}:${probe.oauth_client_id ?? ''}`)
            && Number.isFinite(occurredAt)
            && occurredAt >= minimumProbeTime
            && occurredAt <= now.getTime() + 5 * 60_000;
    });
    const passedProbes = probes.filter((probe) => probe.probe_status === 'passed').length;
    const lastReceiptAt = receipts.map((row) => Date.parse(row.occurred_at)).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
    return {
        schema_version: 'vetios.evidence-node.operations.v1',
        configured_contracts: contracts.length,
        active_contracts: contracts.filter((contract) => contract.active).length,
        connector_probe_window_hours: probeWindowHours,
        connector_probe_count: probes.length,
        connector_uptime_rate: ratio(passedProbes, probes.length),
        ingestion_lag_seconds: lastReceiptAt == null ? null : Math.max(0, Math.round((now.getTime() - lastReceiptAt) / 1000)),
        accepted_receipts: accepted.length,
        duplicate_rate: ratio(duplicateCount, receipts.length),
        blocked_rate: ratio(blockedCount, receipts.length),
        reconciliation_rate: ratio(reconciledCount, accepted.length),
        closure_rate: ratio(completedTasks, latestTasks.size),
        export_acceptance_rate: ratio(acceptedExports, latestExports.size),
        pending_closure_tasks: Array.from(latestTasks.values()).filter((row) => (
            ['queued', 'dispatched', 'acknowledged', 'failed'].includes(row.event_type)
        )).length,
        contracts,
        caveats: [
            'Compatibility export generation is not official network acceptance.',
            'Connector uptime reflects mTLS-bound probes from active contract identities within 24 hours, not unobserved vendor downtime or laboratory source-data freshness.',
            'Raw laboratory payloads are excluded from the control plane.',
        ],
    };
}

export function buildEvidenceNodeCompatibilityExport(input: {
    profile: EvidenceNodeExportProfile;
    ingestions: EvidenceNodeIngestionProjectionRow[];
    results: EvidenceNodeResultProjectionRow[];
}) {
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const profileContract = compatibilityProfileContract(input.profile);
    warnings.add(profileContract.external_validation_warning);
    const resultsByIngestion = groupBy(input.results, (row) => row.ingestion_event_id);
    const records = input.ingestions.flatMap((ingestion) => {
        if (ingestion.ingestion_status !== 'accepted') return [];
        if (!ingestion.deidentified) {
            blockers.add(`ingestion_${ingestion.id}:deidentification_required`);
            return [];
        }
        if (ingestion.is_synthetic) {
            blockers.add(`ingestion_${ingestion.id}:synthetic_evidence_excluded`);
            return [];
        }
        if (ingestion.raw_payload_stored) {
            blockers.add(`ingestion_${ingestion.id}:raw_payload_policy_violation`);
            return [];
        }
        const results = resultsByIngestion.get(ingestion.id) ?? [];
        if (results.length === 0) {
            blockers.add(`ingestion_${ingestion.id}:ast_results_missing`);
            return [];
        }
        if (!ingestion.organism_code || !ingestion.organism_code_system) {
            warnings.add(`ingestion_${ingestion.id}:organism_standard_code_missing`);
        }
        return results.map((result) => projectCompatibilityRecord(input.profile, ingestion, result, warnings));
    });
    if (records.length === 0) blockers.add('no_export_eligible_records');
    const sourceBundleHash = hashAMRNetworkJson(input.ingestions.map((row) => row.source_record_digest).sort());
    const mappingBundleHash = hashAMRNetworkJson(records.map((record) => record.terminology).sort((left, right) => (
        hashAMRNetworkJson(left).localeCompare(hashAMRNetworkJson(right))
    )));
    const artifact = {
        schema_version: 'vetios.evidence-node.compatibility-export.v1',
        export_profile: input.profile,
        generated_at: new Date().toISOString(),
        official_acceptance: false,
        compatibility_only: true,
        validation_scope: 'vetios_internal_projection' as const,
        compatibility_scope: profileContract.compatibility_scope,
        intended_receiver: profileContract.intended_receiver,
        receiver_schema_verified: false,
        receiver_acceptance_required: true,
        raw_vendor_codes_preserved: true,
        breakpoint_tables_embedded: false,
        record_count: records.length,
        records,
    };
    return {
        profile: input.profile,
        artifact,
        artifact_hash: hashAMRNetworkJson(artifact),
        source_bundle_hash: sourceBundleHash,
        mapping_bundle_hash: mappingBundleHash,
        record_count: records.length,
        eligible_record_count: records.length,
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        validation_scope: 'vetios_internal_projection' as const,
        validation_status: blockers.size === 0 ? 'passed' as const : 'blocked' as const,
    };
}

function compatibilityProfileContract(profile: EvidenceNodeExportProfile) {
    if (profile === 'infarm_compat_v1') {
        return {
            compatibility_scope: 'infarm_data_preparation_candidate',
            intended_receiver: 'FAO InFARM national data workflow',
            external_validation_warning: 'infarm_national_focal_point_validation_required',
        } as const;
    }
    if (profile === 'nahln_compat_v1') {
        return {
            compatibility_scope: 'nahln_terminology_and_message_preflight',
            intended_receiver: 'USDA NAHLN laboratory messaging workflow',
            external_validation_warning: 'nahln_receiver_profile_and_oid_validation_required',
        } as const;
    }
    return {
        compatibility_scope: 'kabs_surveillance_handoff_candidate',
        intended_receiver: 'Kenya Animal Biosurveillance System workflow',
        external_validation_warning: 'kabs_receiver_schema_validation_required',
    } as const;
}

function projectCompatibilityRecord(
    profile: EvidenceNodeExportProfile,
    ingestion: EvidenceNodeIngestionProjectionRow,
    result: EvidenceNodeResultProjectionRow,
    warnings: Set<string>,
) {
    if (profile === 'nahln_compat_v1' && (!result.antimicrobial_code || !result.antimicrobial_code_system)) {
        warnings.add(`result_${result.id}:nahln_standard_test_code_missing`);
    }
    if (profile === 'kabs_compat_v1' && ingestion.country_code !== 'KE') {
        warnings.add(`ingestion_${ingestion.id}:kabs_non_ke_record`);
    }
    const measurement = result.measurement_type === 'mic'
        ? { type: 'mic', value: result.mic_value, operator: result.mic_operator, unit: result.mic_unit }
        : result.measurement_type === 'disk_diffusion'
            ? { type: 'disk_diffusion', value: result.zone_diameter_mm, unit: 'mm' }
            : { type: 'qualitative', value: result.qualitative_result, unit: null };
    return {
        profile,
        record_id: hashAMRNetworkJson(`${profile}:${ingestion.id}:${result.id}`),
        event_time: result.observed_at,
        geography: { country_code: ingestion.country_code },
        host: {
            species: ingestion.species,
            breed: ingestion.breed,
            production_class: ingestion.production_class,
        },
        specimen: {
            type: ingestion.specimen_type,
            anatomical_site: ingestion.anatomical_site,
            collected_at: ingestion.culture_collected_at,
        },
        organism: {
            label: ingestion.organism_label,
            normalized_key: ingestion.organism_key,
            code_system: ingestion.organism_code_system,
            code: ingestion.organism_code,
        },
        antimicrobial: {
            label: result.antimicrobial_label,
            normalized_key: result.antimicrobial_key,
            drug_class: result.drug_class,
            code_system: result.antimicrobial_code_system,
            code: result.antimicrobial_code,
        },
        ast: {
            method: ingestion.ast_method,
            standard: ingestion.interpretation_standard,
            standard_version: ingestion.interpretation_standard_version,
            interpretation: result.interpretation,
            measurement,
            source_breakpoint_value: result.breakpoint_value,
            source_breakpoint_unit: result.breakpoint_unit,
            source_breakpoint_basis: result.breakpoint_basis,
            breakpoint_computed_by_vetios: false,
        },
        terminology: {
            source_system: ingestion.source_system,
            source_version: ingestion.source_version,
            organism_code_system: ingestion.organism_code_system,
            antimicrobial_code_system: result.antimicrobial_code_system,
            interpretation_standard: ingestion.interpretation_standard,
            interpretation_standard_version: ingestion.interpretation_standard_version,
        },
        provenance: {
            source_record_digest: ingestion.source_record_digest,
            canonical_packet_hash: ingestion.canonical_packet_hash,
            result_hash: result.result_hash,
            deidentified: ingestion.deidentified,
            synthetic: ingestion.is_synthetic,
            raw_payload_included: false,
        },
    };
}

function latestBy<T extends { occurred_at: string; created_at?: string }>(
    rows: T[],
    key: (row: T) => string,
): Map<string, T> {
    const result = new Map<string, T>();
    for (const row of [...rows].sort(compareEvents)) result.set(key(row), row);
    return result;
}

function compareEvents(left: { occurred_at: string; created_at?: string }, right: { occurred_at: string; created_at?: string }) {
    return Date.parse(left.occurred_at) - Date.parse(right.occurred_at)
        || Date.parse(left.created_at ?? left.occurred_at) - Date.parse(right.created_at ?? right.occurred_at);
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
    return result;
}

function ratio(numerator: number, denominator: number): number | null {
    return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}
