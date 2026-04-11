export type ClinicalSignalDomain = 'respiratory' | 'gi' | 'neuro' | 'cardio' | 'systemic';
export type ClinicalSignalSpecificity = 'high' | 'medium' | 'low';

const CLINICAL_SIGNAL_ONTOLOGY = {
    respiratory: [
        'coughing',
        'sneezing',
        'nasal_discharge_serous',
        'nasal_discharge_mucopurulent',
        'ocular_discharge',
        'conjunctivitis',
        'dyspnea',
        'tachypnea',
        'cyanosis',
        'exercise_intolerance',
        'abnormal_lung_sounds',
    ],
    gi: [
        'vomiting',
        'diarrhea',
        'bloody_diarrhea',
        'melena',
        'hematemesis',
        'abdominal_pain',
        'tenesmus',
        'inappetence',
        'weight_loss',
    ],
    neuro: [
        'seizures',
        'ataxia',
        'head_pressing',
        'tremors',
        'coma',
        'disorientation',
        'behavior_change',
    ],
    cardio: [
        'syncope',
        'exercise_intolerance',
        'tachycardia',
        'bradycardia',
        'murmur',
        'weak_pulse',
        'jugular_distension',
    ],
    systemic: [
        'fever',
        'lethargy',
        'anorexia',
        'dehydration',
        'shock',
        'hypothermia',
    ],
} as const;

export type CanonicalClinicalSignal =
    typeof CLINICAL_SIGNAL_ONTOLOGY[keyof typeof CLINICAL_SIGNAL_ONTOLOGY][number];

export type ClinicalSignalClusterScores = Record<ClinicalSignalDomain, number>;

export interface ClinicalSignalProfile {
    positiveSignals: Set<CanonicalClinicalSignal>;
    positiveFamilies: Set<string>;
    positiveSignalsByFamily: Map<string, CanonicalClinicalSignal[]>;
    negativeSignals: Set<CanonicalClinicalSignal>;
    negativeFamilies: Set<string>;
    negativeSignalsByFamily: Map<string, CanonicalClinicalSignal[]>;
    clusterScores: ClinicalSignalClusterScores;
    strongSignalCounts: ClinicalSignalClusterScores;
    dominantCluster: ClinicalSignalDomain | null;
    mixedClusters: ClinicalSignalDomain[];
    totalStrongSignals: number;
    ignoredInputs: string[];
}

interface ClinicalSignalDefinition {
    term: CanonicalClinicalSignal;
    family: string;
    domains: ClinicalSignalDomain[];
    specificity: ClinicalSignalSpecificity;
    aliases: string[];
}

