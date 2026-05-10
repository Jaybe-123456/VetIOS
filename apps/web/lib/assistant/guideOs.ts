import type { SupabaseClient } from '@supabase/supabase-js';
import {
    resolveAssistantRouteContext,
    type AssistantRouteContext,
} from '@/lib/assistant/routeContext';
import type { GuideSynapseSignal, GuideSynapseState } from '@/lib/assistant/types';
import type { ExperimentDashboardSnapshot } from '@/lib/experiments/types';

const MAX_GUIDE_PATHNAME_LENGTH = 200;

export async function buildGuideSynapseContext(input: {
    client: SupabaseClient;
    tenantId: string;
    pathname: string;
}): Promise<GuideSynapseState> {
    const route = resolveAssistantRouteContext(normalizeGuidePathname(input.pathname));

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
                warnings: ['Experiment context unavailable. Check the experiments service and server logs before trusting run comparisons.'],
                next_actions: [
                    'Refresh Experiment Track and confirm the experiments tables are reachable.',
                    'Use bootstrap only for UI validation; use learning cycle telemetry for real evidence.',
                    'Check Settings and Telemetry if the experiments API is slow or failing.',
                ],
                generated_at: new Date().toISOString(),
            };
        }
    }

    return buildRoutePlaybookSynapse(route);
}

export function normalizeGuidePathname(pathname: string | null | undefined): string {
    const raw = typeof pathname === 'string' ? pathname.trim() : '';
    if (!raw || raw.length > MAX_GUIDE_PATHNAME_LENGTH || !raw.startsWith('/') || raw.startsWith('//')) {
        return '/dashboard';
    }

    const withoutHash = raw.split('#')[0] ?? '';
    const pathOnly = withoutHash.split('?')[0] ?? '';
    if (!pathOnly || pathOnly === '/') {
        return '/dashboard';
    }

    return /^\/[A-Za-z0-9/_-]+$/.test(pathOnly) ? pathOnly : '/dashboard';
}

