import { createHash } from 'crypto';
import {
    buildAMRLabFeedSurveillanceEventDraft,
    buildAMRLabFeedSurveillancePacket,
    normalizeAMRDrugClassTaxonomy,
    normalizeAMRLabel,
    normalizeAMRPathogenTaxonomy,
    type AMRLabFeedSurveillanceEventDraft,
} from '@/lib/amr/stewardship';
import { hashAMRNetworkJson, hashAMRNetworkValue } from '@/lib/amr/outcomeNetwork';

export const AMR_AST_SCHEMA_VERSION = 'vetios.amr.ast.v1';
export const AMR_CONNECTOR_PROBE_MAX_AGE_HOURS = 24;
export const AMR_CONNECTOR_PROBE_MAX_LATENCY_MS = 30_000;

export const AMR_EXCHANGE_PRODUCT_KEYS = [
    'amr.culture_ast.normalized.v1',
    'amr.outcome_evidence.aggregate.v1',
    'amr.surveillance.signal.v1',
    'amr.federated_compute.v1',
    'amr.specialist_review.v1',
] as const;
export type AMRExchangeProductKey = typeof AMR_EXCHANGE_PRODUCT_KEYS[number];

export const AMR_EXCHANGE_EVENT_TYPES = [
    'drafted',
    'offered',
    'accepted',
    'activated',
    'suspended',
    'revoked',
    'expired',
] as const;
export type AMRExchangeEventType = typeof AMR_EXCHANGE_EVENT_TYPES[number];

export interface AMRConnectorProbeEventRow {
    id?: string | null;
    tenant_id: string;
    request_id?: string | null;
    site_id: string;
    connector_installation_id?: string | null;
    oauth_client_id?: string | null;
    api_credential_id?: string | null;
    probe_type: 'dry_run' | 'schema_validation' | 'production_probe' | 'heartbeat' | string;
    probe_status: 'passed' | 'failed' | 'blocked' | string;
    token_binding_method: 'session' | 'api_key' | 'dpop' | 'mtls' | string;
    certificate_thumbprint_hash?: string | null;
    source_system: string;
    connector_version: string;
    schema_version: string;
    observed_record_count: number;
    latency_ms?: number | null;
    oldest_record_at?: string | null;
    newest_record_at?: string | null;
    request_digest: string;
    response_digest: string;
    receipt_hash: string;
    blockers?: string[] | null;
    warnings?: string[] | null;
    evidence?: Record<string, unknown> | null;
    occurred_at?: string | null;
    created_at?: string | null;
}

export interface AMRASTResultInput {
    antimicrobial_label: string;
    antimicrobial_key?: string | null;
    antimicrobial_code_system?: string | null;
    antimicrobial_code?: string | null;
    drug_class?: string | null;
    measurement_type: 'mic' | 'disk_diffusion' | 'qualitative';
    mic_value?: number | null;
    mic_operator?: '<' | '<=' | '=' | '>=' | '>' | null;
    mic_unit?: string | null;
    zone_diameter_mm?: number | null;
    qualitative_result?: string | null;
    interpretation: 'S' | 'I' | 'R' | 'SDD' | 'NS' | 'IE' | 'UNKNOWN';
    breakpoint_value?: number | null;
    breakpoint_unit?: string | null;
    breakpoint_basis?: string | null;
    evidence?: Record<string, unknown> | null;
}

export interface CanonicalAMRASTPacketInput {
    schema_version: string;
    source_system: string;
    source_version?: string | null;
    source_record_digest: string;
    isolate_ref: string;
    patient_ref?: string | null;
    site_id: string;
    lab_site_id: string;
    connector_probe_event_id: string;
    species: string;
    breed?: string | null;
    production_class?: string | null;
    specimen_type: string;
    anatomical_site?: string | null;
    country_code?: string | null;
    admin_area?: string | null;
    organism_label: string;
    organism_key?: string | null;
    organism_code_system?: string | null;
    organism_code?: string | null;
    culture_collected_at?: string | null;
    observed_at: string;
    ast_method: string;
    interpretation_standard: string;
    interpretation_standard_version: string;
    qc_status: 'passed' | 'warning' | 'failed' | 'not_reported';
    deidentified: boolean;
    is_synthetic: boolean;
    results: AMRASTResultInput[];
    evidence?: Record<string, unknown> | null;
}

export interface PreparedAMRASTPacket {
    accepted: boolean;
    blockers: string[];
    warnings: string[];
    ingestion: Record<string, unknown>;
    results: Array<Record<string, unknown>>;
    surveillance_events: AMRLabFeedSurveillanceEventDraft[];
    canonical_packet_hash: string;
    source_record_digest: string;
}

