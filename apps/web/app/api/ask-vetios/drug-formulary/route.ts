import { NextResponse } from 'next/server';
import { z } from 'zod';
import { compactSearchTerms, detectSpeciesFromTexts, isVetiosSpecies, type DetectedVetiosSpecies, type VetiosSpecies, VETIOS_SPECIES } from '@/lib/askVetios/context';
import { getDrugInteractionEngine } from '@/lib/drugInteraction/drugInteractionEngine';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
    topic: z.string().trim().optional(),
    messageContent: z.string().trim().min(1).max(12000),
    queryText: z.string().trim().max(4000).optional(),
});

type SourceType = 'DailyMed' | 'FDA' | 'FARAD/VetGRAM' | 'VetIOS interaction engine' | 'Claude extraction';

interface DrugSource {
    type: SourceType;
    label: string;
    url: string;
    evidence: string;
    verified: boolean;
}

interface DrugDose {
    species: VetiosSpecies;
    doseMgPerKgMin: number | null;
    doseMgPerKgMax: number | null;
    route: string;
    frequency: string;
    notes: string;
    withdrawalPeriod: string | null;
    contraindications: string[];
    sourceText: string;
    sourceBacked: boolean;
    sources: DrugSource[];
}

interface DrugEntry {
    name: string;
    drugClass: string;
    indication: string;
    speciesDoses: DrugDose[];
    interactions: string[];
    globalContraindications: string[];
    sources: DrugSource[];
}

interface DailyMedCandidate {
    setid: string;
    title: string;
}

interface LabelEvidence {
    title: string;
    setid: string;
    sourceText: string;
    warningText: string;
    withdrawalText: string | null;
    doseMin: number | null;
    doseMax: number | null;
    route: string;
    frequency: string;
    source: DrugSource;
}

const FOOD_ANIMALS = new Set<VetiosSpecies>(['bovine', 'porcine', 'ovine', 'avian']);

const DRUG_CATALOG: Array<{ name: string; drugClass: string; patterns: RegExp[] }> = [
    { name: 'Amoxicillin', drugClass: 'Antibiotic', patterns: [/\bamoxicillin\b/i] },
    { name: 'Ampicillin', drugClass: 'Antibiotic', patterns: [/\bampicillin\b/i] },
    { name: 'Ceftiofur', drugClass: 'Cephalosporin antibiotic', patterns: [/\bceftiofur\b/i, /\bnaxcel\b/i, /\bexcede\b/i] },
    { name: 'Cephapirin', drugClass: 'Cephalosporin antibiotic', patterns: [/\bcephapirin\b/i] },
    { name: 'Doxycycline', drugClass: 'Tetracycline antibiotic', patterns: [/\bdoxycycline\b/i] },
    { name: 'Enrofloxacin', drugClass: 'Fluoroquinolone antibiotic', patterns: [/\benrofloxacin\b/i, /\bbaytril\b/i] },
    { name: 'Fenbendazole', drugClass: 'Anthelmintic', patterns: [/\bfenbendazole\b/i, /\bpanacur\b/i] },
    { name: 'Flunixin', drugClass: 'NSAID', patterns: [/\bflunixin\b/i, /\bbanamine\b/i] },
    { name: 'Furosemide', drugClass: 'Loop diuretic', patterns: [/\bfurosemide\b/i, /\blasix\b/i] },
    { name: 'Gabapentin', drugClass: 'Analgesic', patterns: [/\bgabapentin\b/i] },
    { name: 'Maropitant', drugClass: 'Antiemetic', patterns: [/\bmaropitant\b/i, /\bcerenia\b/i] },
    { name: 'Meloxicam', drugClass: 'NSAID', patterns: [/\bmeloxicam\b/i, /\bmetacam\b/i] },
    { name: 'Metronidazole', drugClass: 'Antimicrobial/antiprotozoal', patterns: [/\bmetronidazole\b/i] },
    { name: 'Oxytetracycline', drugClass: 'Tetracycline antibiotic', patterns: [/\boxytetracycline\b/i] },
    { name: 'Penicillin G', drugClass: 'Beta-lactam antibiotic', patterns: [/\bpenicillin(?:\s+g)?\b/i] },
    { name: 'Pirlimycin', drugClass: 'Lincosamide antibiotic', patterns: [/\bpirlimycin\b/i] },
    { name: 'Prednisolone', drugClass: 'Glucocorticoid', patterns: [/\bprednisolone\b/i, /\bprednisone\b/i] },
];

