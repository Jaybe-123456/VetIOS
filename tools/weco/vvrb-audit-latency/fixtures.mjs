const DOMAINS = [
    'canine infectious',
    'feline renal',
    'equine gastrointestinal',
    'bovine respiratory',
    'avian parasitology',
    'one health amr',
];

const DIAGNOSES = [
    'Canine parvoviral enteritis',
    'Chronic kidney disease',
    'Large colon volvulus',
    'Bovine respiratory disease complex',
    'Avian coccidiosis',
    'Methicillin-resistant staphylococcal infection',
    'Leptospirosis',
    'Babesiosis',
    'Salmonellosis',
    'Dermatophytosis',
    'Immune-mediated haemolytic anaemia',
    'Toxoplasmosis',
];

const DRUGS = ['none', 'amoxicillin', 'doxycycline', 'enrofloxacin', 'ceftiofur', 'culture_directed'];
const PATHOGENS = ['none', 'E. coli', 'S. aureus', 'Salmonella', 'Pasteurella', 'Ehrlichia'];

export function buildSyntheticFixture(count, seed) {
    const random = createPrng(seed);
    const records = [];
    for (let index = 0; index < count; index += 1) {
        const domain = DOMAINS[index % DOMAINS.length];
        const diagnosis = DIAGNOSES[(index * 7 + Math.floor(random() * DIAGNOSES.length)) % DIAGNOSES.length];
        const topDiagnosis = index % 11 === 0
            ? DIAGNOSES[(DIAGNOSES.indexOf(diagnosis) + 1) % DIAGNOSES.length]
            : diagnosis;
        const confidence = clamp(0.45 + random() * 0.52);
        const cire = clamp(confidence * 0.78 + random() * 0.2);
        const pathogen = PATHOGENS[(index + Math.floor(random() * PATHOGENS.length)) % PATHOGENS.length];
        const drug = DRUGS[(index * 3 + Math.floor(random() * DRUGS.length)) % DRUGS.length];

        records.push({
            benchmark_id: `VVRB-PILOT-${seed}-${index}`,
            synthetic: index % 997 !== 0,
            benchmark_version: 'VVRB latency pilot v1',
            case_domain: domain,
            confirmed_diagnosis: diagnosis,
            differential_diagnoses: [topDiagnosis, diagnosis, DIAGNOSES[(index + 3) % DIAGNOSES.length]],
            evaluation_targets: {
                top1_differential: topDiagnosis,
            },
            reasoning_chain_public: index % 17 === 0
                ? 'A repeated opener because the evidence converges.'
                : `${domain} pathway ${index % 61} because the generated signals converge.`,
            history: index % 29 === 0
                ? 'Repeated generated history'
                : `Synthetic history pattern ${index % 211}`,
            labs: {
                cbc: {
                    wbc_bucket: index % 9,
                    platelet_bucket: (index * 5) % 13,
                },
                culture: {
                    pathogen,
                    colony_bucket: index % 23,
                },
            },
            antimicrobial_decision: {
                drug,
                pathogen,
                stewardship_risk: ['low', 'medium', 'high'][index % 3],
                culture_required: index % 4 !== 0,
            },
            confidence_score: confidence,
            cire_phi_hat: cire,
            evidence_sources: index % 7 === 0
                ? ['Standard veterinary clinical reasoning patterns']
                : [`Synthetic source reference ${index % 97}`, `Public guideline ${index % 31}`],
        });
    }
    return records;
}

export function buildEdgeFixture() {
    return [
        {},
        {
            synthetic: false,
            case_domain: ' ',
            confirmed_diagnosis: null,
            evaluation_targets: {},
            differential_diagnoses: [],
            reasoning_chain_public: '',
            history: null,
            labs: null,
            antimicrobial_decision: null,
            confidence_score: Number.NaN,
            cire_phi_hat: Number.POSITIVE_INFINITY,
            evidence_sources: [],
        },
        {
            synthetic: true,
            case_domain: 'one health',
            confirmed_diagnosis: '  Rabies  ',
            evaluation_targets: { top1_differential: 'rabies' },
            reasoning_chain_public: 'Rabies is prioritized BECAUSE exposure is confirmed.',
            history: '  Exposure   history ',
            labs: { nested: { z: 1, a: [3, null, { b: 2, a: 1 }] } },
            antimicrobial_decision: { reason: undefined, needed: false },
            confidence_score: -1,
            cire_phi_hat: 3,
            evidence_sources: ['general veterinary knowledge'],
        },
        {
            synthetic: true,
            case_domain: 'canine infectious',
            confirmed_diagnosis: 'Canine parvoviral enteritis',
            evaluation_targets: { top1_differential: '   ' },
            differential_diagnoses: ['canine parvoviral enteritis'],
            confidence_score: 0.5,
            cire_phi_hat: 0.5,
            evidence_sources: ['synthetic benchmark'],
        },
        {
            synthetic: true,
            confidence_score: 0.5,
            cire_phi_hat: 0.5,
        },
        {
            synthetic: true,
            confidence_score: 0.5,
            cire_phi_hat: 0.5,
        },
        {
            synthetic: true,
            confirmed_diagnosis: 'R',
            evaluation_targets: { top1_differential: '' },
            differential_diagnoses: 'rabies',
        },
    ];
}

function createPrng(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };
}

function clamp(value) {
    return Math.max(0, Math.min(1, value));
}
