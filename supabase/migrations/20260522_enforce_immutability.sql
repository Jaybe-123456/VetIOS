create or replace function public.prevent_core_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'core event table % is append-only; UPDATE and DELETE are not allowed', tg_table_name
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_ai_inference_events on public.ai_inference_events;
create trigger enforce_immutability_ai_inference_events
    before update or delete on public.ai_inference_events
    for each row execute function public.prevent_core_event_mutation();

drop trigger if exists enforce_immutability_clinical_outcome_events on public.clinical_outcome_events;
create trigger enforce_immutability_clinical_outcome_events
    before update or delete on public.clinical_outcome_events
    for each row execute function public.prevent_core_event_mutation();

drop trigger if exists enforce_immutability_edge_simulation_events on public.edge_simulation_events;
create trigger enforce_immutability_edge_simulation_events
    before update or delete on public.edge_simulation_events
    for each row execute function public.prevent_core_event_mutation();

notify pgrst, 'reload schema';
