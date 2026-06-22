import type { PassiveConnectorType } from '@/lib/outcomeNetwork/passiveConnectors';

export interface PimsWorkflowNormalizationInput {
    connectorType?: PassiveConnectorType | null;
    vendorName?: string | null;
    vendorEventType?: string | null;
    payload: Record<string, unknown>;
}

export interface PimsWorkflowNormalizationResult {
    connectorType: PassiveConnectorType;
    payload: Record<string, unknown>;
    vendorEventType: string | null;
    normalizedBy: 'explicit_connector_type' | 'pims_workflow_adapter';
    warnings: string[];
}

export function resolvePassiveConnectorWorkflow(
    input: PimsWorkflowNormalizationInput,
): PimsWorkflowNormalizationResult {
    if (input.connectorType) {
        return {
            connectorType: input.connectorType,
            payload: input.payload,
            vendorEventType: normalizeOptionalText(input.vendorEventType)
                ?? readText(input.payload, EVENT_TYPE_KEYS),
            normalizedBy: 'explicit_connector_type',
            warnings: [],
        };
    }

    const vendorEventType = normalizeOptionalText(input.vendorEventType)
        ?? readText(input.payload, EVENT_TYPE_KEYS);
    const connectorType = inferConnectorType(input.vendorName, vendorEventType, input.payload);
    if (!connectorType) {
        throw new Error('PIMS workflow event could not be mapped to a VetIOS passive connector type. Provide connector.connector_type or connector.workflow_event_type.');
    }

    return {
        connectorType,
        payload: buildConnectorPayload({
            connectorType,
            vendorName: input.vendorName ?? null,
            vendorEventType,
            payload: input.payload,
        }),
        vendorEventType,
        normalizedBy: 'pims_workflow_adapter',
        warnings: [],
    };
}

const EVENT_TYPE_KEYS = [
    'workflow_event_type',
    'event_type',
    'event',
    'resource_type',
    'resource',
    'object_type',
    'type',
    'kind',
    'action',
    'resource.type',
    'resource.name',
    'data.type',
    'data.resource_type',
];

function inferConnectorType(
    vendorName: string | null | undefined,
    vendorEventType: string | null,
    payload: Record<string, unknown>,
): PassiveConnectorType | null {
    const searchText = normalizeSearchText([
        vendorName,
        vendorEventType,
        readText(payload, EVENT_TYPE_KEYS),
        readText(payload, ['appointment_type', 'visit_type', 'reason', 'reason_for_visit', 'subject']),
        readText(payload, ['category', 'subcategory', 'department', 'service', 'source']),
        readText(payload, ['product_type', 'order_type', 'document_type', 'report_type']),
    ]);

    if (hasAny(searchText, ['referral', 'refer', 'specialist', 'specialty', 'transfer'])) {
        return 'referral';
    }

    if (hasAny(searchText, ['refill', 'pharmacy', 'prescription', 'rx', 'medication', 'dispense'])) {
        return 'prescription_refill';
    }

    if (hasAny(searchText, ['radiograph', 'xray', 'x-ray', 'ultrasound', 'imaging', 'image', 'dicom', 'ct ', 'mri', 'study report'])) {
        return 'imaging_report';
    }

    if (hasAny(searchText, ['lab', 'laboratory', 'pathology', 'cbc', 'chemistry', 'urinalysis', 'diagnostic result'])) {
        return 'lab_result';
    }

    if (hasAny(searchText, ['appointment', 'booking', 'recheck', 're-check', 'follow up', 'follow-up', 'recall', 'reminder', 'consult'])) {
        return 'recheck';
    }

    return null;
}

