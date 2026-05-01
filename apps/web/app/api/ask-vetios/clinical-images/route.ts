import { NextResponse } from 'next/server';
import { z } from 'zod';
import { compactSearchTerms, detectSpeciesFromTexts, type DetectedVetiosSpecies } from '@/lib/askVetios/context';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
    topic: z.string().trim().optional(),
    messageContent: z.string().trim().min(1).max(12000),
    queryText: z.string().trim().max(4000).optional(),
});

type FindingId = 'gross' | 'histopathology' | 'radiography' | 'cytology';

interface ImageFinding {
    id: FindingId;
    label: string;
    description: string;
    confidence: number;
    sourceType: string;
    searchQuery: string;
    wikimedia_query: string;
    pubmed_image_query: string;
    idexx_relevant: boolean;
    clinical_note: string;
}

interface ReferenceImage {
    title: string;
    thumbnailUrl: string;
    pageUrl: string;
    source: string;
    license?: string;
    attribution?: string;
}

type ImageProvider = 'bing' | 'google_cse' | 'wikimedia';

interface ResearchSource {
    title: string;
    url: string;
    snippet: string;
    source: string;
    sourceType: ResearchSourceType;
    tier: 1 | 2;
    relevance: 'high' | 'medium' | 'low';
    open_access: boolean;
    species_specific: boolean;
}

type ResearchSourceType =
    | 'pubmed'
    | 'wikipedia'
    | 'idexx'
    | 'vetcompass'
    | 'merck'
    | 'abcd'
    | 'wsava'
    | 'aaha'
    | 'acvim'
    | 'woah'
    | 'bsava'
    | 'cfsph'
    | 'researchgate'
    | 'antech'
    | 'vin'
    | 'rvc'
    | 'vetevidence'
    | 'fao'
    | 'farad';