const SIGNAL_DEFINITIONS: ClinicalSignalDefinition[] = [
    {
        term: 'coughing',
        family: 'coughing',
        domains: ['respiratory'],
        specificity: 'medium',
        aliases: ['coughing', 'cough', 'chronic cough', 'chronic_cough', 'productive cough', 'productive_cough', 'honking cough', 'honking_cough'],
    },
    {
        term: 'sneezing',
        family: 'sneezing',
        domains: ['respiratory'],
        specificity: 'medium',
        aliases: ['sneezing', 'sneezing episodes'],
    },
    {
        term: 'nasal_discharge_serous',
        family: 'nasal_discharge',
        domains: ['respiratory'],
        specificity: 'medium',
        aliases: ['runny nose', 'nasal discharge', 'clear nasal discharge', 'serous nasal discharge', 'nasal_discharge', 'nasal_discharge_serous'],
    },
    {
        term: 'nasal_discharge_mucopurulent',
        family: 'nasal_discharge',
        domains: ['respiratory'],
        specificity: 'high',
        aliases: ['mucopurulent nasal discharge', 'mucopurulent discharge', 'green nasal discharge', 'yellow nasal discharge', 'nasal_discharge_mucopurulent'],
    },
    {
        term: 'ocular_discharge',
        family: 'ocular_discharge',
        domains: ['respiratory'],
        specificity: 'medium',
        aliases: ['eye discharge', 'ocular discharge', 'ocular_discharge'],
    },
    {
        term: 'conjunctivitis',
        family: 'conjunctivitis',
        domains: ['respiratory'],
        specificity: 'high',
        aliases: ['conjunctivitis', 'red eyes'],
    },
    {
        term: 'dyspnea',
        family: 'dyspnea',
        domains: ['respiratory'],
        specificity: 'high',
        aliases: ['dyspnea', 'difficulty breathing', 'labored breathing', 'shortness of breath', 'respiratory distress', 'acute respiratory distress', 'respiratory_distress', 'acute_respiratory_distress'],
    },
    {
        term: 'tachypnea',
        family: 'tachypnea',
        domains: ['respiratory'],
        specificity: 'medium',
        aliases: ['tachypnea', 'panting', 'rapid breathing'],
    },
    {
        term: 'cyanosis',
        family: 'cyanosis',
        domains: ['respiratory'],
        specificity: 'high',
        aliases: ['cyanosis', 'blue gums', 'cyanotic'],
    },
    {
        term: 'exercise_intolerance',
        family: 'exercise_intolerance',
        domains: ['respiratory', 'cardio'],
        specificity: 'medium',
        aliases: ['exercise intolerance', 'exercise_intolerance'],
    },
    {
        term: 'abnormal_lung_sounds',
        family: 'abnormal_lung_sounds',
        domains: ['respiratory'],
        specificity: 'high',
        aliases: ['abnormal lung sounds', 'increased lung sounds', 'wheezes', 'wheezing', 'crackles', 'crackling', 'abnormal_lung_sounds', 'increased_lung_sounds'],
    },
    {
        term: 'vomiting',
        family: 'vomiting',
        domains: ['gi'],
        specificity: 'medium',
        aliases: ['vomiting', 'vomit', 'emesis'],
    },
    {
        term: 'diarrhea',
        family: 'diarrhea',
        domains: ['gi'],
        specificity: 'medium',
        aliases: ['diarrhea', 'diarrhoea', 'loose stool', 'loose stools'],
    },
    {
        term: 'bloody_diarrhea',
        family: 'bloody_diarrhea',
        domains: ['gi'],
        specificity: 'high',
        aliases: ['bloody diarrhea', 'bloody stool', 'hematochezia', 'bloody_diarrhea'],
    },
    {
        term: 'melena',
        family: 'melena',
        domains: ['gi'],
        specificity: 'high',
        aliases: ['melena', 'black stool', 'tarry stool'],
    },
    {
        term: 'hematemesis',
        family: 'hematemesis',
        domains: ['gi'],
        specificity: 'high',
        aliases: ['hematemesis', 'vomiting blood'],
    },
    {
        term: 'abdominal_pain',
        family: 'abdominal_pain',
        domains: ['gi'],
        specificity: 'medium',
        aliases: ['abdominal pain', 'painful abdomen', 'abdominal_pain'],
    },
    {
        term: 'tenesmus',
        family: 'tenesmus',
        domains: ['gi'],
        specificity: 'medium',
        aliases: ['tenesmus', 'straining to defecate', 'rectal straining'],
    },
    {
        term: 'inappetence',
        family: 'inappetence',
        domains: ['gi'],
        specificity: 'low',
        aliases: ['inappetence', 'poor appetite', 'reduced appetite', 'decreased appetite'],
    },
    {
        term: 'weight_loss',
        family: 'weight_loss',
        domains: ['gi', 'systemic'],
        specificity: 'low',
        aliases: ['weight loss', 'losing weight', 'cachexia', 'weight_loss'],
    },
    {
        term: 'seizures',
        family: 'seizures',
        domains: ['neuro'],
        specificity: 'high',
        aliases: ['seizure', 'seizures'],
    },
    {
        term: 'ataxia',
        family: 'ataxia',
        domains: ['neuro'],
        specificity: 'medium',
        aliases: ['ataxia', 'ataxic'],
    },
    {
        term: 'head_pressing',
        family: 'head_pressing',
        domains: ['neuro'],
        specificity: 'high',
        aliases: ['head pressing', 'head_pressing'],
    },
    {
        term: 'tremors',
        family: 'tremors',
        domains: ['neuro'],
        specificity: 'medium',
        aliases: ['tremor', 'tremors'],
    },
    {
        term: 'coma',
        family: 'coma',
        domains: ['neuro'],
        specificity: 'high',
        aliases: ['coma', 'comatose'],
    },
    {
        term: 'disorientation',
        family: 'disorientation',
        domains: ['neuro'],
        specificity: 'medium',
        aliases: ['disorientation', 'disoriented', 'confusion', 'confused'],
    },
    {
        term: 'behavior_change',
        family: 'behavior_change',
        domains: ['neuro'],
        specificity: 'medium',
        aliases: ['behavior change', 'behaviour change', 'behavior_change', 'behaviour_change', 'altered behavior', 'altered behaviour'],
    },
    {
        term: 'syncope',
        family: 'syncope',
        domains: ['cardio'],
        specificity: 'high',
        aliases: ['syncope', 'fainting', 'fainted'],
    },
    {
        term: 'tachycardia',
        family: 'tachycardia',
        domains: ['cardio'],
        specificity: 'medium',
        aliases: ['tachycardia', 'rapid heart rate'],
    },
    {
        term: 'bradycardia',
        family: 'bradycardia',
        domains: ['cardio'],
        specificity: 'medium',
        aliases: ['bradycardia', 'slow heart rate'],
    },
    {
        term: 'murmur',
        family: 'murmur',
        domains: ['cardio'],
        specificity: 'high',
        aliases: ['murmur', 'heart murmur', 'heart_murmur'],
    },
    {
        term: 'weak_pulse',
        family: 'weak_pulse',
        domains: ['cardio'],
        specificity: 'high',
        aliases: ['weak pulse', 'thready pulse', 'weak_pulse'],
    },
    {
        term: 'jugular_distension',
        family: 'jugular_distension',
        domains: ['cardio'],
        specificity: 'high',
        aliases: ['jugular distension', 'jugular_distension'],
    },
    {
        term: 'fever',
        family: 'fever',
        domains: ['systemic'],
        specificity: 'low',
        aliases: ['fever', 'pyrexia', 'febrile'],
    },
    {
        term: 'lethargy',
        family: 'lethargy',
        domains: ['systemic'],
        specificity: 'low',
        aliases: ['lethargy', 'lethargic', 'weak', 'weakness'],
    },
    {
        term: 'anorexia',
        family: 'anorexia',
        domains: ['systemic'],
        specificity: 'low',
        aliases: ['anorexia', 'not eating', 'stopped eating', 'won t eat', 'wont eat', 'no appetite'],
    },
    {
        term: 'dehydration',
        family: 'dehydration',
        domains: ['systemic'],
        specificity: 'medium',
        aliases: ['dehydration', 'dehydrated'],
    },
    {
        term: 'shock',
        family: 'shock',
        domains: ['systemic'],
        specificity: 'high',
        aliases: ['shock', 'collapsed in shock'],
    },
    {
        term: 'hypothermia',
        family: 'hypothermia',
        domains: ['systemic'],
        specificity: 'medium',
        aliases: ['hypothermia', 'low body temperature'],
    },
];

