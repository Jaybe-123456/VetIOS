import { createHash } from 'crypto';

export type AMRStewardshipEventRow = {
    species: string | null;
    pathogen_label?: string | null;
    infection_site?: string | null;
    drug_name?: string | null;
    drug_class?: string | null;
    decision_stage?: string | null;
    stewardship_status?: string | null;
    outcome_status?: string | null;
    culture_collected?: boolean | null;
    resistance_suspected?: boolean | null;
    de_escalation_recommended?: boolean | null;
    review_required?: boolean | null;
    resistance_classes?: string[] | null;
    observed_at?: string | null;
};

export type AMRStewardshipAggregate = {
    total_events: number;
    culture_guided_events: number;
    culture_guided_rate: number;
    resistance_suspected_events: number;
    resistance_suspected_rate: number;
    review_required_events: number;
    review_required_rate: number;
    de_escalation_recommended_events: number;
    top_drug_classes: Array<{ drug_class: string; count: number }>;
    top_pathogens: Array<{ pathogen_label: string; count: number }>;
    outcome_statuses: Array<{ outcome_status: string; count: number }>;
    stewardship_statuses: Array<{ stewardship_status: string; count: number }>;
    resistance_classes: Array<{ resistance_class: string; count: number }>;
    latest_observed_at: string | null;
};

export type AMRLabFeedStatus =
    | 'blocked'
    | 'culture_pending'
    | 'ast_ready'
    | 'resistance_signal'
    | 'one_health_export_ready';

export interface AMRLabFeedSurveillanceInput {
    request_id?: string | null;
    species: string;
    pathogen_label?: string | null;
    syndrome?: string | null;
    infection_site?: string | null;
    sample_source?: string | null;
    culture_collected: boolean;
    culture_result?: string | null;
    ast_method?: string | null;
    ast_panel?: Record<string, unknown> | null;
    mic_results?: Record<string, unknown> | null;
    resistance_genes?: string[] | null;
    resistance_classes?: string[] | null;
    drug_name: string;
    drug_class?: string | null;
    decision_stage?: string | null;
    stewardship_status?: string | null;
    outcome_status?: string | null;
    resistance_suspected?: boolean | null;
    de_escalation_recommended?: boolean | null;
    evidence?: Record<string, unknown> | null;
    observed_at?: string | null;
}

export interface AMRLabFeedSurveillancePacket {
    schema_version: 'amr-lab-feed-surveillance-v1';
    lab_feed_status: AMRLabFeedStatus;
    surveillance_score: number;
    resistance_signal_score: number;
    normalization: {
        species: string;
        pathogen_label: string | null;
        pathogen_key: string | null;
        syndrome: string | null;
        infection_site: string | null;
        sample_source: string | null;
        drug_name: string;
        drug_class: string | null;
        trend_bucket_key: string;
    };
    ast: {
        culture_collected: boolean;
        culture_result: string | null;
        ast_method: string | null;
        ast_panel_drug_count: number;
        mic_result_count: number;
        susceptibility_result_count: number;
        interpretation_counts: {
            susceptible: number;
            intermediate: number;
            resistant: number;
            unknown: number;
        };
        resistance_gene_count: number;
        resistance_class_count: number;
        ast_ready: boolean;
    };
    surveillance: {
        lab_partner_feed_ready: boolean;
        one_health_export_ready: boolean;
        resistance_suspected: boolean;
        de_escalation_recommended: boolean;
        outcome_status: string | null;
    };
    provenance: {
        source_record_digest: string;
        ast_panel_hash: string;
        mic_results_hash: string;
        evidence_hash: string;
    };
    privacy: {
        raw_lab_report_stored: false;
        direct_identifier_risk: boolean;
        detected_identifier_paths: string[];
    };
    blockers: string[];
    warnings: string[];
    next_actions: string[];
}

export interface AMRLabFeedSurveillanceEventDraft {
    tenant_id: string;
    request_id: string;
    amr_stewardship_event_id: string | null;
    case_id: string | null;
    inference_event_id: string | null;
    clinical_outcome_id: string | null;
    species: string;
    pathogen_label: string | null;
    pathogen_key: string | null;
    infection_site: string | null;
    sample_source: string | null;
    drug_name: string;
    drug_class: string | null;
    ast_method: string | null;
    culture_collected: boolean;
    culture_result: string | null;
    lab_feed_status: AMRLabFeedStatus;
    surveillance_score: number;
    resistance_signal_score: number;
    ast_panel_drug_count: number;
    mic_result_count: number;
    susceptibility_result_count: number;
    resistance_gene_count: number;
    resistance_class_count: number;
    lab_partner_feed_ready: boolean;
    one_health_export_ready: boolean;
    trend_bucket_key: string;
    source_record_digest: string;
    packet_hash: string;
    ast_panel_hash: string;
    mic_results_hash: string;
    evidence_hash: string;
    surveillance_packet: AMRLabFeedSurveillancePacket;
    blockers: string[];
    warnings: string[];
    next_actions: string[];
    evidence: Record<string, unknown>;
    observed_at: string;
}

export interface AMRLabFeedSurveillanceEventRow {
    species: string | null;
    pathogen_label?: string | null;
    pathogen_key?: string | null;
    infection_site?: string | null;
    sample_source?: string | null;
    drug_name?: string | null;
    drug_class?: string | null;
    lab_feed_status?: AMRLabFeedStatus | string | null;
    surveillance_score?: number | null;
    resistance_signal_score?: number | null;
    ast_panel_drug_count?: number | null;
    mic_result_count?: number | null;
    susceptibility_result_count?: number | null;
    resistance_gene_count?: number | null;
    resistance_class_count?: number | null;
    lab_partner_feed_ready?: boolean | null;
    one_health_export_ready?: boolean | null;
    trend_bucket_key?: string | null;
    source_record_digest?: string | null;
    packet_hash?: string | null;
    surveillance_packet?: AMRLabFeedSurveillancePacket | Record<string, unknown> | null;
    blockers?: string[] | null;
    warnings?: string[] | null;
    observed_at?: string | null;
}

