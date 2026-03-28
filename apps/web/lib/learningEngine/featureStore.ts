import { normalizeSingleSymptomToken } from '@/lib/clinicalCases/symptomOntology';
import { DEFAULT_FEATURE_SCHEMA_VERSION, type CaseFeatureVector, type LearningCaseRecord } from '@/lib/learningEngine/types';

export function vectorizeClinicalCase(
    clinicalCase: LearningCaseRecord,
    featureSchemaVersion: string = DEFAULT_FEATURE_SCHEMA_VERSION,
): CaseFeatureVector {
    const metadata = clinicalCase.patient_metadata ?? {};
    const signature = clinicalCase.latest_input_signature ?? {};
    const antigravitySignal = extractAntigravitySignal(metadata, signature);
    const patientHistory = readRecord(antigravitySignal?.patient_history);
    const derivedSignals = readRecord(antigravitySignal?.derived_signals);
    const ageYears = deriveAgeYears(metadata, signature, patientHistory);
    const durationHours = deriveDurationHours(metadata, signature, patientHistory);
    const temporalPattern = readStringArray(derivedSignals?.temporal_pattern);
    const onsetPattern = readText(
        metadata.onset_pattern ??
        signature.onset_pattern ??
        patientHistory?.onset ??
        metadata.presentation_onset ??
        temporalPattern[0],
    );
    const progressionPattern = readText(
        metadata.progression_pattern ??
        signature.progression_pattern ??
        patientHistory?.progression,
    );
    const environment = readText(
        metadata.environment ??
        signature.environment ??
        patientHistory?.environment,
    );
    const sex = readText(
        metadata.sex ??
        signature.sex ??
        patientHistory?.sex_reproductive_status,
    );
    const priorConfidence = clinicalCase.degraded_confidence ?? clinicalCase.diagnosis_confidence ?? null;
    const contradictionScore = clinicalCase.contradiction_score ?? 0;
    const ruleTriggers = extractRuleTriggers(clinicalCase);
    const exposureRisks = informativeStrings(readStringArray(derivedSignals?.exposure_risks));
    const breedRisks = informativeStrings(readStringArray(derivedSignals?.breed_risk));
    const systemicInvolvement = informativeStrings(readStringArray(derivedSignals?.systemic_involvement));
    const urgencySignals = informativeStrings(readStringArray(derivedSignals?.urgency_signals));
    const reproductiveRelevance = informativeStrings(readStringArray(derivedSignals?.reproductive_relevance));
    const missingFields = informativeStrings(readStringArray(antigravitySignal?.missing_fields));
    const signalQualityScore = readNumber(
        metadata.signal_quality_score ??
        antigravitySignal?.signal_quality_score ??
        readRecord(signature.metadata)?.signal_quality_score,
    );

    return {
        case_id: clinicalCase.case_id,
        feature_schema_version: featureSchemaVersion,
        raw_snapshot: {
            patient_metadata: metadata,
            latest_input_signature: signature,
            symptom_text_raw: clinicalCase.symptom_text_raw,
            contradiction_flags: clinicalCase.contradiction_flags,
            uncertainty_notes: clinicalCase.uncertainty_notes,
            antigravity_signal: antigravitySignal,
        },
        dense_features: {
            species_canonical: clinicalCase.species_canonical,
            species_display: clinicalCase.species_display,
            breed: clinicalCase.breed,
            age_years: ageYears,
            sex,
            onset_pattern: onsetPattern,
            progression_pattern: progressionPattern,
            temporal_pattern_primary: temporalPattern[0] ?? null,
            duration_hours: durationHours,
            environment,
            contradiction_score: contradictionScore,
            contradiction_flag_count: clinicalCase.contradiction_flags.length,
            adversarial_case: clinicalCase.adversarial_case,
            prior_inference_confidence: priorConfidence,
            emergency_level: clinicalCase.emergency_level,
            rule_trigger_count: ruleTriggers.length,
            case_cluster: clinicalCase.case_cluster,
            primary_condition_class: clinicalCase.primary_condition_class,
            signal_quality_score: signalQualityScore,
            exposure_risk_count: exposureRisks.length,
            breed_risk_count: breedRisks.length,
            systemic_involvement_count: systemicInvolvement.length,
            urgency_signal_count: urgencySignals.length,
            reproductive_relevance_count: reproductiveRelevance.length,
            missing_field_count: missingFields.length,
            exposure_primary: exposureRisks[0] ?? null,
            systemic_primary: systemicInvolvement[0] ?? null,
            urgency_primary: urgencySignals[0] ?? null,
        },
        symptom_flags: {
            ...clinicalCase.symptom_vector_normalized,
            ...Object.fromEntries(clinicalCase.symptom_keys.map((key) => [key, true])),
            ...extractAntigravityFlags(antigravitySignal),
        },
    };
}

