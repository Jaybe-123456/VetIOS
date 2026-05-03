import { getConditionById } from './condition-registry';
import type {
    DifferentialEntry,
    EvidenceEntry,
    ExcludedConditionExplanation,
    InferenceRequest,
    VeterinaryCondition,
} from './types';

interface PathognomonicConditionConfig {
    condition_id: string;
    exclusions: ExcludedConditionExplanation[];
    secondary_diagnoses: Array<{
        condition_id: string;
        probability: number;
        relationship_type: 'secondary' | 'complication' | 'co-morbidity';
    }>;
    recommended_next_steps: string[];
}

export interface PathognomonicResult {
    pathognomicConditionFound: boolean;
    primaryCondition: VeterinaryCondition | null;
    primaryProbability: number;
    keyFinding: string;
    supportingEvidence: EvidenceEntry[];
    excludedConditions: ExcludedConditionExplanation[];
    secondaryDiagnoses: Array<{
        condition: VeterinaryCondition;
        probability: number;
        relationship_type: 'secondary' | 'complication' | 'co-morbidity';
    }>;
    recommendedNextSteps: string[];
    anomalyNotes: string[];
    severityClass: string | null;
}

const PATHOGNOMIC_CONFIG: Record<string, PathognomonicConditionConfig> = {
    dirofilariosis_canine: {
        condition_id: 'dirofilariosis_canine',
        exclusions: [
            { condition: 'Tracheal Collapse', reason: 'Excluded: pulmonary vascular pattern on radiograph is inconsistent with tracheal collapse as the primary diagnosis' },
            { condition: 'Primary Bronchitis', reason: 'Excluded: pathognomonic heartworm antigen positivity fully explains the chronic respiratory syndrome' },
            { condition: 'Diabetes Mellitus', reason: 'Excluded: no shared pathophysiology with confirmed parasitic cardiopulmonary disease; no hyperglycaemia or glucosuria present' },
            { condition: 'Hypothyroidism', reason: 'Excluded: weight loss and cardiopulmonary parasitic evidence are inconsistent with hypothyroidism as the primary diagnosis' },
            { condition: 'Megaesophagus', reason: 'Excluded: no regurgitation or oesophageal imaging supports megaesophagus' },
            { condition: 'Laryngeal Paralysis', reason: 'Excluded as primary diagnosis: no stridor or laryngoscopic confirmation is present' },
        ],
        secondary_diagnoses: [
            { condition_id: 'pulmonary_hypertension', probability: 0.08, relationship_type: 'complication' },
            { condition_id: 'right_sided_chf_secondary', probability: 0.05, relationship_type: 'secondary' },
        ],
        recommended_next_steps: [
            'Classify disease severity (Class I-IV per AHS guidance)',
            'Restrict exercise immediately',
            'Stabilise before adulticide therapy',
            'Begin doxycycline pre-treatment for Wolbachia reduction',
            'Plan split-dose melarsomine protocol after stabilisation',
        ],
    },
    babesiosis_canine: {
        condition_id: 'babesiosis_canine',
        exclusions: [
            { condition: 'Immune-mediated haemolytic anaemia', reason: 'Excluded as primary diagnosis because Babesia was identified directly by smear or PCR' },
        ],
        secondary_diagnoses: [
            { condition_id: 'ehrlichiosis_canine', probability: 0.12, relationship_type: 'co-morbidity' },
        ],
        recommended_next_steps: [
            'Assess packed cell volume and transfusion need immediately',
            'Initiate babesicidal therapy',
            'Screen for tick-borne co-infections',
        ],
    },
    imha_canine: {
        condition_id: 'imha_canine',
        exclusions: [
            { condition: 'Babesiosis', reason: 'Positive Coombs/autoagglutination with negative tick screen excludes primary tick-borne haemolysis as the driver' },
            { condition: 'Microangiopathic haemolytic anaemia', reason: 'Spherocytosis and positive Coombs confirm immune-mediated over mechanical RBC destruction' },
            { condition: 'Haemangiosarcoma', reason: 'Pathognomonic immune markers shift primary haemolysis away from neoplastic fragmentation' },
        ],
        secondary_diagnoses: [
            { condition_id: 'evans_syndrome', probability: 0.18, relationship_type: 'co-morbidity' },
            { condition_id: 'immune_mediated_thrombocytopenia', probability: 0.12, relationship_type: 'co-morbidity' },
        ],
        recommended_next_steps: [
            'Assess PCV and transfusion threshold; consider if PCV < 15% or patient clinically decompensating',
            'Initiate immunosuppressive therapy',
            'Plan thromboembolism prophylaxis',
            'Recheck PCV every 12 hours during crisis phase',
        ],
    },
    imtp_canine: {
        condition_id: 'imtp_canine',
        exclusions: [
            { condition: 'DIC', reason: 'Isolated immune platelet destruction differs mechanistically from consumptive coagulopathy' },
        ],
        secondary_diagnoses: [
            { condition_id: 'evans_syndrome', probability: 0.15, relationship_type: 'co-morbidity' },
        ],
        recommended_next_steps: [
            'Confirm platelet count',
            'Initiate immunosuppressive therapy',
            'Monitor bleeding risk',
        ],
    },
    feline_infectious_peritonitis: {
        condition_id: 'feline_infectious_peritonitis',
        exclusions: [
            { condition: 'Lymphoma', reason: 'Positive FCoV antibody titre with effusion and Rivalta test shifts strongly away from neoplastic effusion as primary' },
            { condition: 'Toxoplasmosis', reason: 'Effusion chemistry and titre profile are inconsistent with toxoplasmosis as primary' },
        ],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Confirm wet versus dry form',
            'Plan antiviral therapy',
            'Monitor effusion and neurologic involvement',
        ],
    },
    addisons_canine: {
        condition_id: 'addisons_canine',
        exclusions: [
            { condition: 'Acute kidney injury', reason: 'Na:K ratio < 27 with appropriate clinical context distinguishes adrenal insufficiency from primary renal failure' },
            { condition: 'Protein-losing enteropathy', reason: 'ACTH-confirmed adrenal insufficiency supersedes GI protein loss as the primary driver' },
        ],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Confirm with ACTH stimulation once stable',
            'Stabilise electrolytes',
            'Start immediate mineralocorticoid and glucocorticoid replacement planning',
        ],
    },
    hypothyroidism_canine: {
        condition_id: 'hypothyroidism_canine',
        exclusions: [
            { condition: 'Obesity', reason: 'Confirmed low T4 with clinical signs shifts weight gain away from dietary cause' },
            { condition: 'Sebaceous adenitis', reason: 'Thyroid function confirmation redirects dermatologic presentation' },
        ],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Confirm with free T4 and TSH',
            'Plan levothyroxine titration',
        ],
    },
    diabetes_mellitus_feline: {
        condition_id: 'diabetes_mellitus_feline',
        exclusions: [
            { condition: 'Renal disease', reason: 'Hyperglycaemia plus glucosuria with appropriate clinical signs confirms diabetic rather than renal glycosuria' },
            { condition: 'Pancreatitis as primary', reason: 'Confirmed DM shifts glucose dysregulation away from acute pancreatitis as the sole driver' },
        ],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Assess ketones',
            'Plan insulin type and regime',
            'Start dietary management',
            'Schedule glucose curve',
        ],
    },
    leptospirosis_canine: {
        condition_id: 'leptospirosis_canine',
        exclusions: [
            { condition: 'Acute pancreatitis', reason: 'Positive MAT or PCR with renal and hepatic involvement redirects away from primary pancreatic disease' },
            { condition: 'Toxin-induced renal failure', reason: 'Confirmed Leptospira serology shifts nephrotoxic cause to infectious' },
        ],
        secondary_diagnoses: [
            { condition_id: 'uveitis_leptospira', probability: 0.08, relationship_type: 'complication' },
        ],
        recommended_next_steps: [
            'Confirm serovar via MAT',
            'Initiate appropriate antimicrobial class',
            'Isolate patient because of zoonotic risk',
            'Monitor renal and hepatic values',
        ],
    },
    toxoplasmosis_canine_feline: {
        condition_id: 'toxoplasmosis_canine_feline',
        exclusions: [
            { condition: 'Encephalitis of other aetiology', reason: 'Positive IgM titre with compatible clinical signs shifts away from alternate CNS inflammatory disease' },
            { condition: 'Lymphoma', reason: 'Positive IgM titre with compatible clinical signs shifts away from neoplastic CNS disease' },
        ],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Confirm IgM:IgG ratio',
            'Review appropriate antimicrobial class',
            'Perform ophthalmic assessment if uveitis is present',
        ],
    },
    canine_distemper: {
        condition_id: 'canine_distemper',
        exclusions: [
            { condition: 'Rabies', reason: 'Positive distemper antigen or compatible inclusion bodies are inconsistent with rabies as primary' },
            { condition: 'Granulomatous meningoencephalitis', reason: 'Distemper confirmation redirects from inflammatory non-infectious cause' },
        ],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Provide supportive care',
            'Manage seizures if indicated',
            'Give prognosis guidance because there is no curative therapy',
        ],
    },
    feline_hyperthyroidism: {
        condition_id: 'feline_hyperthyroidism',
        exclusions: [
            { condition: 'Hypertensive disease', reason: 'Confirmed T4 elevation shifts hypertension from primary to secondary' },
            { condition: 'Chronic kidney disease', reason: 'Hyperthyroidism can mask azotaemia; treat thyroid first and reassess renal function before committing to CKD management' },
        ],
        secondary_diagnoses: [
            { condition_id: 'secondary_hypertension', probability: 0.35, relationship_type: 'secondary' },
            { condition_id: 'hypertrophic_cardiomyopathy_secondary', probability: 0.25, relationship_type: 'complication' },
        ],
        recommended_next_steps: [
            'Confirm with total T4',
            'Initiate antithyroid therapy planning',
            'Monitor blood pressure',
            'Re-evaluate renal function 4 weeks after stabilisation',
        ],
    },
    gdv_canine: {
        condition_id: 'gdv_canine',
        exclusions: [
            { condition: 'Acute pancreatitis', reason: 'Radiographic evidence of gastric volvulus supersedes pancreatic inflammation as the primary emergency' },
            { condition: 'Splenic torsion', reason: 'Confirmed GDV anatomy redirects from isolated splenic volvulus' },
        ],
        secondary_diagnoses: [
            { condition_id: 'gastric_necrosis', probability: 0.25, relationship_type: 'complication' },
            { condition_id: 'cardiac_arrhythmia_perioperative', probability: 0.40, relationship_type: 'complication' },
        ],
        recommended_next_steps: [
            'Immediate gastric decompression',
            'IV access and shock stabilisation',
            'Surgical planning',
            'ECG monitoring',
        ],
    },
    acute_pancreatitis_canine: {
        condition_id: 'acute_pancreatitis_canine',
        exclusions: [
            { condition: 'GDV', reason: 'Positive pancreatic lipase with abdominal imaging supporting pancreatic involvement redirects from gastric volvulus' },
            { condition: 'Intestinal obstruction', reason: 'Lipase elevation and pancreatic imaging findings are inconsistent with primary mechanical obstruction' },
        ],
        secondary_diagnoses: [
            { condition_id: 'diabetes_mellitus_secondary', probability: 0.10, relationship_type: 'complication' },
            { condition_id: 'exocrine_pancreatic_insufficiency', probability: 0.08, relationship_type: 'secondary' },
        ],
        recommended_next_steps: [
            'IV fluid therapy',
            'Pain management',
            'Nutritional support planning',
            'Serial lipase and abdominal assessment',
        ],
    },
    pyometra_canine_feline: {
        condition_id: 'pyometra_canine_feline',
        exclusions: [
            { condition: 'Diabetes mellitus', reason: 'Confirmed uterine infection supersedes PU/PD as a primary diabetic presentation when the patient is an intact female with vaginal discharge' },
        ],
        secondary_diagnoses: [
            { condition_id: 'sepsis', probability: 0.20, relationship_type: 'complication' },
            { condition_id: 'acute_kidney_injury_secondary', probability: 0.15, relationship_type: 'complication' },
        ],
        recommended_next_steps: [
            'Stabilise before surgery',
            'Plan ovariohysterectomy',
            'Review antimicrobial class',
            'Monitor for uterine rupture',
        ],
    },
    septic_peritonitis: {
        condition_id: 'septic_peritonitis',
        exclusions: [
            { condition: 'Acute pancreatitis', reason: 'Free abdominal fluid with septic cytology or leakage evidence supersedes pancreatic inflammation as primary' },
        ],
        secondary_diagnoses: [
            { condition_id: 'septic_shock', probability: 0.35, relationship_type: 'complication' },
        ],
        recommended_next_steps: [
            'Plan source control surgery',
            'Review broad antimicrobial class',
            'Begin sepsis resuscitation',
            'Assess peritoneal drainage',
        ],
    },
    upper_urinary_tract_obstruction_feline: {
        condition_id: 'upper_urinary_tract_obstruction_feline',
        exclusions: [
            { condition: 'Acute kidney injury from other causes', reason: 'Confirmed obstructive uropathy changes the management pathway entirely; deobstruction takes priority over medical AKI management' },
        ],
        secondary_diagnoses: [
            { condition_id: 'acute_kidney_injury_post_obstructive', probability: 0.85, relationship_type: 'secondary' },
        ],
        recommended_next_steps: [
            'Immediate deobstruction',
            'Monitor post-obstruction diuresis',
            'Analyse urethral plug or stone',
            'Plan dietary and recurrence prevention',
        ],
    },
    ehrlichiosis_canine: {
        condition_id: 'ehrlichiosis_canine',
        exclusions: [],
        secondary_diagnoses: [
            { condition_id: 'anaplasmosis_canine', probability: 0.10, relationship_type: 'co-morbidity' },
        ],
        recommended_next_steps: [
            'Initiate doxycycline',
            'Repeat CBC monitoring within 2 to 4 weeks',
            'Institute aggressive tick control',
        ],
    },
    anaplasmosis_canine: {
        condition_id: 'anaplasmosis_canine',
        exclusions: [],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Initiate doxycycline',
            'Institute aggressive tick control',
        ],
    },
    leishmaniosis_canine: {
        condition_id: 'leishmaniosis_canine',
        exclusions: [
            { condition: 'Lymphoma', reason: 'Excluded: specific Leishmania testing is positive and immune-complex chemistry supports infection' },
        ],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Stage renal involvement with UPC ratio and renal panel',
            'Begin anti-leishmanial therapy and vector control',
        ],
    },
    parvoviral_enteritis: {
        condition_id: 'parvoviral_enteritis',
        exclusions: [
            { condition: 'Dietary indiscretion', reason: 'Excluded: positive parvoviral test overrides non-specific gastroenteritis as the primary diagnosis' },
        ],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Initiate intensive supportive care',
            'Start enteral nutrition as soon as vomiting is controlled',
        ],
    },
    clostridial_enterotoxicosis: {
        condition_id: 'clostridial_enterotoxicosis',
        exclusions: [
            { condition: 'Septic Peritonitis', reason: 'Excluded: positive Clostridium enterotoxin ELISA confirms toxin-mediated large-bowel disease; no peritoneal signs present' },
            { condition: 'Mesenteric Volvulus', reason: 'Excluded: stable patient without shock or abdominal distension; positive toxin assay confirms enterotoxicosis' },
            { condition: 'Acute Pancreatitis', reason: 'Excluded: large-bowel signal pattern with positive clostridial toxin is inconsistent with primary pancreatic disease' },
            { condition: 'Gastric Dilatation-Volvulus', reason: 'Excluded: no unproductive retching or gastric distension; positive enterotoxin assay explains the presentation' },
            { condition: 'Intestinal Obstruction', reason: 'Excluded: hematochezia-dominant large-bowel pattern with positive clostridial toxin excludes mechanical obstruction' },
        ],
        secondary_diagnoses: [
            { condition_id: 'acute_hemorrhagic_diarrhea_syndrome', probability: 0.18, relationship_type: 'co-morbidity' },
            { condition_id: 'infectious_colitis', probability: 0.12, relationship_type: 'secondary' },
            { condition_id: 'dietary_enterocolitis', probability: 0.10, relationship_type: 'co-morbidity' },
        ],
        recommended_next_steps: [
            'Initiate IV fluid therapy to correct dehydration',
            'Begin metronidazole or amoxicillin-clavulanate for clostridial overgrowth',
            'Withhold food for 12-24 hours then introduce bland diet',
            'Monitor PCV and total protein every 6-8 hours',
            'Consider probiotics after antibiotic course',
        ],
    },
    diabetes_mellitus_canine: {
        condition_id: 'diabetes_mellitus_canine',
        exclusions: [],
        secondary_diagnoses: [],
        recommended_next_steps: [
            'Initiate insulin therapy planning',
            'Perform glucose curve monitoring',
        ],
    },
};