export interface AMROneHealthExportPacket {
    schema_version: 'amr-one-health-export-v1';
    generated_at: string;
    period: {
        start_at: string | null;
        end_at: string | null;
    };
    export_status: 'blocked' | 'foundation' | 'export_ready';
    summary: {
        total_rows: number;
        export_ready_rows: number;
        lab_partner_feed_ready_rows: number;
        resistance_signal_rows: number;
        unique_trend_buckets: number;
        average_surveillance_score: number;
        average_resistance_signal_score: number;
    };
    trends: Array<{
        trend_bucket_key: string;
        species: string;
        pathogen_key: string;
        pathogen_label: string | null;
        infection_site: string | null;
        sample_source: string | null;
        drug_class: string | null;
        drug_name: string | null;
        sample_count: number;
        export_ready_count: number;
        resistance_signal_count: number;
        resistance_signal_rate: number;
        interpretation_counts: {
            susceptible: number;
            intermediate: number;
            resistant: number;
            unknown: number;
        };
        average_surveillance_score: number;
        average_resistance_signal_score: number;
        latest_observed_at: string | null;
        source_digest_bundle_hash: string;
    }>;
    provenance: {
        source_table: 'amr_lab_feed_surveillance_events';
        source_row_count: number;
        source_digest_bundle_hash: string;
        export_packet_hash: string;
    };
    privacy_contract: string[];
    blockers: string[];
    warnings: string[];
    next_actions: string[];
}

export interface AMRLabFeedIngestionRowInput extends AMRLabFeedSurveillanceInput {
    request_id: string;
    amr_stewardship_event_id?: string | null;
    case_id?: string | null;
    inference_event_id?: string | null;
    clinical_outcome_id?: string | null;
}

export interface AMRLabFeedIngestionBatchInput {
    tenant_id: string;
    lab_partner_ref?: string | null;
    feed_source?: string | null;
    rows: AMRLabFeedIngestionRowInput[];
    generated_at?: string | null;
}

export interface AMRLabFeedIngestionBatchPacket {
    schema_version: 'amr-lab-feed-ingestion-batch-v1';
    generated_at: string;
    tenant_id: string;
    lab_partner_ref_hash: string | null;
    feed_source: string;
    ingestion_status: 'blocked' | 'partial' | 'ready';
    summary: {
        submitted_rows: number;
        event_draft_count: number;
        blocked_rows: number;
        duplicate_source_digest_count: number;
        lab_partner_feed_ready_rows: number;
        one_health_export_ready_rows: number;
        resistance_signal_rows: number;
        unique_trend_buckets: number;
        taxonomy_completion_score: number;
        average_surveillance_score: number;
        average_resistance_signal_score: number;
    };
    event_drafts: AMRLabFeedSurveillanceEventDraft[];
    one_health_export_packet: AMROneHealthExportPacket;
    provenance: {
        source_table: 'amr_lab_feed_surveillance_events';
        source_digest_bundle_hash: string;
        event_packet_hash_bundle: string;
        ingestion_packet_hash: string;
    };
    privacy_contract: string[];
    blockers: string[];
    warnings: string[];
    next_actions: string[];
}

type AMRInterpretationCounts = {
    susceptible: number;
    intermediate: number;
    resistant: number;
    unknown: number;
};

type AMRLabFeedExportRow = {
    species: string;
    pathogen_label: string | null;
    pathogen_key: string;
    infection_site: string | null;
    sample_source: string | null;
    drug_name: string | null;
    drug_class: string | null;
    lab_feed_status: string;
    surveillance_score: number;
    resistance_signal_score: number;
    lab_partner_feed_ready: boolean;
    one_health_export_ready: boolean;
    trend_bucket_key: string;
    source_record_digest: string | null;
    packet_hash: string | null;
    interpretation_counts: AMRInterpretationCounts;
    blockers: string[];
    warnings: string[];
    observed_at: string | null;
};

export const AMR_DECISION_STAGES = [
    'unknown',
    'empiric',
    'culture_guided',
    'de_escalated',
    'escalated',
    'stopped',
    'prophylaxis',
    'watchful_waiting',
] as const;

export const AMR_STEWARDSHIP_STATUSES = [
    'monitoring',
    'pending_culture',
    'culture_guided',
    'non_antimicrobial',
    'watchful_waiting',
    'success',
    'failure',
    'relapse',
    'adverse_event',
] as const;

export const AMR_OUTCOME_STATUSES = [
    'improved',
    'resolved',
    'unchanged',
    'worsened',
    'relapsed',
    'adverse_event',
    'unknown',
] as const;

const PATHOGEN_TAXONOMY_ALIASES: Record<string, string> = {
    e_coli: 'escherichia_coli',
    ecoli: 'escherichia_coli',
    escherichia_coli: 'escherichia_coli',
    staph_pseudintermedius: 'staphylococcus_pseudintermedius',
    s_pseudintermedius: 'staphylococcus_pseudintermedius',
    staphylococcus_pseudintermedius: 'staphylococcus_pseudintermedius',
    staphylococcus_intermedius_group: 'staphylococcus_pseudintermedius',
    pseudomonas_aeruginosa: 'pseudomonas_aeruginosa',
    klebsiella_pneumoniae: 'klebsiella_pneumoniae',
    enterococcus_faecalis: 'enterococcus_faecalis',
    proteus_mirabilis: 'proteus_mirabilis',
};

const DRUG_CLASS_TAXONOMY_ALIASES: Record<string, string> = {
    beta_lactams: 'beta_lactam',
    beta_lactam: 'beta_lactam',
    betalactam: 'beta_lactam',
    cephalosporins: 'cephalosporin',
    cephalosporin: 'cephalosporin',
    fluoroquinolones: 'fluoroquinolone',
    fluoroquinolone: 'fluoroquinolone',
    tetracyclines: 'tetracycline',
    tetracycline: 'tetracycline',
    aminoglycosides: 'aminoglycoside',
    aminoglycoside: 'aminoglycoside',
    sulfonamides: 'sulfonamide',
    sulfonamide: 'sulfonamide',
};

export function normalizeAMRLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function normalizeOptionalAMRLabel(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = normalizeAMRLabel(value);
    return normalized || null;
}

export function normalizeAMRString(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized || null;
}

export function normalizeAMRStringList(value: string[] | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(normalizeOptionalAMRLabel).filter((item): item is string => Boolean(item))));
}

export function normalizeAMRPathogenTaxonomy(value: string | null | undefined): {
    pathogen_label: string | null;
    pathogen_key: string | null;
} {
    const normalized = normalizeOptionalAMRLabel(value);
    if (!normalized) return { pathogen_label: null, pathogen_key: null };
    const key = PATHOGEN_TAXONOMY_ALIASES[normalizePathogenKey(normalized)] ?? normalizePathogenKey(normalized);
    return {
        pathogen_label: key,
        pathogen_key: key,
    };
}