function detectDisease(topic: string | undefined, messageContent: string, queryText?: string) {
    if (topic?.trim()) return topic.trim();
    const queryDisease = queryText?.match(/\b(?:for|of|about)\s+([A-Za-z][A-Za-z\s-]{2,80})/i)?.[1]?.trim();
    if (queryDisease) return queryDisease;
    const firstSentence = messageContent.split(/[.!?]/)[0] ?? '';
    const match = firstSentence.match(/^([A-Z][^,.(]{2,80}?)(?:\s+(?:is|are|causes|results|presents)\b)/);
    return match?.[1]?.trim() || 'Current disease process';
}

function stripCodeFences(value: string) {
    return value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

const FINDING_BLUEPRINTS: Array<{
    id: FindingId;
    label: string;
    searchTerms: string;
    wikimediaTerms: string;
    pubmedTerms: string;
    confidence: number;
    idexxRelevant: boolean;
    clinicalNote: string;
}> = [
    {
        id: 'gross',
        label: 'Gross Pathology',
        searchTerms: 'gross pathology necropsy lesion cut surface',
        wikimediaTerms: 'gross pathology veterinary necropsy lesion',
        pubmedTerms: 'gross pathology necropsy figure',
        confidence: 0.52,
        idexxRelevant: false,
        clinicalNote: 'This is primarily a post-mortem or surgical specimen finding; confirmation depends on histopathology with ancillary testing selected from the lesion pattern.',
    },
    {
        id: 'histopathology',
        label: 'Histopathology',
        searchTerms: 'histopathology H&E lesion tissue section',
        wikimediaTerms: 'histopathology veterinary H&E lesion',
        pubmedTerms: 'histopathology H&E figure',
        confidence: 0.58,
        idexxRelevant: true,
        clinicalNote: 'Submit representative tissue in 10% neutral buffered formalin; request special stains, IHC, PCR, or culture when morphology does not identify the cause.',
    },
    {
        id: 'radiography',
        label: 'Radiographic & Imaging Findings',
        searchTerms: 'radiograph ultrasound diagnostic imaging findings',
        wikimediaTerms: 'veterinary radiograph ultrasound pathology',
        pubmedTerms: 'radiograph ultrasound diagnostic imaging figure',
        confidence: 0.44,
        idexxRelevant: false,
        clinicalNote: 'Best modality depends on the affected system; radiographs screen mineral, gas, thoracic, and skeletal disease, while ultrasound, CT, or MRI better define soft tissue and neurologic lesions.',
    },
    {
        id: 'cytology',
        label: 'Cytology & Haematology',
        searchTerms: 'cytology haematology blood smear CBC cell morphology',
        wikimediaTerms: 'veterinary cytology haematology smear',
        pubmedTerms: 'cytology haematology blood smear figure',
        confidence: 0.5,
        idexxRelevant: true,
        clinicalNote: 'Use fresh EDTA blood, direct smears, or FNA/impression preparations; CBC, cytology review, PCR, serology, or culture confirms the process depending on the suspected agent.',
    },
];

function speciesSearchTerm(species: DetectedVetiosSpecies) {
    return species === 'unknown' ? 'veterinary' : species;
}

function speciesDisplay(species: DetectedVetiosSpecies) {
    return species === 'unknown' ? 'the submitted veterinary species' : species;
}

function buildFindingQuery(disease: string, species: DetectedVetiosSpecies, finding: string) {
    return compactSearchTerms([
        speciesSearchTerm(species),
        disease,
        finding,
    ]);
}

function buildWikimediaQuery(disease: string, species: DetectedVetiosSpecies, finding: string) {
    return compactSearchTerms([speciesSearchTerm(species), disease, finding, 'pathology']);
}

function buildPubMedImageQuery(disease: string, species: DetectedVetiosSpecies, finding: string) {
    return compactSearchTerms([speciesSearchTerm(species), disease, finding, 'PubMed figure']);
}

function speciesSpecificRule(species: DetectedVetiosSpecies) {
    switch (species) {
        case 'feline':
            return 'Compare the lesion pattern with canine disease only after checking feline-specific features such as lymphoid depletion, crypt injury, neonatal cerebellar lesions, or species-specific inflammatory responses.';
        case 'canine':
            return 'Note breed-linked anatomy or predisposition when it changes lesion distribution, such as deep-chested conformation, brachycephalic airway structure, or breed-associated neoplasia risk.';
        case 'equine':
            return 'For imaging, record whether the study was obtained standing under sedation or under general anaesthesia because positioning and motion change interpretation.';
        case 'bovine':
            return 'Separate live-animal imaging findings from slaughter or necropsy lesions, and account for rumen fill and ingesta when interpreting abdominal images.';
        case 'avian':
            return 'State the avian group when known because psittacine, passerine, raptor, and poultry lesions may differ in organ distribution and diagnostic sampling.';
        default:
            return 'If species is not explicit, flag domestic-species extrapolation and keep the description tied to the submitted signalment and case context.';
    }
}

function deterministicDescription(id: FindingId, disease: string, species: DetectedVetiosSpecies) {
    const speciesName = speciesDisplay(species);
    const speciesRule = speciesSpecificRule(species);

    if (id === 'gross') {
        return `In suspected ${disease} in ${speciesName}, gross pathology should be described at the primary organ system level with distribution recorded as focal, multifocal, segmental, or diffuse. The expected lesion description should capture colour, contour, capsular or mucosal surface change, firmness or friability, fluid content, and cut-surface architecture so the pathological process is separated from trauma, post-mortem autolysis, and secondary infection. Useful reference images show both the intact organ and a close cut surface highlighting necrosis, haemorrhage, exudate, fibrosis, mineralisation, abscessation, or neoplastic replacement when present. ${speciesRule}`;
    }

    if (id === 'histopathology') {
        return `For ${disease} in ${speciesName}, H&E histopathology should target the tissue compartment driving the case: epithelium, crypts, glands, vessels, lymphoid tissue, nervous tissue, or interstitium. The microscopic finding should specify the dominant cell population, inflammatory pattern, necrosis type, tissue invasion, inclusion bodies, organisms, vascular injury, fibrosis, mineralisation, or neoplastic criteria rather than naming inflammation alone. When routine H&E does not identify the cause, IHC, special stains, PCR, culture, or electron microscopy should be requested based on the suspected disease mechanism. ${speciesRule}`;
    }

    if (id === 'radiography') {
        return `Imaging for suspected ${disease} in ${speciesName} should use the modality that best displays the affected anatomy, with radiographs documenting view, opacity, gas, mineral, silhouette, size, and distribution. Ultrasound should describe echogenicity, wall layering, effusion, vascularity, and guided sampling targets, while CT or MRI should document window or sequence, contrast enhancement, mass effect, and regional extension. Some diseases have normal survey radiographs early, so an unremarkable image should be interpreted against the disease mechanism and followed with ultrasound, CT, MRI, or repeat imaging when clinical suspicion remains high. ${speciesRule}`;
    }

    return `Cytology and haematology for suspected ${disease} in ${speciesName} should start with the sample type, including fresh blood smear, buffy coat, FNA, impression smear, fluid analysis, or airway/GI preparation. The finding should identify cell lineage, maturation, atypia, toxic change, intracellular or extracellular organisms, inclusion bodies, haemoparasites, platelet changes, and the relative mix of neutrophils, macrophages, eosinophils, lymphocytes, or neoplastic cells. CBC interpretation should report the direction and severity of leukocyte, neutrophil, lymphocyte, erythrocyte, and platelet changes that support the disease mechanism and distinguish infectious, inflammatory, immune-mediated, toxic, and neoplastic differentials. ${speciesRule}`;
}

function buildDefaultFinding(
    finding: typeof FINDING_BLUEPRINTS[number],
    disease: string,
    species: DetectedVetiosSpecies,
): ImageFinding {
    return {
        id: finding.id,
        label: finding.label,
        description: deterministicDescription(finding.id, disease, species),
        confidence: finding.confidence,
        sourceType: 'vetios',
        searchQuery: buildFindingQuery(disease, species, finding.searchTerms),
        wikimedia_query: buildWikimediaQuery(disease, species, finding.wikimediaTerms),
        pubmed_image_query: buildPubMedImageQuery(disease, species, finding.pubmedTerms),
        idexx_relevant: finding.idexxRelevant,
        clinical_note: finding.clinicalNote,
    };
}

function buildLocalFindings(disease: string, species: DetectedVetiosSpecies): ImageFinding[] {
    return FINDING_BLUEPRINTS.map((finding) => buildDefaultFinding(finding, disease, species));
}

function isFindingId(value: unknown): value is FindingId {
    return value === 'gross' || value === 'histopathology' || value === 'radiography' || value === 'cytology';
}

function cleanString(value: unknown) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function hasBannedCopy(value: string) {
    return /\bunavailable\b|\bfallback\b/i.test(value);
}

function sentenceCount(value: string) {
    return (value.match(/[.!?](?:\s|$)/g) ?? []).length;
}

function usableNarrative(value: unknown, minimumSentences = 1) {
    const text = cleanString(value);
    if (!text || hasBannedCopy(text)) return '';
    if (sentenceCount(text) < minimumSentences) return '';
    return text;
}

function clampConfidence(value: unknown, defaultValue: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
    return Math.min(1, Math.max(0, value));
}

function normalizeFindings(
    incoming: Array<Partial<ImageFinding> & { id?: string }>,
    disease: string,
    species: DetectedVetiosSpecies,
    sourceType: 'claude' | 'vetios',
): ImageFinding[] {
    const byId = new Map<FindingId, Partial<ImageFinding>>();
    for (const finding of incoming) {
        if (isFindingId(finding.id) && !byId.has(finding.id)) {
            byId.set(finding.id, finding);
        }
    }

    return FINDING_BLUEPRINTS.map((blueprint) => {
        const base = buildDefaultFinding(blueprint, disease, species);
        const raw = byId.get(blueprint.id);
        if (!raw) return base;

        const description = usableNarrative(raw.description, 3) || base.description;
        const clinicalNote = usableNarrative(raw.clinical_note) || base.clinical_note;
        const searchQuery = cleanString(raw.searchQuery) || base.searchQuery;
        const wikimediaQuery = cleanString(raw.wikimedia_query) || base.wikimedia_query;
        const pubmedImageQuery = cleanString(raw.pubmed_image_query) || base.pubmed_image_query;

        return {
            id: blueprint.id,
            label: cleanString(raw.label) || base.label,
            description,
            confidence: clampConfidence(raw.confidence, base.confidence),
            sourceType,
            searchQuery: hasBannedCopy(searchQuery) ? base.searchQuery : searchQuery,
            wikimedia_query: hasBannedCopy(wikimediaQuery) ? base.wikimedia_query : wikimediaQuery,
            pubmed_image_query: hasBannedCopy(pubmedImageQuery) ? base.pubmed_image_query : pubmedImageQuery,
            idexx_relevant: typeof raw.idexx_relevant === 'boolean' ? raw.idexx_relevant : base.idexx_relevant,
            clinical_note: clinicalNote,
        };
    });
}

async function fetchClaudeFindings(disease: string, species: DetectedVetiosSpecies, messageContent: string, queryText?: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
    if (!apiKey) return null;

    const prompt = [
        'You are VetIOS Visual Pathology Intelligence, a specialist veterinary imaging and histopathology agent trained at the level of a board-certified veterinary pathologist and diagnostic imaging specialist.',
        '',
        'INPUT',
        `SPECIES: ${species}`,
        `DISEASE/CONDITION: ${disease}`,
        `QUERY: ${queryText ?? 'not supplied'}`,
        `CONTEXT: ${messageContent.slice(0, 6000)}`,
        '',
        'TASK',
        'Generate exactly FOUR visual pathology findings with maximum clinical specificity.',
        'For each finding, provide a description precise enough that a veterinary student could identify the lesion in a real specimen or image.',
        '',
        'OUTPUT RULES',
        'Return only valid JSON. Do not include markdown, comments, or preamble.',
        'Use this exact top-level shape: {"findings":[...]}',
        'The findings array must contain exactly these ids in this order: gross, histopathology, radiography, cytology.',
        'Each finding must include: id, label, description, confidence, sourceType, searchQuery, wikimedia_query, pubmed_image_query, idexx_relevant, clinical_note.',
        'sourceType must be "claude". confidence must be a number from 0.0 to 1.0.',
        '',
        'FINDING REQUIREMENTS',
        'gross: species-specific gross lesion description with organ affected, colour, texture, size range, distribution, cut-surface appearance, odour if relevant, differential features, and the named pathological process. Minimum 3 sentences.',
        'histopathology: species-specific H&E description with tissue, affected cell types, infiltrate, necrosis pattern, inclusions or organisms if present, IHC markers, and EM findings if relevant. Minimum 3 sentences.',
        'radiography: species-specific radiograph, ultrasound, CT, or MRI description with view or plane, affected structure, opacity or echogenicity, measurements when useful, distribution, DICOM window or sequence for CT/MRI, and contrast pattern. If imaging can be normal, state why. Minimum 3 sentences.',
        'cytology: species-specific cytology or haematology description with sample type, stain, cell morphology, organisms or inclusions, inflammatory ratios, toxic change, and typical CBC findings. Minimum 3 sentences.',
        '',
        'SPECIES RULES',
        'Feline: note differences from canine; for feline panleukopenia include severe lymphopenia, intestinal crypt necrosis, and neonatal cerebellar hypoplasia where relevant.',
        'Canine: use standard domestic dog references and note breed predispositions when they affect appearance.',
        'Equine: note whether standing sedation versus general anaesthesia affects imaging interpretation.',
        'Bovine: separate slaughter or necropsy findings from live-animal findings; rumen contents affect abdominal imaging.',
        'Avian: specify psittacine, passerine, raptor, or poultry differences when context supports it.',
        'Exotic or zoo species: flag extrapolation from domestic species.',
        '',
        'SEARCH QUERY RULES',
        'Every searchQuery must include species, disease, a specific lesion name, and the finding type.',
        'wikimedia_query must be optimized for Wikimedia Commons.',
        'pubmed_image_query must be optimized for finding PubMed figures.',
        'Avoid generic queries such as "canine disease pathology" or "dog radiograph".',
        '',
        'BANNED COPY',
        'Never use the words "unavailable" or "fallback".',
        'Never output "Gross lesion enrichment unavailable", "Histopathology enrichment unavailable", "Radiographic enrichment unavailable", or "Cytology enrichment unavailable".',
        'If a specific finding is uncertain, describe the expected pathological changes from the disease mechanism instead of saying it cannot be described.',
    ].join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2600,
            temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        throw new Error(`Anthropic request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((item) => item.type === 'text')?.text;
    if (!text) return null;

    const parsed = JSON.parse(stripCodeFences(text)) as { findings?: Array<Partial<ImageFinding> & { id?: string }> };
    return Array.isArray(parsed.findings) ? normalizeFindings(parsed.findings, disease, species, 'claude') : null;
}

async function searchWikimediaImages(query: string): Promise<ReferenceImage[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', '2');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata');
    url.searchParams.set('iiurlwidth', '480');

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];

    const data = (await response.json()) as {
        query?: {
            pages?: Record<string, {
                title?: string;
                imageinfo?: Array<{
                    thumburl?: string;
                    descriptionurl?: string;
                    url?: string;
                    extmetadata?: {
                        LicenseShortName?: { value?: string };
                        Artist?: { value?: string };
                        Credit?: { value?: string };
                    };
                }>;
            }>;
        };
    };

    return Object.values(data.query?.pages ?? {})
        .map((page): ReferenceImage | null => {
            const image = page.imageinfo?.[0];
            if (!image?.thumburl || !image.descriptionurl) return null;
            return {
                title: page.title ?? 'Reference image',
                thumbnailUrl: image.thumburl,
                pageUrl: image.descriptionurl,
                source: 'Wikimedia Commons',
                license: stripHtml(image.extmetadata?.LicenseShortName?.value ?? ''),
                attribution: stripHtml(image.extmetadata?.Artist?.value ?? image.extmetadata?.Credit?.value ?? ''),
            };
        })
        .filter((item): item is ReferenceImage => item !== null && isLikelyClinicalImage(item));
}

async function searchBingImages(query: string): Promise<ReferenceImage[]> {
    const apiKey = process.env.BING_IMAGE_SEARCH_API_KEY;
    if (!apiKey) return [];

    const endpoint = process.env.BING_IMAGE_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/images/search';
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', '3');
    url.searchParams.set('safeSearch', 'Moderate');
    url.searchParams.set('imageType', 'Photo');

    const response = await fetch(url.toString(), {
        cache: 'no-store',
        headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
        },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
        value?: Array<{
            name?: string;
            thumbnailUrl?: string;
            hostPageUrl?: string;
            hostPageDisplayUrl?: string;
        }>;
    };

    return (data.value ?? [])
        .map((image) => {
            if (!image.thumbnailUrl || !image.hostPageUrl) return null;
            return {
                title: image.name ?? 'Reference image',
                thumbnailUrl: image.thumbnailUrl,
                pageUrl: image.hostPageUrl,
                source: image.hostPageDisplayUrl ? `Bing // ${image.hostPageDisplayUrl}` : 'Bing Image Search',
            };
        })
        .filter(isLikelyClinicalImage)
        .filter((item): item is ReferenceImage => item !== null);
}

