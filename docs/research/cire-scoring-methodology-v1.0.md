# CIRE Scoring Methodology v1.0

**Version:** 1.0.0  
**Date:** July 2, 2026  
**Status:** Open specification draft and VetIOS reference implementation  
**Reference implementation:** `@vetios/cire-engine`  
**Machine-readable contract:** `/api/public/cire-standard`

## Abstract

The Clinical Inference Reliability Engine (CIRE) is a distribution-first reliability standard for veterinary clinical AI. CIRE measures whether an inference output remains structured, reviewable, and safe to display before ground-truth outcome labels are available. It defines `phi_hat`, `input_m_hat`, rolling drift, volatility, the Collapse Proximity Score (CPS), safety states, and the minimum event lineage required to connect inference, review, outcome confirmation, and calibration.

CIRE is designed as an open specification. VetIOS keeps the specification public while capturing value in the hard-to-replicate layer above it: managed clinic infrastructure, outcome-confirmed data pipelines, regulatory evidence packets, AMR surveillance feeds, and the proprietary corpus of clinician-reviewed outcomes generated through live use.

## 1. Strategic Positioning

The strategic analogy is NVIDIA CUDA, with one correction for accuracy: CUDA is not a neutral standards-body standard. It is a widely published NVIDIA developer platform, documentation set, programming model, toolkit, and library ecosystem. NVIDIA describes CUDA as the platform and software layer that lets applications use GPUs for accelerated computing. The lesson for VetIOS is not "copy CUDA literally"; it is "make the validation language ubiquitous, then own the infrastructure that runs it at production quality."

CIRE follows that pattern:

1. Publish the scoring method, runtime fields, compatibility requirements, and reference implementation.
2. Let researchers, clinics, AMR labs, diagnostics companies, and regulators cite or implement the specification.
3. Use compatibility pressure to create demand for managed CIRE workflows.
4. Capture value in the non-commodity layer: live outcome capture, model governance, federated learning, AMR evidence, audit-grade APIs, and outcome-confirmed data.

The open layer is the scoring language. The scarce layer is the longitudinal clinical evidence graph.

## 2. Scope and Non-Claims

CIRE is not a diagnosis, treatment recommendation, or substitute for licensed veterinary judgment. CIRE is a reliability, safety, and lineage contract for clinical decision-support outputs.

CIRE does not by itself prove a model is clinically effective. Clinical effectiveness requires outcome-linked evaluation, external validation, and human factors review. CIRE provides a runtime and audit framework that can support those studies.

CIRE is intended to complement, not replace:

- Good Machine Learning Practice lifecycle controls.
- Predetermined change-control planning for iterative AI systems.
- Clinical AI reporting guidelines such as CONSORT-AI, SPIRIT-AI, and DECIDE-AI.
- Public-health surveillance frameworks such as WHO GLASS for AMR.

## 3. Core Runtime Signals

### 3.1 Differential Vector

Let `D = [p1, p2, ..., pn]` be the finite differential probability vector returned by a clinical inference system. Values are sanitized to non-negative numbers and normalized to sum to 1. Zeros contribute no entropy term.

### 3.2 phi_hat

`phi_hat` is an output-richness statistic derived from Shannon entropy:

```text
H(D) = -sum(p_i * ln(p_i))
phi_hat = 1 - H(D) / ln(|D|)
```

Interpretation:

- `phi_hat` near 1 means probability mass is concentrated in a small number of differentials.
- `phi_hat` near 0 means the distribution is flat, diffuse, or collapsed into non-actionable uncertainty.
- `phi_hat` is not "truth"; it is a runtime structure signal that must be paired with evidence, calibration, and outcomes.

The VetIOS reference implementation is `computePhiHat(differentialVector)` in `packages/cire-engine/src/index.ts`.

### 3.3 input_m_hat

`input_m_hat` estimates input impairment from missingness, contradictions, and out-of-distribution structure:

```text
input_m_hat = 0.40 * missingness
            + 0.35 * contradiction_rate
            + 0.25 * out_of_distribution_rate
```

Examples of impairment:

- Missing species, breed, urgency, region, or symptom structure.
- Contradictory species/breed pairs.
- Implausible age, weight, vitals, or biomarkers.
- Unknown species or unsupported operating geography.

The VetIOS reference implementation is `computeInputMHat(inputPayload)`.

### 3.4 Rolling State

CIRE keeps rolling state per model, tenant, and capability where available:

```text
delta_hat = phi_hat_t - phi_hat_(t-1)
phi_ema = EMA(phi_hat, alpha = 0.1)
delta_rolling = EMA(delta_hat, alpha = 0.1)
sigma_delta = standard_deviation(last 50 delta_hat values)
```

These values detect degradation that a single confident-looking inference cannot reveal.

### 3.5 Collapse Proximity Score

CPS combines current richness loss, negative drift, and volatility:

```text
CPS = 0.40 * (1 - phi_hat / phi0)
    + 0.35 * max(0, -delta_rolling) / phi0
    + 0.25 * sigma_delta / phi0
```

`phi0` is the model's baseline reliability floor for the capability being monitored. Implementations must clamp `phi0` above zero; VetIOS uses `0.0001` as a minimum.

## 4. Safety States

