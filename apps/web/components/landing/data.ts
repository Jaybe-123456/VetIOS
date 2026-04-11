import {
    Activity,
    Cpu,
    FileJson2,
    Orbit,
    RefreshCw,
    Workflow,
} from 'lucide-react';

export const navigationItems = [
    { label: 'Architecture', href: '#architecture' },
    { label: 'Modules', href: '#modules' },
    { label: 'System', href: '#system' },
    { label: 'Docs', href: '/platform/developers' },
] as const;

export const architectureNodes = [
    {
        title: 'Input',
        detail: 'Structured signals enter the platform with typed context, lineage, and policy state.',
        icon: FileJson2,
    },
    {
        title: 'Inference',
        detail: 'Models resolve ranked clinical hypotheses with confidence bands and runtime traces.',
        icon: Cpu,
    },
    {
        title: 'Outcome',
        detail: 'Resolved cases stream back as supervisory signals with auditable attribution.',
        icon: Activity,
    },
    {
        title: 'Simulation',
        detail: 'Counterfactual traffic is replayed before changes move into production control paths.',
        icon: Orbit,
    },
    {
        title: 'Intelligence',
        detail: 'The system compounds into a stronger shared decision layer with every completed loop.',
        icon: Workflow,
    },
] as const;

export const modules = [
    {
        title: 'Inference Engine',
        description:
            'Clinical inputs are normalized, routed, and scored through a deterministic inference runtime with operator-visible confidence signals.',
        icon: Cpu,
    },
    {
        title: 'Outcome Learning',
        description:
            'Closed cases become supervision events that refine priors, evaluation baselines, and future decision quality.',
        icon: RefreshCw,
    },
    {
        title: 'Simulation Layer',
        description:
            'New models and policy changes are pressure-tested against synthetic and replayed case traffic before rollout.',
        icon: Orbit,
    },
] as const;

export const stackBlocks = [
    'Next.js',
    'TypeScript',
    'Supabase',
    'OpenAI-compatible inference',
    'Event-driven architecture',
    'Vercel deployment',
] as const;

export const techStackDescriptions: Record<(typeof stackBlocks)[number], string> = {
    'Next.js': 'Public surface and operator console delivery',
    TypeScript: 'Typed application contracts across runtime boundaries',
    Supabase: 'Auth, session state, persistence, and event adjacency',
    'OpenAI-compatible inference': 'Model orchestration with provider portability',
    'Event-driven architecture': 'Outcome, simulation, and observability fanout',
    'Vercel deployment': 'Fast edge delivery for interface and control plane surfaces',
};

export const heroProbabilities = [
    { label: 'primary_hypothesis', value: '0.82' },
    { label: 'adjacent_pattern', value: '0.41' },
    { label: 'operator_holdout', value: '0.17' },
] as const;

export const runtimeEvents = [
    'signal.accepted  case_4XK3',
    'normalizer.complete  schema:v3',
    'inference.rank  model:inference-v1.27',
    'trace.persisted  latency:218ms',
] as const;

export const networkStats = [
    { label: 'control plane', value: 'distributed' },
    { label: 'event mesh', value: 'streaming' },
    { label: 'rollout mode', value: 'policy-gated' },
] as const;

export const systemMetrics = [
    { label: 'P95 latency', value: '218 ms' },
    { label: 'active traces', value: '18.4k' },
    { label: 'simulation queue', value: '024' },
    { label: 'model channel', value: 'v1.27' },
] as const;

export const interfaceLogs = [
    '18:42:11 signal.normalized   case_4XK3',
    '18:42:11 inference.completed dx.parvovirus p=0.82',
    '18:42:12 policy.checked      release.shadow=true',
    '18:42:12 outcome.channel     awaiting resolution',
    '18:42:13 metrics.flushed     span=runtime.inference',
] as const;

export const endpointCards = [
    {
        method: 'POST',
        path: '/api/inference',
        payload: `{
  "signal_id": "sig_49F2A8",
  "species": "canine",
  "symptoms": ["vomiting", "lethargy"],
  "labs": { "wbc": 4.1, "pcv": 29 }
}`,
        response: '{ "run_id": "run_9A2C", "status": "accepted", "mode": "ranked_inference" }',
    },
    {
        method: 'POST',
        path: '/api/outcome',
        payload: `{
  "case_id": "case_4XK3",
  "resolution": "confirmed",
  "label": "canine_parvovirus",
  "confidence": 0.98
}`,
        response: '{ "event_id": "evt_2841", "status": "recorded", "learning_window": "open" }',
    },
    {
        method: 'POST',
        path: '/api/simulate',
        payload: `{
  "model": "inference-v1.27",
  "scenario": "overlap_pressure",
  "runs": 512,
  "policy": "shadow"
}`,
        response: '{ "job_id": "sim_901A", "status": "queued", "estimated_seconds": 24 }',
    },
] as const;

export const footerLinks = [
    { label: 'Docs', href: '/platform/developers' },
    { label: 'Contact', href: 'mailto:platform@vetios.ai' },
] as const;

export const networkPoints = [
    { left: '8%', top: '58%', label: 'edge cluster' },
    { left: '21%', top: '35%', label: 'signal ingress' },
    { left: '38%', top: '44%', label: 'inference mesh' },
    { left: '50%', top: '27%', label: 'control plane' },
    { left: '63%', top: '58%', label: 'simulation fabric' },
    { left: '79%', top: '38%', label: 'outcome stream' },
    { left: '90%', top: '54%', label: 'registry sync' },
] as const;