async function searchGoogleCseImages(query: string): Promise<ReferenceImage[]> {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_ID;
    if (!apiKey || !cx) return [];

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('searchType', 'image');
    url.searchParams.set('num', '3');
    url.searchParams.set('safe', 'active');

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];

    const data = (await response.json()) as {
        items?: Array<{
            title?: string;
            link?: string;
            image?: {
                thumbnailLink?: string;
                contextLink?: string;
            };
            displayLink?: string;
        }>;
    };

    return (data.items ?? [])
        .map((image) => {
            const thumbnailUrl = image.image?.thumbnailLink;
            const pageUrl = image.image?.contextLink || image.link;
            if (!thumbnailUrl || !pageUrl) return null;
            return {
                title: image.title ?? 'Reference image',
                thumbnailUrl,
                pageUrl,
                source: image.displayLink ? `Google CSE // ${image.displayLink}` : 'Google Custom Search',
            };
        })
        .filter(isLikelyClinicalImage)
        .filter((item): item is ReferenceImage => item !== null);
}

function resolveImageProvider(): ImageProvider {
    if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID) return 'google_cse';
    if (process.env.BING_IMAGE_SEARCH_API_KEY) return 'bing';
    return 'wikimedia';
}

async function searchConfiguredImages(finding: ImageFinding): Promise<ReferenceImage[]> {
    // Try Google CSE if configured
    if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID) {
        try {
            const results = await searchGoogleCseImages(finding.searchQuery);
            if (results.length > 0) return results;
        } catch (error) {
            console.error('Google CSE search failed:', error);
        }
    }

    // Try Bing Image Search if configured
    if (process.env.BING_IMAGE_SEARCH_API_KEY) {
        try {
            const results = await searchBingImages(finding.searchQuery);
            if (results.length > 0) return results;
        } catch (error) {
            console.error('Bing Image Search failed:', error);
        }
    }

    try {
        return await searchWikimediaImages(finding.wikimedia_query || finding.searchQuery);
    } catch (error) {
        console.error('Wikimedia Commons search failed:', error);
        return [];
    }
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function isLikelyClinicalImage(image: ReferenceImage | null): image is ReferenceImage {
    if (!image) return false;
    const haystack = `${image.title} ${image.source}`.toLowerCase();
    const blocked = ['logo', 'map', 'flag', 'book cover', 'pesticides documentation', 'reporter (philadelphia)'];
    return !blocked.some((term) => haystack.includes(term));
}