| CPS range | Safety state | Reliability badge | Runtime action |
| --- | --- | --- | --- |
| `< 0.25` | `nominal` | `HIGH` | Display with ordinary clinical decision-support language. |
| `0.25 - <0.50` | `warning` | `REVIEW` | Surface uncertainty and require clinician review. |
| `0.50 - <0.75` | `critical` | `CAUTION` | Avoid workflow automation and highlight instability. |
| `>= 0.75` | `blocked` | `SUPPRESSED` | Suppress the clinical answer and require better input or human review. |

In clinical settings, suppression is a successful safety behavior, not a product failure.

## 5. Outcome-Linked Calibration

CIRE separates inference-time reliability from outcome-confirmed calibration.

At inference time, CIRE can score distribution structure without knowing the final diagnosis. After a case closes, the confirmed outcome updates diagnosis-specific calibration tuples:

```text
tuple_key = species::breed_or_any::diagnosis
accuracy_rate = correct_cases / total_cases
calibration_error = abs(accuracy_rate - avg_model_confidence)
```

VetIOS uses Wilson score intervals for sparse outcome counts:

```text
p = successes / total
denominator = 1 + z^2 / total
centre = (p + z^2 / (2 * total)) / denominator
margin = z * sqrt((p * (1 - p) / total) + z^2 / (4 * total^2)) / denominator
CI = [centre - margin, centre + margin]
```

The default significance threshold is `n >= 30` confirmed outcomes for a tuple. Below that threshold, the system must disclose insufficient historical density.

## 6. Minimum CIRE-Compatible Event Lineage

A CIRE-compatible clinical inference event should persist:

- `tenant_id`
- `request_id`
- `model_name`
- `model_version`
- `input_signature`
- differential probabilities
- `phi_hat`
- `input_m_hat`
- `cps`
- `safety_state`
- `reliability_badge`
- `created_at`

Outcome-linked CIRE requires:

- `inference_event_id`
- confirmed diagnosis or outcome class
- confirmation method
- clinician review metadata
- treatment or follow-up result when available
- learning consent scope
- de-identification status

## 7. Reference Implementation Surfaces

VetIOS exposes CIRE through:

- `@vetios/cire-engine` for shared numerics.
- `/api/public/cire-standard` for the machine-readable public contract.
- `/platform/cire-standard` for the human-facing standard page.
- `ai_inference_events` for inference lineage.
- `clinical_outcome_events` for outcome closure.
- `cire_snapshots`, `cire_incidents`, and `cire_collapse_profiles` for runtime monitoring.

## 8. Compatibility Badge Rules

A project may call itself CIRE-compatible if it:

1. Computes `phi_hat` from a finite probability vector using the formula above.
2. Computes or records input impairment using missingness, contradiction, and OOD components.
3. Emits CPS, safety state, and reliability badge fields.
4. Persists inference lineage sufficient for audit.
5. Does not treat synthetic or unconfirmed data as outcome-confirmed evidence.
6. Separates runtime reliability from post-outcome calibration.
7. Documents model version, input handling, and human review flow.

## 9. Why This Creates a Moat

The open specification creates adoption pressure. The managed infrastructure captures value.

### Reference moat

If CIRE becomes a cited reliability language for veterinary AI, VetIOS becomes the reference implementation and standard maintainer.

### Switching-cost moat

Clinics that run CIRE-scored workflows accumulate longitudinal reliability and outcome history. Moving to a competitor means losing continuity unless the competitor becomes CIRE-compatible.

### Data-compound moat

Every live CIRE-scored outcome improves calibration, benchmark cohorts, AMR surveillance, and model promotion gates. The public method can be copied; the outcome graph cannot be copied without running real cases over time.

## 10. Research and Regulatory Alignment

CIRE is aligned with the direction of current health AI governance:

- FDA and international regulators emphasize total product lifecycle controls and Good Machine Learning Practice for AI/ML-enabled medical devices.
- FDA's 2025 PCCP guidance highlights planned modifications, validation methodology, implementation controls, and impact assessment for iterative AI-enabled device functions.
- WHO's AI for health guidance emphasizes ethics, human rights, governance, accountability, and public-benefit deployment.
- WHO's LMM guidance highlights that foundation and large multimodal models may be useful across health care, research, public health, and drug development, while requiring governance.
- CONSORT-AI and SPIRIT-AI require transparent reporting of AI interventions, input/output handling, human-AI interaction, and error cases.
- DECIDE-AI focuses on early-stage clinical evaluation, safety, human factors, and replicability for AI decision-support systems.
- WHO GLASS establishes AMR surveillance as a standardized public-health infrastructure problem; CIRE can provide clinical inference reliability metadata alongside veterinary AMR signal feeds.

## 11. Source References

- NVIDIA CUDA documentation: https://docs.nvidia.com/cuda/
- NVIDIA CUDA developer platform: https://developer.nvidia.com/cuda
- FDA Good Machine Learning Practice guiding principles: https://www.fda.gov/medical-devices/software-medical-device-samd/good-machine-learning-practice-medical-device-development-guiding-principles
- FDA AI-enabled device PCCP guidance: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/marketing-submission-recommendations-predetermined-change-control-plan-artificial-intelligence
- WHO ethics and governance of AI for health: https://www.who.int/publications/i/item/9789240029200
- WHO large multimodal model guidance: https://www.who.int/publications/i/item/9789240084759
- CONSORT-AI: https://www.nature.com/articles/s41591-020-1034-x
- SPIRIT-AI: https://www.nature.com/articles/s41591-020-1037-7
- DECIDE-AI: https://www.nature.com/articles/s41591-022-01772-9
- WHO GLASS: https://www.who.int/initiatives/glass
