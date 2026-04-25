/**
 * Anatomical Localization Engine — Layer 1 of the 4-layer clinical reasoning pipeline.
 *
 * Classifies the anatomical region of disease from presenting signals and
 * diagnostic test results BEFORE differential ranking. This prevents nonspecific
 * emergency conditions (GDV, mesenteric volvulus) from outranking clearly
 * localized, evidence-confirmed diagnoses (clostridial enterotoxicosis, AHDS).
 *
 * References: Radostits et al. Veterinary Medicine 11th ed.; WSAVA Global Guidelines
 */

export type AnatomicalRegion =
    | 'GI_large_bowel'
    | 'GI_small_bowel'
    | 'hepatobiliary'
    | 'pancreatic'
    | 'peritoneal'
    | 'urologic'
    | 'systemic_inflammatory'
    | 'toxicologic'
    | 'endocrine'
    | 'cardiovascular'
    | 'respiratory';

export interface LocalizationResult {
    primary: AnatomicalRegion;
    scores: Partial<Record<AnatomicalRegion, number>>;
    confidence: number;
}

const LARGE_BOWEL_SIGNALS = new Set([
    'hematochezia', 'mucus_in_stool', 'mucus_stool', 'tenesmus',
    'increased_defecation_frequency', 'small_stool_volume', 'colitis',
    'bloody_diarrhea', 'fresh_blood_diarrhea', 'large_bowel_diarrhea',
    'straining_to_defecate', 'increased_urgency',
]);

const SMALL_BOWEL_SIGNALS = new Set([
    'melena', 'weight_loss', 'large_stool_volume', 'malabsorption',
    'steatorrhea', 'chronic_vomiting', 'small_bowel_diarrhea',
    'protein_losing', 'hypoalbuminemia',
]);

const PERITONEAL_SIGNALS = new Set([
    'peritoneal_signs', 'abdominal_guarding', 'shock', 'collapse',
    'severe_diffuse_pain', 'board_like_abdomen', 'free_fluid', 'free_gas',
    'splinting', 'rebound_tenderness',
]);

const PANCREATIC_SIGNALS = new Set([
    'cranial_abdominal_pain', 'elevated_lipase', 'fat_intolerance',
    'spec_cpl_elevated', 'pancreatic_enlargement', 'hypocalcemia',
]);

const SYSTEMIC_SIGNALS = new Set([
    'fever', 'lymphadenopathy', 'polyuria_polydipsia', 'jaundice',
    'petechiae', 'epistaxis', 'edema', 'generalised_weakness',
]);

// Tier-1 diagnostic confirmations — hard-lock localization
const TIER1_CONFIRMATIONS: Array<{ pattern: string; region: AnatomicalRegion; boost: number }> = [
    { pattern: 'clostridium_enterotoxin_elisa_positive', region: 'GI_large_bowel', boost: 0.45 },
    { pattern: 'clostridium_enterotoxin_positive',       region: 'GI_large_bowel', boost: 0.45 },
    { pattern: 'fecal_gram_positive_rods',               region: 'GI_large_bowel', boost: 0.38 },
    { pattern: 'gram_positive_rods_fecal_cytology',      region: 'GI_large_bowel', boost: 0.38 },
    { pattern: 'spec_cpl_elevated',                      region: 'pancreatic',     boost: 0.40 },
    { pattern: 'abdominocentesis_septic_exudate',        region: 'peritoneal',     boost: 0.50 },
    { pattern: 'whirlpool_sign',                         region: 'peritoneal',     boost: 0.45 },
    { pattern: 'parvovirus_antigen_positive',            region: 'GI_small_bowel', boost: 0.42 },
    { pattern: 'fecal_flotation_hookworm',               region: 'GI_small_bowel', boost: 0.35 },
    { pattern: 'fecal_flotation_toxocara',               region: 'GI_small_bowel', boost: 0.35 },
];

function normalizeSignal(s: string): string {
    return s.toLowerCase().replace(/[\s\-]/g, '_');
}

export function computeAnatomicalLocalization(signals: string[]): LocalizationResult {
    const normalized = signals.map(normalizeSignal);
    const scores: Partial<Record<AnatomicalRegion, number>> = {};

    const addScore = (region: AnatomicalRegion, amount: number) => {
        scores[region] = Math.min(0.99, (scores[region] ?? 0) + amount);
    };

    // Tier-1 confirmations first — highest weight
    for (const sig of normalized) {
        for (const { pattern, region, boost } of TIER1_CONFIRMATIONS) {
            if (sig.includes(pattern) || pattern.includes(sig)) {
                addScore(region, boost);
            }
        }
    }

    // Signal-based scoring
    for (const sig of normalized) {
        if (LARGE_BOWEL_SIGNALS.has(sig)) addScore('GI_large_bowel', 0.15);
        if (SMALL_BOWEL_SIGNALS.has(sig))  addScore('GI_small_bowel', 0.12);
        if (PERITONEAL_SIGNALS.has(sig))   addScore('peritoneal',     0.20);
        if (PANCREATIC_SIGNALS.has(sig))   addScore('pancreatic',     0.18);
        if (SYSTEMIC_SIGNALS.has(sig))     addScore('systemic_inflammatory', 0.08);
    }

    // Find primary region
    let primary: AnatomicalRegion = 'GI_large_bowel';
    let maxScore = 0;
    for (const [region, score] of Object.entries(scores) as [AnatomicalRegion, number][]) {
        if (score > maxScore) { maxScore = score; primary = region; }
    }

    return { primary, scores, confidence: Math.min(0.99, maxScore) };
}

const REGION_CONDITION_MAP: Record<string, AnatomicalRegion[]> = {
    'clostridial_enterotoxicosis':          ['GI_large_bowel', 'toxicologic'],
    'acute_hemorrhagic_diarrhea_syndrome':  ['GI_large_bowel'],
    'infectious_colitis':                   ['GI_large_bowel'],
    'dietary_enterocolitis':                ['GI_large_bowel'],
    'parvoviral_enteritis':                 ['GI_small_bowel'],
    'protein_losing_enteropathy':           ['GI_small_bowel'],
    'hookworm_infection':                   ['GI_small_bowel'],
    'toxocariasis':                         ['GI_small_bowel'],
    'septic_peritonitis':                   ['peritoneal'],
    'mesenteric_volvulus':                  ['peritoneal'],
    'intestinal_obstruction':               ['GI_small_bowel', 'peritoneal'],
    'gastric_dilatation_volvulus':          ['peritoneal'],
    'acute_pancreatitis':                   ['pancreatic'],
    'leptospirosis':                        ['systemic_inflammatory'],
    'babesiosis_canine':                    ['systemic_inflammatory'],
    'ehrlichiosis_canine':                  ['systemic_inflammatory'],
};

export function getLocalizationMultiplier(
    conditionId: string,
    localization: LocalizationResult,
): number {
    const conditionRegions = REGION_CONDITION_MAP[conditionId];
    if (!conditionRegions) return 1.0;

    const primaryScore = localization.scores[localization.primary] ?? 0;
    const isInPrimaryRegion = conditionRegions.includes(localization.primary);

    if (isInPrimaryRegion && primaryScore > 0.5) {
        return 1.0 + (primaryScore * 0.5); // up to 1.5x boost
    }

    const bestRegionScore = conditionRegions.reduce(
        (best, region) => Math.max(best, localization.scores[region] ?? 0), 0
    );

    if (bestRegionScore < 0.10 && primaryScore > 0.4) {
        return 0.30; // 70% suppression — condition region has no evidence
    }

    return 0.70 + (bestRegionScore * 0.30);
}
