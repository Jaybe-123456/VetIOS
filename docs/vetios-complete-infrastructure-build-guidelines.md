# VetIOS Complete Infrastructure Build Guidelines

Status: foundational operating guide
Audience: engineering, clinical, regulatory, data, security, and partner operations
Last reviewed: 2026-07-06

VetIOS should not be built or described as another veterinary diagnostic interface. The defensible wedge is the infrastructure layer below the interface: outcome-confirmed, provenance-verified, species-aware, One Health clinical intelligence that other applications, partners, clinics, labs, and regulators can trust.

This document defines what "complete" means for that infrastructure. It is intentionally stricter than a feature roadmap. A moat is not complete when a screen exists, a migration exists, or a model can produce an answer. A moat is complete only when it has live data, auditability, review gates, failure handling, measurable coverage, and evidence that the system improves without leaking raw clinical data or overstating unverified knowledge.

## Non-Negotiable Principles

1. VetIOS is clinical decision-support infrastructure, not autonomous medical authority.
2. Synthetic data can train interfaces and benchmark harnesses, but must never count as outcome-confirmed evidence, federation eligibility, moat-completion proof, or clinical calibration ground truth.
3. Every high-confidence output needs lineage: input quality, source provenance, ontology coverage, model/version identity, CIRE reliability, actionability gate, and outcome hooks.
4. A condition, treatment, code mapping, or One Health edge is not active clinical knowledge until its source, version, confidence, and review state are known.
5. Raw clinical records, owner identifiers, raw model deltas, and protected partner data stay local unless an explicit approved export contract exists.
6. Every moat needs three layers: append-only evidence ledger, runtime behavior, and operator/reviewer workflow.
7. "Fully populated" is a release claim, not an aspiration. It requires source release hashes, ingest job records, mapping coverage, external code alignment, review state, and gap reporting.

## Completion Levels

Use these levels for every VetIOS moat.

| Level | Meaning | Claim allowed |
| --- | --- | --- |
| L0 Concept | Notes, strategy, mock UI, or schema sketch. | "Planned." |
| L1 Foundation | Tables, types, service boundaries, tests, and doc contract exist. | "Foundation built." |
| L2 Operating | Runtime writes real events; UI/API exposes state; failure modes are handled. | "Operational in controlled environment." |
| L3 Validated | Real users/partners generate evidence; reviewers validate samples; metrics are tracked. | "Validated workflow." |
| L4 Defensible | Live counts, source diversity, external review, longitudinal outcomes, and switching costs accumulate. | "Moat operating." |
| L5 Standard-Setting | External parties integrate, certify, or depend on the contract. | "Infrastructure standard." |

No moat should be called complete below L4.

## Source-Backed Standards Frame

VetIOS should align its infrastructure contracts with the following public standards and guidance families:

- FDA Good Machine Learning Practice for medical-device development: https://www.fda.gov/medical-devices/software-medical-device-samd/good-machine-learning-practice-medical-device-development-guiding-principles
- FDA AI/ML Predetermined Change Control Plan guidance: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/marketing-submission-recommendations-predetermined-change-control-plan-artificial
- WHO ethics and governance of AI for health: https://www.who.int/publications/i/item/9789240029200
- WHO ethics and governance of large multi-modal models: https://www.who.int/publications/i/item/9789240084759
- CONSORT-AI and SPIRIT-AI reporting extensions: https://www.consort-spirit.org/
- DECIDE-AI early-stage clinical AI reporting: https://www.nature.com/articles/s41591-022-01772-9
- MI-CLAIM medical AI checklist: https://www.nature.com/articles/s41591-020-1041-y
- WHO GLASS AMR surveillance: https://www.who.int/initiatives/glass
- WOAH AMR and One Health resources: https://www.woah.org/en/what-we-do/global-initiatives/antimicrobial-resistance/
- WOAH WAHIS animal disease information: https://wahis.woah.org/
- MONDO Disease Ontology: https://mondo.monarchinitiative.org/
- Human Phenotype Ontology: https://hpo.jax.org/
- UMLS Metathesaurus: https://www.nlm.nih.gov/research/umls/
- ICD-11 API: https://icd.who.int/icdapi
- SNOMED CT: https://www.snomed.org/
- VeNom veterinary terminology: https://venomcoding.org/
- PubMed and PMC literature sources: https://pubmed.ncbi.nlm.nih.gov/ and https://pmc.ncbi.nlm.nih.gov/
- VetCompass epidemiology program: https://www.rvc.ac.uk/vetcompass

