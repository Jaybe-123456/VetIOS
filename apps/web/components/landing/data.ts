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
    { label: 'Docs', href: '/docs' },
    { label: 'Contact', href: 'mailto:johnbruce12g@gmail.com' },
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
    { label: 'P95 latency (illustrative)', value: '218 ms' },
    { label: 'active traces (illustrative)', value: '18.4k' },
    { label: 'simulation queue (illustrative)', value: '024' },
    { label: 'model channel (illustrative)', value: 'v1.27' },
] as const;

export const interfaceLogs = [
    '18:42:11 signal.normalized   case_4XK3',
    '18:42:11 inference.completed dx.parvovirus p=0.82',
    '18:42:12 policy.checked      release.shadow=true',
    '18:42:12 outcome.channel     awaiting resolution',
    '18:42:13 metrics.flushed     span=runtime.inference',
] as const;

/**
 * Shapes match Zod-validated Next.js routes (`lib/http/schemas.ts`).
 * Production REST under `api.vetios.tech/v1` may differ — see OpenAPI.
 */
export const endpointCards = [
    {
        method: 'POST',
        path: '/api/inference',
        payload: `{
  "model": { "name": "VetIOS Diagnostics", "version": "latest" },
  "input": {
    "input_signature": {
      "species": "canine",
      "breed": "mixed",
      "symptoms": ["vomiting", "lethargy"],
      "metadata": { "age_years": 3, "labs": { "wbc": 4.1, "pcv": 29 } }
    }
  }
}`,
        response: `{
  "inference_event_id": "9f2c1b6a-…",
  "data": { "confidence_score": 0.82, "differentials": [ … ] },
  "cire": { "phi_hat": 0.71, "cps": 0.12, "safety_state": "nominal" },
  "meta": { "tenant_id": "…", "request_id": "…" },
  "error": null
}`,
    },
    {
        method: 'POST',
        path: '/api/outcome',
        payload: `{
  "inference_event_id": "11111111-1111-4111-8111-111111111111",
  "outcome": {
    "type": "confirmed_diagnosis",
    "payload": {
      "label": "canine_parvovirus",
      "confidence": 0.98
    },
    "timestamp": "2026-04-14T12:00:00.000Z"
  }
}`,
        response: `{
  "outcome_event_id": "evt_2841…",
  "clinical_case_id": "case_4XK3…",
  "linked_inference_event_id": "11111111-1111-4111-8111-111111111111",
  "request_id": "…"
}`,
    },
    {
        method: 'POST',
        path: '/api/simulate',
        payload: `{
  "steps": 10,
  "mode": "adaptive",
  "base_case": {
    "species": "canine",
    "symptoms": ["vomiting", "lethargy"],
    "metadata": { "wbc": 4.1, "pcv": 29 }
  },
  "inference": { "model": "gpt-4o-mini", "model_version": "gpt-4o-mini" }
}`,
        response: `{
  "simulation_event_id": "sim_901A…",
  "clinical_case_id": "…",
  "stability_report": { … },
  "request_id": "…"
}`,
    },
] as const;

export const footerLinks = [
    { label: 'Docs', href: '/platform' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Support', href: 'mailto:johnbruce12g@gmail.com' },
    { label: 'Contact', href: 'mailto:platform@vetios.tech' },
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
