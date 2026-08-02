# VetIOS Evidence Node Laboratory Adapter v1

## Decision

The next defensible VetIOS wedge is a contract-backed laboratory Evidence Node,
not another clinical form or generic integration catalog. The node converts
routine culture/AST workflow into governed, outcome-linkable evidence while the
laboratory retains custody of its raw source payloads.

## Why This Shape

The canonical relationship is:

```text
vendor LIS/PIMS
  -> local authenticated transport
  -> encrypted Evidence Node spool
  -> versioned mapping and privacy projection
  -> mTLS OAuth contract gate
  -> canonical AST transaction and receipt
  -> patient/case/episode reconciliation
  -> treatment, follow-up, and outcome closure tasks
  -> governed compatibility exports
```

This reuses the existing VetIOS AMR ingestion, surveillance, outcome episode,
auth trust, mTLS, and exchange rails. It does not create a parallel clinical
truth store.

## Implemented Runtime

`@vetios/evidence-node` provides:

- file drop, signed webhook, HTTPS API poll, and OpenSSH SFTP collectors;
- RFC 4180 CSV, JSON, HL7 v2 ORU/R01, and FHIR R4 normalization;
- mapping and source digests;
- direct-identifier exclusion from outbound packets;
- HMAC-SHA-256 pseudonymization of patient, accession, and isolate references
  under a separately rotated, versioned reference key inside the source trust
  boundary;
- AES-256-GCM local spool, deterministic dedupe, retries, dead-letter, and replay;
- record-isolated batch normalization so malformed rows do not suppress valid
  records; local receipts retain only rejected indexes and blocker codes;
- mTLS OAuth delivery to `POST /api/amr/network-operations`;
- automatic mTLS heartbeat renewal and current-probe rebinding before delivery;
- bounded payloads, response limits, pinned SFTP host keys, and webhook replay windows.

The runtime preserves laboratory-reported AST interpretation and terminology.
It does not embed licensed breakpoint tables or calculate a new susceptibility
interpretation.

The delivery spool is encrypted. A file-drop source is moved to its configured
laboratory-controlled archive after durable spool acceptance; that archive is
not encrypted by the node itself and must be hosted on an encrypted,
access-controlled volume under the laboratory's retention policy.

## Implemented Control Plane

Migration `20260801000000_evidence_node_lab_adapter.sql` adds append-only,
tenant-scoped ledgers:

- `evidence_node_adapter_contract_events`
- `evidence_node_ingestion_receipt_events`
- `evidence_node_identity_link_events`
- `evidence_node_closure_task_events`
- `evidence_node_export_events`

Authenticated clients have tenant-scoped read access only. Ledger appends are
service-only, ensuring contract, closure, and export mutations cannot bypass
the API policy and step-up gates through a direct database client.

`ingest_evidence_node_packet_v1` wraps canonical AST ingestion, receipt creation,
identity linking, reconciliation, and initial closure-task creation in one
database transaction. Accepted evidence requires:

- latest contract state `activated` and in its effective window;
- exact tenant, clinic, laboratory, OAuth client, adapter, mapping, source,
  reference-key ID, transport, and format match;
- active mTLS-bound workload proof and current connector probe;
- de-identified, non-synthetic canonical packet with AST results;
- no raw central payload.

An explicit tenant-owned case or patient episode creates a verified link and a
`confirm_treatment` task. Otherwise the packet remains accepted laboratory
evidence but creates a proposed link and urgent `reconcile_episode` task. The
system does not invent patient identity from weak similarity.

`advance_evidence_node_closure_task_v1` advances the remaining chain in one
database transaction:

```text
reconcile episode
  -> verify identity + match AST ingestion
  -> confirm treatment + stewardship event
  -> confirm follow-up + clinician review
  -> confirm outcome + linked inference/outcome
  -> close episode + evaluate calibration/federation eligibility
```

A failed transition writes neither a partial milestone nor a next task.
Evidence-grade eligibility additionally requires an `expert_reviewed` or
`lab_confirmed` outcome with a non-empty confirmed label.
Treatment and outcome closure also verifies that stewardship, inference,
outcome, and lab-feed evidence belongs to the same tenant and reconciled case;
the linked inference and outcome must be non-synthetic, and the lab-feed digest
must match the ingested source record.

Contract and closure transitions are serialized per contract/task. Failed
write-back attempts can be dispatched again without overwriting prior events;
every attempt retains its own request ID and immutable evidence record.

Exact ingestion retries return the original receipt, ingestion, identity,
episode, reconciliation, and current closure-task identifiers. Duplicate and
cached packets are not metered again. A mapping revision has a distinct dedupe
namespace so corrected transformations can be reviewed and reprocessed without
weakening source-level duplicate detection.

Committed request retries are resolved before current contract-state checks,
so an immutable receipt remains readable after suspension or expiry. Reusing a
request ID with different contract, mapping, source, workload, or canonical
packet facts is rejected as an idempotency conflict.

Identical request IDs are serialized inside the database transaction, so two
simultaneous deliveries resolve to the same immutable receipt chain. The active
contract also binds the exact source-system version; a source upgrade requires
a reviewed contract/mapping lifecycle rather than silently changing semantics.
Transient connector-probe IDs are injected after each heartbeat and are excluded
from the semantic mapping hash, so liveness rotation cannot silently create a
new mapping version.

