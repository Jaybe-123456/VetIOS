import type { ScoreAdjustment } from './haematological-priors';
import type { InferenceRequest } from './types';

const RUMINANT_SPECIES = new Set(['bovine', 'ovine', 'caprine']);

export function applyRuminantPriors(request: InferenceRequest): ScoreAdjustment[] {
    if (!RUMINANT_SPECIES.has(normalizeSpeciesName(request.species))) return [];

    const diagnosticTests = request.diagnostic_tests ?? {};
    const adjustments: ScoreAdjustment[] = [];

    const biochemistry = diagnosticTests.biochemistry;
    if (biochemistry) {
        if (isElevated(biochemistry.bhba)) {
            adjustments.push({
                condition_id: 'bovine_ketosis',
                delta: 0.38,
                finding: 'Elevated BHBA on ruminant metabolic panel',
                weight: 'strong',
                determination_basis: 'pathognomonic_test',
            });
        }
        if (isElevated(biochemistry.nefa)) {
            adjustments.push({
                condition_id: 'bovine_ketosis',
                delta: 0.16,
                finding: 'Elevated NEFA supports negative energy balance',
                weight: 'supportive',
            });
        }
        if (biochemistry.glucose === 'hypoglycemia') {
            adjustments.push(
                {
                    condition_id: 'bovine_ketosis',
                    delta: 0.12,
                    finding: 'Hypoglycaemia supports bovine ketosis in a ruminant metabolic context',
                    weight: 'supportive',
                },
                {
                    condition_id: 'neonatal_calf_enteritis',
                    delta: 0.08,
                    finding: 'Hypoglycaemia raises neonatal enteritis or sepsis risk when age context fits',
                    weight: 'minor',
                },
            );
        }
        if (isLowCalcium(biochemistry.calcium)) {
            adjustments.push({
                condition_id: 'ruminant_hypocalcemia',
                delta: 0.34,
                finding: 'Low serum calcium on ruminant metabolic panel',
                weight: 'strong',
                determination_basis: 'pathognomonic_test',
            });
        }
        if (isLow(biochemistry.magnesium) || isLow(biochemistry.phosphorus)) {
            adjustments.push({
                condition_id: 'ruminant_hypocalcemia',
                delta: 0.08,
                finding: 'Concurrent mineral derangement supports periparturient metabolic disease',
                weight: 'supportive',
            });
        }
        if (typeof biochemistry.rumen_ph === 'number' && biochemistry.rumen_ph < 5.8) {
            adjustments.push({
                condition_id: 'ruminal_acidosis',
                delta: biochemistry.rumen_ph < 5.2 ? 0.38 : 0.24,
                finding: `Low rumen pH (${biochemistry.rumen_ph})`,
                weight: biochemistry.rumen_ph < 5.2 ? 'strong' : 'supportive',
                determination_basis: 'syndrome_pattern',
            });
        }
        if (typeof biochemistry.total_protein === 'number' && biochemistry.total_protein < 5.5) {
            adjustments.push({
                condition_id: 'neonatal_calf_enteritis',
                delta: 0.12,
                finding: 'Low neonatal serum total protein suggests failed passive transfer risk',
                weight: 'supportive',
            });
        }
    }

    const cbc = diagnosticTests.cbc;
    if (cbc) {
        if (typeof cbc.packed_cell_volume_percent === 'number' && cbc.packed_cell_volume_percent < 24) {
            adjustments.push(
                { condition_id: 'bovine_anaplasmosis', delta: 0.12, finding: 'Anaemia on ruminant haematology panel', weight: 'supportive' },
                { condition_id: 'bovine_theileriosis', delta: 0.10, finding: 'Anaemia on ruminant haematology panel', weight: 'supportive' },
                { condition_id: 'trypanosomiasis', delta: 0.08, finding: 'Anaemia on ruminant haematology panel', weight: 'supportive' },
                { condition_id: 'ruminant_parasitic_gastroenteritis', delta: 0.08, finding: 'Anaemia can reflect GI parasite burden in ruminants', weight: 'minor' },
            );
        }
        const hemoparasites = arrayText(cbc.hemoparasites_seen);
        if (hemoparasites.includes('theileria')) {
            adjustments.push({ condition_id: 'bovine_theileriosis', delta: 0.26, finding: 'Theileria-like haemoparasites seen', weight: 'strong' });
        }
        if (hemoparasites.includes('anaplasma')) {
            adjustments.push({ condition_id: 'bovine_anaplasmosis', delta: 0.24, finding: 'Anaplasma-like inclusions seen', weight: 'strong' });
        }
        if (hemoparasites.includes('trypanosoma')) {
            adjustments.push({ condition_id: 'trypanosomiasis', delta: 0.24, finding: 'Trypanosoma-like organisms seen', weight: 'strong' });
        }
        if (isLow(cbc.igg_transfer_status)) {
            adjustments.push({
                condition_id: 'neonatal_calf_enteritis',
                delta: 0.14,
                finding: 'Low IgG/passive transfer status increases neonatal enteritis vulnerability',
                weight: 'supportive',
            });
        }
        if (isSevere(cbc.dehydration_severity)) {
            adjustments.push({
                condition_id: 'neonatal_calf_enteritis',
                delta: 0.08,
                finding: 'Severe dehydration supports neonatal enteritis severity',
                weight: 'minor',
            });
        }
    }

    const serology = diagnosticTests.serology;
    if (serology) {
        if (isPositive(serology.bvd_antigen)) {
            adjustments.push({ condition_id: 'bovine_viral_diarrhea', delta: 0.36, finding: 'Positive BVD antigen', weight: 'strong', determination_basis: 'pathognomonic_test' });
        }
        if (isPositive(serology.johnes_elisa)) {
            adjustments.push({ condition_id: 'johnes_disease_ruminant', delta: 0.30, finding: 'Positive Johne ELISA', weight: 'strong', determination_basis: 'pathognomonic_test' });
        }
        if (isPositive(serology.fmd_screen)) {
            adjustments.push({ condition_id: 'foot_and_mouth_disease', delta: 0.34, finding: 'Positive FMD screen', weight: 'strong', determination_basis: 'pathognomonic_test' });
        }
        if (isPositive(serology.theileria_screen)) {
            adjustments.push({ condition_id: 'bovine_theileriosis', delta: 0.22, finding: 'Positive Theileria screen', weight: 'strong' });
        }
        if (isPositive(serology.cryptosporidium) || isPositive(serology.e_coli_k99) || isPositive(serology.rotavirus_coronavirus)) {
            adjustments.push({
                condition_id: 'neonatal_calf_enteritis',
                delta: 0.24,
                finding: 'Positive neonatal enteric pathogen screen',
                weight: 'strong',
                determination_basis: 'pathognomonic_test',
            });
        }
        if (isNegative(serology.bvd_antigen)) {
            adjustments.push({
                condition_id: 'bovine_viral_diarrhea',
                delta: -0.12,
                finding: 'Negative BVD antigen lowers immediate BVD probability',
                weight: 'weakens',
                penalty: true,
            });
        }
    }

    const pcr = diagnosticTests.pcr ?? {};
    if (isPositive(pcr.bvd_pcr)) {
        adjustments.push({ condition_id: 'bovine_viral_diarrhea', delta: 0.42, finding: 'Positive BVD PCR', weight: 'definitive', determination_basis: 'pathognomonic_test' });
    }
    if (isPositive(pcr.lumpy_skin_disease_pcr)) {
        adjustments.push({ condition_id: 'lumpy_skin_disease_bovine', delta: 0.46, finding: 'Positive lumpy skin disease PCR', weight: 'definitive', determination_basis: 'pathognomonic_test' });
    }
    if (isPositive(pcr.theileria_pcr)) {
        adjustments.push({ condition_id: 'bovine_theileriosis', delta: 0.40, finding: 'Positive Theileria PCR', weight: 'definitive', determination_basis: 'pathognomonic_test' });
    }
    if (isPositive(pcr.anaplasma_marginale_pcr)) {
        adjustments.push({ condition_id: 'bovine_anaplasmosis', delta: 0.40, finding: 'Positive Anaplasma marginale PCR', weight: 'definitive', determination_basis: 'pathognomonic_test' });
    }
    if (isPositive(pcr.mycoplasma_bovis_pcr)) {
        adjustments.push({ condition_id: 'ruminant_mastitis', delta: 0.16, finding: 'Positive Mycoplasma bovis PCR supports herd mastitis or respiratory complex correlation', weight: 'supportive' });
    }

    const cytology = diagnosticTests.cytology;
    if (cytology) {
        if (isPositive(cytology.california_mastitis_test)) {
            adjustments.push({ condition_id: 'ruminant_mastitis', delta: 0.28, finding: 'Positive California Mastitis Test', weight: 'strong' });
        }
        if (cytology.milk_culture_growth === 'present') {
            adjustments.push({ condition_id: 'ruminant_mastitis', delta: 0.32, finding: 'Milk culture growth present', weight: 'strong', determination_basis: 'pathognomonic_test' });
        }
        if (typeof cytology.somatic_cell_count === 'number' && cytology.somatic_cell_count >= 200000) {
            adjustments.push({
                condition_id: 'ruminant_mastitis',
                delta: cytology.somatic_cell_count >= 500000 ? 0.20 : 0.12,
                finding: `Elevated somatic cell count (${cytology.somatic_cell_count})`,
                weight: cytology.somatic_cell_count >= 500000 ? 'strong' : 'supportive',
            });
        }
        if (typeof cytology.bulk_tank_scc === 'number' && cytology.bulk_tank_scc >= 200000) {
            adjustments.push({
                condition_id: 'ruminant_mastitis',
                delta: 0.12,
                finding: `Elevated bulk tank SCC (${cytology.bulk_tank_scc})`,
                weight: 'supportive',
            });
        }
        if (arrayText(cytology.organism).length > 0) {
            adjustments.push({
                condition_id: 'ruminant_mastitis',
                delta: 0.14,
                finding: `Milk organism identified: ${cytology.organism?.join(', ')}`,
                weight: 'supportive',
            });
        }
    }

    const parasitology = diagnosticTests.parasitology;
    if (parasitology) {
        if (typeof parasitology.fecal_egg_count === 'number' && parasitology.fecal_egg_count >= 500) {
            adjustments.push({
                condition_id: 'ruminant_parasitic_gastroenteritis',
                delta: parasitology.fecal_egg_count >= 1000 ? 0.26 : 0.18,
                finding: `Elevated fecal egg count (${parasitology.fecal_egg_count} EPG)`,
                weight: parasitology.fecal_egg_count >= 1000 ? 'strong' : 'supportive',
            });
        }
        if (isPositive(parasitology.liver_fluke) || isPositive(parasitology.lungworm_baermann)) {
            adjustments.push({
                condition_id: 'ruminant_parasitic_gastroenteritis',
                delta: 0.18,
                finding: 'Positive ruminant parasite screen',
                weight: 'supportive',
            });
        }
        if (arrayText(parasitology.fecal_flotation).includes('coccidia')) {
            adjustments.push({
                condition_id: 'neonatal_calf_enteritis',
                delta: 0.10,
                finding: 'Coccidia detected on fecal testing',
                weight: 'supportive',
            });
        }
        if (isSevere(parasitology.haemonchus_risk)) {
            adjustments.push({
                condition_id: 'ruminant_parasitic_gastroenteritis',
                delta: 0.18,
                finding: 'High Haemonchus/FAMACHA risk',
                weight: 'supportive',
            });
        }
    }

    const abdominal = diagnosticTests.abdominal_ultrasound;
    if (abdominal?.forestomach_motility === 'low') {
        adjustments.push(
            { condition_id: 'ruminal_acidosis', delta: 0.08, finding: 'Reduced forestomach motility', weight: 'minor' },
            { condition_id: 'ruminant_hypocalcemia', delta: 0.06, finding: 'Reduced forestomach motility can accompany metabolic disease', weight: 'minor' },
        );
    }
    if (abdominal?.left_displaced_abomasum_ping === 'present' || abdominal?.right_abdominal_ping === 'present') {
        adjustments.push({ condition_id: 'bovine_ketosis', delta: 0.08, finding: 'Abdominal ping can co-occur with transition cow metabolic disease', weight: 'minor' });
    }

    return adjustments;
}

