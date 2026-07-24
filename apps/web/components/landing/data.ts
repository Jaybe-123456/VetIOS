import {
    Activity,
    Cpu,
    FileJson2,
    Orbit,
    RefreshCw,
    Workflow,
} from 'lucide-react';

export type LandingCodeLanguage = 'curl' | 'js' | 'python';

export const navigationItems = [
    { label: 'Ask VetIOS', href: '/ask-vetios' },
    { label: 'Architecture', href: '#architecture' },
    { label: 'Modules', href: '#modules' },
    { label: 'System', href: '#system' },
    { label: 'Docs', href: '/docs' },
    { label: 'Contact', href: 'mailto:johnbruce12g@gmail.com' },
] as const;

export const architectureNodes = [
    {
        title: 'Evidence Ingress',
        detail: 'De-identified clinical signals enter with consent scope, source lineage, and policy state attached.',
        icon: FileJson2,
    },
    {
        title: 'Traceable Inference',
        detail: 'Models produce ranked hypotheses with confidence bands, citations, runtime traces, and review gates.',
        icon: Cpu,
    },
    {
        title: 'Outcome Closure',
        detail: 'Diagnoses, treatments, follow-ups, labs, and specialist review return as scarce supervisory evidence.',
        icon: Activity,
    },
    {
        title: 'Federated Validation',
        detail: 'Partner nodes contribute only eligible, outcome-confirmed, provenance-scored evidence into learning rounds.',
        icon: Orbit,
    },
    {
        title: 'Promotion Gate',
        detail: 'Candidates advance only when benchmark, safety, drift, calibration, and rollback evidence clears governance.',
        icon: Workflow,
    },
] as const;

export const modules = [
    {
        title: 'Provenance Substrate',
        description:
            'Every usable learning record carries consent posture, source lineage, de-identification state, outcome linkage, and a trust score.',
        icon: FileJson2,
    },
    {
        title: 'Outcome Learning Plane',
        description:
            'Closed cases become governed supervision events only after clinician, lab, specialist, or follow-up confirmation is captured.',
        icon: RefreshCw,
    },
    {
        title: 'Federated Promotion Controls',
        description:
            'Partner-node updates, benchmark packets, model cards, rollout monitors, and rollback decisions stay tied to evidence hashes.',
        icon: Workflow,
    },
] as const;

export const stackBlocks = [
    'Next.js',
    'TypeScript',
    'Supabase',
    'Deterministic clinical inference core',
    'Event-driven architecture',
    'Vercel deployment',
] as const;

