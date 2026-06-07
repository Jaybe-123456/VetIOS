import type { PassiveConnectorReadiness, PassiveConnectorSyncMode } from '@/lib/platform/passiveSignalMarketplace';

export type NativeVendorAdapterType = 'pims' | 'lab' | 'pharmacy' | 'imaging';
export type NativeVendorAuthProtocol = 'oauth2_pkce' | 'oauth2_client_credentials' | 'api_key' | 'sftp_drop';

export interface NativeVendorAdapterDefinition {
    adapter_key: string;
    display_name: string;
    vendor_name: string;
    adapter_type: NativeVendorAdapterType;
    readiness: PassiveConnectorReadiness;
    auth_protocol: NativeVendorAuthProtocol;
    sync_mode: PassiveConnectorSyncMode;
    default_interval_hours: number | null;
    supported_connector_types: string[];
    normalized_facts: string[];
    vendor_contract_required: boolean;
    summary: string;
    privacy_notes: string[];
    setup_steps: string[];
}

export const nativeVendorAdapters: NativeVendorAdapterDefinition[] = [
    {
        adapter_key: 'idexx-vetconnect-plus-native',
        display_name: 'IDEXX VetConnect PLUS Native',
        vendor_name: 'IDEXX',
        adapter_type: 'lab',
        readiness: 'beta',
        auth_protocol: 'oauth2_client_credentials',
        sync_mode: 'scheduled_pull',
        default_interval_hours: 6,
        supported_connector_types: ['lab_result'],
        normalized_facts: ['analyte', 'value', 'units', 'reference_range', 'abnormal', 'critical'],
        vendor_contract_required: true,
        summary: 'Native lab-result adapter path for IDEXX account-level result polling and clinic-result reconciliation.',
        privacy_notes: ['Store only token hashes and account references.', 'Normalize lab results before episode reconciliation.', 'Do not require patient owner contact data.'],
        setup_steps: ['Register VetIOS as a vendor application.', 'Add clinic account reference.', 'Complete vendor credential exchange.', 'Run first scheduled pull.'],
    },
    {
        adapter_key: 'antech-online-native',
        display_name: 'Antech Online Native',
        vendor_name: 'Antech',
        adapter_type: 'lab',
        readiness: 'beta',
        auth_protocol: 'oauth2_client_credentials',
        sync_mode: 'scheduled_pull',
        default_interval_hours: 6,
        supported_connector_types: ['lab_result'],
        normalized_facts: ['analyte', 'value', 'units', 'abnormal', 'critical'],
        vendor_contract_required: true,
        summary: 'Native diagnostic-result polling path for Antech result batches, critical flags, and follow-up monitoring.',
        privacy_notes: ['Hash credential material before storage.', 'Persist vendor account refs, not raw login material.', 'Map results into normalized passive lab events.'],
        setup_steps: ['Approve clinic lab account access.', 'Register adapter credentials.', 'Set polling cadence.', 'Verify normalized lab-result delivery.'],
    },
    {
        adapter_key: 'ezyvet-api-native',
        display_name: 'ezyVet API Native',
        vendor_name: 'ezyVet',
        adapter_type: 'pims',
        readiness: 'beta',
        auth_protocol: 'oauth2_pkce',
        sync_mode: 'scheduled_pull',
        default_interval_hours: 4,
        supported_connector_types: ['recheck', 'referral', 'prescription_refill', 'imaging_report'],
        normalized_facts: ['appointment_status', 'scheduled_for', 'invoice_events', 'refill_status', 'modality'],
        vendor_contract_required: true,
        summary: 'Cloud PIMS adapter for appointment, refill, referral, and imaging workflow sync through a native authorization handoff.',
        privacy_notes: ['Use OAuth state hashes.', 'Ingest clinical workflow state only.', 'Keep owner identifiers outside adapter readiness metrics.'],
        setup_steps: ['Start authorization handoff.', 'Clinic approves VetIOS access.', 'Exchange code in adapter runtime.', 'Schedule recurring workflow sync.'],
    },
    {
        adapter_key: 'avimark-ondemand-native',
        display_name: 'AVImark On-Demand Native',
        vendor_name: 'AVImark',
        adapter_type: 'pims',
        readiness: 'beta',
        auth_protocol: 'api_key',
        sync_mode: 'scheduled_pull',
        default_interval_hours: 8,
        supported_connector_types: ['recheck', 'referral', 'prescription_refill', 'imaging_report'],
        normalized_facts: ['appointment_status', 'refill_status', 'destination', 'impression'],
        vendor_contract_required: true,
        summary: 'Legacy/on-prem PIMS adapter path for clinic workflow exports and connector-runtime polling.',
        privacy_notes: ['Use installation-scoped adapter credentials.', 'Hash access material.', 'Prefer de-identified patient refs.'],
        setup_steps: ['Provision clinic-side adapter runtime.', 'Enter vendor account reference.', 'Register hashed credential reference.', 'Run sync verification.'],
    },
    {
        adapter_key: 'cornerstone-native',
        display_name: 'Cornerstone Native',
        vendor_name: 'Cornerstone',
        adapter_type: 'pims',
        readiness: 'beta',
        auth_protocol: 'api_key',
        sync_mode: 'scheduled_pull',
        default_interval_hours: 8,
        supported_connector_types: ['recheck', 'referral', 'prescription_refill', 'imaging_report'],
        normalized_facts: ['appointment_status', 'refill_status', 'destination', 'abnormal'],
        vendor_contract_required: true,
        summary: 'Native PIMS adapter path for mixed clinic fleets using Cornerstone workflow records.',
        privacy_notes: ['Scope credentials to one clinic installation.', 'Avoid owner contact fields.', 'Normalize workflow state before learning use.'],
        setup_steps: ['Create adapter runtime.', 'Attach clinic account ref.', 'Validate supported workflow exports.', 'Schedule sync.'],
    },
    {
        adapter_key: 'covetrus-pharmacy-native',
        display_name: 'Covetrus Pharmacy Native',
        vendor_name: 'Covetrus',
        adapter_type: 'pharmacy',
        readiness: 'live',
        auth_protocol: 'oauth2_client_credentials',
        sync_mode: 'webhook_push',
        default_interval_hours: null,
        supported_connector_types: ['prescription_refill'],
        normalized_facts: ['medication', 'refill_status', 'days_remaining', 'overdue', 'adherent'],
        vendor_contract_required: true,
        summary: 'Native pharmacy-event adapter path for refill lifecycle, adherence hints, and passive treatment signals.',
        privacy_notes: ['Store hashed credential references only.', 'Use webhook delivery for event timing.', 'Keep raw owner contact data out of VetIOS readiness metrics.'],
        setup_steps: ['Register webhook endpoint with vendor.', 'Attach installation credential.', 'Verify event signature.', 'Monitor refill signal delivery.'],
    },
];

export function getNativeVendorAdapter(adapterKey: string): NativeVendorAdapterDefinition | null {
    return nativeVendorAdapters.find((adapter) => adapter.adapter_key === adapterKey) ?? null;
}