function buildConnectorPayload(input: {
    connectorType: PassiveConnectorType;
    vendorName: string | null;
    vendorEventType: string | null;
    payload: Record<string, unknown>;
}): Record<string, unknown> {
    const basePayload = {
        ...input.payload,
        vendor_workflow: {
            vendor_name: input.vendorName,
            event_type: input.vendorEventType,
            normalized_by: 'pims_workflow_adapter',
        },
    };

    switch (input.connectorType) {
        case 'lab_result': {
            const abnormalFlag = readText(input.payload, ['abnormal_flag', 'flag', 'interpretation']);
            const criticalFlag = readText(input.payload, ['critical_flag', 'panic_flag']);
            const abnormal = readBoolean(input.payload, ['abnormal', 'is_abnormal', 'flagged'])
                ?? inferLabAbnormalFlag(abnormalFlag);
            const critical = readBoolean(input.payload, ['critical', 'is_critical'])
                ?? inferLabCriticalFlag(criticalFlag ?? abnormalFlag);
            return {
                ...basePayload,
                analyte: readText(input.payload, ['analyte', 'test_name', 'panel_name', 'panel', 'name']),
                value: readScalar(input.payload, ['value', 'result_value', 'result']),
                units: readText(input.payload, ['units', 'unit']),
                reference_range: readText(input.payload, ['reference_range', 'range']),
                abnormal,
                critical,
                abnormal_flag: abnormalFlag,
                primary_condition_class: readText(input.payload, ['primary_condition_class', 'condition_class', 'diagnosis_class']),
            };
        }
        case 'prescription_refill':
            return {
                ...basePayload,
                medication: readText(input.payload, ['medication', 'medication_name', 'drug_name', 'product_name', 'item_name', 'prescription.name', 'product.name']),
                status: readText(input.payload, ['status', 'refill_status', 'order_status', 'fulfillment_status']) ?? inferRefillStatus(input.vendorEventType, input.payload),
                days_remaining: readNumber(input.payload, ['days_remaining', 'days_supply_remaining']),
                overdue: readBoolean(input.payload, ['overdue', 'is_overdue']),
                adherent: readBoolean(input.payload, ['adherent', 'is_adherent']),
                primary_condition_class: readText(input.payload, ['primary_condition_class', 'condition_class', 'diagnosis_class']),
            };
        case 'recheck':
            return {
                ...basePayload,
                status: readText(input.payload, ['status', 'appointment_status', 'booking_status', 'visit_status']) ?? inferRecheckStatus(input.vendorEventType, input.payload),
                scheduled_for: readText(input.payload, ['scheduled_for', 'scheduled_at', 'start_at', 'start_time', 'appointment_at', 'appointment_time']),
                completed: readBoolean(input.payload, ['completed', 'is_completed', 'checked_out']),
                no_show: readBoolean(input.payload, ['no_show', 'missed', 'is_no_show']),
                resolved: readBoolean(input.payload, ['resolved', 'clinically_resolved', 'condition_resolved']),
                owner_notes: readText(input.payload, ['owner_notes', 'notes', 'summary', 'memo']),
                primary_condition_class: readText(input.payload, ['primary_condition_class', 'condition_class', 'diagnosis_class', 'reason_class']),
            };
        case 'referral':
            return {
                ...basePayload,
                urgency: readText(input.payload, ['urgency', 'priority']) ?? inferReferralUrgency(input.payload),
                destination: readText(input.payload, ['destination', 'specialty_service', 'hospital', 'referral_hospital', 'provider_name', 'clinic_name']),
                accepted: readBoolean(input.payload, ['accepted', 'is_accepted']),
                reason: readText(input.payload, ['reason', 'referral_reason', 'summary', 'notes']),
                primary_condition_class: readText(input.payload, ['primary_condition_class', 'condition_class', 'diagnosis_class']),
            };
        case 'imaging_report':
            return {
                ...basePayload,
                modality: readText(input.payload, ['modality', 'study_type', 'image_type']) ?? inferImagingModality(input.vendorEventType, input.payload),
                abnormal: readBoolean(input.payload, ['abnormal', 'is_abnormal', 'flagged']),
                impression: readText(input.payload, ['impression', 'summary', 'report_text', 'findings']),
                primary_condition_class: readText(input.payload, ['primary_condition_class', 'condition_class', 'diagnosis_class']),
            };
        default:
            return basePayload;
    }
}

function inferRecheckStatus(eventType: string | null, payload: Record<string, unknown>): string {
    const text = normalizeSearchText([eventType, readText(payload, ['status', 'action', 'event_type'])]);
    if (hasAny(text, ['no show', 'no_show', 'missed'])) return 'missed';
    if (hasAny(text, ['complete', 'completed', 'checked out', 'finished'])) return 'completed';
    if (hasAny(text, ['cancel', 'cancelled', 'canceled'])) return 'cancelled';
    return 'scheduled';
}

function inferLabAbnormalFlag(flag: string | null): boolean | null {
    if (!flag) return null;
    const normalized = flag.trim().toLowerCase();
    if (['h', 'l', 'hh', 'll', 'high', 'low', 'abnormal', 'positive', 'detected', 'critical'].includes(normalized)) {
        return true;
    }
    if (['n', 'normal', 'negative', 'not detected', 'none'].includes(normalized)) return false;
    return null;
}

function inferLabCriticalFlag(flag: string | null): boolean | null {
    if (!flag) return null;
    const normalized = flag.trim().toLowerCase();
    if (['hh', 'll', 'critical', 'panic'].includes(normalized)) return true;
    return null;
}

function inferRefillStatus(eventType: string | null, payload: Record<string, unknown>): string {
    const text = normalizeSearchText([eventType, readText(payload, ['status', 'action', 'event_type'])]);
    if (hasAny(text, ['requested', 'request'])) return 'requested';
    if (hasAny(text, ['approved', 'authorized'])) return 'approved';
    if (hasAny(text, ['filled', 'dispensed', 'shipped'])) return 'filled';
    if (hasAny(text, ['declined', 'denied', 'rejected'])) return 'declined';
    return 'requested';
}

function inferReferralUrgency(payload: Record<string, unknown>): string {
    const text = normalizeSearchText([readText(payload, ['reason', 'summary', 'notes', 'priority'])]);
    return hasAny(text, ['urgent', 'emergency', 'stat']) ? 'urgent' : 'routine';
}

function inferImagingModality(eventType: string | null, payload: Record<string, unknown>): string {
    const text = normalizeSearchText([eventType, readText(payload, ['modality', 'study_type', 'image_type', 'summary'])]);
    if (hasAny(text, ['ultrasound', 'us '])) return 'ultrasound';
    if (hasAny(text, ['ct ', 'computed tomography'])) return 'ct';
    if (hasAny(text, ['mri'])) return 'mri';
    if (hasAny(text, ['radiograph', 'xray', 'x-ray'])) return 'radiograph';
    return 'imaging';
}

function normalizeSearchText(values: Array<unknown>): string {
    return values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase().replace(/[_-]+/g, ' '))
        .join(' ');
}

function hasAny(text: string, needles: string[]): boolean {
    return needles.some((needle) => text.includes(needle));
}

function readText(source: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = readPath(source, key);
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
    }
    return null;
}

function readBoolean(source: Record<string, unknown>, keys: string[]): boolean | null {
    for (const key of keys) {
        const value = readPath(source, key);
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
            if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
        }
        if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
        }
    }
    return null;
}

function readNumber(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = readPath(source, key);
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return null;
}

function readScalar(source: Record<string, unknown>, keys: string[]): string | number | boolean | null {
    for (const key of keys) {
        const value = readPath(source, key);
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
    }
    return null;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[segment];
    }, source);
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
