-- Lab ordering agent durability.
-- Promotes lab recommendations into auditable order requests without requiring
-- a vendor-specific connector schema.

alter table public.lab_recommendations
    add column if not exists order_status text not null default 'not_ordered'
        check (order_status in ('not_ordered','pending_dispatch','sent','failed','cancelled')),
    add column if not exists ordering_mode text
        check (ordering_mode is null or ordering_mode in ('auto','manual')),
    add column if not exists order_payload jsonb not null default '{}'::jsonb
        check (jsonb_typeof(order_payload) = 'object'),
    add column if not exists ordered_at timestamptz,
    add column if not exists ordered_by text,
    add column if not exists external_order_id text;

create index if not exists idx_lab_recommendations_order_status
    on public.lab_recommendations (tenant_id, order_status, created_at desc);

comment on column public.lab_recommendations.order_payload is
    'Auditable vendor-neutral lab order request payload emitted by the VetIOS lab ordering agent.';
