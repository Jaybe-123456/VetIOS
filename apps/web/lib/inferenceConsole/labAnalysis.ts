import { randomUUID } from 'crypto';

export type LabSpecies = 'canine' | 'feline' | 'equine' | 'bovine' | 'ovine' | 'caprine' | 'porcine' | 'avian' | 'exotic';
export type AnalyteStatus =
    | 'normal'
    | 'mildly_low'
    | 'moderately_low'
    | 'markedly_low'
    | 'mildly_high'
    | 'moderately_high'
    | 'markedly_high'
    | 'critical';

export interface LabAnalyteInput {
    analyte: string;
    value: number;
    unit?: string;
    reference_low?: number;
    reference_high?: number;
}

export interface LabAnalyteResult {
    analyte: string;
    value: number;
    unit: string;
    reference_low: number;
    reference_high: number;
    status: AnalyteStatus;
    deviation_percent: number;
    critical_flag: boolean;
    clinical_significance: string;
}

export interface LabPatternMatch {
    pattern_name: string;
    pattern_category: string;
    confidence: number;
    supporting_analytes: string[];
    contradicting_analytes: string[];
    clinical_interpretation: string;
}

export interface LabReport {
    report_id: string;
    species: LabSpecies;
    panel_types: string[];
    analyte_results: LabAnalyteResult[];
    critical_values: LabAnalyteResult[];
    pattern_matches: LabPatternMatch[];
    key_abnormalities_summary: string;
    generated_at: string;
}

export const ANALYTE_ALIASES: Record<string, string> = {
    WBC: 'white_blood_cell_count',
    'White Blood Cells': 'white_blood_cell_count',
    Leukocytes: 'white_blood_cell_count',
    NEU: 'neutrophil_count',
    Neutrophils: 'neutrophil_count',
    LYM: 'lymphocyte_count',
    Lymphocytes: 'lymphocyte_count',
    RBC: 'red_blood_cell_count',
    HCT: 'haematocrit',
    PCV: 'haematocrit',
    PLT: 'platelet_count',
    Platelets: 'platelet_count',
    ALT: 'alanine_aminotransferase',
    SGPT: 'alanine_aminotransferase',
    ALP: 'alkaline_phosphatase',
    AST: 'aspartate_aminotransferase',
    GGT: 'gamma_glutamyltransferase',
    BUN: 'blood_urea_nitrogen',
    Urea: 'blood_urea_nitrogen',
    CREA: 'creatinine',
    Creatinine: 'creatinine',
    SDMA: 'symmetric_dimethylarginine',
    GLU: 'glucose',
    Glucose: 'glucose',
    ALB: 'albumin',
    Albumin: 'albumin',
    GLOB: 'globulin',
    Globulin: 'globulin',
    TBIL: 'total_bilirubin',
    Bilirubin: 'total_bilirubin',
    CHOL: 'cholesterol',
    Calcium: 'calcium',
    Ca: 'calcium',
    Phos: 'phosphorus',
    Na: 'sodium',
    Sodium: 'sodium',
    K: 'potassium',
    Potassium: 'potassium',
    Cl: 'chloride',
    Chloride: 'chloride',
    Lipase: 'lipase',
    cPLI: 'canine_pancreatic_lipase_immunoreactivity',
    fPLI: 'feline_pancreatic_lipase_immunoreactivity',
    Lactate: 'lactate',
};

