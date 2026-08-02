import { describe, expect, it } from 'vitest';
import {
    AMR_AST_SCHEMA_VERSION,
    buildAMRExchangeAgreementSummaries,
    buildAMRNetworkOperationsSnapshot,
    buildAMRSettlementPreview,
    evaluateAMRConnectorProbe,
    prepareCanonicalAMRASTPacket,
    validateAMRExchangeAgreementTransition,
    type AMRExchangeAgreementEventRow,
    type AMRExchangeUsageEventRow,
    type CanonicalAMRASTPacketInput,
} from '@/lib/amr/networkOperations';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const LAB_ID = '22222222-2222-4222-8222-222222222222';
const CLINIC_ID = '33333333-3333-4333-8333-333333333333';
const PROBE_ID = '44444444-4444-4444-8444-444444444444';
const INGESTION_ID = '55555555-5555-4555-8555-555555555555';
const AGREEMENT_ID = '66666666-6666-4666-8666-666666666666';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

describe('AMR network operations kernel', () => {
    it('does not activate a production connector without OAuth mTLS proof', () => {
        const evaluation = evaluateAMRConnectorProbe({
            probeType: 'production_probe',
            tokenBindingMethod: 'api_key',
            sourceSystem: 'reference_lab_lis',
            connectorVersion: '1.0.0',
            schemaVersion: AMR_AST_SCHEMA_VERSION,
            observedRecordCount: 12,
            newestRecordAt: '2026-07-30T10:00:00.000Z',
            requestDigest: SHA_A,
            responseDigest: SHA_B,
            now: '2026-07-30T11:00:00.000Z',
        });

        expect(evaluation.production_verified).toBe(false);
        expect(evaluation.status).toBe('blocked');
        expect(evaluation.blockers).toEqual(expect.arrayContaining([
            'mtls_workload_binding_required',
            'oauth_client_identity_required',
            'verified_certificate_thumbprint_required',
        ]));
    });

    it('seals valid mTLS production connector proof', () => {
        const evaluation = evaluateAMRConnectorProbe({
            probeType: 'production_probe',
            tokenBindingMethod: 'mtls',
            oauthClientId: 'oauth-client-1',
            certificateThumbprint: SHA_A,
            sourceSystem: 'reference_lab_lis',
            connectorVersion: '1.0.0',
            schemaVersion: AMR_AST_SCHEMA_VERSION,
            observedRecordCount: 12,
            latencyMs: 900,
            newestRecordAt: '2026-07-30T10:00:00.000Z',
            requestDigest: SHA_A,
            responseDigest: SHA_B,
            now: '2026-07-30T11:00:00.000Z',
        });

        expect(evaluation).toMatchObject({
            production_verified: true,
            status: 'passed',
            blockers: [],
        });
        expect(evaluation.certificate_thumbprint_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(evaluation.receipt_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('accepts a zero-volume mTLS heartbeat without fabricating record freshness', () => {
        const evaluation = evaluateAMRConnectorProbe({
            probeType: 'heartbeat',
            tokenBindingMethod: 'mtls',
            oauthClientId: 'oauth-client-1',
            certificateThumbprint: SHA_A,
            sourceSystem: 'reference_lab_lis',
            connectorVersion: '1.0.0',
            schemaVersion: AMR_AST_SCHEMA_VERSION,
            observedRecordCount: 0,
            requestDigest: SHA_A,
            responseDigest: SHA_B,
            now: '2026-07-30T11:00:00.000Z',
        });

        expect(evaluation).toMatchObject({
            production_verified: true,
            status: 'passed',
            blockers: [],
        });
        expect(evaluation.warnings).toContain('heartbeat_without_observed_source_record');
    });

    it('blocks synthetic, identifiable, QC-failed, and malformed AST packets', () => {
        const packet = validPacket();
        packet.deidentified = false;
        packet.is_synthetic = true;
        packet.qc_status = 'failed';
        packet.results[0] = {
            ...packet.results[0],
            measurement_type: 'mic',
            mic_value: undefined,
            mic_unit: undefined,
        };

        const prepared = prepareCanonicalAMRASTPacket({
            tenantId: TENANT_ID,
            requestId: '77777777-7777-4777-8777-777777777777',
            actorId: 'connector',
            oauthClientId: 'oauth-client-1',
            packet,
        });

        expect(prepared.accepted).toBe(false);
        expect(prepared.results).toEqual([]);
        expect(prepared.surveillance_events).toEqual([]);
        expect(prepared.blockers).toEqual(expect.arrayContaining([
            'deidentification_required',
            'synthetic_ast_packet_not_operational',
            'laboratory_qc_failed',
            'result_0:mic_value_invalid',
            'result_0:mic_unit_missing',
        ]));
    });

    it('normalizes one canonical AST result into one surveillance event', () => {
        const prepared = prepareCanonicalAMRASTPacket({
            tenantId: TENANT_ID,
            requestId: '77777777-7777-4777-8777-777777777777',
            actorId: 'connector',
            oauthClientId: 'oauth-client-1',
            packet: validPacket(),
        });

        expect(prepared.accepted).toBe(true);
        expect(prepared.results).toHaveLength(1);
        expect(prepared.surveillance_events).toHaveLength(1);
        expect(prepared.ingestion).toMatchObject({
            raw_payload_stored: false,
            deidentified: true,
            is_synthetic: false,
            organism_key: 'escherichia_coli',
            result_count: 1,
        });
        expect(prepared.canonical_packet_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('enforces the agreement lifecycle and identifies active governed terms', () => {
        const rows = agreementEvents();
        expect(validateAMRExchangeAgreementTransition([], 'activated'))
            .toBe('agreement_draft_required');
        expect(validateAMRExchangeAgreementTransition(rows.slice(0, 1), 'accepted'))
            .toBe('agreement_offer_required');
        expect(validateAMRExchangeAgreementTransition(rows.slice(0, 2), 'accepted'))
            .toBeNull();

        const summary = buildAMRExchangeAgreementSummaries(rows)[0];
        expect(summary).toMatchObject({
            status: 'active',
            active: true,
            blockers: [],
            privacy_class: 'aggregate_only',
        });
    });

    it('opens the marketplace gate only after connector, ingestion, reconciliation, and agreement proof', () => {
        const snapshot = buildAMRNetworkOperationsSnapshot({
            connectorProbes: [{
                tenant_id: TENANT_ID,
                site_id: LAB_ID,
                probe_type: 'production_probe',
                probe_status: 'passed',
                token_binding_method: 'mtls',
                certificate_thumbprint_hash: SHA_A,
                oauth_client_id: 'oauth-client-1',
                source_system: 'reference_lab_lis',
                connector_version: '1.0.0',
                schema_version: AMR_AST_SCHEMA_VERSION,
                observed_record_count: 12,
                request_digest: SHA_A,
                response_digest: SHA_B,
                receipt_hash: SHA_A,
                occurred_at: '2026-07-30T10:00:00.000Z',
            }],
            ingestionEvents: [{
                id: INGESTION_ID,
                tenant_id: TENANT_ID,
                site_id: CLINIC_ID,
                lab_site_id: LAB_ID,
                connector_probe_event_id: PROBE_ID,
                source_system: 'reference_lab_lis',
                schema_version: AMR_AST_SCHEMA_VERSION,
                source_record_digest: SHA_A,
                canonical_packet_hash: SHA_B,
                species: 'canine',
                specimen_type: 'urine',
                organism_key: 'escherichia_coli',
                ingestion_status: 'accepted',
                result_count: 1,
                observed_at: '2026-07-30T10:05:00.000Z',
            }],
            reconciliationEvents: [{
                tenant_id: TENANT_ID,
                ingestion_event_id: INGESTION_ID,
                reconciliation_event: 'matched',
                occurred_at: '2026-07-30T10:10:00.000Z',
            }],
            agreementEvents: agreementEvents(),
            usageEvents: [],
            settlementEvents: [],
            generatedAt: '2026-07-30T11:00:00.000Z',
        });

        expect(snapshot.marketplace_ready).toBe(true);
        expect(snapshot.blockers).toEqual([]);
        expect(snapshot.connectors.production_verified).toBe(1);
        expect(snapshot.ingestion.matched).toBe(1);
        expect(snapshot.exchange.agreements_active).toBe(1);
    });

    it('calculates exact minor-unit settlement and rejects a duplicate bundle', () => {
        const agreement = buildAMRExchangeAgreementSummaries(agreementEvents())[0];
        const usage: AMRExchangeUsageEventRow[] = [{
            id: '88888888-8888-4888-8888-888888888888',
            tenant_id: TENANT_ID,
            agreement_id: AGREEMENT_ID,
            product_key: 'amr.culture_ast.normalized.v1',
            meter_key: 'amr.culture_ast.normalized.v1:record',
            source_type: 'ast_ingestion' as const,
            source_event_id: INGESTION_ID,
            source_digest: SHA_A,
            quantity: 3,
            unit: 'record',
            unit_price_minor: 250,
            amount_minor: 750,
            currency: 'USD',
            usage_status: 'metered' as const,
            metered_at: '2026-07-30T10:30:00.000Z',
        }];
        const preview = buildAMRSettlementPreview({
            agreement,
            usageEvents: usage,
            periodStart: '2026-07-30T00:00:00.000Z',
            periodEnd: '2026-07-31T00:00:00.000Z',
        });

        expect(preview).toMatchObject({
            usage_event_count: 1,
            total_quantity: 3,
            gross_amount_minor: 750,
            platform_fee_minor: 75,
            provider_net_amount_minor: 675,
            currency: 'USD',
        });
        expect(() => buildAMRSettlementPreview({
            agreement,
            usageEvents: usage,
            priorSettlementEvents: [{
                tenant_id: TENANT_ID,
                settlement_id: '99999999-9999-4999-8999-999999999999',
                agreement_id: AGREEMENT_ID,
                event_type: 'approved',
                period_start: '2026-07-30T00:00:00.000Z',
                period_end: '2026-07-31T00:00:00.000Z',
                usage_event_count: 1,
                total_quantity: 3,
                gross_amount_minor: 750,
                platform_fee_minor: 75,
                provider_net_amount_minor: 675,
                currency: 'USD',
                source_digest_bundle_hash: preview.source_digest_bundle_hash,
            }],
            periodStart: '2026-07-30T00:00:00.000Z',
            periodEnd: '2026-07-31T00:00:00.000Z',
        })).toThrow('already settled');

        expect(() => buildAMRSettlementPreview({
            agreement,
            usageEvents: usage,
            priorSettlementEvents: [
                {
                    tenant_id: TENANT_ID,
                    settlement_id: '99999999-9999-4999-8999-999999999999',
                    agreement_id: AGREEMENT_ID,
                    event_type: 'calculated',
                    period_start: '2026-07-30T00:00:00.000Z',
                    period_end: '2026-07-31T00:00:00.000Z',
                    usage_event_count: 1,
                    total_quantity: 3,
                    gross_amount_minor: 750,
                    platform_fee_minor: 75,
                    provider_net_amount_minor: 675,
                    currency: 'USD',
                    source_digest_bundle_hash: preview.source_digest_bundle_hash,
                    occurred_at: '2026-07-31T01:00:00.000Z',
                },
                {
                    tenant_id: TENANT_ID,
                    settlement_id: '99999999-9999-4999-8999-999999999999',
                    agreement_id: AGREEMENT_ID,
                    event_type: 'voided',
                    period_start: '2026-07-30T00:00:00.000Z',
                    period_end: '2026-07-31T00:00:00.000Z',
                    usage_event_count: 1,
                    total_quantity: 3,
                    gross_amount_minor: 750,
                    platform_fee_minor: 75,
                    provider_net_amount_minor: 675,
                    currency: 'USD',
                    source_digest_bundle_hash: preview.source_digest_bundle_hash,
                    occurred_at: '2026-07-31T02:00:00.000Z',
                },
            ],
            periodStart: '2026-07-30T00:00:00.000Z',
            periodEnd: '2026-07-31T00:00:00.000Z',
        })).not.toThrow();
    });

    it('never combines monetary totals across currencies', () => {
        const usageBase = {
            tenant_id: TENANT_ID,
            agreement_id: AGREEMENT_ID,
            product_key: 'amr.culture_ast.normalized.v1',
            meter_key: 'amr.culture_ast.normalized.v1:record',
            source_type: 'ast_ingestion' as const,
            quantity: 1,
            unit: 'record',
            unit_price_minor: 100,
            amount_minor: 100,
            usage_status: 'metered' as const,
            metered_at: '2026-07-30T10:30:00.000Z',
        };
        const snapshot = buildAMRNetworkOperationsSnapshot({
            connectorProbes: [],
            ingestionEvents: [],
            reconciliationEvents: [],
            agreementEvents: agreementEvents(),
            usageEvents: [
                {
                    ...usageBase,
                    id: '88888888-8888-4888-8888-888888888881',
                    source_event_id: '55555555-5555-4555-8555-555555555551',
                    source_digest: SHA_A,
                    currency: 'USD',
                },
                {
                    ...usageBase,
                    id: '88888888-8888-4888-8888-888888888882',
                    source_event_id: '55555555-5555-4555-8555-555555555552',
                    source_digest: SHA_B,
                    currency: 'EUR',
                },
            ],
            settlementEvents: [],
            generatedAt: '2026-07-30T11:00:00.000Z',
        });

        expect(snapshot.exchange.currency).toBeNull();
        expect(snapshot.exchange.metered_amount_minor).toBe(0);
        expect(snapshot.exchange.amounts_by_currency).toEqual([
            expect.objectContaining({ currency: 'EUR', metered_amount_minor: 100 }),
            expect.objectContaining({ currency: 'USD', metered_amount_minor: 100 }),
        ]);
        expect(snapshot.blockers).toContain('mixed_currency_totals_require_separate_views');
    });
});

function validPacket(): CanonicalAMRASTPacketInput {
    return {
        schema_version: AMR_AST_SCHEMA_VERSION,
        source_system: 'Reference Lab LIS',
        source_version: '2026.07',
        source_record_digest: SHA_A,
        isolate_ref: 'isolate-private-1',
        patient_ref: 'patient-private-1',
        site_id: CLINIC_ID,
        lab_site_id: LAB_ID,
        connector_probe_event_id: PROBE_ID,
        species: 'Canine',
        specimen_type: 'Urine',
        anatomical_site: 'Urinary tract',
        country_code: 'KE',
        organism_label: 'Escherichia coli',
        organism_key: 'escherichia_coli',
        organism_code_system: 'NCBI Taxonomy',
        organism_code: '562',
        observed_at: '2026-07-29T10:00:00.000Z',
        ast_method: 'Broth microdilution',
        interpretation_standard: 'CLSI VET01S',
        interpretation_standard_version: '2026',
        qc_status: 'passed',
        deidentified: true,
        is_synthetic: false,
        results: [{
            antimicrobial_label: 'Amoxicillin clavulanate',
            antimicrobial_key: 'amoxicillin_clavulanate',
            drug_class: 'beta_lactam',
            measurement_type: 'mic',
            mic_value: 32,
            mic_operator: '>=',
            mic_unit: 'ug/mL',
            interpretation: 'R',
            breakpoint_basis: 'CLSI VET01S 2026',
        }],
    };
}

function agreementEvents(): AMRExchangeAgreementEventRow[] {
    const base = {
        tenant_id: TENANT_ID,
        agreement_id: AGREEMENT_ID,
        product_key: 'amr.culture_ast.normalized.v1',
        provider_site_id: LAB_ID,
        consumer_tenant_id: null,
        counterparty_ref_hash: SHA_B,
        purpose: 'AMR surveillance',
        license_key: 'vetios-amr-private-v1',
        privacy_class: 'aggregate_only',
        permitted_species: ['canine'],
        permitted_geographies: ['KE'],
        permitted_use_cases: ['surveillance'],
        pricing_model: 'per_record',
        currency: 'USD',
        unit_price_minor: 250,
        platform_fee_bps: 1000,
        terms_hash: SHA_A,
        data_use_agreement_hash: SHA_B,
        effective_at: '2026-07-30T00:00:00.000Z',
        expires_at: '2027-07-30T00:00:00.000Z',
    };
    return [
        { ...base, event_type: 'drafted', occurred_at: '2026-07-27T00:00:00.000Z' },
        { ...base, event_type: 'offered', occurred_at: '2026-07-28T00:00:00.000Z' },
        { ...base, event_type: 'accepted', occurred_at: '2026-07-29T00:00:00.000Z' },
        { ...base, event_type: 'activated', occurred_at: '2026-07-30T00:00:00.000Z' },
    ];
}
