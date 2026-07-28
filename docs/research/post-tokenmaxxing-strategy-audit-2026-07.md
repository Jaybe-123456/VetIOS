# VetIOS Post-Tokenmaxxing Strategy Audit

Date: 2026-07-28

## Decision

The durable positioning is:

> VetIOS is a veterinary clinical intelligence control plane. It measures the
> value and reliability of model outputs against governed clinical outcomes,
> while keeping the model provider replaceable and preserving local data
> boundaries.

This is stronger and more defensible than "AI veterinarian" or "veterinary
chatbot." It is also narrower than claiming VetIOS is already an operating
global standard or federated network.

## Claim Corrections

| Claim in the supplied brief | Verdict | Evidence-safe replacement |
| --- | --- | --- |
| Only 18% of enterprise AI projects reach production | Incorrectly stated | ModelOp reported that 18% of surveyed Fortune 500 enterprises had more than 20 AI models in production. That is not a project production rate. |
| Enterprise data sent to frontier vendors is used against customers | Overbroad | Data terms vary by product. OpenAI states that business and API data is not used for training by default and provides enterprise retention controls. VetIOS should sell verifiable local-data controls, not imply every provider trains on enterprise data. |
| Anthropic acquired Coefficient Bio, built wet labs, and hired John Jumper | Not verified | Anthropic has launched Claude for Life Sciences and Claude Science with scientific tools and connectors. Do not publish the acquisition, wet-lab, or hiring claims without primary evidence. |
| FDA/USDA are building a veterinary SaMD approval framework | Misleading | FDA says animal devices do not require 510(k), PMA, or other premarket approval, although manufacturers remain responsible for safety, effectiveness, and labeling. Human-device AI guidance should be treated as useful governance precedent, not current veterinary premarket law. |
| No veterinary competitor offers federated learning | Unverified competitive absolute | State only what VetIOS can prove: the repository implements a federation node, secure-aggregation material, coordinator paths, and proof modes. External production deployment remains the defensibility gate. |
| CIRE is already a standard | Premature | CIRE is a published VetIOS specification and conformance implementation. It becomes an external standard only through independent implementations, conformance certificates, governance, and adoption. |
| Every outcome-linked inference is confirmed value | Incorrect metric semantics | Only distinct, non-synthetic inferences with an expert-reviewed or lab-confirmed label count as outcome-confirmed. Inferred-only and simulation rows are excluded. |

## Code Reality

### Built and testable

- Provider abstraction for OpenAI-compatible `/chat/completions` endpoints.
- Append-only inference and clinical outcome events with tenant lineage.
- CIRE scoring, validation, conformance, and operational-proof foundations.
- Clinic/lab federation node code with deterministic local deltas,
  X25519/HKDF masking, Ed25519 signatures, encrypted unmask-share envelopes,
  service mode, and proof bundles.
- AMR stewardship, laboratory-feed, genomics, surveillance, and outcome-network
  foundations.
- One Health ontology ingestion and mapping-review foundations.
- Model registry, routing, simulation, evaluation, and trust controls.

### Built but not yet an operating moat

- Federation has implementation and local proof coverage, but not enough
  independently operated partner nodes and live rounds.
- CIRE has an implementation, but external adoption and independent
  conformance evidence are not established.
- AMR has an operational pilot surface, but its moat depends on a real
  laboratory, multiple clinics, and outcome-closed episodes.
- Global ontology adapters exist, but licensed feeds and reviewer-verified
  mappings must stay visibly distinguished from configured or seeded providers.

### Missing external proof

- Three or more independently operated clinic nodes.
- One operational laboratory feed.
- At least 250 provenance-verified, clinician-reviewed, outcome-closed AMR
  episodes.
- Independent CIRE implementations and conformance results.
- Repeated live multi-node rounds with aggregate reconstruction and measured
  clinical value.
- A validated outcome-based commercial contract.

## Outcome Value Metric v1

The public north-star metric is now defined as:

`distinct non-synthetic inference events with at least one expert_reviewed or lab_confirmed outcome label`

The metric does not count:

- repeated outcome events for the same inference;
- synthetic inference events;
- simulation-linked inference or outcome events;
- inferred-only labels;
- labels without a non-empty confirmed diagnosis.

The aggregate also reports:

- real inference count;
- non-synthetic outcome-linked inference count;
- clinician-reviewed and lab-confirmed coverage;
- calibration-delta coverage;
- synthetic inference paths excluded;
- outcome confirmation rate;
- latest confirmed outcome timestamp.

The database contract is `public.outcome_value_metrics_v1`. The landing evidence
snapshot fails closed to zero with a warning if that migration is not present.

## CIRE Public Claim Gate

Public evidence-grade language now requires all of the following:

1. At least one strict Outcome Value v1 inference.
2. CIRE validation scope is `real_clinical_outcomes`.
3. The cohort contains expert-reviewed or laboratory-confirmed labels only.
4. Synthetic source inferences and simulation-linked rows are excluded.
5. The cohort meets the 200-pair minimum.
6. The observed CIRE signal is actually `validated`.

A large weak or inverse cohort is not evidence grade.

## Build Order

1. Apply the Outcome Value Metrics v1 migration and publish the live strict
   count.
2. Enroll one laboratory and three clinics into the AMR outcome pilot.
3. Run certificate-bound federation nodes at each site and preserve round proof.
4. Close 250 AMR episodes with provenance, AST, treatment, review, and outcome.
5. Publish calibration change and surveillance utility from a preregistered
   evaluation cohort.
6. Invite an external team to implement CIRE and issue independently reviewed
   conformance evidence.
7. Pilot outcome-based pricing only after the unit of value and dispute policy
   are contractually defined.
8. Add provider cost and quality telemetry so model switching can demonstrate
   lower cost per confirmed clinical outcome, not merely fewer tokens.

## Primary Sources

- OpenAI for Healthcare:
  https://openai.com/index/openai-for-healthcare/
- OpenAI enterprise privacy:
  https://openai.com/enterprise-privacy/
- Anthropic Claude Science:
  https://www.anthropic.com/news/claude-science-ai-workbench
- ModelOp production-scale survey statement:
  https://www.modelop.com/blog/ais-time-to-market-quagmire-why-enterprises-struggle-to-scale-ai-innovation
- FDA regulation of animal devices:
  https://www.fda.gov/animal-veterinary/animal-health-literacy/how-fda-regulates-animal-devices
- WHO GLASS:
  https://www.who.int/initiatives/glass
- WOAH One Health AMR surveillance guidance:
  https://www.woah.org/en/document/quadripartite-guidance-on-one-health-integrated-surveillance-of-antimicrobial-resistance-and-use/

The supplied Alex Karp quotation and several competitive-market assertions were
not independently verified from an accessible primary transcript and should not
be used as attributed public copy until they are.
