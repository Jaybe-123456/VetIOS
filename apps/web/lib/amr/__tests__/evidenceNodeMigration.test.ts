import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    resolve(process.cwd(), '../../supabase/migrations/20260801000000_evidence_node_lab_adapter.sql'),
    'utf8',
);

describe('Evidence Node laboratory adapter migration', () => {
    it('creates all five append-only operating ledgers', () => {
        for (const table of [
            'evidence_node_adapter_contract_events',
            'evidence_node_ingestion_receipt_events',
            'evidence_node_identity_link_events',
            'evidence_node_closure_task_events',
            'evidence_node_export_events',
        ]) {
            expect(migration).toContain(`create table if not exists public.${table}`);
        }
        expect(migration).toContain('prevent_evidence_node_ledger_mutation');
        expect(migration).toContain('revoke insert, update, delete');
        expect(migration).not.toContain("for insert with check (tenant_id = public.current_tenant_id())");
    });

    it('binds acceptance to immutable contract, mapping, mTLS OAuth, and source facts', () => {
        expect(migration).toContain('validate_evidence_node_contract_transition');
        expect(migration).toContain('Invalid Evidence Node contract transition');
        expect(migration).not.toContain('evidence_node_closure_task_event_key unique');
        expect(migration).toContain('Active Evidence Node adapter contract is required');
        expect(migration).toContain('active_contract.oauth_client_id');
        expect(migration).toContain('active_contract.mtls_cert_thumbprint_hash');
        expect(migration).toContain("p_receipt->>'mapping_hash'");
        expect(migration).toContain("active_contract.reference_key_id <> p_receipt->>'reference_key_id'");
        expect(migration).toContain("active_contract.source_version is distinct from nullif(p_ingestion->>'source_version', '')");
        expect(migration).toContain("p_receipt->>'source_transport'");
        expect(migration).toContain("p_receipt->>'source_format'");
        expect(migration).toContain('pg_advisory_xact_lock');
        expect(migration).toContain("'vetios:evidence-node:closure:'");
        expect(migration).toContain("'ingestion_event_id', cached_receipt.ingestion_event_id");
        expect(migration).toContain("'closure_task_id', cached_closure.task_id");
        expect(migration).toContain('Evidence Node idempotency key payload mismatch');
        expect(migration.indexOf('where receipt.tenant_id = tenant_uuid'))
            .toBeLessThan(migration.indexOf('select event.* into active_contract'));
    });

    it('wraps canonical ingestion and reconciliation in one transaction', () => {
        expect(migration).toContain('ingest_evidence_node_packet_v1');
        expect(migration).toContain('ingest_amr_ast_packet_v1(p_ingestion, p_results, p_surveillance_events)');
        expect(migration).toContain("'identity_status'");
        expect(migration).toContain("'closure_task_id'");
        expect(migration).toContain("'confirm_treatment'");
        expect(migration).toContain("'reconcile_episode'");
    });

    it('advances reconciliation through treatment, review, outcome, and closure atomically', () => {
        expect(migration).toContain('advance_evidence_node_closure_task_v1');
        expect(migration).toContain("prior_task.task_type = 'reconcile_episode'");
        expect(migration).toContain("prior_task.task_type = 'confirm_treatment'");
        expect(migration).toContain("prior_task.task_type = 'confirm_follow_up'");
        expect(migration).toContain("prior_task.task_type = 'confirm_outcome'");
        expect(migration).toContain("'clinical_review_completed'");
        expect(migration).toContain("'outcome_confirmed'");
        expect(migration).toContain("'episode_closed'");
        expect(migration).toContain('evidence_node_site_operational_v1');
        expect(migration).toContain('Tenant-owned stewardship evidence for the reconciled case is required');
        expect(migration).toContain('Tenant-owned non-synthetic inference for the reconciled case is required');
        expect(migration).toContain('Tenant-owned non-synthetic outcome linked to the reconciled inference is required');
        expect(migration).toContain('feed.source_record_digest = ingestion.source_record_digest');
    });

    it('requires review and external write-back receipts at the database boundary', () => {
        expect(migration).toContain('Completed closure task requires reviewer evidence');
        expect(migration).toContain('Completed write-back task requires a receipt hash');
        expect(migration).toContain('active_contract.writeback_permitted');
        expect(migration).toContain('closure_destination_channel');
    });

    it('fails closed on raw, identifiable, or synthetic accepted evidence', () => {
        expect(migration).toContain('raw_payload_stored_centrally is false');
        expect(migration).toContain('and deidentified');
        expect(migration).toContain('and not is_synthetic');
        expect(migration).toContain("'breakpoints_computed_by_vetios', false");
    });

    it('does not equate compatibility output with official acceptance', () => {
        expect(migration).toContain("export_profile in ('infarm_compat_v1', 'nahln_compat_v1', 'kabs_compat_v1')");
        expect(migration).toContain('not official_acceptance');
        expect(migration).toContain('acceptance_receipt_hash is not null');
        expect(migration).toContain("validation_scope = 'external_receiver'");
        expect(migration).toContain('does not imply official acceptance');
    });
});
