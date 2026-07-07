import { createHash } from 'crypto';
import { CURATED_VETERINARY_RAG_SOURCES } from '../agenticRag/sourceCatalog';
import {
    GLOBAL_ONE_HEALTH_CONDITION_SEEDS,
    type GlobalOneHealthConditionSeed,
} from './globalOneHealthSeeds';

type OfficialFetch = (input: string, init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<unknown>;
    text?: () => Promise<string>;
}>;

type OfficialIngestionSupabaseClient = {
    from: (table: string) => {
        insert: (payload: Record<string, unknown>[]) => Promise<{ error: { message?: string } | null }>;
    };
};

export type OfficialOntologyProviderAccess =
    | 'public_obo_json'
    | 'public_api'
    | 'public_dataset'
    | 'credentialed_api'
    | 'licensed_release';
export type OfficialOntologyProviderRole =
    | 'condition_code'
    | 'phenotype_bridge'
    | 'terminology_bridge'
    | 'surveillance_signal'
    | 'literature_evidence';

export interface OfficialOntologyProvider {
    provider_key: string;
    source_key: string;
    code_system: string;
    name: string;
    access: OfficialOntologyProviderAccess;
    role: OfficialOntologyProviderRole;
    url: string;
    required_env?: string[];
    release_url_env?: string;
    default_query?: string;
    api_database?: string;
}

export interface OfficialOntologyProviderPlan {
    provider_key: string;
    source_key: string;
    code_system: string;
    access: OfficialOntologyProviderAccess;
    role: OfficialOntologyProviderRole;
    status: 'ready' | 'requires_credentials' | 'requires_source_release' | 'license_gated';
    url: string;
    required_env: string[];
    release_url_env?: string;
}

export interface OfficialOntologyMatch {
    condition_key: string;
    canonical_name: string;
    source_key: string;
    code_system: string;
    external_code: string;
    provider_key: string;
    matched_label: string;
    matched_term: string;
    match_basis: 'label' | 'synonym' | 'xref' | 'api_search';
    mapping_confidence: number;
    source_document_hash: string;
}

export interface OfficialOntologyIngestionSummary {
    provider_plan: OfficialOntologyProviderPlan[];
    matches: OfficialOntologyMatch[];
    skipped_providers: Array<{
        provider_key: string;
        reason: string;
    }>;
    errors: Array<{
        provider_key: string;
        error: string;
    }>;
}