function deriveAgeYears(
    metadata: Record<string, unknown>,
    signature: Record<string, unknown>,
    patientHistory: Record<string, unknown> | null,
): number | null {
    const direct = readNumber(metadata.age_years ?? metadata.age ?? signature.age_years ?? signature.age);
    if (direct != null) return direct;

    const ageText = readText(patientHistory?.age);
    if (!ageText) return null;

    const match = ageText.match(/(\d+(?:\.\d+)?)\s*(year|month|week|day)/i);
    if (!match) return null;

    const value = Number.parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('month')) return Number((value / 12).toFixed(3));
    if (unit.startsWith('week')) return Number((value / 52).toFixed(3));
    if (unit.startsWith('day')) return Number((value / 365).toFixed(3));
    return value;
}

function deriveDurationHours(
    metadata: Record<string, unknown>,
    signature: Record<string, unknown>,
    patientHistory: Record<string, unknown> | null,
): number | null {
    const directHours = readNumber(metadata.duration_hours ?? signature.duration_hours);
    if (directHours != null) return directHours;

    const durationDays = readNumber(metadata.duration_days ?? signature.duration_days);
    if (durationDays != null) return Number((durationDays * 24).toFixed(3));

    const durationMinutes = readNumber(metadata.duration_minutes ?? signature.duration_minutes);
    if (durationMinutes != null) return Number((durationMinutes / 60).toFixed(3));

    const duration = readRecord(patientHistory?.duration);
    const value = readNumber(duration?.value);
    const unit = readText(duration?.unit);
    if (value == null || !unit) return null;

    if (unit.startsWith('day')) return Number((value * 24).toFixed(3));
    if (unit.startsWith('week')) return Number((value * 24 * 7).toFixed(3));
    if (unit.startsWith('month')) return Number((value * 24 * 30).toFixed(3));
    return value;
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

function extractAntigravitySignal(
    metadata: Record<string, unknown>,
    signature: Record<string, unknown>,
): Record<string, unknown> | null {
    if (readRecord(metadata.antigravity_signal)) {
        return readRecord(metadata.antigravity_signal);
    }

    const signatureMetadata = readRecord(signature.metadata);
    if (signatureMetadata && readRecord(signatureMetadata.antigravity_signal)) {
        return readRecord(signatureMetadata.antigravity_signal);
    }

    return null;
}

function extractAntigravityFlags(signal: Record<string, unknown> | null): Record<string, boolean> {
    if (!signal) return {};

    const flags: Record<string, boolean> = {
        antigravity_signal_present: true,
    };
    const symptomVector = readStringArray(signal.symptom_vector);
    const derivedSignals = readRecord(signal.derived_signals);
    const temporalPattern = readStringArray(derivedSignals?.temporal_pattern);
    const exposureRisks = informativeStrings(readStringArray(derivedSignals?.exposure_risks));
    const breedRisks = informativeStrings(readStringArray(derivedSignals?.breed_risk));
    const systemicInvolvement = informativeStrings(readStringArray(derivedSignals?.systemic_involvement));
    const urgencySignals = informativeStrings(readStringArray(derivedSignals?.urgency_signals));
    const reproductiveRelevance = informativeStrings(readStringArray(derivedSignals?.reproductive_relevance));
    const missingFields = informativeStrings(readStringArray(signal.missing_fields));
    const signalQualityScore = readNumber(signal.signal_quality_score);

    for (const entry of symptomVector) {
        const canonical = normalizeSingleSymptomToken(entry);
        flags[canonical ?? `ag_symptom_${normalizeToken(entry)}`] = true;
    }

    applyPrefixedFlags(flags, 'temporal', temporalPattern);
    applyPrefixedFlags(flags, 'exposure', exposureRisks);
    applyPrefixedFlags(flags, 'breed_risk', breedRisks);
    applyPrefixedFlags(flags, 'systemic', systemicInvolvement);
    applyPrefixedFlags(flags, 'urgency', urgencySignals);
    applyPrefixedFlags(flags, 'repro', reproductiveRelevance);
    applyPrefixedFlags(flags, 'missing', missingFields);

    if (signalQualityScore != null) {
        flags[
            signalQualityScore >= 0.8
                ? 'signal_quality_high'
                : signalQualityScore >= 0.5
                    ? 'signal_quality_medium'
                    : 'signal_quality_low'
        ] = true;
    }

    return flags;
}

function applyPrefixedFlags(
    target: Record<string, boolean>,
    prefix: string,
    values: string[],
): void {
    for (const value of values) {
        target[`${prefix}_${normalizeToken(value)}`] = true;
    }
}

function informativeStrings(values: string[]): string[] {
    return values.filter((value) => !['none', 'none_reported', 'none_identified', 'unknown', 'not_reported', 'undifferentiated'].includes(value));
}

function normalizeToken(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
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