function getEvidenceValue(request: InferenceRequest, path: string): unknown {
    const fragments = path.split('.');
    let current: unknown;

    if (fragments[0] === 'serology' || fragments[0] === 'cbc' || fragments[0] === 'biochemistry' || fragments[0] === 'urinalysis' || fragments[0] === 'thoracic_radiograph' || fragments[0] === 'abdominal_ultrasound' || fragments[0] === 'echocardiography' || fragments[0] === 'cytology' || fragments[0] === 'pcr' || fragments[0] === 'parasitology') {
        current = request.diagnostic_tests;
    } else if (fragments[0] === 'preventive_history' || fragments[0] === 'history' || fragments[0] === 'physical_exam') {
        current = request;
    } else {
        current = request.diagnostic_tests;
    }

    for (const fragment of fragments) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[fragment];
    }

    return current;
}

function matchesExpected(value: unknown, expected: string): boolean {
    if (Array.isArray(value)) {
        return value.some((entry) => String(entry).toLowerCase().includes(expected.toLowerCase().replace(/_/g, ' ')));
    }
    return String(value ?? '').toLowerCase() === expected.toLowerCase();
}

function inferHeartwormSeverity(request: InferenceRequest): string | null {
    const signs = new Set(request.presenting_signs.map((sign) => sign.toLowerCase()));
    const cyanotic = request.physical_exam?.mucous_membrane_color === 'cyanotic';
    const delayedPerfusion = (request.physical_exam?.capillary_refill_time_s ?? 0) > 3;
    if (signs.has('collapse') || signs.has('caval_syndrome') || cyanotic || delayedPerfusion) return 'IV';
    if (signs.has('syncope') || signs.has('ascites') || signs.has('hemoptysis')) return 'III';
    if (signs.has('exercise_intolerance') || signs.has('chronic_cough') || signs.has('dyspnea')) return 'II';
    return 'I';
}

