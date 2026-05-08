create extension if not exists pgcrypto;

alter table public.ai_inference_events
  add column if not exists differentials jsonb not null default '[]'::jsonb,
  add column if not exists cire jsonb not null default '{}'::jsonb,
  add column if not exists latency_ms integer,
  add column if not exists calibration_delta double precision,
  add column if not exists outcome_resolved boolean not null default false;

create index if not exists idx_ai_inference_events_outcome_resolved
  on public.ai_inference_events (tenant_id, outcome_resolved, created_at desc);

alter table public.clinical_outcome_events
  add column if not exists actual_label text,
  add column if not exists actual_confidence double precision,
  add column if not exists calibration_delta double precision,
  add column if not exists "timestamp" timestamptz;

create index if not exists idx_clinical_outcome_events_calibration
  on public.clinical_outcome_events (tenant_id, actual_label, created_at desc)
  where actual_label is not null;

alter table public.edge_simulation_events
  add column if not exists base_case jsonb,
  add column if not exists steps integer,
  add column if not exists mode text,
  add column if not exists passes integer,
  add column if not exists failures integer,
  add column if not exists mean_confidence double precision,
  add column if not exists results_summary jsonb;

create index if not exists idx_edge_simulation_events_stability
  on public.edge_simulation_events (tenant_id, created_at desc);

create table if not exists public.label_calibration (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  label text not null,
  sample_count int not null default 0,
  cumulative_delta numeric not null default 0,
  mean_delta numeric generated always as (
    case when sample_count = 0 then 0 else cumulative_delta / sample_count end
  ) stored,
  updated_at timestamptz default now(),
  unique (tenant_id, label)
);

alter table public.label_calibration enable row level security;

drop policy if exists "Tenant isolation on label_calibration" on public.label_calibration;
create policy "Tenant isolation on label_calibration"
  on public.label_calibration
  for all
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create or replace function public.update_label_calibration()
returns trigger as $$
declare
  v_label text;
begin
  if new.outcome_resolved = true and new.calibration_delta is not null then
    v_label := coalesce(
      new.differentials->0->>'label',
      new.output_payload->'diagnosis'->'top_differentials'->0->>'label',
      new.output_payload->'diagnosis'->'top_differentials'->0->>'name'
    );

    if v_label is not null then
      insert into public.label_calibration (tenant_id, label, sample_count, cumulative_delta)
      values (
        new.tenant_id,
        v_label,
        1,
        new.calibration_delta
      )
      on conflict (tenant_id, label)
      do update set
        sample_count = public.label_calibration.sample_count + 1,
        cumulative_delta = public.label_calibration.cumulative_delta + excluded.cumulative_delta,
        updated_at = now();
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_outcome_learning on public.ai_inference_events;
create trigger trg_outcome_learning
after update of outcome_resolved on public.ai_inference_events
for each row
when (
  new.outcome_resolved = true
  and old.outcome_resolved is distinct from new.outcome_resolved
)
execute function public.update_label_calibration();

notify pgrst, 'reload schema';
