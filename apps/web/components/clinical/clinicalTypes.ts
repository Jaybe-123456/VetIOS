import type { NormalizedInput } from '@/lib/input/inputNormalizer';

export type ClinicalInferenceInput = NormalizedInput;
export type ClinicalUrgency = 'high' | 'medium' | 'low';

export interface ClinicalDifferential {
    label: string;
    probability: number;
    urgency: ClinicalUrgency;
}

export interface ClinicalDiagnosisResult {
    inference_event_id: string;
    differentials: ClinicalDifferential[];
    confidence: number;
    recommended_tests: string[];
    reliability_note?: string;
    cire?: Record<string, unknown>;
    is_demo?: boolean;
    raw?: Record<string, unknown>;
}

export function formatClinicalLabel(value: string): string {
    return repairDisplayText(value)
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map((word) => {
            const lower = word.toLowerCase();
            if (['cbc', 'pcv', 'wbc', 'bun', 'elisa', 'alt', 'alp'].includes(lower)) return lower.toUpperCase();
            return /^[A-Z0-9]{2,5}$/.test(word) ? word : `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`;
        })
        .join(' ');
}

export function repairDisplayText(value: string): string {
    return value
        .replace(/\u00e2\u20ac\u201d/g, '\u2014')
        .replace(/\u00e2\u20ac\u201c/g, '\u2013')
        .replace(/\u00e2\u20ac\u2018/g, '\u2011')
        .replace(/\u00e2\u20ac\u2122/g, "'")
        .replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\u009d/g, '"')
        .replace(/\u00c2/g, '');
}

export function formatCaseNumber(id: string): string {
    const cleaned = id.replace(/[^a-zA-Z0-9]/g, '');
    return `Case #${cleaned.slice(-4).toUpperCase() || 'NEW'}`;
}

export function confidenceLabel(value: number): string {
    if (value >= 0.75) return `High confidence (${formatPercent(value)})`;
    if (value >= 0.5) return `Moderate confidence (${formatPercent(value)})`;
    return `Low confidence (${formatPercent(value)}) - consider additional tests`;
}

export function formatPercent(value: number): string {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}
