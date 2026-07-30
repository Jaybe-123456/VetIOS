# AMR Network Operations and Private Exchange v1

## Status

This release is an operational control-plane kernel. It does not prove that a
laboratory, clinic network, or commercial exchange is live. Production readiness
requires real partner credentials, mTLS-bound probes, accepted de-identified AST
packets, reconciled clinical episodes, signed agreement evidence, and observed
settlement events.

## Control-Plane Contract

The build adds four connected layers:

1. Connector proof: append-only probe receipts bound to an OAuth client and a
   verified mTLS certificate.
2. Canonical AST ingestion: deterministic validation and normalization of
   de-identified culture and susceptibility records.
3. Outcome reconciliation: append-only linkage from canonical ingestion events
   to AMR outcome episodes and clinical cases.
4. Private exchange: governed agreements, usage metering, and settlement-state
   evidence for approved AMR data products.

The private exchange is not a public marketplace for identifiable records.
Supported privacy classes are `deidentified_record`, `aggregate_only`, and
`federated_only`.

## Database

Apply:

```text
supabase/migrations/20260730000000_amr_network_operations_exchange.sql
```

The migration creates:

- `amr_connector_probe_events`
- `amr_ast_ingestion_events`
- `amr_ast_result_events`
- `amr_ast_reconciliation_events`
- `amr_exchange_agreement_events`
- `amr_exchange_usage_events`
- `amr_exchange_settlement_events`
- `ingest_amr_ast_packet_v1(jsonb, jsonb, jsonb)`

All seven ledgers are append-only, tenant-scoped, RLS-protected, and writable by
the service role. The atomic ingestion RPC writes the canonical ingestion,
normalized AST results, surveillance events, and initial reconciliation event in
one transaction.

## Partner Identity

The production laboratory client needs:

- OAuth client-credentials access
- `amr:read` and `amr:ingest` scopes
- `mtls_required = true`
- the active client certificate SHA-256 thumbprint registered on the OAuth client
- calls routed through `https://mtls.vetios.tech`

Dry-run and schema probes can be non-production. A production or heartbeat probe
cannot activate a connector unless it is OAuth-authenticated and mTLS-bound.

## Operational Sequence

### 1. Enroll the laboratory

Record `invited`, `enrolled`, and `data_use_approved` site events through:

```text
POST /api/amr/outcome-network
```

`connector_verified` is system-computed. User-posted verification events are
rejected.

### 2. Prove the connector

Call through the mTLS domain:

```text
POST https://mtls.vetios.tech/api/amr/network-operations
```

Use `action = record_connector_probe`, `probe_type = production_probe`,
`schema_version = vetios.amr.ast.v1`, source request/response SHA-256 digests,
record counts, and record timestamps. The server derives the OAuth identity,
token binding, and certificate thumbprint from the trusted request context.

### 3. Validate before commit

Use `action = validate_ast_packet`. The response includes blockers, warnings,
canonical packet hash, and normalized result count. It does not persist data.

The validator blocks:

- direct or non-de-identified records
- synthetic operational rows
- failed laboratory QC
- malformed MIC, disk-diffusion, or qualitative measurements
- duplicate antimicrobial rows
- invalid source digests
- future observation timestamps

### 4. Ingest atomically

Use `action = ingest_ast_packet` through the mTLS domain. Accepted packets require
the current OAuth client and certificate-bound production probe. The server
hashes private isolate, patient, and administrative references and never stores
the raw laboratory report.

### 5. Reconcile the episode

Use `action = record_reconciliation_event` with `matched`, `unmatched`, `failed`,
or `requeued`. `matched` events bind the ingestion to a governed AMR episode or
clinical case. Reconciliation requires a recently authenticated clinical actor.

### 6. Govern the exchange agreement

Use:

```text
POST /api/amr/private-exchange
```

Agreement events follow:

```text
drafted -> offered -> accepted -> activated
```

An active agreement can be suspended and reactivated, or terminated by `revoked`
or `expired`. Agreement administration requires an AAL2 admin session and
`exchange:manage`.

The terms and data-use agreement are represented by SHA-256 evidence hashes.
External counterparty references are hashed before storage.

### 7. Meter and settle

Accepted AST ingestion is metered only when a matching active
`amr.culture_ast.normalized.v1` agreement exists. Settlement follows:

```text
calculated -> approved -> invoiced -> paid
```

Any non-terminal settlement may be voided. Amounts are immutable across state
events. A `paid` event requires an external confirmation hash.

VetIOS does not transfer funds in this release. It records externally confirmed
settlement evidence and exposes `payment_executed_by_vetios = false`.

## Console

`/amr-network` now shows:

- production connector proof and staleness
- canonical AST acceptance and reconciliation state
- active exchange agreements
- metered and unsettled minor-unit value
- marketplace readiness blockers
- recent connector, ingestion, and agreement ledgers
- agreement and settlement controls

The original pilot readiness metrics remain separate. Marketplace readiness does
not imply clinical calibration readiness or federation eligibility.

## Verification

The code-level acceptance gate is:

```text
TypeScript: clean
Focused AMR and trust tests: passing
```

The live operational gate is complete only when all of these are observed:

- at least one enrolled and data-use-approved reference laboratory
- at least three enrolled clinics
- a fresh passed mTLS production probe
- at least one accepted canonical AST packet
- no pending reconciliation for the evaluated packet set
- at least one active private exchange agreement
- real outcome-linked episodes meeting the AMR pilot target

Until then, the console must report the specific blockers and the product should
be described as configured infrastructure, not an operating network moat.