## Embedded Closure

`POST /api/amr/evidence-node` records closure task transitions independently of
vendor UI design. Supported destinations are:

- PIMS write-back;
- LIS write-back;
- signed webhook;
- VetIOS manual work queue.

Completion requires a reviewer. Non-manual write-back completion requires a
receipt hash at the database boundary. Actual vendor write-back still depends
on the partner contract, API permissions, and a partner-specific receiver
adapter. This v1 build records and governs write-back state but does not claim a
generic PIMS/LIS write-back transport is active.

Write-back is disabled by default. A contract must set both
`writeback_permitted: true` and an immutable destination channel. Otherwise all
tasks remain in the VetIOS manual work queue.

Task completion fields are stage-specific:

- reconciliation: `case_id` or `patient_episode_id`;
- treatment: `amr_stewardship_event_id` and `treatment_strategy`;
- follow-up: `followup_days` and reviewer identity;
- outcome: `inference_event_id`, `clinical_outcome_id`, non-unknown outcome,
  consent state, and reviewer identity.

## Standards Projections

The control plane can generate:

- `infarm_compat_v1`
- `nahln_compat_v1`
- `kabs_compat_v1`

Each record retains raw vendor terminology, code systems, source version, AST
method, interpretation standard/version, and source breakpoint basis. Synthetic,
identifiable, raw-payload, blocked, or result-less records are excluded.

These are internal compatibility projections, not official receiver schemas or
certifications. Their validation scope is `vetios_internal_projection`:

- InFARM output is a national-data preparation candidate and still requires the
  designated national focal-point workflow;
- NAHLN output is terminology/message preflight and still requires the receiver's
  exact HL7 profile, laboratory OID, certificate, and program mapping;
- KABS output is a surveillance handoff candidate until the Kenyan receiver
  validates a machine exchange schema.

`official_acceptance` can become true only after a delivered artifact receives
an external acceptance receipt; the accepted event changes validation scope to
`external_receiver`.

## Operations Metrics

`GET /api/amr/evidence-node` reports:

- configured and active contracts;
- cryptographic connector probe pass rate;
- ingestion lag;
- accepted, duplicate, and blocked receipt rates;
- episode reconciliation rate;
- closure task completion rate;
- standards export acceptance rate;
- pending closure work.

Probe pass rate is scoped to the Evidence Node contract's bound laboratory and
OAuth client over a 24-hour window. It measures emitted cryptographic probes and
cannot prove uptime during periods where the node emitted no probe. A heartbeat
may prove the connector is alive with zero new records; ingestion lag separately
shows whether source evidence is arriving.

## Capability Status

| Capability | Built boundary | Production dependency |
| --- | --- | --- |
| Adapter runtime | Executable collectors, parsers, encrypted spool, mTLS OAuth, retries, replay, and record-isolated rejection receipts | Real vendor endpoint, approved mapping, host secret manager, and issued certificate |
| Episode reconciliation | Atomic accession/specimen/AST-to-case or patient-episode linking with explicit reviewer tasks | Tenant-owned cases and real reviewer closure |
| Embedded closure | Full VetIOS manual-work-queue flow plus governed dispatch/acknowledgement/receipt states | A partner-specific PIMS/LIS receiver is required before non-manual write-back is active |
| Evidence contract | Versioned contract, mapping, source, privacy, consent, workload, provenance, and immutable receipt binding | Signed lab agreement and activated tenant contract |
| Network operations | Contract-scoped probe, lag, duplicate, blocked, reconciliation, closure, and export metrics | A continuously running node and production telemetry |
| Standards exports | Provenance-preserving internal InFARM, NAHLN, and KABS compatibility candidates | Receiver-owned schema validation and acceptance receipt; no certification is inferred |

This is deployable infrastructure, but repository verification cannot substitute
for the production dependencies in the final column.

## Production Activation Checklist

1. Enroll one real lab and one clinic under tenant-scoped data-use terms.
2. Approve the laboratory's exact mapping artifact and capture its SHA-256 hash.
   Bind the node's non-secret `reference_key_id`; changing it requires a new
   contract lifecycle so identity continuity is reviewable.
3. Issue an mTLS OAuth client with `amr:read` and `amr:ingest` only.
4. Record a passing production connector probe.
5. Draft, approve, and activate the adapter contract.
6. Run `doctor --remote`, one dry operational cycle, then a committed cycle.
7. Verify receipt, AST result, surveillance, identity link, reconciliation, and closure task IDs.
8. Complete the queued reconciliation, treatment, follow-up, and outcome tasks;
   verify the AMR episode reaches `episode_closed` and receives an eligibility event.
9. Generate a compatibility export and obtain receiver validation before recording acceptance.

## Verification Boundary

Automated tests cover parser behavior, privacy exclusion, encrypted spool,
deduplication, replay, contract-state materialization, network metrics,
compatibility exports, migration invariants, and existing AMR regressions.
They do not substitute for a real LIS connection, partner acceptance testing,
authority certification, or outcome acquisition.
