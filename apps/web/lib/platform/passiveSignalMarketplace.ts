export type PassiveConnectorReadiness = 'live' | 'beta' | 'planned';
export type PassiveConnectorSyncMode = 'webhook_push' | 'scheduled_pull' | 'manual_file_drop';

export interface PassiveSignalMarketplaceDefinition {
    id: string;
    label: string;
    vendor_name: string;
    readiness: PassiveConnectorReadiness;
    summary: string;
    sync_mode: PassiveConnectorSyncMode;
    auth_strategy: 'connector_installation_key' | 'partner_webhook' | 'service_account';
    default_interval_hours: number | null;
    supported_connector_types: string[];
    normalized_facts: string[];
    coverage_notes: string[];
    sample_schedule: string | null;
}

export const passiveSignalMarketplace: PassiveSignalMarketplaceDefinition[] = [
    {
        id: 'idexx-reference-labs',
        label: 'IDEXX Reference Labs',
        vendor_name: 'IDEXX',
        readiness: 'live',
        summary: 'Fleet-scale lab-result ingestion pack for reference-lab events, abnormality flags, and follow-up monitoring.',
        sync_mode: 'scheduled_pull',
        auth_strategy: 'connector_installation_key',
        default_interval_hours: 6,
        supported_connector_types: ['lab_result'],
        normalized_facts: ['analyte', 'value', 'units', 'reference_range', 'abnormal', 'critical'],
        coverage_notes: ['Ideal for recurring chemistry and CBC sync jobs.', 'Supports abnormal/critical escalation into passive monitoring.'],
        sample_schedule: 'Every 6 hours',
    },
    {
        id: 'antech-diagnostics',
        label: 'Antech Diagnostics',
        vendor_name: 'Antech',
        readiness: 'live',
        summary: 'Diagnostic lab connector pack for routed result ingestion and passive episode updates.',
        sync_mode: 'scheduled_pull',
        auth_strategy: 'connector_installation_key',
        default_interval_hours: 6,
        supported_connector_types: ['lab_result'],
        normalized_facts: ['analyte', 'value', 'units', 'abnormal', 'critical'],
        coverage_notes: ['Maps result batches into normalized lab_result signals.', 'Designed for multi-clinic diagnostic pull scheduling.'],
        sample_schedule: 'Every 6 hours',
    },
    {
        id: 'ezvet-clinic-ops',
        label: 'ezyVet Clinic Ops',
        vendor_name: 'ezyVet',
        readiness: 'beta',
        summary: 'PIMS sync pack for appointments, follow-up rechecks, referrals, medication refills, and imaging workflow events.',
        sync_mode: 'scheduled_pull',
        auth_strategy: 'connector_installation_key',
        default_interval_hours: 4,
        supported_connector_types: ['recheck', 'referral', 'prescription_refill', 'imaging_report'],
        normalized_facts: ['recheck_status', 'destination', 'refill_status', 'modality'],
        coverage_notes: ['Optimized for cloud PIMS polling windows.', 'Intended to turn day-to-day clinic workflow into passive outcome signals.'],
        sample_schedule: 'Every 4 hours',
    },
    {
        id: 'avimark-clinic-ops',
        label: 'AVImark Clinic Ops',
        vendor_name: 'AVImark',
        readiness: 'beta',
        summary: 'On-prem PIMS adapter pack for follow-up, refill, referral, and imaging workflow sync.',
        sync_mode: 'scheduled_pull',
        auth_strategy: 'connector_installation_key',
        default_interval_hours: 8,
        supported_connector_types: ['recheck', 'referral', 'prescription_refill', 'imaging_report'],
        normalized_facts: ['recheck_status', 'scheduled_for', 'refill_status', 'impression'],
        coverage_notes: ['Supports periodic sync through a connector installation webhook.', 'Designed for legacy clinic-system rollout without shared secrets.'],
        sample_schedule: 'Every 8 hours',
    },
    {
        id: 'cornerstone-spectrum',
        label: 'Cornerstone Spectrum',
        vendor_name: 'Cornerstone',
        readiness: 'beta',
        summary: 'PIMS workflow connector for referrals, imaging summaries, medication refill behavior, and recheck completion.',
        sync_mode: 'scheduled_pull',
        auth_strategy: 'connector_installation_key',
        default_interval_hours: 8,
        supported_connector_types: ['recheck', 'referral', 'prescription_refill', 'imaging_report'],
        normalized_facts: ['recheck_status', 'destination', 'refill_status', 'abnormal'],
        coverage_notes: ['Built for broad EHR/PIMS coverage across mixed clinic fleets.', 'Works with installation-scoped credentials and scheduled sync windows.'],
        sample_schedule: 'Every 8 hours',
    },
    {
        id: 'covetrus-pharmacy',
        label: 'Covetrus Pharmacy',
        vendor_name: 'Covetrus',
        readiness: 'live',
        summary: 'Medication refill and adherence sync pack for pharmacy-originated passive treatment signals.',
        sync_mode: 'webhook_push',
        auth_strategy: 'partner_webhook',
        default_interval_hours: null,
        supported_connector_types: ['prescription_refill'],
        normalized_facts: ['medication', 'refill_status', 'days_remaining', 'overdue', 'adherent'],
        coverage_notes: ['Designed for vendor webhooks that push refill lifecycle changes in real time.', 'Reuses installation-scoped credentials instead of tenant-wide shared secrets.'],
        sample_schedule: 'Event-driven webhook',
    },
    {
        id: 'smartflow-imaging',
        label: 'Smart Flow Imaging',
        vendor_name: 'Smart Flow',
        readiness: 'beta',
        summary: 'Imaging and treatment-workflow sync pack for passive report ingestion and abnormality monitoring.',
        sync_mode: 'webhook_push',
        auth_strategy: 'partner_webhook',
        default_interval_hours: null,
        supported_connector_types: ['imaging_report', 'recheck'],
        normalized_facts: ['modality', 'abnormal', 'impression', 'recheck_status'],
        coverage_notes: ['Good fit for event-driven imaging notifications.', 'Pairs imaging reports with downstream recheck state changes.'],
        sample_schedule: 'Event-driven webhook',
    },
];
