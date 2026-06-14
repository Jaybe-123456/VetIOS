import { createHash } from 'crypto';
import type { AskVetiosIntakeSummary } from '@/lib/askVetios/intake';

export type AskVetiosCaseGraphStatus = 'non_clinical' | 'draft' | 'ready_for_case_graph';

export interface AskVetiosCaseGraphSnapshot {
    schema_version: 'ask-vetios-case-graph-v1';
    draft_key: string;
    source: 'ask_vetios';
    status: AskVetiosCaseGraphStatus;
    captured_fields: Record<string, boolean>;
    missing_fields: string[];
    readiness_score: number;
    patient: {
        species: string | null;
        breed: string | null;
        age_years: number | null;
        sex: string | null;
    };
    encounter: {
        duration: string | null;
        clinical_signs: string[];
        labs_or_tests: string[];
        imaging: string[];
        treatments: string[];
        outcome_signals: string[];
        red_flags: string[];
        raw_note_hash: string;
    };
    decision_support: {
        urgency_level: string | null;
        top_differentials: Array<{ name: string; confidence: number | null }>;
        recommended_tests: string[];
    };
    outcome: {
        clinician_confirmation_status: 'not_captured';
        confirmed_diagnosis: null;
        outcome_status: 'not_captured' | 'mentioned';
    };
    promotion: {
        clinical_cases_ready: boolean;
        required_next_actions: string[];
    };
}

interface BuildAskVetiosCaseGraphSnapshotInput {
    intake: AskVetiosIntakeSummary;
    responseMetadata?: Record<string, unknown> | null;
}

export function buildAskVetiosCaseGraphSnapshot(
    input: BuildAskVetiosCaseGraphSnapshotInput,
): AskVetiosCaseGraphSnapshot {
    const { intake } = input;
    const draft = intake.case_draft;
    const metadata = input.responseMetadata ?? {};
    const status: AskVetiosCaseGraphStatus = !intake.is_clinical_intake
        ? 'non_clinical'
        : intake.readiness_score >= 55 ? 'ready_for_case_graph' : 'draft';
    const capturedFields = {
        species: draft.species !== 'unknown',
        breed: Boolean(draft.breed),
        age: draft.age_years !== null,
        sex: Boolean(draft.sex),
        clinical_signs: draft.clinical_signs.length > 0,
        duration: Boolean(draft.duration),
        labs: draft.labs_or_tests.length > 0,
        imaging: draft.imaging.length > 0,
        treatment: draft.treatments.length > 0,
        outcome: draft.outcome_signals.length > 0,
        clinician_confirmation: false,
    };
    const missingFields = mergeStrings(
        intake.missing_fields,
        Object.entries(capturedFields)
            .filter(([, captured]) => !captured)
            .map(([field]) => field),
    );

    return {
        schema_version: 'ask-vetios-case-graph-v1',
        draft_key: buildDraftKey(intake),
        source: 'ask_vetios',
        status,
        captured_fields: capturedFields,
        missing_fields: missingFields,
        readiness_score: intake.readiness_score,
        patient: {
            species: draft.species === 'unknown' ? null : draft.species,
            breed: draft.breed,
            age_years: draft.age_years,
            sex: draft.sex,
        },
        encounter: {
            duration: draft.duration,
            clinical_signs: draft.clinical_signs,
            labs_or_tests: draft.labs_or_tests,
            imaging: draft.imaging,
            treatments: draft.treatments,
            outcome_signals: draft.outcome_signals,
            red_flags: draft.red_flags,
            raw_note_hash: hashValue(draft.raw_note),
        },
        decision_support: {
            urgency_level: readString(metadata.urgency_level),
            top_differentials: readDifferentials(metadata.diagnosis_ranked),
            recommended_tests: readStringArray(metadata.recommended_tests),
        },
        outcome: {
            clinician_confirmation_status: 'not_captured',
            confirmed_diagnosis: null,
            outcome_status: draft.outcome_signals.length > 0 ? 'mentioned' : 'not_captured',
        },
        promotion: {
            clinical_cases_ready: status === 'ready_for_case_graph',
            required_next_actions: buildRequiredNextActions(missingFields, draft.red_flags.length > 0),
        },
    };
}

function buildDraftKey(intake: AskVetiosIntakeSummary): string {
    const draft = intake.case_draft;
    const source = [
        draft.species,
        draft.breed ?? '',
        draft.age_years ?? '',
        draft.sex ?? '',
        draft.duration ?? '',
        ...draft.clinical_signs,
        ...draft.labs_or_tests,
        ...draft.imaging,
    ].join('|').toLowerCase();
    return `ask_case_${hashValue(source || draft.raw_note).slice(0, 20)}`;
}

function buildRequiredNextActions(missingFields: string[], hasRedFlags: boolean): string[] {
    const actions = missingFields.map((field) => `capture_${field}`);
    if (hasRedFlags) actions.unshift('urgent_veterinary_review');
    actions.push('clinician_confirmation');
    return mergeStrings(actions);
}

function readDifferentials(value: unknown): Array<{ name: string; confidence: number | null }> {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 5).map((entry) => {
        const record = asRecord(entry);
        return {
            name: readString(record.name) ?? readString(record.disease) ?? 'Unknown',
            confidence: readNumber(record.confidence) ?? readNumber(record.probability),
        };
    });
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            .map((entry) => entry.trim())
        : [];
}

function mergeStrings(...groups: string[][]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    groups.flat().forEach((item) => {
        const normalized = item.trim();
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) return;
        seen.add(key);
        merged.push(normalized);
    });
    return merged;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
