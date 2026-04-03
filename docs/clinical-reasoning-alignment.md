# VetIOS Clinical Reasoning Alignment

## 1. System Alignment Map

VetIOS should operate as one closed-loop reasoning engine:

- `Inference Engine`
  - [`apps/web/lib/ai/inferenceOrchestrator.ts`](../apps/web/lib/ai/inferenceOrchestrator.ts)
- `Signal Processing Layer`
  - [`apps/web/lib/clinicalSignal/signalWeightEngine.ts`](../apps/web/lib/clinicalSignal/signalWeightEngine.ts)
- `Disease Ontology`
  - [`apps/web/lib/ai/diseaseOntology.ts`](../apps/web/lib/ai/diseaseOntology.ts)
- `Adversarial Simulation Engine`
  - [`apps/web/lib/learningEngine/adversarialEvalRunner.ts`](../apps/web/lib/learningEngine/adversarialEvalRunner.ts)
- `Telemetry Observer`
  - [`apps/web/lib/telemetry/service.ts`](../apps/web/lib/telemetry/service.ts)
  - [`apps/web/lib/telemetry/observability.ts`](../apps/web/lib/telemetry/observability.ts)
- `Outcome Learning System`
  - [`apps/web/app/api/outcome/route.ts`](../apps/web/app/api/outcome/route.ts)
  - [`apps/web/lib/learning/reinforcementRouter.ts`](../apps/web/lib/learning/reinforcementRouter.ts)
  - [`apps/web/lib/learningEngine/engine.ts`](../apps/web/lib/learningEngine/engine.ts)
- `Treatment Intelligence Layer`
  - [`apps/web/lib/treatmentIntelligence/service.ts`](../apps/web/lib/treatmentIntelligence/service.ts)
  - [`apps/web/lib/treatmentIntelligence/engine.ts`](../apps/web/lib/treatmentIntelligence/engine.ts)
- `Cross-Layer Alignment Contract`
  - [`apps/web/lib/intelligence/clinicalAlignment.ts`](../apps/web/lib/intelligence/clinicalAlignment.ts)

Primary flow:

1. Inference normalizes input, weights signals, runs the provider, applies diagnostic safety, and emits a `reasoning_alignment` snapshot.
2. Telemetry receives the same alignment state and can classify failures as ontology, weighting, contradiction, or abstention problems.
3. Outcome learning converts real outcomes into evaluation events, failure correction reports, alignment enforcement rules, and reinforcement features.
4. Learning cycles use outcome-linked cases, calibration rows, and adversarial rows to retrain and govern promotion.
5. Treatment recommendations consume ontology-backed diagnoses and treatment performance summaries.
6. Treatment outcomes now emit structured reasoning feedback so diagnostic confidence can eventually be reweighted by treatment success or failure.

## 2. Global Disease Ontology Enforcement

VetIOS now enforces a required domain review across:

- nutritional
- infectious
- endocrine
- neurologic
- toxic
- metabolic
- parasitic

This domain layer is enforced in [`apps/web/lib/intelligence/clinicalAlignment.ts`](../apps/web/lib/intelligence/clinicalAlignment.ts), which sits above the existing disease ontology and checks:

- whether the top differential remains inside the canonical ontology
- which required domains have trigger evidence
- which domains are covered by ontology candidates and model candidates
- which domains are active blind spots

Closed-world enforcement rules:

- Non-canonical differentials are treated as hallucination risk.
- Strong domain evidence without candidate support is treated as `missing_disease_category`.
- Nutritional evidence is explicitly surfaced instead of silently collapsing into endocrine or metabolic fallbacks.

## 3. Signal Prioritization Standardization

Signal prioritization is standardized through:

- the signal weight profile in [`apps/web/lib/clinicalSignal/signalWeightEngine.ts`](../apps/web/lib/clinicalSignal/signalWeightEngine.ts)
- anchor lock logic and closed-world scoring in [`apps/web/lib/ai/diseaseOntology.ts`](../apps/web/lib/ai/diseaseOntology.ts)
- the alignment snapshot in [`apps/web/lib/intelligence/clinicalAlignment.ts`](../apps/web/lib/intelligence/clinicalAlignment.ts)

System rules:

- Anchor and red-flag signals dominate generic signals.
- Generic fallback is flagged when generic signals outnumber anchor plus contextual signals.
- Domain-specific triggers such as neurologic, toxicologic, parasitic, endocrine, and metabolic lab clusters are evaluated consistently across inference and correction.
- Nutritional evidence is now a first-class domain check even where disease coverage still needs expansion.

## 4. Inference ↔ Adversarial Feedback Loop

The adversarial loop is now expected to produce explicit failure classes, not just pass/fail metrics.

Current aligned flow:

