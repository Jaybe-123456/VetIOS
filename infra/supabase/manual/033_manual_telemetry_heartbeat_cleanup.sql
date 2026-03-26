-- Run this only after deploying the application change that stops
-- observer heartbeat rows from being written on telemetry/topology read paths.
--
-- Purpose:
-- 1. Confirm how many heartbeat rows are currently stored.
-- 2. Delete historical observer heartbeat noise that is driving free-tier usage.
-- 3. Leave non-heartbeat system events, routing decisions, and workload events intact.

-- Preview the rows that will be removed.
select
    coalesce(metadata->>'source_module', '(unknown)') as source_module,
    count(*) as heartbeat_rows,
    min("timestamp") as oldest_timestamp,
    max("timestamp") as newest_timestamp
from public.telemetry_events
where event_type = 'system'
  and coalesce(metadata->>'action', '') = 'heartbeat'
  and coalesce(metadata->>'target_node_id', '') = 'telemetry_observer'
  and coalesce(metadata->>'source_module', '') in (
      'telemetry_stream',
      'topology_stream',
      'telemetry_api',
      'topology_api',
      'settings_control_plane'
  )
group by 1
order by heartbeat_rows desc, source_module asc;

begin;

with deleted_rows as (
    delete from public.telemetry_events
    where event_type = 'system'
      and coalesce(metadata->>'action', '') = 'heartbeat'
      and coalesce(metadata->>'target_node_id', '') = 'telemetry_observer'
      and coalesce(metadata->>'source_module', '') in (
          'telemetry_stream',
          'topology_stream',
          'telemetry_api',
          'topology_api',
          'settings_control_plane'
      )
    returning
        coalesce(metadata->>'source_module', '(unknown)') as source_module,
        "timestamp"
)
select
    source_module,
    count(*) as deleted_rows,
    min("timestamp") as oldest_deleted_timestamp,
    max("timestamp") as newest_deleted_timestamp
from deleted_rows
group by 1
order by deleted_rows desc, source_module asc;

commit;

-- Post-cleanup sanity checks.
select
    event_type,
    count(*) as remaining_rows
from public.telemetry_events
group by 1
order by remaining_rows desc, event_type asc;

select
    count(*) as remaining_observer_heartbeats
from public.telemetry_events
where event_type = 'system'
  and coalesce(metadata->>'action', '') = 'heartbeat'
  and coalesce(metadata->>'target_node_id', '') = 'telemetry_observer'
  and coalesce(metadata->>'source_module', '') in (
      'telemetry_stream',
      'topology_stream',
      'telemetry_api',
      'topology_api',
      'settings_control_plane'
  );

analyze public.telemetry_events;
