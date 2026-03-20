import { DEFAULT_FEATURE_SCHEMA_VERSION, type CaseFeatureVector, type LearningCaseRecord } from '@/lib/learningEngine/types';

export function vectorizeClinicalCase(
    clinicalCase: LearningCaseRecord,
    featureSchemaVersion: string = DEFAULT_FEATURE_SCHEMA_VERSION,
): CaseFeatureVector {
    const metadata = clinicalCase.patient_metadata ?? {};
    const signature = clinicalCase.latest_input_signature ?? {};
    const ageYears = readNumber(metadata.age_years ?? metadata.age ?? signature.age_years ?? signature.age);
    const durationHours = deriveDurationHours(metadata, signature);
    const onsetPattern = readText(metadata.onset_pattern ?? signature.onset_pattern ?? metadata.presentation_onset);
    const environment = readText(metadata.environment ?? signature.environment);
    const sex = readText(metadata.sex ?? signature.sex);
    const priorConfidence = clinicalCase.degraded_confidence ?? clinicalCase.diagnosis_confidence ?? null;
    const contradictionScore = clinicalCase.contradiction_score ?? 0;
    const ruleTriggers = extractRuleTriggers(clinicalCase);

    return {
        case_id: clinicalCase.case_id,
        feature_schema_version: featureSchemaVersion,
        raw_snapshot: {
            patient_metadata: metadata,
            latest_input_signature: signature,
            symptom_text_raw: clinicalCase.symptom_text_raw,
            contradiction_flags: clinicalCase.contradiction_flags,
            uncertainty_notes: clinicalCase.uncertainty_notes,
        },
        dense_features: {
            species_canonical: clinicalCase.species_canonical,
            species_display: clinicalCase.species_display,
            breed: clinicalCase.breed,
            age_years: ageYears,
            sex,
            onset_pattern: onsetPattern,
            duration_hours: durationHours,
            environment,
            contradiction_score: contradictionScore,
            adversarial_case: clinicalCase.adversarial_case,
            prior_inference_confidence: priorConfidence,
            emergency_level: clinicalCase.emergency_level,
            rule_trigger_count: ruleTriggers.length,
        },
        symptom_flags: {
            ...clinicalCase.symptom_vector_normalized,
            ...Object.fromEntries(clinicalCase.symptom_keys.map((key) => [key, true])),
        },
    };
}

function deriveDurationHours(
    metadata: Record<string, unknown>,
    signature: Record<string, unknown>,
): number | null {
    const directHours = readNumber(metadata.duration_hours ?? signature.duration_hours);
    if (directHours != null) return directHours;

    const durationDays = readNumber(metadata.duration_days ?? signature.duration_days);
    if (durationDays != null) return Number((durationDays * 24).toFixed(3));

    const durationMinutes = readNumber(metadata.duration_minutes ?? signature.duration_minutes);
    if (durationMinutes != null) return Number((durationMinutes / 60).toFixed(3));

    return null;
}

function extractRuleTriggers(clinicalCase: LearningCaseRecord): string[] {
    const telemetry = clinicalCase.latest_input_signature?.telemetry;
    if (typeof telemetry !== 'object' || telemetry === null || Array.isArray(telemetry)) {
        return [];
    }

    const telemetryRecord = telemetry as Record<string, unknown>;
    const persistenceTriggers = telemetryRecord.persistence_rule_triggers;
    if (!Array.isArray(persistenceTriggers)) return [];

    return persistenceTriggers.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function readText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
