import { describe, expect, it } from 'vitest';

import {
  VeterinaryKnowledgeGraph,
  VKG_PHASE3_TARGETS,
} from '../veterinaryKnowledgeGraph';

describe('VeterinaryKnowledgeGraph phase 3 readiness', () => {
  it('reports the graph gap against the 50/200/500 target', () => {
    const vkg = new VeterinaryKnowledgeGraph();
    const report = vkg.getReadinessReport();

    expect(report.targets).toEqual(VKG_PHASE3_TARGETS);
    expect(report.counts.disease_nodes).toBeGreaterThan(0);
    expect(report.counts.symptom_nodes).toBeGreaterThan(0);
    expect(report.counts.weighted_edges).toBeGreaterThan(0);
    expect(report.counts.canine_disease_nodes).toBeGreaterThan(0);
    expect(report.counts.feline_disease_nodes).toBeGreaterThan(0);

    expect(report.missing.disease_nodes).toBe(
      Math.max(0, VKG_PHASE3_TARGETS.disease_nodes - report.counts.disease_nodes)
    );
    expect(report.missing.symptom_nodes).toBe(
      Math.max(0, VKG_PHASE3_TARGETS.symptom_nodes - report.counts.symptom_nodes)
    );
    expect(report.missing.weighted_edges).toBe(
      Math.max(0, VKG_PHASE3_TARGETS.weighted_edges - report.counts.weighted_edges)
    );

    expect(report.species_scope_ready).toBe(true);
    expect(report.graph_ready_for_gbs).toBe(true);
    expect(report.status).toBe('target_ready');
    expect(report.coverage.disease_nodes).toBe(1);
    expect(report.coverage.symptom_nodes).toBe(1);
    expect(report.coverage.weighted_edges).toBe(1);
  });
});
