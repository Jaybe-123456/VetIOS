import type { SystemPanel, TestValue } from '@vetios/inference-schema';
import type { DiagnosticTests } from './types';

type DiagnosticBucket = keyof DiagnosticTests;
type DiagnosticRecord = Record<string, unknown>;

interface CanonicalTestMapping {
    bucket: DiagnosticBucket;
    key: string;
    value?: unknown;
}

export function panelsToDiagnosticTests(panels: SystemPanel[]): DiagnosticTests {
    const diagnosticTests: DiagnosticRecord = {};

    for (const panel of panels) {
        for (const [key, value] of Object.entries(panel.tests)) {
            if (!isPopulatedPanelValue(value)) continue;

            const mappings = canonicalMappingsForPanelTest(panel, key, value);
            if (mappings.length === 0) {
                setDiagnosticValue(diagnosticTests, diagnosticBucketForPanel(panel), key, value);
                continue;
            }

            for (const mapping of mappings) {
                setDiagnosticValue(diagnosticTests, mapping.bucket, mapping.key, mapping.value ?? value);
            }
        }
    }

    return diagnosticTests as DiagnosticTests;
}

export function isPopulatedPanelValue(value: unknown): value is TestValue {
    if (value === 'not_done') return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    return value != null;
}

function setDiagnosticValue(
    diagnosticTests: DiagnosticRecord,
    bucket: DiagnosticBucket,
    key: string,
    value: unknown,
) {
    const existing = diagnosticTests[bucket];
    const existingRecord = typeof existing === 'object' && existing != null && !Array.isArray(existing)
        ? existing as DiagnosticRecord
        : {};
    const currentValue = existingRecord[key];
    diagnosticTests[bucket] = {
        ...existingRecord,
        [key]: mergeDiagnosticValue(currentValue, value),
    };
}

function mergeDiagnosticValue(currentValue: unknown, nextValue: unknown): unknown {
    if (Array.isArray(currentValue) && Array.isArray(nextValue)) return Array.from(new Set([...currentValue, ...nextValue]));
    if (Array.isArray(currentValue)) return Array.from(new Set([...currentValue, nextValue]));
    if (Array.isArray(nextValue)) return currentValue == null ? nextValue : Array.from(new Set([currentValue, ...nextValue]));
    return nextValue;
}

function diagnosticBucketForPanel(panel: SystemPanel): DiagnosticBucket {
    if (panel.panel === 'CBC') return 'cbc';
    if (panel.panel === 'ruminant_haematology' || panel.panel === 'neonatal_calf_panel') return 'cbc';
    if (panel.panel === 'ruminant_metabolic') return 'biochemistry';
    if (panel.panel === 'ruminant_rumen_abdominal') return 'abdominal_ultrasound';
    if (panel.panel === 'ruminant_mastitis_milk') return 'cytology';
    if (panel.panel === 'ruminant_pcr') return 'pcr';
    if (panel.panel === 'ruminant_parasitology') return 'parasitology';
    if (panel.panel === 'thoracic_radiograph') return 'thoracic_radiograph';
    if (panel.panel === 'abdominal_ultrasound') return 'abdominal_ultrasound';
    if (panel.panel === 'echocardiography') return 'echocardiography';
    if (panel.system === 'urinalysis') return 'urinalysis';
    if (panel.system === 'serology') return 'serology';
    if (panel.system === 'biochemistry') return 'biochemistry';
    if (panel.system === 'endocrine') return 'serology';
    if (panel.system === 'cytology') return 'cytology';
    if (panel.system === 'molecular') return 'pcr';
    if (panel.system === 'parasitology') return 'parasitology';
    return 'serology';
}