function passesGateRequirements(candidateId: string, request: InferenceRequest, positiveRuleCount: number): boolean {
    if (positiveRuleCount === 0) return false;
    if (candidateId === 'diabetes_mellitus_canine') {
        return request.diagnostic_tests?.biochemistry?.glucose === 'hyperglycemia'
            && request.diagnostic_tests?.urinalysis?.glucose_in_urine === 'present';
    }
    return true;
}

export function evaluatePathognomicTests(
    candidates: VeterinaryCondition[],
    request: InferenceRequest,
): PathognomonicResult {
    let bestResult: PathognomonicResult | null = null;

    for (const candidate of candidates) {
        const positiveRules = candidate.pathognomonic_tests.filter((rule) => {
            const value = getEvidenceValue(request, rule.test);
            return matchesExpected(value, String(rule.result ?? 'positive'));
        });

        if (!passesGateRequirements(candidate.id, request, positiveRules.length)) continue;

        const support: EvidenceEntry[] = positiveRules.map((rule) => ({
            finding: rule.evidence_label ?? rule.test,
            weight: (rule.probability_if_positive ?? 0) >= 0.95 ? 'definitive' : 'strong',
        }));

        let primaryProbability = Math.max(...positiveRules.map((rule) => rule.probability_if_positive ?? 0.85), 0.85);
        const anomalies: string[] = [];

        if (candidate.id === 'dirofilariosis_canine') {
            if (request.diagnostic_tests?.echocardiography?.worms_visualised === 'present') {
                support.push({ finding: 'Echocardiographic worm visualisation', weight: 'definitive' });
                primaryProbability += 0.02;
            }
            if (request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement === 'present') {
                support.push({ finding: 'Pulmonary artery enlargement on thoracic radiograph', weight: 'strong' });
                primaryProbability += 0.01;
            }
            if (request.diagnostic_tests?.echocardiography?.right_heart_enlargement === 'present' || request.diagnostic_tests?.thoracic_radiograph?.cardiomegaly === 'right_sided') {
                support.push({ finding: 'Right heart enlargement', weight: 'strong' });
                primaryProbability += 0.01;
            }
            if (request.diagnostic_tests?.cbc?.eosinophilia && request.diagnostic_tests.cbc.eosinophilia !== 'absent') {
                support.push({ finding: 'Eosinophilia on CBC', weight: 'supportive' });
                primaryProbability += 0.01;
            }
            if (request.preventive_history?.heartworm_prevention === 'none') {
                support.push({ finding: 'No heartworm prevention history', weight: 'supportive' });
                primaryProbability += 0.01;
            }
            if (request.preventive_history?.vector_exposure?.mosquito_endemic) {
                support.push({ finding: 'Mosquito-endemic geographic exposure', weight: 'supportive' });
                primaryProbability += 0.01;
            }
            if (request.preventive_history?.heartworm_prevention === 'consistent') {
                anomalies.push('Positive heartworm antigen despite consistent prevention history; confirm adherence and product quality while keeping diagnosis dominant.');
            }
        }

        const config = PATHOGNOMIC_CONFIG[candidate.id] ?? {
            condition_id: candidate.id,
            exclusions: [],
            secondary_diagnoses: [],
            recommended_next_steps: [],
        };

        const secondaries = config.secondary_diagnoses
            .map((secondary) => {
                const condition = getConditionById(secondary.condition_id);
                if (!condition) return null;
                return {
                    condition,
                    probability: secondary.probability,
                    relationship_type: secondary.relationship_type,
                };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry != null);

        const result: PathognomonicResult = {
            pathognomicConditionFound: true,
            primaryCondition: candidate,
            primaryProbability,
            keyFinding: support[0]?.finding ?? candidate.canonical_name,
            supportingEvidence: support,
            excludedConditions: config.exclusions,
            secondaryDiagnoses: secondaries,
            recommendedNextSteps: config.recommended_next_steps,
            anomalyNotes: anomalies,
            severityClass: candidate.id === 'dirofilariosis_canine' ? inferHeartwormSeverity(request) : null,
        };

        if (!bestResult || result.primaryProbability > bestResult.primaryProbability) {
            bestResult = result;
        }
    }

    return bestResult ?? {
        pathognomicConditionFound: false,
        primaryCondition: null,
        primaryProbability: 0,
        keyFinding: '',
        supportingEvidence: [],
        excludedConditions: [],
        secondaryDiagnoses: [],
        recommendedNextSteps: [],
        anomalyNotes: [],
        severityClass: null,
    };
}

export function applyPathognomicGate(request: InferenceRequest): PathognomonicResult | null {
    const candidateIds = [
        'dirofilariosis_canine',
        'babesiosis_canine',
        'ehrlichiosis_canine',
        'anaplasmosis_canine',
        'leishmaniosis_canine',
        'parvoviral_enteritis',
        'diabetes_mellitus_canine',
        'imha_canine',
        'imtp_canine',
        'feline_infectious_peritonitis',
        'addisons_canine',
        'hypothyroidism_canine',
        'diabetes_mellitus_feline',
        'leptospirosis_canine',
        'toxoplasmosis_canine_feline',
        'canine_distemper',
        'feline_hyperthyroidism',
        'gdv_canine',
        'acute_pancreatitis_canine',
        'pyometra_canine_feline',
        'septic_peritonitis',
        'upper_urinary_tract_obstruction_feline',
    ];
    const result = evaluatePathognomicTests(
        request.species ? candidateIds.map((id) => getConditionById(id)).filter((entry): entry is VeterinaryCondition => entry != null) : [],
        request,
    );
    return result.pathognomicConditionFound ? result : null;
}

export function buildPathognomonicDifferentials(result: PathognomonicResult): DifferentialEntry[] {
    if (!result.primaryCondition) return [];
    const primaryCondition = result.primaryCondition;
    const primaryUrgency = result.severityClass === 'IV' ? 'immediate' : 'urgent';

    const entries: DifferentialEntry[] = [
        {
            rank: 1,
            condition: primaryCondition.canonical_name,
            condition_id: primaryCondition.id,
            probability: result.primaryProbability,
            confidence: 'high',
            determination_basis: 'pathognomonic_test',
            supporting_evidence: result.supportingEvidence,
            contradicting_evidence: [],
            clinical_urgency: primaryUrgency,
            recommended_confirmatory_tests: [],
            recommended_next_steps: result.recommendedNextSteps,
        },
        ...result.secondaryDiagnoses.map<DifferentialEntry>((secondary, index) => ({
            rank: index + 2,
            condition: secondary.condition.id === 'pulmonary_hypertension'
                ? 'Pulmonary hypertension (secondary to dirofilariosis)'
                : secondary.condition.id === 'right_sided_chf_secondary'
                    ? 'Right-sided CHF (secondary to dirofilariosis)'
                    : secondary.condition.canonical_name,
            condition_id: secondary.condition.id,
            probability: secondary.probability,
            confidence: index === 0 ? 'moderate' : 'low',
            determination_basis: 'syndrome_pattern',
            supporting_evidence: [],
            contradicting_evidence: [],
            relationship_to_primary: {
                type: secondary.relationship_type,
                primary_condition: primaryCondition.canonical_name,
            },
            clinical_urgency: primaryUrgency,
            recommended_confirmatory_tests: [],
            recommended_next_steps: [],
        })),
    ];

    const total = entries.reduce((sum, entry) => sum + entry.probability, 0) || 1;
    return entries.map((entry, index) => ({
        ...entry,
        rank: index + 1,
        probability: entry.probability / total,
    }));
}
