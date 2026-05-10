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
```

`VETIOS_NCBI_EMAIL` and `VETIOS_NCBI_API_KEY` are optional but recommended for accountable NCBI API usage.

## Safety Rules

- Non-HTTPS, local, private IP, and metadata URLs are rejected before ingestion.
- Source cards preserve source authority and safety boundaries so unverified or human-medical material cannot be silently promoted to clinical protocol status.
- Answers are extractive and citation-first. If no indexed evidence is retrieved, VetIOS refuses to generate unsupported clinical claims.
- Causal memory, counterfactual review, and One Health context are logged with each query when matching tenant tables are available.
