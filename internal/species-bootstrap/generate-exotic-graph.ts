type Species = 'avian' | 'reptile' | 'rabbit' | 'ferret' | 'bovine' | 'ovine' | 'caprine' | 'porcine' | 'equine';

const speciesList: Species[] = ['avian', 'reptile', 'rabbit', 'ferret', 'bovine', 'ovine', 'caprine', 'porcine', 'equine'];
const conditionCodes = [
    'gi_inflammation',
    'respiratory_infection',
    'metabolic_derangement',
    'toxic_exposure',
    'traumatic_injury',
    'parasitic_disease',
];

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VETIOS_APP_URL ?? 'http://localhost:3000';
const apiToken = process.env.VETIOS_INTERNAL_API_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetCasesPerSpecies = Number(process.env.VETIOS_SPECIES_BOOTSTRAP_CASES_PER_SPECIES ?? 500);

async function main() {
    if (!apiToken) throw new Error('VETIOS_INTERNAL_API_TOKEN is required.');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

    for (const species of speciesList) {
        let generated = 0;
        while (generated < targetCasesPerSpecies) {
            for (const conditionCode of conditionCodes) {
                if (generated >= targetCasesPerSpecies) break;
                const simulated = await simulateCase(species, conditionCode);
                await insertKnowledgeGraphRow(buildKnowledgeGraphRow(species, conditionCode, simulated));
                generated += 1;
            }
        }
        console.log(`bootstrapped ${generated} simulated ${species} knowledge graph rows`);
    }
}

async function simulateCase(species: Species, conditionCode: string) {
    const response = await fetch(`${appUrl}/api/simulate`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            steps: 5,
            base_case: {
                species,
                condition_code: conditionCode,
                symptoms: ['lethargy'],
            },
            simulation: {
                type: 'species_knowledge_graph_bootstrap',
                parameters: {
                    species,
                    condition_code: conditionCode,
                },
            },
        }),
    });
    if (!response.ok) {
        throw new Error(`simulate failed for ${species}/${conditionCode}: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<Record<string, unknown>>;
}

function buildKnowledgeGraphRow(species: Species, conditionCode: string, simulated: Record<string, unknown>) {
    const output = asRecord(simulated.output ?? simulated.data ?? simulated.prediction);
    const symptoms = Array.isArray(output.symptom_codes) ? output.symptom_codes : ['lethargy'];
    return {
        species,
        condition_code: conditionCode,
        condition_name: titleize(conditionCode),
        symptom_codes: symptoms,
        typical_vitals_range: asRecord(output.typical_vitals_range),
        pharmacological_contraindications: asRecord(output.pharmacological_contraindications),
        prevalence_weight: Number(output.prevalence_weight ?? 0.2),
        source: 'simulated',
    };
}

async function insertKnowledgeGraphRow(row: Record<string, unknown>) {
    const response = await fetch(`${supabaseUrl}/rest/v1/species_knowledge_graph`, {
        method: 'POST',
        headers: {
            apikey: serviceRoleKey!,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
            prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
    });
    if (!response.ok) {
        throw new Error(`species_knowledge_graph insert failed: ${response.status} ${await response.text()}`);
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function titleize(value: string) {
    return value.split('_').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