const FOOD_ANIMAL_SPECIES = new Set<DetectedVetiosSpecies>(['bovine', 'porcine', 'ovine']);
const FOOD_ANIMAL_TERMS = /\b(food animal|livestock|cattle|cow|calf|calves|bovine|swine|pig|porcine|sheep|ovine|goat|caprine|poultry|chicken|turkey|duck|goose|broiler|layer|flock)\b/i;
const DIAGNOSTIC_TERMS = /\b(diagnos\w*|tests?|panels?|cbc|chemistry|reference ranges?|cytology|histopath\w*|biopsy|pcr|serology|culture|susceptibility|snap|sedivue|catalyst|procyte|imaging|radiograph|ultrasound)\b/i;
const UK_EUROPE_TERMS = /\b(uk|united kingdom|britain|british|england|scotland|wales|ireland|europe|european|rvc|bsava|vetcompass)\b/i;
const EXOTIC_TERMS = /\b(exotic|zoo|wildlife|reptile|snake|lizard|turtle|chelonian|rabbit|ferret|rodent|guinea pig|hamster|zoological)\b/i;
const AMR_TERMS = /\b(amr|antimicrobial resistance|antibiotic resistance|resistan(?:t|ce)|mdr|multidrug|esbl|mrsa|vre)\b/i;

