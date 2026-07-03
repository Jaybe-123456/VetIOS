# VetIOS

> AI-Native Veterinary Intelligence Infrastructure

[![CI](https://img.shields.io/github/actions/workflow/status/Jaybe-123456/VetIOS/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/Jaybe-123456/VetIOS/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-20.x-339933?logo=node.js&logoColor=white&style=flat-square)](.nvmrc)
[![pnpm](https://img.shields.io/badge/pnpm-9.14.4-F69220?logo=pnpm&logoColor=white&style=flat-square)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-87%25-3178C6?logo=typescript&logoColor=white&style=flat-square)](package.json)
[![Website](https://img.shields.io/badge/website-vetios.tech-6BF7CF?style=flat-square)](https://www.vetios.tech)
[![CIRE-compatible](https://img.shields.io/badge/CIRE-compatible-7C3AED?style=flat-square)](docs/research/cire-scoring-methodology-v1.0.md)

VetIOS is a simulation-first, inference-driven platform for structured clinical intelligence and adaptive veterinary diagnostics. It replaces passive veterinary record systems with a computable graph of probabilistic diagnostic reasoning.

Public links:

- Official site: [vetios.tech](https://www.vetios.tech)
- Live demo: [vetios.tech/demo](https://www.vetios.tech/demo)
- Veterinary AI: [vetios.tech/veterinary-ai](https://www.vetios.tech/veterinary-ai)
- Veterinary Diagnostic AI: [vetios.tech/veterinary-diagnostic-ai](https://www.vetios.tech/veterinary-diagnostic-ai)
- Quantum Veterinary AI: [vetios.tech/quantum-veterinary-ai](https://www.vetios.tech/quantum-veterinary-ai)
- Platform: [vetios.tech/platform](https://www.vetios.tech/platform)
- Docs: [vetios.tech/docs](https://www.vetios.tech/docs)

> **Project status:** Alpha. VetIOS is under active development and should be treated as clinical decision-support infrastructure, not a substitute for licensed veterinary judgment or regulated medical-device workflows.

## Table of Contents

- [Why VetIOS?](#why-vetios)
- [CIRE Open Standard](#cire-open-standard)
- [Architecture](#architecture)
- [Data Flywheel](#data-flywheel)
- [Federated Learning Moat](#federated-learning-moat)
- [Core API](#core-api)
- [Agentic RAG](#agentic-rag)
- [Monorepo Map](#monorepo-map)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Local Development](#local-development)
- [Configuration](#configuration)
- [Database Model](#database-model)
- [Testing](#testing)
- [Deployment](#deployment)
- [Use Cases](#use-cases)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why VetIOS?

VetIOS turns every structured veterinary encounter into an auditable learning loop: inference creates a probabilistic hypothesis, outcomes ground it in reality, and simulations stress-test the next version before failure reaches production.

## CIRE Open Standard

VetIOS publishes the Clinical Inference Reliability Engine (CIRE) as an open reliability specification for veterinary clinical AI. CIRE defines `phi_hat`, input impairment, rolling drift, volatility, CPS safety bands, and the minimum event lineage needed to connect inference, review, outcome confirmation, and calibration.

The strategy is CUDA-like but more precise: CIRE is the free scoring language and reference contract; VetIOS captures value in the managed infrastructure, outcome-confirmed data graph, AMR feeds, governance APIs, and partner-node workflows that run the standard at production quality.

- Human-readable methodology: [CIRE Scoring Methodology v1.0](docs/research/cire-scoring-methodology-v1.0.md)
- Public standard page: [vetios.tech/platform/cire-standard](https://www.vetios.tech/platform/cire-standard)
- Machine-readable contract: [vetios.tech/api/public/cire-standard](https://www.vetios.tech/api/public/cire-standard)
- Reference implementation: [@vetios/cire-engine](packages/cire-engine/src/index.ts)
- Compatibility check: `pnpm --filter @vetios/cire-engine test`

## Architecture

VetIOS is built around three cooperating layers: inference, outcome capture, and adversarial simulation.

```text
Structured clinical input
species, signalment, symptoms, vitals, labs, metadata
        |
        v
+-------------------------+
| Inference Layer         |
| /api/inference          |
| probabilistic outputs   |
+-------------------------+
        |
        v
ai_inference_events
        |
        v
+-------------------------+
| Outcome Layer           |
| /api/outcome            |
| ground-truth alignment  |
+-------------------------+
        |
        v
clinical_outcome_events
        |
        v
+-------------------------+
| Simulation Layer        |
| /api/simulate           |
| edge-case generation    |
+-------------------------+
        |
        v
edge_simulation_events
        |
        +----> safer routing, calibrated confidence, improved inference
```

The platform favors structured schemas over free text, append-only event logs over destructive updates, and safety-bounded simulation over post-hoc incident response.

## Data Flywheel

> **Inference -> Outcome -> Simulation -> Improved Inference**
>
> Every prediction can become supervised signal. Every outcome can reveal calibration drift. Every low-confidence or contradictory case can generate synthetic adversarial variants. The result is a compounding clinical intelligence loop designed for safer model routing, sharper confidence estimates, and clearer operational boundaries.

## Federated Learning Moat

VetIOS is building toward outcome-confirmed federated learning rather than pooled raw clinical data. The `@vetios/federation-node` package provides the deployable clinic/lab node path: local record loading, outcome eligibility checks, deterministic local delta computation, X25519/HKDF pairwise masking, encrypted unmask-share envelopes, Ed25519 update signatures, service-mode heartbeats, retry/audit logging, and key rotation.

The node runner now includes a multi-node secure aggregation proof mode:

```bash
pnpm --filter @vetios/federation-node build
vetios-federation-node round-proof \
  --participants participants.json \
  --federation-key one_health_amr \
  --round-key one_health_amr:round:001 \
  --federation-round-id round-001 \
  --minimum-participants 3 \
  --minimum-required-rows 20 \
  --minimum-provenance-rows 20 \
  --minimum-trust-scored-rows 20 \
  --include-coordinator-recovery-key \
  --out round-proof.json
```

Round-proof mode emits sanitized accepted-update submissions, participant audits, source digests, mask commitments, encrypted unmask-share evidence, aggregate materialization evidence, and a coordinator artifact input bundle. Raw clinic rows, raw model deltas, raw unmask seeds, source paths, and node private keys stay local. The optional coordinator recovery packet is for local proof only and is marked `do_not_persist_private_material`.

## Core API

The current application exposes the three core routes below from the Next.js App Router. Production requests are authenticated with a session or machine credential; local smoke tests can use `VETIOS_DEV_BYPASS=true`.

### `POST /api/inference`

Runs structured veterinary inference and persists an `ai_inference_events` record.

```bash
curl -X POST "$VETIOS_API_BASE_URL/api/inference" \
  -H "Authorization: Bearer $VETIOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": {
      "name": "gpt-4o-mini",
      "version": "2024-07-18"
    },
    "input": {
      "input_signature": {
        "species": "canine",
        "breed": "labrador retriever",
        "weight_kg": 24.5,
        "symptoms": ["lethargy", "vomiting"],
        "vitals": {
          "temperature_c": 39.2
        }
      }
    }
  }'
```

Typical response fields:

```json
{
  "inference_event_id": "uuid",
  "data": {
    "differentials": [],
    "confidence_score": 0.82
  },
  "cire": {
    "safety_state": "pass"
  },
  "meta": {
    "request_id": "uuid"
  },
  "error": null
}
```

### `POST /api/outcome`

Attaches clinical ground truth to a prior inference event and computes calibration delta.

```bash
curl -X POST "$VETIOS_API_BASE_URL/api/outcome" \
  -H "Authorization: Bearer $VETIOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "inference_event_id": "uuid-of-prior-inference",
    "outcome": {
      "type": "diagnosis_confirmed",
      "payload": {
        "label": "Pancreatitis",
        "actual_diagnosis": "Pancreatitis",
        "confidence": 0.94
      },
      "timestamp": "2026-05-08T00:00:00.000Z"
    }
  }'
```

Typical response fields:

```json
{
  "outcome_event_id": "uuid",
  "linked_inference_event_id": "uuid-of-prior-inference",
  "calibration_delta": 0.12,
  "request_id": "uuid"
}
```

### `POST /api/simulate`

Runs an adaptive or fixed stability sweep against synthetic clinical variants and persists an `edge_simulation_events` record.

```bash
curl -X POST "$VETIOS_API_BASE_URL/api/simulate" \
  -H "Authorization: Bearer $VETIOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "steps": 10,
    "mode": "adaptive",
    "base_case": {
      "species": "feline",
      "breed": "siamese",
      "symptoms": ["seizures", "ataxia", "blindness"],
      "metadata": {
        "edge_case": "contradictory neurological presentation"
      }
    },
    "inference": {
      "model": "gpt-4o-mini",
      "model_version": "2024-07-18"
    }
  }'
```

Typical response fields:

```json
{
  "simulation_event_id": "uuid",
  "clinical_case_id": "uuid",
  "stability_report": {
    "passes": 9,
    "failures": 1,
    "mean_confidence": 0.77
  },
  "request_id": "uuid"
}
```

For the broader API contract, see [`openapi.yaml`](openapi.yaml) and [`apps/web/public/api-spec/openapi-v1.yaml`](apps/web/public/api-spec/openapi-v1.yaml).

## Agentic RAG

VetIOS includes a tenant-scoped Agentic RAG service for veterinary and medical evidence ingestion. The service registers high-authority sources, chunks and embeds documents, supports hybrid retrieval, and returns extractive answers with citations and safety warnings.

Core routes:

- `GET|POST /api/rag/catalog` reads or seeds the curated source catalog.
- `GET|POST /api/rag/sources` lists or registers source metadata.
- `GET|POST /api/rag/documents` lists or indexes evidence documents.
- `POST /api/rag/query` retrieves cited evidence for a clinical question.
- `GET /api/rag/closed-loop` reports corpus readiness, closed-loop learning status, and self-protection posture.
- `GET|POST /api/cron/rag-refresh` refreshes due catalog sources through cron.

The curated catalog covers AVMA, AAHA, WSAVA, ACVIM, AAFP, CAPC, ESCCAP, IRIS, Merck Veterinary Manual, Cornell Feline Health Center, Veterinary Partner VIN, WOAH, CDC, USDA APHIS, FDA Animal Drugs, DailyMed, PubMed, PubMed Central Open Access, NCBI Bookshelf, and explicitly low-trust BioVenic commercial discovery sources. See [`docs/agentic-rag-service.md`](docs/agentic-rag-service.md) for the schema, environment, and safety boundaries, and [`docs/closed-loop-rag-learning-and-self-protection.md`](docs/closed-loop-rag-learning-and-self-protection.md) for the closed-loop and clone-defense model.

## Monorepo Map

```text
.
|-- apps/
|   |-- web/                  Next.js App Router product and API surface
|   `-- ml-training/          Python calibration, drift, and model-training services
|-- packages/
|   |-- ask-vetios/           Ask VetIOS response and research pipeline
|   |-- cire-engine/          Clinical integrity and safety-state engine
|   |-- db/                   Shared database client and tenant helpers
|   |-- gaas/                 Agent orchestration primitives
|   |-- inference-schema/     Shared inference types and validation
|   |-- logger/               Shared logging package
|   |-- federation-node/      Clinic/lab federated learning node SDK and runner
|   |-- pharmacos/            Veterinary formulary and drug safety logic
|   |-- tsconfig/             Shared TypeScript configuration
|   `-- ui/                   Shared UI primitives
|-- internal/
|   |-- ai-core/              Provider client, prompts, RAG, simulation, feedback loops
|   |-- domain/               Domain models for patients, encounters, outcomes, flywheel state
|   |-- testing/              Adversarial and regression test harnesses
|   |-- pharmacos/            Internal formulary seeding and FDA CVM sync tooling
|   |-- species-bootstrap/    Species graph bootstrapping
|   `-- image-pipeline/       Clinical image ingestion helpers
|-- docs/                     Architecture notes, go-live guides, migration notes
|-- infra/supabase/           Supabase infrastructure migrations and repair scripts
|-- supabase/                 Current Supabase migrations and manual bundles
|-- openapi.yaml              Platform API contract
|-- pnpm-workspace.yaml       Workspace package graph
`-- turbo.json                Turborepo task pipeline and environment passthrough
```

## Tech Stack

| Layer             | Technology                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| Monorepo          | pnpm workspaces, Turborepo v2                                                   |
| Web app           | Next.js App Router, React, TypeScript                                           |
| API runtime       | Next.js route handlers, Vercel deployment target                                |
| Database and auth | Supabase, PostgreSQL, Row-Level Security                                        |
| AI provider       | OpenAI-compatible `/chat/completions` provider                                  |
| Validation        | Zod, shared inference schema package                                            |
| Testing           | Custom adversarial regression runner, API smoke scripts, Vitest coverage in web |
| CI/CD             | GitHub Actions, Vercel auto-deploy                                              |

## Quick Start

```bash
git clone https://github.com/Jaybe-123456/VetIOS.git
cd VetIOS
corepack enable
pnpm install
pnpm -C apps/web dev
```

The web app starts at [http://localhost:3000](http://localhost:3000).

## Local Development

### Prerequisites

- Node.js `20.x`
- pnpm `9.14.4`
- Supabase project credentials
- OpenAI-compatible AI provider key

### Environment

Create `.env.local` in the repository root.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

AI_PROVIDER_BASE_URL=https://api.openai.com/v1
AI_PROVIDER_API_KEY=sk-your-provider-key
AI_PROVIDER_DEFAULT_MODEL=gpt-4o-mini

# Optional local-only bypass for smoke tests and isolated development.
VETIOS_DEV_BYPASS=true
```

### Commands

```bash
pnpm install
pnpm -C apps/web dev
pnpm build
pnpm lint
pnpm typecheck
pnpm format
```

Run local API smoke tests against a running dev server:

```bash
bash apps/web/scripts/test-api-local.sh
```

Run the adversarial regression harness:

```bash
pnpm test:adversarial-regressions
```

## Configuration

VetIOS can use OpenAI directly or any provider that implements an OpenAI-compatible chat completions API.

```dotenv
# OpenAI default path
OPENAI_API_KEY=sk-your-openai-key

# Provider-agnostic path
AI_PROVIDER_NAME=openai
AI_PROVIDER_BASE_URL=https://api.openai.com/v1
AI_PROVIDER_API_KEY=sk-your-provider-key
AI_PROVIDER_DEFAULT_MODEL=gpt-4o-mini
AI_PROVIDER_EMBEDDING_MODEL=text-embedding-3-small
```

### Speculative Decoding

Speculative decoding can reduce latency for LLM-heavy VetIOS paths such as Ask VetIOS and diagnostic image review when the configured generation server supports it. Public OpenAI chat completions do not expose a VetIOS-controlled speculative decoding switch, so VetIOS does not send speculative request fields to `api.openai.com` by default.

For a compatible custom OpenAI-style backend, configure the model server first, then enable VetIOS telemetry/request hints:

```dotenv
AI_PROVIDER_NAME=vllm
AI_PROVIDER_BASE_URL=https://your-low-latency-provider.example/v1
AI_PROVIDER_API_KEY=...
AI_PROVIDER_DEFAULT_MODEL=vetios-target-model

AI_SPECULATIVE_DECODING_ENABLED=true
# server = backend already configured out-of-band.
# top_level or extra_body = send speculative_config request hints to compatible gateways.
AI_SPECULATIVE_DECODING_MODE=server
AI_SPECULATIVE_DRAFT_MODEL=vetios-draft-model
AI_SPECULATIVE_NUM_DRAFT_TOKENS=4
```

Provider responses include `ensemble_metadata.speculative_decoding` so latency audits can confirm whether the request used server-side speculative decoding or request-body speculation hints.

Optional custom-model validation is available through the Hugging Face-compatible provider hooks used by the AI layer:

```dotenv
HF_PROVIDER_BASE_URL=https://your-custom-provider.example/v1
HF_PROVIDER_API_KEY=hf-or-provider-key
HF_PROVIDER_MODEL=vetios-qwen-0.5b
```

Operational environment variables are passed through Turborepo in [`turbo.json`](turbo.json), including Supabase keys, telemetry flags, outbox controls, billing keys, simulation watchdog settings, and machine API tokens.

## Database Model

VetIOS uses an append-only, event-sourced database philosophy. Clinical intelligence should be reconstructed from event history, not overwritten in place.

Core event tables:

| Table                     | Purpose                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `ai_inference_events`     | Stores model inputs, diagnostic output payloads, confidence, latency, routing, and safety metadata |
| `clinical_outcome_events` | Stores ground-truth clinical outcomes linked back to inference events                              |
| `edge_simulation_events`  | Stores synthetic and adversarial simulation runs, stress metrics, and failure modes                |

Design constraints:

- No destructive updates for clinical provenance.
- Every inference should be traceable to input signature, model version, tenant, and request metadata.
- Outcomes are attached as new facts, not retroactive edits to clinical history.
- Simulation events define known weak zones before they become operational failures.

## Testing

VetIOS uses layered verification:

- `pnpm lint` for code quality gates.
- `pnpm typecheck` for TypeScript correctness.
- `pnpm build` for application and package build validation.
- `bash apps/web/scripts/test-api-local.sh` for core API smoke tests.
- `pnpm test:adversarial-regressions` for failure-driven regression coverage.
- `pnpm --filter @vetios/federation-node test` for clinic-node training, masking, signing, and proof-bundle coverage.
- `pnpm --filter @vetios/web test -- lib/federation/__tests__/aggregateBuilder.test.ts` for coordinator aggregate materialization coverage.

The adversarial runner lives at [`internal/testing/test_adversarial_regressions.ts`](internal/testing/test_adversarial_regressions.ts) and is executed with Node's TypeScript stripping support.

## Deployment

The web application is deployed to Vercel and designed for serverless scaling.

- Production URL: [https://www.vetios.tech](https://www.vetios.tech)
- CI workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- Deployment target: Vercel auto-deploy from `main`
- Database/auth: Supabase PostgreSQL with RLS-backed tenant isolation

The GitHub Actions pipeline runs linting, typechecking, builds, and API smoke checks before merge or deployment promotion.

## Use Cases

- **Veterinary clinics:** Real-time diagnostic decision support inside PMS and clinical workflow interfaces.
- **Research labs:** In-silico pharmacological efficacy modeling across structured veterinary cohorts.
- **Pharmaceutical trials:** Faster adverse-event detection through simulated clinical cohorts.
- **Epidemiology teams:** Regional pathogenic outbreak detection through symptom aggregation and population signals.

## Roadmap

- **Autonomous Diagnostic Agents:** Multi-agent diagnostic workflows that can request labs from incomplete probability matrices.
- **Clinical Knowledge Graph:** Species-specific pharmacological interactions, contraindications, and symptom-cluster reasoning.
- **Multimodal Inputs:** Radiographs, ultrasound, documents, and structured telemetry in the same inference graph.
- **Outcome-Confirmed Federated Learning:** Clinic/lab nodes that train locally, submit masked updates, and prove aggregate materialization without raw data export.
- **Reinforcement Learning from Outcomes:** Automated calibration and model-weight updates from clinician-confirmed outcomes.
- **Real-Time Decision Systems:** Sub-100ms edge inference for critical-care routing and escalation support.

## Design Principles

- **Simulation-first:** Synthesize edge cases before they happen in production.
- **Data compounding:** Every inference, outcome, and simulation should improve the next decision.
- **Observability by default:** Uncertainty, latency, telemetry, and safety state are first-class system outputs.
- **Failure-driven testing:** Adversarial stress tests define operational boundaries.
- **Structured over unstructured:** Schema-enforced data is treated as durable clinical infrastructure.

## Contributing

Professional, narrowly scoped contributions are welcome.

Before opening a pull request:

- Keep changes minimal, documented, and aligned with existing package boundaries.
- Use conventional commits such as `feat:`, `fix:`, and `refactor:`.
- Include unit and integration coverage for changes touching inference, outcome evaluation, simulation, or safety logic.
- Run `pnpm lint`, `pnpm typecheck`, and the relevant smoke or adversarial tests.
- Avoid schema or migration changes without documenting rollout and rollback behavior.

## License

VetIOS is intended to be released under the [MIT License](LICENSE).

## Links

- Live demo: [https://www.vetios.tech/demo](https://www.vetios.tech/demo)
- GitHub: [https://github.com/Jaybe-123456/VetIOS](https://github.com/Jaybe-123456/VetIOS)
- License: [MIT](LICENSE)
- Contact: [https://www.vetios.tech/contact](https://www.vetios.tech/contact)
