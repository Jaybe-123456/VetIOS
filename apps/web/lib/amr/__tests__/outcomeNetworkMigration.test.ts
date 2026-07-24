import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    resolve(
        process.cwd(),
        '../../supabase/migrations/20260723000000_amr_outcome_network_pilot.sql',
    ),
    'utf8',
);

describe('AMR outcome network migration', () => {
    it('enforces tenant-owned provenance and immutable episode history', () => {
        expect(migration).toContain('validate_amr_outcome_episode_provenance');
        expect(migration).toContain('validate_provenance_amr_outcome_episode_events');
        expect(migration).toContain('AMR episode synthetic status must preserve linked provenance');
        expect(migration).toContain('tenant_id = public.current_tenant_id()');
        expect(migration).toContain('enforce_immutability_amr_outcome_episode_events');
    });

    it('protects future dedupe without rewriting append-only historical rows', () => {
        expect(migration).toContain('source_digest_dedupe_enforced boolean');
        expect(migration).toContain('request_dedupe_enforced boolean');
        expect(migration).toContain('enforce_amr_outcome_network_dedupe_keys');
        expect(migration).toContain('where source_digest_dedupe_enforced is true');
        expect(migration).toContain(
            'where request_id is not null and request_dedupe_enforced is true',
        );
    });
});
