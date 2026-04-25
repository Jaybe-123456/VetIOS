/**
 * Syndrome Routing Engine — Layer 4 of the 4-layer clinical reasoning pipeline.
 *
 * Routes cases to syndrome families BEFORE differential generation so that
 * only conditions inside the routed syndrome family receive full ranking priority.
 * Out-of-family conditions receive a suppression multiplier.
 *
 * References: Constable et al. Veterinary Medicine 11th ed.; WSAVA Global Guidelines
 */

export type SyndromeFamily =
    | 'Acute Hemorrhagic Colitis'
    | 'Large Bowel Inflammatory Syndrome'
    | 'Small Bowel Enteropathy'
    | 'Obstructive GI Disease'
    | 'Peritoneal Crisis'
    | 'Pancreatic Syndrome'
    | 'Systemic Septic Syndrome'
    | 'Toxicologic GI Syndrome'
    | 'Respiratory Syndrome'
    | 'Cardiovascular Syndrome'
    | 'Endocrine Metabolic Syndrome'
    | 'Haematologic Syndrome'
    | 'Unknown';

export const SYNDROME_CONDITION_MAP: Record<SyndromeFamily, string[]> = {
    'Acute Hemorrhagic Colitis': [
        'clostridial_enterotoxicosis', 'acute_hemorrhagic_diarrhea_syndrome',
        'infectious_colitis', 'dietary_enterocolitis',
    ],
    'Large Bowel Inflammatory Syndrome': [
        'clostridial_enterotoxicosis', 'infectious_colitis',
        'dietary_enterocolitis', 'acute_hemorrhagic_diarrhea_syndrome',
    ],
    'Small Bowel Enteropathy': [
        'parvoviral_enteritis', 'protein_losing_enteropathy',
        'hookworm_infection', 'toxocariasis',
    ],
    'Obstructive GI Disease': [
        'intestinal_obstruction', 'gastric_dilatation_volvulus', 'mesenteric_volvulus',
    ],
    'Peritoneal Crisis': [
        'septic_peritonitis', 'mesenteric_volvulus', 'gastric_dilatation_volvulus',
    ],
    'Pancreatic Syndrome': ['acute_pancreatitis'],
    'Systemic Septic Syndrome': [
        'septic_peritonitis', 'leptospirosis', 'ehrlichiosis_canine', 'babesiosis_canine',
    ],
    'Toxicologic GI Syndrome': [
        'clostridial_enterotoxicosis', 'dietary_enterocolitis',
    ],
    'Respiratory Syndrome': [
        'feline_upper_respiratory_complex', 'feline_herpesvirus_1_infection',
        'feline_calicivirus_infection', 'feline_bacterial_pneumonia',
        'dirofilariosis_canine', 'tracheal_collapse', 'laryngeal_paralysis',
    ],
    'Cardiovascular Syndrome': [
        'mitral_valve_disease_canine', 'dilated_cardiomyopathy_canine',
    ],
    'Endocrine Metabolic Syndrome': [
        'diabetes_mellitus_canine', 'hypothyroidism_canine',
        'hyperadrenocorticism_canine', 'hypoadrenocorticism_canine',
    ],
    'Haematologic Syndrome': [
        'babesiosis_canine', 'ehrlichiosis_canine', 'anaplasmosis_canine',
        'immune_mediated_hemolytic_anemia', 'lymphoma',
    ],
    'Unknown': [],
};

function normalizeSignal(s: string): string {
    return s.toLowerCase().replace(/[\s\-]/g, '_');
}

export function routeSyndrome(signals: string[]): SyndromeFamily {
    const norm = new Set(signals.map(normalizeSignal));

    const hasLargeBowelHemorrhage =
        (norm.has('hematochezia') || norm.has('bloody_diarrhea') || norm.has('fresh_blood_diarrhea')) &&
        (norm.has('mucus_in_stool') || norm.has('mucus_stool') || norm.has('tenesmus'));

    const hasTier1LargeBowel =
        norm.has('clostridium_enterotoxin_elisa_positive') ||
        norm.has('clostridium_enterotoxin_positive') ||
        norm.has('fecal_gram_positive_rods') ||
        norm.has('gram_positive_rods_fecal_cytology');

    const hasPeritonealCrisis =
        norm.has('peritoneal_signs') ||
        norm.has('abdominal_guarding') ||
        (norm.has('shock') && norm.has('abdominal_distension'));

    const hasPancreatic =
        norm.has('cranial_abdominal_pain') ||
        norm.has('spec_cpl_elevated') ||
        norm.has('elevated_lipase');

    const hasSpoiledFood =
        norm.has('spoiled_meat_ingestion') ||
        norm.has('dietary_indiscretion');

    // Priority: Tier-1 lab confirmations > anatomical pattern > general
    if (hasTier1LargeBowel && hasLargeBowelHemorrhage) return 'Acute Hemorrhagic Colitis';
    if (hasTier1LargeBowel || (hasSpoiledFood && hasLargeBowelHemorrhage)) return 'Toxicologic GI Syndrome';
    if (hasLargeBowelHemorrhage) return 'Large Bowel Inflammatory Syndrome';
    if (hasPeritonealCrisis) return 'Peritoneal Crisis';
    if (hasPancreatic) return 'Pancreatic Syndrome';

    return 'Unknown';
}

const CONFLICTING_SYNDROMES: Partial<Record<SyndromeFamily, SyndromeFamily[]>> = {
    'Acute Hemorrhagic Colitis':        ['Peritoneal Crisis', 'Obstructive GI Disease', 'Pancreatic Syndrome'],
    'Large Bowel Inflammatory Syndrome':['Peritoneal Crisis', 'Obstructive GI Disease'],
    'Toxicologic GI Syndrome':          ['Peritoneal Crisis', 'Systemic Septic Syndrome'],
    'Peritoneal Crisis':                ['Acute Hemorrhagic Colitis', 'Large Bowel Inflammatory Syndrome'],
    'Pancreatic Syndrome':              ['Acute Hemorrhagic Colitis', 'Large Bowel Inflammatory Syndrome'],
};

export function getSyndromeMultiplier(conditionId: string, syndrome: SyndromeFamily): number {
    if (syndrome === 'Unknown') return 1.0;

    const familyConditions = SYNDROME_CONDITION_MAP[syndrome] ?? [];
    if (familyConditions.includes(conditionId)) return 1.30;

    // Check conflicting syndromes — hard suppression
    const conflicting = CONFLICTING_SYNDROMES[syndrome] ?? [];
    for (const conflict of conflicting) {
        if ((SYNDROME_CONDITION_MAP[conflict] ?? []).includes(conditionId)) {
            return 0.25;
        }
    }

    return 0.70; // moderate suppression for out-of-family, non-conflicting
}
