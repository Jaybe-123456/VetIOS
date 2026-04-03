import type { AssistantAction, AssistantRouteSummary } from '@/lib/assistant/types';

export interface AssistantRouteContext extends AssistantRouteSummary {
    matchers: string[];
    keywords: string[];
    primary_goal: string;
    recommended_steps: string[];
    starter_prompts: string[];
    suggested_actions: AssistantAction[];
}

interface OnboardingRouteDefinition {
    title: string;
    href: string;
}

const ONBOARDING_ROUTE_ORDER: OnboardingRouteDefinition[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Inference Console', href: '/inference' },
    { title: 'Clinical Dataset', href: '/dataset' },
    { title: 'Experiment Track', href: '/experiments' },
    { title: 'Model Registry', href: '/models' },
    { title: 'Telemetry', href: '/telemetry' },
    { title: 'Settings', href: '/settings' },
];

const ASSISTANT_ROUTE_CONTEXTS: AssistantRouteContext[] = [
    {
        key: 'dashboard',
        title: 'Dashboard',
        href: '/dashboard',
        summary: 'The dashboard is the operational pulse of VetIOS. It tells a new operator what is healthy, what is failing, and where to go next.',
        matchers: ['/dashboard'],
        keywords: ['dashboard', 'overview', 'status', 'control plane', 'monitoring', 'operations'],
        primary_goal: 'Understand system state before opening a specialist workflow.',
        recommended_steps: [
            'Scan the top-level health cards and identify any failing control-plane or telemetry signal.',
            'Use the summary to choose the next workspace instead of guessing from the full navigation tree.',
            'Drill into Telemetry or Network only after you know what anomaly you are investigating.',
        ],
        starter_prompts: [
            'Explain what I should pay attention to on the dashboard.',
            'What should a new operator do after landing here?',
            'Which page should I open next for system issues?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Explain This Page', description: 'Get a plain-language summary of the dashboard.', prompt: 'Explain this page for a new user.' },
            { type: 'navigate', label: 'Open Telemetry', description: 'Investigate latency, drift, and observer state.', href: '/telemetry' },
            { type: 'navigate', label: 'Open Inference', description: 'Run a first clinical workflow end to end.', href: '/inference' },
        ],
    },
    {
        key: 'inference',
        title: 'Inference Console',
        href: '/inference',
        summary: 'Inference Console is where a new user turns a case input into a structured model result, then hands that result into downstream review and learning loops.',
        matchers: ['/inference'],
        keywords: ['inference', 'diagnosis', 'case', 'triage', 'prediction', 'clinical input', 'run model'],
        primary_goal: 'Run a first case successfully and understand what to do with the output.',
        recommended_steps: [
            'Start with the structured input mode so the system can normalize species, breed, symptoms, and metadata cleanly.',
            'Review the normalized preview before submitting so the first result is trustworthy.',
            'After inference completes, inspect vectors and diagnostics, then attach ground truth when a confirmed outcome exists.',
        ],
        starter_prompts: [
            'Explain the fastest way to run my first inference.',
            'What happens after I confirm the normalized preview?',
            'What should I do after I get a result?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Run My First Case', description: 'Get a guided walkthrough for the first inference.', prompt: 'Guide me through my first inference run step by step.' },
            { type: 'navigate', label: 'Open Dataset', description: 'Review the cases and artifacts feeding model work.', href: '/dataset' },
            { type: 'navigate', label: 'Open Outcome Learning', description: 'See how confirmed outcomes feed back into performance improvement.', href: '/outcome' },
        ],
    },
    {
        key: 'outcome-learning',
        title: 'Outcome Learning',
        href: '/outcome',
        summary: 'Outcome Learning closes the loop between a model prediction and what actually happened in the clinic so the system can learn from reality instead of only from synthetic benchmarks.',
        matchers: ['/outcome'],
        keywords: ['outcome', 'learning', 'feedback', 'ground truth', 'post hoc', 'actual diagnosis'],
        primary_goal: 'Connect predictions to confirmed clinical outcomes.',
        recommended_steps: [
            'Locate the relevant episode or inference event before entering outcome data.',
            'Attach confirmed diagnoses and notes so calibration and learning signals stay useful.',
            'Review whether the event should feed experiments, telemetry, or model governance next.',
        ],
        starter_prompts: [
            'Explain how outcome learning fits after inference.',
            'What data matters most on this page?',
            'What should I review before confirming ground truth?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Explain The Loop', description: 'Understand how outcomes improve the system.', prompt: 'Explain how inference, outcome learning, and experiments connect.' },
            { type: 'navigate', label: 'Open Inference', description: 'Return to the case generation workflow.', href: '/inference' },
            { type: 'navigate', label: 'Open Experiments', description: 'See how outcome evidence affects reproducible evaluation.', href: '/experiments' },
        ],
    },
    {
        key: 'simulate',
        title: 'Adversarial Sim',
        href: '/simulate',
        summary: 'Adversarial Sim is where VetIOS stress-tests models against difficult, noisy, or contradictory cases before those patterns damage real clinical performance.',
        matchers: ['/simulate'],
        keywords: ['simulate', 'simulation', 'adversarial', 'stress test', 'failure mode', 'robustness'],
        primary_goal: 'Probe model behavior under risky or unusual conditions.',
        recommended_steps: [
            'Choose a scenario that reflects a real failure mode you want to understand.',
            'Run the simulation and inspect how the prediction changes under perturbation.',
            'Push important findings into experiments or model governance so the result is actionable.',
        ],
        starter_prompts: [
            'How should a new user use adversarial simulation?',
            'What kinds of failures should I test here first?',
            'What do I do with a failed simulation result?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Plan A Stress Test', description: 'Get a first simulation workflow.', prompt: 'Suggest a first adversarial simulation workflow for a new operator.' },
            { type: 'navigate', label: 'Open Experiments', description: 'Compare simulation outputs against tracked runs.', href: '/experiments' },
            { type: 'navigate', label: 'Open Models', description: 'Review the impacted model family and version lineage.', href: '/models' },
        ],
    },
    {
        key: 'dataset',
        title: 'Clinical Dataset',
        href: '/dataset',
        summary: 'Clinical Dataset is the intake and review surface for cases, artifacts, and training evidence. It helps new users understand what data exists before they train or compare anything.',
        matchers: ['/dataset'],
        keywords: ['dataset', 'data', 'cases', 'clinical dataset', 'uploads', 'artifacts', 'records'],
        primary_goal: 'Inspect and curate the evidence base behind downstream workflows.',
        recommended_steps: [
            'Review what cases and documents are already available before adding more data.',
            'Check whether the dataset slice you need is complete enough for experiments or comparisons.',
            'Move into Experiment Track when you are ready to evaluate a dataset-backed run.',
        ],
        starter_prompts: [
            'Explain how I should use the dataset page first.',
            'How do dataset records feed experiments?',
            'What should I check before training or comparing a model?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Explain Dataset Workflow', description: 'Get a new-user overview of dataset curation.', prompt: 'Explain how dataset review feeds experiments and models.' },
            { type: 'navigate', label: 'Open Experiments', description: 'Turn dataset versions into tracked runs.', href: '/experiments' },
            { type: 'navigate', label: 'Open Models', description: 'Review promoted artifacts that came from those runs.', href: '/models' },
        ],
    },
    {
        key: 'experiments',
        title: 'Experiment Track',
        href: '/experiments',
        summary: 'Experiment Track is the reproducible AI research stack inside VetIOS. It records dataset versions, hyperparameters, model lineage, and comparisons so results can be rerun and verified.',
        matchers: ['/experiments'],
        keywords: ['experiments', 'experiment track', 'runs', 'benchmark', 'compare', 'reproducible', 'research'],
        primary_goal: 'Create, inspect, and compare reproducible runs.',
        recommended_steps: [
            'Filter or select a run family so you are comparing like with like.',
            'Inspect run details, calibration, and robustness before treating a result as promotion-ready.',
            'Use the comparison and registry links to move strong runs into governance and deployment review.',
        ],
        starter_prompts: [
            'Explain why Experiment Track is called a reproducible AI research stack.',
            'How do I compare runs as a new user?',
            'What should I review before promoting a result?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Explain Reproducibility', description: 'Understand how published results stay verifiable.', prompt: 'Explain how dataset versions, hyperparameters, and model lineage work together here.' },
            { type: 'navigate', label: 'Open Model Registry', description: 'Review artifacts produced by tracked runs.', href: '/models' },
            { type: 'navigate', label: 'Open Dataset', description: 'Trace a run back to its source evidence.', href: '/dataset' },
        ],
    },
    {
        key: 'models',
        title: 'Model Registry',
        href: '/models',
        summary: 'Model Registry is where VetIOS turns experiment outputs into governed model artifacts with version lineage, readiness signals, and auditability.',
        matchers: ['/models'],
        keywords: ['model', 'registry', 'artifacts', 'promotion', 'version', 'governance', 'deployment'],
        primary_goal: 'Understand which model version is trusted for downstream use.',
        recommended_steps: [
            'Inspect lineage so you know which experiment produced the artifact you are reviewing.',
            'Check governance and readiness signals before assuming a model can be promoted.',
            'Use settings or telemetry next if you need operational or policy context around deployment.',
        ],
        starter_prompts: [
            'Explain how to read model lineage on this page.',
            'What makes a model ready for promotion here?',
            'How does Model Registry connect to Experiment Track?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Explain Promotion Readiness', description: 'Get a plain-language walkthrough of registry decisions.', prompt: 'Explain what a new user should verify before trusting a model version.' },
            { type: 'navigate', label: 'Open Experiments', description: 'Trace the registry artifact back to its originating run.', href: '/experiments' },
            { type: 'navigate', label: 'Open Telemetry', description: 'Check how deployed models are behaving in operation.', href: '/telemetry' },
        ],
    },
    {
        key: 'telemetry',
        title: 'Telemetry',
        href: '/telemetry',
        summary: 'Telemetry translates raw operational signals into understandable model, system, and observer behavior so operators can catch drift, latency, and failures early.',
        matchers: ['/telemetry'],
        keywords: ['telemetry', 'latency', 'drift', 'observer', 'metrics', 'monitoring', 'logs'],
        primary_goal: 'Identify whether the system is behaving safely and consistently.',
        recommended_steps: [
            'Start with latency, drift, and observer state to understand whether the issue is model-side or system-side.',
            'Use the log stream and failure telemetry to isolate patterns before escalating.',
            'Move back to models or dashboard once you know the source of the issue.',
        ],
        starter_prompts: [
            'Explain how a new operator should read this telemetry page.',
            'What should I inspect first if the system feels unhealthy?',
            'When should I switch from Telemetry back to the Dashboard or Models?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Explain Telemetry', description: 'Translate the charts and observer state into plain English.', prompt: 'Explain the key telemetry panels in plain language.' },
            { type: 'navigate', label: 'Open Dashboard', description: 'Return to the control-plane overview.', href: '/dashboard' },
            { type: 'navigate', label: 'Open Model Registry', description: 'Investigate a model-specific issue from telemetry.', href: '/models' },
        ],
    },
    {
        key: 'intelligence',
        title: 'Network',
        href: '/intelligence',
        summary: 'Network shows the intelligence topology across models, flows, and dependencies so operators can see how one part of VetIOS affects another.',
        matchers: ['/intelligence'],
        keywords: ['network', 'intelligence', 'topology', 'graph', 'dependencies', 'flows'],
        primary_goal: 'Understand how operational dependencies connect across the platform.',
        recommended_steps: [
            'Select a node or edge only after deciding what dependency you are trying to understand.',
            'Use topology context to explain why a failure propagates, not only where it appears.',
            'Jump back to Dashboard or Telemetry when you need live operational confirmation.',
        ],
        starter_prompts: [
            'Explain how to read the network graph as a new user.',
            'What kinds of questions should I answer with the topology view?',
            'When should I use Network instead of Telemetry?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Explain Topology', description: 'Get a new-user walkthrough of the network view.', prompt: 'Explain how to read nodes, edges, and the operational panel.' },
            { type: 'navigate', label: 'Open Dashboard', description: 'Return to the main control-plane summary.', href: '/dashboard' },
            { type: 'navigate', label: 'Open Telemetry', description: 'Validate topology issues with live measurements.', href: '/telemetry' },
        ],
    },
    {
        key: 'settings',
        title: 'Settings',
        href: '/settings',
        summary: 'Settings is the administrative control plane for identity, credentials, policy, infrastructure controls, and platform operations.',
        matchers: ['/settings', '/settings/petpass', '/settings/federation', '/settings/edge-box', '/settings/model-trust', '/settings/developer-platform', '/settings/outbox'],
        keywords: ['settings', 'admin', 'permissions', 'credentials', 'petpass', 'federation', 'edge box', 'model trust', 'developer platform', 'outbox'],
        primary_goal: 'Manage access, control-plane configuration, and operational subsystems safely.',
        recommended_steps: [
            'Confirm which operational subsystem you are changing before making any control-plane update.',
            'Review session, permissions, and active runtime context before rotating keys or changing policies.',
            'Use subsystem pages like PetPass or Federation only when you know the specific workflow you are operating.',
        ],
        starter_prompts: [
            'Explain what belongs in Settings versus the other console pages.',
            'What should a new admin verify before changing anything here?',
            'Which settings area should I use for partner, federation, or PetPass work?',
        ],
        suggested_actions: [
            { type: 'prompt', label: 'Explain Settings', description: 'Get a guided tour of the control plane.', prompt: 'Explain the main areas of Settings for a new operator.' },
            { type: 'navigate', label: 'Open PetPass Ops', description: 'Provision owner, pet, consent, and notification records.', href: '/settings/petpass' },
            { type: 'navigate', label: 'Open Developer Platform', description: 'Manage partner onboarding and machine credentials.', href: '/settings/developer-platform' },
        ],
    },
];

