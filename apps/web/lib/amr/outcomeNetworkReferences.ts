import type { AMROutcomeEpisodeEventRow } from '@/lib/amr/outcomeNetwork';
import { getSupabaseServer } from '@/lib/supabaseServer';

export interface AMREpisodeReferenceBody {
    site_id?: string;
    lab_site_id?: string;
    case_id?: string;
    inference_event_id?: string;
    clinical_outcome_id?: string;
    amr_stewardship_event_id?: string;
    amr_lab_feed_event_id?: string;
    species?: string;
    pathogen_key?: string;
    drug_class?: string;
    outcome_status?: string;
    consent_status?: string;
    review_status?: string;
    source_record_digest?: string;
    evidence_packet_hash?: string;
    is_synthetic: boolean;
    deidentified: boolean;
}

type EpisodeReferenceRow = Record<string, unknown> | null;

export interface AMREpisodeReferenceValidation {
    error: string | null;
    storageError: string | null;
    synthetic: boolean;
    deidentified: boolean;
    provenance: Record<string, unknown>;
    resolved: {
        siteId: string | null;
        labSiteId: string | null;
        caseId: string | null;
        inferenceEventId: string | null;
        clinicalOutcomeId: string | null;
        amrStewardshipEventId: string | null;
        amrLabFeedEventId: string | null;
        species: string | null;
        pathogenKey: string | null;
        drugClass: string | null;
        outcomeStatus: string | null;
        consentStatus: string | null;
        reviewStatus: string | null;
        sourceRecordDigest: string | null;
        evidencePacketHash: string | null;
    };
}