const CONDITION_CANDIDATES: Array<{ patterns: RegExp[]; drugs: string[] }> = [
    { patterns: [/\bmastitis\b/i], drugs: ['Ceftiofur', 'Cephapirin', 'Pirlimycin', 'Oxytetracycline'] },
    { patterns: [/\bparvo|parvovirus|parvoviral\b/i], drugs: ['Maropitant', 'Ampicillin', 'Cefazolin', 'Metronidazole'] },
    { patterns: [/\bglanders\b/i], drugs: ['Doxycycline', 'Enrofloxacin'] },
    { patterns: [/\brespiratory|pneumonia|shipping fever\b/i], drugs: ['Ceftiofur', 'Oxytetracycline', 'Enrofloxacin'] },
    { patterns: [/\bdiarrh(?:ea|eic)|enteritis\b/i], drugs: ['Metronidazole', 'Maropitant', 'Ampicillin'] },
    { patterns: [/\bpain|lameness|arthritis|inflammation\b/i], drugs: ['Meloxicam', 'Flunixin', 'Gabapentin'] },
];

function stripCodeFences(value: string) {
    return value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function decodeXml(value: string) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function stripTags(value: string) {
    return decodeXml(value.replace(/<[^>]+>/g, ' '));
}

function normalizeDrugName(value: string) {
    return value.trim().replace(/\s+/g, ' ');
}

function getDrugClass(name: string) {
    const match = DRUG_CATALOG.find((drug) => drug.name.toLowerCase() === name.toLowerCase());
    return match?.drugClass ?? 'Veterinary drug';
}

function extractDrugMentions(text: string) {
    const detected = DRUG_CATALOG
        .filter((drug) => drug.patterns.some((pattern) => pattern.test(text)))
        .map((drug) => drug.name);

    return Array.from(new Set(detected));
}

function inferConditionCandidates(text: string) {
    const candidates = CONDITION_CANDIDATES
        .filter((entry) => entry.patterns.some((pattern) => pattern.test(text)))
        .flatMap((entry) => entry.drugs);

    return Array.from(new Set(candidates)).slice(0, 5);
}

async function fetchClaudeDrugCandidates(topic: string | undefined, messageContent: string, queryText: string | undefined, species: DetectedVetiosSpecies) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
    if (!apiKey) return [];

    const prompt = [
        'You are VetIOS veterinary medication extraction support.',
        'Return only valid JSON with this exact shape: {"drugs":["generic drug name"]}.',
        'Extract or infer only common medication candidates relevant to the current veterinary condition.',
        'Do not include doses. Doses will be resolved only from verified label/formulary sources.',
        `Species: ${species}`,
        `Topic: ${topic ?? 'Current case context'}`,
        `Current Ask VetIOS query: ${queryText ?? 'not supplied'}`,
        `Response content: ${messageContent.slice(0, 6000)}`,
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
            max_tokens: 600,
            temperature: 0.1,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((item) => item.type === 'text')?.text;
    if (!text) return [];

    const parsed = JSON.parse(stripCodeFences(text)) as { drugs?: unknown };
    if (!Array.isArray(parsed.drugs)) return [];

    return parsed.drugs
        .filter((drug): drug is string => typeof drug === 'string')
        .map(normalizeDrugName)
        .filter(Boolean)
        .slice(0, 5);
}

function collectDailyMedCandidates(value: unknown): DailyMedCandidate[] {
    const results: DailyMedCandidate[] = [];
    const seen = new Set<string>();

    const visit = (node: unknown) => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }

        if (!node || typeof node !== 'object') return;

        const record = node as Record<string, unknown>;
        const setid = typeof record.setid === 'string'
            ? record.setid
            : typeof record.setId === 'string'
                ? record.setId
                : null;
        if (setid && !seen.has(setid)) {
            seen.add(setid);
            results.push({
                setid,
                title: typeof record.title === 'string'
                    ? record.title
                    : typeof record.spl_version === 'string'
                        ? record.spl_version
                        : 'DailyMed animal label',
            });
        }

        Object.values(record).forEach(visit);
    };

    visit(value);
    return results;
}

