import { describe, expect, it } from 'vitest';
import {
    buildRoutePlaybookSynapse,
    normalizeGuidePathname,
    summarizeExperimentSynapse,
} from '../guideOs';
import { listAssistantRouteContexts } from '../routeContext';
import type { ExperimentDashboardSnapshot } from '@/lib/experiments/types';

describe('GUIDE_OS synapse context', () => {
    it('builds route-aware playbook synapse for every GUIDE_OS route', () => {
        for (const route of listAssistantRouteContexts()) {
            const synapse = buildRoutePlaybookSynapse(route);

            expect(synapse.route_key).toBe(route.key);
            expect(synapse.signals.length).toBeGreaterThanOrEqual(4);
            expect(synapse.signals.some((signal) => signal.label === 'Guardrail')).toBe(true);
            expect(synapse.next_actions.length).toBeGreaterThan(0);
        }
    });

    it('hardens guide pathname routing before synapse lookup', () => {
        expect(normalizeGuidePathname('/settings/developer-platform?tab=tokens')).toBe('/settings/developer-platform');
        expect(normalizeGuidePathname('//evil.example/settings')).toBe('/dashboard');
        expect(normalizeGuidePathname('https://evil.example/settings')).toBe('/dashboard');
        expect(normalizeGuidePathname('/settings/../../api')).toBe('/dashboard');
    });

    it('keeps Settings synapse credential-safe', () => {
        const settings = listAssistantRouteContexts().find((route) => route.key === 'settings');
        expect(settings).toBeDefined();

        const synapse = buildRoutePlaybookSynapse(settings!);

        expect(synapse.signals.find((signal) => signal.label === 'Guardrail')?.value).toBe('No secrets');
        expect(synapse.warnings.join(' ')).toContain('never exposes raw JWTs');
    });

    it('marks Experiment Track idle when no runs exist', () => {
        const synapse = summarizeExperimentSynapse(mockSnapshot({
            total_runs: 0,
            active_runs: 0,
            failed_runs: 0,
            telemetry_coverage_pct: 0,
            registry_link_coverage_pct: 0,
            full_safety_metric_coverage_pct: 0,
        }));

        expect(synapse.status).toBe('idle');
        expect(synapse.warnings).toContain('No experiment runs are present for this tenant.');
        expect(synapse.next_actions[0]).toContain('Seed bootstrap');
    });

    it('surfaces degraded experiment evidence when coverage is incomplete', () => {
        const synapse = summarizeExperimentSynapse(mockSnapshot({
            total_runs: 8,
            active_runs: 1,
            failed_runs: 2,
            telemetry_coverage_pct: 45,
            registry_link_coverage_pct: 25,
            full_safety_metric_coverage_pct: 30,
        }));

        expect(synapse.status).toBe('degraded');
        expect(synapse.signals.find((signal) => signal.label === 'Failed')?.tone).toBe('danger');
        expect(synapse.warnings.length).toBeGreaterThanOrEqual(3);
    });
});

function mockSnapshot(summaryPatch: Partial<ExperimentDashboardSnapshot['summary']>): ExperimentDashboardSnapshot {
    return {
        tenant_id: 'tenant-1',
        summary: {
            total_runs: 0,
            active_runs: 0,
            failed_runs: 0,
            summary_only_runs: 0,
            telemetry_coverage_pct: 0,
            registry_link_coverage_pct: 0,
            safety_metric_coverage_pct: 0,
            full_safety_metric_coverage_pct: 0,
            failed_run_ids: [],
            active_run_ids: [],
            ...summaryPatch,
        },
        runs: [],
        selected_run_id: null,
        selected_run_detail: null,
        comparison: null,
        refreshed_at: new Date(0).toISOString(),
    } as ExperimentDashboardSnapshot;
}
