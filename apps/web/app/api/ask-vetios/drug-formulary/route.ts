import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
    topic: z.string().trim().optional(),
    messageContent: z.string().trim().min(1).max(12000),
});

const SpeciesSchema = z.enum(['canine', 'feline', 'equine', 'bovine', 'avian', 'porcine', 'ovine']);

type Species = z.infer<typeof SpeciesSchema>;

interface DrugDose {
    species: Species;
    doseMgPerKgMin: number | null;
    doseMgPerKgMax: number | null;
    route: string;
    frequency: string;
    notes: string;
    withdrawalPeriod: string | null;
    contraindications: string[];
}

interface DrugEntry {
    name: string;
    drugClass: string;
    indication: string;
    speciesDoses: DrugDose[];
    interactions: string[];
    globalContraindications: string[];
}

function detectSpecies(content: string): Species {
    const lower = content.toLowerCase();
    if (/\bfeline|cat|kitten\b/.test(lower)) return 'feline';
    if (/\bequine|horse|foal\b/.test(lower)) return 'equine';
    if (/\bbovine|cow|cattle|calf\b/.test(lower)) return 'bovine';
    if (/\bavian|bird|chicken|parrot|psittacine\b/.test(lower)) return 'avian';
    if (/\bporcine|pig|swine|piglet\b/.test(lower)) return 'porcine';
    if (/\bovine|sheep|lamb\b/.test(lower)) return 'ovine';
    return 'canine';
}

function stripCodeFences(value: string) {
    return value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function buildFallbackPayload(species: Species) {
    return {
        species,
        summary: 'No structured formulary output was available from Claude.',
        drugs: [] as DrugEntry[],
    };
}

async function fetchClaudeFormulary(topic: string | undefined, messageContent: string, species: Species) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
    if (!apiKey) return null;

    const prompt = [
        'You are VetIOS veterinary formulary support.',
        'Return only valid JSON with this exact shape:',
        '{"species":"canine|feline|equine|bovine|avian|porcine|ovine","summary":"string","drugs":[{"name":"string","drugClass":"string","indication":"string","speciesDoses":[{"species":"canine|feline|equine|bovine|avian|porcine|ovine","doseMgPerKgMin":0,"doseMgPerKgMax":0,"route":"string","frequency":"string","notes":"string","withdrawalPeriod":"string|null","contraindications":["string"]}],"interactions":["string"],"globalContraindications":["string"]}]}',
        `Topic: ${topic ?? 'Current clinical response'}`,
        `Detected species: ${species}`,
        `Response content: ${messageContent.slice(0, 7000)}`,
        'Extract only drugs actually mentioned or clearly implied in the response.',
        'Use null when a dose range is not appropriate or not provided.',
        'For food animals, include withdrawal periods when known or caution text when not.',
        'Keep interactions clinically concise.',
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
            max_tokens: 1800,
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

    const parsed = JSON.parse(stripCodeFences(text)) as {
        species?: string;
        summary?: string;
        drugs?: DrugEntry[];
    };

    return parsed;
}

function normalizeDrugEntry(entry: DrugEntry): DrugEntry {
    return {
        name: entry.name,
        drugClass: entry.drugClass,
        indication: entry.indication,
        speciesDoses: Array.isArray(entry.speciesDoses)
            ? entry.speciesDoses
                .filter((dose): dose is DrugDose => SpeciesSchema.safeParse(dose.species).success)
                .map((dose) => ({
                    species: dose.species,
                    doseMgPerKgMin: typeof dose.doseMgPerKgMin === 'number' ? dose.doseMgPerKgMin : null,
                    doseMgPerKgMax: typeof dose.doseMgPerKgMax === 'number' ? dose.doseMgPerKgMax : null,
                    route: dose.route || 'n/a',
                    frequency: dose.frequency || 'n/a',
                    notes: dose.notes || '',
                    withdrawalPeriod: dose.withdrawalPeriod ?? null,
                    contraindications: Array.isArray(dose.contraindications) ? dose.contraindications : [],
                }))
            : [],
        interactions: Array.isArray(entry.interactions) ? entry.interactions : [],
        globalContraindications: Array.isArray(entry.globalContraindications) ? entry.globalContraindications : [],
    };
}

export async function POST(req: Request) {
    try {
        const parsed = RequestSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
        }

        const { topic, messageContent } = parsed.data;
        const species = detectSpecies(messageContent);
        const fallback = buildFallbackPayload(species);

        try {
            const claudePayload = await fetchClaudeFormulary(topic, messageContent, species);
            if (!claudePayload) return NextResponse.json(fallback);

            const normalizedSpecies = SpeciesSchema.safeParse(claudePayload.species).success
                ? (claudePayload.species as Species)
                : species;
            const normalizedDrugs = Array.isArray(claudePayload.drugs)
                ? claudePayload.drugs.map(normalizeDrugEntry)
                : [];

            return NextResponse.json({
                species: normalizedSpecies,
                summary: claudePayload.summary || fallback.summary,
                drugs: normalizedDrugs,
            });
        } catch {
            return NextResponse.json(fallback);
        }
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Drug formulary enrichment failed' },
            { status: 500 },
        );
    }
}