export interface AMRASTIngestionEventRow {
    id: string;
    tenant_id: string;
    request_id?: string | null;
    site_id: string;
    lab_site_id: string;
    connector_probe_event_id: string;
    source_system: string;
    schema_version: string;
    source_record_digest: string;
    canonical_packet_hash: string;
    species: string;
    specimen_type: string;
    organism_key: string;
    ingestion_status: 'accepted' | 'blocked' | string;
    result_count: number;
    blockers?: string[] | null;
    warnings?: string[] | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface AMRASTReconciliationEventRow {
    id?: string | null;
    tenant_id: string;
    ingestion_event_id: string;
    reconciliation_event: 'queued' | 'matched' | 'unmatched' | 'failed' | 'requeued' | 'blocked' | string;
    attempt_no?: number | null;
    occurred_at?: string | null;
    created_at?: string | null;
}

export interface AMRExchangeAgreementEventRow {
    id?: string | null;
    tenant_id: string;
    request_id?: string | null;
    agreement_id: string;
    event_type: AMRExchangeEventType | string;
    product_key: AMRExchangeProductKey | string;
    provider_site_id?: string | null;
    consumer_tenant_id?: string | null;
    counterparty_ref_hash?: string | null;
    purpose: string;
    license_key: string;
    privacy_class: 'deidentified_record' | 'aggregate_only' | 'federated_only' | string;
    permitted_species?: string[] | null;
    permitted_geographies?: string[] | null;
    permitted_use_cases?: string[] | null;
    pricing_model: 'per_record' | 'per_episode' | 'subscription' | 'no_charge' | string;
    currency: string;
    unit_price_minor: number;
    platform_fee_bps: number;
    terms_hash: string;
    data_use_agreement_hash: string;
    effective_at?: string | null;
    expires_at?: string | null;
    metadata?: Record<string, unknown> | null;
    event_hash?: string | null;
    actor_id?: string | null;
    occurred_at?: string | null;
    created_at?: string | null;
}

export interface AMRExchangeAgreementSummary {
    agreement_id: string;
    product_key: string;
    provider_site_id: string | null;
    consumer_tenant_id: string | null;
    counterparty_ref_hash: string | null;
    purpose: string;
    license_key: string;
    privacy_class: string;
    permitted_species: string[];
    permitted_geographies: string[];
    permitted_use_cases: string[];
    pricing_model: string;
    currency: string;
    unit_price_minor: number;
    platform_fee_bps: number;
    terms_hash: string;
    data_use_agreement_hash: string;
    effective_at: string | null;
    expires_at: string | null;
    status: 'drafted' | 'offered' | 'accepted' | 'active' | 'suspended' | 'revoked' | 'expired';
    active: boolean;
    blockers: string[];
    latest_event_at: string | null;
}

export interface AMRExchangeUsageEventRow {
    id: string;
    tenant_id: string;
    agreement_id: string;
    product_key: string;
    meter_key: string;
    source_type: string;
    source_event_id: string;
    source_digest: string;
    quantity: number;
    unit: string;
    unit_price_minor: number;
    amount_minor: number;
    currency: string;
    usage_status: 'metered' | 'excluded' | 'reversed' | string;
    blockers?: string[] | null;
    metered_at?: string | null;
    created_at?: string | null;
}

export interface AMRExchangeSettlementEventRow {
    id?: string | null;
    tenant_id: string;
    settlement_id: string;
    agreement_id: string;
    event_type: 'calculated' | 'approved' | 'invoiced' | 'paid' | 'voided' | string;
    period_start: string;
    period_end: string;
    usage_event_count: number;
    total_quantity: number;
    gross_amount_minor: number;
    platform_fee_minor: number;
    provider_net_amount_minor: number;
    currency: string;
    source_digest_bundle_hash: string;
    occurred_at?: string | null;
    created_at?: string | null;
}

export interface AMRNetworkOperationsSnapshot {
    schema_version: 'amr-network-operations-exchange-v1';
    generated_at: string;
    connectors: {
        total_sites: number;
        production_verified: number;
        stale: number;
        failed: number;
        rows: Array<{
            site_id: string;
            status: 'verified' | 'stale' | 'failed' | 'non_production';
            source_system: string;
            connector_version: string;
            schema_version: string;
            last_probe_at: string | null;
            observed_record_count: number;
            token_binding_method: string;
            blockers: string[];
        }>;
    };
    ingestion: {
        total: number;
        accepted: number;
        blocked: number;
        result_count: number;
        pending_reconciliation: number;
        matched: number;
        failed_reconciliation: number;
        rows: AMRASTIngestionEventRow[];
    };
    exchange: {
        agreements_total: number;
        agreements_active: number;
        metered_events: number;
        metered_amount_minor: number;
        unsettled_amount_minor: number;
        currency: string | null;
        amounts_by_currency: Array<{
            currency: string;
            metered_amount_minor: number;
            settled_amount_minor: number;
            unsettled_amount_minor: number;
        }>;
        settlement_events: number;
        agreements: AMRExchangeAgreementSummary[];
    };
    marketplace_ready: boolean;
    blockers: string[];
    next_actions: string[];
    proof_hash: string;
}

export function evaluateAMRConnectorProbe(input: {
    probeType: AMRConnectorProbeEventRow['probe_type'];
    tokenBindingMethod: AMRConnectorProbeEventRow['token_binding_method'];
    oauthClientId?: string | null;
    certificateThumbprint?: string | null;
    sourceSystem: string;
    connectorVersion: string;
    schemaVersion: string;
    observedRecordCount: number;
    latencyMs?: number | null;
    oldestRecordAt?: string | null;
    newestRecordAt?: string | null;
    requestDigest: string;
    responseDigest: string;
    now?: string;
}): {
    status: 'passed' | 'failed' | 'blocked';
    production_verified: boolean;
    certificate_thumbprint_hash: string | null;
    receipt_hash: string;
    blockers: string[];
    warnings: string[];
} {
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const now = parseTimestamp(input.now) ?? new Date();
    const newestRecord = parseTimestamp(input.newestRecordAt);
    const isProductionProbe = input.probeType === 'production_probe' || input.probeType === 'heartbeat';

    if (!isSha256(input.requestDigest)) blockers.add('request_digest_invalid');
    if (!isSha256(input.responseDigest)) blockers.add('response_digest_invalid');
    if (input.schemaVersion !== AMR_AST_SCHEMA_VERSION) blockers.add('canonical_ast_schema_mismatch');
    if (input.observedRecordCount < 0) blockers.add('observed_record_count_invalid');
    if (input.latencyMs != null && input.latencyMs < 0) blockers.add('probe_latency_invalid');
    if (input.latencyMs != null && input.latencyMs > AMR_CONNECTOR_PROBE_MAX_LATENCY_MS) {
        warnings.add('probe_latency_slo_exceeded');
    }
    if (isProductionProbe) {
        if (input.tokenBindingMethod !== 'mtls') blockers.add('mtls_workload_binding_required');
        if (!input.oauthClientId) blockers.add('oauth_client_identity_required');
        if (!isSha256(input.certificateThumbprint)) blockers.add('verified_certificate_thumbprint_required');
        if (input.observedRecordCount <= 0 && input.probeType === 'production_probe') {
            blockers.add('production_probe_requires_observed_records');
        }
        if (input.probeType === 'production_probe') {
            if (!newestRecord) {
                blockers.add('newest_record_timestamp_required');
            } else if (hoursBetween(newestRecord, now) > AMR_CONNECTOR_PROBE_MAX_AGE_HOURS) {
                blockers.add('connector_feed_stale');
            } else if (newestRecord.getTime() > now.getTime() + 5 * 60_000) {
                blockers.add('connector_record_timestamp_in_future');
            }
        } else if (!newestRecord) {
            warnings.add('heartbeat_without_observed_source_record');
        } else if (newestRecord.getTime() > now.getTime() + 5 * 60_000) {
            blockers.add('connector_record_timestamp_in_future');
        } else if (hoursBetween(newestRecord, now) > AMR_CONNECTOR_PROBE_MAX_AGE_HOURS) {
            warnings.add('connector_feed_stale');
        }
    } else if (input.tokenBindingMethod !== 'mtls') {
        warnings.add('non_production_probe_does_not_activate_connector');
    }

    const productionVerified = isProductionProbe && blockers.size === 0;
    const status = blockers.size > 0
        ? 'blocked'
        : input.latencyMs != null && input.latencyMs > AMR_CONNECTOR_PROBE_MAX_LATENCY_MS
            ? 'failed'
            : 'passed';
    const certificateThumbprintHash = isSha256(input.certificateThumbprint)
        ? hashAMRNetworkValue(input.certificateThumbprint!)
        : null;
    const receiptHash = hashAMRNetworkJson({
        receipt_schema_version: 'amr-connector-probe-receipt-v1',
        probe_type: input.probeType,
        status,
        production_verified: productionVerified,
        source_system: normalizeAMRLabel(input.sourceSystem),
        connector_version: input.connectorVersion.trim(),
        schema_version: input.schemaVersion,
        observed_record_count: input.observedRecordCount,
        latency_ms: input.latencyMs ?? null,
        oldest_record_at: input.oldestRecordAt ?? null,
        newest_record_at: input.newestRecordAt ?? null,
        request_digest: input.requestDigest,
        response_digest: input.responseDigest,
        oauth_client_id: input.oauthClientId ?? null,
        certificate_thumbprint_hash: certificateThumbprintHash,
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
    });

    return {
        status,
        production_verified: productionVerified,
        certificate_thumbprint_hash: certificateThumbprintHash,
        receipt_hash: receiptHash,
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
    };
}

export function prepareCanonicalAMRASTPacket(input: {
    tenantId: string;
    requestId: string;
    actorId: string;
    connectorInstallationId?: string | null;
    oauthClientId?: string | null;
    packet: CanonicalAMRASTPacketInput;
}): PreparedAMRASTPacket {
    const packet = input.packet;
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const observedAt = parseTimestamp(packet.observed_at);
    const now = new Date();
    const species = normalizeAMRLabel(packet.species);
    const specimenType = normalizeAMRLabel(packet.specimen_type);
    const anatomicalSite = normalizeOptionalLabel(packet.anatomical_site);
    const organismTaxonomy = normalizeAMRPathogenTaxonomy(
        packet.organism_key ?? packet.organism_label,
    );
    const organismKey = organismTaxonomy.pathogen_key
        ?? normalizeAMRLabel(packet.organism_label);
    const countryCode = packet.country_code?.trim().toUpperCase() || null;

    if (packet.schema_version !== AMR_AST_SCHEMA_VERSION) blockers.add('canonical_ast_schema_mismatch');
    if (!isSha256(packet.source_record_digest)) blockers.add('source_record_digest_invalid');
    if (!packet.deidentified) blockers.add('deidentification_required');
    if (packet.is_synthetic) blockers.add('synthetic_ast_packet_not_operational');
    if (packet.qc_status === 'failed') blockers.add('laboratory_qc_failed');
    if (packet.results.length === 0) blockers.add('ast_results_required');
    if (!observedAt) blockers.add('observed_at_invalid');
    if (observedAt && observedAt.getTime() > now.getTime() + 5 * 60_000) {
        blockers.add('observed_at_in_future');
    }
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) blockers.add('country_code_invalid');
    if (!packet.organism_code_system || !packet.organism_code) {
        warnings.add('organism_external_code_missing');
    }
    if (!packet.anatomical_site) warnings.add('anatomical_site_missing');
    if (packet.qc_status === 'not_reported') warnings.add('laboratory_qc_not_reported');

