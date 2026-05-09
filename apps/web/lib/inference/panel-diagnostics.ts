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
    diagnosticTests[bucket] = {
        ...(typeof existing === 'object' && existing != null && !Array.isArray(existing)
            ? existing as DiagnosticRecord
            : {}),
        [key]: value,
    };
}

function diagnosticBucketForPanel(panel: SystemPanel): DiagnosticBucket {
    if (panel.panel === 'CBC') return 'cbc';
    if (panel.panel === 'thoracic_radiograph') return 'thoracic_radiograph';
    if (panel.panel === 'abdominal_ultrasound') return 'abdominal_ultrasound';
    if (panel.system === 'urinalysis') return 'urinalysis';
    if (panel.system === 'serology') return 'serology';
    if (panel.system === 'biochemistry') return 'biochemistry';
    if (panel.system === 'endocrine') return 'serology';
    if (panel.system === 'cytology') return 'cytology';
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
    }

    if (panel.panel === 'infectious' && key === 'leishmania_serology') {
        return [
            { bucket: 'serology', key: 'leishmania_antibody' },
            { bucket: 'serology', key: 'leishmania_serology' },
        ];
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
