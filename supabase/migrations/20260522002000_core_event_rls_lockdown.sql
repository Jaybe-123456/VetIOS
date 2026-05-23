alter table public.ai_inference_events enable row level security;
alter table public.clinical_outcome_events enable row level security;
alter table public.edge_simulation_events enable row level security;

revoke insert, update, delete on table public.ai_inference_events from anon;
revoke insert, update, delete on table public.clinical_outcome_events from anon;
revoke insert, update, delete on table public.edge_simulation_events from anon;

revoke update, delete on table public.ai_inference_events from authenticated;
revoke update, delete on table public.clinical_outcome_events from authenticated;
revoke update, delete on table public.edge_simulation_events from authenticated;

grant select, insert, update, delete on table public.ai_inference_events to service_role;
grant select, insert, update, delete on table public.clinical_outcome_events to service_role;
grant select, insert, update, delete on table public.edge_simulation_events to service_role;

notify pgrst, 'reload schema';