1. Adversarial evaluation identifies degradation, contradiction misses, false reassurance, and emergency preservation failures.
2. Outcome learning generates a failure correction report and a clinical alignment enforcement plan.
3. Reinforcement features include both failure-correction features and alignment features.
4. The next learning cycle can use those features for retraining, recalibration, and promotion blocking.

Failure classes now supported by the alignment layer:

- `signal_loss`
- `category_misclassification`
- `generic_fallback`
- `missing_disease_category`
- `contradiction_mismatch`
- `hallucination_pattern`
- `treatment_outcome_divergence`

## 5. Telemetry Enforcement Engine

Telemetry is no longer only a passive observer. It now consumes reasoning alignment state and classifies failures with stronger semantics.

Upgraded behaviors in [`apps/web/lib/telemetry/observability.ts`](../apps/web/lib/telemetry/observability.ts):

- `ontology_violation`
  - triggered by hallucination risk or required-domain blind spots
- `feature_weighting_error`
  - triggered by generic fallback bias or contradiction mismatch risk
- `abstention`
  - preserved as its own class

Inference telemetry also now emits:

- `reasoning_missing_domains`
- `reasoning_generic_fallback_bias`
- `reasoning_hallucination_risk`

That gives the control plane something enforceable to watch before full outcome maturity arrives.

## 6. Outcome-Driven Recalibration

Outcome learning already created evaluation, calibration, and reinforcement records. The alignment layer now makes those corrections domain-aware.

Outcome loop changes:

- outcome-linked failures now generate a structured alignment enforcement plan
- reinforcement features now include:
  - generic fallback indicators
  - category misclassification indicators
  - missing-domain indicators
  - contradiction mismatch indicators
  - retraining flags

Immediate recalibration policy:

- if nutritional or other required-domain blind spots recur, ontology refinement is required
- if contradiction pressure stays high while confidence stays high, confidence calibration must tighten
- if top-3 contains the right answer but top-1 is wrong, treat it as weighting failure before model-family replacement

## 7. Treatment Intelligence Integration

Treatment intelligence is now tied back into reasoning by structured treatment outcome feedback.

In [`apps/web/lib/treatmentIntelligence/service.ts`](../apps/web/lib/treatmentIntelligence/service.ts):

- treatment outcomes persist `reasoning_feedback` inside `outcome_json`
- feedback classifies the treatment course as:
  - `supports_diagnosis`
  - `requires_reassessment`
  - `inconclusive`

This establishes the loop:

`Diagnosis -> Treatment Pathway -> Treatment Outcome -> Reasoning Feedback -> Future Reweighting`

Current limitation:

- treatment feedback is now structured and stored, but it still needs to be pulled directly into the learning dataset builder for full closed-loop reweighting.

## 8. Failure Correction Pipeline

Standard pipeline:

1. Failure detected
2. Telemetry event emitted
3. Outcome evaluation created
4. Failure correction report generated
5. Alignment enforcement plan generated
6. Reinforcement features written
7. Calibration and learning cycle consume the signal
8. Promotion is corrected or blocked

Concrete correction actions now encoded:

- `adjust_weights`
- `add_anchor`
- `refine_ontology`
- `recalibrate_confidence`
- `trigger_retraining`
- `connect_treatment_outcomes`

## 9. Implementation Roadmap

Immediate phase:

1. Keep the new alignment contract live in inference, outcome, telemetry, and treatment.
2. Expand curated ontology entries for nutritional diseases rather than only detecting nutritional blind spots.
3. Feed treatment outcome feedback directly into dataset building and calibration updates.
4. Add promotion blockers when repeated required-domain blind spots recur.

Next engineering phase:

1. Add explicit nutritional disease entities and anchors to the closed-world ontology.
2. Convert alignment enforcement plans into first-class persisted records for audit and governance.
3. Make adversarial simulations emit correction suggestions directly into the learning scheduler.
4. Add cross-module validation tests for domain coverage and generic-fallback suppression.

## 10. Validation Framework

The aligned system should be treated as failed if any of these occur:

- missing disease category support under strong evidence
- generic fallback dominance over anchor signals
- non-canonical differential hallucinations
- contradiction pressure with inappropriately high confidence
- adverse treatment outcomes that do not trigger diagnostic reassessment

Minimum validation matrix:

- nutritional vs endocrine
- neurologic adversarial contradictions
- toxicity vs infection
- GDV emergency preservation
- treatment failure with high-confidence initial diagnosis

Expected behavior:

- nutritional evidence is surfaced and tracked even if ontology expansion is still in progress
- neurologic and toxicologic anchors remain stable under noise
- telemetry classifies failures into ontology vs weighting vs abstention lanes
- treatment failure feeds review rather than being isolated in a separate module
