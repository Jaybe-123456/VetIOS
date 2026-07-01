import type { DiagnosticResult, DiagnosticTests } from './types';

export interface NormalizedEvidenceFinding {
    source_path: string;
    source_key: string;
    source_value: string;
    canonical_path: string;
    canonical_value: unknown;
    evidence_kind: 'confirmatory' | 'supportive' | 'contradictory' | 'context';
}

export interface ClinicalEvidenceNormalizationResult {
    diagnostic_tests: DiagnosticTests;
    normalized_findings: NormalizedEvidenceFinding[];
    warnings: string[];
}

type DiagnosticBucket = keyof DiagnosticTests;
type DiagnosticRecord = Record<string, unknown>;
type FlatEvidenceEntry = {
    path: string;
    key: string;
    value: unknown;
};

const LAB_SOURCE_KEYS = [
    'labs',
    'lab_results',
    'laboratory_results',
    'laboratory',
    'diagnostics',
    'diagnostic_results',
    'tick_borne_disease_panel',
    'CBC',
    'cbc',
    'coagulation_panel',
    'hepatic_panel',
] as const;

export function normalizeClinicalLabEvidence(
    ...sources: unknown[]
): ClinicalEvidenceNormalizationResult {
    const result: ClinicalEvidenceNormalizationResult = {
        diagnostic_tests: {},
        normalized_findings: [],
        warnings: [],
    };

    const entries = sources.flatMap((source) => flattenLabSources(source));
    for (const entry of entries) {
        normalizeEntry(entry, result);
    }

    return result;
}

export function mergeDiagnosticTests(
    ...sources: Array<DiagnosticTests | undefined>
): DiagnosticTests | undefined {
    const merged: Record<string, Record<string, unknown>> = {};
    for (const source of sources) {
        if (!source || typeof source !== 'object') continue;
        for (const [bucket, rawPanel] of Object.entries(source)) {
            if (!rawPanel || typeof rawPanel !== 'object' || Array.isArray(rawPanel)) continue;
            const panel = rawPanel as Record<string, unknown>;
            merged[bucket] = {
                ...(merged[bucket] ?? {}),
                ...panel,
            };
        }
    }

    return Object.keys(merged).length > 0 ? merged as DiagnosticTests : undefined;
}

function flattenLabSources(source: unknown): FlatEvidenceEntry[] {
    const record = asRecord(source);
    if (!record) return [];

    const entries: FlatEvidenceEntry[] = [];
    for (const key of LAB_SOURCE_KEYS) {
        if (record[key] != null) {
            entries.push(...flattenEvidence(record[key], key));
        }
    }

    return entries;
}

function flattenEvidence(value: unknown, path: string): FlatEvidenceEntry[] {
    if (value == null) return [];

    if (Array.isArray(value)) {
        return value.flatMap((entry, index) => {
            const record = asRecord(entry);
            const analyte = readString(record?.analyte ?? record?.name ?? record?.test ?? record?.label);
            if (record && analyte) {
                const observed = record.value ?? record.result ?? record.status ?? record.interpretation ?? entry;
                const rendered = [
                    observed,
                    record.unit,
                    record.flag,
                    record.qualifier,
                ].map(readString).filter(Boolean).join(' ');
                return [{
                    path: `${path}.${normalizePathFragment(analyte)}`,
                    key: analyte,
                    value: rendered || observed,
                }];
            }
            return flattenEvidence(entry, `${path}.${index}`);
        });
    }

    const record = asRecord(value);
    if (!record) {
        return [{ path, key: lastPathFragment(path), value }];
    }

    return Object.entries(record).flatMap(([key, nested]) => {
        const nextPath = `${path}.${normalizePathFragment(key)}`;
        if (isPrimitiveEvidence(nested)) {
            return [{ path: nextPath, key, value: nested }];
        }
        return flattenEvidence(nested, nextPath);
    });
}

