import type { DiagnosticTests, InferenceRequest, Species } from './types';
import type { NormalizedEvidenceFinding } from './labEvidenceNormalizer';

export interface ReferenceInterpretationResult {
    diagnostic_tests: DiagnosticTests | undefined;
    normalized_findings: NormalizedEvidenceFinding[];
    warnings: string[];
}

type DiagnosticBucket = keyof DiagnosticTests;
type DiagnosticRecord = Record<string, unknown>;
type ReferenceSpecies = Species | 'ruminant';

const REFERENCE_WARNING =
    'Species-aware reference interpretation is conservative screening support and must be reconciled against the submitting laboratory, analyzer, age, pregnancy/lactation, and local reference interval.';

export function interpretReferenceIntervals(
    request: Pick<InferenceRequest, 'species' | 'age_years' | 'diagnostic_tests'>,
): ReferenceInterpretationResult {
    const diagnosticTests = cloneDiagnosticTests(request.diagnostic_tests);
    const findings: NormalizedEvidenceFinding[] = [];
    const species = normalizeSpeciesName(request.species);

    if (!diagnosticTests) {
        return { diagnostic_tests: undefined, normalized_findings: findings, warnings: [] };
    }

    interpretCompanionAnimalBiochemistry(species, diagnosticTests, findings);
    interpretRuminantMetabolicPanel(species, diagnosticTests, findings);
    interpretEquineInflammation(species, diagnosticTests, findings);
    interpretAvianReptileMinerals(species, diagnosticTests, findings);
    interpretHaematologyContext(species, diagnosticTests, findings);

    return {
        diagnostic_tests: diagnosticTests,
        normalized_findings: findings,
        warnings: findings.length > 0 ? [REFERENCE_WARNING] : [],
    };
}

function interpretCompanionAnimalBiochemistry(
    species: ReferenceSpecies,
    diagnosticTests: DiagnosticTests,
    findings: NormalizedEvidenceFinding[],
) {
    if (species !== 'canine' && species !== 'feline') return;
    const biochemistry = panel(diagnosticTests, 'biochemistry');
    if (!biochemistry) return;

    const glucose = numeric(biochemistry.glucose);
    if (glucose != null) {
        if (glucose < 60) {
            assignInterpretation(diagnosticTests, findings, 'biochemistry', 'glucose', 'hypoglycemia', glucose, 'companion_animal_glucose_screen');
        } else if (glucose > 180) {
            assignInterpretation(diagnosticTests, findings, 'biochemistry', 'glucose', 'hyperglycemia', glucose, 'companion_animal_glucose_screen');
        }
    }

    const calcium = numeric(biochemistry.calcium);
    if (calcium != null) {
        if (calcium < 8) {
            assignInterpretation(diagnosticTests, findings, 'biochemistry', 'calcium', 'hypocalcemia', calcium, 'companion_animal_total_calcium_screen');
        } else if (calcium > 12) {
            assignInterpretation(diagnosticTests, findings, 'biochemistry', 'calcium', 'hypercalcemia', calcium, 'companion_animal_total_calcium_screen');
        }
    }
}

function interpretRuminantMetabolicPanel(
    species: ReferenceSpecies,
    diagnosticTests: DiagnosticTests,
    findings: NormalizedEvidenceFinding[],
) {
    if (species !== 'ruminant') return;
    const biochemistry = panel(diagnosticTests, 'biochemistry');
    if (!biochemistry) return;

    const bhba = numeric(biochemistry.bhba);
    if (bhba != null && bhba >= 1.2) {
        assignInterpretation(diagnosticTests, findings, 'biochemistry', 'bhba', 'elevated', bhba, 'ruminant_bhba_screen');
    }

    const nefa = numeric(biochemistry.nefa);
    if (nefa != null && nefa >= 0.7) {
        assignInterpretation(diagnosticTests, findings, 'biochemistry', 'nefa', 'elevated', nefa, 'ruminant_nefa_screen');
    }

    const glucose = numeric(biochemistry.glucose);
    if (glucose != null) {
        if (glucose < 45) {
            assignInterpretation(diagnosticTests, findings, 'biochemistry', 'glucose', 'hypoglycemia', glucose, 'ruminant_glucose_screen');
        } else if (glucose > 140) {
            assignInterpretation(diagnosticTests, findings, 'biochemistry', 'glucose', 'hyperglycemia', glucose, 'ruminant_glucose_screen');
        }
    }

    const calcium = numeric(biochemistry.calcium);
    if (calcium != null && calcium < 8) {
        assignInterpretation(diagnosticTests, findings, 'biochemistry', 'calcium', 'low', calcium, 'ruminant_total_calcium_screen');
    }

    const magnesium = numeric(biochemistry.magnesium);
    if (magnesium != null && magnesium < 1.8) {
        assignInterpretation(diagnosticTests, findings, 'biochemistry', 'magnesium', 'low', magnesium, 'ruminant_magnesium_screen');
    }

    const phosphorus = numeric(biochemistry.phosphorus);
    if (phosphorus != null) {
        if (phosphorus < 4) {
            assignInterpretation(diagnosticTests, findings, 'biochemistry', 'phosphorus', 'low', phosphorus, 'ruminant_phosphorus_screen');
        } else if (phosphorus > 8) {
            assignInterpretation(diagnosticTests, findings, 'biochemistry', 'phosphorus', 'elevated', phosphorus, 'ruminant_phosphorus_screen');
        }
    }
}

