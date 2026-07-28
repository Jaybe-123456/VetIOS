# Outcome Calibration Materializer v1

## Purpose

VetIOS needs a reproducible boundary between a clinician-entered outcome and a
claim that an inference is calibration evidence. The materializer makes that
boundary explicit:

1. Read append-only inference and outcome events.
2. Resolve historical label aliases without promoting weak authority.
3. Exclude simulation and synthetic provenance.
4. Accept only `expert_reviewed` and `lab_confirmed` outcomes.
5. Produce an immutable `materialized` or `blocked` decision for every linked
   inference/outcome pair.
6. Build cohort metrics from one strongest current outcome per inference.
7. Publish calibration readiness only after successful materialization.

This is evidence infrastructure. It does not turn a small retrospective cohort
into clinical validation, regulatory approval, or proof of patient benefit.

## Metric Contract

The current inference response is a ranked top-k differential list. It is not
an attested probability distribution over the full diagnostic class space.
Therefore v1 computes:

- top-label correctness
- binary top-label Brier score
- binary top-label log loss
- per-event absolute confidence error
- top-three inclusion of the confirmed label
- equal-mass, cohort-level expected calibration error

The per-event absolute error is not called ECE. ECE is a cohort statistic.
Multiclass Brier score and multiclass log loss remain null unless the inference
payload explicitly attests a complete distribution and its probabilities are
valid, unique by label, and sum to one.

The aggregate loop uses equal-mass bins because fixed-width bins can produce
unstable or biased estimates in sparse cohorts. Minimum evidence thresholds
remain visible, and bucket results below threshold stay `needs_outcome`.

## Evidence Authority

Accepted:

- `lab_confirmed`
- `expert_reviewed`

Blocked:

- legacy `expert`
- missing authority
- inferred or model-generated labels
- synthetic/simulation outcomes
- synthetic/simulation inferences
- missing confirmed label
- missing prediction or invalid confidence
- cross-tenant pairs

When several accepted outcomes exist for one inference, current aggregation
prefers laboratory confirmation over expert review, then the most recent event.
Historical materialization events remain immutable.

## Operational Contract

- `GET /api/platform/outcome-calibration` returns the live dry-run and persisted
  ledger snapshot.
- `POST /api/platform/outcome-calibration` with `mode=dry_run` performs no
  writes.
- `POST /api/platform/outcome-calibration` with `mode=commit` requires
  `evaluation:write` and recent-auth assurance.
- `/api/cron/outcome-calibration-materialization` runs the same commit path.
- The event idempotency key is
  `(tenant_id, inference_event_id, outcome_event_id, algorithm_version)`.
- Raw notes, owner data, documents, images, and full clinical payloads are not
  copied into calibration evidence.

## Research Basis

- Guo et al., "On Calibration of Modern Neural Networks":
  https://proceedings.mlr.press/v70/guo17a.html
- Roelofs et al., "Mitigating Bias in Calibration Error Estimation":
  https://proceedings.mlr.press/v151/roelofs22a.html
- Nixon et al., "Measuring Calibration in Deep Learning":
  https://openaccess.thecvf.com/content_CVPRW_2019/html/Uncertainty_and_Robustness_in_Deep_Visual_Learning/Nixon_Measuring_Calibration_in_Deep_Learning_CVPRW_2019_paper.html
- Scikit-learn probability calibration guidance:
  https://scikit-learn.org/stable/modules/calibration.html
- DECIDE-AI early clinical evaluation guideline:
  https://www.nature.com/articles/s41591-022-01772-9
- TRIPOD+AI reporting statement:
  https://www.bmj.com/content/385/bmj-2023-078378
- FDA transparency principles for ML-enabled medical devices:
  https://www.fda.gov/medical-devices/software-medical-device-samd/transparency-machine-learning-enabled-medical-devices-guiding-principles
- NIST AI RMF Core:
  https://airc.nist.gov/airmf-resources/airmf/5-sec-core/
- WHO ethics and governance of AI for health:
  https://www.who.int/publications/i/item/9789240029200

These sources are applied as engineering and evidence-governance guidance.
Human medical-device guidance is not represented as veterinary regulatory
approval or as automatically controlling veterinary practice.
