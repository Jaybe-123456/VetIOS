import type {
    DifferentialEntry,
    EvidenceEntry,
    InferenceExplanation,
    InferenceRequest,
    RelationshipType,
} from './types';

export interface PathognomonicSupportingModifier {
    check: (request: InferenceRequest) => boolean;
    add_probability: number;
    label: string;
}

export interface PathognomonicSecondaryDiagnosis {
    condition: string;
    probability: number;
    relationship_type?: RelationshipType;
}

export interface PathognomonicRule {
    condition: string;
    trigger: (request: InferenceRequest) => boolean;
    base_probability: number;
    supporting_modifiers: PathognomonicSupportingModifier[];
    exclusions: string[];
    secondary_diagnoses: PathognomonicSecondaryDiagnosis[];
    urgency: DifferentialEntry['clinical_urgency'];
    recommended_next_steps?: string[];
}

export interface PathognomonicResult {
    rule: PathognomonicRule;
    primary_probability: number;
    supporting_evidence: EvidenceEntry[];
    anomaly_notes: string[];
}

function hasPositivePcr(request: InferenceRequest, key: string) {
    return request.diagnostic_tests?.pcr?.[key] === 'positive';
}

function smearIncludes(entries: string[] | undefined, match: string) {
    return entries?.some((entry) => entry.toLowerCase().includes(match)) === true;
}

export const PATHOGNOMONIC_RULES: PathognomonicRule[] = [
    {
        condition: 'Dirofilariosis',
        trigger: (request) =>
            request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen === 'positive'
            || request.diagnostic_tests?.cbc?.microfilaremia === 'present'
            || request.diagnostic_tests?.parasitology?.knott_test === 'positive_microfilariae',
        base_probability: 0.92,
        supporting_modifiers: [
            {
                check: (request) => request.diagnostic_tests?.echocardiography?.worms_visualised === 'present',
                add_probability: 0.04,
                label: 'Echocardiographic worm visualisation',
            },
            {
                check: (request) => request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement === 'present',
                add_probability: 0.02,
                label: 'Pulmonary artery enlargement on radiograph',
            },
            {
                check: (request) => request.diagnostic_tests?.cbc?.eosinophilia != null && request.diagnostic_tests?.cbc?.eosinophilia !== 'absent',
                add_probability: 0.01,
                label: 'Eosinophilia on CBC',
            },
            {
                check: (request) => request.preventive_history?.heartworm_prevention === 'none',
                add_probability: 0.01,
                label: 'No heartworm prevention history',
            },
        ],
        exclusions: [
            'Tracheal Collapse',
            'Primary Bronchitis',
            'Laryngeal Paralysis',
            'Megaesophagus',
            'Diabetes Mellitus',
            'Hypothyroidism',
            'Hypoadrenocorticism',
        ],
        secondary_diagnoses: [
            { condition: 'Pulmonary Hypertension', probability: 0.08, relationship_type: 'complication' },
            { condition: 'Congestive Heart Failure', probability: 0.05, relationship_type: 'secondary' },
            { condition: 'Thromboembolic disease', probability: 0.03, relationship_type: 'complication' },
        ],
        urgency: 'urgent',
        recommended_next_steps: [
            'Classify disease severity (Class I-III per AHS guidelines)',
            'Restrict exercise immediately',
            'Stabilise before adulticide therapy',
            'Doxycycline pre-treatment for Wolbachia reduction',
            'Consider prednisone for pulmonary inflammation',
        ],
    },
    {
        condition: 'Babesiosis',
        trigger: (request) =>
            smearIncludes(request.diagnostic_tests?.parasitology?.buffy_coat_smear, 'babesia')
            || smearIncludes(request.diagnostic_tests?.cbc?.hemoparasites_seen, 'babesia')
            || hasPositivePcr(request, 'babesia_pcr'),
        base_probability: 0.90,
        supporting_modifiers: [
            {
                check: (request) => request.diagnostic_tests?.cbc?.thrombocytopenia === 'severe',
                add_probability: 0.05,
                label: 'Severe thrombocytopenia',
            },
            {
                check: (request) => request.diagnostic_tests?.cbc?.anemia_type === 'regenerative',
                add_probability: 0.03,
                label: 'Regenerative anaemia',
            },
        ],
        exclusions: ['Immune-mediated haemolytic anaemia', 'Tracheal Collapse'],
        secondary_diagnoses: [{ condition: 'Ehrlichiosis', probability: 0.15, relationship_type: 'co-morbidity' }],
        urgency: 'urgent',
    },
    {
        condition: 'Leishmaniosis',
        trigger: (request) =>
            request.diagnostic_tests?.serology?.leishmania_antibody === 'positive'
            || hasPositivePcr(request, 'leishmania_pcr'),
        base_probability: 0.88,
        supporting_modifiers: [
            {
                check: (request) => request.diagnostic_tests?.biochemistry?.globulins === 'hyperglobulinemia',
                add_probability: 0.05,
                label: 'Hyperglobulinaemia',
            },
            {
                check: (request) => request.diagnostic_tests?.biochemistry?.albumin === 'hypoalbuminemia',
                add_probability: 0.04,
                label: 'Hypoalbuminaemia',
            },
            {
                check: (request) => request.diagnostic_tests?.urinalysis?.proteinuria === 'present',
                add_probability: 0.03,
                label: 'Proteinuria',
            },
        ],
        exclusions: ['Lymphoma', 'Diabetes Mellitus'],
        secondary_diagnoses: [
            { condition: 'Immune-mediated glomerulonephritis', probability: 0.20, relationship_type: 'complication' },
            { condition: 'Uveitis', probability: 0.10, relationship_type: 'complication' },
        ],
        urgency: 'urgent',
    },
    {
        condition: 'Parvoviral enteritis',
        trigger: (request) => request.diagnostic_tests?.serology?.parvovirus_antigen === 'positive',
        base_probability: 0.94,
        supporting_modifiers: [
            {
                check: (request) => request.diagnostic_tests?.cbc?.lymphopenia === 'present',
                add_probability: 0.04,
                label: 'Lymphopenia on CBC',
            },
            {
                check: (request) => request.diagnostic_tests?.cbc?.neutrophilia === 'present',
                add_probability: 0.01,
                label: 'Neutrophilia on CBC',
            },
        ],
        exclusions: ['Salmonellosis', 'Dietary indiscretion', 'Inflammatory Bowel Disease'],
        secondary_diagnoses: [{ condition: 'Secondary bacterial septicaemia', probability: 0.25, relationship_type: 'complication' }],
        urgency: 'urgent',
    },
    {
        condition: 'Anaplasmosis',
        trigger: (request) => request.diagnostic_tests?.serology?.anaplasma_antibody === 'positive',
        base_probability: 0.85,
        supporting_modifiers: [
            {
                check: (request) => request.diagnostic_tests?.cbc?.thrombocytopenia != null && request.diagnostic_tests?.cbc?.thrombocytopenia !== 'absent',
                add_probability: 0.07,
                label: 'Thrombocytopenia',
            },
        ],
        exclusions: ['Immune-mediated thrombocytopenia'],
        secondary_diagnoses: [],
        urgency: 'urgent',
    },
    {
        condition: 'Ehrlichiosis',
        trigger: (request) => request.diagnostic_tests?.serology?.ehrlichia_antibody === 'positive',
        base_probability: 0.85,
        supporting_modifiers: [
            {
                check: (request) => request.diagnostic_tests?.cbc?.thrombocytopenia != null && request.diagnostic_tests?.cbc?.thrombocytopenia !== 'absent',
                add_probability: 0.06,
                label: 'Thrombocytopenia',
            },
        ],
        exclusions: [],
        secondary_diagnoses: [{ condition: 'Anaplasmosis', probability: 0.12, relationship_type: 'co-morbidity' }],
        urgency: 'urgent',
    },
    {
        condition: 'Diabetes Mellitus',
        trigger: (request) =>
            request.diagnostic_tests?.biochemistry?.glucose === 'hyperglycemia'
            && request.diagnostic_tests?.urinalysis?.glucose_in_urine === 'present',
        base_probability: 0.88,
        supporting_modifiers: [],
        exclusions: ['Stress hyperglycaemia alone'],
        secondary_diagnoses: [
            { condition: 'Pancreatitis', probability: 0.15, relationship_type: 'co-morbidity' },
            { condition: 'Hepatopathy', probability: 0.10, relationship_type: 'co-morbidity' },
        ],
        urgency: 'routine',
    },
    {
        condition: 'Hypothyroidism',
        trigger: (request) =>
            request.diagnostic_tests?.serology?.t4_total === 'low'
            || request.diagnostic_tests?.serology?.free_t4 === 'low',
        base_probability: 0.85,
        supporting_modifiers: [],
        exclusions: [],
        secondary_diagnoses: [],
        urgency: 'routine',
    },
];

