import { describe, expect, it } from 'vitest';
import {
    CIRE_OPERATIONAL_SCHEMA_TARGETS,
    buildCireOperationalProofRecord,
    buildPublicCireOperationalProofSnapshot,
} from '../operationalProof';

describe('CIRE operational proof', () => {
    it('builds a sanitized hashed cron proof record', () => {
        const record = buildCireOperationalProofRecord({
            tenantId: 'tenant-public',
            requestId: 'request-123',
            proofKind: 'cron_execution',
            proofTarget: 'cire-reference-certification',
            proofStatus: 'succeeded',
            runtimeEnvironment: 'test',
            cronJobName: 'cire-reference-certification',
            cronSchedule: '20 3 * * *',
            startedAt: '2026-07-03T03:20:00.000Z',
            completedAt: '2026-07-03T03:20:00.022Z',
            recordsProcessed: 1,
            schemaTargets: CIRE_OPERATIONAL_SCHEMA_TARGETS,
            proofPacket: {
                public_result: 'passed',
                authorization_token: 'do-not-store',
                nested: {
                    patient_name: 'do-not-store',
                    visible_count: 10,
                },
            },
        });

        expect(record.proof_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(record.latency_ms).toBe(22);
        expect(record.records_processed).toBe(1);
        expect(record.schema_targets).toContain('public.cire_operational_proof_events');
        expect(JSON.stringify(record.proof_packet)).not.toContain('do-not-store');
        expect(record.proof_packet).toMatchObject({
            public_result: 'passed',
            nested: { visible_count: 10 },
        });
    });

    it('aggregates public proof snapshots without tenant details', () => {
        const snapshot = buildPublicCireOperationalProofSnapshot([
            {
                proof_kind: 'cron_execution',
                proof_target: 'cire-reference-certification',
                proof_status: 'succeeded',
                runtime_environment: 'production',
                cron_job_name: 'cire-reference-certification',
                cron_schedule: '20 3 * * *',
                latency_ms: 25,
                records_processed: 1,
                schema_targets: ['public.cire_conformance_certification_events'],
                blockers: [],
                warnings: [],
                proof_digest: 'a'.repeat(64),
                observed_at: '2026-07-03T10:00:00.000Z',
            },
            {
                proof_kind: 'calibration_execution',
                proof_target: 'cire-calibration',
                proof_status: 'degraded',
                runtime_environment: 'production',
                cron_job_name: 'cire-calibration',
                cron_schedule: '15 3 * * *',
                latency_ms: 100,
                records_processed: 0,
                schema_targets: ['public.cire_snapshots'],
                blockers: ['insufficient_recent_outcomes'],
                warnings: [],
                proof_digest: 'b'.repeat(64),
                observed_at: '2026-07-03T09:00:00.000Z',
            },
        ], '2026-07-03T11:00:00.000Z');

        expect(snapshot.summary).toEqual({
            total_proofs: 2,
            succeeded_proofs: 1,
            failed_proofs: 0,
            degraded_proofs: 1,
            latest_observed_at: '2026-07-03T10:00:00.000Z',
        });
        expect(snapshot.cron_jobs).toHaveLength(2);
        expect(snapshot.schema_targets.map((target) => target.schema_target)).toEqual([
            'public.cire_conformance_certification_events',
            'public.cire_snapshots',
        ]);
        expect(JSON.stringify(snapshot)).not.toContain('tenant_id');
    });
});