export const OFFICIAL_ONTOLOGY_PROVIDERS: OfficialOntologyProvider[] = [
    {
        provider_key: 'mondo_obo_json',
        source_key: 'mondo_disease_ontology',
        code_system: 'MONDO',
        name: 'Mondo Disease Ontology JSON',
        access: 'public_obo_json',
        role: 'condition_code',
        url: 'https://purl.obolibrary.org/obo/mondo.json',
    },
    {
        provider_key: 'hpo_obo_json',
        source_key: 'human_phenotype_ontology',
        code_system: 'HP',
        name: 'Human Phenotype Ontology JSON',
        access: 'public_obo_json',
        role: 'phenotype_bridge',
        url: 'https://purl.obolibrary.org/obo/hp.json',
    },
    {
        provider_key: 'umls_rest',
        source_key: 'nlm_umls',
        code_system: 'UMLS',
        name: 'NLM UMLS REST API',
        access: 'credentialed_api',
        role: 'terminology_bridge',
        url: 'https://uts-ws.nlm.nih.gov/rest/search/current',
        required_env: ['UMLS_API_KEY'],
    },
    {
        provider_key: 'who_icd_11_api',
        source_key: 'who_icd_11',
        code_system: 'ICD-11',
        name: 'WHO ICD-11 API',
        access: 'credentialed_api',
        role: 'terminology_bridge',
        url: 'https://id.who.int/icd',
        required_env: ['WHO_ICD_CLIENT_ID', 'WHO_ICD_CLIENT_SECRET'],
    },
    {
        provider_key: 'woah_wahis_official_export',
        source_key: 'woah_wahis',
        code_system: 'WAHIS',
        name: 'WOAH WAHIS official animal disease export',
        access: 'public_dataset',
        role: 'surveillance_signal',
        url: 'https://wahis.woah.org/',
        release_url_env: 'WAHIS_EXPORT_URL',
    },
    {
        provider_key: 'cdc_open_data_surveillance',
        source_key: 'cdc_open_data',
        code_system: 'CDC',
        name: 'CDC Open Data surveillance export',
        access: 'public_dataset',
        role: 'surveillance_signal',
        url: 'https://data.cdc.gov/',
        release_url_env: 'CDC_OPEN_DATA_URL',
    },
    {
        provider_key: 'pubmed_eutils',
        source_key: 'pubmed',
        code_system: 'PMID',
        name: 'NCBI PubMed E-utilities',
        access: 'public_api',
        role: 'literature_evidence',
        url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
        required_env: ['NCBI_API_KEY'],
        default_query: '(veterinary OR animal OR zoonotic OR livestock) AND (diagnosis OR disease OR antimicrobial resistance)',
        api_database: 'pubmed',
    },
    {
        provider_key: 'pmc_eutils',
        source_key: 'pmc',
        code_system: 'PMCID',
        name: 'NCBI PMC E-utilities',
        access: 'public_api',
        role: 'literature_evidence',
        url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
        required_env: ['NCBI_API_KEY'],
        default_query: '(veterinary OR animal OR zoonotic OR livestock) AND (diagnosis OR disease OR antimicrobial resistance)',
        api_database: 'pmc',
    },
    {
        provider_key: 'snomed_ct_release',
        source_key: 'snomed_ct',
        code_system: 'SNOMEDCT',
        name: 'SNOMED CT release files',
        access: 'licensed_release',
        role: 'terminology_bridge',
        url: 'https://www.snomed.org/',
        release_url_env: 'SNOMED_CT_RELEASE_URL',
    },
    {
        provider_key: 'venom_release',
        source_key: 'venom_veterinary_nomenclature',
        code_system: 'VeNom',
        name: 'VeNom veterinary nomenclature release',
        access: 'licensed_release',
        role: 'condition_code',
        url: 'https://venomcoding.org/',
        release_url_env: 'VENOM_RELEASE_URL',
    },
];

export function buildOfficialOntologyIngestionPlan(env: Record<string, string | undefined> = process.env): OfficialOntologyProviderPlan[] {
    return OFFICIAL_ONTOLOGY_PROVIDERS.map((provider) => {
        const requiredEnv = provider.required_env ?? [];
        const requiredCredentialEnv = provider.access === 'public_api'
            ? requiredEnv.filter((key) => Boolean(env[key]))
            : requiredEnv;
        const hasCredentials = requiredCredentialEnv.every((key) => Boolean(env[key]));
        const hasReleaseUrl = provider.release_url_env ? Boolean(env[provider.release_url_env]) : true;
        const status = provider.access === 'public_obo_json' || provider.access === 'public_api'
            ? 'ready'
            : provider.access === 'public_dataset'
                ? hasReleaseUrl ? 'ready' : 'requires_source_release'
                : provider.access === 'licensed_release'
                    ? hasReleaseUrl ? 'ready' : 'license_gated'
                    : hasCredentials
                        ? 'ready'
                        : 'requires_credentials';

        return {
            provider_key: provider.provider_key,
            source_key: provider.source_key,
            code_system: provider.code_system,
            access: provider.access,
            role: provider.role,
            status,
            url: provider.url,
            required_env: requiredEnv,
            release_url_env: provider.release_url_env,
        };
    });
}