export function normalizeAMRDrugClassTaxonomy(value: string | null | undefined): string | null {
    const normalized = normalizeOptionalAMRLabel(value);
    if (!normalized) return null;
    return DRUG_CLASS_TAXONOMY_ALIASES[normalized] ?? normalized;
}

export function aggregateAMRStewardship(rows: AMRStewardshipEventRow[]): AMRStewardshipAggregate {
    const total = rows.length;
    const cultureGuided = rows.filter((row) => row.culture_collected === true || row.decision_stage === 'culture_guided').length;
    const resistanceSuspected = rows.filter((row) => row.resistance_suspected === true).length;
    const reviewRequired = rows.filter((row) => row.review_required === true).length;
    const deEscalation = rows.filter((row) => row.de_escalation_recommended === true).length;

    return {
        total_events: total,
        culture_guided_events: cultureGuided,
        culture_guided_rate: ratio(cultureGuided, total),
        resistance_suspected_events: resistanceSuspected,
        resistance_suspected_rate: ratio(resistanceSuspected, total),
        review_required_events: reviewRequired,
        review_required_rate: ratio(reviewRequired, total),
        de_escalation_recommended_events: deEscalation,
        top_drug_classes: countTop(rows.map((row) => row.drug_class), 'unknown').map(([drug_class, count]) => ({ drug_class, count })),
        top_pathogens: countTop(rows.map((row) => row.pathogen_label), 'unknown').map(([pathogen_label, count]) => ({ pathogen_label, count })),
        outcome_statuses: countTop(rows.map((row) => row.outcome_status), 'unknown').map(([outcome_status, count]) => ({ outcome_status, count })),
        stewardship_statuses: countTop(rows.map((row) => row.stewardship_status), 'unknown').map(([stewardship_status, count]) => ({ stewardship_status, count })),
        resistance_classes: countTop(rows.flatMap((row) => row.resistance_classes ?? []), 'unknown').map(([resistance_class, count]) => ({ resistance_class, count })),
        latest_observed_at: latestObservedAt(rows),
    };
}

export function buildAMRLabFeedSurveillancePacket(input: AMRLabFeedSurveillanceInput): AMRLabFeedSurveillancePacket {
    const species = normalizeAMRLabel(input.species);
    const pathogenTaxonomy = normalizeAMRPathogenTaxonomy(input.pathogen_label);
    const pathogenLabel = pathogenTaxonomy.pathogen_label;
    const pathogenKey = pathogenTaxonomy.pathogen_key;
    const syndrome = normalizeOptionalAMRLabel(input.syndrome);
    const infectionSite = normalizeOptionalAMRLabel(input.infection_site);
    const sampleSource = normalizeOptionalAMRLabel(input.sample_source);
    const drugName = normalizeAMRLabel(input.drug_name);
    const drugClass = normalizeAMRDrugClassTaxonomy(input.drug_class);
    const astPanel = input.ast_panel ?? {};
    const micResults = input.mic_results ?? {};
    const resistanceGenes = normalizeAMRStringList(input.resistance_genes ?? []);
    const resistanceClasses = normalizeAMRStringList(input.resistance_classes ?? []);
    const astPanelDrugCount = countRecordLeaves(astPanel);
    const micResultCount = countRecordLeaves(micResults);
    const susceptibilityResultCount = countSusceptibilityResults(astPanel);
    const interpretationCounts = countASTInterpretations(astPanel);
    const astReady = Boolean(input.culture_collected && (astPanelDrugCount > 0 || micResultCount > 0 || susceptibilityResultCount > 0));
    const identifierPaths = findDirectIdentifierPaths({
        ast_panel: astPanel,
        mic_results: micResults,
        evidence: input.evidence ?? {},
    });
    const blockers = new Set<string>();
    const warnings = new Set<string>();

    if (identifierPaths.length > 0) blockers.add('direct_identifier_risk_in_amr_lab_feed');
    if (!input.culture_collected && !astReady) blockers.add('culture_or_ast_feed_missing');
    if (input.culture_collected && !pathogenLabel) warnings.add('pathogen_taxonomy_missing');
    if (!drugClass) warnings.add('drug_class_taxonomy_missing');
    if (!infectionSite && !sampleSource) warnings.add('infection_site_or_sample_source_missing');
    if (input.culture_collected && !astReady) warnings.add('culture_collected_but_ast_not_ready');

    const resistanceSignalScore = scoreResistanceSignal({
        resistance_suspected: input.resistance_suspected === true,
        resistance_gene_count: resistanceGenes.length,
        resistance_class_count: resistanceClasses.length,
        susceptibility_result_count: susceptibilityResultCount,
        mic_result_count: micResultCount,
    });
    const labPartnerFeedReady = astReady && Boolean(pathogenLabel && drugName);
    const oneHealthExportReady = labPartnerFeedReady
        && Boolean(species && pathogenKey && (infectionSite || sampleSource) && drugClass)
        && blockers.size === 0;
    const trendBucketKey = [
        species,
        pathogenKey ?? 'unknown_pathogen',
        infectionSite ?? sampleSource ?? 'unknown_site',
        drugClass ?? drugName,
    ].join(':');
    const labFeedStatus = resolveAMRLabFeedStatus({
        blockerCount: blockers.size,
        cultureCollected: input.culture_collected,
        astReady,
        resistanceSignalScore,
        oneHealthExportReady,
    });
    const surveillanceScore = scoreAMRSurveillance({
        cultureCollected: input.culture_collected,
        astReady,
        pathogenLabel,
        drugClass,
        infectionSite,
        sampleSource,
        outcomeStatus: input.outcome_status ?? null,
        oneHealthExportReady,
        blockerCount: blockers.size,
    });
    const sourceRecordDigest = hashJson({
        request_id: input.request_id ?? null,
        species,
        pathogen_key: pathogenKey,
        syndrome,
        infection_site: infectionSite,
        sample_source: sampleSource,
        drug_name: drugName,
        drug_class: drugClass,
        ast_panel_hash: hashJson(astPanel),
        mic_results_hash: hashJson(micResults),
        resistance_genes: resistanceGenes,
        resistance_classes: resistanceClasses,
        observed_at: input.observed_at ?? null,
    });

    return {
        schema_version: 'amr-lab-feed-surveillance-v1',
        lab_feed_status: labFeedStatus,
        surveillance_score: surveillanceScore,
        resistance_signal_score: resistanceSignalScore,
        normalization: {
            species,
            pathogen_label: pathogenLabel,
            pathogen_key: pathogenKey,
            syndrome,
            infection_site: infectionSite,
            sample_source: sampleSource,
            drug_name: drugName,
            drug_class: drugClass,
            trend_bucket_key: trendBucketKey,
        },
        ast: {
            culture_collected: input.culture_collected,
            culture_result: normalizeOptionalAMRLabel(input.culture_result),
            ast_method: normalizeOptionalAMRLabel(input.ast_method),
            ast_panel_drug_count: astPanelDrugCount,
            mic_result_count: micResultCount,
            susceptibility_result_count: susceptibilityResultCount,
            interpretation_counts: interpretationCounts,
            resistance_gene_count: resistanceGenes.length,
            resistance_class_count: resistanceClasses.length,
            ast_ready: astReady,
        },
        surveillance: {
            lab_partner_feed_ready: labPartnerFeedReady,
            one_health_export_ready: oneHealthExportReady,
            resistance_suspected: input.resistance_suspected === true,
            de_escalation_recommended: input.de_escalation_recommended === true,
            outcome_status: input.outcome_status ?? null,
        },
        provenance: {
            source_record_digest: sourceRecordDigest,
            ast_panel_hash: hashJson(astPanel),
            mic_results_hash: hashJson(micResults),
            evidence_hash: hashJson(input.evidence ?? {}),
        },
        privacy: {
            raw_lab_report_stored: false,
            direct_identifier_risk: identifierPaths.length > 0,
            detected_identifier_paths: identifierPaths,
        },
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        next_actions: buildAMRLabFeedNextActions({
            labFeedStatus,
            astReady,
            pathogenLabel,
            drugClass,
            infectionSite,
            sampleSource,
            oneHealthExportReady,
        }),
    };
}

