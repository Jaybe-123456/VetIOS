# VetIOS Clinical Training Startover

This is the clean lane for moving from prototype training to real clinical datasets.

## What Changes

- Use supervised fine-tuning first, not full pretraining.
- Train only on de-identified, legally usable, clinically reviewed rows.
- Keep the model behind VetIOS deterministic guardrails.
- Save LoRA adapters with a dataset manifest instead of overwriting the base model.

Qwen2.5-0.5B is small. Treat it as a pattern recognizer for structured case extraction, differential priors, missing-test suggestions, and safety flags. It should not be the final authority for diagnosis or treatment.

## Data Rules

Do not upload raw PHI, owner/client identifiers, clinic identifiers, or restricted clinical data into Google Colab unless the governing agreement explicitly allows that runtime.

Public or credentialed datasets such as MIMIC/PhysioNet/n2c2 have access and use agreements. For veterinary data, use clinic data only after de-identification, consent/contract review, and clinical review of labels.

## Source JSONL Contract

Create `vetios_pipeline/datasets/clinical_cases.jsonl` with one JSON object per row:

```json
{
  "case_id": "stable-deidentified-id",
  "source": "clinic_outcome_registry_v1",
  "usage_class": "internal_deidentified",
  "review_status": "clinician_reviewed",
  "split": "train",
  "structured_case": {
    "species": "dog",
    "age_years": 6,
    "presenting_signs": ["vomiting", "diarrhea"],
    "diagnostics": {
      "cbc": "mild hemoconcentration"
    }
  },
  "validated_output": {
    "mode": "diagnostic_decision_support",
    "top_differentials": [],
    "missing_tests": [],
    "safety_flags": []
  }
}
```

Allowed `usage_class` values are `public_open`, `public_restricted`, `credentialed_deidentified`, `internal_deidentified`, and `consented_research`.

Allowed `review_status` values are `clinician_reviewed`, `expert_curated`, `guideline_derived`, and `outcome_confirmed`.

## Colab Commands

Install:

```bash
pip install -U unsloth torch transformers datasets trl peft accelerate bitsandbytes
```

Prepare:

```bash
python vetios_pipeline/prepare_dataset.py \
  --input vetios_pipeline/datasets/clinical_cases.jsonl \
  --output-dir vetios_pipeline/datasets/prepared \
  --holdout 0.1 \
  --strict-dates
```

Train:

```bash
python vetios_pipeline/train_model.py \
  --model VetIOS/vetios-qwen2.5-0.5b-ready \
  --train-file vetios_pipeline/datasets/prepared/train.jsonl \
  --eval-file vetios_pipeline/datasets/prepared/eval.jsonl \
  --output-dir vetios_pipeline/final_model \
  --checkpoint-dir vetios_pipeline/checkpoints \
  --clinical-ack
```

If your Hugging Face repo is private, log in first:

```python
from huggingface_hub import login
login()
```

## Import A Clinical Export

For a CSV export, start with the importer. It recognizes common columns such as `case_id`, `species`, `age_years`, `sex`, `weight_kg`, `presenting_signs`, `history`, `physical_exam`, `diagnostics`, `confirmed_diagnosis`, `top_differentials`, `missing_tests`, and `safety_flags`.

```bash
python vetios_pipeline/import_clinical_cases.py \
  --input vetios_pipeline/datasets/clinical_cases.csv \
  --output vetios_pipeline/datasets/clinical_cases.jsonl \
  --source clinic_export_v1 \
  --usage-class internal_deidentified \
  --review-status clinician_reviewed \
  --strict-dates
```

Use `--dry-run` first if you want a validation pass without writing output. Use `--skip-unlabeled` only for import triage; rows without validated labels are not useful for supervised training yet.

For Google Drive source folders, use the Drive-specific workflow in [`vetios-google-drive-dataset-workflow.md`](./vetios-google-drive-dataset-workflow.md). It inventories folders, imports structured CSV/JSONL/XLSX case exports, and keeps reference documents separate from supervised fine-tuning rows.

Then prepare and train:

```bash
python vetios_pipeline/prepare_dataset.py \
  --input vetios_pipeline/datasets/clinical_cases.jsonl \
  --output-dir vetios_pipeline/datasets/prepared \
  --holdout 0.1 \
  --strict-dates

python vetios_pipeline/train_model.py \
  --model VetIOS/vetios-qwen2.5-0.5b-ready \
  --train-file vetios_pipeline/datasets/prepared/train.jsonl \
  --eval-file vetios_pipeline/datasets/prepared/eval.jsonl \
  --output-dir vetios_pipeline/final_model \
  --checkpoint-dir vetios_pipeline/checkpoints \
  --clinical-ack
```

## Evaluate The Adapter

Copy `vetios_pipeline/evaluation/eval_cases.example.jsonl` to `vetios_pipeline/evaluation/eval_cases.jsonl`, then replace the examples with clinician-reviewed holdout cases and expected terms.

```bash
python vetios_pipeline/evaluate_model.py \
  --model vetios_pipeline/final_model \
  --eval-file vetios_pipeline/evaluation/eval_cases.jsonl \
  --output vetios_pipeline/evaluation/results.json
```

## Synthetic Reference-Derived Augmentation

If you need more training coverage before you have enough real de-identified clinical cases, generate synthetic/reference-derived cases. These rows are useful for format discipline, safety flags, species gates, and differential-ranking practice. They are not real patient records and should not be represented as outcome-confirmed clinical data.

```bash
python vetios_pipeline/generate_synthetic_cases.py \
  --count 5000 \
  --output vetios_pipeline/datasets/synthetic_global_cases.jsonl

python vetios_pipeline/prepare_dataset.py \
  --input vetios_pipeline/datasets/synthetic_global_cases.jsonl \
  --output-dir vetios_pipeline/datasets/prepared_synthetic \
  --holdout 0.1 \
  --allow-synthetic \
  --strict-dates
```

To mix a small amount of synthetic data with real reviewed cases, keep the real cases as the evaluation set and use synthetic cases only as training augmentation. Never evaluate on generated rows alone.

## When To Use Continued Pretraining

Use continued pretraining only after you have a large, legally clean, de-identified corpus and a separate evaluation harness. CPT can teach domain language, but it does not teach reliable clinical behavior by itself. For VetIOS, use CPT before SFT only when the model struggles to read your domain text at all.

## Promotion Gate

Do not promote the adapter until it passes:

- Species-gated differential checks.
- Negation and negative-test checks.
- Emergency triage scenarios.
- Treatment contraindication checks.
- Calibration by species, disease family, and clinic/source.
- Shadow-mode review against real cases with clinician signoff.
