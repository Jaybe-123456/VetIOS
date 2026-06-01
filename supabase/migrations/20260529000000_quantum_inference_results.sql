alter table public.ai_inference_events
    add column if not exists quantum_result jsonb,
    add column if not exists ranker text not null default 'classical';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'ai_inference_events_ranker_check'
    ) then
        alter table public.ai_inference_events
            add constraint ai_inference_events_ranker_check
            check (ranker in ('classical', 'quantum', 'hybrid'));
    end if;
end $$;

create index if not exists idx_ai_inference_events_ranker
    on public.ai_inference_events (tenant_id, ranker, created_at desc);

notify pgrst, 'reload schema';