function interpretEquineInflammation(
    species: ReferenceSpecies,
    diagnosticTests: DiagnosticTests,
    findings: NormalizedEvidenceFinding[],
) {
    if (species !== 'equine') return;
    const biochemistry = panel(diagnosticTests, 'biochemistry');
    if (!biochemistry) return;

    const saa = numeric(biochemistry.saa_value ?? biochemistry.saa_level);
    if (saa != null && saa >= 50) {
        assignInterpretation(diagnosticTests, findings, 'biochemistry', 'saa_level', 'elevated', saa, 'equine_saa_screen');
    }
}

function interpretAvianReptileMinerals(
    species: ReferenceSpecies,
    diagnosticTests: DiagnosticTests,
    findings: NormalizedEvidenceFinding[],
) {
    if (species !== 'avian' && species !== 'reptile' && species !== 'exotic') return;
    const biochemistry = panel(diagnosticTests, 'biochemistry');
    if (!biochemistry) return;

    const calcium = numeric(biochemistry.calcium);
    if (calcium != null && calcium < 8) {
        assignInterpretation(diagnosticTests, findings, 'biochemistry', 'calcium', 'low', calcium, `${species}_calcium_screen`);
    }

    const phosphorus = numeric(biochemistry.phosphorus);
    if (phosphorus != null && phosphorus > 8) {
        assignInterpretation(diagnosticTests, findings, 'biochemistry', 'phosphorus', 'elevated', phosphorus, `${species}_phosphorus_screen`);
    }
}

function interpretHaematologyContext(
    species: ReferenceSpecies,
    diagnosticTests: DiagnosticTests,
    findings: NormalizedEvidenceFinding[],
) {
    const cbc = panel(diagnosticTests, 'cbc');
    if (!cbc) return;

    const pcv = numeric(cbc.packed_cell_volume_percent ?? cbc.pcv);
    if (pcv == null) return;

    if (cbc.packed_cell_volume_percent == null) {
        assignInterpretation(diagnosticTests, findings, 'cbc', 'packed_cell_volume_percent', pcv, pcv, 'pcv_alias_mapping', 'context');
    }

    const anemiaCutoff = species === 'ruminant' ? 24 : species === 'equine' ? 30 : 28;
    if (pcv < anemiaCutoff && cbc.anemia_type == null) {
        assignInterpretation(diagnosticTests, findings, 'cbc', 'anemia_type', 'not_assessed', pcv, `${species}_pcv_anemia_screen`, 'context');
    }
}

function cloneDiagnosticTests(source: DiagnosticTests | undefined): DiagnosticTests | undefined {
    if (!source || typeof source !== 'object') return undefined;
    const output: Record<string, DiagnosticRecord> = {};
    for (const [bucket, rawPanel] of Object.entries(source)) {
        if (!rawPanel || typeof rawPanel !== 'object' || Array.isArray(rawPanel)) continue;
        output[bucket] = { ...(rawPanel as DiagnosticRecord) };
    }
    return Object.keys(output).length > 0 ? output as DiagnosticTests : undefined;
}

function panel(diagnosticTests: DiagnosticTests, bucket: DiagnosticBucket): DiagnosticRecord | undefined {
    const rawPanel = diagnosticTests[bucket];
    if (!rawPanel || typeof rawPanel !== 'object' || Array.isArray(rawPanel)) return undefined;
    return rawPanel as DiagnosticRecord;
}

function ensurePanel(diagnosticTests: DiagnosticTests, bucket: DiagnosticBucket): DiagnosticRecord {
    const current = panel(diagnosticTests, bucket);
    if (current) return current;
    const next: DiagnosticRecord = {};
    (diagnosticTests as Record<string, DiagnosticRecord>)[bucket] = next;
    return next;
}

function assignInterpretation(
    diagnosticTests: DiagnosticTests,
    findings: NormalizedEvidenceFinding[],
    bucket: DiagnosticBucket,
    key: string,
    canonicalValue: unknown,
    sourceValue: unknown,
    basis: string,
    evidenceKind: NormalizedEvidenceFinding['evidence_kind'] = 'supportive',
) {
    const currentPanel = ensurePanel(diagnosticTests, bucket);
    const currentValue = currentPanel[key];
    if (currentValue === canonicalValue) return;

    currentPanel[key] = canonicalValue;
    findings.push({
        source_path: `${bucket}.${key}`,
        source_key: key,
        source_value: String(sourceValue),
        canonical_path: `${bucket}.${key}`,
        canonical_value: canonicalValue,
        evidence_kind: evidenceKind,
    });
    findings.push({
        source_path: `${bucket}.${key}`,
        source_key: `${key}_reference_basis`,
        source_value: basis,
        canonical_path: `reference_interpretation.${bucket}.${key}`,
        canonical_value: basis,
        evidence_kind: 'context',
    });
}

function numeric(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSpeciesName(species: string | null | undefined): ReferenceSpecies {
    const normalized = String(species ?? '').trim().toLowerCase();
    if (normalized.startsWith('bov') || normalized.includes('cattle') || normalized === 'cow') return 'ruminant';
    if (normalized.startsWith('ovi') || normalized.includes('sheep')) return 'ruminant';
    if (normalized.startsWith('cap') || normalized.includes('goat')) return 'ruminant';
    if (normalized.startsWith('equ') || normalized.includes('horse')) return 'equine';
    if (normalized.startsWith('fel') || normalized.includes('cat')) return 'feline';
    if (normalized.startsWith('can') || normalized.includes('dog')) return 'canine';
    if (normalized.startsWith('avi') || normalized.includes('bird')) return 'avian';
    if (normalized.startsWith('rep') || normalized.includes('snake') || normalized.includes('lizard') || normalized.includes('turtle') || normalized.includes('tortoise')) return 'reptile';
    if (normalized.startsWith('exo') || normalized.includes('rabbit') || normalized.includes('ferret') || normalized.includes('guinea')) return 'exotic';
    return 'canine';
}