interface ResearchContext {
    disease: string;
    species: DetectedVetiosSpecies;
    queryText?: string;
    combinedText: string;
    researchQuery: string;
    isFoodAnimal: boolean;
    isDiagnostic: boolean;
    isUkEurope: boolean;
    isExoticZoo: boolean;
    isAmr: boolean;
}

interface Tier2SourceDefinition {
    sourceType: ResearchSourceType;
    source: string;
    title: string;
    url: (encodedQuery: string) => string;
    focus: string;
    note?: string;
    openAccess: boolean;
    speciesSpecific: (context: ResearchContext) => boolean;
    relevance: (context: ResearchContext) => ResearchSource['relevance'];
    priority: number;
}

function buildResearchContext(disease: string, species: DetectedVetiosSpecies, queryText?: string): ResearchContext {
    const combinedText = compactSearchTerms([queryText, disease, species]).toLowerCase();
    const researchQuery = compactSearchTerms([
        species === 'unknown' ? 'veterinary' : species,
        disease,
    ]);

    return {
        disease,
        species,
        queryText,
        combinedText,
        researchQuery,
        isFoodAnimal: FOOD_ANIMAL_SPECIES.has(species) || FOOD_ANIMAL_TERMS.test(combinedText),
        isDiagnostic: DIAGNOSTIC_TERMS.test(combinedText),
        isUkEurope: UK_EUROPE_TERMS.test(combinedText),
        isExoticZoo: EXOTIC_TERMS.test(combinedText),
        isAmr: AMR_TERMS.test(combinedText),
    };
}

function encodeResearchQuery(query: string) {
    return encodeURIComponent(query).replace(/%20/g, '+');
}

function sourceSnippet(source: Tier2SourceDefinition, context: ResearchContext) {
    return compactSearchTerms([
        `${source.focus} for ${context.species === 'unknown' ? 'veterinary' : context.species} ${context.disease}.`,
        source.note,
    ]);
}

function isCompanionAnimal(context: ResearchContext) {
    return context.species === 'canine' || context.species === 'feline';
}

