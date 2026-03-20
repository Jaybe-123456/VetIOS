# Structured Clinical Dataset Migration Notes

## What Changes

Migration `019_structured_clinical_dataset.sql` upgrades canonical `clinical_cases` into a validation-aware, learning-ready schema.

Key additions:
- ingestion validation and quarantine fields
- normalized symptom vector JSON
- diagnosis, severity, contradiction, and adversarial metadata
- case clustering and telemetry readiness markers
- filtered `clinical_case_live_view` that excludes invalid and quarantined rows by default

## Deployment Steps

1. Apply `infra/supabase/migrations/019_structured_clinical_dataset.sql`.
2. Run `NOTIFY pgrst, 'reload schema';` if the migration runner does not already do so.
3. Refresh `/dataset`.
4. Validate `/api/dataset/debug` for:
   - `coverage_counts.quarantined_cases`
   - `coverage_counts.unlabeled_cases`
   - `coverage_counts.adversarial_cases`
   - `recent_quarantined_cases`

## Behavior Changes

- Cases with missing species or missing clinical signals are now marked `quarantined` or `rejected`.
- Default live dataset queries now exclude invalid cases.
- Outcome-linked cases upgrade `confirmed_diagnosis` and `label_type`.
- Adversarial simulations mark canonical cases as adversarial and preserve contradiction metadata.

## Export Modes

The dataset manager now supports export-ready case subsets for:
- clean labeled cases
- severity training set
- adversarial benchmark set
- calibration audit set
- quarantined invalid cases

## Compatibility Notes

- Existing live-case materialization remains intact.
- Existing event tables stay authoritative; canonical case rows now materialize richer derived fields from linked inference/outcome/simulation events.
- Older rows are backfilled during migration using current linked event payloads where available.