export function listAssistantRouteContexts(): AssistantRouteContext[] {
    return ASSISTANT_ROUTE_CONTEXTS;
}

export function resolveAssistantRouteContext(pathname: string | null | undefined): AssistantRouteContext {
    const normalizedPath = normalizePath(pathname);
    const match = [...ASSISTANT_ROUTE_CONTEXTS]
        .sort((left, right) => longestMatcher(right).length - longestMatcher(left).length)
        .find((candidate) => candidate.matchers.some((matcher) => matchesPrefix(normalizedPath, matcher)));

    return match ?? ASSISTANT_ROUTE_CONTEXTS[0];
}

export function getAssistantOnboardingProgress(pathnames: string[]): {
    visitedCount: number;
    totalCount: number;
    nextRoute: OnboardingRouteDefinition | null;
} {
    const visitedPrefixes = new Set(
        pathnames
            .map((pathname) => resolveAssistantRouteContext(pathname).href),
    );

    const nextRoute = ONBOARDING_ROUTE_ORDER.find((route) => !visitedPrefixes.has(route.href)) ?? null;

    return {
        visitedCount: ONBOARDING_ROUTE_ORDER.filter((route) => visitedPrefixes.has(route.href)).length,
        totalCount: ONBOARDING_ROUTE_ORDER.length,
        nextRoute,
    };
}

export function searchRelevantAssistantRoutes(query: string, limit = 3): AssistantRouteContext[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return [];
    }

    return ASSISTANT_ROUTE_CONTEXTS
        .map((route) => ({
            route,
            score: scoreRoute(route, normalized),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((candidate) => candidate.route);
}

function scoreRoute(route: AssistantRouteContext, query: string): number {
    let score = 0;

    for (const keyword of route.keywords) {
        if (query.includes(keyword)) {
            score += keyword.includes(' ') ? 4 : 2;
        }
    }

    if (query.includes(route.title.toLowerCase())) {
        score += 5;
    }

    if (query.includes(route.key.replace(/-/g, ' '))) {
        score += 3;
    }

    return score;
}

function longestMatcher(route: AssistantRouteContext): string {
    return route.matchers.reduce((longest, current) => current.length > longest.length ? current : longest, route.matchers[0] ?? route.href);
}

function matchesPrefix(pathname: string, matcher: string): boolean {
    return pathname === matcher || pathname.startsWith(`${matcher}/`);
}

function normalizePath(pathname: string | null | undefined): string {
    if (!pathname || !pathname.startsWith('/')) {
        return '/dashboard';
    }

    return pathname === '/' ? '/dashboard' : pathname;
}
