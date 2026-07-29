import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    resolve(
        process.cwd(),
        '../../supabase/migrations/20260728040000_model_routing_runtime_activation.sql',
    ),
    'utf8',
);

describe('model routing runtime migration', () => {
    it('materializes governed profiles and auditable execution decisions', () => {
        expect(migration).toContain('create table if not exists public.model_router_profiles');
        expect(migration).toContain('create table if not exists public.model_routing_decisions');
        expect(migration).toContain("alter column approval_status set default 'pending'");
        expect(migration).toContain('idx_model_routing_decisions_inference_event_unique');
    });

    it('keeps tenant isolation on profile and decision access', () => {
        expect(migration).toContain('alter table public.model_router_profiles enable row level security');
        expect(migration).toContain('alter table public.model_routing_decisions enable row level security');
        expect(migration).toContain('model_router_profiles_select_own');
        expect(migration).toContain('model_routing_decisions_update_own');
        expect(migration).toContain('tenant_id = public.current_tenant_id()::text');
    });
});
