import { describe, expect, it } from 'vitest';
import {
    AMR_PILOT_TARGET_EPISODES,
    assessAMROutcomeEpisode,
    buildAMRNetworkSiteSummaries,
    buildAMROutcomeNetworkSnapshot,
    type AMRNetworkSiteEventRow,
    type AMROutcomeEpisodeEventRow,
} from '@/lib/amr/outcomeNetwork';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const LAB_ID = '22222222-2222-4222-8222-222222222222';
const CLINIC_IDS = [
    '33333333-3333-4333-8333-333333333331',
    '33333333-3333-4333-8333-333333333332',
    '33333333-3333-4333-8333-333333333333',
];

describe('AMR outcome network pilot', () => {
    it('requires enrollment, data use approval, and connector verification for operational sites', () => {
        const rows = buildSiteEvents([LAB_ID, CLINIC_IDS[0]]);
        const summaries = buildAMRNetworkSiteSummaries(rows);

        expect(summaries).toHaveLength(2);
        expect(summaries.every((site) => site.operational)).toBe(true);
        expect(summaries.find((site) => site.site_id === LAB_ID)?.site_type).toBe('laboratory');
    });

    it('retains site identity metadata across append-only status events', () => {
        const rows: AMRNetworkSiteEventRow[] = [
            {
                tenant_id: TENANT_ID,
                site_id: LAB_ID,
                site_type: 'laboratory',
                event_type: 'invited',
                display_label: 'Reference laboratory',
                occurred_at: '2026-07-01T00:00:00.000Z',
            },
            {
                tenant_id: TENANT_ID,
                site_id: LAB_ID,
                site_type: 'laboratory',
                event_type: 'enrolled',
                occurred_at: '2026-07-02T00:00:00.000Z',
            },
            {
                tenant_id: TENANT_ID,
                site_id: LAB_ID,
                site_type: 'laboratory',
                event_type: 'data_use_approved',
                occurred_at: '2026-07-03T00:00:00.000Z',
            },
            {
                tenant_id: TENANT_ID,
                site_id: LAB_ID,
                site_type: 'laboratory',
                event_type: 'connector_verified',
                connector_key: 'reference-lab.ast.v1',
                occurred_at: '2026-07-04T00:00:00.000Z',
            },
            {
                tenant_id: TENANT_ID,
                site_id: LAB_ID,
                site_type: 'laboratory',
                event_type: 'paused',
                occurred_at: '2026-07-05T00:00:00.000Z',
            },
        ];

        expect(buildAMRNetworkSiteSummaries(rows)[0]).toMatchObject({
            display_label: 'Reference laboratory',
            connector_key: 'reference-lab.ast.v1',
            status: 'paused',
            operational: false,
        });
    });

    it('admits only real, reviewed, outcome-linked episodes to calibration and federation', () => {
        const sites = buildAMRNetworkSiteSummaries(buildSiteEvents([LAB_ID, CLINIC_IDS[0]]));
        const rows = buildCompleteEpisode('44444444-4444-4444-8444-444444444444', CLINIC_IDS[0]);
        const assessment = assessAMROutcomeEpisode(rows, sites);

        expect(assessment.stage).toBe('closed');
        expect(assessment.calibration_eligible).toBe(true);
        expect(assessment.federation_eligible).toBe(true);
        expect(assessment.blockers).toEqual([]);
    });

    it('excludes synthetic or non-deidentified episodes from learning evidence', () => {
        const sites = buildAMRNetworkSiteSummaries(buildSiteEvents([LAB_ID, CLINIC_IDS[0]]));
        const synthetic = buildCompleteEpisode(
            '55555555-5555-4555-8555-555555555555',
            CLINIC_IDS[0],
        ).map((row) => ({ ...row, is_synthetic: true }));
        const identifiable = buildCompleteEpisode(
            '66666666-6666-4666-8666-666666666666',
            CLINIC_IDS[0],
        ).map((row, index) => ({ ...row, deidentified: index !== 2 }));

        expect(assessAMROutcomeEpisode(synthetic, sites)).toMatchObject({
            calibration_eligible: false,
            federation_eligible: false,
            synthetic: true,
        });
        expect(assessAMROutcomeEpisode(synthetic, sites).blockers)
            .toContain('synthetic_episode_excluded');
        expect(assessAMROutcomeEpisode(identifiable, sites)).toMatchObject({
            calibration_eligible: false,
            federation_eligible: false,
            deidentified: false,
        });
        expect(assessAMROutcomeEpisode(identifiable, sites).blockers)
            .toContain('deidentification_failed');
    });

    it('does not admit an otherwise complete episode to learning evidence before closure', () => {
        const sites = buildAMRNetworkSiteSummaries(buildSiteEvents([LAB_ID, CLINIC_IDS[0]]));
        const openRows = buildCompleteEpisode(
            '67676767-6767-4767-8767-676767676767',
            CLINIC_IDS[0],
        ).filter((row) => row.event_type !== 'episode_closed');
        const assessment = assessAMROutcomeEpisode(openRows, sites);

        expect(assessment.calibration_eligible).toBe(false);
        expect(assessment.federation_eligible).toBe(false);
        expect(assessment.completion_percent).toBeCloseTo(83.3333, 3);
        expect(assessment.blockers).toContain('episode_closure_missing');
    });

    it('marks the pilot evidence-ready only after one lab, three clinics, and 250 eligible episodes', () => {
        const siteEvents = buildSiteEvents([LAB_ID, ...CLINIC_IDS]);
        const episodeEvents = Array.from({ length: AMR_PILOT_TARGET_EPISODES }, (_, index) => {
            const suffix = (index + 1).toString(16).padStart(12, '0');
            const episodeId = `77777777-7777-4777-8777-${suffix}`;
            return buildCompleteEpisode(episodeId, CLINIC_IDS[index % CLINIC_IDS.length]);
        }).flat();
        const snapshot = buildAMROutcomeNetworkSnapshot({
            siteEvents,
            episodeEvents,
            surveillanceEvidence: Array.from({ length: AMR_PILOT_TARGET_EPISODES }, (_, index) => {
                const suffix = (index + 1).toString(16).padStart(12, '0');
                const episodeId = `77777777-7777-4777-8777-${suffix}`;
                return {
                    id: episodeId,
                    pathogen_key: 'escherichia_coli',
                    drug_class: 'beta_lactam',
                    trend_bucket_key: 'canine:escherichia_coli:urinary_tract:beta_lactam',
                    lab_feed_status: 'one_health_export_ready',
                    resistance_signal_score: 0.72,
                    one_health_export_ready: true,
                    source_record_digest: digestFor(episodeId),
                    observed_at: '2026-07-06T00:00:00.000Z',
                };
            }),
            calibrationEvidence: [
                calibrationRow('88888888-8888-4888-8888-888888888881', 0.18, '2026-07-01T00:00:00.000Z'),
                calibrationRow('88888888-8888-4888-8888-888888888882', 0.09, '2026-07-22T00:00:00.000Z'),
            ],
            generatedAt: '2026-07-23T00:00:00.000Z',
        });

        expect(snapshot.pilot_status).toBe('evidence_ready');
        expect(snapshot.sites.operational_laboratories).toBe(1);
        expect(snapshot.sites.operational_clinics).toBe(3);
        expect(snapshot.episodes.outcome_confirmed).toBe(250);
        expect(snapshot.episodes.federation_eligible).toBe(250);
        expect(snapshot.federation_manifest.network_threshold_met).toBe(true);
        expect(snapshot.surveillance_proof).toMatchObject({
            status: 'evidence_ready',
            total_records: 250,
            outcome_linked_records: 250,
            one_health_export_ready_records: 250,
        });
        expect(snapshot.calibration_proof).toMatchObject({
            status: 'improved',
            baseline_ece: 0.18,
            current_ece: 0.09,
            ece_delta: -0.09,
        });
        expect(snapshot.proof_hash).toMatch(/^[a-f0-9]{64}$/);
    });
});