export function buildAMRLabFeedSurveillanceEventDraft(input: {
    tenantId: string;
    requestId: string;
    amrStewardshipEventId?: string | null;
    caseId?: string | null;
    inferenceEventId?: string | null;
    clinicalOutcomeId?: string | null;
    packet: AMRLabFeedSurveillancePacket;
    evidence?: Record<string, unknown>;
    observedAt?: string | null;
}): AMRLabFeedSurveillanceEventDraft {
    const packet = input.packet;

    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        amr_stewardship_event_id: input.amrStewardshipEventId ?? null,
        case_id: input.caseId ?? null,
        inference_event_id: input.inferenceEventId ?? null,
        clinical_outcome_id: input.clinicalOutcomeId ?? null,
        species: packet.normalization.species,
        pathogen_label: packet.normalization.pathogen_label,
        pathogen_key: packet.normalization.pathogen_key,
        infection_site: packet.normalization.infection_site,
        sample_source: packet.normalization.sample_source,
        drug_name: packet.normalization.drug_name,
        drug_class: packet.normalization.drug_class,
        ast_method: packet.ast.ast_method,
        culture_collected: packet.ast.culture_collected,
        culture_result: packet.ast.culture_result,
        lab_feed_status: packet.lab_feed_status,
        surveillance_score: packet.surveillance_score,
        resistance_signal_score: packet.resistance_signal_score,
        ast_panel_drug_count: packet.ast.ast_panel_drug_count,
        mic_result_count: packet.ast.mic_result_count,
        susceptibility_result_count: packet.ast.susceptibility_result_count,
        resistance_gene_count: packet.ast.resistance_gene_count,
        resistance_class_count: packet.ast.resistance_class_count,
        lab_partner_feed_ready: packet.surveillance.lab_partner_feed_ready,
        one_health_export_ready: packet.surveillance.one_health_export_ready,
        trend_bucket_key: packet.normalization.trend_bucket_key,
        source_record_digest: packet.provenance.source_record_digest,
        packet_hash: hashJson(packet),
        ast_panel_hash: packet.provenance.ast_panel_hash,
        mic_results_hash: packet.provenance.mic_results_hash,
        evidence_hash: packet.provenance.evidence_hash,
        surveillance_packet: packet,
        blockers: packet.blockers,
        warnings: packet.warnings,
        next_actions: packet.next_actions,
        evidence: {
            ...input.evidence,
            packet_schema_version: packet.schema_version,
            raw_lab_report_stored: false,
            raw_owner_or_patient_identifiers_stored: false,
            source_record_digest: packet.provenance.source_record_digest,
        },
        observed_at: input.observedAt ?? new Date().toISOString(),
    };
}

export function buildAMROneHealthExportPacket(input: {
    rows: AMRLabFeedSurveillanceEventRow[];
    periodStart?: string | null;
    periodEnd?: string | null;
    generatedAt?: string | null;
}): AMROneHealthExportPacket {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const rows = input.rows.map(normalizeAMRLabFeedRowForExport);
    const exportReadyRows = rows.filter((row) => row.one_health_export_ready);
    const labPartnerRows = rows.filter((row) => row.lab_partner_feed_ready);
    const resistanceRows = rows.filter((row) => isResistanceSignalRow(row));
    const trends = buildAMRTrendGroups(rows);
    const blockers = buildAMROneHealthExportBlockers(rows, exportReadyRows.length);
    const warnings = buildAMROneHealthExportWarnings(rows, trends.length);
    const sourceDigestBundleHash = hashJson(rows.map((row) => ({
        source_record_digest: row.source_record_digest,
        packet_hash: row.packet_hash,
        trend_bucket_key: row.trend_bucket_key,
        observed_at: row.observed_at,
    })));
    const packetWithoutHash = {
        schema_version: 'amr-one-health-export-v1' as const,
        generated_at: generatedAt,
        period: {
            start_at: input.periodStart ?? oldestObservedAt(rows),
            end_at: input.periodEnd ?? latestObservedAt(rows),
        },
        export_status: resolveAMROneHealthExportStatus({
            rowCount: rows.length,
            exportReadyRows: exportReadyRows.length,
            blockers,
        }),
        summary: {
            total_rows: rows.length,
            export_ready_rows: exportReadyRows.length,
            lab_partner_feed_ready_rows: labPartnerRows.length,
            resistance_signal_rows: resistanceRows.length,
            unique_trend_buckets: trends.length,
            average_surveillance_score: averageScore(rows.map((row) => row.surveillance_score)),
            average_resistance_signal_score: averageScore(rows.map((row) => row.resistance_signal_score)),
        },
        trends,
        provenance: {
            source_table: 'amr_lab_feed_surveillance_events' as const,
            source_row_count: rows.length,
            source_digest_bundle_hash: sourceDigestBundleHash,
            export_packet_hash: '',
        },
        privacy_contract: [
            'Export rows are aggregated from de-identified AMR lab-feed surveillance events only.',
            'Raw lab reports, owner identifiers, patient names, accessions, and source documents are excluded.',
            'Trend groups use normalized species, pathogen, infection-site/sample-source, and drug-class keys.',
            'One Health packets are surveillance evidence and do not make patient-specific prescribing recommendations.',
        ],
        blockers,
        warnings,
        next_actions: buildAMROneHealthExportNextActions({
            rows,
            exportReadyRows: exportReadyRows.length,
            trends: trends.length,
            blockers,
        }),
    };

    return {
        ...packetWithoutHash,
        provenance: {
            ...packetWithoutHash.provenance,
            export_packet_hash: hashJson(packetWithoutHash),
        },
    };
}