export function buildRoutePlaybookSynapse(route: AssistantRouteContext): GuideSynapseState {
    const profile = routeSynapseProfile(route.key);

    return {
        status: 'active',
        route_key: route.key,
        title: `${route.title} Synapse`,
        summary: `GUIDE_OS is active on ${route.title}. ${profile.summary}`,
        signals: [
            { label: 'Route', value: route.title, tone: 'accent' },
            { label: 'Mode', value: profile.mode, tone: 'accent' },
            { label: 'Feature Set', value: profile.featureSet, tone: 'muted' },
            { label: 'Guardrail', value: profile.guardrail, tone: profile.guardrailTone },
            { label: 'Prompts', value: String(route.starter_prompts.length), tone: 'muted' },
            { label: 'Actions', value: String(route.suggested_actions.length), tone: 'muted' },
        ],
        warnings: profile.warnings,
        next_actions: dedupe([...profile.nextActions, ...route.recommended_steps]).slice(0, 4),
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

function routeSynapseProfile(routeKey: string): {
    mode: string;
    featureSet: string;
    guardrail: string;
    guardrailTone: GuideSynapseSignal['tone'];
    summary: string;
    warnings: string[];
    nextActions: string[];
} {
    switch (routeKey) {
        case 'inference':
            return {
                mode: 'Clinical CDS',
                featureSet: 'Case workflow',
                guardrail: 'Clinician review',
                guardrailTone: 'warning',
                summary: 'It can guide case entry, normalized review, diagnostic output inspection, and handoff into ground-truth learning.',
                warnings: ['GUIDE_OS provides workflow guidance only; clinical conclusions must be verified by licensed clinician judgment and the inference output itself.'],
                nextActions: [
                    'Use structured input before free text when you need reliable downstream learning signals.',
                    'Verify diagnostic panels and differential rankings before attaching outcome feedback.',
                ],
            };
        case 'outcome-learning':
            return {
                mode: 'Ground truth',
                featureSet: 'Closed loop',
                guardrail: 'Event scoped',
                guardrailTone: 'accent',
                summary: 'It can guide confirmed outcome capture, calibration handoff, and reinforcement pipeline review without exposing unrelated tenant events.',
                warnings: [],
                nextActions: [
                    'Attach outcomes only to the matching inference event.',
                    'Review calibration and feedback state after saving ground truth.',
                ],
            };
        case 'simulate':
            return {
                mode: 'Stress lab',
                featureSet: 'Adversarial cases',
                guardrail: 'Synthetic label',
                guardrailTone: 'warning',
                summary: 'It can guide simulation setup, contradiction review, robustness inspection, and escalation into experiment evidence.',
                warnings: ['Simulation evidence must stay labeled as synthetic and should not be treated as live clinical ground truth.'],
                nextActions: [
                    'Define the failure mode before running a simulation.',
                    'Move meaningful failures into Experiment Track for reproducible comparison.',
                ],
            };
        case 'dataset':
            return {
                mode: 'Evidence intake',
                featureSet: 'Curation',
                guardrail: 'No record export',
                guardrailTone: 'accent',
                summary: 'It can guide dataset review, artifact curation, and readiness checks for experiments without dumping raw records into the assistant surface.',
                warnings: [],
                nextActions: [
                    'Check species, disease, and artifact coverage before training or comparison.',
                    'Use Experiment Track once the dataset slice is ready to evaluate.',
                ],
            };
        case 'models':
            return {
                mode: 'Governance',
                featureSet: 'Promotion',
                guardrail: 'Readiness gate',
                guardrailTone: 'warning',
                summary: 'It can guide lineage review, readiness interpretation, and telemetry follow-up before any model is treated as deployable.',
                warnings: ['GUIDE_OS cannot promote, deploy, or approve a model by conversation; operators must use governed registry controls.'],
                nextActions: [
                    'Trace the model artifact back to its producing experiment.',
                    'Confirm calibration, safety, and monitoring evidence before promotion review.',
                ],
            };
        case 'telemetry':
            return {
                mode: 'Observability',
                featureSet: 'Latency drift',
                guardrail: 'Read-only',
                guardrailTone: 'accent',
                summary: 'It can guide latency, drift, observer, and failure analysis while keeping system changes outside the assistant channel.',
                warnings: [],
                nextActions: [
                    'Classify the symptom as latency, drift, failure, or observer instability.',
                    'Resolve alerts through scoped telemetry controls rather than assistant text.',
                ],
            };
        case 'intelligence':
            return {
                mode: 'Topology',
                featureSet: 'Dependency graph',
                guardrail: 'Read-only',
                guardrailTone: 'accent',
                summary: 'It can guide graph interpretation, dependency tracing, and escalation into Dashboard or Telemetry for live confirmation.',
                warnings: [],
                nextActions: [
                    'Select the node or dependency you want to explain.',
                    'Validate suspected propagation paths against live telemetry before acting.',
                ],
            };
        case 'settings':
            return {
                mode: 'Admin control',
                featureSet: 'Access policy',
                guardrail: 'No secrets',
                guardrailTone: 'warning',
                summary: 'It can explain identity, credential, subsystem, and policy workflows while keeping raw credentials out of the guide channel.',
                warnings: ['GUIDE_OS never exposes raw JWTs, refresh tokens, API keys, or credential values. Do not paste secrets into guide messages.'],
                nextActions: [
                    'Confirm the target subsystem before changing settings.',
                    'Rotate or manage credentials only through scoped Settings controls.',
                ],
            };
        case 'dashboard':
        default:
            return {
                mode: 'Ops triage',
                featureSet: 'Health routing',
                guardrail: 'Read-only',
                guardrailTone: 'accent',
                summary: 'It can guide high-level health triage and route operators into the right specialist workspace.',
                warnings: [],
                nextActions: [
                    'Use Dashboard to choose the next workspace before opening deeper tooling.',
                    'Move to Telemetry or Network when health signals need investigation.',
                ],
            };
    }
}

function dedupe(values: string[]) {
    return Array.from(new Set(values));
}
