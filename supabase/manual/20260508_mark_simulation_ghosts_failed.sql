-- Manual production repair for stuck Simulation Workbench runs.
-- The active migration 20260508000000_simulation_closed_loop_repair.sql includes
-- the same watchdog backfill after adding the required columns.

update public.simulations
set
    status = 'failed',
    failure_reason = 'WATCHDOG: Run exceeded timeout_at without completing. Marked failed manually at ' || now()::text,
    error_message = coalesce(error_message, 'WATCHDOG: Run exceeded timeout_at without completing.'),
    updated_at = now()
where status = 'running'
  and (
      coalesce(
          timeout_at,
          started_at + make_interval(secs => coalesce(
              duration_s,
              case
                  when config->>'duration_seconds' ~ '^[0-9]+$' then (config->>'duration_seconds')::integer
                  else null
              end,
              300
          ) + 120)
      ) < now()
      or (heartbeat_at is not null and heartbeat_at < now() - interval '60 seconds')
      or started_at < now() - interval '10 minutes'
  )
returning id, scenario_name, started_at, failure_reason;