const REFERENCE_RANGES: Record<string, Record<string, { lower: number; upper: number; unit: string }>> = {
    canine: {
        white_blood_cell_count: { lower: 6, upper: 17, unit: '10^9/L' },
        neutrophil_count: { lower: 3, upper: 11.5, unit: '10^9/L' },
        lymphocyte_count: { lower: 1, upper: 4.8, unit: '10^9/L' },
        haematocrit: { lower: 37, upper: 55, unit: '%' },
        platelet_count: { lower: 200, upper: 500, unit: '10^9/L' },
        alanine_aminotransferase: { lower: 10, upper: 125, unit: 'U/L' },
        alkaline_phosphatase: { lower: 23, upper: 212, unit: 'U/L' },
        blood_urea_nitrogen: { lower: 7, upper: 27, unit: 'mg/dL' },
        creatinine: { lower: 0.5, upper: 1.8, unit: 'mg/dL' },
        glucose: { lower: 70, upper: 143, unit: 'mg/dL' },
        albumin: { lower: 2.6, upper: 4.0, unit: 'g/dL' },
        sodium: { lower: 140, upper: 155, unit: 'mmol/L' },
        potassium: { lower: 3.5, upper: 5.8, unit: 'mmol/L' },
        canine_pancreatic_lipase_immunoreactivity: { lower: 0, upper: 200, unit: 'ug/L' },
    },
    feline: {
        white_blood_cell_count: { lower: 5.5, upper: 19.5, unit: '10^9/L' },
        neutrophil_count: { lower: 2.5, upper: 12.5, unit: '10^9/L' },
        lymphocyte_count: { lower: 1.5, upper: 7, unit: '10^9/L' },
        haematocrit: { lower: 30, upper: 45, unit: '%' },
        platelet_count: { lower: 200, upper: 600, unit: '10^9/L' },
        alanine_aminotransferase: { lower: 20, upper: 100, unit: 'U/L' },
        alkaline_phosphatase: { lower: 10, upper: 90, unit: 'U/L' },
        blood_urea_nitrogen: { lower: 16, upper: 36, unit: 'mg/dL' },
        creatinine: { lower: 0.8, upper: 2.4, unit: 'mg/dL' },
        glucose: { lower: 70, upper: 150, unit: 'mg/dL' },
        albumin: { lower: 2.5, upper: 3.9, unit: 'g/dL' },
        sodium: { lower: 145, upper: 158, unit: 'mmol/L' },
        potassium: { lower: 3.4, upper: 5.6, unit: 'mmol/L' },
        feline_pancreatic_lipase_immunoreactivity: { lower: 0, upper: 3.5, unit: 'ug/L' },
    },
    equine: {
        white_blood_cell_count: { lower: 5.5, upper: 12.5, unit: '10^9/L' },
        haematocrit: { lower: 32, upper: 48, unit: '%' },
        platelet_count: { lower: 100, upper: 350, unit: '10^9/L' },
        blood_urea_nitrogen: { lower: 10, upper: 24, unit: 'mg/dL' },
        creatinine: { lower: 0.9, upper: 2.0, unit: 'mg/dL' },
        glucose: { lower: 70, upper: 115, unit: 'mg/dL' },
        sodium: { lower: 132, upper: 146, unit: 'mmol/L' },
        potassium: { lower: 2.8, upper: 4.7, unit: 'mmol/L' },
    },
};

export function analyseLabResults(input: {
    species: string;
    results: LabAnalyteInput[];
    now?: Date;
}): LabReport {
    const species = normalizeSpecies(input.species);
    const analyteResults = input.results
        .map((entry) => normalizeAnalyteResult(species, entry))
        .filter((entry): entry is LabAnalyteResult => Boolean(entry));
    const patternMatches = detectLabPatterns(analyteResults);
    const criticalValues = analyteResults.filter((entry) => entry.critical_flag);

    return {
        report_id: randomUUID(),
        species,
        panel_types: inferPanelTypes(analyteResults),
        analyte_results: analyteResults,
        critical_values: criticalValues,
        pattern_matches: patternMatches,
        key_abnormalities_summary: summarizeKeyAbnormalities(analyteResults, patternMatches),
        generated_at: (input.now ?? new Date()).toISOString(),
    };
}

