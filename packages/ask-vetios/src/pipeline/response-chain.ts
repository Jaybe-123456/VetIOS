import {
    type PrecisionGuidelineSource,
    type PrecisionPaper,
    buildPrecisionGuidelines,
    searchPrecisionPubMed,
} from '../research-resolver/precision-sources';
import {
    type PMCFigure,
    resolvePMCFigures,
} from '../image-resolvers/pmc-figure-resolver';

export interface PharmacOSReasoningResponse {
    parsed_query?: unknown;
    validation?: unknown;
    blocked?: boolean;
    cards?: unknown[];
    warnings?: string[];
}

export type AskVetIOSQueryType =
    | 'drug_dose'
    | 'clinical_images'
    | 'diagnosis_support'
    | 'research'
    | 'disease_overview';

export interface ParsedAskVetIOSQuery {
    query_type: AskVetIOSQueryType;
    species: string;
    condition: string;
    finding_types_requested: string[];
    weight_kg?: number;
    concurrent_meds: string[];
}

export interface AskVetIOSResponseChain {
    parsed_query: ParsedAskVetIOSQuery;
    disease_overview?: string;
    clinical_images?: {
        figures: PMCFigure[];
        reference_description?: ReferenceDescription;
    };
    drug_panel?: PharmacOSReasoningResponse;
    research_sources: {
        papers: PrecisionPaper[];
        guidelines: PrecisionGuidelineSource[];
    };
    response_sections: string[];
}

export interface ReferenceDescription {
    finding_type: string;
    visual_descriptors: {
        color: string;
        texture: string;
        distribution: string;
        size_range: string;
        key_distinguishing_features: string[];
        differential_appearance: string;
    };
    search_guidance: {
        recommended_atlases: string[];
        doi_links: string[];
        wikimedia_commons_categories: string[];
    };
}

export interface ResponseChainDeps {
    runPharmacOS?: (input: {
        query: string;
        species: string;
        weight_kg?: number;
        indication: string;
        concurrent_medications: string[];
    }) => Promise<PharmacOSReasoningResponse>;
    synthesizeDiseaseOverview?: (parsed: ParsedAskVetIOSQuery) => Promise<string>;
    fetchImpl?: typeof fetch;
}

export async function runAskVetIOSResponseChain(
    query: string,
    deps: ResponseChainDeps = {},
): Promise<AskVetIOSResponseChain> {
    const parsed = parseAskVetIOSQuery(query);
    const imagePromise = parsed.query_type === 'clinical_images' || parsed.query_type === 'disease_overview'
        ? resolvePMCFigures(`${parsed.species} ${parsed.condition} pathology figure`, { fetchImpl: deps.fetchImpl, retmax: 6 })
        : Promise.resolve([]);
    const papersPromise = searchPrecisionPubMed(parsed.species as never, parsed.condition, { fetchImpl: deps.fetchImpl }).catch(() => []);
    const guidelines = buildPrecisionGuidelines(parsed.species as never, parsed.condition);
    const overviewPromise = parsed.query_type === 'disease_overview'
        ? deps.synthesizeDiseaseOverview?.(parsed) ?? Promise.resolve(buildDeterministicDiseaseOverview(parsed, guidelines))
        : Promise.resolve(undefined);
    const drugPromise = parsed.query_type === 'drug_dose' && deps.runPharmacOS
        ? deps.runPharmacOS({
            query,
            species: parsed.species,
            weight_kg: parsed.weight_kg,
            indication: parsed.condition,
            concurrent_medications: parsed.concurrent_meds,
        })
        : Promise.resolve(undefined);

    const [figures, papers, diseaseOverview, drugPanel] = await Promise.all([
        imagePromise,
        papersPromise,
        overviewPromise,
        drugPromise,
    ]);

    return {
        parsed_query: parsed,
        disease_overview: diseaseOverview,
        clinical_images: figures.length > 0
            ? { figures }
            : parsed.query_type === 'clinical_images' || parsed.query_type === 'disease_overview'
                ? { figures: [], reference_description: buildReferenceDescription(parsed.finding_types_requested[0] ?? 'gross_pathology', parsed.condition, parsed.species) }
                : undefined,
        drug_panel: drugPanel,
        research_sources: { papers, guidelines },
        response_sections: [
            diseaseOverview ? 'disease_overview' : '',
            figures.length > 0 || parsed.query_type === 'clinical_images' ? 'clinical_images' : '',
            drugPanel ? 'drug_panel' : '',
            papers.length > 0 || guidelines.length > 0 ? 'research_sources' : '',
        ].filter(Boolean),
    };
}

export function parseAskVetIOSQuery(query: string): ParsedAskVetIOSQuery {
    const lower = query.toLowerCase();
    const queryType: AskVetIOSQueryType = /\b(dose|mg\/kg|drug|medication|pharmacos|withdrawal)\b/.test(lower)
        ? 'drug_dose'
        : /\b(image|picture|histopath|gross|radiograph|ultrasound|cytology|pathology)\b/.test(lower)
            ? 'clinical_images'
            : /\b(pubmed|paper|research|source|citation|doi)\b/.test(lower)
                ? 'research'
                : /\b(diagnos|differential|workup)\b/.test(lower)
                    ? 'diagnosis_support'
                    : 'disease_overview';
    return {
        query_type: queryType,
        species: detectSpecies(query) ?? 'unknown',
        condition: detectCondition(query),
        finding_types_requested: detectFindingTypes(query),
        weight_kg: extractWeight(query),
        concurrent_meds: extractConcurrentMeds(query),
    };
}