These sources do not make VetIOS clinically complete by citation alone. They define the minimum shape of evidence, governance, reporting, surveillance, and post-deployment monitoring the infrastructure must support.

## Complete Infrastructure Architecture

### 1. Evidence Intake And Provenance Spine

Purpose: turn every clinical, lab, imaging, workflow, and partner signal into traceable evidence.

Complete means:

- PIMS, lab, PACS, referral, and owner follow-up inputs are ingested through typed connectors.
- Every record has tenant, source system, source release/version, observed time, import time, de-identification state, consent scope, hash digest, and provenance confidence.
- Evidence is append-only; corrections are new events, not destructive edits.
- Raw payload retention is explicitly controlled by contract and jurisdiction.
- The UI shows source trust, missing provenance, and whether a record can enter learning.

Core artifacts:

- Source connector registry.
- Append-only ingestion events.
- Provenance hash bundles.
- Consent and de-identification status.
- Source gap dashboard.

Do not call complete until:

- At least one real clinic/lab/PACS connector runs in production.
- Replayed imports are idempotent.
- Synthetic/demo imports are visibly excluded from learning and moat counts.
- A reviewer can inspect source lineage without database access.

### 2. Global One Health Ontology Spine

Purpose: make VetIOS reason across animal, human, pathogen, environment, drug, syndrome, geography, and public-health concepts without hardcoding a tiny disease list.

Complete means:

- Official releases are ingested from WOAH/WAHIS, WHO, CDC, PubMed/PMC, MONDO, HPO, UMLS, ICD-11, SNOMED CT, VeNom, and veterinary-specific taxonomies where licenses allow.
- Each node stores source URI, source version, release date, license state, external code, species scope, clinical scope, and verification state.
- One Health edges connect animal disease, human disease, pathogen, vector, reservoir, environment, AMR phenotype, drug class, geography, and surveillance source.
- Candidate expansion uses verified ontology nodes and reports unsupported gaps instead of forcing every case into a patched condition list.
- Coverage snapshots are persisted during inference and shown in the UI.
- External mapping review is tracked before unverified mappings influence active scoring.

Core artifacts:

- `global_biomedical_ontology_*` event tables.
- Official ingestion jobs with source hashes.
- Mapping review queue.
- Coverage snapshot service.
- Open-world candidate expansion service.
- UI panel for coverage, gaps, and unverified mappings.

Do not call complete until:

- Real official releases have been ingested and materialized.
- WOAH, ICD, SNOMED CT, UMLS, MONDO, and VeNom mappings have review states.
- Candidate expansion demonstrably proposes conditions outside the static registry.
- Inference persists coverage/gap snapshots for every run.
- Reviewers can approve, reject, or quarantine mappings.

### 3. Species-Gated Multisystem Inference Console

Purpose: collect clinically meaningful signals for many species without pretending dogs, cats, cattle, horses, birds, reptiles, and exotics share the same panels, priors, reference ranges, or disease space.

Complete means:

- Species selection changes available panels, normal ranges, likely diseases, toxicology, production context, husbandry context, and public-health routing.
- Panels are species-scoped: canine/feline small animal, equine, bovine, small ruminant, avian, reptile, wildlife/exotic, and herd/flock modes.
- Multisystem input supports vitals, CBC/chemistry, endocrine, urinalysis, serology, PCR, AST/culture, imaging, cytology, pathology, exposure, geography, production class, medication, vaccination, and timeline.
- Missing required values produce specific clinical gaps, not generic errors.
- Inference outputs show evidence for, against, missing, contradictions, confidence interval, CIRE reliability, actionability gate, and outcome hooks.

Core artifacts:

- Species panel registry.
- Species reference range registry.
- Input quality evaluator.
- Inference candidate expander.
- Clinical gap explanation.
- Mobile-accessible input design.

Do not call complete until:

