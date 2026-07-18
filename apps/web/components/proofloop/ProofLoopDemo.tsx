'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
    ArrowRight,
    Check,
    ChevronRight,
    CircleDot,
    Code2,
    ExternalLink,
    FileCheck2,
    Fingerprint,
    Github,
    ShieldCheck,
    Sparkles,
    TestTube2,
    X,
} from 'lucide-react';

type Candidate = 'legacy' | 'corrected';

const flow = [
    { label: 'Reality', detail: 'PCR + review', icon: CircleDot },
    { label: 'Receipt', detail: 'Signed lineage', icon: Fingerprint },
    { label: 'Eval', detail: 'Strict schema', icon: Sparkles },
    { label: 'Test', detail: 'Repository-native', icon: TestTube2 },
    { label: 'Gate', detail: 'BLOCK or PASS', icon: ShieldCheck },
] as const;

const candidateResults = {
    legacy: {
        label: 'Legacy candidate',
        version: 'pre-proofloop-2026-07-12',
        diagnosis: 'dietary_indiscretion',
        escalation: 'routine',
        gate: 'BLOCK',
        reason: 'Verified diagnosis missing; unsafe routine routing remained.',
    },
    corrected: {
        label: 'Corrected candidate',
        version: 'proofloop-corrected-demo',
        diagnosis: 'canine_parvovirus',
        escalation: 'urgent',
        gate: 'PASS',
        reason: 'Expected diagnosis and urgent escalation satisfy the outcome-derived eval.',
    },
} as const;

