export interface PassiveSignalConnectorDefinition {
    id: string;
    label: string;
    readiness: 'live' | 'beta' | 'planned';
    sourceType: string;
    summary: string;
    normalizedFacts: string[];
    samplePayload: Record<string, unknown>;
}

export const passiveSignalConnectors: PassiveSignalConnectorDefinition[] = [
    {
        id: 'lab-result',
        label: 'Lab Result',
        readiness: 'live',
        sourceType: 'lab_result',
        summary: 'Normalizes analyte results, criticality, abnormality, and condition-class hints into passive monitoring signals.',
        normalizedFacts: ['analyte', 'value', 'units', 'reference_range', 'abnormal', 'critical'],
        samplePayload: {
            analyte: 'Creatinine',
            value: 2.1,
            units: 'mg/dL',
            reference_range: '0.5-1.8',
            abnormal: true,
            critical: false,
        },
    },
    {
        id: 'prescription-refill',
        label: 'Prescription Refill',
        readiness: 'live',
        sourceType: 'prescription_refill',
        summary: 'Tracks refill status, adherence hints, and overdue medication behavior as passive treatment signals.',
        normalizedFacts: ['medication', 'refill_status', 'days_remaining', 'overdue', 'adherent'],
        samplePayload: {
            medication_name: 'Prednisone',
            refill_status: 'requested',
            days_remaining: 2,
            overdue: false,
            adherent: true,
        },
    },
    {
        id: 'recheck',
        label: 'Recheck',
        readiness: 'live',
        sourceType: 'recheck',
        summary: 'Converts scheduled, completed, missed, and clinically resolved rechecks into episode state updates.',
        normalizedFacts: ['recheck_status', 'scheduled_for', 'completed', 'missed', 'resolved'],
        samplePayload: {
            appointment_status: 'completed',
            scheduled_for: '2026-04-02T16:00:00.000Z',
            clinically_resolved: false,
            owner_notes: 'Still mildly lethargic.',
        },
    },
    {
        id: 'referral',
        label: 'Referral',
        readiness: 'live',
        sourceType: 'referral',
        summary: 'Captures specialty escalation, urgency, and destination routing as passive referral signals.',
        normalizedFacts: ['urgency', 'destination', 'accepted', 'reason'],
        samplePayload: {
            urgency: 'urgent',
            specialty_service: 'Neurology',
            accepted: true,
            reason: 'Progressive neurologic deficits',
        },
    },
    {
        id: 'imaging-report',
        label: 'Imaging Report',
        readiness: 'live',
        sourceType: 'imaging_report',
        summary: 'Normalizes modality, abnormality, and impression text into passive imaging signals.',
        normalizedFacts: ['modality', 'abnormal', 'impression'],
        samplePayload: {
            modality: 'radiograph',
            abnormal: true,
            impression: 'Thoracic nodules with pleural effusion',
        },
    },
    {
        id: 'pims-sync',
        label: 'PIMS Sync',
        readiness: 'planned',
        sourceType: 'pims_sync',
        summary: 'Planned turnkey scheduling and record sync layer for clinic systems that do not yet push normalized events.',
        normalizedFacts: ['appointments', 'invoice_events', 'medication_fills'],
        samplePayload: {
            sync_batch_id: 'planned',
        },
    },
];
