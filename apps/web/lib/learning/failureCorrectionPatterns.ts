export interface FailurePatternProfile {
    canonical_label: string;
    aliases: string[];
    pattern_family: string;
    description: string;
    discriminating_signals: string[];
    red_flag_signals: string[];
    generic_overlap_signals: string[];
    temporal_features: string[];
    contradiction_signatures: string[];
    contextual_features: string[];
    generalization_tags: string[];
}

const PATTERN_PROFILES: FailurePatternProfile[] = [
    {
        canonical_label: 'acute_gastroenteritis',
        aliases: ['acute gastroenteritis', 'gastroenteritis', 'acute gi upset', 'gi upset'],
        pattern_family: 'generic_gastrointestinal_inflammation',
        description: 'Acute nonspecific gastrointestinal illness dominated by vomiting, diarrhea, and other broadly shared inflammatory signals.',
        discriminating_signals: ['vomiting', 'diarrhea', 'anorexia', 'dehydration'],
        red_flag_signals: [],
        generic_overlap_signals: ['vomiting', 'diarrhea', 'lethargy', 'anorexia', 'dehydration', 'weakness'],
        temporal_features: ['acute', 'acute_onset'],
        contradiction_signatures: [],
        contextual_features: [],
        generalization_tags: ['generic_gi_cluster', 'self_limited_inflammatory_pattern'],
    },
    {
        canonical_label: 'hypoadrenocorticism',
        aliases: ['addisons', 'addison disease', "addison's disease", 'adrenal crisis', 'hypoadrenocorticism'],
        pattern_family: 'endocrine_metabolic_crisis',
        description: 'Episodic endocrine or metabolic instability where generic gastrointestinal signs coexist with hemodynamic mismatch signals.',
        discriminating_signals: ['bradycardia', 'dehydration', 'collapse', 'weakness'],
        red_flag_signals: ['bradycardia', 'collapse'],
        generic_overlap_signals: ['vomiting', 'diarrhea', 'lethargy', 'anorexia', 'dehydration'],
        temporal_features: ['intermittent_course', 'chronic_duration', 'fluctuating'],
        contradiction_signatures: ['bradycardia_with_dehydration'],
        contextual_features: ['recurrent_episodic_course', 'fluid_responsive_instability', 'recent_stress_trigger'],
        generalization_tags: ['hemodynamic_mismatch_pattern', 'endocrine_instability_pattern'],
    },
    {
        canonical_label: 'gastric_dilatation_volvulus',
        aliases: ['gdv', 'gastric dilatation volvulus', 'bloat', 'gastric torsion'],
        pattern_family: 'mechanical_gastrointestinal_emergency',
        description: 'Acute mechanical upper gastrointestinal emergency with nonproductive retching, progressive distension, and perfusion compromise.',
        discriminating_signals: ['retching_unproductive', 'abdominal_distension', 'collapse', 'pale_mucous_membranes'],
        red_flag_signals: ['retching_unproductive', 'abdominal_distension', 'collapse', 'pale_mucous_membranes'],
        generic_overlap_signals: ['lethargy', 'weakness', 'vomiting'],
        temporal_features: ['acute', 'acute_onset', 'recent_meal'],
        contradiction_signatures: [
            'severe_abdominal_distension_without_pain_behavior',
            'severe_illness_with_normal_activity',
        ],
        contextual_features: ['deep_chested_gastric_dilatation_volvulus_predisposition', 'recent_meal'],
        generalization_tags: ['mechanical_obstruction_pattern', 'structural_emergency_pattern'],
    },
    {
        canonical_label: 'urinary_obstruction',
        aliases: ['blocked cat', 'urethral obstruction', 'urinary obstruction', 'urethral blockage'],
        pattern_family: 'mechanical_obstructive_emergency',
        description: 'Obstructive urinary pattern where stranguria or dribbling urine should outrank nonspecific malaise or vomiting.',
        discriminating_signals: ['urinary_obstruction_pattern', 'stranguria', 'oliguria', 'anuria'],
        red_flag_signals: ['urinary_obstruction_pattern', 'anuria'],
        generic_overlap_signals: ['lethargy', 'anorexia', 'vomiting'],
        temporal_features: ['acute', 'progressive_worsening'],
        contradiction_signatures: ['urinary_obstruction_with_normal_urination'],
        contextual_features: ['intact_male'],
        generalization_tags: ['lower_urinary_obstruction_pattern', 'mechanical_outflow_failure'],
    },
    {
        canonical_label: 'pyometra',
        aliases: ['pyometra', 'uterine infection'],
        pattern_family: 'reproductive_septic_process',
        description: 'Intact female reproductive emergency where recent estrus and vaginal discharge outweigh generic systemic illness labels.',
        discriminating_signals: ['intact_female', 'recent_estrus', 'vaginal_discharge', 'fever'],
        red_flag_signals: ['collapse', 'dehydration'],
        generic_overlap_signals: ['lethargy', 'anorexia', 'vomiting', 'dehydration'],
        temporal_features: ['progressive_worsening', 'subacute'],
        contradiction_signatures: ['severe_illness_with_normal_appetite'],
        contextual_features: ['intact_female', 'recent_estrus'],
        generalization_tags: ['reproductive_source_sepsis', 'context_driven_emergency_pattern'],
    },
    {
        canonical_label: 'diabetic_ketoacidosis',
        aliases: ['dka', 'diabetic ketoacidosis'],
        pattern_family: 'metabolic_crisis',
        description: 'Progressive metabolic crisis where polyuria and polydipsia provide important context around vomiting and dehydration.',
        discriminating_signals: ['polydipsia', 'polyuria', 'vomiting', 'dehydration', 'weakness'],
        red_flag_signals: ['collapse', 'dehydration'],
        generic_overlap_signals: ['lethargy', 'anorexia', 'vomiting'],
        temporal_features: ['progressive_worsening', 'subacute'],
        contradiction_signatures: ['severe_illness_with_normal_activity'],
        contextual_features: ['polydipsia', 'polyuria'],
        generalization_tags: ['metabolic_decompensation_pattern', 'history_context_required'],
    },
    {
        canonical_label: 'foreign_body_obstruction',
        aliases: ['foreign body', 'gi foreign body', 'foreign body obstruction'],
        pattern_family: 'mechanical_gastrointestinal_obstruction',
        description: 'Mechanical gastrointestinal obstruction where persistent vomiting and obstruction context dominate over diffuse inflammatory labels.',
        discriminating_signals: ['vomiting', 'anorexia', 'abdominal_pain', 'abdominal_distension'],
        red_flag_signals: ['abdominal_distension', 'collapse'],
        generic_overlap_signals: ['lethargy', 'diarrhea', 'dehydration'],
        temporal_features: ['acute', 'progressive_worsening'],
        contradiction_signatures: ['severe_abdominal_distension_without_pain_behavior'],
        contextual_features: ['foreign_material_or_dietary_indiscretion', 'recent_meal'],
        generalization_tags: ['mechanical_obstruction_pattern', 'ingestion_associated_emergency'],
    },
    {
        canonical_label: 'pancreatitis',
        aliases: ['pancreatitis', 'acute pancreatitis'],
        pattern_family: 'inflammatory_gastrointestinal_crisis',
        description: 'Inflammatory gastrointestinal crisis where abdominal pain and systemic inflammation refine an otherwise generic vomiting pattern.',
        discriminating_signals: ['vomiting', 'abdominal_pain', 'anorexia', 'dehydration'],
        red_flag_signals: ['collapse'],
        generic_overlap_signals: ['lethargy', 'diarrhea', 'vomiting'],
        temporal_features: ['acute', 'progressive_worsening'],
        contradiction_signatures: ['severe_illness_with_normal_activity'],
        contextual_features: ['recent_meal'],
        generalization_tags: ['inflammatory_crisis_pattern', 'pain_weighted_gi_pattern'],
    },
    {
        canonical_label: 'pneumonia',
        aliases: ['pneumonia', 'aspiration pneumonia', 'bronchopneumonia'],
        pattern_family: 'respiratory_infectious_emergency',
        description: 'Lower respiratory infectious pattern where dyspnea and gas-exchange compromise outrank mild upper respiratory noise.',
        discriminating_signals: ['dyspnea', 'cough', 'fever', 'cyanosis'],
        red_flag_signals: ['dyspnea', 'cyanosis'],
        generic_overlap_signals: ['lethargy', 'nasal_discharge', 'ocular_discharge'],
        temporal_features: ['progressive_worsening', 'acute'],
        contradiction_signatures: ['respiratory_distress_with_normal_effort'],
        contextual_features: ['kennel_exposure', 'shelter_exposure'],
        generalization_tags: ['gas_exchange_failure_pattern', 'lower_respiratory_priority_pattern'],
    },
    {
        canonical_label: 'toxin_ingestion',
        aliases: ['toxin ingestion', 'poisoning', 'toxicosis', 'toxic exposure'],
        pattern_family: 'toxicologic_emergency',
        description: 'Toxicologic presentation where neurologic and secretory signs should outrank generic gastrointestinal interpretation.',
        discriminating_signals: ['hypersalivation', 'tremors', 'seizures', 'vomiting'],
        red_flag_signals: ['seizures', 'collapse'],
        generic_overlap_signals: ['lethargy', 'vomiting', 'diarrhea'],
        temporal_features: ['acute', 'acute_onset'],
        contradiction_signatures: ['severe_illness_with_normal_activity'],
        contextual_features: ['toxin_exposure_possible'],
        generalization_tags: ['toxicologic_pattern', 'neurosecretory_emergency'],
    },
];