async function searchDailyMedAnimalLabels(drugName: string) {
    const url = new URL(`https://dailymed.nlm.nih.gov/dailymed/services/v1/drugname/${encodeURIComponent(drugName)}/animal/spls.json`);
    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];

    return collectDailyMedCandidates(await response.json()).slice(0, 3);
}

function extractTitle(xml: string, fallback: string) {
    const match = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? stripTags(match[1]) : fallback;
}

function extractSection(fullText: string, headings: string[]) {
    const upper = fullText.toUpperCase();
    const headingIndex = headings
        .map((heading) => upper.indexOf(heading.toUpperCase()))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];

    if (headingIndex == null) return '';

    const nextMarkers = [
        'CONTRAINDICATIONS',
        'WARNINGS',
        'PRECAUTIONS',
        'ADVERSE REACTIONS',
        'HOW SUPPLIED',
        'STORAGE',
        'INDICATIONS',
        'DESCRIPTION',
        'RESIDUE WARNINGS',
    ];
    const nextIndex = nextMarkers
        .map((marker) => upper.indexOf(marker, headingIndex + 30))
        .filter((index) => index > headingIndex)
        .sort((a, b) => a - b)[0];

    return fullText.slice(headingIndex, nextIndex ?? headingIndex + 2200).trim();
}

function parseDoseRange(text: string) {
    const range = text.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)\s*mg\s*\/\s*kg/i);
    if (range?.[1] && range[2]) {
        return { min: Number(range[1]), max: Number(range[2]) };
    }

    const single = text.match(/(\d+(?:\.\d+)?)\s*mg\s*\/\s*kg/i);
    if (single?.[1]) {
        const value = Number(single[1]);
        return { min: value, max: value };
    }

    return { min: null, max: null };
}

function inferRoute(text: string) {
    if (/\bintramuscular|(?:\bIM\b)/i.test(text)) return 'IM';
    if (/\bintravenous|(?:\bIV\b)/i.test(text)) return 'IV';
    if (/\bsubcutaneous|(?:\bSC\b)|(?:\bSQ\b)/i.test(text)) return 'SC';
    if (/\bintramammary/i.test(text)) return 'IMM';
    if (/\boral|(?:\bPO\b)|by mouth/i.test(text)) return 'PO';
    return 'See label';
}

function inferFrequency(text: string) {
    const compact = text.replace(/\s+/g, ' ');
    const match = compact.match(/\b(?:q|every)\s*(\d{1,2})\s*(?:h|hr|hours?)\b/i);
    if (match?.[1]) return `q${match[1]}h`;
    if (/\bonce daily|every 24 hours|q24h/i.test(compact)) return 'q24h';
    if (/\btwice daily|every 12 hours|q12h/i.test(compact)) return 'q12h';
    return 'See label';
}

function extractWithdrawalText(fullText: string) {
    const withdrawal = extractSection(fullText, ['RESIDUE WARNINGS', 'WITHDRAWAL', 'WITHHOLDING']);
    if (withdrawal) return withdrawal.slice(0, 900);

    const match = fullText.match(/.{0,180}\bwithdraw(?:al|n)?\b.{0,500}/i);
    return match?.[0]?.trim() ?? null;
}

