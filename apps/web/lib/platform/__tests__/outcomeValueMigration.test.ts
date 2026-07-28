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

const compatibilityMigration = readFileSync(
    resolve(
        process.cwd(),
        '../../supabase/migrations/20260727235900_outcome_value_schema_compatibility.sql',
    ),
    'utf8',
);

const labelAliasRepairMigration = readFileSync(
    resolve(
        process.cwd(),
        '../../supabase/migrations/20260728010000_outcome_value_label_alias_repair.sql',
    ),
    'utf8',
);

const materializerMigration = readFileSync(
    resolve(
        process.cwd(),
        '../../supabase/migrations/20260728020000_outcome_calibration_materializer.sql',
    ),
    'utf8',
);

describe('outcome value metrics migration', () => {
    it('repairs legacy outcome schemas before creating the aggregate view', () => {
        expect(compatibilityMigration).toContain('add column if not exists actual_label text');
        expect(compatibilityMigration).toContain('add column if not exists calibration_delta double precision');
        expect(compatibilityMigration).toContain("label_type text not null default 'synthetic'");
        expect(compatibilityMigration).toContain('is_synthetic boolean not null default false');
    });

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

    it('normalizes historical diagnosis label aliases without promoting legacy authority', () => {
        expect(labelAliasRepairMigration).toContain("outcome_payload ->> 'actual_diagnosis'");
        expect(labelAliasRepairMigration).toContain("outcome_payload ->> 'final_diagnosis'");
        expect(labelAliasRepairMigration).toContain("= 'expert_reviewed'");
        expect(labelAliasRepairMigration).not.toContain("= 'expert'");
    });

    it('publishes aggregate evidence without anonymous database access', () => {
        expect(migration).toContain('with (security_invoker = true)');
        expect(migration).toContain('revoke all on public.outcome_value_metrics_v1 from anon');
        expect(migration).toContain("'outcome_value_v1'::text as metric_version");
    });

    it('requires versioned materialization before publishing calibration readiness', () => {
        expect(materializerMigration).toContain(
            'create table if not exists public.outcome_calibration_materialization_events',
        );
        expect(materializerMigration).toContain(
            'unique (tenant_id, inference_event_id, outcome_event_id, algorithm_version)',
        );
        expect(materializerMigration).toContain(
            "materialization_status in ('materialized', 'blocked')",
        );
        expect(materializerMigration).toContain(
            'create or replace view public.outcome_value_metrics_v2',
        );
        expect(materializerMigration).toContain(
            "where materialization_status = 'materialized'",
        );
        expect(materializerMigration).toContain(
            'revoke all on public.outcome_value_metrics_v2 from anon, authenticated',
        );
    });
});
