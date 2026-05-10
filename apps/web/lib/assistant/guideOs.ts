import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAssistantRouteContext } from '@/lib/assistant/routeContext';
import type { GuideSynapseSignal, GuideSynapseState } from '@/lib/assistant/types';
import type { ExperimentDashboardSnapshot } from '@/lib/experiments/types';

export async function buildGuideSynapseContext(input: {
    client: SupabaseClient;
    tenantId: string;
    pathname: string;
}): Promise<GuideSynapseState> {
    const route = resolveAssistantRouteContext(input.pathname);

    if (route.key === 'experiments') {
        try {
            const [{ getExperimentDashboardSnapshot }, { createSupabaseExperimentTrackingStore }] = await Promise.all([
                import('@/lib/experiments/service'),
                import('@/lib/experiments/supabaseStore'),
            ]);
            const snapshot = await getExperimentDashboardSnapshot(
                createSupabaseExperimentTrackingStore(input.client),
                input.tenantId,
                { runLimit: 12, readOnly: true, lightweight: true },
            );
            return summarizeExperimentSynapse(snapshot);
        } catch (error) {
            return {
                status: 'degraded',
                route_key: route.key,
                title: 'Experiment Track Synapse',
                summary: 'GUIDE_OS could not load the live experiment snapshot, so it is operating from route playbooks only.',
                signals: [
                    { label: 'Route', value: route.title, tone: 'muted' },
                    { label: 'Snapshot', value: 'Unavailable', tone: 'danger' },
                ],
                warnings: [error instanceof Error ? error.message : 'Experiment context unavailable.'],
                next_actions: [
                    'Refresh Experiment Track and confirm the experiments tables are reachable.',
                    'Use bootstrap only for UI validation; use learning cycle telemetry for real evidence.',
                    'Check Settings and Telemetry if the experiments API is slow or failing.',
                ],
                generated_at: new Date().toISOString(),
            };
        }
    }

    return {
        status: 'active',
        route_key: route.key,
        title: `${route.title} Guide Synapse`,
        summary: route.summary,
        signals: [
            { label: 'Route', value: route.title, tone: 'accent' },
            { label: 'Goal', value: route.primary_goal, tone: 'muted' },
        ],
        warnings: [],
        next_actions: route.recommended_steps.slice(0, 3),
        generated_at: new Date().toISOString(),
    };
}

export function summarizeExperimentSynapse(snapshot: ExperimentDashboardSnapshot): GuideSynapseState {
    const summary = snapshot.summary;
    const warnings: string[] = [];
    const nextActions: string[] = [];

    if (summary.total_runs === 0) {
        warnings.push('No experiment runs are present for this tenant.');
        nextActions.push('Seed bootstrap runs only if you are validating the UI.');
        nextActions.push('Trigger a learning cycle when you need real experiment evidence.');
    }

    if (summary.failed_runs > 0) {
        warnings.push(`${summary.failed_runs} run(s) are failed and need review.`);
        nextActions.push('Filter failed runs and inspect the failure reason before comparing results.');
    }

    if (summary.total_runs > 0 && summary.telemetry_coverage_pct < 80) {
        warnings.push('Telemetry coverage is below the reproducibility target.');
        nextActions.push('Prefer runs with metric telemetry before drawing model conclusions.');
    }

    if (summary.total_runs > 0 && summary.registry_link_coverage_pct < 60) {
        warnings.push('Registry linkage is incomplete for many runs.');
        nextActions.push('Link strong runs to Model Registry before promotion review.');
    }

    if (summary.total_runs > 0 && summary.full_safety_metric_coverage_pct < 60) {
        warnings.push('Full safety metric coverage is incomplete.');
        nextActions.push('Review calibration, adversarial, and critical-recall evidence before promotion.');
    }

    if (summary.active_runs > 0) {
        nextActions.push('Watch active run heartbeat and progress before interpreting final metrics.');
    }

    if (nextActions.length === 0) {
        nextActions.push('Select comparable runs and inspect calibration, robustness, and registry evidence.');
        nextActions.push('Use comparison mode before treating a single metric as promotion-ready.');
        nextActions.push('Open Model Registry only after the run has enough reproducible evidence.');
    }

    const status: GuideSynapseState['status'] = summary.total_runs === 0
        ? 'idle'
        : warnings.length > 0
            ? 'degraded'
            : 'active';

    return {
        status,
        route_key: 'experiments',
        title: 'Experiment Track Synapse',
        summary: buildExperimentSynapseSummary(snapshot),
        signals: buildExperimentSignals(snapshot),
        warnings,
        next_actions: dedupe(nextActions).slice(0, 4),
        generated_at: new Date().toISOString(),
    };
}

function buildExperimentSynapseSummary(snapshot: ExperimentDashboardSnapshot) {
    const { summary } = snapshot;
    if (summary.total_runs === 0) {
        return 'GUIDE_OS is connected to Experiment Track, but no runs exist yet. Bootstrap can validate UI behavior; learning cycle telemetry is needed for real evidence.';
    }
    return `GUIDE_OS is connected to ${summary.total_runs} tracked run(s), with ${summary.active_runs} active, ${summary.failed_runs} failed, ${summary.telemetry_coverage_pct}% telemetry coverage, and ${summary.registry_link_coverage_pct}% registry linkage.`;
}

function buildExperimentSignals(snapshot: ExperimentDashboardSnapshot): GuideSynapseSignal[] {
    const { summary } = snapshot;
    return [
        { label: 'Runs', value: String(summary.total_runs), tone: summary.total_runs > 0 ? 'accent' : 'warning' },
        { label: 'Active', value: String(summary.active_runs), tone: summary.active_runs > 0 ? 'accent' : 'muted' },
        { label: 'Failed', value: String(summary.failed_runs), tone: summary.failed_runs > 0 ? 'danger' : 'muted' },
        { label: 'Telemetry', value: `${summary.telemetry_coverage_pct}%`, tone: coverageTone(summary.telemetry_coverage_pct) },
        { label: 'Registry', value: `${summary.registry_link_coverage_pct}%`, tone: coverageTone(summary.registry_link_coverage_pct) },
        { label: 'Full Safety', value: `${summary.full_safety_metric_coverage_pct}%`, tone: coverageTone(summary.full_safety_metric_coverage_pct) },
    ];
}

function coverageTone(value: number): GuideSynapseSignal['tone'] {
    if (value >= 80) return 'accent';
    if (value >= 50) return 'warning';
    return 'danger';
}

function dedupe(values: string[]) {
    return Array.from(new Set(values));
}