export const techStackDescriptions: Record<(typeof stackBlocks)[number], string> = {
    'Next.js': 'Public surface and operator console delivery',
    TypeScript: 'Typed application contracts across runtime boundaries',
    Supabase: 'Auth, session state, persistence, and event adjacency',
    'Deterministic clinical inference core': 'Versioned clinical rules with outcome calibration and optional provider augmentation',
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

export const heroCases = [
    {
        id: 'canine-vomiting',
        label: 'Dog with acute vomiting',
        species: 'canine',
        input:
            '3 year mixed-breed dog with acute vomiting, lethargy, dehydration, leukopenia, low PCV, and recent shelter exposure.',
        probabilities: [
            { label: 'canine_parvovirus', value: 0.82 },
            { label: 'hemorrhagic_gastroenteritis', value: 0.49 },
            { label: 'dietary_indiscretion', value: 0.21 },
        ],
        trace: [
            'signal.accepted case:canine_4XK3',
            'provenance.hash verified consent:network_learning',
            'normalizer.complete species:canine schema:v3',
            'retrieval.attach sources:4 lab_flags:2',
            'inference.rank parvovirus p=0.82',
            'guardrail.check outcome_required=true',
        ],
    },
    {
        id: 'feline-lethargy',
        label: 'Cat with chronic lethargy',
        species: 'feline',
        input:
            '11 year cat with weight loss, chronic lethargy, polyuria, mild dehydration, creatinine elevation, and low appetite.',
        probabilities: [
            { label: 'chronic_kidney_disease', value: 0.76 },
            { label: 'hyperthyroidism', value: 0.43 },
            { label: 'diabetes_mellitus', value: 0.28 },
        ],
        trace: [
            'signal.accepted case:feline_9QK2',
            'provenance.hash verified consent:network_learning',
            'normalizer.complete species:feline schema:v3',
            'lab.range.resolve creatinine:high',
            'inference.rank ckd p=0.76',
            'review.route internal_medicine',
        ],
    },
    {
        id: 'equine-colic',
        label: 'Equine acute colic',
        species: 'equine',
        input:
            '8 year gelding with acute colic, tachycardia, reduced gut sounds, reflux, abdominal pain, and worsening lactate.',
        probabilities: [
            { label: 'large_colon_volvulus', value: 0.68 },
            { label: 'small_intestinal_obstruction', value: 0.54 },
            { label: 'gas_colic', value: 0.31 },
        ],
        trace: [
            'signal.accepted case:equine_7LM1',
            'provenance.hash verified consent:network_learning',
            'triage.red_flag emergency_colic=true',
            'normalizer.complete species:equine schema:v3',
            'inference.rank volvulus p=0.68',
            'review.route emergency_veterinarian',
        ],
    },
] as const;

export const flywheelStages = [
    {
        title: 'Inference',
        left: '11%',
        top: '39%',
        detail: 'Every case starts as structured clinical context with traceable model output, confidence, citations, and review gates.',
        metric: 'ranked differential stream',
    },
    {
        title: 'Outcome',
        left: '36%',
        top: '11%',
        detail: 'Confirmed labels, treatments, follow-ups, and specialist decisions return as the scarce supervision layer.',
        metric: 'confirmed evidence loop',
    },
    {
        title: 'Simulation',
        left: '69%',
        top: '18%',
        detail: 'Candidate changes are replayed against prior cases and adversarial fixtures before promotion.',
        metric: 'regression pressure test',
    },
    {
        title: 'Improved Intelligence',
        left: '77%',
        top: '57%',
        detail: 'Only outcome-linked, provenance-scored evidence compounds into the next model and policy state.',
        metric: 'data moat reinforcement',
    },
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

export const interfaceTabs = [
    {
        id: 'json',
        label: 'JSON input',
        title: 'case.input.json',
        body: `{
  "model": { "name": "VetIOS Diagnostics", "version": "latest" },
  "input": {
    "input_signature": {
      "species": "canine",
      "symptoms": ["vomiting", "lethargy"],
      "metadata": {
        "labs": { "wbc": 4.1, "pcv": 29 },
        "hydration": "low"
      }
    }
  }
}`,
    },
    {
        id: 'python',
        label: 'Python SDK',
        title: 'python client',
        body: `from vetios import VetIOS

client = VetIOS(api_key="...")
result = client.inference.create(
    species="canine",
    symptoms=["vomiting", "lethargy"],
    metadata={"labs": {"wbc": 4.1, "pcv": 29}},
)
print(result.differentials[0])`,
    },
    {
        id: 'trace',
        label: 'Telemetry trace',
        title: 'runtime.trace',
        body: `span: runtime.inference
tenant: deidentified
schema: inference_request_v4
retrieval: veterinary_grounded
policy: reviewable
latency_ms: 218`,
    },
] as const;

/**
 * Shapes match Zod-validated Next.js routes (`lib/http/schemas.ts`).
 * Production REST under `api.vetios.tech/v1` may differ — see OpenAPI.
 */
export const endpointCards = [
    {
        method: 'POST',
        path: '/api/inference',
        languageSnippets: {
            curl: `curl -X POST https://api.vetios.tech/api/inference \\
  -H "Authorization: Bearer $VETIOS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d @case.input.json`,
            js: `const response = await fetch('/api/inference', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const result = await response.json();`,
            python: `import requests

result = requests.post(
    "https://api.vetios.tech/api/inference",
    headers={"Authorization": f"Bearer {api_key}"},
    json=payload,
).json()`,
        } satisfies Record<LandingCodeLanguage, string>,
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
        languageSnippets: {
            curl: `curl -X POST https://api.vetios.tech/api/outcome \\
  -H "Authorization: Bearer $VETIOS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d @outcome.json`,
            js: `await fetch('/api/outcome', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(outcomePayload),
});`,
            python: `requests.post(
    "https://api.vetios.tech/api/outcome",
    headers={"Authorization": f"Bearer {api_key}"},
    json=outcome_payload,
)`,
        } satisfies Record<LandingCodeLanguage, string>,
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
        languageSnippets: {
            curl: `curl -X POST https://api.vetios.tech/api/simulate \\
  -H "Authorization: Bearer $VETIOS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d @simulation.json`,
            js: `const simulation = await fetch('/api/simulate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(simulationPayload),
});`,
            python: `requests.post(
    "https://api.vetios.tech/api/simulate",
    headers={"Authorization": f"Bearer {api_key}"},
    json=simulation_payload,
)`,
        } satisfies Record<LandingCodeLanguage, string>,
        payload: `{
  "steps": 10,
  "mode": "adaptive",
  "base_case": {
    "species": "canine",
    "symptoms": ["vomiting", "lethargy"],
    "metadata": { "wbc": 4.1, "pcv": 29 }
  },
  "inference": { "model": "VetIOS Diagnostics", "model_version": "latest" }
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
    { label: 'About', href: '/about' },
    { label: 'Docs', href: '/docs' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Support', href: '/support' },
    { label: 'Contact', href: '/contact' },
] as const;

export const networkPoints = [
    { left: '8%', top: '58%', label: 'edge cluster', latency: '24 ms', load: '41%', models: '3 active' },
    { left: '21%', top: '35%', label: 'signal ingress', latency: '31 ms', load: '55%', models: 'events only' },
    { left: '38%', top: '44%', label: 'inference mesh', latency: '118 ms', load: '64%', models: 'diagnosis v1.27' },
    { left: '50%', top: '27%', label: 'control plane', latency: '42 ms', load: '29%', models: 'policy gate' },
    { left: '63%', top: '58%', label: 'simulation fabric', latency: '156 ms', load: '72%', models: 'replay queue' },
    { left: '79%', top: '38%', label: 'outcome stream', latency: '36 ms', load: '48%', models: 'label verifier' },
    { left: '90%', top: '54%', label: 'registry sync', latency: '52 ms', load: '33%', models: 'champion set' },
] as const;
