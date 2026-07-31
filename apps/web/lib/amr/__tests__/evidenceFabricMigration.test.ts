import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    resolve(
        process.cwd(),
        '../../supabase/migrations/20260730010000_amr_evidence_fabric.sql',
    ),
    'utf8',
);

describe('AMR evidence fabric migration', () => {
    it('extends genomic evidence with AST, isolate, pipeline, and validation lineage', () => {
        for (const column of [
            'amr_ast_ingestion_event_id',
            'isolate_ref_hash',
            'source_record_digest',
            'pipeline_name',
            'pipeline_version',
            'pipeline_validation_ref',
            'external_validation_event_id',
            'reference_database_versions',
            'assayed_drug_classes',
            'validation_status',
            'computation_class',
            'clinical_use_allowed',
            'clinical_blockers',
            'raw_sequence_stored',
        ]) {
            expect(migration).toContain(column);
        }
    });

    it('replaces global sequence uniqueness with tenant-scoped pipeline identity', () => {
        expect(migration).toContain('drop index if exists public.idx_amr_sequence_hash');
        expect(migration).toContain('idx_amr_genomic_tenant_sequence_pipeline');
        expect(migration).toContain('tenant_id');
        expect(migration).toContain('sequence_hash');
        expect(migration).toContain("coalesce(pipeline_name, '')");
    });

    it('prohibits raw sequences and experimental clinical evidence in the database', () => {
        expect(migration).toContain('raw_sequence_stored is false');
        expect(migration).toContain("computation_class = 'classical_validated'");
        expect(migration).toContain("validation_status = 'externally_validated'");
        expect(migration).toContain(
            'AMR genomic pipeline validation proof is not current and externally verified',
        );
        expect(migration).toContain(
            'AMR genomic evidence OAuth client does not own the AST ingestion',
        );
        expect(migration).toContain(
            'Raw genomic sequences are prohibited in the AMR evidence ledger',
        );
    });

    it('creates append-only, tenant-scoped phenotype genotype concordance', () => {
        expect(migration).toContain(
            'create table if not exists public.amr_phenotype_genotype_concordance_events',
        );
        expect(migration).toContain('validate_amr_concordance_provenance');
        expect(migration).toContain('prevent_amr_evidence_fabric_mutation');
        expect(migration).toContain('tenant_id = public.current_tenant_id()');
        expect(migration).toContain('genotype_only_signal');
        expect(migration).toContain('phenotype_only_resistance');
    });
});