- Each supported species has distinct panels and reference semantics.
- Bovine/equine/avian/reptile cases no longer default to canine/feline assumptions.
- The console can ingest partial real-world records and ask for the next best missing evidence.
- Mobile command input remains visible and usable across iOS Safari, Chrome Android, Samsung Internet, and small-height browsers.

### 4. CIRE Reliability And Actionability Layer

Purpose: separate "the model answered" from "the answer is reliable enough to route, review, hold, or act on."

Complete means:

- Every inference receives `phi_hat`, confidence bucket, input impairment, evidence density, contradiction burden, top-two margin, entropy, calibration state, and volatility/drift state.
- Actionability gate decides suppress, hold, review, or action-ready.
- Label-specific calibration requires confirmed outcomes.
- CIRE packets and gate decisions are append-only and replayable.
- Public CIRE standard and conformance registry stay versioned.

Core artifacts:

- CIRE engine package.
- Reliability packets.
- Gate decision events.
- Replay drift checker.
- Conformance certificate events.
- Reviewer queue.

Do not call complete until:

- Confidence cannot be displayed without CIRE context.
- Uncalibrated labels are visibly marked.
- Gate decisions are persisted and can be audited.
- Review queue tables exist and schema cache repair is validated.
- External implementations can run the conformance suite.

### 5. Retrieval Corpus And Citation Quality

Purpose: ground explanations in licensed, open, versioned, veterinary and One Health sources.

Complete means:

- Corpus ingestion handles veterinary textbooks where licensed, open guidelines, drug references, toxicology data, lab ranges, PubMed/PMC, WOAH/WHO/CDC resources, and local clinical policies.
- Every passage has source version, license state, species scope, date, citation metadata, and retrieval quality score.
- Citation quality tests check unsupported claims, stale source use, species mismatch, citation overreach, and prompt-injection contamination.
- Toxicology, drug, lab range, pathogen, AMR, and public-health indexes are separated and versioned.

Core artifacts:

- Source catalog.
- Document ingestion jobs.
- Chunk/passsage events.
- Citation evaluation harness.
- Retrieval red-team tests.
- Corpus coverage dashboard.

Do not call complete until:

- Real sources are ingested and versioned.
- Licensed and open sources are separated by permissions.
- Citation evals run on a schedule.
- Retrieval failures affect the actionability gate.

### 6. Outcome Learning And Calibration

Purpose: convert clinical use into verified learning instead of raw interaction volume.

Complete means:

- Outcomes can attach confirmed diagnosis, diagnostics performed, treatment, adverse events, response window, follow-up, clinician override, and case closure.
- Outcome records are linked to inference lineage, CIRE packet, treatment pathway, and source evidence.
- Calibration updates only from reviewer-eligible, non-synthetic, outcome-confirmed cases.
- Near-misses and overrides become safety signals.

Core artifacts:

- Outcome event ledgers.
- Label calibration store.
- Clinical memory update policy.
- Outcome review queue.
- Data eligibility gates.

Do not call complete until:

- Label calibration uses live confirmed outcomes.
- Outcome submission errors are eliminated in the clinical workspace.
- Synthetic cases are blocked from all outcome-confirmed counts.
- Clinician review is visible before outcome-derived learning.

### 7. Federated Learning And Partner Nodes

Purpose: let clinics, labs, universities, and public-health partners contribute learning without centralizing raw records.

Complete means:

- Clinic/lab node agent runs in service mode with installer, enrollment, key lifecycle, heartbeats, persistent logs, retries, task pull, local dataset builder, local training/evaluation, masked update submission, and audit packet generation.
- Secure aggregation uses real key exchange, pairwise masks, encrypted shares, dropout tolerance, unmask shares, aggregate materialization, and coordinator verification.
- Rounds require outcome-confirmed, consented, provenance-verified, trust-scored eligibility snapshots.
- Promotion requires benchmark, safety, calibration, and rollback evidence.

Core artifacts:

- Partner node SDK/CLI/service.
- Federation node runtime events.
- Round task ledger.
- Update submissions.
- Secure aggregation protocol materialization.
- Model evaluation and promotion gates.
- Rollout monitoring.

Do not call complete until:

