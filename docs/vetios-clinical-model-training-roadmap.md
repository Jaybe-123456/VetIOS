# VetIOS Clinical Model Training Roadmap

This roadmap separates the model into three layers:

1. Clinical reasoning guardrail: deterministic VetIOS inference engine, plausibility gates, contradiction scoring, and CIRE reliability.
2. Pattern-recognition model: a LoRA/QLoRA adapter trained on structured veterinary cases.
3. Preference/reward layer: clinician feedback, outcome alignment, overrides, and safety penalties.

The inference console should continue to use the deterministic clinical engine as the authority for ranked differentials. Fine-tuned models should provide signal extraction, candidate priors, summarization, and treatment-context enrichment, not autonomous final diagnosis.

## 1. Dataset Contracts

Build datasets from existing VetIOS event loops:

- `ai_inference_events`: input signatures, differential distributions, confidence, CIRE metrics.
- `clinical_outcome_events`: confirmed diagnosis labels and calibration deltas.
- evaluation events: drift, calibration error, outcome alignment.
- simulation/adversarial events: rare presentations, contradictions, stress failures.
- clinician overrides: preferred answer, rejected answer, reason, severity.

Every training row should include:

- de-identified patient signalment: species, breed, age, weight, sex, region.
- structured signs, history, physical exam, diagnostics, imaging/lab summaries.
- target differentials with probabilities and excluded conditions.
- treatment pathway labels only when diagnosis confidence and evidence quality are adequate.
- provenance fields: source table, event id, tenant id hash, dataset version, consent/usage class.

Do not train directly on raw free text until it is de-identified, normalized, and linked to structured labels.

## 2. Baseline Pattern Recognition

Use the model you started with Unsloth as a baseline recognizer:

- Input: structured clinical case JSON plus short normalized narrative.
- Output: candidate differential priors, missing tests, and signal extraction.
- Loss target: disease family, top differential, contraindication flags, and calibrated probability bins.

Keep this model behind the deterministic engine. If it suggests an irrelevant disease, the engine should suppress it through species gates, syndrome routing, anatomic localization, negative-test penalties, and contradiction scoring.

## 3. Supervised Fine-Tuning

SFT dataset shape:

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are VetIOS. Return structured veterinary decision-support JSON only."
    },
    {
      "role": "user",
      "content": "{...structured_case...}"
    },
    {
      "role": "assistant",
      "content": "{...validated_output...}"
    }
  ]
}
```

Training targets should include:

- canonical signals extracted from messy notes.
- ranked differentials with explicit supporting and contradicting evidence.
- missing confirmatory tests.
- abstain/hold decisions when evidence is weak.
- treatment-management mode: diagnostic management vs definitive treatment.

Use LoRA/QLoRA first. Full continued pretraining is only justified once there is a large, legally clean corpus and a strong evaluation harness.

## 4. Preference Optimization / RLHF

Start with offline preference optimization before online RL:

- Accepted answer: clinician-approved differential and pathway.
- Rejected answer: hallucinated, overconfident, irrelevant, unsafe, or poorly supported output.
- Reward factors: outcome alignment, lower calibration error, fewer irrelevant differentials, correct abstain behavior, lower contradiction score, clinically appropriate treatment caution.

Useful preference pairs:

- top differential relevant vs top differential anatomically/systemically irrelevant.
- definitive treatment vs diagnostic-management pathway when confidence is low.
- unsafe dose/pathway vs guideline-backed plan with monitoring.
- overconfident answer vs CIRE-reviewed answer.

Only move to RL-style training after offline SFT/DPO has stable evals and rollback gates.

## 5. Evaluation Gates

No model can be promoted unless it passes:

- species-gated differential tests.
- negation tests: absent vomiting/diarrhea must suppress GI diagnoses.
- negative diagnostic tests: negative heartworm/tick/Coombs/etc. must cap relevant conditions.
- emergency triage tests: GDV, urinary obstruction, IMHA crisis, DKA, dyspnea.
- treatment safety tests: contraindications, monitoring requirements, resource-limited alternatives.
- calibration tests by species, disease family, region, and clinic.
- adversarial simulation tests for rare and contradictory cases.

Promotion rule:

`candidate_model` may enrich but must not override deterministic guardrails unless a clinician-reviewed registry promotion explicitly allows that behavior.

## 6. Deployment Pattern

Recommended serving stack:

- Train with Unsloth or Hugging Face TRL/PEFT in a separate Python worker.
- Export adapter checkpoints with dataset version, eval report, and model card.
- Register the model in VetIOS model registry as `candidate`.
- Run shadow mode against live traffic without affecting clinical output.
- Promote to staging only after benchmark and CIRE stability pass.
- Promote to live only with rollback pointer and audit trail.

Reference docs:

- Unsloth fine-tuning guide: https://unsloth.ai/docs/get-started/fine-tuning-llms-guide
- Unsloth docs: https://docs.unsloth.ai/
- Hugging Face TRL: https://huggingface.co/docs/trl/index
- Hugging Face PEFT LoRA: https://huggingface.co/docs/peft/developer_guides/lora
