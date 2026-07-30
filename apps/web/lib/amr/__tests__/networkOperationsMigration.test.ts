import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    resolve(
        process.cwd(),
        '../../supabase/migrations/20260730000000_amr_network_operations_exchange.sql',
    ),
    'utf8',
);

describe('AMR network operations and private exchange migration', () => {
    it('creates the operational, reconciliation, agreement, usage, and settlement ledgers', () => {
        for (const table of [
            'amr_connector_probe_events',
            'amr_ast_ingestion_events',
            'amr_ast_result_events',
            'amr_ast_reconciliation_events',
            'amr_exchange_agreement_events',
            'amr_exchange_usage_events',
            'amr_exchange_settlement_events',
        ]) {
            expect(migration).toContain(`create table if not exists public.${table}`);
        }
    });

    it('requires mTLS-bound production and heartbeat proof before accepted ingestion', () => {
        expect(migration).toContain("probe_type not in ('production_probe', 'heartbeat')");
        expect(migration).toContain("token_binding_method = 'mtls'");
        expect(migration).toContain('Accepted AMR AST ingestion requires a passed mTLS production probe');
    });

    it('persists canonical AST and surveillance rows atomically without raw payloads', () => {
        expect(migration).toContain('ingest_amr_ast_packet_v1');
        expect(migration).toContain('raw_payload_stored boolean not null default false');
        expect(migration).toContain('raw_payload_stored is false');
        expect(migration).toContain('jsonb_array_elements(p_results)');
        expect(migration).toContain('jsonb_array_elements(p_surveillance_events)');
    });

    it('makes ledgers immutable and enforces settlement state in the database', () => {
        expect(migration).toContain('prevent_amr_network_operations_mutation');
        expect(migration).toContain('validate_amr_exchange_agreement_transition');
        expect(migration).toContain('validate_amr_exchange_settlement_transition');
        expect(migration).toContain('AMR exchange settlement facts are immutable across state events');
        expect(migration).toContain('Accepted AMR exchange agreement terms are immutable');
        expect(migration).toContain('payment_executed_by_vetios');
    });

    it('enables tenant RLS and service-role operational access', () => {
        expect(migration).toContain('tenant_id = public.current_tenant_id()');
        expect(migration).toContain("to service_role using (true) with check (true)");
        expect(migration).toContain("notify pgrst, 'reload schema'");
    });
});
