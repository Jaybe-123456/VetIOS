-- VetIOS Phase 5: RLHF Override Signals
create type rlhf_signal_status as enum (
  'pending', 'queued', 'applied', 'rejected', 'skipped'
);

create type rlhf_override_type as enum (
  'diagnosis_correction',
  'diagnosis_rerank',
  'confidence_flag',
  'treatment_correction',
  'severity_correction',
  'false_positive',
  'false_negative'
);

create table vet_override_signals (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  inference_event_id    uuid not null references ai_inference_events(id) on delete restrict,
  tenant_id             uuid not null,
  vet_user_id           uuid not null references auth.users(id) on delete restrict,
  override_type         rlhf_override_type not null,
  ai_output             jsonb not null,
  vet_correction        jsonb not null,
  correction_notes      text,
  species               text not null,
  breed                 text,
  age_years             numeric(5,2),
  presenting_symptoms   text[] not null default '{}',
  top_ai_diagnosis      text not null,
  ai_confidence         numeric(5,4) not null check (ai_confidence between 0 and 1),
  vet_diagnosis         text not null,
  vet_confidence        numeric(5,4) check (vet_confidence between 0 and 1),
  is_confirmed_by_outcome boolean,
  outcome_event_id      uuid references clinical_outcome_events(id),
  status                rlhf_signal_status not null default 'pending',
  batch_id              uuid,
  processed_at          timestamptz,
  processing_notes      text,
  signal_weight         numeric(6,4),
  constraint uq_override_per_inference_per_vet unique (inference_event_id, vet_user_id)
);

create index idx_override_signals_pending
  on vet_override_signals (tenant_id, status, created_at)
  where status = 'pending';

create index idx_override_signals_tuple
  on vet_override_signals (species, breed, top_ai_diagnosis, status);

create index idx_override_signals_inference
  on vet_override_signals (inference_event_id);

alter table vet_override_signals enable row level security;

create policy "vet_insert_own_override" on vet_override_signals
  for insert with check (auth.uid() = vet_user_id);

create policy "vet_read_own_overrides" on vet_override_signals
  for select using (auth.uid() = vet_user_id);

create table rlhf_batch_runs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  status           text not null default 'running'
                     check (status in ('running','completed','failed')),
  signals_queued   int not null default 0,
  signals_applied  int not null default 0,
  signals_rejected int not null default 0,
  signals_skipped  int not null default 0,
  error_message    text,
  metadata         jsonb default '{}'
);

create materialized view rlhf_accuracy_by_tuple as
select
  species,
  breed,
  top_ai_diagnosis,
  count(*)                                                          as total_signals,
  count(*) filter (where vet_diagnosis = top_ai_diagnosis)         as correct_count,
  round(
    count(*) filter (where vet_diagnosis = top_ai_diagnosis)::numeric
    / nullif(count(*), 0) * 100, 2
  )                                                                 as accuracy_pct,
  avg(ai_confidence)                                                as avg_ai_confidence,
  max(created_at)                                                   as last_signal_at
from vet_override_signals
where status = 'applied'
group by species, breed, top_ai_diagnosis
with no data;

create unique index on rlhf_accuracy_by_tuple (species, breed, top_ai_diagnosis);

create or replace function refresh_rlhf_accuracy_view()
returns void language plpgsql security definer as $$
begin
  refresh materialized view concurrently rlhf_accuracy_by_tuple;
end;
$$;