    const seenAntimicrobials = new Set<string>();
    const normalizedResults = packet.results.map((result, resultIndex) => {
        const antimicrobialKey = normalizeAMRLabel(
            result.antimicrobial_key ?? result.antimicrobial_label,
        );
        const resultBlockers = validateASTResult(result);
        resultBlockers.forEach((blocker) => blockers.add(`result_${resultIndex}:${blocker}`));
        if (seenAntimicrobials.has(antimicrobialKey)) {
            blockers.add(`result_${resultIndex}:duplicate_antimicrobial`);
        }
        seenAntimicrobials.add(antimicrobialKey);
        if (
            ['S', 'I', 'R', 'SDD'].includes(result.interpretation)
            && !result.breakpoint_basis
        ) {
            warnings.add(`result_${resultIndex}:breakpoint_basis_missing`);
        }

        const normalized = {
            result_index: resultIndex,
            antimicrobial_label: result.antimicrobial_label.trim(),
            antimicrobial_key: antimicrobialKey,
            antimicrobial_code_system: normalizeOptionalText(result.antimicrobial_code_system),
            antimicrobial_code: normalizeOptionalText(result.antimicrobial_code),
            drug_class: normalizeAMRDrugClassTaxonomy(result.drug_class),
            measurement_type: result.measurement_type,
            mic_value: result.mic_value ?? null,
            mic_operator: result.mic_operator ?? null,
            mic_unit: normalizeOptionalText(result.mic_unit),
            zone_diameter_mm: result.zone_diameter_mm ?? null,
            qualitative_result: normalizeOptionalText(result.qualitative_result),
            interpretation: result.interpretation,
            breakpoint_value: result.breakpoint_value ?? null,
            breakpoint_unit: normalizeOptionalText(result.breakpoint_unit),
            breakpoint_basis: normalizeOptionalText(result.breakpoint_basis),
            evidence: result.evidence ?? {},
            observed_at: packet.observed_at,
        };
        return {
            ...normalized,
            result_hash: hashAMRNetworkJson(normalized),
        };
    });

