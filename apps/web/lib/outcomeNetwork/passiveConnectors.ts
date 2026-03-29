import { createHash } from 'crypto';

export type PassiveConnectorType =
    | 'lab_result'
    | 'prescription_refill'
    | 'recheck'
    | 'referral'
    | 'imaging_report';

export interface PassiveConnectorNormalizationInput {
    connectorType: PassiveConnectorType;
    vendorName?: string | null;
    patientId?: string | null;
    observedAt?: string | null;
    payload: Record<string, unknown>;
}

export interface PassiveConnectorNormalizationResult {
    signalType: string;
    signalSubtype: string | null;
    observedAt: string;
    payload: Record<string, unknown>;
    normalizedFacts: Record<string, unknown>;
    confidence: number | null;
    dedupeKey: string;
    primaryConditionClass: string | null;
    episodeStatus: string | null;
    outcomeState: string | null;
    resolvedAt: string | null;
    summaryPatch: Record<string, unknown>;
}

export function normalizePassiveConnectorPayload(
    input: PassiveConnectorNormalizationInput,
): PassiveConnectorNormalizationResult {
    const observedAt = normalizeTimestamp(input.observedAt)
        ?? normalizeTimestamp(readText(input.payload, ['observed_at', 'timestamp', 'resulted_at', 'completed_at']))
        ?? new Date().toISOString();

    switch (input.connectorType) {
        case 'lab_result':
            return normalizeLabResult(input, observedAt);
        case 'prescription_refill':
            return normalizePrescriptionRefill(input, observedAt);
        case 'recheck':
            return normalizeRecheck(input, observedAt);
        case 'referral':
            return normalizeReferral(input, observedAt);
        case 'imaging_report':
            return normalizeImagingReport(input, observedAt);
        default:
            return normalizeLabResult(input, observedAt);
    }
}

function normalizeLabResult(
    input: PassiveConnectorNormalizationInput,
    observedAt: string,
): PassiveConnectorNormalizationResult {
    const analyte = readText(input.payload, ['analyte', 'test_name', 'panel_name', 'panel']);
    const abnormal = readBoolean(input.payload, ['abnormal', 'is_abnormal']) ?? false;
    const critical = readBoolean(input.payload, ['critical', 'is_critical']) ?? false;
    const conditionClass = readText(input.payload, ['primary_condition_class', 'condition_class']);
    const signalSubtype = critical
        ? 'critical_result'
        : abnormal
            ? 'abnormal_result'
            : 'result_received';
    const summaryPatch: Record<string, unknown> = {
        latest_passive_connector: 'lab_result',
        latest_lab_result_at: observedAt,
        latest_lab_signal_type: signalSubtype,
        latest_lab_analyte: analyte,
    };

    return {
        signalType: 'lab_result',
        signalSubtype,
        observedAt,
        payload: input.payload,
        normalizedFacts: {
            connector_type: 'lab_result',
            vendor_name: input.vendorName ?? null,
            analyte,
            abnormal,
            critical,
            result_status: readText(input.payload, ['status', 'result_status']),
            value: readScalar(input.payload, ['value', 'result_value']),
            units: readText(input.payload, ['units', 'unit']),
            reference_range: readText(input.payload, ['reference_range']),
            primary_condition_class: conditionClass,
        },
        confidence: critical ? 0.99 : abnormal ? 0.92 : 0.86,
        dedupeKey: buildConnectorDedupeKey(input, observedAt),
        primaryConditionClass: conditionClass,
        episodeStatus: critical || abnormal ? 'monitoring' : 'open',
        outcomeState: null,
        resolvedAt: null,
        summaryPatch,
    };
}

function normalizePrescriptionRefill(
    input: PassiveConnectorNormalizationInput,
    observedAt: string,
): PassiveConnectorNormalizationResult {
    const medication = readText(input.payload, ['medication', 'medication_name', 'drug_name']);
    const refillStatus = readText(input.payload, ['status', 'refill_status']) ?? 'requested';
    const overdue = readBoolean(input.payload, ['overdue', 'is_overdue']) ?? false;
    const adherent = readBoolean(input.payload, ['adherent', 'is_adherent']);
    const conditionClass = readText(input.payload, ['primary_condition_class', 'condition_class']);

    return {
        signalType: 'medication',
        signalSubtype: 'refill',
        observedAt,
        payload: input.payload,
        normalizedFacts: {
            connector_type: 'prescription_refill',
            vendor_name: input.vendorName ?? null,
            medication,
            refill_status: refillStatus,
            days_remaining: readNumber(input.payload, ['days_remaining']),
            overdue,
            adherent,
            primary_condition_class: conditionClass,
        },
        confidence: adherent == null ? 0.74 : 0.84,
        dedupeKey: buildConnectorDedupeKey(input, observedAt),
        primaryConditionClass: conditionClass,
        episodeStatus: overdue ? 'monitoring' : 'open',
        outcomeState: null,
        resolvedAt: null,
        summaryPatch: {
            latest_passive_connector: 'prescription_refill',
            latest_medication_refill_at: observedAt,
            latest_medication_name: medication,
            latest_refill_status: refillStatus,
        },
    };
}