- At least three live nodes complete a round.
- Raw records and raw deltas demonstrably stay local.
- Coordinator materializes aggregate updates from masked vectors and unmask shares.
- Dropout recovery is tested.
- A model candidate is promoted or rejected through the governance gate.

### 8. Federated Benchmark And Regression Evidence

Purpose: prevent model promotion from becoming a dashboard button.

Complete means:

- Benchmark cohorts are source-labeled: synthetic, internal retrospective, external reviewed, live outcome-confirmed.
- Evaluation includes calibration, false negatives, hallucination, citation grounding, species mismatch, AMR decision quality, treatment contraindication detection, adversarial prompts, and distribution drift.
- Reports are generated automatically for every candidate and attached to promotion gates.

Core artifacts:

- Benchmark adapter.
- Synthetic firewall.
- Regression report generator.
- Adversarial suite.
- Candidate evaluation packets.

Do not call complete until:

- Synthetic rows are blocked from outcome/federation/moat counts.
- Reports are generated from real candidate artifacts.
- Promotion gates fail closed when reports are missing or stale.

### 9. Workflow Integrations

Purpose: make VetIOS part of actual clinic operations, not a separate demo console.

Complete means:

- PIMS, lab, PACS, appointment/history, billing context, referral, and follow-up systems synchronize through connector contracts.
- Integration runs are observable with latency, failures, retries, data quality, and source coverage.
- Follow-up automation closes the outcome loop without burdening clinicians.

Core artifacts:

- Connector adapters.
- Integration run events.
- Data mapping review.
- Follow-up queue.
- Error replay tooling.

Do not call complete until:

- At least one real external workflow source writes production events.
- Failed syncs are retryable and visible.
- Imported records can flow into inference, outcome, and provenance gates.

### 10. Specialist Review Operations

Purpose: turn expert review into operational evidence and clinical trust, not a loose manual process.

Complete means:

- Reviewer assignment, queue priority, turnaround, case packet, report upload, PACS handling, closure, disagreement, and outcome linkage are managed in product.
- Specialist reviews can validate or weaken inference claims and calibration.

Core artifacts:

- Review queue.
- Reviewer assignment workflow.
- Specialist report events.
- Case packet generator.
- Outcome-linked closure.

Do not call complete until:

- A reviewer can complete the full loop without database access.
- Review outcomes affect calibration and trust.
- Turnaround and disagreement metrics are visible.

### 11. AMR And One Health Surveillance

Purpose: build the scarce AMR intelligence layer from clinical outcomes, AST/culture, species, geography, drug exposure, and public-health signals.

Complete means:

- AST/culture imports normalize pathogen, specimen, drug, MIC/zone, interpretation, method, lab, date, geography, species, and outcome.
- Taxonomies for pathogen, drug class, resistance mechanism, host, and source are versioned.
- Trend dashboards show signal quality, coverage, resistance shifts, and export readiness.
- One Health export packages can be generated for partners, labs, public health, and research.

Core artifacts:

- Lab feed ingestion.
- Pathogen/drug normalization.
- AMR event ledger.
- Trend and alert service.
- One Health export package.

Do not call complete until:

- Real AST/culture feeds are ingested.
- Normalization review exists.
- Export packages include source/version/provenance metadata.
- AMR signals are tied to outcomes and geography where permitted.

### 12. AI Security And Postmarket Monitoring

Purpose: make safety and abuse resistance continuous, not a one-time penetration test.

Complete means:

- Prompt-injection, RAG poisoning, tool abuse, data exfiltration, jailbreak, species-mismatch, unsafe treatment, and citation attacks run continuously.
- Incidents have severity, owner, mitigation, replay, and closure.
- Sessions can be invalidated after password changes and sensitive account events.
- API load, caching behavior, rate limits, geolocation risk, and anomaly signals are measured.

Core artifacts:

- Security test events.
- Incident workflow.
- Abuse simulation harness.
- Session revocation controls.
- Load and cache test reports.
- Risk-scored request telemetry.

Do not call complete until:

- Security tests run on a schedule.
- Incidents can be triaged and closed.
- Password change invalidates other sessions.
- Load tests prove acceptable p95/p99 behavior.
- Caching repeated requests does not bypass authorization or stale clinical gates.

