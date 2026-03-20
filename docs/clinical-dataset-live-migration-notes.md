# Clinical Dataset Live Migration Notes

## What changed

- `clinical_cases` now stores canonical tenant case state for inference, outcome, and simulation activity.
- `ai_inference_events`, `clinical_outcome_events`, and `edge_simulation_events` now carry `user_id` and `source_module`.
- `edge_simulation_events` now carries `tenant_id`, `clinic_id`, and `case_id`.
- `clinical_case_live_view` is the new live dataset projection consumed by `/dataset`.

## Deployment steps

1. Deploy the app code that includes the dataset-manager refactor.
2. Apply [018_clinical_dataset_live_projection.sql](/C:/Users/Administrator/New%20folder/infra/supabase/migrations/018_clinical_dataset_live_projection.sql) in the target Supabase project.
3. Confirm the migration finishes without error.
4. Run:

```sql
select to_regclass('public.clinical_case_live_view') as live_view;
select count(*) as case_count from public.clinical_cases;
select count(*) as inference_orphans from public.ai_inference_events where case_id is null;
select count(*) as outcome_orphans from public.clinical_outcome_events where case_id is null;
select count(*) as simulation_orphans from public.edge_simulation_events where case_id is null;
```

5. Refresh PostgREST if needed:

```sql
NOTIFY pgrst, 'reload schema';
```

6. Validate the live diagnostics endpoint for a signed-in tenant:
   - `GET /api/dataset/debug`

## Expected outcome

- New inference submissions create or upsert a canonical case row immediately.
- Outcome and simulation writes update the same `case_id`.
- `/dataset` reads from `clinical_case_live_view` and shows tenant-visible activity ordered by `updated_at desc`.
- The debug endpoint reports recent writes and orphan counts for the current tenant.