export function parseCsvLabResults(text: string): LabAnalyteInput[] {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const header = splitCsvLine(lines[0]).map((entry) => entry.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
    const analyteIndex = findHeaderIndex(header, ['analyte', 'test', 'name']);
    const valueIndex = findHeaderIndex(header, ['value', 'result']);
    const unitIndex = findHeaderIndex(header, ['unit', 'units']);
    const lowIndex = findHeaderIndex(header, ['reference_low', 'ref_low', 'low']);
    const highIndex = findHeaderIndex(header, ['reference_high', 'ref_high', 'high']);
    if (analyteIndex < 0 || valueIndex < 0) return [];

    return lines.slice(1)
        .map((line) => splitCsvLine(line))
        .map((cells) => ({
            analyte: cells[analyteIndex] ?? '',
            value: Number(cells[valueIndex]),
            unit: unitIndex >= 0 ? cells[unitIndex] : undefined,
            reference_low: lowIndex >= 0 ? optionalNumber(cells[lowIndex]) : undefined,
            reference_high: highIndex >= 0 ? optionalNumber(cells[highIndex]) : undefined,
        }))
        .filter((entry) => entry.analyte.trim().length > 0 && Number.isFinite(entry.value));
}

export function classifyDeviation(value: number, lower: number, upper: number): AnalyteStatus {
    if (value >= lower && value <= upper) return 'normal';
    const range = Math.max(upper - lower, 1);
    const deviation = value < lower ? (lower - value) / range : (value - upper) / range;
    if (deviation <= 0.2) return value < lower ? 'mildly_low' : 'mildly_high';
    if (deviation <= 0.5) return value < lower ? 'moderately_low' : 'moderately_high';
    if (deviation <= 1) return value < lower ? 'markedly_low' : 'markedly_high';
    return 'critical';
}

export function normalizeAnalyteName(value: string): string {
    const trimmed = value.trim();
    return ANALYTE_ALIASES[trimmed]
        ?? ANALYTE_ALIASES[trimmed.toUpperCase()]
        ?? trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeAnalyteResult(species: LabSpecies, input: LabAnalyteInput): LabAnalyteResult | null {
    const analyte = normalizeAnalyteName(input.analyte);
    if (!analyte || !Number.isFinite(input.value)) return null;
    const range = resolveReferenceRange(species, analyte, input);
    if (!range) return null;
    const status = classifyDeviation(input.value, range.lower, range.upper);
    const deviation = calculateDeviationPercent(input.value, range.lower, range.upper);
    return {
        analyte,
        value: input.value,
        unit: input.unit?.trim() || range.unit,
        reference_low: range.lower,
        reference_high: range.upper,
        status,
        deviation_percent: deviation,
        critical_flag: status === 'critical',
        clinical_significance: describeAnalyteSignificance(analyte, status),
    };
}

function resolveReferenceRange(species: LabSpecies, analyte: string, input: LabAnalyteInput) {
    if (Number.isFinite(input.reference_low) && Number.isFinite(input.reference_high)) {
        return {
            lower: input.reference_low as number,
            upper: input.reference_high as number,
            unit: input.unit?.trim() || '',
        };
    }
    return REFERENCE_RANGES[species]?.[analyte] ?? REFERENCE_RANGES.canine[analyte] ?? null;
}

function detectLabPatterns(results: LabAnalyteResult[]): LabPatternMatch[] {
    const byName = new Map(results.map((entry) => [entry.analyte, entry]));
    const patterns: LabPatternMatch[] = [];
    const high = (name: string) => isHigh(byName.get(name)?.status);
    const low = (name: string) => isLow(byName.get(name)?.status);

    if (high('white_blood_cell_count') && high('neutrophil_count')) {
        patterns.push(pattern('Inflammatory leucogram', 'haematology', 0.78, ['white_blood_cell_count', 'neutrophil_count'], [], 'Leucocytosis with neutrophilia supports inflammation, infection, tissue injury, or corticosteroid influence depending on context.'));
    }
    if (high('neutrophil_count') && low('lymphocyte_count')) {
        patterns.push(pattern('Stress leucogram', 'haematology', 0.68, ['neutrophil_count', 'lymphocyte_count'], [], 'Mature neutrophilia with lymphopenia is compatible with stress or corticosteroid effect.'));
    }
    if (isLow(byName.get('platelet_count')?.status) && (byName.get('platelet_count')?.value ?? Number.POSITIVE_INFINITY) < 50) {
        patterns.push(pattern('Severe thrombocytopenia', 'haematology', 0.82, ['platelet_count'], [], 'Severe thrombocytopenia can support immune-mediated, consumptive, tick-borne, or marrow disease and warrants smear confirmation.'));
    }
    if (high('blood_urea_nitrogen') && high('creatinine')) {
        patterns.push(pattern('Azotaemia pattern', 'renal', 0.8, ['blood_urea_nitrogen', 'creatinine'], [], 'Concurrent BUN and creatinine elevation supports azotaemia; urine specific gravity and hydration status are needed to localize prerenal, renal, or postrenal causes.'));
    }
    if (high('alanine_aminotransferase') && high('alkaline_phosphatase')) {
        patterns.push(pattern('Mixed hepatocellular and cholestatic enzyme elevation', 'hepatic', 0.68, ['alanine_aminotransferase', 'alkaline_phosphatase'], [], 'Concurrent ALT and ALP elevation supports hepatobiliary injury, cholestasis, endocrine influence, or reactive hepatopathy.'));
    }
    if (high('glucose')) {
        patterns.push(pattern('Hyperglycaemia pattern', 'endocrine', 0.58, ['glucose'], [], 'Hyperglycaemia supports stress, diabetes mellitus, endocrine disease, or dextrose exposure depending on urinalysis and clinical context.'));
    }
    const sodium = byName.get('sodium')?.value;
    const potassium = byName.get('potassium')?.value;
    if (Number.isFinite(sodium) && Number.isFinite(potassium) && (sodium as number) / Math.max(potassium as number, 0.1) < 27) {
        patterns.push(pattern('Low sodium:potassium ratio', 'electrolyte', 0.86, ['sodium', 'potassium'], [], 'Na:K ratio below 27 supports hypoadrenocorticism as a major rule-out, while other causes remain possible.'));
    }
    if (high('canine_pancreatic_lipase_immunoreactivity') || high('feline_pancreatic_lipase_immunoreactivity') || high('lipase')) {
        patterns.push(pattern('Pancreatic enzyme elevation', 'pancreatic', 0.7, ['canine_pancreatic_lipase_immunoreactivity', 'feline_pancreatic_lipase_immunoreactivity', 'lipase'].filter((name) => byName.has(name)), [], 'Pancreatic enzyme elevation supports pancreatitis only when integrated with clinical signs, imaging, and other labs.'));
    }

    return patterns.sort((left, right) => right.confidence - left.confidence);
}

function pattern(
    pattern_name: string,
    pattern_category: string,
    confidence: number,
    supporting_analytes: string[],
    contradicting_analytes: string[],
    clinical_interpretation: string,
): LabPatternMatch {
    return {
        pattern_name,
        pattern_category,
        confidence,
        supporting_analytes,
        contradicting_analytes,
        clinical_interpretation,
    };
}

function inferPanelTypes(results: LabAnalyteResult[]): string[] {
    const names = new Set(results.map((entry) => entry.analyte));
    const panels = new Set<string>();
    if (['white_blood_cell_count', 'neutrophil_count', 'lymphocyte_count', 'haematocrit', 'platelet_count'].some((name) => names.has(name))) panels.add('CBC');
    if (['alanine_aminotransferase', 'alkaline_phosphatase', 'blood_urea_nitrogen', 'creatinine', 'glucose', 'albumin'].some((name) => names.has(name))) panels.add('biochemistry');
    if (['sodium', 'potassium', 'chloride'].some((name) => names.has(name))) panels.add('electrolytes');
    if (['canine_pancreatic_lipase_immunoreactivity', 'feline_pancreatic_lipase_immunoreactivity', 'lipase'].some((name) => names.has(name))) panels.add('pancreatic');
    return [...panels];
}

function summarizeKeyAbnormalities(results: LabAnalyteResult[], patterns: LabPatternMatch[]): string {
    const abnormal = results
        .filter((entry) => entry.status !== 'normal')
        .sort((left, right) => Math.abs(right.deviation_percent) - Math.abs(left.deviation_percent))
        .slice(0, 5)
        .map((entry) => `${entry.analyte} ${entry.status} (${entry.value} ${entry.unit})`);
    const patternText = patterns.slice(0, 3).map((entry) => entry.pattern_name);
    if (abnormal.length === 0 && patternText.length === 0) return 'No major abnormalities detected in submitted analytes.';
    return [...abnormal, ...patternText.map((entry) => `Pattern: ${entry}`)].join('; ');
}

function describeAnalyteSignificance(analyte: string, status: AnalyteStatus): string {
    if (status === 'normal') return `${analyte} is within the supplied reference interval.`;
    const direction = isLow(status) ? 'decreased' : 'increased';
    return `${analyte} is ${direction}; interpret with species, hydration status, clinical signs, and submitted reference interval.`;
}

function calculateDeviationPercent(value: number, lower: number, upper: number): number {
    if (value >= lower && value <= upper) return 0;
    const range = Math.max(upper - lower, 1);
    const deviation = value < lower ? (lower - value) / range : (value - upper) / range;
    return Number((deviation * 100).toFixed(1));
}

function normalizeSpecies(value: string): LabSpecies {
    const normalized = value.trim().toLowerCase();
    if (['canine', 'feline', 'equine', 'bovine', 'ovine', 'caprine', 'porcine', 'avian', 'exotic'].includes(normalized)) {
        return normalized as LabSpecies;
    }
    if (normalized === 'dog') return 'canine';
    if (normalized === 'cat') return 'feline';
    if (normalized === 'horse') return 'equine';
    return 'canine';
}

function splitCsvLine(line: string): string[] {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            quoted = !quoted;
            continue;
        }
        if (char === ',' && !quoted) {
            cells.push(cell.trim());
            cell = '';
            continue;
        }
        cell += char;
    }
    cells.push(cell.trim());
    return cells;
}

function findHeaderIndex(header: string[], candidates: string[]): number {
    return header.findIndex((entry) => candidates.includes(entry));
}

function optionalNumber(value: string | undefined): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function isHigh(status: AnalyteStatus | undefined): boolean {
    return status === 'mildly_high' || status === 'moderately_high' || status === 'markedly_high' || status === 'critical';
}

function isLow(status: AnalyteStatus | undefined): boolean {
    return status === 'mildly_low' || status === 'moderately_low' || status === 'markedly_low' || status === 'critical';
}
