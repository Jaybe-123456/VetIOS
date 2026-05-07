export type PrecisionSpecies =
    | 'canine'
    | 'feline'
    | 'equine'
    | 'bovine'
    | 'avian'
    | 'porcine'
    | 'ovine'
    | 'reptile'
    | 'rabbit'
    | 'unknown';

export interface PrecisionPaper {
    pmid: string;
    doi: string;
    title: string;
    authors: string[];
    journal: string;
    year: number;
    abstract_url: string;
    full_text_url?: string;
    is_open_access: boolean;
    relevance_score: number;
    species_mentioned: string[];
    evidence_type: 'rct' | 'case_series' | 'cohort' | 'review' | 'consensus' | 'case_report';
}

export interface PrecisionGuidelineSource {
    source: string;
    title: string;
    url: string;
    relevance: 'high' | 'medium';
    rationale: string;
}

export const SOURCE_SPECIES_COVERAGE: Record<string, string[]> = {
    WSAVA: ['canine', 'feline'],
    AAHA: ['canine', 'feline'],
    VetCompass: ['canine', 'feline', 'rabbit'],
    ACVIM: ['canine', 'feline', 'equine', 'bovine'],
    AAEP: ['equine'],
    BEVA: ['equine'],
    AABP: ['bovine'],
    AVMA: ['canine', 'feline', 'equine', 'bovine', 'avian', 'porcine', 'ovine'],
    WOAH: ['equine', 'bovine', 'avian', 'porcine', 'ovine'],
    CFSPH: ['equine', 'bovine', 'avian', 'porcine', 'ovine'],
    'Merck VMM': ['canine', 'feline', 'equine', 'bovine', 'avian', 'porcine', 'ovine', 'reptile'],
};

export const DISEASE_SPECIALIST_SOURCES: Record<string, string[]> = {
    arboviral: ['WOAH', 'CFSPH', 'CDC', 'OIE'],
    parasitic: ['ESCCAP', 'CAPC', 'AAVP'],
    cardiac: ['ACVIM Cardiology', 'EVECCS'],
    oncology: ['VCOG', 'ACVIM Oncology'],
    orthopedic: ['ACVS', 'ECVS'],
    dermatology: ['ACVD', 'ECVD'],
    ophthalmology: ['ACVO', 'ECVO'],
    neurology: ['ACVIM Neurology', 'ECVN'],
    infectious: ['ACVIM Infectious Disease', 'WOAH'],
    reproduction: ['SFT', 'ACVR'],
    nutrition: ['WSAVA Nutrition', 'ACVN'],
};

const DIRECT_GUIDELINE_URLS: Record<string, string> = {
    WOAH: 'https://www.woah.org/en/what-we-do/standards/codes-and-manuals/',
    CFSPH: 'https://www.cfsph.iastate.edu/diseaseinfo/',
    'Merck VMM': 'https://www.merckvetmanual.com/',
    AVMA: 'https://www.avma.org/resources-tools',
    AAEP: 'https://aaep.org/guidelines-resources/',
    BEVA: 'https://www.beva.org.uk/Guidance-and-Resources',
    ACVIM: 'https://www.acvim.org/News/Consensus-Statements',
};

export function inferDiseaseCategory(condition: string): string {
    const lower = condition.toLowerCase();
    if (/\b(rift valley|west nile|arbovirus|arboviral|mosquito)\b/.test(lower)) return 'arboviral';
    if (/\b(parasit|worm|tick|mite|flea)\b/.test(lower)) return 'parasitic';
    if (/\b(cardio|heart|arrhythm|myocard)\b/.test(lower)) return 'cardiac';
    if (/\b(cancer|tumou?r|lymphoma|sarcoma|neoplas)\b/.test(lower)) return 'oncology';
    if (/\b(infect|viral|bacterial|zoon|fever|foreign animal)\b/.test(lower)) return 'infectious';
    return 'infectious';
}

export function isSourceRelevant(source: string, species: string, diseaseCategory: string): boolean {
    const speciesCoverage = SOURCE_SPECIES_COVERAGE[source] ?? null;
    if (speciesCoverage && !speciesCoverage.includes(species)) return false;

    const specialistSources = DISEASE_SPECIALIST_SOURCES[diseaseCategory] ?? [];
    const generalSources = ['Merck VMM', 'AVMA', 'Plumbs'];
    const allowedSources = [...specialistSources, ...generalSources];

    return allowedSources.includes(source);
}

export function buildPrecisionGuidelines(species: PrecisionSpecies, condition: string): PrecisionGuidelineSource[] {
    const diseaseCategory = inferDiseaseCategory(condition);
    const candidates = new Set([
        ...(DISEASE_SPECIALIST_SOURCES[diseaseCategory] ?? []),
        'Merck VMM',
        'AVMA',
        species === 'equine' ? 'AAEP' : '',
        species === 'bovine' ? 'AABP' : '',
    ].filter(Boolean));

    return Array.from(candidates)
        .filter((source) => isSourceRelevant(source, species, diseaseCategory))
        .map((source) => ({
            source,
            title: `${source} precision source for ${condition}`,
            url: DIRECT_GUIDELINE_URLS[source] ?? `https://www.google.com/search?q=${encodeURIComponent(`${source} ${condition} veterinary guideline`)}`,
            relevance: (DISEASE_SPECIALIST_SOURCES[diseaseCategory] ?? []).includes(source) ? 'high' : 'medium',
            rationale: `${source} covers ${species} and matches the ${diseaseCategory} disease category.`,
        }));
}