export function buildAMRLabFeedIngestionBatchPacket(input: AMRLabFeedIngestionBatchInput): AMRLabFeedIngestionBatchPacket {
    const generatedAt = input.generated_at ?? new Date().toISOString();
    const feedSource = normalizeOptionalAMRLabel(input.feed_source) ?? 'unknown_lab_feed';
    const labPartnerRef = normalizeAMRString(input.lab_partner_ref);
    const eventDrafts = input.rows.map((row) => {
        const packet = buildAMRLabFeedSurveillancePacket(row);
        return buildAMRLabFeedSurveillanceEventDraft({
            tenantId: input.tenant_id,
            requestId: row.request_id,
            amrStewardshipEventId: row.amr_stewardship_event_id,
            caseId: row.case_id,
            inferenceEventId: row.inference_event_id,
            clinicalOutcomeId: row.clinical_outcome_id,
            packet,
            evidence: {
                feed_source: feedSource,
                lab_partner_ref_hash: labPartnerRef ? hashValue(labPartnerRef) : null,
                raw_lab_report_stored: false,
            },
            observedAt: row.observed_at ?? generatedAt,
        });
    });
    const oneHealthExportPacket = buildAMROneHealthExportPacket({
        rows: eventDrafts,
        generatedAt,
    });
    const sourceDigests = eventDrafts.map((draft) => draft.source_record_digest).sort();
    const duplicateSourceDigestCount = countDuplicates(sourceDigests);
    const blockedRows = eventDrafts.filter((draft) => draft.blockers.length > 0).length;
    const labPartnerReadyRows = eventDrafts.filter((draft) => draft.lab_partner_feed_ready).length;
    const exportReadyRows = eventDrafts.filter((draft) => draft.one_health_export_ready).length;
    const resistanceSignalRows = eventDrafts.filter((draft) => draft.lab_feed_status === 'resistance_signal'
        || draft.lab_feed_status === 'one_health_export_ready'
        || draft.resistance_signal_score >= 0.45).length;
    const uniqueTrendBuckets = new Set(eventDrafts.map((draft) => draft.trend_bucket_key)).size;
    const taxonomyCompleteRows = eventDrafts.filter((draft) => Boolean(
        draft.pathogen_key
        && draft.drug_class
        && (draft.infection_site || draft.sample_source),
    )).length;
    const blockers = uniqueStrings([
        ...(eventDrafts.length === 0 ? ['amr_lab_feed_rows_missing'] : []),
        ...(eventDrafts.some((draft) => draft.blockers.includes('direct_identifier_risk_in_amr_lab_feed')) ? ['direct_identifier_risk_in_source_rows'] : []),
    ]);
    const warnings = uniqueStrings([
        ...(!labPartnerRef ? ['lab_partner_ref_missing'] : []),
        ...(duplicateSourceDigestCount > 0 ? ['duplicate_source_record_digests_detected'] : []),
        ...(taxonomyCompleteRows < eventDrafts.length ? ['pathogen_drug_or_site_taxonomy_incomplete'] : []),
        ...(eventDrafts.length > 0 && exportReadyRows === 0 ? ['one_health_export_ready_rows_missing'] : []),
        ...oneHealthExportPacket.warnings,
    ]);
    const packetWithoutHash = {
        schema_version: 'amr-lab-feed-ingestion-batch-v1' as const,
        generated_at: generatedAt,
        tenant_id: input.tenant_id,
        lab_partner_ref_hash: labPartnerRef ? hashValue(labPartnerRef) : null,
        feed_source: feedSource,
        ingestion_status: resolveAMRLabFeedIngestionStatus({
            rowCount: eventDrafts.length,
            blockedRows,
            exportReadyRows,
            blockers,
        }),
        summary: {
            submitted_rows: input.rows.length,
            event_draft_count: eventDrafts.length,
            blocked_rows: blockedRows,
            duplicate_source_digest_count: duplicateSourceDigestCount,
            lab_partner_feed_ready_rows: labPartnerReadyRows,
            one_health_export_ready_rows: exportReadyRows,
            resistance_signal_rows: resistanceSignalRows,
            unique_trend_buckets: uniqueTrendBuckets,
            taxonomy_completion_score: ratio(taxonomyCompleteRows, eventDrafts.length),
            average_surveillance_score: averageScore(eventDrafts.map((draft) => draft.surveillance_score)),
            average_resistance_signal_score: averageScore(eventDrafts.map((draft) => draft.resistance_signal_score)),
        },
        event_drafts: eventDrafts,
        one_health_export_packet: oneHealthExportPacket,
        provenance: {
            source_table: 'amr_lab_feed_surveillance_events' as const,
            source_digest_bundle_hash: hashJson(sourceDigests),
            event_packet_hash_bundle: hashJson(eventDrafts.map((draft) => draft.packet_hash).sort()),
            ingestion_packet_hash: '',
        },
        privacy_contract: [
            'Batch ingestion emits append-only de-identified surveillance drafts only.',
            'Raw lab reports, accessions, owner identifiers, patient names, and credential material are excluded.',
            'Lab partner references are hashed before inclusion in ingestion evidence.',
            'AST and MIC source payloads are represented by stable hashes and normalized derived facts.',
        ],
        blockers,
        warnings,
        next_actions: buildAMRLabFeedIngestionNextActions({
            rowCount: eventDrafts.length,
            blockedRows,
            exportReadyRows,
            duplicateSourceDigestCount,
            labPartnerRefPresent: Boolean(labPartnerRef),
            blockers,
        }),
    };

    return {
        ...packetWithoutHash,
        provenance: {
            ...packetWithoutHash.provenance,
            ingestion_packet_hash: hashJson(packetWithoutHash),
        },
    };
}