function normalizeEntry(
    entry: FlatEvidenceEntry,
    result: ClinicalEvidenceNormalizationResult,
) {
    const key = normalizeKey(`${entry.path}.${entry.key}`);
    const text = stringifyValue(entry.value);
    const lower = text.toLowerCase();
    if (!text) return;

    if (key.includes('ehrlichia') && key.includes('pcr')) {
        assignQualitative(result, entry, 'pcr', 'ehrlichia_pcr', text, 'confirmatory');
        return;
    }
    if (key.includes('anaplasma') && key.includes('pcr')) {
        assignQualitative(result, entry, 'pcr', 'anaplasma_pcr', text, 'confirmatory');
        return;
    }
    if (key.includes('babesia') && key.includes('pcr')) {
        assignQualitative(result, entry, 'pcr', 'babesia_pcr', text, 'confirmatory');
        return;
    }
    if (key.includes('leptospira') && key.includes('pcr')) {
        assignQualitative(result, entry, 'pcr', 'leptospira_pcr', text, 'confirmatory');
        return;
    }
    if (key.includes('parvovirus') && key.includes('pcr')) {
        assignQualitative(result, entry, 'pcr', 'parvovirus_pcr', text, 'confirmatory');
        return;
    }

    if (key.includes('ehrlichia') && /(antibody|snap|ifa|igg|serolog)/.test(key)) {
        assign(result, entry, 'serology', 'ehrlichia_antibody', normalizeQualitativeDiagnostic(text), 'confirmatory');
        return;
    }
    if (key.includes('anaplasma') && /(antibody|snap|ifa|igg|serolog)/.test(key)) {
        assign(result, entry, 'serology', 'anaplasma_antibody', normalizeQualitativeDiagnostic(text), 'confirmatory');
        return;
    }
    if (key.includes('borrelia') && /(antibody|snap|ifa|igg|serolog)/.test(key)) {
        assign(result, entry, 'serology', 'borrelia_antibody', normalizeQualitativeDiagnostic(text), 'confirmatory');
        return;
    }
    if (key.includes('heartworm') && key.includes('antigen')) {
        const value = normalizeQualitativeDiagnostic(text);
        assign(result, entry, 'serology', 'dirofilaria_immitis_antigen', value, 'confirmatory');
        assign(result, entry, 'serology', 'heartworm_antigen', value, 'confirmatory');
        return;
    }

    if (/(platelet|thrombocyte)/.test(key)) {
        const severity = inferThrombocytopeniaSeverity(text);
        if (severity) {
            assign(result, entry, 'cbc', 'thrombocytopenia', severity, 'supportive');
            assign(
                result,
                entry,
                'cbc',
                'platelet_count',
                severity === 'severe' ? 'severe_thrombocytopenia' : `${severity}_thrombocytopenia`,
                'supportive',
            );
        }
        return;
    }

    if (/(morula|intramonocytic)/.test(key) || /(morula|intramonocytic)/.test(lower)) {
        if (isPositiveText(text) || /suspected|rare/i.test(text)) {
            assign(result, entry, 'cbc', 'intramonocytic_morulae', 'present', 'supportive');
        }
        return;
    }

    if (/(reticulocyte|reticulocytes)/.test(key) && /(inadequate|low|decreased)/i.test(text)) {
        assign(result, entry, 'cbc', 'anemia_type', 'non_regenerative', 'supportive');
        return;
    }

    if (/(hematocrit|haematocrit|hemoglobin|haemoglobin|\brbc\b)/.test(key) && /\blow\b|decreased|reduced/i.test(text)) {
        assign(result, entry, 'cbc', 'anemia_type', 'non_regenerative', 'supportive');
        return;
    }

    if (/(lymphocyte|lymphocytes)/.test(key) && /\blow\b|decreased|lymphopenia/i.test(text)) {
        assign(result, entry, 'cbc', 'lymphopenia', 'present', 'supportive');
        return;
    }

    if (/(total_plasma_protein|total_protein)/.test(key) && /\bhigh\b|elevated|increased/i.test(text)) {
        assign(result, entry, 'cbc', 'hyperproteinaemia', 'present', 'supportive');
        assign(result, entry, 'biochemistry', 'total_protein', 'elevated', 'supportive');
        return;
    }

    if (/(globulin|globulins)/.test(key) && /\bhigh\b|elevated|increased|hyperglob/i.test(text)) {
        assign(result, entry, 'cbc', 'hyperglobulinaemia', 'present', 'supportive');
        assign(result, entry, 'biochemistry', 'globulins', 'hyperglobulinemia', 'supportive');
        return;
    }

    if (/(albumin)/.test(key) && /\blow\b|decreased|hypoalbum/i.test(text)) {
        assign(result, entry, 'biochemistry', 'albumin', 'hypoalbuminemia', 'supportive');
        return;
    }

    if (/(a_g_ratio|albumin_globulin|ag_ratio)/.test(key) && (/\blow\b/i.test(text) || (parseFirstNumber(text) ?? 1) < 0.6)) {
        assign(result, entry, 'biochemistry', 'globulins', 'hyperglobulinemia', 'supportive');
        assign(result, entry, 'biochemistry', 'albumin', 'hypoalbuminemia', 'supportive');
        return;
    }

    if (/(alt|ast)/.test(key) && /\bhigh\b|elevated|increased/i.test(text)) {
        assign(result, entry, 'biochemistry', 'alt_ast', /marked|severe/i.test(text) ? 'markedly_elevated' : 'mildly_elevated', 'supportive');
        return;
    }

    if (key.includes('babesia') && /(smear|piroplasm)/.test(key)) {
        if (isNegativeText(text)) {
            assign(result, entry, 'pcr', 'babesia_pcr', 'negative', 'contradictory');
        }
    }
}