    const accepted = blockers.size === 0;
    const canonicalPacket = {
        schema_version: AMR_AST_SCHEMA_VERSION,
        source_system: normalizeAMRLabel(packet.source_system),
        source_version: normalizeOptionalText(packet.source_version),
        source_record_digest: packet.source_record_digest,
        isolate_ref_hash: hashAMRNetworkValue(packet.isolate_ref),
        patient_ref_hash: packet.patient_ref ? hashAMRNetworkValue(packet.patient_ref) : null,
        species,
        breed: normalizeOptionalLabel(packet.breed),
        production_class: normalizeOptionalLabel(packet.production_class),
        specimen_type: specimenType,
        anatomical_site: anatomicalSite,
        country_code: countryCode,
        admin_area_hash: packet.admin_area ? hashAMRNetworkValue(packet.admin_area) : null,
        organism_label: packet.organism_label.trim(),
        organism_key: organismKey,
        organism_code_system: normalizeOptionalText(packet.organism_code_system),
        organism_code: normalizeOptionalText(packet.organism_code),
        culture_collected_at: packet.culture_collected_at ?? null,
        observed_at: packet.observed_at,
        ast_method: normalizeAMRLabel(packet.ast_method),
        interpretation_standard: packet.interpretation_standard.trim(),
        interpretation_standard_version: packet.interpretation_standard_version.trim(),
        qc_status: packet.qc_status,
        results: normalizedResults.map(({ result_hash: _hash, ...result }) => result),
        deidentified: packet.deidentified,
        is_synthetic: packet.is_synthetic,
    };
    const canonicalPacketHash = hashAMRNetworkJson(canonicalPacket);
    const ingestion = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        site_id: packet.site_id,
        lab_site_id: packet.lab_site_id,
        connector_probe_event_id: packet.connector_probe_event_id,
        connector_installation_id: input.connectorInstallationId ?? null,
        oauth_client_id: input.oauthClientId ?? null,
        source_system: canonicalPacket.source_system,
        source_version: canonicalPacket.source_version,
        schema_version: canonicalPacket.schema_version,
        source_record_digest: canonicalPacket.source_record_digest,
        canonical_packet_hash: canonicalPacketHash,
        isolate_ref_hash: canonicalPacket.isolate_ref_hash,
        patient_ref_hash: canonicalPacket.patient_ref_hash,
        species: canonicalPacket.species,
        breed: canonicalPacket.breed,
        production_class: canonicalPacket.production_class,
        specimen_type: canonicalPacket.specimen_type,
        anatomical_site: canonicalPacket.anatomical_site,
        country_code: canonicalPacket.country_code,
        admin_area_hash: canonicalPacket.admin_area_hash,
        organism_label: canonicalPacket.organism_label,
        organism_key: canonicalPacket.organism_key,
        organism_code_system: canonicalPacket.organism_code_system,
        organism_code: canonicalPacket.organism_code,
        culture_collected_at: canonicalPacket.culture_collected_at,
        observed_at: canonicalPacket.observed_at,
        ast_method: canonicalPacket.ast_method,
        interpretation_standard: canonicalPacket.interpretation_standard,
        interpretation_standard_version: canonicalPacket.interpretation_standard_version,
        qc_status: canonicalPacket.qc_status,
        ingestion_status: accepted ? 'accepted' : 'blocked',
        result_count: normalizedResults.length,
        deidentified: canonicalPacket.deidentified,
        is_synthetic: canonicalPacket.is_synthetic,
        raw_payload_stored: false,
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        evidence: {
            ...(packet.evidence ?? {}),
            privacy_contract: {
                raw_lab_report_stored: false,
                direct_identifiers_stored: false,
                source_references_hashed: true,
            },
        },
        actor_id: input.actorId,
    };

    const surveillanceEvents = accepted
        ? normalizedResults.map((result, resultIndex) => {
            const astPanel = {
                [result.antimicrobial_key]: result.interpretation,
            };
            const micResults = result.measurement_type === 'mic'
                ? {
                    [result.antimicrobial_key]: {
                        operator: result.mic_operator,
                        value: result.mic_value,
                        unit: result.mic_unit,
                    },
                }
                : {};
            const surveillancePacket = buildAMRLabFeedSurveillancePacket({
                species,
                pathogen_label: organismKey,
                infection_site: anatomicalSite,
                sample_source: specimenType,
                culture_collected: true,
                culture_result: 'positive',
                ast_method: canonicalPacket.ast_method,
                ast_panel: astPanel,
                mic_results: micResults,
                drug_name: result.antimicrobial_key,
                drug_class: result.drug_class as string | null,
                resistance_suspected: result.interpretation === 'R'
                    || result.interpretation === 'NS',
                evidence: {
                    canonical_ast_packet_hash: canonicalPacketHash,
                    result_hash: result.result_hash,
                    interpretation_standard: canonicalPacket.interpretation_standard,
                    interpretation_standard_version: canonicalPacket.interpretation_standard_version,
                    breakpoint_basis: result.breakpoint_basis,
                },
                observed_at: packet.observed_at,
            });
            return buildAMRLabFeedSurveillanceEventDraft({
                tenantId: input.tenantId,
                requestId: deterministicUuid(
                    `${input.requestId}:${resultIndex}:${result.result_hash}`,
                ),
                packet: surveillancePacket,
                evidence: {
                    canonical_ast_ingestion_request_id: input.requestId,
                    result_index: resultIndex,
                },
                observedAt: packet.observed_at,
            });
        })
        : [];

    return {
        accepted,
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        ingestion,
        results: accepted ? normalizedResults : [],
        surveillance_events: surveillanceEvents,
        canonical_packet_hash: canonicalPacketHash,
        source_record_digest: packet.source_record_digest,
    };
}

