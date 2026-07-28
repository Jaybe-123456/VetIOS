import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    resolve(
        process.cwd(),
        '../../supabase/migrations/20260728000000_outcome_value_metrics_v1.sql',
    ),
    'utf8',
);

describe('outcome value metrics migration', () => {
    it('counts distinct inference units and excludes synthetic provenance', () => {
        expect(migration).toContain('group by');
        expect(migration).toContain('inference_event.id');
        expect(migration).toContain('inference_event.simulation_id is not null');
        expect(migration).toContain('outcome_event.simulation_id is not null');
        expect(migration).toContain('synthetic_outcome_inferences_excluded');
    });

    it('admits only expert-reviewed or laboratory-confirmed labels', () => {
        expect(migration).toContain("'expert_reviewed'");
        expect(migration).toContain("'lab_confirmed'");
        expect(migration).toContain('outcome_confirmed_inferences');
        expect(migration).toContain('calibration_ready_outcomes');
    });

    it('publishes aggregate evidence without anonymous database access', () => {
        expect(migration).toContain('with (security_invoker = true)');
        expect(migration).toContain('revoke all on public.outcome_value_metrics_v1 from anon');
        expect(migration).toContain("'outcome_value_v1'::text as metric_version");
    });
});