function countTop(values: Array<string | null | undefined>, fallback: string): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const value of values) {
        const key = normalizeOptionalAMRLabel(value) ?? fallback;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10);
}

function normalizeAMRLabFeedRowForExport(row: AMRLabFeedSurveillanceEventRow): AMRLabFeedExportRow {
    const packet = asRecord(row.surveillance_packet);
    const normalization = asRecord(packet.normalization);
    const ast = asRecord(packet.ast);
    const species = normalizeOptionalAMRLabel(readText(row.species) ?? readText(normalization.species)) ?? 'unknown_species';
    const pathogenLabel = normalizeOptionalAMRLabel(readText(row.pathogen_label) ?? readText(normalization.pathogen_label));
    const pathogenKey = normalizeOptionalAMRLabel(readText(row.pathogen_key) ?? readText(normalization.pathogen_key))
        ?? (pathogenLabel ? normalizePathogenKey(pathogenLabel) : 'unknown_pathogen');
    const infectionSite = normalizeOptionalAMRLabel(readText(row.infection_site) ?? readText(normalization.infection_site));
    const sampleSource = normalizeOptionalAMRLabel(readText(row.sample_source) ?? readText(normalization.sample_source));
    const drugName = normalizeOptionalAMRLabel(readText(row.drug_name) ?? readText(normalization.drug_name));
    const drugClass = normalizeOptionalAMRLabel(readText(row.drug_class) ?? readText(normalization.drug_class));
    const trendBucketKey = normalizeTrendBucketKey(
        readText(row.trend_bucket_key) ?? readText(normalization.trend_bucket_key),
        {
            species,
            pathogenKey,
            infectionSite,
            sampleSource,
            drugClass,
            drugName,
        },
    );
    const interpretationCounts = normalizeInterpretationCounts(ast.interpretation_counts);
    const susceptibilityFallback = readNumber(row.susceptibility_result_count) ?? readNumber(ast.susceptibility_result_count) ?? 0;
    if (
        interpretationCounts.susceptible
        + interpretationCounts.intermediate
        + interpretationCounts.resistant
        + interpretationCounts.unknown === 0
        && susceptibilityFallback > 0
    ) {
        interpretationCounts.unknown = susceptibilityFallback;
    }

    return {
        species,
        pathogen_label: pathogenLabel,
        pathogen_key: pathogenKey,
        infection_site: infectionSite,
        sample_source: sampleSource,
        drug_name: drugName,
        drug_class: drugClass,
        lab_feed_status: readText(row.lab_feed_status) ?? 'blocked',
        surveillance_score: clampScore(readNumber(row.surveillance_score) ?? 0),
        resistance_signal_score: clampScore(readNumber(row.resistance_signal_score) ?? 0),
        lab_partner_feed_ready: readBoolean(row.lab_partner_feed_ready),
        one_health_export_ready: readBoolean(row.one_health_export_ready),
        trend_bucket_key: trendBucketKey,
        source_record_digest: readText(row.source_record_digest),
        packet_hash: readText(row.packet_hash),
        interpretation_counts: interpretationCounts,
        blockers: asStringArray(row.blockers),
        warnings: asStringArray(row.warnings),
        observed_at: readText(row.observed_at),
    };
}

function buildAMRTrendGroups(rows: AMRLabFeedExportRow[]): AMROneHealthExportPacket['trends'] {
    const groups = new Map<string, {
        trend_bucket_key: string;
        species: string;
        pathogen_key: string;
        pathogen_label: string | null;
        infection_site: string | null;
        sample_source: string | null;
        drug_class: string | null;
        drug_name: string | null;
        sample_count: number;
        export_ready_count: number;
        resistance_signal_count: number;
        interpretation_counts: AMRInterpretationCounts;
        surveillance_total: number;
        resistance_total: number;
        latest_observed_at: string | null;
        source_digests: string[];
    }>();

    for (const row of rows) {
        const group = groups.get(row.trend_bucket_key) ?? {
            trend_bucket_key: row.trend_bucket_key,
            species: row.species,
            pathogen_key: row.pathogen_key,
            pathogen_label: row.pathogen_label,
            infection_site: row.infection_site,
            sample_source: row.sample_source,
            drug_class: row.drug_class,
            drug_name: row.drug_name,
            sample_count: 0,
            export_ready_count: 0,
            resistance_signal_count: 0,
            interpretation_counts: emptyInterpretationCounts(),
            surveillance_total: 0,
            resistance_total: 0,
            latest_observed_at: null,
            source_digests: [],
        };

        group.sample_count += 1;
        if (row.one_health_export_ready) group.export_ready_count += 1;
        if (isResistanceSignalRow(row)) group.resistance_signal_count += 1;
        group.interpretation_counts = addInterpretationCounts(group.interpretation_counts, row.interpretation_counts);
        group.surveillance_total += row.surveillance_score;
        group.resistance_total += row.resistance_signal_score;
        if (row.source_record_digest) group.source_digests.push(row.source_record_digest);
        if (!group.latest_observed_at || (row.observed_at && row.observed_at > group.latest_observed_at)) {
            group.latest_observed_at = row.observed_at;
        }
        groups.set(row.trend_bucket_key, group);
    }

    return Array.from(groups.values())
        .map((group) => ({
            trend_bucket_key: group.trend_bucket_key,
            species: group.species,
            pathogen_key: group.pathogen_key,
            pathogen_label: group.pathogen_label,
            infection_site: group.infection_site,
            sample_source: group.sample_source,
            drug_class: group.drug_class,
            drug_name: group.drug_name,
            sample_count: group.sample_count,
            export_ready_count: group.export_ready_count,
            resistance_signal_count: group.resistance_signal_count,
            resistance_signal_rate: ratio(group.resistance_signal_count, group.sample_count),
            interpretation_counts: group.interpretation_counts,
            average_surveillance_score: ratio(group.surveillance_total, group.sample_count),
            average_resistance_signal_score: ratio(group.resistance_total, group.sample_count),
            latest_observed_at: group.latest_observed_at,
            source_digest_bundle_hash: hashJson(group.source_digests.sort()),
        }))
        .sort((left, right) => right.sample_count - left.sample_count || left.trend_bucket_key.localeCompare(right.trend_bucket_key));
}