const TIER_2_SOURCES: Tier2SourceDefinition[] = [
    {
        sourceType: 'merck',
        source: 'Merck VMM',
        title: 'Merck Veterinary Manual clinical reference',
        url: (query) => `https://www.merckvetmanual.com/search?query=${query}`,
        focus: 'Authoritative clinical reference, species-specific protocols, diagnosis, treatment, and prevention summaries',
        openAccess: true,
        speciesSpecific: () => true,
        relevance: () => 'high',
        priority: 10,
    },
    {
        sourceType: 'idexx',
        source: 'IDEXX',
        title: 'IDEXX diagnostic resources',
        url: (query) => `https://www.idexx.com/en/veterinary/resources-for-vets/?q=${query}`,
        focus: 'Diagnostic panels, reference ranges, test interpretation guides, SediVue, Catalyst, ProCyte, and SNAP references',
        openAccess: true,
        speciesSpecific: () => true,
        relevance: (context) => context.isDiagnostic ? 'high' : 'medium',
        priority: 20,
    },
    {
        sourceType: 'antech',
        source: 'Antech',
        title: 'Antech Diagnostics test resources',
        url: (query) => `https://www.antechdiagnostics.com/search?q=${query}`,
        focus: 'Diagnostic laboratory reference intervals, test menus, infectious disease testing, and oncology panels',
        openAccess: true,
        speciesSpecific: () => true,
        relevance: (context) => context.isDiagnostic ? 'high' : 'medium',
        priority: 21,
    },
    {
        sourceType: 'wsava',
        source: 'WSAVA',
        title: 'WSAVA global veterinary guidelines',
        url: (query) => `https://wsava.org/?s=${query}`,
        focus: 'Global vaccination, diagnostic, nutrition, welfare, and treatment guidelines for small animal practice',
        openAccess: true,
        speciesSpecific: (context) => isCompanionAnimal(context),
        relevance: (context) => isCompanionAnimal(context) ? 'high' : 'medium',
        priority: 30,
    },
    {
        sourceType: 'aaha',
        source: 'AAHA',
        title: 'AAHA practice guidelines',
        url: (query) => `https://www.aaha.org/search/?q=${query}`,
        focus: 'Practice guidelines, accreditation standards, and AAHA/AAFP joint guidance',
        openAccess: true,
        speciesSpecific: (context) => isCompanionAnimal(context),
        relevance: (context) => context.species === 'canine' || context.species === 'feline' ? 'high' : 'medium',
        priority: 31,
    },
    {
        sourceType: 'abcd',
        source: 'ABCD',
        title: 'ABCD feline disease guidelines',
        url: (query) => `https://www.abcdcatsvets.org/?s=${query}`,
        focus: 'Feline-specific evidence-based infectious disease guidelines and vaccination guidance',
        openAccess: true,
        speciesSpecific: (context) => context.species === 'feline',
        relevance: (context) => context.species === 'feline' ? 'high' : 'low',
        priority: 32,
    },
    {
        sourceType: 'acvim',
        source: 'ACVIM',
        title: 'ACVIM consensus statements',
        url: (query) => `https://www.acvim.org/News/Consensus-Statements?search=${query}`,
        focus: 'Board-certified specialist consensus statements for internal medicine, cardiology, oncology, neurology, and large animal medicine',
        openAccess: true,
        speciesSpecific: () => true,
        relevance: () => 'high',
        priority: 40,
    },
    {
        sourceType: 'vetcompass',
        source: 'VetCompass',
        title: 'RVC VetCompass epidemiology publications',
        url: (query) => `https://www.rvc.ac.uk/vetcompass/publications?search=${query}`,
        focus: 'UK epidemiology, breed prevalence, risk factors, and outcome data from large primary-care datasets',
        openAccess: true,
        speciesSpecific: (context) => isCompanionAnimal(context),
        relevance: (context) => context.isUkEurope || isCompanionAnimal(context) ? 'high' : 'medium',
        priority: 50,
    },
    {
        sourceType: 'rvc',
        source: 'RVC Repository',
        title: 'Royal Veterinary College repository',
        url: (query) => `https://repository.rvc.ac.uk/search?query=${query}`,
        focus: 'RVC dissertations, clinical studies, case series, theses, and institutional research outputs',
        openAccess: true,
        speciesSpecific: () => true,
        relevance: (context) => context.isUkEurope ? 'high' : 'medium',
        priority: 51,
    },
    {
        sourceType: 'bsava',
        source: 'BSAVA',
        title: 'BSAVA clinical resources',
        url: (query) => `https://www.bsava.com/Resources/search?q=${query}`,
        focus: 'UK clinical manuals, formulary resources, congress proceedings, and small animal clinical guidance',
        openAccess: false,
        speciesSpecific: (context) => isCompanionAnimal(context),
        relevance: (context) => context.isUkEurope || isCompanionAnimal(context) ? 'high' : 'medium',
        priority: 52,
    },
    {
        sourceType: 'woah',
        source: 'WOAH',
        title: 'WOAH disease and diagnostic standards',
        url: (query) => `https://www.woah.org/en/search/?q=${query}`,
        focus: 'Notifiable disease status, international movement rules, terrestrial and aquatic diagnostic manual chapters',
        openAccess: true,
        speciesSpecific: () => true,
        relevance: (context) => context.isFoodAnimal || context.isAmr ? 'high' : 'medium',
        priority: 60,
    },
    {
        sourceType: 'cfsph',
        source: 'CFSPH',
        title: 'CFSPH zoonotic disease and biosecurity resources',
        url: (query) => `https://www.cfsph.iastate.edu/search/?q=${query}`,
        focus: 'Zoonotic disease fact sheets, biosecurity protocols, foreign animal disease resources, and client handouts',
        openAccess: true,
        speciesSpecific: () => true,
        relevance: (context) => context.isFoodAnimal || context.isAmr ? 'high' : 'medium',
        priority: 61,
    },
    {
        sourceType: 'fao',
        source: 'FAO EMPRES',
        title: 'FAO EMPRES disease surveillance',
        url: (query) => `https://www.fao.org/empres-i/en/search?q=${query}`,
        focus: 'Livestock disease surveillance, food animal outbreaks, transboundary animal disease intelligence, and production impact',
        openAccess: true,
        speciesSpecific: (context) => context.isFoodAnimal,
        relevance: (context) => context.isFoodAnimal ? 'high' : 'medium',
        priority: 62,
    },
    {
        sourceType: 'farad',
        source: 'FARAD VetGRAM',
        title: 'FARAD VetGRAM residue avoidance search',
        url: (query) => `https://vetgram.farad.org/Search.asp?search=${query}`,
        focus: 'Food animal drug approvals, indications, restrictions, and residue avoidance or withdrawal-time decision support',
        openAccess: true,
        speciesSpecific: (context) => context.isFoodAnimal,
        relevance: (context) => context.isFoodAnimal ? 'high' : 'low',
        priority: 63,
    },
    {
        sourceType: 'vetevidence',
        source: 'Veterinary Evidence',
        title: 'Veterinary Evidence journal search',
        url: (query) => `https://veterinaryevidence.org/?s=${query}`,
        focus: 'Evidence-based veterinary medicine, critically appraised topics, systematic questions, and open-access reviews',
        openAccess: true,
        speciesSpecific: () => true,
        relevance: () => 'medium',
        priority: 70,
    },
    {
        sourceType: 'researchgate',
        source: 'ResearchGate',
        title: 'ResearchGate veterinary medicine search',
        url: (query) => `https://www.researchgate.net/search?q=${query}+veterinary`,
        focus: 'Preprints, author profiles, full-text requests, conference material, and emerging research outside PubMed',
        openAccess: false,
        speciesSpecific: () => false,
        relevance: () => 'medium',
        priority: 80,
    },
    {
        sourceType: 'vin',
        source: 'VIN',
        title: 'VIN public veterinary resources',
        url: (query) => `https://www.vin.com/search/?q=${query}`,
        focus: 'Public clinical case discussions, drug formulary references, specialist consultations, and exotic or zoo medicine leads',
        openAccess: false,
        speciesSpecific: (context) => context.isExoticZoo,
        relevance: (context) => context.isExoticZoo ? 'high' : 'medium',
        priority: 90,
    },
];

