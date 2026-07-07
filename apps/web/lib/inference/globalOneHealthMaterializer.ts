import { createHash } from 'crypto';
import { CURATED_VETERINARY_RAG_SOURCES } from '../agenticRag/sourceCatalog';
import {
    GLOBAL_ONE_HEALTH_CONDITION_SEEDS,
    type GlobalOneHealthConditionSeed,
} from './globalOneHealthSeeds';

type MaterializerSupabaseClient = {
    from: (table: string) => {
        insert: (payload: Record<string, unknown>[]) => Promise<{ error: { message?: string } | null }>;
    };
};

export interface GlobalOneHealthMaterializationInput {
    tenantId?: string | null;
    requestId?: string;
    observedAt?: string | null;
}

export interface GlobalOneHealthMaterializationRows {
    conditionRows: Record<string, unknown>[];
    sourceMappingRows: Record<string, unknown>[];
    edgeRows: Record<string, unknown>[];
}

export interface GlobalOneHealthMaterializationResult {
    conditionRows: number;
    sourceMappingRows: number;
    edgeRows: number;
    error: string | null;
}

const DEFAULT_REQUEST_ID = 'global_one_health_seed_v1';
const DEFAULT_ONTOLOGY_VERSION = 'global_one_health_v1';

export function buildGlobalOneHealthSeedMaterializationRows(
    input: GlobalOneHealthMaterializationInput = {},
): GlobalOneHealthMaterializationRows {
    const requestId = input.requestId ?? DEFAULT_REQUEST_ID;
    const sourceByKey = new Map(CURATED_VETERINARY_RAG_SOURCES.map((source) => [source.external_key, source]));

    const conditionRows = GLOBAL_ONE_HEALTH_CONDITION_SEEDS.map((seed) => ({
        tenant_id: input.tenantId ?? null,
        request_id: requestId,
        condition_key: seed.condition_key,
        canonical_name: seed.canonical_name,
        condition_domain: seed.condition_domain,
        host_scope: seed.host_scope,
        species_scope: seed.species_scope,
        human_relevance: seed.human_relevance,
        zoonotic_role: seed.zoonotic_role,
        syndrome_tags: seed.syndrome_tags,
        pathogen_refs: seed.pathogen_refs,
        vector_refs: seed.vector_refs,
        reservoir_refs: seed.reservoir_refs,
        transmission_routes: seed.transmission_routes,
        geography_tags: seed.geography_tags,
        climate_tags: seed.climate_tags,
        amr_relevance: seed.amr_relevance,
        ontology_version: DEFAULT_ONTOLOGY_VERSION,
        evidence_grade: 'source_attested',
        source_manifest_hash: sha256(seed.source_keys),
        condition_packet: buildConditionPacket(seed),
        blockers: [
            'seed_requires_source_ingestion',
            'seed_requires_clinician_or_external_review_before_scoring',
        ],
        warnings: [
            'Seeded condition row is not a patient diagnosis and must not enter outcome-confirmed learning until validated.',
        ],
        observed_at: input.observedAt ?? null,
    }));

    const sourceMappingRows = GLOBAL_ONE_HEALTH_CONDITION_SEEDS.flatMap((seed) =>
        seed.source_keys.map((sourceKey) => {
            const source = sourceByKey.get(sourceKey);
            const missingSource = !source;
            return {
                tenant_id: input.tenantId ?? null,
                request_id: requestId,
                condition_key: seed.condition_key,
                source_key: sourceKey,
                source_authority: source?.authority_tier ?? 'unknown',
                source_type: source?.source_type ?? 'unknown',
                external_code_system: null,
                external_code: null,
                mapping_status: missingSource ? 'candidate' : 'source_attested',
                mapping_confidence: missingSource ? 0.25 : 0.72,
                license_status: source ? inferLicenseStatus(source.license) : 'unknown',
                source_version: null,
                source_document_hash: source ? sha256({
                    source_key: source.external_key,
                    url: source.url,
                    attribution: source.attribution,
                }) : null,
                mapping_packet: {
                    source_name: source?.name ?? sourceKey,
                    source_url: source?.url ?? null,
                    source_attribution: source?.attribution ?? null,
                    mapping_scope: 'condition_seed_to_authority_source',
                    code_mapping_status: 'not_materialized',
                    note: 'This maps a VetIOS condition seed to an authority source. It does not assert a verified external code.',
                },
                blockers: missingSource ? ['source_key_missing_from_catalog'] : ['external_code_mapping_not_materialized'],
                warnings: ['Do not use source mapping as diagnostic confirmation without source ingestion and review.'],
                observed_at: input.observedAt ?? null,
            };
        }),
    );

    const edgeRows = GLOBAL_ONE_HEALTH_CONDITION_SEEDS.flatMap((seed) =>
        buildEdgeTypes(seed).map((edgeType) => ({
            tenant_id: input.tenantId ?? null,
            request_id: requestId,
            edge_key: `${seed.condition_key}:${edgeType}`,
            source_condition_key: seed.condition_key,
            target_condition_key: null,
            edge_type: edgeType,
            host_scope: seed.host_scope,
            pathogen_ref: seed.pathogen_refs[0] ?? null,
            vector_ref: seed.vector_refs[0] ?? null,
            reservoir_ref: seed.reservoir_refs[0] ?? null,
            exposure_route: pickExposureRoute(seed, edgeType),
            geography_tags: seed.geography_tags,
            evidence_grade: 'source_attested',
            edge_confidence: 0.68,
            source_manifest_hash: sha256({
                condition_key: seed.condition_key,
                edge_type: edgeType,
                source_keys: seed.source_keys,
            }),
            edge_packet: {
                canonical_name: seed.canonical_name,
                human_relevance: seed.human_relevance,
                zoonotic_role: seed.zoonotic_role,
                amr_relevance: seed.amr_relevance,
                source_keys: seed.source_keys,
                note: 'Seeded edge requires source ingestion, reviewer verification, and outcome/surveillance evidence before operational scoring.',
            },
            blockers: ['seed_edge_requires_source_ingestion'],
            warnings: ['Seeded One Health edge is a candidate bridge, not a confirmed live surveillance correlation.'],
            observed_at: input.observedAt ?? null,
        })),
    );

    return { conditionRows, sourceMappingRows, edgeRows };
}