const PROFILE_LOOKUP = buildProfileLookup();

export function getFailurePatternProfiles(): FailurePatternProfile[] {
    return PATTERN_PROFILES;
}

export function resolveFailurePatternProfile(
    label: string | null | undefined,
    classLabel?: string | null,
): FailurePatternProfile {
    const normalizedLabel = normalizeKey(label);
    if (normalizedLabel) {
        const direct = PROFILE_LOOKUP.get(normalizedLabel);
        if (direct) return direct;
    }

    return buildFallbackProfile(label, classLabel);
}

function buildProfileLookup(): Map<string, FailurePatternProfile> {
    const lookup = new Map<string, FailurePatternProfile>();

    for (const profile of PATTERN_PROFILES) {
        for (const variant of [profile.canonical_label, ...profile.aliases]) {
            lookup.set(normalizeKey(variant), profile);
        }
    }

    return lookup;
}

function buildFallbackProfile(
    label: string | null | undefined,
    classLabel?: string | null,
): FailurePatternProfile {
    const normalizedClass = normalizeKey(classLabel);
    const fallbackFamily = normalizedClass || 'undifferentiated_pattern';
    const fallbackDescription = classLabel
        ? `${classLabel} pattern without a curated failure profile yet.`
        : 'Undifferentiated failure pattern without a curated profile yet.';

    const genericSignals = normalizedClass === 'mechanical'
        ? ['vomiting', 'lethargy', 'weakness']
        : normalizedClass === 'infectious'
            ? ['fever', 'lethargy', 'anorexia']
            : normalizedClass === 'metabolic_endocrine' || normalizedClass === 'metabolic___endocrine'
                ? ['vomiting', 'lethargy', 'dehydration']
                : ['vomiting', 'diarrhea', 'lethargy', 'anorexia', 'dehydration'];

    return {
        canonical_label: normalizeKey(label) || 'unknown_target',
        aliases: [],
        pattern_family: fallbackFamily,
        description: fallbackDescription,
        discriminating_signals: [],
        red_flag_signals: [],
        generic_overlap_signals: genericSignals,
        temporal_features: [],
        contradiction_signatures: [],
        contextual_features: [],
        generalization_tags: ['fallback_profile'],
    };
}

function normalizeKey(value: string | null | undefined): string {
    return typeof value === 'string'
        ? value
            .trim()
            .toLowerCase()
            .replace(/['\u2019]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
        : '';
}