function normalizeSpeciesName(species: string | null | undefined): string {
    const normalized = String(species ?? '').trim().toLowerCase();
    if (normalized.startsWith('bov') || normalized === 'cow' || normalized === 'cattle') return 'bovine';
    if (normalized.startsWith('ovi') || normalized === 'sheep') return 'ovine';
    if (normalized.startsWith('cap') || normalized === 'goat') return 'caprine';
    return normalized;
}

function isPositive(value: unknown): boolean {
    return value === 'positive' || value === 'present' || value === true;
}

function isNegative(value: unknown): boolean {
    return value === 'negative' || value === 'absent' || value === false;
}

function isElevated(value: unknown): boolean {
    return value === 'elevated' || value === 'high' || value === 'hyperglycemia' || value === 'hypercalcemia';
}

function isLow(value: unknown): boolean {
    return value === 'low' || value === 'hypoglycemia' || value === 'hypocalcemia';
}

function isLowCalcium(value: unknown): boolean {
    return value === 'low' || value === 'hypocalcemia';
}

function isSevere(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return ['high', 'severe', 'critical'].some((needle) => value.toLowerCase().includes(needle));
}

function arrayText(value: unknown): string {
    if (Array.isArray(value)) return value.map((entry) => String(entry).toLowerCase()).join(' ');
    return String(value ?? '').toLowerCase();
}
