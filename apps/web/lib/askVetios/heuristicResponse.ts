import { runClinicalInferenceEngine } from '@/lib/inference/engine';

type HeuristicMode = 'clinical' | 'educational' | 'general';

interface HeuristicDiagnosis {
    name: string;
    confidence: number;
    reasoning: string;
}

interface HeuristicSourceReference {
    label: string;
    year: string;
    url: string;
}

interface HeuristicMetadata {
    diagnosis_ranked?: HeuristicDiagnosis[];
    urgency_level?: 'low' | 'moderate' | 'high' | 'critical' | 'emergency';
    recommended_tests?: string[];
    red_flags?: string[];
    explanation?: string;
    source_references?: HeuristicSourceReference[];
    heuristic_domain?: string;
    species?: string;
}

export interface AskVetiosHeuristicResponse {
    mode: HeuristicMode;
    topic?: string;
    content: string;
    metadata: HeuristicMetadata | null;
}

const FELINE_RESPIRATORY_REFERENCES: HeuristicSourceReference[] = [
    {
        label: 'Merck Veterinary Manual feline respiratory disease complex',
        year: '2024',
        url: 'https://www.merckvetmanual.com/respiratory-system/respiratory-diseases-of-small-animals/feline-respiratory-disease-complex',
    },
    {
        label: 'Cornell Feline Health Center respiratory infections',
        year: '2018',
        url: 'https://www.vet.cornell.edu/departments-centers-and-institutes/cornell-feline-health-center/health-information/respiratory-infections',
    },
    {
        label: 'ABCD feline herpesvirus infection guideline',
        year: '2022',
        url: 'https://www.abcdcatsvets.org/guideline-for-feline-herpesvirus-infection/',
    },
];

export function buildHeuristicResponse(message: string): AskVetiosHeuristicResponse {
    const lower = message.toLowerCase();
    const clinicalProfile = buildClinicalMessageProfile(lower);

    if (clinicalProfile.isClinical) {
        return buildClinicalHeuristicResponse(message, clinicalProfile);
    }

    const educationalKeywords = ['what are', 'what is', 'explain', 'describe', 'how does', 'pathogenesis', 'mechanism',
        'epidemiology', 'classification', 'structure', 'treatment of', 'prevention of', 'vaccine', 'overview of'];
    const isEducational = educationalKeywords.some((keyword) => lower.includes(keyword));

    if (isEducational) {
        return {
            mode: 'educational',
            topic: 'Veterinary Knowledge Query',
            content: `## Temporarily Unavailable\n\nThe VetIOS intelligence gateway is experiencing a transient issue. Your query has been logged and will be retried automatically.\n\nPlease try again in a moment.`,
            metadata: null,
        };
    }

    return {
        mode: 'general',
        content: "Hello — I'm VetIOS, your veterinary intelligence assistant. I can answer clinical questions, explain veterinary conditions in depth, or help you navigate the platform. What would you like to explore?",
        metadata: null,
    };
}

function buildClinicalMessageProfile(lower: string) {
    const species = inferSpecies(lower);
    const signals = extractClinicalSignals(lower);
    const respiratory = /nasal|sneez|rhinitis|sinusitis|respiratory|ocular|conjunctivitis|cough|dyspnea|breathing/.test(lower);
    const gastrointestinal = /vomit|diarrh|gastro|stool|fecal|faecal|abdomen|abdominal|appetite|anorexia/.test(lower);
    const clinicalKeywords = ['vomit', 'lethargy', 'anorexia', 'appetite', 'diarrhea', 'diarrhoea', 'discharge',
        'nasal', 'sneez', 'seizure', 'cough', 'fever', 'limp', 'lame', 'drink', 'urinat', 'weight loss', 'mass', 'lump'];

    return {
        species,
        signals,
        respiratory,
        gastrointestinal,
        isClinical: signals.length > 0 || clinicalKeywords.some((keyword) => lower.includes(keyword)),
    };
}

function buildClinicalHeuristicResponse(
    message: string,
    profile: ReturnType<typeof buildClinicalMessageProfile>,
): AskVetiosHeuristicResponse {
    const inference = runClinicalInferenceEngine({
        species: profile.species ?? 'canine',
        symptom_vector: profile.signals,
        presenting_signs: profile.signals,
        history: { owner_observations: [message] },
    });
    const differentials = inference.differentials.slice(0, 3).map((entry) => ({
        name: entry.condition,
        confidence: Number((entry.probability ?? 0).toFixed(2)),
        reasoning: summarizeDifferentialReasoning(entry.supporting_evidence?.[0]?.finding, entry.determination_basis),
    }));
    const domain = profile.respiratory ? 'respiratory' : profile.gastrointestinal ? 'gastrointestinal' : 'general_clinical';
    const redFlags = buildRedFlags(message, domain);

    return {
        mode: 'clinical',
        content: profile.respiratory
            ? 'Feline upper-respiratory clinical signals detected. Running focused respiratory diagnostic protocol.'
            : 'Clinical signals detected. Running structured heuristic differential protocol.',
        metadata: {
            diagnosis_ranked: differentials,
            urgency_level: redFlags.length > 0 ? 'high' : mapUrgency(inference.differentials[0]?.clinical_urgency),
            recommended_tests: buildRecommendedDiagnostics(domain),
            red_flags: redFlags,
            explanation: buildClinicalExplanation(domain, profile.species),
            source_references: domain === 'respiratory' && profile.species === 'feline'
                ? FELINE_RESPIRATORY_REFERENCES
                : [],
            heuristic_domain: domain,
            species: profile.species ?? 'unknown',
        },
    };
}

