import { describe, expect, it } from 'vitest';
import { buildStrategicRailsPacket } from '../strategicRails';

describe('strategic infrastructure rails', () => {
    it('connects VetIOS modules into one substrate map with honest missing-build proof', () => {
        const packet = buildStrategicRailsPacket({
            generatedAt: '2026-07-11T00:00:00.000Z',
        });

        expect(packet.schema_version).toBe('vetios_strategic_rails_v1');
        expect(packet.generated_at).toBe('2026-07-11T00:00:00.000Z');
        expect(packet.thesis.what_vetios_should_become).toContain('veterinary and One Health intelligence substrate');
        expect(packet.posture.rail_count).toBe(packet.rails.length);
        expect(packet.posture.partial).toBeGreaterThanOrEqual(4);
        expect(packet.posture.highest_priority_missing).toEqual(expect.arrayContaining([
            'production_pims_lab_pacs_connectors',
            'verified_global_ontology_population',
            'production_secure_aggregation_materialization',
            'compute_routing_metering_and_policy',
        ]));

        const railKeys = packet.rails.map((rail) => rail.key);
        expect(railKeys).toEqual(expect.arrayContaining([
            'daily_clinical_workflow_embed',
            'clinical_inference_and_cire',
            'global_one_health_ontology',
            'partner_node_federation',
            'secure_aggregation_protocol',
            'compute_routing_market_rail',
            'moat_evidence_control_plane',
        ]));
    });

    it('keeps operational claims tied to proof requirements instead of feature existence alone', () => {
        const packet = buildStrategicRailsPacket({
            generatedAt: '2026-07-11T00:00:00.000Z',
        });

        for (const rail of packet.rails) {
            expect(rail.connected_modules.length).toBeGreaterThan(0);
            expect(rail.lock_in_mechanism.length).toBeGreaterThan(20);
            expect(rail.compute_policy.length).toBeGreaterThan(20);
            expect(rail.proof_required.length).toBeGreaterThan(0);
            if (rail.status !== 'operational') {
                expect(rail.still_missing.length).toBeGreaterThan(0);
                expect(rail.next_builds.length).toBeGreaterThan(0);
            }
        }

        const computeEdge = packet.module_graph_edges.find((edge) => edge.to === 'compute_routing_market_rail');
        expect(computeEdge?.from).toBe('decision_rails');
        expect(packet.build_sequence[0]?.phase).toBe('P0 daily operating wedge');
        expect(packet.source_alignment.map((entry) => entry.source)).toEqual(expect.arrayContaining([
            'FDA Good Machine Learning Practice and PCCP guidance',
            'WHO AI for health and large multi-modal model guidance',
            'Compute-market infrastructure trend',
        ]));
    });
});