export function buildAMRExchangeAgreementSummaries(
    rows: AMRExchangeAgreementEventRow[],
    now = new Date().toISOString(),
): AMRExchangeAgreementSummary[] {
    const grouped = groupBy(rows, (row) => row.agreement_id);
    const nowMs = Date.parse(now);

    return Array.from(grouped.entries()).map(([agreementId, events]) => {
        const sorted = sortEvents(events);
        const latest = sorted.at(-1)!;
        const expiredByTime = Boolean(
            latest.expires_at
            && Number.isFinite(nowMs)
            && Date.parse(latest.expires_at) <= nowMs,
        );
        let status: AMRExchangeAgreementSummary['status'] = 'drafted';
        for (const event of sorted) {
            switch (event.event_type) {
                case 'offered':
                    status = 'offered';
                    break;
                case 'accepted':
                    status = 'accepted';
                    break;
                case 'activated':
                    status = 'active';
                    break;
                case 'suspended':
                    status = 'suspended';
                    break;
                case 'revoked':
                    status = 'revoked';
                    break;
                case 'expired':
                    status = 'expired';
                    break;
                default:
                    status = 'drafted';
            }
        }
        if (expiredByTime && !['revoked', 'expired'].includes(status)) status = 'expired';
        const blockers = uniqueStrings([
            ...(status !== 'active' ? [`agreement_status_${status}`] : []),
            ...(!isSha256(latest.terms_hash) ? ['terms_hash_invalid'] : []),
            ...(!isSha256(latest.data_use_agreement_hash) ? ['data_use_agreement_hash_invalid'] : []),
            ...(latest.pricing_model !== 'no_charge' && latest.unit_price_minor <= 0
                ? ['unit_price_missing']
                : []),
            ...(
                latest.privacy_class === 'deidentified_record'
                && (latest.permitted_use_cases ?? []).length === 0
                    ? ['permitted_use_cases_missing']
                    : []
            ),
        ]);

        return {
            agreement_id: agreementId,
            product_key: latest.product_key,
            provider_site_id: latest.provider_site_id ?? null,
            consumer_tenant_id: latest.consumer_tenant_id ?? null,
            counterparty_ref_hash: latest.counterparty_ref_hash ?? null,
            purpose: latest.purpose,
            license_key: latest.license_key,
            privacy_class: latest.privacy_class,
            permitted_species: latest.permitted_species ?? [],
            permitted_geographies: latest.permitted_geographies ?? [],
            permitted_use_cases: latest.permitted_use_cases ?? [],
            pricing_model: latest.pricing_model,
            currency: latest.currency,
            unit_price_minor: latest.unit_price_minor,
            platform_fee_bps: latest.platform_fee_bps,
            terms_hash: latest.terms_hash,
            data_use_agreement_hash: latest.data_use_agreement_hash,
            effective_at: latest.effective_at ?? null,
            expires_at: latest.expires_at ?? null,
            status,
            active: status === 'active' && blockers.length === 0,
            blockers,
            latest_event_at: readTimestamp(latest),
        };
    }).sort((left, right) => (right.latest_event_at ?? '').localeCompare(left.latest_event_at ?? ''));
}