const SIGNAL_DEFINITION_BY_TERM = new Map<CanonicalClinicalSignal, ClinicalSignalDefinition>(
    SIGNAL_DEFINITIONS.map((definition) => [definition.term, definition]),
);
const TOKEN_ALIAS_TO_SIGNAL = new Map<string, CanonicalClinicalSignal>();
const PHRASE_ALIAS_TO_SIGNAL = new Map<string, CanonicalClinicalSignal>();
for (const definition of SIGNAL_DEFINITIONS) {
    TOKEN_ALIAS_TO_SIGNAL.set(definition.term, definition.term);
    PHRASE_ALIAS_TO_SIGNAL.set(formatPhrase(definition.term), definition.term);
    for (const alias of definition.aliases) {
        TOKEN_ALIAS_TO_SIGNAL.set(normalizeToken(alias), definition.term);
        PHRASE_ALIAS_TO_SIGNAL.set(formatPhrase(alias), definition.term);
    }
}

const SPECIFICITY_WEIGHT: Record<ClinicalSignalSpecificity, number> = {
    high: 3,
    medium: 2,
    low: 1,
};

function emptyScores(): ClinicalSignalClusterScores {
    return {
        respiratory: 0,
        gi: 0,
        neuro: 0,
        cardio: 0,
        systemic: 0,
    };
}