function buildSiteEvents(siteIds: string[]): AMRNetworkSiteEventRow[] {
    return siteIds.flatMap((siteId, siteIndex) => {
        const siteType = siteId === LAB_ID ? 'laboratory' : 'clinic';
        return [
            siteEvent(siteId, siteType, 'invited', siteIndex, 0),
            siteEvent(siteId, siteType, 'enrolled', siteIndex, 1),
            siteEvent(siteId, siteType, 'data_use_approved', siteIndex, 2),
            siteEvent(siteId, siteType, 'connector_verified', siteIndex, 3),
        ];
    });
}

function siteEvent(
    siteId: string,
    siteType: 'laboratory' | 'clinic',
    eventType: AMRNetworkSiteEventRow['event_type'],
    siteIndex: number,
    eventIndex: number,
): AMRNetworkSiteEventRow {
    return {
        tenant_id: TENANT_ID,
        site_id: siteId,
        site_type: siteType,
        event_type: eventType,
        display_label: `${siteType} ${siteIndex + 1}`,
        connector_key: `${siteType}.connector.v1`,
        occurred_at: `2026-07-${String(siteIndex + 1).padStart(2, '0')}T00:0${eventIndex}:00.000Z`,
    };
}

function buildCompleteEpisode(episodeId: string, clinicId: string): AMROutcomeEpisodeEventRow[] {
    const sourceDigest = digestFor(episodeId);
    const evidenceHash = digestFor(`${episodeId}e`);
    const common = {
        tenant_id: TENANT_ID,
        episode_id: episodeId,
        site_id: clinicId,
        lab_site_id: LAB_ID,
        species: 'canine',
        pathogen_key: 'escherichia_coli',
        drug_class: 'beta_lactam',
        consent_status: 'approved',
        is_synthetic: false,
        deidentified: true,
        source_record_digest: sourceDigest,
        evidence_packet_hash: evidenceHash,
        amr_stewardship_event_id: digestUuid(episodeId, 'a'),
        amr_lab_feed_event_id: episodeId,
    };
    return [
        { ...common, event_type: 'episode_opened', occurred_at: '2026-07-01T00:00:00.000Z' },
        { ...common, event_type: 'culture_received', occurred_at: '2026-07-02T00:00:00.000Z' },
        { ...common, event_type: 'ast_verified', occurred_at: '2026-07-03T00:00:00.000Z' },
        { ...common, event_type: 'treatment_recorded', occurred_at: '2026-07-04T00:00:00.000Z' },
        {
            ...common,
            event_type: 'clinical_review_completed',
            review_status: 'completed',
            occurred_at: '2026-07-05T00:00:00.000Z',
        },
        {
            ...common,
            event_type: 'outcome_confirmed',
            outcome_status: 'resolved',
            inference_event_id: '99999999-9999-4999-8999-999999999991',
            clinical_outcome_id: '99999999-9999-4999-8999-999999999992',
            occurred_at: '2026-07-06T00:00:00.000Z',
        },
        { ...common, event_type: 'episode_closed', occurred_at: '2026-07-07T00:00:00.000Z' },
    ];
}

function digestFor(value: string): string {
    return value.replaceAll('-', '').padEnd(64, 'a').slice(0, 64);
}

function digestUuid(value: string, suffix: string): string {
    return `${value.slice(0, -1)}${suffix}`;
}

function calibrationRow(runId: string, ece: number, createdAt: string) {
    return {
        calibration_run_id: runId,
        evidence_type: 'amr_culture_ast',
        outcome_label_count: AMR_PILOT_TARGET_EPISODES,
        expected_calibration_error: ece,
        brier_score: ece / 2,
        calibration_status: 'calibrated',
        created_at: createdAt,
    };
}
