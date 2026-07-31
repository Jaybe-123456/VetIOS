# AMR Evidence Fabric v1

## Status

This build connects quantitative phenotype evidence to isolate-linked genomic
evidence. It is infrastructure for provenance, comparison, review, and
surveillance. It is not a clinical genomics certification, a replacement for
phenotypic AST, or proof of quantum advantage.

Apply:

```text
supabase/migrations/20260730010000_amr_evidence_fabric.sql
```

## Evidence Contract

The AMR evidence fabric preserves:

- the accepted canonical AST ingestion and each original normalized result
- MIC, disk-diffusion, or qualitative measurement lineage
- interpretation standard and version
- a hashed isolate reference shared by phenotype and genomic evidence
- genomic pipeline and reference-database versions
- the deterministic pipeline-validation target and linked external attestation
- detected resistance genes and classes
- the drug classes the genomic pipeline actually assayed
- quality and validation status
- computation class and the clinical-use boundary

Raw laboratory reports, direct identifiers, and raw genomic sequences are not
stored by this layer.

## Genomic Evidence Ingestion

The production endpoint is:

```text
POST https://mtls.vetios.tech/api/amr/evidence-fabric
```

Use `action = record_genomic_evidence`. The OAuth client needs `amr:ingest`,
mTLS binding, and the same workload identity that supplied the linked canonical
AST ingestion.

The packet schema is `vetios.amr.genomic-evidence.v1`.

Clinical-use eligibility is narrowly defined. The evidence must be:

- linked to an accepted AST ingestion for the same tenant, laboratory, and
  hashed isolate
- de-identified and non-synthetic
- quality passed
- externally validated by a current append-only validation event for the exact
  pipeline and reference-database versions
- produced by `classical_validated` computation
- accompanied by explicit assayed drug classes and reference-database versions

Evidence produced by `classical_heuristic`, `quantum_experimental`, or
`hybrid_experimental` computation can be retained for research, but it is
always excluded from clinical use.

VetIOS derives the validation target as
`amr_genomic_pipeline:<sha256>`. A current `external_validation_events` row must
match that target, be accepted and externally verified, cover `amr_signal` or
`data_quality`, and come from an independent reference laboratory, university,
public-health body, government, research partner, or auditor. The API and
database trigger both enforce this. A connector-provided
`validation_status=externally_validated` value is only a claim until that proof
is linked.

## Concordance

After a genomic event is accepted, VetIOS automatically compares it with every
linked AST result and writes append-only
`amr_phenotype_genotype_concordance_events`.

The statuses are:

- `concordant_resistant`
- `concordant_susceptible`
- `phenotype_only_resistance`
- `genotype_only_signal`
- `indeterminate`
- `not_comparable`

An undetected resistance class is treated as `not_detected` only when that class
appears in `assayed_drug_classes`. Otherwise it is `not_assayed`. This prevents
absence of evidence from being promoted into susceptibility evidence.

Genotype-only and phenotype-only signals require review. Genomic evidence never
overrides the quantitative phenotype result.

## Interoperability

The snapshot endpoint reports mapping readiness for:

- WHONET
- FAO InFARM
- WHO GLASS
- WOAH ANIMUSE
- FHIR R5 diagnostic resources

These are readiness assessments, not official certification or direct
submission claims. GLASS is not applicable to non-human records. ANIMUSE
requires antimicrobial-use or sales facts and is not satisfied by an AST
record.

## Research Screening Boundary

`POST /api/amr/submit` remains a research screening endpoint. It now:

- requires `amr:ingest` and mTLS-bound OAuth workload identity
- scopes duplicate lookup by tenant
- identifies the local marker scan as `classical_heuristic`, not quantum
- never marks output as clinically usable
- records that phenotypic AST and external validation are required

The optional inference quantum runner also remains shadow research. Its output
does not change the deterministic clinical differential order.

## Operational Verification

The code and migration can be verified without claiming a live network:

```text
pnpm --filter @vetios/web test -- \
  lib/amr/__tests__/evidenceFabric.test.ts \
  lib/amr/__tests__/evidenceFabricMigration.test.ts \
  app/api/amr/evidence-fabric/route.test.ts
```

The live gate requires:

1. An accepted canonical AST ingestion from the mTLS laboratory connector.
2. Isolate-linked genomic evidence from a documented pipeline.
3. Explicit pipeline and reference-database versions.
4. Concordance rows for every linked AST result.
5. Specialist review of phenotype-only and genotype-only signals.
6. An independently attested external-validation event bound to the exact
   pipeline target before any genomic row is marked clinically usable.