export function validateAMRExchangeAgreementTransition(
    rows: AMRExchangeAgreementEventRow[],
    nextEvent: AMRExchangeEventType,
): string | null {
    const summary = rows.length > 0
        ? buildAMRExchangeAgreementSummaries(rows)[0] ?? null
        : null;
    if (!summary) return nextEvent === 'drafted' ? null : 'agreement_draft_required';
    if (summary.status === 'revoked' || summary.status === 'expired') {
        return 'terminal_agreement_cannot_transition';
    }
    if (nextEvent === 'drafted') return 'agreement_already_exists';
    if (nextEvent === 'offered') return summary.status === 'drafted' ? null : 'agreement_draft_required';
    if (nextEvent === 'accepted') return summary.status === 'offered' ? null : 'agreement_offer_required';
    if (nextEvent === 'activated') {
        return summary.status === 'accepted' || summary.status === 'suspended'
            ? null
            : 'agreement_acceptance_required';
    }
    if (nextEvent === 'suspended') return summary.status === 'active' ? null : 'active_agreement_required';
    return null;
}

export function buildAMRSettlementPreview(input: {
    agreement: AMRExchangeAgreementSummary;
    usageEvents: AMRExchangeUsageEventRow[];
    priorSettlementEvents?: AMRExchangeSettlementEventRow[];
    periodStart: string;
    periodEnd: string;
}): {
    usage_event_count: number;
    total_quantity: number;
    gross_amount_minor: number;
    platform_fee_minor: number;
    provider_net_amount_minor: number;
    currency: string;
    source_digest_bundle_hash: string;
    usage_event_ids: string[];
} {
    const periodStartMs = Date.parse(input.periodStart);
    const periodEndMs = Date.parse(input.periodEnd);
    if (!Number.isFinite(periodStartMs) || !Number.isFinite(periodEndMs) || periodEndMs <= periodStartMs) {
        throw new Error('Settlement period is invalid.');
    }
    const latestSettlementEvents = latestBy(
        input.priorSettlementEvents ?? [],
        (event) => event.settlement_id,
    );
    const settledDigests = new Set(
        Array.from(latestSettlementEvents.values())
            .filter((event) => event.event_type !== 'voided')
            .map((event) => event.source_digest_bundle_hash),
    );
    const eligible = input.usageEvents.filter((event) => {
        const meteredAt = Date.parse(event.metered_at ?? event.created_at ?? '');
        return event.agreement_id === input.agreement.agreement_id
            && event.usage_status === 'metered'
            && meteredAt >= periodStartMs
            && meteredAt < periodEndMs;
    });
    const sourceDigestBundleHash = hashAMRNetworkJson(
        eligible.map((event) => ({
            id: event.id,
            source_digest: event.source_digest,
            quantity: event.quantity,
            amount_minor: event.amount_minor,
        })).sort((left, right) => left.id.localeCompare(right.id)),
    );
    if (eligible.length > 0 && settledDigests.has(sourceDigestBundleHash)) {
        throw new Error('Usage bundle was already settled.');
    }
    const grossAmountMinor = eligible.reduce(
        (sum, event) => sum + Math.max(0, event.amount_minor),
        0,
    );
    const platformFeeMinor = Math.round(
        grossAmountMinor * input.agreement.platform_fee_bps / 10_000,
    );

    return {
        usage_event_count: eligible.length,
        total_quantity: roundMetric(eligible.reduce(
            (sum, event) => sum + Math.max(0, event.quantity),
            0,
        )),
        gross_amount_minor: grossAmountMinor,
        platform_fee_minor: platformFeeMinor,
        provider_net_amount_minor: grossAmountMinor - platformFeeMinor,
        currency: input.agreement.currency,
        source_digest_bundle_hash: sourceDigestBundleHash,
        usage_event_ids: eligible.map((event) => event.id).sort(),
    };
}

