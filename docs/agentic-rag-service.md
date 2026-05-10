# VetIOS Agentic RAG Service

VetIOS Agentic RAG provides tenant-scoped ingestion, chunking, embedding, retrieval, citation logging, and catalog refresh for veterinary and medical evidence. It is clinical decision-support infrastructure only; retrieved evidence must be interpreted by licensed professionals.

## Service Surface

- `GET /api/rag/catalog` returns the curated veterinary and medical source catalog plus corpus readiness.
- `POST /api/rag/catalog` seeds or force-refreshes the curated catalog for the authenticated tenant.
- `GET /api/rag/sources` lists tenant RAG sources.
- `POST /api/rag/sources` registers a source with trust tier, species scope, domain scope, URL policy, and refresh metadata.
- `GET /api/rag/documents` lists indexed tenant documents.
- `POST /api/rag/documents` indexes pasted text or a safe public HTTPS text/HTML source.
- `POST /api/rag/query` runs hybrid/vector/lexical retrieval and returns extractive, citation-first answers.
- `GET /api/rag/closed-loop` returns corpus readiness, closed-loop learning status, and VetIOS self-protection posture.
- `GET|POST /api/cron/rag-refresh` refreshes due curated catalog entries for `VETIOS_PUBLIC_RAG_TENANT_ID` or `x-vetios-tenant-id`.

Machine credentials need `rag:read` for list/query routes and `rag:write` for source, document, and catalog ingestion.

## Source Strategy

The curated catalog deliberately mixes high-authority veterinary and medical source classes:

- Veterinary professional guidelines: AVMA, AAHA, WSAVA, ACVIM.
- Veterinary professional guidelines: AVMA, AAHA, WSAVA, ACVIM, AAFP, CAPC, ESCCAP, IRIS.
- Veterinary reference and disease material: Merck Veterinary Manual, Cornell Feline Health Center, Veterinary Partner VIN.
- Regulatory and public health sources: FDA Animal Drugs at FDA, DailyMed, CDC One Health, CDC Healthy Pets, USDA APHIS Veterinary Services, WOAH standards.
- Peer-reviewed discovery indexes: PubMed, PubMed Central Open Access.
- Biomedical bridge references: NCBI Bookshelf.
- Low-trust commercial discovery: BioVenic animal-health platform, veterinary therapeutic antibody development, and canine distemper antibody material, explicitly tiered as `unverified`.

Every catalog entry indexes a VetIOS source card with trust tier, species/domain scope, refresh policy, safety boundary, and integration hooks. Public HTTPS and regulatory connectors can also attempt page snapshots. NCBI connectors index literature-summary snapshots through E-utilities metadata rather than scraping restricted full text.

## Data Model

The Supabase migrations add:

- `rag_sources`: source registry with authority tier, provenance, refresh policy, and quality score.
- `rag_documents`: indexed documents with content hashes, provenance, refresh status, and auto-indexing metadata.
- `rag_chunks`: pgvector and lexical chunks for retrieval.
- `rag_queries`: query ledger with citations, retrieval stats, evaluation, causal memory context, counterfactual context, and One Health context.
- `rag_source_refresh_runs`: refresh audit records for catalog seed and cron jobs.

Retrieval uses `match_rag_chunks` for vector search and `search_rag_chunks_lexical` for lexical search, then reranks by source authority plus similarity.

## Closed-Loop Learning Contract

With the seeded corpus state you reported on May 10, 2026 - `23` sources, `41` indexed documents, `126` chunks, `20` high-authority sources, and `0` stale documents - VetIOS has enough indexed evidence for the RAG evidence loop to be considered ready.

That loop is intentionally human-gated:

- Source registration feeds authority-tiered `rag_sources`.
- Document ingestion feeds hashed `rag_documents` and provenance-preserving `rag_chunks`.
- Retrieval feeds citation-first clinical answers, refusal states, query stats, causal memory, counterfactual review, and One Health context.
- Diagnostic misses, retrieval gaps, clinician feedback, and outcomes feed active-learning candidates.
- No clinical behavior, source tier, prompt, or model promotion is automatic. Promotion requires citations, counterfactual review, clinician/steward approval, and an audit trace.

This means the veterinary and medical source datasets can serve as clinical reasoning infrastructure and diagnostic intelligence pipeline inputs without allowing unsupported self-training or silent source promotion.

Apply the schema before pressing **Seed Catalog**:

```bash
supabase db push
```

Or apply these SQL files in order through the Supabase SQL editor:

```text
supabase/migrations/20260510000000_agentic_rag_service.sql
supabase/migrations/20260510010000_agentic_rag_automation.sql
```

## Environment

```dotenv
VETIOS_PUBLIC_RAG_TENANT_ID=public
VETIOS_RAG_EMBEDDING_MODEL=text-embedding-3-small
VETIOS_RAG_EUTILS_BASE_URL=https://eutils.ncbi.nlm.nih.gov/entrez/eutils
VETIOS_RAG_CONNECTOR_MAX_RECORDS=8
VETIOS_NCBI_TOOL=vetios_agentic_rag
VETIOS_NCBI_EMAIL=
VETIOS_NCBI_API_KEY=
CRON_SECRET=replace-with-32-char-random-hex
VETIOS_ALLOWED_ORIGINS=https://www.vetios.tech,https://vetios.tech,https://app.vetios.tech
VETIOS_CLIENT_ATTESTATION_SECRET=replace-with-32-char-random-hex
VETIOS_PROTECTION_REPORT_ONLY=true
VETIOS_STRICT_ORIGIN_GUARD=false
VETIOS_STRICT_CLIENT_ATTESTATION=false
```

`VETIOS_NCBI_EMAIL` and `VETIOS_NCBI_API_KEY` are optional but recommended for accountable NCBI API usage.

## Safety Rules

- Non-HTTPS, local, private IP, and metadata URLs are rejected before ingestion.
- Source cards preserve source authority and safety boundaries so unverified or human-medical material cannot be silently promoted to clinical protocol status.
- Answers are extractive and citation-first. If no indexed evidence is retrieved, VetIOS refuses to generate unsupported clinical claims.
- Causal memory, counterfactual review, and One Health context are logged with each query when matching tenant tables are available.
- Self-protection reports or blocks clone-like origins, host mismatches, uncredentialed automation, invalid client attestations, and suspicious browser request patterns.
