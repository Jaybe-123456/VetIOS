import { describe, expect, it } from 'vitest';
import { buildNativeVendorAdapterPreflight } from '@/lib/platform/nativeVendorAdapterPreflight';

const HASH_A = 'a'.repeat(64);

describe('native vendor adapter preflight', () => {
    it('marks a fully authorized live adapter ready without exposing vendor account refs', () => {
        const packet = buildNativeVendorAdapterPreflight({
            adapterKey: 'covetrus-pharmacy-native',
            vendorAccountRef: 'clinic-pharmacy-account-7',
            credentialRefHash: HASH_A,
            contractAttested: true,
            requestedScopes: ['signals:ingest', 'signals:connect', 'signals:ingest'],
            adapterRuntimeUrl: 'https://adapter.example/covetrus',
            now: '2026-06-28T12:00:00.000Z',
        });

        expect(packet.status).toBe('ready');
        expect(packet.production_sync_ready).toBe(true);
        expect(packet.granted_scopes).toEqual(['signals:connect', 'signals:ingest']);
        expect(packet.missing_scopes).toEqual([]);
        expect(packet.vendor_account_ref_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.credential_ref_hash_present).toBe(true);
        expect(packet.privacy_boundary).toEqual({
            credential_material_stored: false,
            credential_hash_only: true,
            raw_vendor_payload_stored: false,
            owner_contact_required: false,
            vendor_account_ref_hashed: true,
        });
        expect(JSON.stringify(packet)).not.toContain('clinic-pharmacy-account-7');
    });

    it('blocks production sync when contract, runtime, account, or scopes are missing', () => {
        const packet = buildNativeVendorAdapterPreflight({
            adapterKey: 'idexx-vetconnect-plus-native',
            vendorAccountRef: '',
            requestedScopes: ['signals:connect'],
            now: '2026-06-28T12:00:00.000Z',
        });

        expect(packet.status).toBe('blocked');
        expect(packet.production_sync_ready).toBe(false);
        expect(packet.blockers).toEqual([
            'adapter_runtime_url_missing',
            'scope_missing:signals:ingest',
            'vendor_account_ref_missing',
            'vendor_contract_attestation_missing',
        ]);
        expect(packet.warnings).toEqual([
            'adapter_catalog_readiness_beta',
            'credential_authorization_not_completed',
        ]);
    });

    it('separates authorization completion from structural adapter readiness', () => {
        const packet = buildNativeVendorAdapterPreflight({
            adapterKey: 'ezyvet-api-native',
            vendorAccountRef: 'clinic-pims-account',
            contractAttested: true,
            requestedScopes: ['signals:connect', 'signals:ingest'],
            adapterRuntimeUrl: 'https://adapter.example/ezyvet',
            now: '2026-06-28T12:00:00.000Z',
        });

        expect(packet.status).toBe('needs_authorization');
        expect(packet.blockers).toEqual([]);
        expect(packet.warnings).toEqual([
            'adapter_catalog_readiness_beta',
            'credential_authorization_not_completed',
        ]);
        expect(packet.credential_ref_hash_present).toBe(false);
        expect(packet.production_sync_ready).toBe(false);
    });

    it('returns a blocked preflight packet for unknown adapters', () => {
        const packet = buildNativeVendorAdapterPreflight({
            adapterKey: 'unknown-vendor',
            requestedScopes: ['signals:connect'],
            now: '2026-06-28T12:00:00.000Z',
        });

        expect(packet.status).toBe('blocked');
        expect(packet.blockers).toEqual(['native_adapter_not_found']);
        expect(packet.display_name).toBeNull();
        expect(packet.preflight_score).toBe(0);
    });
});