function buildTier2Source(source: Tier2SourceDefinition, context: ResearchContext): ResearchSource {
    const encodedQuery = encodeResearchQuery(context.researchQuery);
    return {
        title: `${source.title}: ${context.disease}`,
        url: source.url(encodedQuery),
        snippet: sourceSnippet(source, context),
        source: source.source,
        sourceType: source.sourceType,
        tier: 2,
        relevance: source.relevance(context),
        open_access: source.openAccess,
        species_specific: source.speciesSpecific(context),
    };
}

function buildPubMedSearchSource(context: ResearchContext): ResearchSource {
    const query = encodeResearchQuery(compactSearchTerms([context.species === 'unknown' ? undefined : context.species, context.disease, 'veterinary']));
    return {
        title: `PubMed search: ${context.disease}`,
        url: `https://pubmed.ncbi.nlm.nih.gov/?term=${query}`,
        snippet: `Peer-reviewed veterinary literature search for ${context.species === 'unknown' ? 'veterinary' : context.species} ${context.disease}, sorted by PubMed relevance when available.`,
        source: 'PubMed',
        sourceType: 'pubmed',
        tier: 1,
        relevance: 'high',
        open_access: true,
        species_specific: context.species !== 'unknown',
    };
}

function buildMandatoryTier2Types(context: ResearchContext) {
    const required = new Set<ResearchSourceType>(['merck']);

    if (context.species === 'feline') {
        required.add('abcd');
        required.add('wsava');
    }

    if (context.species === 'canine') {
        required.add('wsava');
        required.add('aaha');
    }

    if (context.isFoodAnimal) {
        required.add('woah');
        required.add('cfsph');
        required.add('fao');
        required.add('farad');
    }

    if (context.isDiagnostic) {
        required.add('idexx');
        required.add('antech');
    }

    if (context.isUkEurope) {
        required.add('bsava');
        required.add('vetcompass');
    }

    if (context.isExoticZoo) {
        required.add('vin');
    }

    if (context.isAmr) {
        required.add('woah');
        required.add('cfsph');
    }

    return required;
}

function mergeResearchSources(sources: ResearchSource[]) {
    const seen = new Set<string>();
    const merged: ResearchSource[] = [];

    for (const source of sources) {
        const key = `${source.sourceType}:${source.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(source);
    }

    return merged;
}

async function searchWikipediaSources(context: ResearchContext): Promise<ResearchSource[]> {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', compactSearchTerms([context.disease, 'veterinary', speciesSearchTerm(context.species)]));
    url.searchParams.set('srlimit', '3');

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];

    const data = (await response.json()) as {
        query?: {
            search?: Array<{ title?: string; snippet?: string }>;
        };
    };

    return (data.query?.search ?? [])
        .filter((item) => item.title)
        .map((item) => ({
            title: item.title ?? 'Wikipedia result',
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent((item.title ?? '').replace(/\s+/g, '_'))}`,
            snippet: stripHtml(item.snippet ?? '') || `General encyclopedia context for ${context.disease} with veterinary and species terms applied to the search.`,
            source: 'Wikipedia',
            sourceType: 'wikipedia',
            tier: 1,
            relevance: 'medium',
            open_access: true,
            species_specific: context.species !== 'unknown',
        }));
}

