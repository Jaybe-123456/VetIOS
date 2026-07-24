# VetIOS AMR Outcome Network Pilot v1

## Objective

Operate one reference laboratory and three to five clinics as an outcome-linked
AMR evidence network. The pilot target is 250 de-identified culture/AST episodes
with source provenance, versioned AST interpretation, treatment, licensed
clinician review, confirmed outcome, and inference linkage.

The software can enforce and audit this workflow. It cannot claim an operating
network until real agreements, connectors, episodes, reviews, and outcomes exist.

## Evidence Gates

An episode is calibration-eligible only when it is:

- non-synthetic and explicitly de-identified;
- covered by approved learning consent;
- linked to an inference event and clinical outcome event;
- reviewed by a licensed clinician; and
- closed with a confirmed outcome other than `unknown`.

It is federation-eligible only when it also has:

- culture and verified AST milestones;
- an AST interpretation standard and version supplied by the laboratory;
- a linked AMR lab-feed event and stewardship/treatment event;
- a source-record SHA-256 digest and evidence-packet SHA-256 hash; and
- operational clinic and laboratory connectors.

`evidence_ready` requires all of the following:

- at least one operational laboratory;
- at least three operational clinics;
- at least 250 federation-eligible outcome-confirmed episodes;
- an outcome-linked AMR surveillance proof covering at least 250 export-ready
  laboratory records; and
- a follow-up AMR calibration run with lower expected calibration error than
  the baseline.

## Operator Workflow

1. Apply `supabase/migrations/20260723000000_amr_outcome_network_pilot.sql`.
2. Open `/amr-network`.
3. Append `invited`, `enrolled`, `data_use_approved`, and
   `connector_verified` events for each real site.
4. Append episode milestones in order:
   `episode_opened`, `culture_received`, `ast_verified`,
   `treatment_recorded`, `clinical_review_completed`, `outcome_confirmed`,
   and `episode_closed`.
5. Run AMR calibration after each material outcome cohort.
6. Seal an evidence snapshot. A seal is an append-only measurement, not a
   declaration that missing external work is complete.

The API is `GET|POST /api/amr/outcome-network`. Supported POST actions are:

- `record_site_event`
- `record_episode_event`
- `run_calibration`
- `persist_snapshot`

## Data Boundary

The AMR network ledgers do not store raw laboratory reports, owner identifiers,
patient names, accession numbers, credentials, or narrative clinical notes.
Private site and reviewer references are SHA-256 hashed before persistence.
Raw source records remain in the clinic/laboratory system of record.

Every linked case, inference, clinical outcome, stewardship event, and laboratory
feed event is resolved inside the authenticated tenant before insertion. VetIOS
derives synthetic status from those linked records and preserves any prior
synthetic or de-identification failure state. Both the API and database trigger
reject cross-tenant references, mismatched inference/outcome chains, and
laboratory digest mismatches.

VetIOS does not derive susceptibility breakpoints. The laboratory must provide
the interpretation standard and version used for each AST result. VetIOS stores
the resulting interpretation, provenance, and evidence hashes.

## Operational Verification

For each connector:

1. Validate schema and source version.
2. Run an authenticated production probe.
3. Confirm idempotent replay produces no duplicate surveillance record.
4. Confirm raw identifiers are absent from the derived packet.
5. Confirm the source digest and evidence hash are stable.
6. Confirm the linked episode remains blocked until treatment, review, and
   outcome milestones are complete.
7. Confirm synthetic rows never enter calibration or federation counts.

## Reference Frameworks

- WHO GLASS manual for antimicrobial resistance surveillance:
  <https://www.who.int/publications/i/item/9789240076600>
- WOAH antimicrobial resistance programme:
  <https://www.woah.org/en/what-we-do/global-initiatives/antimicrobial-resistance/>
- WOAH ANIMUSE:
  <https://www.woah.org/en/article/animuse-monitoring-antimicrobial-use-in-animals/>
- FAO ATLASS:
  <https://www.fao.org/antimicrobial-resistance/resources/tools/fao-atlass/en/>
- CLSI veterinary antimicrobial susceptibility testing standards:
  <https://clsi.org/standards/products/veterinary-medicine/>
