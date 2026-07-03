alter table public.cire_snapshots enable row level security;
alter table public.cire_incidents enable row level security;
alter table public.cire_collapse_profiles enable row level security;
alter table public.cire_rolling_state enable row level security;

drop policy if exists cire_snapshots_select_tenant on public.cire_snapshots;
create policy cire_snapshots_select_tenant
    on public.cire_snapshots
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists cire_snapshots_insert_tenant on public.cire_snapshots;
create policy cire_snapshots_insert_tenant
    on public.cire_snapshots
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_cire_snapshots" on public.cire_snapshots;
create policy "service_role_cire_snapshots"
    on public.cire_snapshots for all to service_role using (true) with check (true);

drop policy if exists cire_incidents_select_tenant on public.cire_incidents;
create policy cire_incidents_select_tenant
    on public.cire_incidents
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists cire_incidents_insert_tenant on public.cire_incidents;
create policy cire_incidents_insert_tenant
    on public.cire_incidents
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists cire_incidents_update_tenant on public.cire_incidents;
create policy cire_incidents_update_tenant
    on public.cire_incidents
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_cire_incidents" on public.cire_incidents;
create policy "service_role_cire_incidents"
    on public.cire_incidents for all to service_role using (true) with check (true);

drop policy if exists cire_collapse_profiles_select_tenant on public.cire_collapse_profiles;
create policy cire_collapse_profiles_select_tenant
    on public.cire_collapse_profiles
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists cire_collapse_profiles_insert_tenant on public.cire_collapse_profiles;
create policy cire_collapse_profiles_insert_tenant
    on public.cire_collapse_profiles
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_cire_collapse_profiles" on public.cire_collapse_profiles;
create policy "service_role_cire_collapse_profiles"
    on public.cire_collapse_profiles for all to service_role using (true) with check (true);

drop policy if exists cire_rolling_state_select_tenant on public.cire_rolling_state;
create policy cire_rolling_state_select_tenant
    on public.cire_rolling_state
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists cire_rolling_state_insert_tenant on public.cire_rolling_state;
create policy cire_rolling_state_insert_tenant
    on public.cire_rolling_state
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists cire_rolling_state_update_tenant on public.cire_rolling_state;
create policy cire_rolling_state_update_tenant
    on public.cire_rolling_state
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_cire_rolling_state" on public.cire_rolling_state;
create policy "service_role_cire_rolling_state"
    on public.cire_rolling_state for all to service_role using (true) with check (true);

comment on table public.cire_snapshots is
    'Tenant-scoped CIRE runtime reliability snapshots for inference phi_hat, CPS, input impairment, and safety-state lineage.';

comment on table public.cire_incidents is
    'Tenant-scoped CIRE critical/blocked incident workflow for suppressed or unstable clinical inference outputs.';

comment on table public.cire_collapse_profiles is
    'Tenant-scoped CIRE collapse calibration profiles generated from adversarial impairment sweeps and hysteresis checks.';

comment on table public.cire_rolling_state is
    'Tenant-scoped rolling phi_hat and delta state used to compute CIRE collapse proximity over time.';

notify pgrst, 'reload schema';