export function buildAMRNetworkOperationsSnapshot(input: {
    connectorProbes: AMRConnectorProbeEventRow[];
    ingestionEvents: AMRASTIngestionEventRow[];
    reconciliationEvents: AMRASTReconciliationEventRow[];
    agreementEvents: AMRExchangeAgreementEventRow[];
    usageEvents: AMRExchangeUsageEventRow[];
    settlementEvents: AMRExchangeSettlementEventRow[];
    generatedAt?: string;
}): AMRNetworkOperationsSnapshot {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const now = parseTimestamp(generatedAt) ?? new Date();
    const latestProbeBySite = latestBy(input.connectorProbes, (row) => row.site_id);
    const connectorRows = Array.from(latestProbeBySite.values()).map((probe) => {
        const occurredAt = parseTimestamp(probe.occurred_at ?? probe.created_at);
        const stale = !occurredAt
            || hoursBetween(occurredAt, now) > AMR_CONNECTOR_PROBE_MAX_AGE_HOURS;
        const productionProof = probe.probe_status === 'passed'
            && ['production_probe', 'heartbeat'].includes(probe.probe_type)
            && probe.token_binding_method === 'mtls'
            && isSha256(probe.certificate_thumbprint_hash);
        const status = probe.probe_status !== 'passed'
            ? 'failed'
            : !productionProof
                ? 'non_production'
                : stale
                    ? 'stale'
                    : 'verified';
        return {
            site_id: probe.site_id,
            status: status as 'verified' | 'stale' | 'failed' | 'non_production',
            source_system: probe.source_system,
            connector_version: probe.connector_version,
            schema_version: probe.schema_version,
            last_probe_at: occurredAt?.toISOString() ?? null,
            observed_record_count: probe.observed_record_count,
            token_binding_method: probe.token_binding_method,
            blockers: uniqueStrings([
                ...(probe.blockers ?? []),
                ...(stale ? ['connector_probe_stale'] : []),
                ...(!productionProof ? ['production_workload_proof_missing'] : []),
            ]),
        };
    }).sort((left, right) => (right.last_probe_at ?? '').localeCompare(left.last_probe_at ?? ''));

    const latestReconciliation = latestBy(
        input.reconciliationEvents,
        (row) => row.ingestion_event_id,
    );
    const accepted = input.ingestionEvents.filter((event) => event.ingestion_status === 'accepted');
    const blocked = input.ingestionEvents.filter((event) => event.ingestion_status === 'blocked');
    const pending = accepted.filter((event) => {
        const status = latestReconciliation.get(event.id)?.reconciliation_event;
        return !status || status === 'queued' || status === 'requeued' || status === 'unmatched';
    });
    const matched = accepted.filter(
        (event) => latestReconciliation.get(event.id)?.reconciliation_event === 'matched',
    );
    const failedReconciliation = input.reconciliationEvents.filter(
        (event) => event.reconciliation_event === 'failed'
            || event.reconciliation_event === 'blocked',
    ).length;

    const agreements = buildAMRExchangeAgreementSummaries(
        input.agreementEvents,
        generatedAt,
    );
    const activeAgreements = agreements.filter((agreement) => agreement.active);
    const meteredUsage = input.usageEvents.filter((event) => event.usage_status === 'metered');
    const amountsByCurrency = buildExchangeCurrencyTotals({
        usageEvents: meteredUsage,
        settlementEvents: input.settlementEvents,
        agreementCurrencies: activeAgreements.map((agreement) => agreement.currency),
    });
    const singleCurrencyAmounts = amountsByCurrency.length === 1
        ? amountsByCurrency[0]
        : null;
    const currency = singleCurrencyAmounts?.currency ?? null;
    const marketplaceReady = connectorRows.some((row) => row.status === 'verified')
        && activeAgreements.length > 0
        && accepted.length > 0
        && pending.length === 0;
    const blockers = uniqueStrings([
        ...(!connectorRows.some((row) => row.status === 'verified')
            ? ['verified_production_connector_required']
            : []),
        ...(activeAgreements.length === 0 ? ['active_exchange_agreement_required'] : []),
        ...(accepted.length === 0 ? ['accepted_canonical_ast_packet_required'] : []),
        ...(pending.length > 0 ? [`${pending.length}_ast_reconciliations_pending`] : []),
        ...(connectorRows.some((row) => row.status === 'stale') ? ['stale_connector_probe_detected'] : []),
        ...(amountsByCurrency.length > 1 ? ['mixed_currency_totals_require_separate_views'] : []),
    ]);
    const snapshotWithoutHash = {
        schema_version: 'amr-network-operations-exchange-v1' as const,
        generated_at: generatedAt,
        connectors: {
            total_sites: connectorRows.length,
            production_verified: connectorRows.filter((row) => row.status === 'verified').length,
            stale: connectorRows.filter((row) => row.status === 'stale').length,
            failed: connectorRows.filter((row) => row.status === 'failed').length,
            rows: connectorRows,
        },
        ingestion: {
            total: input.ingestionEvents.length,
            accepted: accepted.length,
            blocked: blocked.length,
            result_count: accepted.reduce((sum, event) => sum + Math.max(0, event.result_count), 0),
            pending_reconciliation: pending.length,
            matched: matched.length,
            failed_reconciliation: failedReconciliation,
            rows: [...input.ingestionEvents]
                .sort((left, right) => (right.observed_at ?? '').localeCompare(left.observed_at ?? ''))
                .slice(0, 100),
        },
        exchange: {
            agreements_total: agreements.length,
            agreements_active: activeAgreements.length,
            metered_events: meteredUsage.length,
            metered_amount_minor: singleCurrencyAmounts?.metered_amount_minor ?? 0,
            unsettled_amount_minor: singleCurrencyAmounts?.unsettled_amount_minor ?? 0,
            currency,
            amounts_by_currency: amountsByCurrency,
            settlement_events: input.settlementEvents.length,
            agreements,
        },
        marketplace_ready: marketplaceReady,
        blockers,
        next_actions: uniqueStrings([
            ...(!connectorRows.some((row) => row.status === 'verified')
                ? ['complete_mtls_bound_production_probe']
                : []),
            ...(activeAgreements.length === 0 ? ['activate_first_private_exchange_agreement'] : []),
            ...(accepted.length === 0 ? ['ingest_first_canonical_culture_ast_packet'] : []),
            ...(pending.length > 0 ? ['reconcile_ast_packets_to_clinical_episodes'] : []),
            ...(marketplaceReady ? ['meter_governed_usage_and_prepare_settlement'] : []),
        ]),
    };

    return {
        ...snapshotWithoutHash,
        proof_hash: hashAMRNetworkJson(snapshotWithoutHash),
    };
}