export async function validateAMREpisodeReferences(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    body: AMREpisodeReferenceBody;
    currentRows: AMROutcomeEpisodeEventRow[];
}): Promise<AMREpisodeReferenceValidation> {
    const latest = <T extends string>(
        read: (row: AMROutcomeEpisodeEventRow) => T | null | undefined,
    ) => latestEpisodeText(input.currentRows, read);
    const resolved = {
        siteId: input.body.site_id ?? latest((row) => row.site_id),
        labSiteId: input.body.lab_site_id ?? latest((row) => row.lab_site_id),
        caseId: input.body.case_id ?? latest((row) => row.case_id),
        inferenceEventId: input.body.inference_event_id
            ?? latest((row) => row.inference_event_id),
        clinicalOutcomeId: input.body.clinical_outcome_id
            ?? latest((row) => row.clinical_outcome_id),
        amrStewardshipEventId: input.body.amr_stewardship_event_id
            ?? latest((row) => row.amr_stewardship_event_id),
        amrLabFeedEventId: input.body.amr_lab_feed_event_id
            ?? latest((row) => row.amr_lab_feed_event_id),
        species: normalizeKey(input.body.species)
            ?? normalizeKey(latest((row) => row.species)),
        pathogenKey: normalizeKey(input.body.pathogen_key)
            ?? normalizeKey(latest((row) => row.pathogen_key)),
        drugClass: normalizeKey(input.body.drug_class)
            ?? normalizeKey(latest((row) => row.drug_class)),
        outcomeStatus: input.body.outcome_status
            ?? latest((row) => row.outcome_status),
        consentStatus: input.body.consent_status
            ?? latest((row) => row.consent_status),
        reviewStatus: input.body.review_status
            ?? latest((row) => row.review_status),
        sourceRecordDigest: input.body.source_record_digest
            ?? latest((row) => row.source_record_digest),
        evidencePacketHash: input.body.evidence_packet_hash
            ?? latest((row) => row.evidence_packet_hash),
    };

    const labFeedLoad = await loadTenantReference({
        supabase: input.supabase,
        table: 'amr_lab_feed_surveillance_events',
        tenantId: input.tenantId,
        id: resolved.amrLabFeedEventId,
        select: [
            'id',
            'amr_stewardship_event_id',
            'case_id',
            'inference_event_id',
            'clinical_outcome_id',
            'species',
            'pathogen_key',
            'drug_class',
            'source_record_digest',
            'packet_hash',
        ].join(', '),
        missingError: 'amr_lab_feed_event_not_found_for_tenant',
    });
    if (labFeedLoad.storageError || labFeedLoad.error) {
        return invalidEpisodeReference(
            resolved,
            labFeedLoad.error,
            labFeedLoad.storageError,
        );
    }
    const labFeed = labFeedLoad.row;

    const stewardshipId = resolveConsistentReferenceId(
        'amr_stewardship_reference_mismatch',
        [
            resolved.amrStewardshipEventId,
            readText(labFeed?.amr_stewardship_event_id),
        ],
    );
    if (stewardshipId.error) {
        return invalidEpisodeReference(resolved, stewardshipId.error, null);
    }
    resolved.amrStewardshipEventId = stewardshipId.value;

    const stewardshipLoad = await loadTenantReference({
        supabase: input.supabase,
        table: 'amr_stewardship_events',
        tenantId: input.tenantId,
        id: resolved.amrStewardshipEventId,
        select: [
            'id',
            'case_id',
            'inference_event_id',
            'clinical_outcome_id',
            'species',
            'pathogen_label',
            'drug_class',
        ].join(', '),
        missingError: 'amr_stewardship_event_not_found_for_tenant',
    });
    if (stewardshipLoad.storageError || stewardshipLoad.error) {
        return invalidEpisodeReference(
            resolved,
            stewardshipLoad.error,
            stewardshipLoad.storageError,
        );
    }
    const stewardship = stewardshipLoad.row;

    const outcomeId = resolveConsistentReferenceId(
        'clinical_outcome_reference_mismatch',
        [
            resolved.clinicalOutcomeId,
            readText(labFeed?.clinical_outcome_id),
            readText(stewardship?.clinical_outcome_id),
        ],
    );
    if (outcomeId.error) return invalidEpisodeReference(resolved, outcomeId.error, null);
    resolved.clinicalOutcomeId = outcomeId.value;

    const outcomeLoad = await loadTenantReference({
        supabase: input.supabase,
        table: 'clinical_outcome_events',
        tenantId: input.tenantId,
        id: resolved.clinicalOutcomeId,
        select: 'id, case_id, inference_event_id, label_type, is_synthetic',
        missingError: 'clinical_outcome_not_found_for_tenant',
    });
    if (outcomeLoad.storageError || outcomeLoad.error) {
        return invalidEpisodeReference(
            resolved,
            outcomeLoad.error,
            outcomeLoad.storageError,
        );
    }
    const outcome = outcomeLoad.row;

    const inferenceId = resolveConsistentReferenceId(
        'inference_reference_mismatch',
        [
            resolved.inferenceEventId,
            readText(labFeed?.inference_event_id),
            readText(stewardship?.inference_event_id),
            readText(outcome?.inference_event_id),
        ],
    );
    if (inferenceId.error) return invalidEpisodeReference(resolved, inferenceId.error, null);
    resolved.inferenceEventId = inferenceId.value;

    const inferenceLoad = await loadTenantReference({
        supabase: input.supabase,
        table: 'ai_inference_events',
        tenantId: input.tenantId,
        id: resolved.inferenceEventId,
        select: 'id, case_id, is_synthetic',
        missingError: 'inference_event_not_found_for_tenant',
    });
    if (inferenceLoad.storageError || inferenceLoad.error) {
        return invalidEpisodeReference(
            resolved,
            inferenceLoad.error,
            inferenceLoad.storageError,
        );
    }
    const inference = inferenceLoad.row;

    const caseId = resolveConsistentReferenceId(
        'clinical_case_reference_mismatch',
        [
            resolved.caseId,
            readText(labFeed?.case_id),
            readText(stewardship?.case_id),
            readText(outcome?.case_id),
            readText(inference?.case_id),
        ],
    );
    if (caseId.error) return invalidEpisodeReference(resolved, caseId.error, null);
    resolved.caseId = caseId.value;

    const caseLoad = await loadTenantReference({
        supabase: input.supabase,
        table: 'clinical_cases',
        tenantId: input.tenantId,
        id: resolved.caseId,
        select: 'id, label_type, adversarial_case',
        missingError: 'clinical_case_not_found_for_tenant',
    });
    if (caseLoad.storageError || caseLoad.error) {
        return invalidEpisodeReference(resolved, caseLoad.error, caseLoad.storageError);
    }
    const clinicalCase = caseLoad.row;

    const semanticMismatch = firstReferenceMismatch([
        compareNormalizedReference(
            resolved.species,
            readText(labFeed?.species),
            'lab_feed_species_mismatch',
        ),
        compareNormalizedReference(
            resolved.species,
            readText(stewardship?.species),
            'stewardship_species_mismatch',
        ),
        compareNormalizedReference(
            resolved.pathogenKey,
            readText(labFeed?.pathogen_key),
            'lab_feed_pathogen_mismatch',
        ),
        compareNormalizedReference(
            resolved.drugClass,
            readText(labFeed?.drug_class),
            'lab_feed_drug_class_mismatch',
        ),
        compareNormalizedReference(
            resolved.drugClass,
            readText(stewardship?.drug_class),
            'stewardship_drug_class_mismatch',
        ),
        compareExactReference(
            resolved.sourceRecordDigest,
            readText(labFeed?.source_record_digest),
            'lab_feed_source_digest_mismatch',
        ),
        compareExactReference(
            resolved.evidencePacketHash,
            readText(labFeed?.packet_hash),
            'lab_feed_evidence_packet_mismatch',
        ),
    ]);
    if (semanticMismatch) {
        return invalidEpisodeReference(resolved, semanticMismatch, null);
    }

    const syntheticSources = uniqueStrings([
        ...(input.body.is_synthetic ? ['request'] : []),
        ...(input.currentRows.some((row) => row.is_synthetic === true)
            ? ['episode_history']
            : []),
        ...(inference?.is_synthetic === true ? ['inference_event'] : []),
        ...(outcome?.is_synthetic === true ? ['clinical_outcome'] : []),
        ...(isSyntheticLabel(readText(outcome?.label_type))
            ? ['clinical_outcome_label']
            : []),
        ...(isSyntheticLabel(readText(clinicalCase?.label_type))
            ? ['clinical_case_label']
            : []),
        ...(clinicalCase?.adversarial_case === true ? ['adversarial_case'] : []),
    ]);
    const deidentified = input.body.deidentified
        && input.currentRows.every((row) => row.deidentified !== false);
    const referencedRecordTypes = [
        ...(clinicalCase ? ['clinical_case'] : []),
        ...(inference ? ['inference_event'] : []),
        ...(outcome ? ['clinical_outcome'] : []),
        ...(stewardship ? ['amr_stewardship_event'] : []),
        ...(labFeed ? ['amr_lab_feed_event'] : []),
    ];

    return {
        error: null,
        storageError: null,
        synthetic: syntheticSources.length > 0,
        deidentified,
        provenance: {
            tenant_reference_validation: 'passed',
            synthetic_status: 'server_derived',
            synthetic_sources: syntheticSources,
            referenced_record_types: referencedRecordTypes,
        },
        resolved,
    };
}

