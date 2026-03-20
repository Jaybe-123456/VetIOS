## Clinical Dataset Learning Sync Rollout

Apply `infra/supabase/migrations/020_clinical_dataset_learning_sync.sql` after deploying the app changes from this pass.

What the migration does:
- adds persisted prediction/calibration fields to `public.clinical_cases`
- backfills label, severity, contradiction, adversarial, and calibration metadata from the latest linked inference/outcome/simulation history
- re-normalizes species display/canonical values
- recreates `public.clinical_case_live_view` with the new learning fields

After the migration:
1. Run `NOTIFY pgrst, 'reload schema';` if it was not executed as part of the migration.
2. Call `POST /api/dataset/backfill` once per tenant if you want an application-level reconciliation pass on top of the SQL backfill.
3. Reload `/dataset` and verify:
   - diagnosis/class/severity fields are populated for cases with inference history
   - adversarial cases show contradiction metadata
   - calibration-ready counts increase once outcomes are linked
