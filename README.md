# VetIOS

**AI-native veterinary intelligence and autonomy infrastructure.** Computational systems for clinical diagnostics, machine-assisted decision-making, and real-world autonomy research in animal health.

> **Not an app. Not a dashboard. Infrastructure.**

---

## Core Thesis

Clinical intelligence compounds when:

1. **Inference is captured** with context and uncertainty
2. **Decisions are logged**, not just outcomes
3. **Real-world feedback loops** inform models
4. **Rare and adversarial cases** are simulated and studied
5. **Intelligence is aggregated safely** across systems

**VetIOS owns this compounding loop.**

---

## Repository Structure

```
vetios/
├── apps/
│   ├── web/                    # Next.js 15 console (TypeScript)
│   └── ml-training/            # TensorFlow training pipeline (Python)
├── docs/
│   └── tensorflow-autograd-expert-guide.md
├── .env / .env.local           # Environment configuration
└── package.json                # pnpm monorepo root
```

---

## Web Console (`apps/web`)

Next.js 15 + Supabase + Tailwind v4 application. Multi-tenant, RLS-enforced.

### Pages

| Route | Purpose |
|-------|---------|
| `/dashboard` | System overview, telemetry metrics, recent activity |
| `/inference` | Inference Console — structured clinical input → AI reasoning + ML risk assessment |
| `/outcome-learning` | Outcome event submission and feedback loop |
| `/adversarial-sim` | Edge simulation engine — adversarial scenario generation |
| `/clinical-dataset` | Clinical dataset manager — browsing and annotation |
| `/experiment-track` | Experiment tracking — model evaluation comparison |
| `/model-registry` | Model registry — versioned model lifecycle management |
| `/telemetry` | System telemetry — latency, throughput, error rates |
| `/network` | Network intelligence map — cross-system metrics |

### API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/inference` | POST | AI inference with ML risk enrichment |
| `/api/outcome` | POST | Clinical outcome event logging |
| `/api/simulate` | POST | Adversarial simulation execution |
| `/api/ml/predict` | POST/GET | ML risk prediction proxy + health check |
| `/api/ml/shadow-report` | GET | Shadow evaluation + drift + calibration dashboard |

### Quick Start

```bash
cd apps/web
pnpm install
npm run dev          # → http://localhost:3000
```

---

## ML Training Pipeline (`apps/ml-training`)

Production-grade TensorFlow pipeline powered by `tf.GradientTape`. Implements the full 8-week execution roadmap.

### Modules

| Module | Phase | Purpose |
|--------|-------|---------|
| `train.py` | 1 | Baseline `GradientTape` training loop with gradient clipping |
| `evaluate.py` | 1 | AUROC, ECE, Brier score, abstention rate |
| `calibration.py` | 2 | Temperature scaling + isotonic regression |
| `drift.py` | 2 | PSI feature drift + chi-squared label drift |
| `augmented_train.py` | 3 | Simulation-augmented training with safety penalty |
| `shadow_mode.py` | 4 | Shadow evaluation + safety gates + promotion decision |
| `explainability.py` | — | Integrated Gradients feature attribution |
| `retrain.py` | — | Full 6-stage pipeline orchestrator |
| `serve.py` | — | FastAPI inference server (8 endpoints) |

### Quick Start

```bash
cd apps/ml-training
python -m venv .venv && .venv\Scripts\activate    # Windows
pip install -e ".[dev]"

# Individual stages
python -m vetios_ml.train              # Baseline training
python -m vetios_ml.calibration        # Probability calibration
python -m vetios_ml.drift              # Drift detection
python -m vetios_ml.augmented_train    # Simulation-augmented training
python -m vetios_ml.shadow_mode        # Shadow evaluation
python -m vetios_ml.explainability     # Feature attribution

# Full pipeline (all 6 stages)
python -m vetios_ml.retrain

# Inference server
python -m vetios_ml.serve              # → http://localhost:8000
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/predict` | POST | Calibrated risk prediction |
| `/explain` | POST | Gradient-based feature attribution |
| `/health` | GET | Server health + model status |
| `/model` | GET | Model metadata |
| `/calibration` | GET | Calibration curve data |
| `/drift` | GET | Drift detection report |
| `/shadow` | GET | Shadow evaluation report |

### Pipeline Architecture

```
Supabase ──→ Dataset Builder ──→ Train (GradientTape) ──→ Evaluate
                                      │
                Simulation Sampler ──→ Augmented Train (safety penalty)
                                      │
                                 Calibrate ──→ Drift Detection
                                      │
                                Shadow Eval ──→ Safety Gates ──→ Promote?
                                      │
                                Explainability (Integrated Gradients)
                                      │
                                 Serve (FastAPI)
```

---

## Supabase Schema

| Table | Purpose |
|-------|---------|
| `ai_inference_events` | Inference logs with context, uncertainty, and decision traces |
| `clinical_outcome_events` | Real-world clinical feedback and intervention results |
| `edge_simulation_events` | Adversarial scenario results and degradation scores |
| `network_intelligence_metrics` | Cross-system aggregation signals |
| `user_documents` | Document storage and annotations |

All tables enforce **row-level security (RLS)** with tenant isolation.

---

## Production Guardrails

*   **Temporal leakage checks** — no future data in training features
*   **Safety-penalized loss** — penalizes overconfident predictions on clinician overrides
*   **Circuit-breaker client** — Next.js ↔ ML server with timeout + graceful fallback
*   **Shadow-mode evaluation** — model must pass safety gates before promotion
*   **Drift detection** — PSI for feature drift, chi-squared for label drift
*   **Model abstention** — refuses to predict when confidence is below threshold

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS v4 |
| Backend | Supabase (PostgreSQL 17, RLS, Edge Functions) |
| ML Training | TensorFlow 2.20, Python 3.13, `tf.GradientTape` |
| ML Inference | FastAPI, Uvicorn |
| ML Calibration | scipy, scikit-learn |
| Monorepo | pnpm workspaces |
| Deployment | Vercel (web), dedicated runtime (ML) |

---

## Environment Setup

Copy `.env.example` to `.env.local` and configure:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AI_PROVIDER_API_KEY=your-openai-key
```

For the ML pipeline, create `apps/ml-training/.env`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## Documentation

- [TensorFlow Autograd Expert Guide](docs/tensorflow-autograd-expert-guide.md) — full execution roadmap

---

## Guiding Principles

*   **Append-only intelligence logs**
*   **Safety and isolation by default**
*   **Infrastructure before UI**
*   **Systems thinking over feature velocity**
*   **Research-grade architecture from day one**

---

## Vision

Veterinary medicine evolves from:

`manual` → `software-assisted` → `intelligence-mediated`

**VetIOS is being built for the final stage.**

> **Not as a product. As the system beneath it.**