export function buildAMRUsageEvent(input: {
    tenantId: string;
    requestId: string;
    agreement: AMRExchangeAgreementSummary;
    sourceType: AMRExchangeUsageEventRow['source_type'];
    sourceEventId: string;
    sourceDigest: string;
    quantity?: number;
    unit?: string;
    evidence?: Record<string, unknown>;
}): Record<string, unknown> {
    const quantity = Math.max(0.000001, input.quantity ?? 1);
    const unitPriceMinor = input.agreement.pricing_model === 'no_charge'
        ? 0
        : input.agreement.unit_price_minor;
    const amountMinor = Math.round(quantity * unitPriceMinor);
    const event = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        agreement_id: input.agreement.agreement_id,
        product_key: input.agreement.product_key,
        meter_key: `${input.agreement.product_key}:${input.unit ?? 'record'}`,
        source_type: input.sourceType,
        source_event_id: input.sourceEventId,
        source_digest: input.sourceDigest,
        quantity,
        unit: input.unit ?? 'record',
        unit_price_minor: unitPriceMinor,
        amount_minor: amountMinor,
        currency: input.agreement.currency,
        usage_status: input.agreement.active ? 'metered' : 'excluded',
        blockers: input.agreement.active ? [] : input.agreement.blockers,
        evidence: input.evidence ?? {},
    };
    return {
        ...event,
        event_hash: hashAMRNetworkJson(event),
    };
}

function validateASTResult(result: AMRASTResultInput): string[] {
    const blockers: string[] = [];
    if (!result.antimicrobial_label.trim()) blockers.push('antimicrobial_label_missing');
    if (result.measurement_type === 'mic') {
        if (result.mic_value == null || !Number.isFinite(result.mic_value) || result.mic_value < 0) {
            blockers.push('mic_value_invalid');
        }
        if (!result.mic_unit?.trim()) blockers.push('mic_unit_missing');
    }
    if (result.measurement_type === 'disk_diffusion') {
        if (
            result.zone_diameter_mm == null
            || !Number.isFinite(result.zone_diameter_mm)
            || result.zone_diameter_mm <= 0
        ) {
            blockers.push('zone_diameter_invalid');
        }
    }
    if (result.measurement_type === 'qualitative' && !result.qualitative_result?.trim()) {
        blockers.push('qualitative_result_missing');
    }
    return blockers;
}

function latestBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
    const map = new Map<string, T>();
    for (const row of rows) {
        const existing = map.get(key(row));
        if (!existing || readTimestamp(row) >= readTimestamp(existing)) {
            map.set(key(row), row);
        }
    }
    return map;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
        const groupKey = key(row);
        grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), row]);
    }
    return grouped;
}

function sortEvents<T>(rows: T[]): T[] {
    return [...rows].sort((left, right) => readTimestamp(left).localeCompare(readTimestamp(right)));
}

function readTimestamp(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const row = value as Record<string, unknown>;
    for (const key of ['occurred_at', 'metered_at', 'observed_at', 'created_at']) {
        const candidate = row[key];
        if (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate))) return candidate;
    }
    return '';
}

function parseTimestamp(value: string | null | undefined): Date | null {
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    return new Date(value);
}

function hoursBetween(left: Date, right: Date): number {
    return Math.max(0, right.getTime() - left.getTime()) / 3_600_000;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized || null;
}

function normalizeOptionalLabel(value: string | null | undefined): string | null {
    const normalized = normalizeOptionalText(value);
    return normalized ? normalizeAMRLabel(normalized) : null;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).sort();
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function deterministicUuid(value: string): string {
    const hash = createHash('sha256').update(value).digest('hex');
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `4${hash.slice(13, 16)}`,
        `8${hash.slice(17, 20)}`,
        hash.slice(20, 32),
    ].join('-');
}

function buildExchangeCurrencyTotals(input: {
    usageEvents: AMRExchangeUsageEventRow[];
    settlementEvents: AMRExchangeSettlementEventRow[];
    agreementCurrencies: string[];
}) {
    const latestSettlements = Array.from(
        latestBy(input.settlementEvents, (row) => row.settlement_id).values(),
    ).filter((event) => event.event_type !== 'voided');
    const currencies = uniqueStrings([
        ...input.agreementCurrencies,
        ...input.usageEvents.map((event) => event.currency),
        ...latestSettlements.map((event) => event.currency),
    ]);
    return currencies.map((currency) => {
        const meteredAmount = input.usageEvents
            .filter((event) => event.currency === currency)
            .reduce((sum, event) => sum + Math.max(0, event.amount_minor), 0);
        const settledAmount = latestSettlements
            .filter((event) => event.currency === currency)
            .reduce((sum, event) => sum + Math.max(0, event.gross_amount_minor), 0);
        return {
            currency,
            metered_amount_minor: meteredAmount,
            settled_amount_minor: settledAmount,
            unsettled_amount_minor: Math.max(0, meteredAmount - settledAmount),
        };
    });
}

function roundMetric(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}
