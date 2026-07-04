import type { ScoreAdjustment } from './haematological-priors';
import type { InferenceRequest } from './types';

export function applyEquinePriors(request: InferenceRequest): ScoreAdjustment[] {
    if (!isEquine(request.species)) return [];

    const diagnosticTests = request.diagnostic_tests ?? {};
    const adjustments: ScoreAdjustment[] = [];

    const biochemistry = diagnosticTests.biochemistry;
    if (biochemistry) {
        const saaElevated = biochemistry.saa_level === 'elevated'
            || (typeof biochemistry.saa_value === 'number' && biochemistry.saa_value >= 50);
        if (saaElevated) {
            adjustments.push(
                { condition_id: 'equine_pleuropneumonia', delta: 0.12, finding: 'Elevated serum amyloid A supports active equine inflammation', weight: 'supportive' },
                { condition_id: 'equine_septic_peritonitis', delta: 0.12, finding: 'Elevated serum amyloid A supports active equine inflammation', weight: 'supportive' },
                { condition_id: 'equine_strangles', delta: 0.08, finding: 'Elevated serum amyloid A supports infectious upper-airway disease context', weight: 'minor' },
                { condition_id: 'equine_colic_strangulating', delta: 0.08, finding: 'Elevated serum amyloid A increases concern for inflammatory or ischemic colic complication', weight: 'minor' },
            );
        }
    }

    const serology = diagnosticTests.serology;
    if (serology?.coggins_result === 'positive') {
        adjustments.push({
            condition_id: 'equine_infectious_anemia',
            delta: 0.48,
            finding: 'Positive Coggins/EIA serology',
            weight: 'definitive',
            determination_basis: 'pathognomonic_test',
        });
    }
    if (serology?.coggins_result === 'negative') {
        adjustments.push({
            condition_id: 'equine_infectious_anemia',
            delta: -0.22,
            finding: 'Negative Coggins/EIA serology lowers EIA probability',
            weight: 'weakens',
            penalty: true,
        });
    }

    const cytology = diagnosticTests.cytology;
    if (cytology?.abdominal_fluid_bacteria === 'present') {
        adjustments.push({
            condition_id: 'equine_septic_peritonitis',
            delta: 0.46,
            finding: 'Intracellular bacteria in abdominal fluid',
            weight: 'definitive',
            determination_basis: 'pathognomonic_test',
        });
    }
    if (cytology?.septic_exudate === 'present') {
        adjustments.push(
            {
                condition_id: 'equine_septic_peritonitis',
                delta: 0.30,
                finding: 'Septic exudate on effusion analysis',
                weight: 'strong',
            },
            {
                condition_id: 'equine_pleuropneumonia',
                delta: 0.20,
                finding: 'Septic exudate keeps pleural infection high if respiratory imaging supports it',
                weight: 'supportive',
            },
        );
    }

    const thoracic = diagnosticTests.thoracic_radiograph;
    if (thoracic?.pleural_effusion === 'present') {
        adjustments.push({
            condition_id: 'equine_pleuropneumonia',
            delta: 0.24,
            finding: 'Pleural effusion on thoracic imaging',
            weight: 'strong',
        });
    }
    if (thoracic?.pulmonary_infiltrates === 'present' || thoracic?.pulmonary_pattern === 'alveolar') {
        adjustments.push({
            condition_id: 'equine_pleuropneumonia',
            delta: 0.18,
            finding: 'Pulmonary infiltrates or alveolar pattern on thoracic imaging',
            weight: 'supportive',
        });
    }

    const abdominal = diagnosticTests.abdominal_ultrasound;
    if (abdominal?.free_fluid === 'present' || abdominal?.ascites === 'present') {
        adjustments.push(
            { condition_id: 'equine_septic_peritonitis', delta: 0.18, finding: 'Abdominal free fluid', weight: 'supportive' },
            { condition_id: 'equine_colic_strangulating', delta: 0.12, finding: 'Abdominal free fluid increases surgical colic concern', weight: 'minor' },
        );
    }

    const pcr = diagnosticTests.pcr ?? {};
    if (pcr.strep_equi_pcr === 'positive') {
        adjustments.push({
            condition_id: 'equine_strangles',
            delta: 0.44,
            finding: 'Positive Strep equi PCR',
            weight: 'definitive',
            determination_basis: 'pathognomonic_test',
        });
    }

    const microbiology = diagnosticTests.microbiology;
    const organismText = arrayText(microbiology?.organism);
    if (organismText.includes('streptococcus equi') || organismText.includes('strep equi')) {
        adjustments.push({
            condition_id: 'equine_strangles',
            delta: 0.28,
            finding: 'Streptococcus equi identified on culture',
            weight: 'strong',
        });
    }
    if (microbiology?.growth === 'moderate' || microbiology?.growth === 'heavy') {
        adjustments.push(
            { condition_id: 'equine_pleuropneumonia', delta: microbiology.growth === 'heavy' ? 0.16 : 0.10, finding: `${microbiology.growth} bacterial culture growth`, weight: 'supportive' },
            { condition_id: 'equine_septic_peritonitis', delta: microbiology.growth === 'heavy' ? 0.16 : 0.10, finding: `${microbiology.growth} bacterial culture growth`, weight: 'supportive' },
        );
    }

    return adjustments;
}

function isEquine(species: string | null | undefined): boolean {
    const normalized = String(species ?? '').trim().toLowerCase();
    return normalized === 'equine' || normalized === 'horse' || normalized.startsWith('equ');
}

function arrayText(value: unknown): string {
    if (Array.isArray(value)) return value.map((entry) => String(entry).toLowerCase()).join(' ');
    return String(value ?? '').toLowerCase();
}