function detectSpecies(query: string) {
    const lower = query.toLowerCase();
    if (/\b(equine|horse|foal|mare|stallion)\b/.test(lower)) return 'equine';
    if (/\b(canine|dog|puppy)\b/.test(lower)) return 'canine';
    if (/\b(feline|cat|kitten)\b/.test(lower)) return 'feline';
    if (/\b(bovine|cow|cattle|calf)\b/.test(lower)) return 'bovine';
    if (/\b(porcine|pig|swine)\b/.test(lower)) return 'porcine';
    if (/\b(ovine|sheep|lamb)\b/.test(lower)) return 'ovine';
    if (/\b(avian|bird|parrot|chicken)\b/.test(lower)) return 'avian';
    if (/\b(reptile|snake|lizard|turtle)\b/.test(lower)) return 'reptile';
    return null;
}

function detectCondition(query: string) {
    const explicit = query.match(/\b(?:for|of|about|with)\s+([A-Za-z][A-Za-z0-9\s-]{2,90})/i)?.[1];
    return explicit?.replace(/\b(?:images|drug|dose|doses|research|sources|papers)\b/gi, '').trim()
        || query.split(/[.?!]/)[0]?.slice(0, 90).trim()
        || 'current clinical condition';
}

function detectFindingTypes(query: string) {
    const lower = query.toLowerCase();
    const findings: string[] = [];
    if (lower.includes('gross')) findings.push('gross_pathology');
    if (lower.includes('histopath')) findings.push('histopathology');
    if (lower.includes('radiograph') || lower.includes('ultrasound')) findings.push('diagnostic_imaging');
    if (lower.includes('cytology') || lower.includes('haematology') || lower.includes('hematology')) findings.push('cytology');
    return findings.length ? findings : ['gross_pathology', 'histopathology', 'diagnostic_imaging', 'cytology'];
}

function extractWeight(query: string) {
    const match = query.match(/\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    if (!match?.[1]) return undefined;
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractConcurrentMeds(query: string) {
    const block = query.match(/\b(?:with|on|taking|concurrent(?:ly)?(?: with)?|medications?:)\s+([^.;]+)/i)?.[1] ?? '';
    return block.split(/,|\+|\band\b/i).map((part) => part.trim()).filter((part) => part.length > 2);
}

function buildDeterministicDiseaseOverview(parsed: ParsedAskVetIOSQuery, guidelines: PrecisionGuidelineSource[]) {
    const sourceNames = guidelines.map((source) => source.source).join(', ') || 'Merck VMM and specialist references';
    return [
        `PATHOGENESIS: ${parsed.condition} in ${parsed.species} should be explained from the lesion mechanism and transmission route, with claims tied to ${sourceNames}. Species-specific susceptibility and organ tropism should be separated from generic disease definitions.`,
        `CLINICAL SIGNS: Common, uncommon, and rare signs should be grouped by body system for ${parsed.species}; signs absent from this species should not be carried over from other taxa.`,
        `DIAGNOSTICS: Tests should be ordered by diagnostic yield, beginning with confirmatory assays or imaging most likely to change management. Sensitivity and specificity should be shown when a cited source provides them.`,
        `TREATMENT: First-line supportive and targeted therapy should be separated from second-line or salvage plans. Species-specific doses belong in PharmacOS rather than the overview prose.`,
        `PROGNOSIS: Outcome estimates should be numeric when the literature supports them and otherwise explicitly marked as limited evidence.`,
        `BIOSAFETY: Zoonotic risk, notifiable status, PPE, isolation, and client communication should follow the matched specialist source rather than generic small-animal guidance.`,
    ].join('\n\n');
}

function buildReferenceDescription(findingType: string, condition: string, species: string): ReferenceDescription {
    return {
        finding_type: findingType,
        visual_descriptors: {
            color: 'Describe lesion color relative to normal tissue and hemorrhage/necrosis pattern.',
            texture: 'Record firmness, friability, exudate, fibrosis, mineralization, or tissue collapse.',
            distribution: 'State focal, multifocal, segmental, diffuse, bilateral, or system-localized distribution.',
            size_range: 'Use measured ranges when available; otherwise separate microscopic from gross scale.',
            key_distinguishing_features: [
                `${species} tissue compartment affected by ${condition}`,
                'Lesion pattern that separates primary disease from secondary infection or autolysis',
                'Ancillary stains, IHC, PCR, or imaging sequences needed for confirmation',
            ],
            differential_appearance: 'A competing differential would be favored if lesion distribution, organism morphology, or tissue tropism does not match the expected pattern.',
        },
        search_guidance: {
            recommended_atlases: [
                'Jubb, Kennedy & Palmer Pathology of Domestic Animals, latest edition',
                'Zachary Pathologic Basis of Veterinary Disease, latest edition',
            ],
            doi_links: [],
            wikimedia_commons_categories: [`${species} pathology`, `${condition} pathology`],
        },
    };
}