export async function fetchOfficialOntologyMatches(input: {
    fetchImpl?: OfficialFetch;
    providerKeys?: string[];
    conditionKeys?: string[];
    env?: Record<string, string | undefined>;
} = {}): Promise<OfficialOntologyIngestionSummary> {
    const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as OfficialFetch);
    const providerKeys = new Set(input.providerKeys ?? OFFICIAL_ONTOLOGY_PROVIDERS.map((provider) => provider.provider_key));
    const conditionKeys = new Set(input.conditionKeys ?? GLOBAL_ONE_HEALTH_CONDITION_SEEDS.map((seed) => seed.condition_key));
    const plan = buildOfficialOntologyIngestionPlan(input.env);
    const planByKey = new Map(plan.map((entry) => [entry.provider_key, entry]));
    const matches: OfficialOntologyMatch[] = [];
    const skippedProviders: OfficialOntologyIngestionSummary['skipped_providers'] = [];
    const errors: OfficialOntologyIngestionSummary['errors'] = [];

    for (const provider of OFFICIAL_ONTOLOGY_PROVIDERS.filter((entry) => providerKeys.has(entry.provider_key))) {
        const providerPlan = planByKey.get(provider.provider_key);
        if (!providerPlan || providerPlan.status !== 'ready') {
            skippedProviders.push({
                provider_key: provider.provider_key,
                reason: providerPlan?.status ?? 'not_planned',
            });
            continue;
        }

        if (provider.provider_key === 'umls_rest') {
            const apiKey = input.env?.UMLS_API_KEY ?? process.env.UMLS_API_KEY;
            if (!apiKey) {
                skippedProviders.push({
                    provider_key: provider.provider_key,
                    reason: 'missing_umls_api_key',
                });
                continue;
            }
            matches.push(...await fetchUmlsMatches({
                provider,
                fetchImpl,
                conditionKeys,
                apiKey,
            }));
            continue;
        }

        if (provider.role !== 'condition_code') {
            skippedProviders.push({
                provider_key: provider.provider_key,
                reason: 'provider_not_condition_code_mapping_source',
            });
            continue;
        }

        if (provider.access !== 'public_obo_json') {
            skippedProviders.push({
                provider_key: provider.provider_key,
                reason: provider.access === 'licensed_release'
                    ? 'licensed_release_mapping_import_requires_release_url'
                    : 'provider_not_enabled_for_runtime_exact_mapping',
            });
            continue;
        }

        try {
            const response = await fetchImpl(provider.url, { cache: 'no-store' });
            if (!response.ok) {
                errors.push({
                    provider_key: provider.provider_key,
                    error: `fetch_failed_${response.status}`,
                });
                continue;
            }

            const payload = await response.json();
            matches.push(...extractOboJsonMatches({
                provider,
                payload,
                conditionKeys,
            }));
        } catch (error) {
            errors.push({
                provider_key: provider.provider_key,
                error: error instanceof Error ? error.message : 'unknown_error',
            });
        }
    }

    return {
        provider_plan: plan,
        matches,
        skipped_providers: skippedProviders,
        errors,
    };
}

export function extractOboJsonMatches(input: {
    provider: OfficialOntologyProvider;
    payload: unknown;
    conditionKeys?: Set<string>;
}): OfficialOntologyMatch[] {
    if (input.provider.role !== 'condition_code') return [];
    const conditionKeys = input.conditionKeys ?? new Set(GLOBAL_ONE_HEALTH_CONDITION_SEEDS.map((seed) => seed.condition_key));
    const nodes = readOboGraphNodes(input.payload);
    const sourceDocumentHash = sha256(input.payload);
    const matches: OfficialOntologyMatch[] = [];

    for (const seed of GLOBAL_ONE_HEALTH_CONDITION_SEEDS.filter((entry) => conditionKeys.has(entry.condition_key))) {
        const seedTerms = buildSeedTerms(seed);
        for (const node of nodes) {
            const code = parseOboCode(input.provider.code_system, node.id);
            if (!code) continue;
            const label = readString(node.lbl) ?? '';
            const synonyms = readSynonyms(node);
            const xrefs = readXrefs(node);
            const exactLabelTerm = findExactTerm(label, seedTerms);
            if (exactLabelTerm) {
                matches.push(buildMatch(input.provider, seed, code, label, exactLabelTerm, 'label', sourceDocumentHash, 0.95));
                break;
            }

            const synonymTerm = synonyms.find((synonym) => findExactTerm(synonym, seedTerms));
            if (synonymTerm) {
                matches.push(buildMatch(input.provider, seed, code, synonymTerm, findExactTerm(synonymTerm, seedTerms) ?? synonymTerm, 'synonym', sourceDocumentHash, 0.9));
                break;
            }

            const xrefTerm = xrefs.find((xref) => seedTerms.has(normalize(xref)));
            if (xrefTerm) {
                matches.push(buildMatch(input.provider, seed, code, xrefTerm, xrefTerm, 'xref', sourceDocumentHash, 0.82));
                break;
            }
        }
    }

    return dedupeMatches(matches);
}

