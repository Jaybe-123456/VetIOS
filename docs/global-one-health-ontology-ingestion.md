# Global One Health Ontology Ingestion

VetIOS treats global condition expansion as a governed infrastructure layer, not as a free-form model hallucination surface.

## Completion Boundary

This build is complete for the infrastructure path when all of these are true:

- Source-seeded One Health candidates are generated from inference context.
- Official sources are registered in the retrieval/source catalog.
- Seed rows can be materialized into append-only Supabase ontology tables.
- Official ontology/API ingestion creates external-code mappings only when a code is found in an official artifact/API response.
- Official ontology release population imports source release nodes, relationships, release hashes, and population snapshots.
- Inference-time candidate expansion reads verified mappings from Supabase.
- Graph-backed expansion reads populated ontology nodes/edges and returns shadow candidates.
- Reviewer and external validation events govern mapping promotion.
- Completion snapshots compute whether the ontology is still foundation, partial, blocked, ready for review, externally validated, or fully populated.
- Verified expansion is returned and persisted as review-gated evidence.
- Verified expansion does not alter diagnostic probabilities until reviewer verification and outcome evidence exist.

## Endpoints

Plan official ontology providers:

```http
GET /api/ontology/global-one-health/ingest
```

Dry-run official ingestion:

```http
POST /api/ontology/global-one-health/ingest
Content-Type: application/json

{
  "dry_run": true,
  "provider_keys": ["mondo_obo_json"],
  "condition_keys": ["rabies", "anthrax"]
}
```

Commit official mappings:

```http
POST /api/ontology/global-one-health/ingest
Content-Type: application/json

{
  "request_id": "global-one-health-official-ingest-2026-07-06",
  "provider_keys": ["mondo_obo_json"],
  "condition_keys": ["rabies", "anthrax"]
}
```

Materialize source-seeded condition rows:

```http
POST /api/ontology/global-one-health/materialize
Content-Type: application/json

{
  "request_id": "global-one-health-seed-v1",
  "dry_run": false
}
```

Populate official release nodes and relationships:

```http
POST /api/ontology/global-one-health/populate
Content-Type: application/json

{
  "request_id": "global-biomedical-ontology-population-2026-07-06",
  "provider_keys": ["mondo_obo_json", "hpo_obo_json"],
  "dry_run": true,
  "max_nodes_per_provider": 50000,
  "max_relationships_per_provider": 100000
}
```

Set `dry_run` to `false` only after reviewing node counts, provider skips, release hashes, and expected Supabase write volume.

Populate only the WOAH WAHIS provider:

```http
POST /api/ontology/global-one-health/populate
Content-Type: application/json

{
  "request_id": "wahis-auto-ingestion-2026-07-08",
  "provider_keys": ["woah_wahis_official_export"],
  "dry_run": true
}
```

Run the full scheduled ontology orchestrator:

```http
GET /api/cron/global-ontology-ingestion?tenant_id=<tenant-uuid>
Authorization: Bearer <CRON_SECRET>
```

The orchestrator runs population import, official mapping ingestion, ingestion audit, and a completion snapshot. Add `dry_run=true` to inspect without committing writes.

Record reviewer verification or external validation:

```http
POST /api/ontology/global-one-health/mapping-review
Content-Type: application/json

{
  "event_type": "mapping_review",
  "request_id": "mapping-review-rabies-mondo-2026-07-06",
  "condition_key": "rabies",
  "source_key": "mondo_disease_ontology",
  "external_code_system": "MONDO",
  "external_code": "MONDO:0005091",
  "review_action": "approve",
  "reviewer_role": "clinical_ontology_reviewer"
}
```

```http
POST /api/ontology/global-one-health/mapping-review
Content-Type: application/json

{
  "event_type": "external_validation",
  "request_id": "external-validation-rabies-mondo-2026-07-06",
  "condition_key": "rabies",
  "source_key": "mondo_disease_ontology",
  "external_code_system": "MONDO",
  "external_code": "MONDO:0005091",
  "validation_provider": "external-ontology-review",
  "validation_method": "third_party_conformance",
  "validation_status": "externally_verified"
}
```