function normalizeRecheck(
    input: PassiveConnectorNormalizationInput,
    observedAt: string,
): PassiveConnectorNormalizationResult {
    const status = readText(input.payload, ['status', 'appointment_status', 'recheck_status']) ?? 'scheduled';
    const completed = readBoolean(input.payload, ['completed', 'is_completed']) ?? (status === 'completed');
    const missed = readBoolean(input.payload, ['no_show', 'missed']) ?? (status === 'missed' || status === 'no_show');
    const resolved = readBoolean(input.payload, ['resolved', 'clinically_resolved']) ?? (status === 'resolved');
    const conditionClass = readText(input.payload, ['primary_condition_class', 'condition_class']);

    return {
        signalType: 'follow_up',
        signalSubtype: missed
            ? 'missed_recheck'
            : completed
                ? 'completed_recheck'
                : 'scheduled_recheck',
        observedAt,
        payload: input.payload,
        normalizedFacts: {
            connector_type: 'recheck',
            vendor_name: input.vendorName ?? null,
            recheck_status: status,
            scheduled_for: readText(input.payload, ['scheduled_for', 'scheduled_at']),
            completed,
            missed,
            resolved,
            owner_notes: readText(input.payload, ['owner_notes']),
            primary_condition_class: conditionClass,
        },
        confidence: resolved ? 0.93 : completed ? 0.84 : 0.72,
        dedupeKey: buildConnectorDedupeKey(input, observedAt),
        primaryConditionClass: conditionClass,
        episodeStatus: resolved ? 'resolved' : missed ? 'monitoring' : 'open',
        outcomeState: resolved ? 'resolved' : null,
        resolvedAt: resolved ? observedAt : null,
        summaryPatch: {
            latest_passive_connector: 'recheck',
            latest_recheck_at: observedAt,
            latest_recheck_status: status,
        },
    };
}

function normalizeReferral(
    input: PassiveConnectorNormalizationInput,
    observedAt: string,
): PassiveConnectorNormalizationResult {
    const urgency = readText(input.payload, ['urgency']) ?? 'routine';
    const destination = readText(input.payload, ['destination', 'specialty_service', 'hospital']);
    const accepted = readBoolean(input.payload, ['accepted', 'is_accepted']);
    const conditionClass = readText(input.payload, ['primary_condition_class', 'condition_class']);

    return {
        signalType: 'referral',
        signalSubtype: urgency.toLowerCase() === 'urgent' ? 'urgent_referral' : 'referral',
        observedAt,
        payload: input.payload,
        normalizedFacts: {
            connector_type: 'referral',
            vendor_name: input.vendorName ?? null,
            urgency,
            destination,
            accepted,
            reason: readText(input.payload, ['reason', 'referral_reason']),
            primary_condition_class: conditionClass,
        },
        confidence: accepted == null ? 0.78 : 0.88,
        dedupeKey: buildConnectorDedupeKey(input, observedAt),
        primaryConditionClass: conditionClass,
        episodeStatus: 'monitoring',
        outcomeState: null,
        resolvedAt: null,
        summaryPatch: {
            latest_passive_connector: 'referral',
            latest_referral_at: observedAt,
            latest_referral_destination: destination,
            latest_referral_urgency: urgency,
        },
    };
}

function normalizeImagingReport(
    input: PassiveConnectorNormalizationInput,
    observedAt: string,
): PassiveConnectorNormalizationResult {
    const modality = readText(input.payload, ['modality', 'study_type']) ?? 'imaging';
    const abnormal = readBoolean(input.payload, ['abnormal', 'is_abnormal']) ?? false;
    const conditionClass = readText(input.payload, ['primary_condition_class', 'condition_class']);

    return {
        signalType: 'imaging',
        signalSubtype: abnormal ? 'abnormal_report' : 'report_received',
        observedAt,
        payload: input.payload,
        normalizedFacts: {
            connector_type: 'imaging_report',
            vendor_name: input.vendorName ?? null,
            modality,
            abnormal,
            impression: readText(input.payload, ['impression', 'summary']),
            primary_condition_class: conditionClass,
        },
        confidence: abnormal ? 0.9 : 0.82,
        dedupeKey: buildConnectorDedupeKey(input, observedAt),
        primaryConditionClass: conditionClass,
        episodeStatus: abnormal ? 'monitoring' : 'open',
        outcomeState: null,
        resolvedAt: null,
        summaryPatch: {
            latest_passive_connector: 'imaging_report',
            latest_imaging_report_at: observedAt,
            latest_imaging_modality: modality,
        },
    };
}

function buildConnectorDedupeKey(
    input: PassiveConnectorNormalizationInput,
    observedAt: string,
) {
    const externalId = readText(input.payload, [
        'external_id',
        'event_id',
        'accession_id',
        'refill_id',
        'appointment_id',
        'referral_id',
        'report_id',
        'id',
    ]);
    const digest = createHash('sha256')
        .update([
            input.connectorType,
            input.vendorName ?? 'unknown_vendor',
            input.patientId ?? 'unknown_patient',
            observedAt,
            externalId ?? JSON.stringify(input.payload),
        ].join('|'))
        .digest('hex')
        .slice(0, 28);

    return `connector:${input.connectorType}:${digest}`;
}

function readText(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}

function readBoolean(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
            if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
        }
    }
    return null;
}

function readNumber(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return null;
}

function readScalar(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
    }
    return null;
}

function normalizeTimestamp(value: string | null | undefined) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
