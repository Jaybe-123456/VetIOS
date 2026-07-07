import { describe, expect, it } from 'vitest';
import {
    buildGlobalOneHealthSeedMaterializationRows,
    recordGlobalOneHealthSeedMaterializationEvents,
} from '../globalOneHealthMaterializer';

describe('global One Health ontology seed materializer', () => {
    it('builds append-only seed rows without inventing external ontology codes', () => {
        const rows = buildGlobalOneHealthSeedMaterializationRows({
            tenantId: '00000000-0000-4000-8000-000000000001',
            requestId: 'one-health-seed-test',
            observedAt: '2026-07-06T00:00:00.000Z',
        });

        expect(rows.conditionRows.length).toBeGreaterThanOrEqual(12);
        expect(rows.sourceMappingRows.length).toBeGreaterThan(rows.conditionRows.length);
        expect(rows.edgeRows.length).toBeGreaterThan(rows.conditionRows.length);

        const avianInfluenza = rows.conditionRows.find((row) =>
            row.condition_key === 'highly_pathogenic_avian_influenza',
        );
        expect(avianInfluenza).toMatchObject({
            canonical_name: 'Highly pathogenic avian influenza',
            condition_domain: 'infectious',
            human_relevance: 'zoonotic',
        });
        expect(avianInfluenza?.source_manifest_hash).toMatch(/^[a-f0-9]{64}$/);

        expect(rows.sourceMappingRows.every((row) => row.external_code === null)).toBe(true);
        expect(rows.sourceMappingRows.every((row) => row.external_code_system === null)).toBe(true);
        expect(rows.sourceMappingRows.some((row) =>
            row.condition_key === 'highly_pathogenic_avian_influenza'
            && row.source_key === 'woah_wahis'
            && row.mapping_status === 'source_attested',
        )).toBe(true);

        expect(rows.edgeRows.some((row) =>
            row.source_condition_key === 'amr_enterobacterales_surveillance'
            && row.edge_type === 'amr_bridge',
        )).toBe(true);
        expect(rows.edgeRows.every((row) => /^[a-f0-9]{64}$/.test(String(row.source_manifest_hash)))).toBe(true);
    });

    it('submits seed materialization rows to all ontology evidence tables', async () => {
        const inserted: Record<string, Record<string, unknown>[]> = {};
        const client = {
            from(table: string) {
                return {
                    async insert(payload: Record<string, unknown>[]) {
                        inserted[table] = payload;
                        return { error: null };
                    },
                };
            },
        };

        const result = await recordGlobalOneHealthSeedMaterializationEvents(client, {
            requestId: 'one-health-seed-submit-test',
        });

        expect(result.error).toBeNull();
        expect(result.conditionRows).toBe(inserted.global_health_condition_ontology_events.length);
        expect(result.sourceMappingRows).toBe(inserted.global_condition_source_mapping_events.length);
        expect(result.edgeRows).toBe(inserted.one_health_condition_edge_events.length);
        expect(Object.keys(inserted).sort()).toEqual([
            'global_condition_source_mapping_events',
            'global_health_condition_ontology_events',
            'one_health_condition_edge_events',
        ]);
    });
});
