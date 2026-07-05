import type { ScoreAdjustment } from './haematological-priors';
import type { InferenceRequest } from './types';

const TARGET_SPECIES = new Set(['avian', 'reptile', 'exotic']);

export function applyAvianReptileExoticPriors(request: InferenceRequest): ScoreAdjustment[] {
    const species = normalizeSpeciesName(request.species);
    if (!TARGET_SPECIES.has(species)) return [];

    const diagnosticTests = request.diagnostic_tests ?? {};
    const adjustments: ScoreAdjustment[] = [];
    const pcr = diagnosticTests.pcr ?? {};

    if (species === 'avian') {
        if (pcr.chlamydia_psittaci_pcr === 'positive') {
            adjustments.push({ condition_id: 'avian_chlamydiosis', delta: 0.46, finding: 'Positive Chlamydia psittaci PCR', weight: 'definitive', determination_basis: 'pathognomonic_test' });
        }
        if (pcr.avian_influenza_pcr === 'positive') {
            adjustments.push({ condition_id: 'avian_influenza_alert', delta: 0.54, finding: 'Positive avian influenza PCR', weight: 'definitive', determination_basis: 'pathognomonic_test' });
        }
        if (pcr.aspergillus_pcr === 'positive') {
            adjustments.push({ condition_id: 'avian_aspergillosis', delta: 0.40, finding: 'Positive Aspergillus PCR', weight: 'definitive', determination_basis: 'pathognomonic_test' });
        }
    }

    if (species === 'reptile') {
        if (diagnosticTests.biochemistry?.calcium === 'low' || diagnosticTests.biochemistry?.calcium === 'hypocalcemia') {
            adjustments.push({ condition_id: 'reptile_metabolic_bone_disease', delta: 0.30, finding: 'Low calcium supports reptile metabolic bone disease', weight: 'strong', determination_basis: 'pathognomonic_test' });
        }
        if (diagnosticTests.biochemistry?.phosphorus === 'elevated') {
            adjustments.push({ condition_id: 'reptile_metabolic_bone_disease', delta: 0.12, finding: 'Elevated phosphorus supports calcium-phosphorus imbalance', weight: 'supportive' });
        }
        if (pcr.salmonella_pcr === 'positive' || pcr.herpesvirus_pcr === 'positive') {
            adjustments.push({ condition_id: 'reptile_infectious_stomatitis_septicemia', delta: 0.20, finding: 'Positive reptile-relevant infectious PCR', weight: 'supportive' });
        }
    }

    const cbc = diagnosticTests.cbc;
    if (species === 'avian' && typeof cbc?.heterophil_lymphocyte_ratio === 'number' && cbc.heterophil_lymphocyte_ratio >= 1.5) {
        adjustments.push(
            { condition_id: 'avian_aspergillosis', delta: 0.12, finding: `High avian H:L ratio (${cbc.heterophil_lymphocyte_ratio})`, weight: 'supportive' },
            { condition_id: 'avian_chlamydiosis', delta: 0.08, finding: `High avian H:L ratio (${cbc.heterophil_lymphocyte_ratio})`, weight: 'minor' },
        );
    }
    if (species === 'avian' && cbc?.thrombocytes === 'low') {
        adjustments.push({ condition_id: 'avian_influenza_alert', delta: 0.08, finding: 'Low thrombocytes adds avian viral alert pressure when compatible signs exist', weight: 'minor' });
    }

    const cytology = diagnosticTests.cytology;
    if (species === 'avian' && cytology?.heterophils === 'elevated') {
        adjustments.push(
            { condition_id: 'avian_aspergillosis', delta: 0.12, finding: 'Elevated heterophils on avian/reptile cytology', weight: 'supportive' },
            { condition_id: 'avian_chlamydiosis', delta: 0.08, finding: 'Elevated heterophils on avian/reptile cytology', weight: 'minor' },
        );
    }
    if (cytology?.toxic_changes === 'present') {
        if (species === 'reptile') {
            adjustments.push({ condition_id: 'reptile_infectious_stomatitis_septicemia', delta: 0.18, finding: 'Toxic inflammatory changes on reptile cytology', weight: 'supportive' });
        }
        if (species === 'avian') {
            adjustments.push({ condition_id: 'avian_aspergillosis', delta: 0.08, finding: 'Toxic inflammatory changes support active avian inflammation', weight: 'minor' });
        }
    }

    const microbiology = diagnosticTests.microbiology;
    if (microbiology?.growth === 'moderate' || microbiology?.growth === 'heavy') {
        if (species === 'reptile') {
            adjustments.push({ condition_id: 'reptile_infectious_stomatitis_septicemia', delta: microbiology.growth === 'heavy' ? 0.18 : 0.12, finding: `${microbiology.growth} bacterial culture growth`, weight: 'supportive' });
        }
        if (species === 'avian') {
            adjustments.push({ condition_id: 'avian_chlamydiosis', delta: 0.06, finding: `${microbiology.growth} bacterial culture growth keeps bacterial disease in the avian differential`, weight: 'minor' });
        }
    }

    if (species === 'exotic') {
        const signs = collectSigns(request);
        if (signs.includes('reduced_feces') || signs.includes('small_feces') || signs.includes('no_feces')) {
            adjustments.push({ condition_id: 'exotic_small_mammal_gi_stasis', delta: 0.24, finding: 'Reduced fecal output supports exotic small mammal GI stasis', weight: 'supportive', determination_basis: 'syndrome_pattern' });
        }
        if (signs.includes('anorexia')) {
            adjustments.push({ condition_id: 'exotic_small_mammal_gi_stasis', delta: 0.12, finding: 'Anorexia is load-bearing for exotic small mammal GI stasis', weight: 'supportive' });
        }
    }

    return adjustments;
}

function normalizeSpeciesName(species: string | null | undefined): string {
    const normalized = String(species ?? '').trim().toLowerCase();
    if (normalized.startsWith('avi') || normalized === 'bird' || normalized === 'birds') return 'avian';
    if (normalized.startsWith('rep') || normalized === 'snake' || normalized === 'lizard' || normalized === 'chelonian' || normalized === 'turtle' || normalized === 'tortoise') return 'reptile';
    if (normalized.startsWith('exo') || normalized === 'rabbit' || normalized === 'ferret' || normalized === 'guinea_pig' || normalized === 'guinea pig') return 'exotic';
    return normalized;
}

function collectSigns(request: InferenceRequest): string[] {
    return [
        ...(request.presenting_signs ?? []),
        ...(request.symptom_vector ?? []),
        ...(request.history?.owner_observations ?? []),
    ].map((entry) => String(entry).trim().toLowerCase().replace(/\s+/g, '_'));
}