async function fetchDailyMedEvidence(drugName: string, species: VetiosSpecies): Promise<LabelEvidence | null> {
    const candidates = await searchDailyMedAnimalLabels(drugName);

    for (const candidate of candidates) {
        const xmlUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${encodeURIComponent(candidate.setid)}.xml`;
        const response = await fetch(xmlUrl, { cache: 'no-store' });
        if (!response.ok) continue;

        const xml = await response.text();
        const fullText = stripTags(xml);
        const labelTitle = extractTitle(xml, candidate.title);
        const speciesMentioned = species === 'avian'
            ? /\bavian|bird|chicken|turkey|poultry\b/i.test(fullText)
            : new RegExp(`\\b${species}\\b`, 'i').test(fullText)
                || (species === 'bovine' && /\bcattle|cow|calf|calves\b/i.test(fullText))
                || (species === 'porcine' && /\bswine|pig\b/i.test(fullText))
                || (species === 'equine' && /\bhorse|equine\b/i.test(fullText))
                || (species === 'feline' && /\bcat|feline\b/i.test(fullText))
                || (species === 'canine' && /\bdog|canine\b/i.test(fullText))
                || (species === 'ovine' && /\bsheep|ovine\b/i.test(fullText));

        if (!speciesMentioned && candidates.length > 1) continue;

        const doseSection = extractSection(fullText, ['DOSAGE AND ADMINISTRATION', 'DOSAGE', 'DIRECTIONS FOR USE']);
        const warningSection = extractSection(fullText, ['CONTRAINDICATIONS', 'WARNINGS', 'PRECAUTIONS']);
        const parsedDose = parseDoseRange(doseSection);
        const sourceUrl = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(candidate.setid)}`;

        return {
            title: labelTitle,
            setid: candidate.setid,
            sourceText: doseSection.slice(0, 1200),
            warningText: warningSection.slice(0, 900),
            withdrawalText: extractWithdrawalText(fullText),
            doseMin: parsedDose.min,
            doseMax: parsedDose.max,
            route: inferRoute(doseSection),
            frequency: inferFrequency(doseSection),
            source: {
                type: 'DailyMed',
                label: labelTitle,
                url: sourceUrl,
                evidence: 'DailyMed animal SPL label',
                verified: true,
            },
        };
    }

    return null;
}

function buildFdaSource(drugName: string): DrugSource {
    return {
        type: 'FDA',
        label: 'Animal Drugs @ FDA',
        url: 'https://www.fda.gov/animal-veterinary/approved-animal-drug-products-green-book/animal-drugs-fda-explained',
        evidence: `Use Animal Drugs @ FDA / Green Book to verify legal marketing status for ${drugName}.`,
        verified: true,
    };
}

function buildFaradSource(drugName: string): DrugSource {
    return {
        type: 'FARAD/VetGRAM',
        label: 'FARAD VetGRAM',
        url: 'https://vetgram.farad.org/',
        evidence: `Check labeled food-animal withdrawal restrictions for ${drugName}.`,
        verified: true,
    };
}

function buildUnavailableDose(drugName: string, species: VetiosSpecies, sourceHint: DrugSource[]): DrugDose {
    return {
        species,
        doseMgPerKgMin: null,
        doseMgPerKgMax: null,
        route: 'Source-backed dose unavailable',
        frequency: 'Source-backed dose unavailable',
        notes: 'No source-backed mg/kg dose was resolved from public animal-label sources for this species. Verify in a licensed formulary before prescribing.',
        withdrawalPeriod: FOOD_ANIMALS.has(species) ? 'Check FARAD/VetGRAM and product label before use in food animals.' : null,
        contraindications: ['Do not infer dose from Claude output. Verify species, indication, route, and label status.'],
        sourceText: `No public source-backed dosing section was resolved for ${drugName} in ${species}.`,
        sourceBacked: false,
        sources: sourceHint,
    };
}

function buildDoseFromEvidence(evidence: LabelEvidence, species: VetiosSpecies): DrugDose {
    const sources = [evidence.source];
    if (FOOD_ANIMALS.has(species)) sources.push(buildFaradSource(evidence.title));

    return {
        species,
        doseMgPerKgMin: evidence.doseMin,
        doseMgPerKgMax: evidence.doseMax,
        route: evidence.route,
        frequency: evidence.frequency,
        notes: evidence.sourceText || 'See linked animal label for full administration directions.',
        withdrawalPeriod: FOOD_ANIMALS.has(species)
            ? (evidence.withdrawalText ?? 'Withdrawal period not parsed. Check FARAD/VetGRAM and product label.')
            : null,
        contraindications: evidence.warningText ? [evidence.warningText] : [],
        sourceText: evidence.sourceText,
        sourceBacked: evidence.doseMin != null || Boolean(evidence.sourceText),
        sources,
    };
}