export async function recordGlobalOneHealthSeedMaterializationEvents(
    client: MaterializerSupabaseClient,
    input: GlobalOneHealthMaterializationInput = {},
): Promise<GlobalOneHealthMaterializationResult> {
    const rows = buildGlobalOneHealthSeedMaterializationRows(input);
    const inserts: Array<[string, Record<string, unknown>[]]> = [
        ['global_health_condition_ontology_events', rows.conditionRows],
        ['global_condition_source_mapping_events', rows.sourceMappingRows],
        ['one_health_condition_edge_events', rows.edgeRows],
    ];

    for (const [table, payload] of inserts) {
        if (payload.length === 0) continue;
        const { error } = await client.from(table).insert(payload);
        if (error) {
            const message = error.message ?? `${table}_insert_failed`;
            console.warn(JSON.stringify({
                event: 'global_one_health_seed_materialization_failed',
                table,
                error: message,
            }));
            return {
                conditionRows: rows.conditionRows.length,
                sourceMappingRows: rows.sourceMappingRows.length,
                edgeRows: rows.edgeRows.length,
                error: message,
            };
        }
    }

    return {
        conditionRows: rows.conditionRows.length,
        sourceMappingRows: rows.sourceMappingRows.length,
        edgeRows: rows.edgeRows.length,
        error: null,
    };
}

function buildConditionPacket(seed: GlobalOneHealthConditionSeed) {
    return {
        canonical_name: seed.canonical_name,
        source_keys: seed.source_keys,
        match_terms: seed.match_terms,
        contextual_terms: seed.contextual_terms,
        materialization_status: 'seed_source_mapping_only',
        clinical_boundary: 'Candidate seed only; no patient-level diagnosis, treatment instruction, or outcome truth.',
    };
}

function buildEdgeTypes(seed: GlobalOneHealthConditionSeed) {
    const edgeTypes = new Set<string>();
    if (seed.human_relevance === 'zoonotic') edgeTypes.add('zoonotic_bridge');
    if (seed.human_relevance === 'shared_pathogen') edgeTypes.add('shared_pathogen');
    if (seed.pathogen_refs.length > 0) edgeTypes.add('shared_pathogen');
    if (seed.vector_refs.length > 0) edgeTypes.add('shared_vector');
    if (seed.reservoir_refs.length > 0) edgeTypes.add('shared_reservoir');
    if (seed.transmission_routes.includes('foodborne')) edgeTypes.add('foodborne_route');
    if (seed.transmission_routes.includes('waterborne')) edgeTypes.add('waterborne_route');
    if (seed.transmission_routes.some((route) => route.includes('environment') || route.includes('soil'))) {
        edgeTypes.add('shared_environment');
    }
    if (seed.amr_relevance === 'surveillance_priority' || seed.amr_relevance === 'confirmed') edgeTypes.add('amr_bridge');
    if (seed.source_keys.includes('woah_wahis')) edgeTypes.add('surveillance_correlation');
    return Array.from(edgeTypes);
}

function pickExposureRoute(seed: GlobalOneHealthConditionSeed, edgeType: string) {
    if (edgeType === 'foodborne_route') return 'foodborne';
    if (edgeType === 'waterborne_route') return 'waterborne';
    if (edgeType === 'shared_vector') return 'vector_borne';
    if (edgeType === 'shared_environment') {
        return seed.transmission_routes.find((route) => route.includes('environment') || route.includes('soil')) ?? 'shared_environment';
    }
    return seed.transmission_routes[0] ?? null;
}

function inferLicenseStatus(license: string) {
    const normalized = license.toLowerCase();
    if (normalized.includes('open')) return 'open_license';
    if (normalized.includes('public')) return 'public_reference';
    if (normalized.includes('licensed')) return 'licensed';
    if (normalized.includes('restricted')) return 'restricted';
    return 'unknown';
}

function sha256(value: unknown) {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
