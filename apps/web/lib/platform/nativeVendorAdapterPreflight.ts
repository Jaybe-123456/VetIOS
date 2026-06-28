import { createHash } from 'crypto';
import type { PassiveConnectorReadiness, PassiveConnectorSyncMode } from '@/lib/platform/passiveSignalMarketplace';
import {
    getNativeVendorAdapter,
    type NativeVendorAdapterType,
    type NativeVendorAuthProtocol,
} from '@/lib/platform/nativeVendorAdapters';

export type NativeVendorAdapterPreflightStatus = 'ready' | 'needs_authorization' | 'blocked';

export interface NativeVendorAdapterPreflightInput {
    adapterKey: string;
    vendorAccountRef?: string | null;
    credentialRefHash?: string | null;
    contractAttested?: boolean | null;
    requestedScopes?: string[] | null;
    adapterRuntimeUrl?: string | null;
    now?: string;
}

export interface NativeVendorAdapterPreflightPacket {
    schema_version: 'native-vendor-adapter-preflight-v1';
    status: NativeVendorAdapterPreflightStatus;
    generated_at: string;
    adapter_key: string;
    display_name: string | null;
    vendor_name: string | null;
    adapter_type: NativeVendorAdapterType | null;
    readiness: PassiveConnectorReadiness | null;
    auth_protocol: NativeVendorAuthProtocol | null;
    sync_mode: PassiveConnectorSyncMode | null;
    supported_connector_types: string[];
    normalized_facts: string[];
    required_scopes: string[];
    granted_scopes: string[];
    missing_scopes: string[];
    vendor_contract_required: boolean;
    vendor_contract_attested: boolean;
    vendor_account_ref_hash: string | null;
    adapter_runtime_configured: boolean;
    credential_ref_hash_present: boolean;
    production_sync_ready: boolean;
    preflight_score: number;
    blockers: string[];
    warnings: string[];
    privacy_boundary: {
        credential_material_stored: false;
        credential_hash_only: boolean;
        raw_vendor_payload_stored: false;
        owner_contact_required: false;
        vendor_account_ref_hashed: boolean;
    };
}

export function buildNativeVendorAdapterPreflight(
    input: NativeVendorAdapterPreflightInput,
): NativeVendorAdapterPreflightPacket {
    const adapter = getNativeVendorAdapter(input.adapterKey);
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    if (!adapter) {
        blockers.add('native_adapter_not_found');
        return {
            schema_version: 'native-vendor-adapter-preflight-v1',
            status: 'blocked',
            generated_at: input.now ?? new Date().toISOString(),
            adapter_key: input.adapterKey,
            display_name: null,
            vendor_name: null,
            adapter_type: null,
            readiness: null,
            auth_protocol: null,
            sync_mode: null,
            supported_connector_types: [],
            normalized_facts: [],
            required_scopes: [],
            granted_scopes: normalizeScopes(input.requestedScopes),
            missing_scopes: [],
            vendor_contract_required: false,
            vendor_contract_attested: false,
            vendor_account_ref_hash: null,
            adapter_runtime_configured: false,
            credential_ref_hash_present: false,
            production_sync_ready: false,
            preflight_score: 0,
            blockers: Array.from(blockers),
            warnings: [],
            privacy_boundary: buildNativePreflightPrivacyBoundary(null, null),
        };
    }

    const requiredScopes = ['signals:connect', 'signals:ingest'];
    const grantedScopes = normalizeScopes(input.requestedScopes);
    const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
    const vendorAccountRef = normalizeText(input.vendorAccountRef);
    const credentialRefHash = normalizeText(input.credentialRefHash);
    const runtimeUrl = normalizeText(input.adapterRuntimeUrl);
    const contractAttested = input.contractAttested === true || !adapter.vendor_contract_required;
    const credentialReady = Boolean(credentialRefHash);
    const runtimeRequired = adapter.sync_mode === 'scheduled_pull' || adapter.sync_mode === 'webhook_push';

    if (!vendorAccountRef) blockers.add('vendor_account_ref_missing');
    if (!contractAttested) blockers.add('vendor_contract_attestation_missing');
    if (runtimeRequired && !runtimeUrl) blockers.add('adapter_runtime_url_missing');
    for (const scope of missingScopes) blockers.add(`scope_missing:${scope}`);
    if (!credentialReady) warnings.add('credential_authorization_not_completed');
    if (adapter.readiness !== 'live') warnings.add(`adapter_catalog_readiness_${adapter.readiness}`);

    const productionSyncReady = blockers.size === 0 && credentialReady;
    const status: NativeVendorAdapterPreflightStatus = blockers.size > 0
        ? 'blocked'
        : credentialReady
            ? 'ready'
            : 'needs_authorization';
    const preflightScore = scorePreflight({
        hasVendorAccount: Boolean(vendorAccountRef),
        contractAttested,
        credentialReady,
        runtimeReady: !runtimeRequired || Boolean(runtimeUrl),
        scopesReady: missingScopes.length === 0,
        catalogReady: adapter.readiness === 'live',
    });

    return {
        schema_version: 'native-vendor-adapter-preflight-v1',
        status,
        generated_at: input.now ?? new Date().toISOString(),
        adapter_key: adapter.adapter_key,
        display_name: adapter.display_name,
        vendor_name: adapter.vendor_name,
        adapter_type: adapter.adapter_type,
        readiness: adapter.readiness,
        auth_protocol: adapter.auth_protocol,
        sync_mode: adapter.sync_mode,
        supported_connector_types: adapter.supported_connector_types,
        normalized_facts: adapter.normalized_facts,
        required_scopes: requiredScopes,
        granted_scopes: grantedScopes,
        missing_scopes: missingScopes,
        vendor_contract_required: adapter.vendor_contract_required,
        vendor_contract_attested: contractAttested,
        vendor_account_ref_hash: vendorAccountRef ? hashValue(vendorAccountRef) : null,
        adapter_runtime_configured: Boolean(runtimeUrl),
        credential_ref_hash_present: credentialReady,
        production_sync_ready: productionSyncReady,
        preflight_score: preflightScore,
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        privacy_boundary: buildNativePreflightPrivacyBoundary(vendorAccountRef, credentialRefHash),
    };
}

function buildNativePreflightPrivacyBoundary(
    vendorAccountRef: string | null,
    credentialRefHash: string | null,
): NativeVendorAdapterPreflightPacket['privacy_boundary'] {
    return {
        credential_material_stored: false,
        credential_hash_only: Boolean(credentialRefHash),
        raw_vendor_payload_stored: false,
        owner_contact_required: false,
        vendor_account_ref_hashed: Boolean(vendorAccountRef),
    };
}

function scorePreflight(input: {
    hasVendorAccount: boolean;
    contractAttested: boolean;
    credentialReady: boolean;
    runtimeReady: boolean;
    scopesReady: boolean;
    catalogReady: boolean;
}): number {
    const score = [
        input.hasVendorAccount,
        input.contractAttested,
        input.credentialReady,
        input.runtimeReady,
        input.scopesReady,
        input.catalogReady,
    ].filter(Boolean).length / 6;
    return Math.round(score * 10_000) / 10_000;
}

function normalizeScopes(scopes: string[] | null | undefined): string[] {
    return Array.from(new Set((scopes ?? [])
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0)))
        .sort();
}

function normalizeText(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
