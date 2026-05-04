import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicPageShell } from '@/components/public/PublicPageShell';

export const metadata: Metadata = {
    title: 'Documentation — VetIOS',
    description: 'API reference, integration guides, and platform documentation for VetIOS.',
};

const endpoints = [
    {
        method: 'POST',
        path: '/api/inference',
        badge: 'Core',
        summary: 'Submit a clinical case for AI-assisted differential diagnosis. Returns ranked hypotheses with confidence scores, CIRE signals, and a traceable inference event ID.',
        request: `{
  "model": { "name": "VetIOS Diagnostics", "version": "latest" },
  "input": {
    "input_signature": {
      "species": "canine",
      "breed": "mixed",
      "symptoms": ["vomiting", "lethargy"],
      "metadata": {
        "age_years": 3,
        "labs": { "wbc": 4.1, "pcv": 29 }
      }
    }
  }
}`,
        response: `{
  "inference_event_id": "9f2c1b6a-...",
  "data": {
    "confidence_score": 0.82,
    "differentials": [
      { "label": "canine_parvovirus", "p": 0.82 },
      { "label": "hemorrhagic_gastroenteritis", "p": 0.41 }
    ]
  },
  "cire": { "phi_hat": 0.71, "cps": 0.12, "safety_state": "nominal" },
  "meta": { "tenant_id": "...", "request_id": "..." },
  "error": null
}`,
    },
    {
        method: 'POST',
        path: '/api/outcome',
        badge: 'Learning',
        summary: 'Submit a confirmed outcome for a resolved case. Outcome events are used by the closed-loop learning layer to refine inference priors within your tenant.',
        request: `{
  "inference_event_id": "9f2c1b6a-...",
  "outcome": {
    "type": "confirmed_diagnosis",
    "payload": {
      "label": "canine_parvovirus",
      "confidence": 0.98
    },
    "timestamp": "2026-05-04T12:00:00.000Z"
  }
}`,
        response: `{
  "outcome_event_id": "evt_2841...",
  "clinical_case_id": "case_4XK3...",
  "linked_inference_event_id": "9f2c1b6a-...",
  "request_id": "..."
}`,
    },
    {
        method: 'POST',
        path: '/api/simulate',
        badge: 'Simulation',
        summary: 'Run a synthetic simulation against a base case to pressure-test model behaviour before rollout. Returns a stability report and simulation trace.',
        request: `{
  "steps": 10,
  "mode": "adaptive",
  "base_case": {
    "species": "canine",
    "symptoms": ["vomiting", "lethargy"],
    "metadata": { "wbc": 4.1, "pcv": 29 }
  },
  "inference": {
    "model": "gpt-4o-mini",
    "model_version": "gpt-4o-mini"
  }
}`,
        response: `{
  "simulation_event_id": "sim_901A...",
  "clinical_case_id": "...",
  "stability_report": {
    "passes": 9,
    "failures": 1,
    "mean_confidence": 0.79
  },
  "request_id": "..."
}`,
    },
];

const concepts = [
    {
        title: 'Inference Engine',
        description: 'The core runtime that normalises clinical inputs, routes them through the model layer, and returns ranked differential hypotheses with confidence scores and CIRE signals.',
        tags: ['input normalisation', 'model routing', 'ranked output'],
    },
    {
        title: 'CIRE Signals',
        description: 'Clinical Inference Reliability Estimation. Each inference response includes phi_hat (hypothesis confidence), cps (calibration pressure score), and safety_state — giving operators visibility into output reliability.',
        tags: ['phi_hat', 'cps', 'safety_state'],
    },
    {
        title: 'Outcome Learning',
        description: 'Closed cases submitted via /api/outcome become supervision events. The learning layer uses confirmed diagnoses to refine inference priors within your tenant\'s isolated partition.',
        tags: ['supervision events', 'closed-loop', 'tenant-isolated'],
    },
    {
        title: 'Simulation Layer',
        description: 'Run synthetic case traffic against new model versions or policy changes before promoting them to live inference. Validates stability across edge cases and replayed historical patterns.',
        tags: ['pre-rollout testing', 'stability report', 'synthetic traffic'],
    },
    {
        title: 'Tenant Isolation',
        description: 'All clinical data, inference history, and outcome learning are partitioned per tenant. Data does not cross tenant boundaries. Operators within a tenant control access roles.',
        tags: ['data isolation', 'RBAC', 'multi-tenant'],
    },
    {
        title: 'Traceable Runtime',
        description: 'Every inference event produces a persistent inference_event_id. All requests, model calls, latency spans, and policy checks are logged to an immutable audit trail.',
        tags: ['audit trail', 'latency tracing', 'event IDs'],
    },
];