Record or dry-run the computed completion state:

```http
POST /api/ontology/global-one-health/completion
Content-Type: application/json

{
  "request_id": "global-ontology-completion-2026-07-06",
  "dry_run": false
}
```

## Provider Status

| Provider | Current Status | Notes |
| --- | --- | --- |
| MONDO | Active public OBO JSON ingestion | Supports verified condition-code mappings. |
| HPO | Registered phenotype bridge | Not treated as a condition-code source. |
| UMLS | Credential-gated API ingestion | Requires `UMLS_API_KEY`; writes UMLS CUI mappings when exact search confirms a seed term. |
| ICD-11 | Credentialed API importer | Requires WHO ICD API OAuth credentials; imports search nodes as review-gated terminology evidence. |
| PubMed/PMC | Public API importers | Uses NCBI E-utilities; production should set an API key. |
| SNOMED CT | License-gated release source | Requires a licensed JSON release URL and deployment-specific terms. |
| VeNom | Release/license-gated veterinary nomenclature | Requires release/source URL and review before verified code writes. |
| WOAH WAHIS | Auto-ingestion official export adapter | Requires `WAHIS_EXPORT_URL`; imports CSV/JSON surveillance records as review-gated nodes. If missing, records `provider_status = missing_export_url` in a blocked release event. |
| CDC Open Data | Auto-ingestion Socrata adapter | Requires `CDC_OPEN_DATA_URL`; imports CDC JSON/CSV public-health records as review-gated One Health surveillance nodes. Optional `CDC_OPEN_DATA_APP_TOKEN` is supported. |

## WOAH WAHIS Auto-Ingestion Adapter

WAHIS is treated as a one-time official export link, then automatic cron ingestion.

Do not set `WAHIS_EXPORT_URL` to `https://wahis.woah.org/`; that is the interactive portal, not an ingestable export artifact.

Recommended storage shape:

```text
Supabase Storage bucket:
ontology-provider-exports

Object path:
wahis/latest.csv

Stable URL:
https://<project>.supabase.co/storage/v1/object/public/ontology-provider-exports/wahis/latest.csv
```

Set:

```bash
WAHIS_EXPORT_URL=https://<project>.supabase.co/storage/v1/object/public/ontology-provider-exports/wahis/latest.csv
```

Adapter behavior:

- If `WAHIS_EXPORT_URL` is missing, VetIOS writes a blocked `official_ontology_release_events` row with `release_packet.provider_status = "missing_export_url"` and blocker `missing_export_url:WAHIS_EXPORT_URL`.
- If the URL exists, VetIOS fetches it on cron and accepts CSV or JSON.
- Imported rows become `global_biomedical_ontology_node_events` with `node_kind = "surveillance_record"`.
- Every run stores `source_document_hash`, raw row count, imported row count, skipped row count, parser version, source URL, and ontology coverage in `release_packet`.
- WAHIS rows stay review-gated population surveillance evidence. They do not directly alter diagnosis probabilities.

Minimal CSV columns supported:

```csv
event_id,disease_name,country,species,event_start_date,status,cases,deaths
```

The parser also recognizes common variants such as `Disease`, `Disease Name`, `Country`, `Species`, `eventId`, `reportId`, `outbreakId`, `eventStartDate`, and `submissionDate`.

## CDC Open Data Adapter

CDC Open Data runs on Socrata/SODA-style dataset endpoints. Do not set `CDC_OPEN_DATA_URL` to `https://data.cdc.gov/`; that is the catalog homepage, not an ingestable dataset.

Use a specific machine-readable endpoint:

```text
https://data.cdc.gov/resource/<dataset-id>.json
https://data.cdc.gov/resource/<dataset-id>.csv
https://data.cdc.gov/api/views/<dataset-id>/rows.csv?accessType=DOWNLOAD
```

Set:

```bash
CDC_OPEN_DATA_URL=https://data.cdc.gov/resource/<dataset-id>.json
CDC_OPEN_DATA_APP_TOKEN=
```

`CDC_OPEN_DATA_APP_TOKEN` is optional, but recommended for production scheduled ingestion because Socrata app tokens improve API throttling behavior.