async function searchPubMedSources(context: ResearchContext): Promise<ResearchSource[]> {
    const searchUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
    searchUrl.searchParams.set('db', 'pubmed');
    searchUrl.searchParams.set('term', compactSearchTerms([speciesSearchTerm(context.species), context.disease, 'veterinary']));
    searchUrl.searchParams.set('retmode', 'json');
    searchUrl.searchParams.set('retmax', '4');
    searchUrl.searchParams.set('sort', 'relevance');
    searchUrl.searchParams.set('tool', 'VetIOS');
    if (process.env.NCBI_TOOL_EMAIL) {
        searchUrl.searchParams.set('email', process.env.NCBI_TOOL_EMAIL);
    }

    const searchResponse = await fetch(searchUrl.toString(), { cache: 'no-store' });
    if (!searchResponse.ok) return [];

    const searchData = (await searchResponse.json()) as {
        esearchresult?: { idlist?: string[] };
    };
    const ids = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const summaryUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
    summaryUrl.searchParams.set('db', 'pubmed');
    summaryUrl.searchParams.set('id', ids.join(','));
    summaryUrl.searchParams.set('retmode', 'json');
    summaryUrl.searchParams.set('tool', 'VetIOS');
    if (process.env.NCBI_TOOL_EMAIL) {
        summaryUrl.searchParams.set('email', process.env.NCBI_TOOL_EMAIL);
    }

    const summaryResponse = await fetch(summaryUrl.toString(), { cache: 'no-store' });
    if (!summaryResponse.ok) return [];

    const summaryData = (await summaryResponse.json()) as {
        result?: Record<string, { title?: string; source?: string; pubdate?: string } | string[]>;
    };

    return ids
        .map((id): ResearchSource | null => {
            const result = summaryData.result?.[id];
            if (!result || Array.isArray(result)) return null;
            return {
                title: result.title ?? `PubMed ${id}`,
                url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
                snippet: compactSearchTerms([result.source, result.pubdate]) || `Peer-reviewed PubMed result for ${context.researchQuery}.`,
                source: 'PubMed',
                sourceType: 'pubmed',
                tier: 1,
                relevance: 'high',
                open_access: true,
                species_specific: context.species !== 'unknown',
            };
        })
        .filter((item): item is ResearchSource => item !== null);
}

async function resolveResearchSources(disease: string, species: DetectedVetiosSpecies, queryText?: string) {
    const context = buildResearchContext(disease, species, queryText);
    const [wikipedia, pubmed] = await Promise.all([
        searchWikipediaSources(context).catch((error) => {
            console.error('Wikipedia source search failed:', error);
            return [];
        }),
        searchPubMedSources(context).catch((error) => {
            console.error('PubMed source search failed:', error);
            return [];
        }),
    ]);

    const pubmedSources = pubmed.length > 0 ? pubmed : [buildPubMedSearchSource(context)];
    const tier2Sources = TIER_2_SOURCES.map((source) => buildTier2Source(source, context));
    const tier2ByType = new Map(tier2Sources.map((source) => [source.sourceType, source]));
    const mandatoryTypes = buildMandatoryTier2Types(context);
    const mandatoryTier2 = Array.from(mandatoryTypes)
        .map((type) => tier2ByType.get(type))
        .filter((source): source is ResearchSource => Boolean(source));

    const remainingTier2 = tier2Sources
        .filter((source) => !mandatoryTypes.has(source.sourceType))
        .sort((a, b) => {
            const relevanceRank = { high: 0, medium: 1, low: 2 };
            return relevanceRank[a.relevance] - relevanceRank[b.relevance];
        });

    return mergeResearchSources([
        ...pubmedSources,
        ...mandatoryTier2,
        ...wikipedia,
        ...remainingTier2,
    ]).slice(0, 15);
}

export async function POST(req: Request) {
    try {
        const parsed = RequestSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
        }

        const { topic, messageContent, queryText } = parsed.data;
        const species = detectSpeciesFromTexts([queryText, topic, messageContent]);
        const disease = detectDisease(topic, messageContent, queryText);

        let findings = buildLocalFindings(disease, species);

        try {
            const claudeFindings = await fetchClaudeFindings(disease, species, messageContent, queryText);
            if (claudeFindings?.length) {
                findings = claudeFindings;
            }
        } catch {
            // Fall back silently to deterministic findings.
        }

        const imagesByFinding: Record<string, ReferenceImage[]> = {};
        await Promise.all(
            findings.map(async (finding) => {
                imagesByFinding[finding.id] = await searchConfiguredImages(finding);
            }),
        );
        const researchSources = await resolveResearchSources(disease, species, queryText);

        return NextResponse.json({
            disease,
            species,
            findings,
            imagesByFinding,
            imageProvider: resolveImageProvider(),
            researchSources,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Clinical image enrichment failed' },
            { status: 500 },
        );
    }
}