### 13. Regulatory Claims And Governance

Purpose: keep product claims aligned with evidence and clinical/regulatory review.

Complete means:

- Claims are reviewed before publication or UI exposure.
- Evidence packs include intended use, limitations, model card, IFU-style notes, data provenance, validation results, calibration state, and postmarket monitoring.
- Legal, clinical, and model-risk approvals are append-only.
- Unsupported claims are blocked.

Core artifacts:

- Claim review queue.
- CDS reviewability packet.
- Model card generator.
- IFU/evidence pack generator.
- Approval event ledger.

Do not call complete until:

- Claims can be approved/rejected in product.
- Evidence packs are generated from live system state.
- Unsupported claims cannot ship silently.

### 14. Control Plane And Operations Dashboard

Purpose: expose whether the infrastructure is healthy, learning, stuck, drifting, or unsafe.

Complete means:

- Dashboard shows database health, inference health, CIRE state, pipeline state, routing fabric, model governance, live streams, alerts, active decisions, recent events, and failure root cause.
- Empty states distinguish "no data yet" from "stream disconnected" from "permission missing" from "pipeline failed."
- Operators can start/stop streams, refresh snapshots, inspect logs, and follow next actions.

Core artifacts:

- System snapshot API.
- Live stream health.
- Pipeline health events.
- Routing fabric events.
- Alert event ledger.
- Operator action log.

Do not call complete until:

- Dashboard has real data sources for each panel.
- Stream disconnections explain root cause.
- Operators can navigate directly to the best next feature after login.
- SLOs and failure budgets exist.

## Build Order

The correct build order for each moat is:

1. Evidence contract: define data types, event ledger, source hashes, and privacy boundary.
2. Runtime path: make the system actually create events from real or controlled inputs.
3. Review gate: add human or automated approval, rejection, quarantine, and escalation.
4. UI/API exposure: show status, gaps, and next actions to operators and clinicians.
5. Tests: unit, integration, replay, security, load, and adversarial checks.
6. Metrics: live counts, coverage, latency, error rate, calibration, drift, and rollback signals.
7. External validation: source review, partner use, or third-party evidence where applicable.

Do not build a polished UI before the evidence contract exists. Do not tune models before the data firewall exists. Do not claim a moat before live counts accumulate.

## Immediate Build Priorities

1. Global ontology completion path:
   - Ingest real official releases.
   - Add external mapping review workflow.
   - Show coverage/gaps in inference UI.
   - Let candidate expansion query materialized ontology nodes beyond the static registry.

2. Species-gated inference console:
   - Replace shared panels with species-specific diagnostic panels and reference semantics.
   - Add bovine/equine/avian/reptile production and husbandry context.
   - Make next-best-missing-evidence prompts species aware.

3. Outcome and review completion:
   - Repair outcome submission errors.
   - Ensure review queue is present in Supabase schema cache.
   - Make confirmed outcomes the only calibration source.

4. Partner node secure aggregation:
   - Move from commitment simulation to real pairwise masking, unmask shares, dropout recovery, and aggregate materialization.
   - Add service-mode clinic/lab agent deployment.

5. Retrieval corpus:
   - Ingest real source releases.
   - Add citation quality scoring and red-team tests.
   - Separate veterinary, toxicology, lab range, AMR, and public-health indexes.

6. Control plane:
   - Replace "NO DATA" panels with source-aware empty states.
   - Route users after login to the highest-leverage operational feature for their role.
   - Add live stream diagnostics and snapshot repair actions.

## Infrastructure Definition Of Done

A VetIOS infrastructure build is done only when all of the following are true:

- It has append-only event evidence.
- It runs in the product/API, not only tests.
- It distinguishes synthetic, demo, retrospective, reviewed, and live outcome-confirmed data.
- It has failure handling and operator visibility.
- It has tenant, source, version, privacy, and review metadata.
- It has tests that prove both happy path and blocked path.
- It reports coverage and gaps honestly.
- It cannot silently promote unverified knowledge into active clinical scoring.
- It has a clear next event that turns user action into compounding evidence.

This is the standard VetIOS should use before calling any moat complete.