Adapter behavior:

- If `CDC_OPEN_DATA_URL` is missing, VetIOS writes a blocked `official_ontology_release_events` row with `release_packet.provider_status = "missing_open_data_url"` and blocker `missing_open_data_url:CDC_OPEN_DATA_URL`.
- If `CDC_OPEN_DATA_URL` points to `https://data.cdc.gov/`, VetIOS writes a blocked release row with `provider_status = "portal_url_not_dataset_endpoint"`.
- JSON `/resource/<id>.json` endpoints get a bounded `$limit` query parameter when one is not already present.
- CSV and JSON rows become `global_biomedical_ontology_node_events` with `node_kind = "surveillance_record"`.
- Each run stores source hash, parser version, source URL, fetch URL, raw row count, imported row count, skipped row count, app-token usage, and coverage evidence.
- CDC rows remain public-health surveillance context. They do not directly alter veterinary diagnosis probabilities.

Minimal CDC row fields supported:

```csv
id,condition,state,date,cases,deaths
```

The parser also recognizes common variants such as `disease`, `disease_name`, `illness`, `pathogen`, `indicator`, `topic`, `jurisdiction`, `state_name`, `county`, `location`, `reporting_area`, `week_end`, `week_ending`, `report_date`, `mmwr_year`, and `mmwr_week`.

## Environment Variables

```bash
UMLS_API_KEY=
WHO_ICD_CLIENT_ID=
WHO_ICD_CLIENT_SECRET=
NCBI_API_KEY=
WAHIS_EXPORT_URL=
CDC_OPEN_DATA_URL=
CDC_OPEN_DATA_APP_TOKEN=
SNOMED_CT_RELEASE_URL=
VENOM_RELEASE_URL=
GLOBAL_ONTOLOGY_MAX_NODES_PER_PROVIDER=5000
GLOBAL_ONTOLOGY_MAX_RELATIONSHIPS_PER_PROVIDER=10000
```

Do not point licensed variables at third-party material unless the deployment has the legal right to use and store that release.

## Supabase Evidence Tables

- `global_health_condition_ontology_events`
- `global_condition_source_mapping_events`
- `one_health_condition_edge_events`
- `condition_coverage_snapshot_events`
- `global_condition_expansion_events`
- `official_ontology_ingestion_run_events`
- `official_ontology_release_events`
- `global_biomedical_ontology_node_events`
- `global_biomedical_ontology_relationship_events`
- `global_biomedical_ontology_population_snapshot_events`
- `global_condition_source_mapping_review_events`
- `global_ontology_external_validation_events`
- `global_biomedical_ontology_completion_snapshot_events`

All are append-only evidence tables. They store source keys, external code refs, hashes, and compact audit packets. They must not store raw clinical notes, raw source corpus text, owner data, or unreviewed treatment instructions.

## Clinical Safety Gate

Inference returns `global_condition_expansion` as a separate review-gated section. It is not fed back into probability scoring until:

- the mapping is reviewer verified or externally verified,
- the candidate is supported by patient-level diagnostics or source evidence,
- outcome-confirmed learning has enough evidence to calibrate the label,
- the actionability gate allows scoring promotion.

That boundary is intentional: VetIOS can become broad without becoming reckless.

## Population Status Semantics

VetIOS must not call the ontology fully populated unless all configured provider releases have actually been imported.

- `foundation`: no official release population has been imported.
- `partial`: one or more imports failed or only part of the provider set is represented.
- `public_sources_populated`: public official sources such as MONDO/HPO are imported, while credentialed/licensed providers remain blocked.
- `credentialed_sources_populated`: credentialed API sources are imported, but licensed releases still need verification.
- `fully_populated`: all required official providers are imported, source mappings have reviewer/external validation evidence, and inference has emitted live coverage snapshots.
- `blocked`: required provider access is missing.

The desired infrastructure posture is `public_sources_populated` immediately, then `fully_populated` only after UMLS, ICD-11, WAHIS, CDC, PubMed/PMC, SNOMED CT, and VeNom credentials or release files are configured, imported, reviewed, externally validated, and represented in live inference coverage snapshots.