export async function searchPrecisionPubMed(
    species: PrecisionSpecies,
    condition: string,
    options: { fetchImpl?: typeof fetch; retmax?: number; email?: string; eutilsBaseUrl?: string } = {},
): Promise<PrecisionPaper[]> {
    const fetcher = options.fetchImpl ?? fetch;
    const baseUrl = options.eutilsBaseUrl ?? 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    const searchUrl = new URL(`${baseUrl.replace(/\/$/, '')}/esearch.fcgi`);
    searchUrl.searchParams.set('db', 'pubmed');
    searchUrl.searchParams.set('term', buildMeshQuery(species, condition));
    searchUrl.searchParams.set('retmax', String(options.retmax ?? 5));
    searchUrl.searchParams.set('sort', 'relevance');
    searchUrl.searchParams.set('retmode', 'json');
    searchUrl.searchParams.set('tool', 'VetIOS');
    if (options.email) searchUrl.searchParams.set('email', options.email);

    const searchResponse = await fetcher(searchUrl.toString(), { cache: 'no-store' });
    if (!searchResponse.ok) return [];
    const searchData = await searchResponse.json() as { esearchresult?: { idlist?: string[] } };
    const pmids = searchData.esearchresult?.idlist ?? [];
    if (pmids.length === 0) return [];

    const summaryUrl = new URL(`${baseUrl.replace(/\/$/, '')}/esummary.fcgi`);
    summaryUrl.searchParams.set('db', 'pubmed');
    summaryUrl.searchParams.set('id', pmids.join(','));
    summaryUrl.searchParams.set('retmode', 'json');
    summaryUrl.searchParams.set('tool', 'VetIOS');
    if (options.email) summaryUrl.searchParams.set('email', options.email);

    const summaryResponse = await fetcher(summaryUrl.toString(), { cache: 'no-store' });
    if (!summaryResponse.ok) return [];
    const summaryData = await summaryResponse.json() as {
        result?: Record<string, PubMedSummary | string[]>;
    };

    return pmids
        .map((pmid, index) => mapPubMedSummary(pmid, index, summaryData.result?.[pmid], species))
        .filter((paper): paper is PrecisionPaper => paper != null);
}

interface PubMedSummary {
    title?: string;
    source?: string;
    pubdate?: string;
    authors?: Array<{ name?: string }>;
    articleids?: Array<{ idtype?: string; value?: string }>;
    pubtype?: string[];
}

function buildMeshQuery(species: PrecisionSpecies, condition: string) {
    const speciesTerm = species === 'unknown' ? 'veterinary' : `${species}[Title/Abstract]`;
    return `(${condition}) AND (${speciesTerm}) AND (veterinary OR animals[MeSH Terms])`;
}

function mapPubMedSummary(
    pmid: string,
    index: number,
    value: PubMedSummary | string[] | undefined,
    species: PrecisionSpecies,
): PrecisionPaper | null {
    if (!value || Array.isArray(value)) return null;
    const doi = value.articleids?.find((id) => id.idtype === 'doi')?.value ?? '';
    const pmc = value.articleids?.find((id) => id.idtype === 'pmc')?.value;
    const pubTypes = value.pubtype ?? [];
    return {
        pmid,
        doi,
        title: value.title ?? `PubMed ${pmid}`,
        authors: (value.authors ?? []).slice(0, 3).map((author) => author.name ?? '').filter(Boolean),
        journal: value.source ?? 'PubMed',
        year: Number((value.pubdate ?? '').match(/\d{4}/)?.[0] ?? 0),
        abstract_url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        full_text_url: pmc ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc.startsWith('PMC') ? pmc : `PMC${pmc}`}/` : undefined,
        is_open_access: Boolean(pmc),
        relevance_score: Number((1 - index * 0.08).toFixed(2)),
        species_mentioned: species === 'unknown' ? [] : [species],
        evidence_type: inferEvidenceType(pubTypes, value.title ?? ''),
    };
}

function inferEvidenceType(pubTypes: string[], title: string): PrecisionPaper['evidence_type'] {
    const haystack = `${pubTypes.join(' ')} ${title}`.toLowerCase();
    if (haystack.includes('randomized') || haystack.includes('clinical trial')) return 'rct';
    if (haystack.includes('cohort')) return 'cohort';
    if (haystack.includes('review')) return 'review';
    if (haystack.includes('consensus') || haystack.includes('guideline')) return 'consensus';
    if (haystack.includes('case report')) return 'case_report';
    return 'case_series';
}