async function fetchUmlsMatches(input: {
    provider: OfficialOntologyProvider;
    fetchImpl: OfficialFetch;
    conditionKeys: Set<string>;
    apiKey: string;
}): Promise<OfficialOntologyMatch[]> {
    const matches: OfficialOntologyMatch[] = [];
    for (const seed of GLOBAL_ONE_HEALTH_CONDITION_SEEDS.filter((entry) => input.conditionKeys.has(entry.condition_key))) {
        const terms = [seed.canonical_name, ...seed.match_terms].slice(0, 4);
        for (const term of terms) {
            const url = new URL(input.provider.url);
            url.searchParams.set('string', term);
            url.searchParams.set('searchType', 'exact');
            url.searchParams.set('pageSize', '5');
            url.searchParams.set('apiKey', input.apiKey);

            const response = await input.fetchImpl(url.toString(), { cache: 'no-store' });
            if (!response.ok) continue;

            const payload = await response.json();
            const result = findExactUmlsResult(payload, term);
            if (!result) continue;

            matches.push({
                condition_key: seed.condition_key,
                canonical_name: seed.canonical_name,
                source_key: input.provider.source_key,
                code_system: input.provider.code_system,
                external_code: result.ui,
                provider_key: input.provider.provider_key,
                matched_label: result.name,
                matched_term: term,
                match_basis: 'api_search',
                mapping_confidence: 0.86,
                source_document_hash: sha256({
                    provider_key: input.provider.provider_key,
                    ui: result.ui,
                    name: result.name,
                    term,
                }),
            });
            break;
        }
    }
    return dedupeMatches(matches);
}

export function buildVerifiedExternalMappingRows(input: {
    matches: OfficialOntologyMatch[];
    tenantId?: string | null;
    requestId: string;
    observedAt?: string | null;
}): Record<string, unknown>[] {
    const sourceByKey = new Map(CURATED_VETERINARY_RAG_SOURCES.map((source) => [source.external_key, source]));
    return input.matches.map((match) => {
        const source = sourceByKey.get(match.source_key);
        return {
            tenant_id: input.tenantId ?? null,
            request_id: input.requestId,
            condition_key: match.condition_key,
            source_key: match.source_key,
            source_authority: source?.authority_tier ?? 'institutional',
            source_type: source?.source_type ?? 'dataset',
            external_code_system: match.code_system,
            external_code: match.external_code,
            mapping_status: 'source_attested',
            mapping_confidence: match.mapping_confidence,
            license_status: source ? inferLicenseStatus(source.license) : 'unknown',
            source_version: null,
            source_document_hash: match.source_document_hash,
            mapping_packet: {
                provider_key: match.provider_key,
                matched_label: match.matched_label,
                matched_term: match.matched_term,
                match_basis: match.match_basis,
                code_mapping_status: 'verified_from_official_artifact',
                clinical_boundary: 'Official ontology code mapping only; not patient-level diagnosis or outcome truth.',
            },
            blockers: ['reviewer_verification_required_before_scoring'],
            warnings: ['Verified ontology code can support candidate expansion, but cannot replace diagnostics, clinician review, or outcome confirmation.'],
            observed_at: input.observedAt ?? null,
        };
    });
}

export async function recordVerifiedExternalCodeMappings(input: {
    client: OfficialIngestionSupabaseClient;
    tenantId?: string | null;
    requestId: string;
    matches: OfficialOntologyMatch[];
    observedAt?: string | null;
}): Promise<{ inserted: number; error: string | null }> {
    const rows = buildVerifiedExternalMappingRows(input);
    if (rows.length === 0) return { inserted: 0, error: null };
    const { error } = await input.client.from('global_condition_source_mapping_events').insert(rows);
    if (error) return { inserted: 0, error: error.message ?? 'verified_mapping_insert_failed' };
    return { inserted: rows.length, error: null };
}

