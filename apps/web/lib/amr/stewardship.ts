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
    const pathogenLabel = normalizeOptionalAMRLabel(input.pathogen_label);
    const pathogenKey = pathogenLabel ? normalizePathogenKey(pathogenLabel) : null;
    const syndrome = normalizeOptionalAMRLabel(input.syndrome);
    const infectionSite = normalizeOptionalAMRLabel(input.infection_site);
    const sampleSource = normalizeOptionalAMRLabel(input.sample_source);
    const drugName = normalizeAMRLabel(input.drug_name);
    const drugClass = normalizeOptionalAMRLabel(input.drug_class);
    const astPanel = input.ast_panel ?? {};
    const micResults = input.mic_results ?? {};
    const resistanceGenes = normalizeAMRStringList(input.resistance_genes ?? []);
    const resistanceClasses = normalizeAMRStringList(input.resistance_classes ?? []);
    const astPanelDrugCount = countRecordLeaves(astPanel);
    const micResultCount = countRecordLeaves(micResults);
    const susceptibilityResultCount = countSusceptibilityResults(astPanel);
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

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function latestObservedAt(rows: AMRStewardshipEventRow[]): string | null {
    return rows
        .map((row) => row.observed_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
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

function findDirectIdentifierPaths(source: Record<string, unknown>): string[] {
    const paths = new Set<string>();
    visitRecord(source, (path, value) => {
        const key = path.split('.').at(-1) ?? path;
        if (/owner|client|patient.*name|pet.*name|email|phone|address|microchip|accession.*raw/i.test(key)) paths.add(path);
        if (typeof value === 'string' && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) paths.add(path);
    });
    return Array.from(paths).sort();
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
