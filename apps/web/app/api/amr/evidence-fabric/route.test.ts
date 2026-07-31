import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(resolve(process.cwd(), 'app/api/amr/evidence-fabric/route.ts'), 'utf8');
const submitRoute = readFileSync(resolve(process.cwd(), 'app/api/amr/submit/route.ts'), 'utf8');

describe('AMR evidence fabric routes', () => {
    it('requires AMR scopes and mTLS-bound OAuth for committed genomic evidence', () => {
        expect(route).toContain("requiredScopes: parsed.data.action === 'validate_genomic_evidence'");
        expect(route).toContain("actionKey: 'amr.genomic.ingest'");
        expect(route).toContain("actionKey: 'amr.concordance.materialize'");
        expect(route).toContain('mtls_bound_oauth_workload_required');
        expect(route).toContain('resolvePipelineValidation');
        expect(route).toContain('genomic_connector_oauth_identity_mismatch');
    });

    it('automatically materializes phenotype genotype concordance after genomic insert', () => {
        expect(route).toContain('materializeConcordanceRows');
        expect(route).toContain('buildAMRConcordanceEvents');
        expect(route).toContain('AMR_CONCORDANCE_ALGORITHM_VERSION');
    });

    it('reports mapping readiness and an explicit non-certification boundary', () => {
        expect(route).toContain('official_submission_certified: false');
        expect(route).toContain('genotype_absence_requires_explicit_assay_coverage: true');
        expect(route).toContain('quantum_clinical_decision_influence: false');
    });

    it('keeps research sequence screening tenant scoped and clinically inactive', () => {
        expect(submitRoute).toContain(".eq('tenant_id', tenantId)");
        expect(submitRoute).toContain("screening_mode: 'research_only'");
        expect(submitRoute).toContain('clinical_use_allowed: false');
        expect(submitRoute).toContain('phenotypic_ast_required: true');
        expect(submitRoute).toContain('raw_sequence_stored: false');
    });
});