function canonicalMappingsForPanelTest(
    panel: SystemPanel,
    key: string,
    value: TestValue,
): CanonicalTestMapping[] {
    if (panel.panel === 'heartworm_antigen' && key === 'heartworm_antigen') {
        return [
            { bucket: 'serology', key: 'dirofilaria_immitis_antigen' },
            { bucket: 'serology', key: 'heartworm_antigen' },
        ];
    }

    if (panel.panel === 'heartworm_antigen' && key === 'microfilaremia') {
        return [{ bucket: 'cbc', key: 'microfilaremia' }];
    }

    if (panel.panel === 'tick_borne') {
        const tickMapping: Record<string, string> = {
            ehrlichia: 'ehrlichia_antibody',
            anaplasma: 'anaplasma_antibody',
            borrelia: 'borrelia_antibody',
        };
        if (tickMapping[key]) return [{ bucket: 'serology', key: tickMapping[key] }];
        if (key === 'babesia') return [{ bucket: 'cbc', key: 'hemoparasites_seen', value: value === 'positive' ? ['Babesia'] : value }];
    }

    if (panel.panel === 'infectious' && key === 'leishmania_serology') {
        return [
            { bucket: 'serology', key: 'leishmania_antibody' },
            { bucket: 'serology', key: 'leishmania_serology' },
        ];
    }

    if (panel.panel === 'ruminant_haematology') {
        if (key === 'haemoparasites_seen') return [{ bucket: 'cbc', key: 'hemoparasites_seen', value: splitPanelTextValue(value) }];
        return [{ bucket: 'cbc', key }];
    }

    if (panel.panel === 'ruminant_metabolic') {
        if (key === 'glucose') {
            if (value === 'elevated') return [{ bucket: 'biochemistry', key: 'glucose', value: 'hyperglycemia' }];
            if (value === 'low') return [{ bucket: 'biochemistry', key: 'glucose', value: 'hypoglycemia' }];
            if (value === 'normal') return [{ bucket: 'biochemistry', key: 'glucose', value: 'normal' }];
        }
        return [{ bucket: 'biochemistry', key }];
    }

    if (panel.panel === 'ruminant_herd_infectious') {
        if (key.endsWith('_pcr')) return [{ bucket: 'pcr', key, value: normalizeQualitativePcrValue(value) }];
        return [{ bucket: 'serology', key, value: normalizeQualitativeScreenValue(value) }];
    }

    if (panel.panel === 'ruminant_mastitis_milk') {
        return [{ bucket: 'cytology', key, value: key.includes('organism') || key.includes('susceptibility') || key.includes('gram') ? splitPanelTextValue(value) : value }];
    }

    if (panel.panel === 'ruminant_pcr') {
        return [{ bucket: 'pcr', key, value: normalizeQualitativePcrValue(value) }];
    }

    if (panel.panel === 'ruminant_parasitology') {
        if (key === 'coccidia_oocysts' && value === 'present') {
            return [{ bucket: 'parasitology', key: 'fecal_flotation', value: ['Coccidia'] }];
        }
        return [{ bucket: 'parasitology', key, value: splitPanelTextValue(value) }];
    }

    if (panel.panel === 'ruminant_rumen_abdominal') {
        return [{ bucket: key === 'rumen_ph' ? 'biochemistry' : 'abdominal_ultrasound', key }];
    }

    if (panel.panel === 'neonatal_calf_panel') {
        if (key === 'blood_glucose') {
            if (value === 'elevated') return [{ bucket: 'biochemistry', key: 'glucose', value: 'hyperglycemia' }];
            if (value === 'low') return [{ bucket: 'biochemistry', key: 'glucose', value: 'hypoglycemia' }];
            if (value === 'normal') return [{ bucket: 'biochemistry', key: 'glucose', value: 'normal' }];
        }
        if (key === 'serum_total_protein') return [{ bucket: 'biochemistry', key: 'total_protein' }];
        if (key === 'cryptosporidium' || key === 'rotavirus_coronavirus' || key === 'e_coli_k99') {
            return [{ bucket: 'serology', key, value: normalizeQualitativeScreenValue(value) }];
        }
        return [{ bucket: 'cbc', key }];
    }

    if (panel.panel === 'thyroid' && key === 'total_t4') {
        return [
            { bucket: 'serology', key: 'total_t4' },
            { bucket: 'serology', key: 't4_total' },
        ];
    }

    if (panel.panel === 'thyroid' && key === 'free_t4') {
        return [{ bucket: 'serology', key: 'free_t4' }];
    }

    if (panel.panel === 'adrenal' && key === 'acth_stimulation') {
        return [{ bucket: 'serology', key: 'acth_stimulation', value: normalizeActhValue(value) }];
    }

    if (panel.panel === 'adrenal' && key === 'sodium_potassium_ratio') {
        const normalizedRatio = normalizeSodiumPotassiumRatio(value);
        if (!normalizedRatio) return [];
        return [
            { bucket: 'serology', key: 'sodium_potassium_ratio', value: normalizedRatio },
            { bucket: 'biochemistry', key: 'sodium_potassium_ratio', value: normalizedRatio },
        ];
    }

    if (panel.panel === 'pancreatic' && key === 'pancreatic_lipase') {
        return [{ bucket: 'serology', key: 'pancreatic_lipase' }];
    }

    if ((panel.panel === 'renal' && (key === 'bun' || key === 'creatinine')) && value === 'elevated') {
        return [{ bucket: 'biochemistry', key: 'bun_creatinine', value: 'azotemia' }];
    }

    if ((panel.panel === 'renal' || panel.panel === 'hepatic') && key === 'albumin') {
        if (value === 'low') return [{ bucket: 'biochemistry', key: 'albumin', value: 'hypoalbuminemia' }];
        if (value === 'normal') return [{ bucket: 'biochemistry', key: 'albumin', value: 'normal' }];
    }

    if (panel.panel === 'pancreatic' && key === 'glucose') {
        if (value === 'elevated') return [{ bucket: 'biochemistry', key: 'glucose', value: 'hyperglycemia' }];
        if (value === 'low') return [{ bucket: 'biochemistry', key: 'glucose', value: 'hypoglycemia' }];
        if (value === 'normal') return [{ bucket: 'biochemistry', key: 'glucose', value: 'normal' }];
    }

    if (panel.panel === 'urinalysis' && key === 'usg') {
        return [{ bucket: 'urinalysis', key: 'specific_gravity' }];
    }

    if (panel.panel === 'abdominal_ultrasound' && key === 'free_fluid') {
        return [
            { bucket: 'abdominal_ultrasound', key: 'free_fluid' },
            { bucket: 'abdominal_ultrasound', key: 'ascites' },
        ];
    }

    if (panel.panel === 'thoracic_radiograph' && key === 'pulmonary_infiltrates' && value === 'present') {
        return [
            { bucket: 'thoracic_radiograph', key: 'pulmonary_infiltrates' },
            { bucket: 'thoracic_radiograph', key: 'pulmonary_pattern', value: 'interstitial' },
        ];
    }

    if (panel.panel === 'neurologic_imaging') {
        return [{ bucket: 'imaging', key }];
    }

    if (panel.panel === 'effusion_analysis') {
        if (key === 'effusion_rivalta') return [{ bucket: 'cytology', key: 'effusion_rivalta' }];
        return [{ bucket: 'cytology', key }];
    }

    if (panel.panel === 'pcr_panel') {
        return [{ bucket: 'pcr', key, value: normalizeQualitativePcrValue(value) }];
    }

    if (panel.panel === 'fecal_parasitology') {
        if (key === 'giardia_antigen') return [{ bucket: 'serology', key: 'giardia_antigen' }];
        if (key === 'coccidia_seen') return [{ bucket: 'parasitology', key: 'fecal_flotation', value: value === 'present' ? ['Coccidia'] : value }];
        return [{ bucket: 'parasitology', key, value: splitPanelTextValue(value) }];
    }

    if (panel.panel === 'skin_parasitology') {
        if (key === 'demodex_seen' || key === 'sarcoptes_seen') {
            return [{ bucket: 'parasitology', key: 'skin_scrape', value: value === 'present' ? key.replace('_seen', '') : value }];
        }
        return [{ bucket: 'parasitology', key }];
    }

    return [];
}

function normalizeActhValue(value: TestValue): TestValue {
    return value === 'blunted' ? 'flat_response' : value;
}

function normalizeSodiumPotassiumRatio(value: TestValue): 'low' | 'normal' | null {
    if (typeof value === 'number') return value < 27 ? 'low' : 'normal';
    if (value === 'low' || value === 'normal') return value;
    return null;
}

function normalizeQualitativePcrValue(value: TestValue): 'positive' | 'negative' | 'not_done' {
    return value === 'positive' || value === 'negative' ? value : 'not_done';
}

function normalizeQualitativeScreenValue(value: TestValue): TestValue {
    return value === 'equivocal' ? 'not_done' : value;
}

function splitPanelTextValue(value: TestValue): TestValue | string[] {
    if (typeof value !== 'string') return value;
    const entries = value
        .split(/[,;\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    return entries.length > 1 ? entries : value;
}
