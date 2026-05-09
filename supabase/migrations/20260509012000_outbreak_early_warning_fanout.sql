alter table public.symptom_cluster_snapshots
    add column if not exists cluster_key text,
    add column if not exists subscriber_notifications_enqueued integer not null default 0 check (subscriber_notifications_enqueued >= 0),
    add column if not exists resolved_at timestamptz;

create index if not exists idx_symptom_cluster_snapshots_cluster_key_time
    on public.symptom_cluster_snapshots (cluster_key, created_at desc);

create index if not exists idx_outbreak_subscribers_region_species_active
    on public.outbreak_subscribers (active, created_at desc);