function buildAMROneHealthExportBlockers(
    rows: AMRLabFeedExportRow[],
    exportReadyRows: number,
): string[] {
    return uniqueStrings([
        ...(rows.length === 0 ? ['amr_lab_feed_rows_missing'] : []),
        ...(rows.some((row) => row.blockers.includes('direct_identifier_risk_in_amr_lab_feed')) ? ['direct_identifier_risk_in_source_rows'] : []),
        ...(rows.length > 0 && exportReadyRows === 0 ? ['one_health_export_ready_rows_missing'] : []),
    ]);
}

function buildAMROneHealthExportWarnings(rows: AMRLabFeedExportRow[], trendCount: number): string[] {
    return uniqueStrings([
        ...(rows.length > 0 && rows.length < 10 ? ['low_sample_count_for_stable_trends'] : []),
        ...(trendCount === 0 ? ['trend_groups_missing'] : []),
        ...(rows.some((row) => row.pathogen_key === 'unknown_pathogen') ? ['pathogen_taxonomy_incomplete'] : []),
        ...(rows.some((row) => !row.drug_class) ? ['drug_class_taxonomy_incomplete'] : []),
        ...(rows.some((row) => !row.infection_site && !row.sample_source) ? ['infection_site_or_sample_source_incomplete'] : []),
    ]);
}

function buildAMROneHealthExportNextActions(input: {
    rows: AMRLabFeedExportRow[];
    exportReadyRows: number;
    trends: number;
    blockers: string[];
}): string[] {
    return uniqueStrings([
        ...(input.rows.length === 0 ? ['ingest_ast_culture_lab_feed_rows'] : []),
        ...(input.exportReadyRows === 0 ? ['complete_pathogen_drug_site_taxonomy_for_export'] : []),
        ...(input.trends === 0 ? ['materialize_species_pathogen_drug_trend_groups'] : []),
        ...(input.blockers.includes('direct_identifier_risk_in_source_rows') ? ['remove_or_hash_identifier_bearing_lab_feed_fields'] : []),
        ...(input.exportReadyRows > 0 && input.blockers.length === 0 ? ['publish_deidentified_one_health_export_packet'] : []),
    ]);
}

function resolveAMROneHealthExportStatus(input: {
    rowCount: number;
    exportReadyRows: number;
    blockers: string[];
}): AMROneHealthExportPacket['export_status'] {
    if (input.rowCount === 0 || input.blockers.includes('direct_identifier_risk_in_source_rows')) return 'blocked';
    if (input.exportReadyRows > 0 && input.blockers.length === 0) return 'export_ready';
    return 'foundation';
}

function resolveAMRLabFeedIngestionStatus(input: {
    rowCount: number;
    blockedRows: number;
    exportReadyRows: number;
    blockers: string[];
}): AMRLabFeedIngestionBatchPacket['ingestion_status'] {
    if (input.rowCount === 0 || input.blockers.length > 0) return 'blocked';
    if (input.blockedRows > 0 || input.exportReadyRows < input.rowCount) return 'partial';
    return 'ready';
}

function buildAMRLabFeedIngestionNextActions(input: {
    rowCount: number;
    blockedRows: number;
    exportReadyRows: number;
    duplicateSourceDigestCount: number;
    labPartnerRefPresent: boolean;
    blockers: string[];
}): string[] {
    return uniqueStrings([
        ...(input.rowCount === 0 ? ['attach_ast_culture_lab_feed_batch'] : []),
        ...(input.blockedRows > 0 ? ['review_blocked_amr_lab_feed_rows'] : []),
        ...(input.exportReadyRows === 0 ? ['complete_taxonomy_and_ast_fields_for_one_health_export'] : []),
        ...(input.duplicateSourceDigestCount > 0 ? ['deduplicate_lab_feed_source_records'] : []),
        ...(!input.labPartnerRefPresent ? ['attach_lab_partner_reference'] : []),
        ...(input.blockers.includes('direct_identifier_risk_in_source_rows') ? ['remove_identifier_bearing_lab_feed_fields'] : []),
        ...(input.exportReadyRows > 0 && input.blockers.length === 0 ? ['persist_amr_lab_feed_surveillance_events'] : []),
        ...(input.exportReadyRows > 0 && input.blockers.length === 0 ? ['publish_deidentified_one_health_export_packet'] : []),
    ]);
}