export function applyPathognomicGate(request: InferenceRequest): PathognomonicResult | null {
    for (const rule of PATHOGNOMONIC_RULES) {
        if (!rule.trigger(request)) continue;

        const supportingEvidence: EvidenceEntry[] = [];
        let probability = rule.base_probability;
        const anomalyNotes: string[] = [];

        for (const modifier of rule.supporting_modifiers) {
            if (!modifier.check(request)) continue;
            probability += modifier.add_probability;
            supportingEvidence.push({
                finding: modifier.label,
                weight: modifier.add_probability >= 0.03 ? 'definitive' : modifier.add_probability >= 0.02 ? 'strong' : 'supportive',
            });
        }

        if (
            rule.condition === 'Dirofilariosis'
            && request.preventive_history?.heartworm_prevention === 'consistent'
        ) {
            anomalyNotes.push('Positive antigen test despite reported consistent heartworm prevention; verify adherence and product quality, but keep diagnosis dominant.');
        }

        if (rule.condition === 'Dirofilariosis' && request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen === 'positive') {
            supportingEvidence.unshift({
                finding: 'Positive Dirofilaria immitis antigen test',
                weight: 'definitive',
            });
        }
        if (rule.condition === 'Babesiosis') {
            supportingEvidence.unshift({
                finding: 'Babesia identified on smear or PCR',
                weight: 'definitive',
            });
        }
        if (rule.condition === 'Parvoviral enteritis') {
            supportingEvidence.unshift({
                finding: 'Positive parvovirus antigen test',
                weight: 'definitive',
            });
        }

        return {
            rule,
            primary_probability: Math.min(0.96, Math.max(0.85, probability)),
            supporting_evidence: supportingEvidence,
            anomaly_notes: anomalyNotes,
        };
    }

    return null;
}

export function buildPathognomonicExplanation(
    result: PathognomonicResult,
    excludedConditions: InferenceExplanation['excluded_conditions'],
    dataCompletenessScore: number,
): InferenceExplanation {
    return {
        primary_determination: 'pathognomonic_test',
        key_finding: result.supporting_evidence[0]?.finding ?? `${result.rule.condition} pathognomonic evidence`,
        excluded_conditions: excludedConditions,
        evidence_quality: 'high',
        data_completeness_score: dataCompletenessScore,
        missing_data_that_would_help: [],
    };
}