function resolveInteractionWarnings(drugNames: string[], species: DetectedVetiosSpecies) {
    if (drugNames.length < 2 || !isVetiosSpecies(species)) return [];

    try {
        const result = getDrugInteractionEngine().check({
            drugs: drugNames,
            species,
            conditions: [],
        });

        return result.interactions.map((interaction) => {
            const refs = interaction.references.length > 0 ? ` Sources: ${interaction.references.join('; ')}` : '';
            return `${interaction.drug1} + ${interaction.drug2} (${interaction.severity}): ${interaction.clinicalEffect} ${interaction.managementRecommendation}${refs}`;
        });
    } catch {
        return [];
    }
}

async function buildDrugEntry(drugName: string, species: DetectedVetiosSpecies, topic: string | undefined): Promise<DrugEntry> {
    const sourceHints = [buildFdaSource(drugName)];
    if (species !== 'unknown' && FOOD_ANIMALS.has(species)) {
        sourceHints.push(buildFaradSource(drugName));
    }

    const evidence = species !== 'unknown'
        ? await fetchDailyMedEvidence(drugName, species)
        : null;
    const speciesDoses = species !== 'unknown'
        ? [evidence ? buildDoseFromEvidence(evidence, species) : buildUnavailableDose(drugName, species, sourceHints)]
        : VETIOS_SPECIES.map((item) => buildUnavailableDose(drugName, item, sourceHints));
    const sources = Array.from(
        new Map(speciesDoses.flatMap((dose) => dose.sources).map((source) => [source.url + source.type, source])).values(),
    );

    return {
        name: drugName,
        drugClass: getDrugClass(drugName),
        indication: topic?.trim() || 'Current Ask VetIOS context',
        speciesDoses,
        interactions: [],
        globalContraindications: speciesDoses.flatMap((dose) => dose.contraindications).slice(0, 3),
        sources,
    };
}

export async function POST(req: Request) {
    try {
        const parsed = RequestSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
        }

        const { topic, messageContent, queryText } = parsed.data;
        const combinedText = compactSearchTerms([queryText, topic, messageContent]);
        const species = detectSpeciesFromTexts([queryText, topic, messageContent]);
        const explicitMentions = extractDrugMentions(combinedText);
        const deterministicCandidates = explicitMentions.length > 0 ? [] : inferConditionCandidates(combinedText);
        const claudeCandidates = explicitMentions.length > 0 || deterministicCandidates.length > 0
            ? []
            : await fetchClaudeDrugCandidates(topic, messageContent, queryText, species).catch(() => []);
        const drugNames = Array.from(new Set([...explicitMentions, ...deterministicCandidates, ...claudeCandidates]))
            .map(normalizeDrugName)
            .filter(Boolean)
            .slice(0, 5);
        const drugs = await Promise.all(drugNames.map((drug) => buildDrugEntry(drug, species, topic)));
        const interactionWarnings = resolveInteractionWarnings(drugNames, species);
        const drugsWithInteractions = drugs.map((drug) => ({
            ...drug,
            interactions: interactionWarnings.filter((warning) => warning.toLowerCase().includes(drug.name.toLowerCase().split(' ')[0] ?? drug.name.toLowerCase())),
        }));
        const sourceBackedCount = drugsWithInteractions.filter((drug) => drug.speciesDoses.some((dose) => dose.sourceBacked)).length;
        const summary = drugNames.length === 0
            ? 'No medication candidates were detected for this response. Ask VetIOS for treatment options or name a drug to run source-backed lookup.'
            : sourceBackedCount > 0
                ? `Resolved ${sourceBackedCount}/${drugNames.length} medication candidates with public source-backed label evidence. Verify before prescribing.`
                : `Medication candidates were found, but no public source-backed mg/kg dose was resolved for ${species === 'unknown' ? 'the current species context' : species}. Verified lookup links are provided.`;

        return NextResponse.json({
            species,
            summary,
            drugs: drugsWithInteractions,
            candidateSource: explicitMentions.length > 0 ? 'explicit_response' : deterministicCandidates.length > 0 ? 'condition_rules' : 'claude_extraction',
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Drug formulary enrichment failed' },
            { status: 500 },
        );
    }
}
