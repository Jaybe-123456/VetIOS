-- =============================================================================
-- Migration 034: Clinical Integrity Engine Phase 2 Instability Signals
-- Adds lightweight pre-collapse monitoring metrics to clinical_integrity_events.
-- =============================================================================

alter table public.clinical_integrity_events
    add column if not exists delta_phi double precision
        check (delta_phi between -1 and 1),
    add column if not exists curvature double precision
        check (curvature between -1 and 1),
    add column if not exists variance_proxy double precision
        check (variance_proxy between 0 and 1),
    add column if not exists divergence double precision
        check (divergence between -1 and 1),
    add column if not exists critical_instability_index double precision
        check (critical_instability_index between 0 and 1),
    add column if not exists precliff_detected boolean not null default false;

create index if not exists idx_clinical_integrity_events_tenant_precliff_created
    on public.clinical_integrity_events (tenant_id, precliff_detected, created_at desc);

notify pgrst, 'reload schema';