function normalizeToken(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function formatPhrase(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSignalsByFamily(signals: Iterable<CanonicalClinicalSignal>): Map<string, CanonicalClinicalSignal[]> {
    const grouped = new Map<string, CanonicalClinicalSignal[]>();
    for (const signal of signals) {
        const family = familyForSignal(signal);
        const current = grouped.get(family) ?? [];
        if (!current.includes(signal)) {
            current.push(signal);
            current.sort((left, right) => specificityWeight(right) - specificityWeight(left));
            grouped.set(family, current);
        }
    }
    return grouped;
}

function extractNegativeClauses(normalizedText: string): string[] {
    const clauses: string[] = [];
    const pattern = /\b(?:no|not|without|denies?|absence of)\b([^.;]+)/g;
    let match: RegExpExecArray | null = pattern.exec(normalizedText);

    while (match) {
        const clause = formatPhrase(match[1] ?? '');
        if (clause) {
            clauses.push(clause);
            for (const fragment of clause.split(/\b(?:and|or|but)\b|,/).map((entry) => formatPhrase(entry))) {
                if (fragment) clauses.push(fragment);
            }
        }
        match = pattern.exec(normalizedText);
    }

    return clauses;
}

function extractSignalsFromPhrase(normalizedPhrase: string): Set<CanonicalClinicalSignal> {
    const signals = new Set<CanonicalClinicalSignal>();
    for (const [phrase, signal] of PHRASE_ALIAS_TO_SIGNAL.entries()) {
        const pattern = new RegExp(`\\b${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/ /g, '\\s+')}\\b`);
        if (pattern.test(normalizedPhrase)) {
            signals.add(signal);
        }
    }
    return signals;
}

function resolveSignal(value: string): CanonicalClinicalSignal | null {
    const normalized = normalizeToken(value);
    return TOKEN_ALIAS_TO_SIGNAL.get(normalized) ?? null;
}

export function familyForSignal(signal: string): string {
    const definition = SIGNAL_DEFINITION_BY_TERM.get(signal as CanonicalClinicalSignal);
    return definition?.family ?? normalizeToken(signal);
}

export function domainsForSignal(signal: string): ClinicalSignalDomain[] {
    return SIGNAL_DEFINITION_BY_TERM.get(signal as CanonicalClinicalSignal)?.domains ?? [];
}

export function specificityForSignal(signal: string): ClinicalSignalSpecificity {
    return SIGNAL_DEFINITION_BY_TERM.get(signal as CanonicalClinicalSignal)?.specificity ?? 'low';
}

export function specificityWeight(signal: string): number {
    return SPECIFICITY_WEIGHT[specificityForSignal(signal)];
}

export function formatClinicalSignalLabel(signal: string): string {
    return signal.replace(/_/g, ' ');
}

export function normalizeCanonicalSignalArray(rawSignals: string[] | undefined): CanonicalClinicalSignal[] {
    const normalized = new Set<CanonicalClinicalSignal>();
    for (const rawSignal of rawSignals ?? []) {
        const signal = resolveSignal(rawSignal);
        if (signal) normalized.add(signal);
    }
    return [...normalized];
}

export function resolveConditionSignalFamilies(rawSignal: string): string[] {
    const signal = resolveSignal(rawSignal);
    return signal ? [familyForSignal(signal)] : [];
}

export function buildClinicalSignalProfile(
    rawSignals: string[] | undefined,
    ownerObservations: string[] | undefined,
): ClinicalSignalProfile {
    const positiveSignals = new Set<CanonicalClinicalSignal>(normalizeCanonicalSignalArray(rawSignals));
    const negativeSignals = new Set<CanonicalClinicalSignal>();
    const ignoredInputs: string[] = [];

    for (const rawSignal of rawSignals ?? []) {
        if (!resolveSignal(rawSignal)) {
            ignoredInputs.push(rawSignal);
        }
    }

    for (const observation of ownerObservations ?? []) {
        const normalizedObservation = formatPhrase(observation);
        if (!normalizedObservation) continue;

        const negativeClauses = extractNegativeClauses(normalizedObservation);
        for (const signal of extractSignalsFromPhrase(normalizedObservation)) {
            const explicitlyNegative = negativeClauses.some((clause) => extractSignalsFromPhrase(clause).has(signal));
            if (explicitlyNegative) {
                negativeSignals.add(signal);
                positiveSignals.delete(signal);
                continue;
            }
            if (!negativeSignals.has(signal)) {
                positiveSignals.add(signal);
            }
        }
    }

    const positiveFamilies = new Set<string>([...positiveSignals].map((signal) => familyForSignal(signal)));
    const negativeFamilies = new Set<string>([...negativeSignals].map((signal) => familyForSignal(signal)));
    const positiveSignalsByFamily = buildSignalsByFamily(positiveSignals);
    const negativeSignalsByFamily = buildSignalsByFamily(negativeSignals);
    const clusterScores = emptyScores();
    const strongSignalCounts = emptyScores();

    for (const signal of positiveSignals) {
        const weight = specificityWeight(signal);
        const specificity = specificityForSignal(signal);
        for (const domain of domainsForSignal(signal)) {
            clusterScores[domain] += weight;
            if (specificity !== 'low') {
                strongSignalCounts[domain] += 1;
            }
        }
    }

    const ranked = (Object.entries(clusterScores) as Array<[ClinicalSignalDomain, number]>)
        .sort((left, right) => {
            if (right[1] !== left[1]) return right[1] - left[1];
            return strongSignalCounts[right[0]] - strongSignalCounts[left[0]];
        });
    const topDomain = ranked[0]?.[0] ?? null;
    const topScore = topDomain ? clusterScores[topDomain] : 0;
    const topStrongCount = topDomain ? strongSignalCounts[topDomain] : 0;
    const secondScore = ranked[1]?.[1] ?? 0;
    const secondStrongCount = ranked[1] ? strongSignalCounts[ranked[1][0]] : 0;
    const dominantCluster = topDomain
        && topStrongCount >= 3
        && topScore > 0
        && (topScore - secondScore >= 2)
        && (topStrongCount > secondStrongCount)
        ? topDomain
        : null;
    const mixedClusters = ranked
        .filter(([domain, score]) => score > 0 && (score >= topScore - 1 || strongSignalCounts[domain] >= 2))
        .map(([domain]) => domain);

    return {
        positiveSignals,
        positiveFamilies,
        positiveSignalsByFamily,
        negativeSignals,
        negativeFamilies,
        negativeSignalsByFamily,
        clusterScores,
        strongSignalCounts,
        dominantCluster,
        mixedClusters,
        totalStrongSignals: Object.values(strongSignalCounts).reduce((sum, value) => sum + value, 0),
        ignoredInputs,
    };
}