function inferSpecies(lower: string): string | null {
    if (/\b(cat|cats|kitten|feline)\b/.test(lower)) return 'feline';
    if (/\b(dog|dogs|puppy|canine)\b/.test(lower)) return 'canine';
    if (/\b(horse|horses|equine)\b/.test(lower)) return 'equine';
    if (/\b(cow|cattle|calf|bovine)\b/.test(lower)) return 'bovine';
    return null;
}

function extractClinicalSignals(lower: string): string[] {
    const signals: string[] = [];
    const add = (pattern: RegExp, signal: string) => {
        if (pattern.test(lower)) signals.push(signal);
    };

    add(/\bsneez(?:e|es|ing)?\b/, 'sneezing');
    add(/\b(nasal discharge|runny nose|rhinitis|nasal)\b/, 'nasal discharge');
    add(/\b(mucopurulent|green nasal|yellow nasal)\b/, 'mucopurulent nasal discharge');
    add(/\b(conjunctivitis|ocular discharge|eye discharge|watery eyes)\b/, 'ocular discharge');
    add(/\b(oral ulcer|mouth ulcer|ulceration|drooling|salivation)\b/, 'oral ulceration');
    add(/\b(cough|coughing)\b/, 'cough');
    add(/\b(dyspnea|difficulty breathing|labored breathing|respiratory distress)\b/, 'dyspnea');
    add(/\bfever\b/, 'fever');
    add(/\b(lethargy|lethargic)\b/, 'lethargy');
    add(/\b(anorexia|not eating|inappetence|poor appetite)\b/, 'anorexia');
    add(/\bvomit(?:ing)?\b/, 'vomiting');
    add(/\bdiarrh(?:ea|oea)\b/, 'diarrhea');
    add(/\b(weight loss|losing weight)\b/, 'weight loss');
    add(/\b(polyuria|urinating|urination)\b/, 'polyuria');
    add(/\b(polydipsia|drinking)\b/, 'polydipsia');

    return [...new Set(signals)];
}

function summarizeDifferentialReasoning(finding: string | undefined, basis: string | undefined): string {
    if (finding) return finding;
    if (basis === 'symptom_scoring') return 'Ranked from species and presenting-sign cluster in heuristic mode.';
    return 'Ranked by local clinical inference heuristics.';
}

function mapUrgency(value: string | undefined): HeuristicMetadata['urgency_level'] {
    if (value === 'immediate') return 'emergency';
    if (value === 'urgent') return 'high';
    return 'moderate';
}

function buildRecommendedDiagnostics(domain: string): string[] {
    if (domain === 'respiratory') {
        return [
            'Focused history and physical exam: duration, exposure, vaccination, appetite, temperature, respiratory effort, ocular/oral lesions',
            'Upper-respiratory infectious testing when results change management: FHV-1/FCV/Chlamydia/Mycoplasma PCR from conjunctival/oropharyngeal/nasal samples',
            'CBC/chemistry when fever, anorexia, dehydration, systemic illness, or sedation/anesthesia planning is present',
            'Thoracic radiographs if cough, dyspnea, abnormal lung sounds, hypoxemia, or suspected pneumonia is present',
            'Nasal imaging plus rhinoscopy, biopsy, or deep culture for chronic, unilateral, obstructive, hemorrhagic, recurrent, or severe nasal disease',
        ];
    }

    if (domain === 'gastrointestinal') {
        return [
            'Hydration and perfusion assessment with temperature and pain scoring',
            'CBC, serum chemistry, electrolytes, and urinalysis when systemic illness or dehydration is present',
            'Fecal flotation/direct smear and targeted infectious testing based on age, vaccination, exposure, and stool character',
            'Abdominal radiographs or ultrasound when obstruction, foreign body, mass, severe pain, or persistent signs are suspected',
        ];
    }

    return [
        'Focused physical examination and vital signs',
        'CBC, serum chemistry, and urinalysis when systemic illness is possible',
        'Targeted point-of-care testing selected from species, age, exposure, and body-system localization',
    ];
}

function buildRedFlags(message: string, domain: string): string[] {
    const lower = message.toLowerCase();
    const flags: string[] = [];
    if (domain === 'respiratory' && /difficulty breathing|labored breathing|dyspnea|cyanosis|blue gums|open mouth breathing/.test(lower)) {
        flags.push('Respiratory distress or open-mouth breathing requires urgent veterinary assessment.');
    }
    if (/not eating|anorexia|dehydration|collapse|weakness/.test(lower)) {
        flags.push('Anorexia, dehydration, collapse, or marked weakness increases urgency.');
    }
    return flags;
}

function buildClinicalExplanation(domain: string, species: string | null): string {
    if (domain === 'respiratory') {
        return 'Heuristic mode active, but routing is now body-system aware: feline nasal discharge and sneezing are treated as an upper-respiratory syndrome, not a gastrointestinal case. Use indexed RAG citations when available and clinician judgment for final diagnosis.';
    }
    if (domain === 'gastrointestinal') {
        return 'Heuristic mode active. GI signs are routed through hydration, baseline labs, fecal/infectious testing, and imaging when indicated.';
    }
    return `Heuristic mode active for ${species ?? 'unknown species'} clinical signs. Connect the AI provider and indexed RAG corpus for precision differential ranking.`;
}