function assign(
    result: ClinicalEvidenceNormalizationResult,
    source: FlatEvidenceEntry,
    bucket: DiagnosticBucket,
    key: string,
    value: unknown,
    evidenceKind: NormalizedEvidenceFinding['evidence_kind'],
) {
    const currentPanel = asRecord((result.diagnostic_tests as DiagnosticRecord)[bucket]) ?? {};
    const currentValue = currentPanel[key];
    const nextPanel = {
        ...currentPanel,
        [key]: mergeValue(currentValue, value),
    };
    (result.diagnostic_tests as DiagnosticRecord)[bucket] = nextPanel;
    result.normalized_findings.push({
        source_path: source.path,
        source_key: source.key,
        source_value: stringifyValue(source.value),
        canonical_path: `${bucket}.${key}`,
        canonical_value: value,
        evidence_kind: evidenceKind,
    });
}

function assignQualitative(
    result: ClinicalEvidenceNormalizationResult,
    source: FlatEvidenceEntry,
    bucket: DiagnosticBucket,
    key: string,
    value: string,
    evidenceKind: NormalizedEvidenceFinding['evidence_kind'],
) {
    const diagnostic = normalizeQualitativeDiagnostic(value);
    if (diagnostic === 'not_done') return;
    assign(result, source, bucket, key, diagnostic, evidenceKind);
}

function mergeValue(currentValue: unknown, nextValue: unknown): unknown {
    if (currentValue == null) return nextValue;
    if (currentValue === nextValue) return currentValue;
    if (currentValue === 'positive' || nextValue === 'positive') return 'positive';
    if (currentValue === 'present' || nextValue === 'present') return 'present';
    return currentValue;
}

function normalizeQualitativeDiagnostic(value: string): DiagnosticResult {
    if (isPositiveText(value)) return 'positive';
    if (isNegativeText(value)) return 'negative';
    if (/equivocal|indeterminate|borderline/i.test(value)) return 'equivocal';
    return 'not_done';
}

function inferThrombocytopeniaSeverity(value: string): 'mild' | 'moderate' | 'severe' | null {
    const text = value.toLowerCase();
    const numeric = parseFirstNumber(text);
    if (/critical|marked|severe/.test(text) || (numeric != null && numeric < 50)) return 'severe';
    if (/moderate/.test(text) || (numeric != null && numeric < 100)) return 'moderate';
    if (/mild|low|decreased/.test(text) || (numeric != null && numeric < 150)) return 'mild';
    return null;
}

function isPositiveText(value: string): boolean {
    const text = value.toLowerCase();
    if (isNegativeText(text) && !/\bpositive\b/.test(text)) return false;
    return /\bpositive\b|detected|present|high|suspected|seen|\bpos\b/.test(text);
}

function isNegativeText(value: string): boolean {
    return /\bnegative\b|not detected|no .*seen|no piroplasms|absent|\bneg\b/.test(value.toLowerCase());
}

function parseFirstNumber(value: string): number | null {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function stringifyValue(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizePathFragment(value: string): string {
    return normalizeKey(value) || 'value';
}

function lastPathFragment(path: string): string {
    return path.split('.').filter(Boolean).at(-1) ?? path;
}

function isPrimitiveEvidence(value: unknown): boolean {
    return value == null || typeof value !== 'object';
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}