function buildSeedTerms(seed: GlobalOneHealthConditionSeed) {
    return new Set([
        seed.canonical_name,
        ...seed.match_terms,
    ].map(normalize).filter(Boolean));
}

function buildMatch(
    provider: OfficialOntologyProvider,
    seed: GlobalOneHealthConditionSeed,
    externalCode: string,
    matchedLabel: string,
    matchedTerm: string,
    matchBasis: OfficialOntologyMatch['match_basis'],
    sourceDocumentHash: string,
    mappingConfidence: number,
): OfficialOntologyMatch {
    return {
        condition_key: seed.condition_key,
        canonical_name: seed.canonical_name,
        source_key: provider.source_key,
        code_system: provider.code_system,
        external_code: externalCode,
        provider_key: provider.provider_key,
        matched_label: matchedLabel,
        matched_term: matchedTerm,
        match_basis: matchBasis,
        mapping_confidence: mappingConfidence,
        source_document_hash: sourceDocumentHash,
    };
}

function readOboGraphNodes(payload: unknown): Array<Record<string, unknown>> {
    const record = asRecord(payload);
    const graphs = Array.isArray(record.graphs) ? record.graphs : [];
    return graphs.flatMap((graph) => {
        const nodes = asRecord(graph).nodes;
        return Array.isArray(nodes)
            ? nodes.filter((node): node is Record<string, unknown> => typeof node === 'object' && node !== null)
            : [];
    });
}

function readSynonyms(node: Record<string, unknown>) {
    const meta = asRecord(node.meta);
    const synonyms = Array.isArray(meta.synonyms) ? meta.synonyms : [];
    return synonyms
        .map((entry) => readString(asRecord(entry).val))
        .filter((value): value is string => typeof value === 'string');
}

function readXrefs(node: Record<string, unknown>) {
    const meta = asRecord(node.meta);
    const xrefs = Array.isArray(meta.xrefs) ? meta.xrefs : [];
    return xrefs
        .map((entry) => readString(asRecord(entry).val))
        .filter((value): value is string => typeof value === 'string');
}

function findExactUmlsResult(payload: unknown, term: string): { ui: string; name: string } | null {
    const result = asRecord(asRecord(payload).result);
    const results = Array.isArray(result.results) ? result.results : [];
    const normalizedTerm = normalize(term);
    for (const entry of results) {
        const record = asRecord(entry);
        const ui = readString(record.ui);
        const name = readString(record.name);
        if (!ui || !name || !ui.startsWith('C')) continue;
        if (normalize(name) === normalizedTerm) return { ui, name };
    }
    return null;
}

function parseOboCode(codeSystem: string, id: unknown) {
    const value = readString(id);
    if (!value) return null;
    const normalizedSystem = codeSystem.toUpperCase();
    const match = value.match(/\/([A-Z]+)_([0-9]+)$/);
    if (!match) return value.includes(':') ? value : null;
    const [, prefix, code] = match;
    if (prefix !== normalizedSystem) return null;
    return `${prefix}:${code}`;
}

function findExactTerm(value: string, seedTerms: Set<string>) {
    const normalized = normalize(value);
    return seedTerms.has(normalized) ? value : null;
}

function dedupeMatches(matches: OfficialOntologyMatch[]) {
    const seen = new Set<string>();
    return matches.filter((match) => {
        const key = `${match.condition_key}:${match.code_system}:${match.external_code}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function inferLicenseStatus(license: string) {
    const normalized = license.toLowerCase();
    if (normalized.includes('open')) return 'open_license';
    if (normalized.includes('public')) return 'public_reference';
    if (normalized.includes('licensed')) return 'licensed';
    if (normalized.includes('restricted')) return 'restricted';
    return 'unknown';
}

function normalize(value: string) {
    return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
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

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}