export function ProofLoopDemo() {
    const [candidate, setCandidate] = useState<Candidate>('legacy');
    const result = candidateResults[candidate];
    const passed = result.gate === 'PASS';

    return (
        <main className="relative min-h-full overflow-hidden bg-[#050910] text-white">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_4%,rgba(16,185,129,0.12),transparent_31%),radial-gradient(circle_at_86%_18%,rgba(59,130,246,0.12),transparent_27%)]" />
            <div className="pointer-events-none absolute inset-0 landing-grid opacity-35" />

            <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-6 sm:px-8 lg:px-12">
                <nav className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
                    <Link href="/" className="group inline-flex items-center gap-3" aria-label="VetIOS home">
                        <span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_30px_rgba(52,211,153,0.12)]">
                            <Fingerprint className="h-5 w-5" />
                        </span>
                        <span>
                            <span className="block text-sm font-semibold tracking-tight text-white">VetIOS ProofLoop</span>
                            <span className="block text-[10px] uppercase tracking-[0.2em] text-slate-500">Outcome-to-code reliability</span>
                        </span>
                    </Link>

                    <a
                        href="https://github.com/Jaybe-123456/VetIOS/pull/23"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-medium text-slate-200 transition hover:border-white/30 hover:bg-white/[0.08]"
                    >
                        <Github className="h-4 w-4" />
                        Inspect the verified source
                        <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
                    </a>
                </nav>

                <section className="grid gap-10 pb-14 pt-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:pt-24">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]" />
                            OpenAI Build Week 2026 · verified vertical slice
                        </div>
                        <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
                            Reality becomes a <span className="text-emerald-300">release gate.</span>
                        </h1>
                        <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                            ProofLoop connects an AI inference to what happened later, signs the outcome lineage, and turns that correction into an executable eval and regression gate.
                        </p>
                    </div>

                    <div className={`rounded-[28px] border p-6 shadow-[0_26px_100px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:p-7 ${passed ? 'border-emerald-400/25 bg-emerald-400/[0.07]' : 'border-rose-400/25 bg-rose-400/[0.07]'}`}>
                        <div className="flex items-start justify-between gap-5">
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Current release decision</div>
                                <div className={`mt-3 text-4xl font-semibold tracking-tight ${passed ? 'text-emerald-300' : 'text-rose-300'}`}>
                                    {result.gate}
                                </div>
                            </div>
                            <span className={`grid h-12 w-12 place-items-center rounded-2xl border ${passed ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/30 bg-rose-400/10 text-rose-300'}`}>
                                {passed ? <Check className="h-6 w-6" /> : <X className="h-6 w-6" />}
                            </span>
                        </div>
                        <p className="mt-5 text-sm leading-6 text-slate-300">{result.reason}</p>
                        <dl className="mt-5 grid gap-2 text-xs sm:grid-cols-3">
                            <DecisionDetail label="Version" value={result.version} />
                            <DecisionDetail label="Primary" value={result.diagnosis} />
                            <DecisionDetail label="Route" value={result.escalation} />
                        </dl>
                        <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5" aria-label="Choose model candidate">
                            <CandidateButton selected={candidate === 'legacy'} onClick={() => setCandidate('legacy')} label="Legacy" />
                            <CandidateButton selected={candidate === 'corrected'} onClick={() => setCandidate('corrected')} label="Corrected" />
                        </div>
                    </div>
                </section>

                <section aria-label="ProofLoop stages" className="rounded-[28px] border border-white/10 bg-[#09111d]/90 p-5 shadow-[0_25px_90px_rgba(0,0,0,0.28)] sm:p-7">
                    <div className="grid gap-3 md:grid-cols-5">
                        {flow.map((stage, index) => {
                            const Icon = stage.icon;
                            return (
                                <div key={stage.label} className="relative flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300">
                                        <Icon className="h-5 w-5" />
                                    </span>
                                    <div>
                                        <div className="text-sm font-semibold text-white">{stage.label}</div>
                                        <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">{stage.detail}</div>
                                    </div>
                                    {index < flow.length - 1 ? (
                                        <ChevronRight className="absolute -right-3 z-10 hidden h-5 w-5 text-slate-600 md:block" />
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                    <article className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 sm:p-8">
                        <SectionLabel icon={Fingerprint}>Outcome receipt</SectionLabel>
                        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">Ground truth with provenance.</h2>
                        <p className="mt-3 text-sm leading-7 text-slate-400">
                            The public case is synthetic. Its inference trace, PCR evidence, and reviewer confirmation are bound into one tamper-evident episode.
                        </p>
                        <div className="mt-6 space-y-3">
                            <EvidenceRow label="Case" value="synthetic-canine-parvo-001" />
                            <EvidenceRow label="Original output" value="dietary_indiscretion · 0.92" />
                            <EvidenceRow label="Verified outcome" value="canine_parvovirus" good />
                            <EvidenceRow label="Evidence" value="PCR detected + reviewer confirmed" good />
                            <EvidenceRow label="Digest" value="SHA-256 matched" good />
                            <EvidenceRow label="Signature" value="Ed25519 valid" good />
                        </div>
                    </article>

                    <article className="rounded-[28px] border border-white/10 bg-[#071321] p-6 sm:p-8">
                        <SectionLabel icon={Sparkles}>Outcome-derived eval</SectionLabel>
                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <Metric label="Failure class" value="OVERCONFIDENCE" tone="warn" />
                            <Metric label="Severity" value="HIGH" tone="bad" />
                            <Metric label="Target slice" value="JUVENILE CANINE" />
                            <Metric label="Risk pattern" value="GI + LEUKOPENIA" />
                        </div>
                        <div className="mt-5 rounded-2xl border border-white/[0.08] bg-black/25 p-5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Expected behavior</div>
                            <ul className="mt-4 space-y-3 text-sm text-slate-300">
                                <CheckLine>Include canine parvovirus in the differential.</CheckLine>
                                <CheckLine>Do not use dietary indiscretion as primary.</CheckLine>
                                <CheckLine>Route the case as urgent or emergency.</CheckLine>
                                <CheckLine>Cap confidence when the expected diagnosis is missing.</CheckLine>
                            </ul>
                        </div>
                        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-blue-400/15 bg-blue-400/[0.06] p-4 text-xs leading-6 text-blue-100/80">
                            <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                            Public replay uses a schema-validated recorded fixture. The GPT-5.6 Responses API adapter is included in source and is not misrepresented as a live call here.
                        </div>
                    </article>
                </section>

                <section className="mt-8 rounded-[28px] border border-white/10 bg-[#080d15] p-6 sm:p-8">
                    <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
                        <div>
                            <SectionLabel icon={Code2}>Repository-aware regression</SectionLabel>
                            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">The correction becomes executable.</h2>
                            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-400">
                                Codex receives a digest-bound prompt, inspects repository conventions, writes the targeted fixture and test, and cannot weaken existing tests to make the gate pass.
                            </p>
                            <a
                                href="https://github.com/Jaybe-123456/VetIOS/tree/codex/proofloop-build-week/proofloop-build-week"
                                target="_blank"
                                rel="noreferrer"
                                className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                            >
                                View implementation
                                <ArrowRight className="h-4 w-4" />
                            </a>
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#03060a] shadow-2xl">
                            <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
                                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                                <span className="ml-2 text-[10px] uppercase tracking-[0.16em] text-slate-600">proofloop.test.ts</span>
                            </div>
                            <pre className="overflow-x-auto p-5 text-xs leading-7 text-slate-300 sm:p-6">
                                <code>{`test("verified parvovirus outcome gates release", () => {
  const result = evaluateCandidate(candidate, evalSpec);

  expect(result.diagnoses).toContain("canine_parvovirus");
  expect(["urgent", "emergency"]).toContain(result.escalation);
  expect(result.primary).not.toBe("dietary_indiscretion");
});`}</code>
                            </pre>
                            <div className="border-t border-white/[0.08] px-5 py-4 text-xs">
                                <span className="text-emerald-300">6 tests passed</span>
                                <span className="mx-2 text-slate-700">·</span>
                                <span className="text-slate-500">0 failed</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mt-8 grid gap-5 md:grid-cols-3">
                    <TrustCard icon={ShieldCheck} title="Cryptographically verified">
                        Canonical JSON, SHA-256 content addressing, and Ed25519 signatures make post-signature mutation detectable.
                    </TrustCard>
                    <TrustCard icon={TestTube2} title="Executable, not passive">
                        The verified correction becomes a regression fixture and a deterministic model-promotion decision.
                    </TrustCard>
                    <TrustCard icon={FileCheck2} title="Evidence-constrained">
                        Synthetic public data, explicit provenance, and human confirmation keep the demo auditable and safe.
                    </TrustCard>
                </section>

                <footer className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-7 text-xs leading-6 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <p>Demonstration only. Synthetic case data. ProofLoop does not replace licensed veterinary judgment.</p>
                    <div className="flex items-center gap-4">
                        <Link href="/privacy" className="transition hover:text-slate-300">Privacy</Link>
                        <Link href="/terms" className="transition hover:text-slate-300">Terms</Link>
                        <a href="https://github.com/Jaybe-123456/VetIOS" target="_blank" rel="noreferrer" className="transition hover:text-slate-300">GitHub</a>
                    </div>
                </footer>
            </div>
        </main>
    );
}

function DecisionDetail({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3">
            <dt className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</dt>
            <dd className="mt-1 truncate text-slate-200" title={value}>{value}</dd>
        </div>
    );
}

function CandidateButton({
    selected,
    onClick,
    label,
}: {
    selected: boolean;
    onClick: () => void;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={selected}
            className={`min-h-10 rounded-xl px-3 py-2 text-xs font-semibold transition ${selected ? 'bg-white text-slate-950 shadow-lg' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'}`}
        >
            {label}
        </button>
    );
}

function SectionLabel({
    icon: Icon,
    children,
}: {
    icon: typeof Fingerprint;
    children: React.ReactNode;
}) {
    return (
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
            <Icon className="h-4 w-4" />
            {children}
        </div>
    );
}

function EvidenceRow({ label, value, good = false }: { label: string; value: string; good?: boolean }) {
    return (
        <div className="flex flex-col gap-1 rounded-2xl border border-white/[0.07] bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
            <span className={`break-all text-sm sm:text-right ${good ? 'text-emerald-300' : 'text-slate-200'}`}>{value}</span>
        </div>
    );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warn' | 'bad' }) {
    const valueClass = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-200' : 'text-slate-100';
    return (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
            <div className={`mt-2 text-sm font-semibold ${valueClass}`}>{value}</div>
        </div>
    );
}

function CheckLine({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>{children}</span>
        </li>
    );
}

function TrustCard({
    icon: Icon,
    title,
    children,
}: {
    icon: typeof ShieldCheck;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <article className="rounded-[24px] border border-white/10 bg-white/[0.03] p-6">
            <Icon className="h-5 w-5 text-emerald-300" />
            <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">{children}</p>
        </article>
    );
}