const speciesSupported = ['Canine', 'Feline', 'Equine', 'Bovine', 'Ovine / Caprine', 'Porcine', 'Avian (poultry)', 'Exotic / Wildlife (beta)'];

export default function DocsPage() {
    return (
        <PublicPageShell
            eyebrow="Documentation"
            title="Platform Documentation"
            description="API reference, core concepts, and integration guidance for the VetIOS clinical intelligence platform."
        >
            {/* Quick links */}
            <div className="mb-12 grid gap-3 sm:grid-cols-3">
                {[
                    { label: 'API Reference', href: '#api-reference', desc: 'Inference, outcome, and simulation endpoints' },
                    { label: 'Core Concepts', href: '#concepts', desc: 'How the platform is built and why' },
                    { label: 'Get Access', href: '/signup', desc: 'Request platform credentials' },
                ].map((item) => (
                    <a key={item.label} href={item.href} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:border-[#6BF7CF]/30 hover:bg-[#6BF7CF]/5 transition-all group">
                        <div className="font-semibold text-white group-hover:text-[#6BF7CF] transition-colors">{item.label}</div>
                        <div className="mt-1 text-sm text-white/45">{item.desc}</div>
                    </a>
                ))}
            </div>

            {/* Authentication */}
            <section id="authentication" className="scroll-mt-24 mb-14">
                <h2 className="text-xl font-semibold text-white mb-2">Authentication</h2>
                <p className="text-sm text-white/60 mb-5 leading-7">All API requests require a valid session token obtained via the VetIOS authentication surface. The platform uses Supabase-based JWT sessions. Include your token in the Authorization header:</p>
                <div className="rounded-2xl border border-white/10 bg-[#0a0e14] p-5">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-3">Request Header</div>
                    <pre className="font-mono text-sm text-[#6BF7CF] overflow-x-auto">{`Authorization: Bearer <your-session-token>
Content-Type: application/json`}</pre>
                </div>
                <p className="mt-4 text-sm text-white/50">Tokens are tenant-scoped. An operator token cannot access another tenant&apos;s data. Token expiry and rotation are managed automatically by the platform session layer.</p>
            </section>

            {/* API Reference */}
            <section id="api-reference" className="scroll-mt-24 mb-14">
                <h2 className="text-xl font-semibold text-white mb-6">API Reference</h2>
                <div className="space-y-8">
                    {endpoints.map((ep) => (
                        <div key={ep.path} className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                            {/* Header */}
                            <div className="flex items-center gap-3 px-6 py-4 border-b border-white/8 bg-white/[0.02]">
                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full font-mono ${ep.method === 'POST' ? 'bg-[#6BF7CF]/15 text-[#6BF7CF]' : 'bg-blue-400/15 text-blue-300'}`}>{ep.method}</span>
                                <code className="text-sm font-mono text-white">{ep.path}</code>
                                <span className="ml-auto text-xs text-white/35 border border-white/10 px-2 py-0.5 rounded-full">{ep.badge}</span>
                            </div>
                            <div className="px-6 py-5">
                                <p className="text-sm text-white/60 leading-7 mb-6">{ep.summary}</p>
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div>
                                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-2">Request Body</div>
                                        <pre className="bg-[#080c10] border border-white/8 rounded-xl p-4 text-xs font-mono text-[#9AE4D1] overflow-x-auto leading-6 whitespace-pre">{ep.request}</pre>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-2">Response</div>
                                        <pre className="bg-[#080c10] border border-white/8 rounded-xl p-4 text-xs font-mono text-[#CFFFBC] overflow-x-auto leading-6 whitespace-pre">{ep.response}</pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Core Concepts */}
            <section id="concepts" className="scroll-mt-24 mb-14">
                <h2 className="text-xl font-semibold text-white mb-6">Core Concepts</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    {concepts.map((c) => (
                        <div key={c.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                            <h3 className="font-semibold text-white mb-2">{c.title}</h3>
                            <p className="text-sm text-white/60 leading-7 mb-3">{c.description}</p>
                            <div className="flex flex-wrap gap-2">
                                {c.tags.map((tag) => (
                                    <span key={tag} className="text-[10px] font-mono uppercase tracking-wide text-[#6BF7CF]/70 border border-[#6BF7CF]/20 bg-[#6BF7CF]/5 px-2 py-0.5 rounded-full">{tag}</span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Species support */}
            <section id="species" className="scroll-mt-24 mb-14">
                <h2 className="text-xl font-semibold text-white mb-4">Species Support</h2>
                <p className="text-sm text-white/60 mb-5">The inference engine accepts species-typed inputs. Correct species specification improves differential ranking accuracy as physiological priors are species-specific.</p>
                <div className="flex flex-wrap gap-2">
                    {speciesSupported.map((s) => (
                        <span key={s} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white/70">{s}</span>
                    ))}
                </div>
            </section>

            {/* Rate limits */}
            <section id="rate-limits" className="scroll-mt-24 mb-14">
                <h2 className="text-xl font-semibold text-white mb-4">Rate Limits</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                    {[
                        { tier: 'Standard', limit: '60 inference requests / min', note: 'Default for operator accounts' },
                        { tier: 'Partner', limit: '300 inference requests / min', note: 'Available under partner agreement' },
                        { tier: 'System / Admin', limit: 'Configurable', note: 'Governed by tenant policy' },
                    ].map((item) => (
                        <div key={item.tier} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-white/35 mb-1">{item.tier}</div>
                            <div className="font-mono text-sm font-medium text-white mb-1">{item.limit}</div>
                            <div className="text-xs text-white/45">{item.note}</div>
                        </div>
                    ))}
                </div>
                <p className="mt-4 text-sm text-white/50">Rate limit headers are returned on every response: <code className="font-mono text-[#6BF7CF] text-xs">X-RateLimit-Remaining</code> and <code className="font-mono text-[#6BF7CF] text-xs">X-RateLimit-Reset</code>.</p>
            </section>

            {/* Access CTA */}
            <div className="rounded-2xl border border-[#6BF7CF]/20 bg-[#6BF7CF]/5 p-8 text-center">
                <h3 className="text-xl font-semibold text-white mb-2">Ready to integrate?</h3>
                <p className="text-sm text-white/60 mb-6">API access requires a VetIOS account. Request access or sign in to get your credentials.</p>
                <div className="flex flex-wrap justify-center gap-3">
                    <Link href="/signup" className="inline-flex items-center gap-2 rounded-full bg-[#6BF7CF] text-[#0B0F14] px-6 py-2.5 text-sm font-semibold hover:bg-[#9FFCE8] transition-colors">Request Access</Link>
                    <Link href="/support" className="inline-flex items-center gap-2 rounded-full border border-white/15 text-white/70 px-6 py-2.5 text-sm hover:text-white hover:border-white/30 transition-colors">Contact Support</Link>
                </div>
            </div>

            <div className="mt-16 pt-8 border-t border-white/8 flex flex-wrap gap-6 text-sm text-white/35">
                <Link href="/" className="hover:text-white/60 transition-colors">← Home</Link>
                <Link href="/platform" className="hover:text-white/60 transition-colors">Platform Overview</Link>
                <Link href="/support" className="hover:text-white/60 transition-colors">Support</Link>
            </div>
        </PublicPageShell>
    );
}