async function loadTenantReference(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    table: string;
    tenantId: string;
    id: string | null;
    select: string;
    missingError: string;
}): Promise<{
    row: EpisodeReferenceRow;
    error: string | null;
    storageError: string | null;
}> {
    if (!input.id) return { row: null, error: null, storageError: null };
    const { data, error } = await input.supabase
        .from(input.table)
        .select(input.select)
        .eq('tenant_id', input.tenantId)
        .eq('id', input.id)
        .maybeSingle();
    if (error) {
        return { row: null, error: null, storageError: error.message };
    }
    return {
        row: data ? data as unknown as Record<string, unknown> : null,
        error: data ? null : input.missingError,
        storageError: null,
    };
}

function invalidEpisodeReference(
    resolved: AMREpisodeReferenceValidation['resolved'],
    error: string | null,
    storageError: string | null,
): AMREpisodeReferenceValidation {
    return {
        error,
        storageError,
        synthetic: true,
        deidentified: false,
        provenance: {},
        resolved,
    };
}

function resolveConsistentReferenceId(
    error: string,
    values: Array<string | null>,
): { value: string | null; error: string | null } {
    const unique = uniqueStrings(values);
    return unique.length > 1
        ? { value: null, error }
        : { value: unique[0] ?? null, error: null };
}

function compareNormalizedReference(
    expected: string | null,
    actual: string | null,
    error: string,
): string | null {
    if (!expected || !actual) return null;
    return expected === normalizeKey(actual) ? null : error;
}

function compareExactReference(
    expected: string | null,
    actual: string | null,
    error: string,
): string | null {
    if (!expected || !actual) return null;
    return expected === actual ? null : error;
}

function firstReferenceMismatch(values: Array<string | null>): string | null {
    return values.find((value): value is string => Boolean(value)) ?? null;
}

function latestEpisodeText<T extends string>(
    rows: AMROutcomeEpisodeEventRow[],
    read: (row: AMROutcomeEpisodeEventRow) => T | null | undefined,
): T | null {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (!row) continue;
        const value = read(row);
        if (typeof value === 'string' && value.trim()) return value.trim() as T;
    }
    return null;
}

function normalizeKey(value: string | null | undefined): string | null {
    if (!value) return null;
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null;
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: Array<string | null>): string[] {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isSyntheticLabel(value: string | null): boolean {
    if (!value) return false;
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return normalized.includes('synthetic') || normalized.includes('simulation');
}