function countDuplicates(values: string[]): number {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return Array.from(counts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function isResistanceSignalRow(row: AMRLabFeedExportRow): boolean {
    return row.lab_feed_status === 'resistance_signal'
        || row.lab_feed_status === 'one_health_export_ready'
        || row.resistance_signal_score >= 0.45
        || row.interpretation_counts.resistant > 0;
}

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function latestObservedAt(rows: Array<{ observed_at?: string | null }>): string | null {
    return rows
        .map((row) => row.observed_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
}

function oldestObservedAt(rows: Array<{ observed_at?: string | null }>): string | null {
    return rows
        .map((row) => row.observed_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(0) ?? null;
}

function normalizePathogenKey(value: string): string {
    return normalizeAMRLabel(value.replace(/\bsp\.?$/i, '').replace(/\bspp\.?$/i, ''));
}

function resolveAMRLabFeedStatus(input: {
    blockerCount: number;
    cultureCollected: boolean;
    astReady: boolean;
    resistanceSignalScore: number;
    oneHealthExportReady: boolean;
}): AMRLabFeedStatus {
    if (input.blockerCount > 0) return 'blocked';
    if (input.oneHealthExportReady) return 'one_health_export_ready';
    if (input.resistanceSignalScore >= 0.45) return 'resistance_signal';
    if (input.astReady) return 'ast_ready';
    if (input.cultureCollected) return 'culture_pending';
    return 'blocked';
}

function scoreResistanceSignal(input: {
    resistance_suspected: boolean;
    resistance_gene_count: number;
    resistance_class_count: number;
    susceptibility_result_count: number;
    mic_result_count: number;
}): number {
    return clampScore(
        (input.resistance_suspected ? 0.3 : 0)
        + Math.min(0.25, input.resistance_gene_count * 0.08)
        + Math.min(0.2, input.resistance_class_count * 0.08)
        + Math.min(0.15, input.susceptibility_result_count * 0.02)
        + Math.min(0.1, input.mic_result_count * 0.02),
    );
}

function scoreAMRSurveillance(input: {
    cultureCollected: boolean;
    astReady: boolean;
    pathogenLabel: string | null;
    drugClass: string | null;
    infectionSite: string | null;
    sampleSource: string | null;
    outcomeStatus: string | null;
    oneHealthExportReady: boolean;
    blockerCount: number;
}): number {
    return clampScore(
        (input.cultureCollected ? 0.16 : 0)
        + (input.astReady ? 0.22 : 0)
        + (input.pathogenLabel ? 0.15 : 0)
        + (input.drugClass ? 0.12 : 0)
        + (input.infectionSite || input.sampleSource ? 0.1 : 0)
        + (input.outcomeStatus ? 0.1 : 0)
        + (input.oneHealthExportReady ? 0.15 : 0)
        - input.blockerCount * 0.25,
    );
}

function buildAMRLabFeedNextActions(input: {
    labFeedStatus: AMRLabFeedStatus;
    astReady: boolean;
    pathogenLabel: string | null;
    drugClass: string | null;
    infectionSite: string | null;
    sampleSource: string | null;
    oneHealthExportReady: boolean;
}): string[] {
    const actions: string[] = [];
    if (input.labFeedStatus === 'blocked') actions.push('attach_culture_or_ast_feed');
    if (!input.astReady) actions.push('import_ast_or_mic_results');
    if (!input.pathogenLabel) actions.push('normalize_pathogen_taxonomy');
    if (!input.drugClass) actions.push('normalize_drug_class_taxonomy');
    if (!input.infectionSite && !input.sampleSource) actions.push('add_infection_site_or_sample_source');
    if (input.labFeedStatus === 'resistance_signal') actions.push('review_resistance_signal');
    if (input.oneHealthExportReady) actions.push('queue_one_health_amr_export');
    return Array.from(new Set(actions));
}

function countRecordLeaves(value: unknown): number {
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + countRecordLeaves(item), 0);
    if (typeof value === 'object' && value !== null) {
        const entries = Object.values(value);
        if (entries.length === 0) return 0;
        return entries.reduce((sum, item) => sum + countRecordLeaves(item), 0);
    }
    return value == null ? 0 : 1;
}

function countSusceptibilityResults(value: unknown): number {
    let count = 0;
    visitRecord(value, (_path, item) => {
        if (typeof item !== 'string') return;
        const normalized = item.trim().toLowerCase();
        if (['s', 'i', 'r', 'susceptible', 'intermediate', 'resistant'].includes(normalized)) count += 1;
    });
    return count;
}

function countASTInterpretations(value: unknown): AMRInterpretationCounts {
    const counts = emptyInterpretationCounts();
    visitRecord(value, (path, item) => {
        if (typeof item !== 'string') return;
        const normalized = item.trim().toLowerCase();
        if (['s', 'susceptible'].includes(normalized)) {
            counts.susceptible += 1;
        } else if (['i', 'intermediate'].includes(normalized)) {
            counts.intermediate += 1;
        } else if (['r', 'resistant'].includes(normalized)) {
            counts.resistant += 1;
        } else if (/(interpretation|susceptibility|result)$/i.test(path)) {
            counts.unknown += 1;
        }
    });
    return counts;
}

function emptyInterpretationCounts(): AMRInterpretationCounts {
    return {
        susceptible: 0,
        intermediate: 0,
        resistant: 0,
        unknown: 0,
    };
}

function normalizeInterpretationCounts(value: unknown): AMRInterpretationCounts {
    const record = asRecord(value);
    return {
        susceptible: Math.max(0, Math.round(readNumber(record.susceptible) ?? 0)),
        intermediate: Math.max(0, Math.round(readNumber(record.intermediate) ?? 0)),
        resistant: Math.max(0, Math.round(readNumber(record.resistant) ?? 0)),
        unknown: Math.max(0, Math.round(readNumber(record.unknown) ?? 0)),
    };
}

function addInterpretationCounts(
    left: AMRInterpretationCounts,
    right: AMRInterpretationCounts,
): AMRInterpretationCounts {
    return {
        susceptible: left.susceptible + right.susceptible,
        intermediate: left.intermediate + right.intermediate,
        resistant: left.resistant + right.resistant,
        unknown: left.unknown + right.unknown,
    };
}

function findDirectIdentifierPaths(source: Record<string, unknown>): string[] {
    const paths = new Set<string>();
    visitRecord(source, (path, value) => {
        const key = path.split('.').at(-1) ?? path;
        if (/owner|client|patient.*name|pet.*name|email|phone|address|microchip|accession.*raw/i.test(key)) paths.add(path);
        if (typeof value === 'string' && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) paths.add(path);
    });
    return Array.from(paths).sort();
}

function averageScore(values: Array<number | null | undefined>): number {
    const scores = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (scores.length === 0) return 0;
    return ratio(scores.reduce((sum, value) => sum + value, 0), scores.length);
}

function normalizeTrendBucketKey(
    value: string | null,
    fallback: {
        species: string;
        pathogenKey: string;
        infectionSite: string | null;
        sampleSource: string | null;
        drugClass: string | null;
        drugName: string | null;
    },
): string {
    const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9:]+/g, '_').replace(/^_+|_+$/g, '');
    if (normalized) return normalized;
    return [
        fallback.species,
        fallback.pathogenKey,
        fallback.infectionSite ?? fallback.sampleSource ?? 'unknown_site',
        fallback.drugClass ?? fallback.drugName ?? 'unknown_drug',
    ].join(':');
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === 'yes' || normalized === '1';
    }
    if (typeof value === 'number') return value === 1;
    return false;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort();
}

function visitRecord(value: unknown, visitor: (path: string, value: unknown) => void, path = '') {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => visitRecord(entry, visitor, `${path}[${index}]`));
        return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key;
        visitor(nextPath, nested);
        visitRecord(nested, visitor, nextPath);
    }
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
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

function clampScore(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
