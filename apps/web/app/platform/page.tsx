import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, CircleDashed, ShieldCheck } from 'lucide-react';
import { countStatuses, formatStatusLabel, moatCards, platformLayers, type CapabilityStatus } from '@/lib/platform/moatCatalog';

export const metadata: Metadata = {
    title: 'Platform',
    description: 'VetIOS platform coverage and moat audit across product, data, infrastructure, and trust surfaces.',
};

const moatCounts = countStatuses(moatCards);

export default function PlatformPage() {
    return (
        <div className="min-h-full bg-[#081120] text-white">
            <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-12">
                <div className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.22),_transparent_34%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(8,17,32,0.98))] p-8 shadow-[0_30px_120px_rgba(2,6,23,0.45)] sm:p-10">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#60a5fa]/30 bg-[#2563eb]/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#bfdbfe]">
                        MOAT
                    </div>
                    <div className="mt-6 grid gap-10 lg:grid-cols-[1.3fr_0.7fr]">
                        <div>
                            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                                Built to be irreplaceable, but only where the code actually proves it.
                            </h1>
                            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
                                This page checks the six moat claims against the real VetIOS codebase. It keeps the strong parts,
                                marks the partial parts honestly, and calls out the pieces that still need to be built before the
                                platform earns the full story in your screenshot.
                            </p>
                            <div className="mt-8 flex flex-wrap gap-3">
                                <SummaryPill label="Implemented" value={moatCounts.implemented} tone="implemented" />
                                <SummaryPill label="Partial" value={moatCounts.partial} tone="partial" />
                                <SummaryPill label="Missing" value={moatCounts.missing} tone="missing" />
                            </div>
                        </div>

                        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Closest to real moat now</div>
                            <div className="mt-4 space-y-4">
                                <HighlightRow
                                    title="Inference API"
                                    body="Production-shaped inference routing, telemetry, and integrity checks are already live."
                                    href="/inference"
                                    cta="Open inference"
                                />
                                <HighlightRow
                                    title="Model governance"
                                    body="Registry gating, promotion logic, rollback, and audit trails are already present."
                                    href="/models"
                                    cta="Open registry"
                                />
                                <HighlightRow
                                    title="Public model cards"
                                    body="This change adds the first public registry surface so trust is no longer console-only."
                                    href="/platform/model-cards"
                                    cta="Open model cards"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <section className="mt-12">
                    <div className="mb-6 flex items-end justify-between gap-4">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Platform Coverage</div>
                            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">What the product already covers</h2>
                        </div>
                        <Link
                            href="/platform/model-cards"
                            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 transition hover:border-white/30 hover:bg-white/10"
                        >
                            Public Model Cards
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>

                    <div className="space-y-4">
                        {platformLayers.map((layer) => (
                            <div key={layer.id} className={`grid overflow-hidden rounded-[22px] border ${layer.surfaceClass} md:grid-cols-[220px_1fr]`}>
                                <div className={`flex items-center px-6 py-6 text-lg font-semibold text-white ${layer.accentClass}`}>
                                    {layer.label}
                                </div>
                                <div className="grid gap-3 px-6 py-5 text-slate-900 md:grid-cols-3">
                                    {layer.capabilities.map((capability) => (
                                        <div key={capability.label} className="rounded-2xl border border-slate-900/10 bg-white/60 p-4 backdrop-blur">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="font-medium">{capability.label}</div>
                                                <StatusBadge status={capability.status} dark={false} />
                                            </div>
                                            <p className="mt-3 text-sm leading-6 text-slate-700">{capability.summary}</p>
                                            {capability.href ? (
                                                <Link href={capability.href} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-900">
                                                    Open surface
                                                    <ArrowRight className="h-4 w-4" />
                                                </Link>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="mt-16">
                    <div className="mb-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Moat Audit</div>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Six structural moat layers</h2>
                        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">
                            Each claim below is tagged by what exists today: implemented, partial, or missing. The goal is to
                            make the moat operational, not just presentational.
                        </p>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        {moatCards.map((card) => (
                            <article key={card.id} className={`rounded-[24px] border p-6 shadow-[0_20px_80px_rgba(2,6,23,0.25)] ${card.themeClass}`}>
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="inline-flex rounded-md border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-white/85">
                                            {card.company}
                                        </div>
                                        <h3 className="mt-4 text-2xl font-semibold text-white">{card.title}</h3>
                                        <p className="mt-2 text-sm uppercase tracking-[0.14em] text-white/60">{card.thesis}</p>
                                    </div>
                                    <StatusBadge status={card.status} />
                                </div>

                                <p className="mt-5 text-lg font-medium text-white">{card.claim}</p>

                                <div className="mt-6 grid gap-5 xl:grid-cols-2">
                                    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Available now</div>
                                        <div className="mt-3 space-y-3">
                                            {card.availableNow.map((line) => (
                                                <AuditLine key={line} tone="positive" text={line} />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Still missing</div>
                                        <div className="mt-3 space-y-3">
                                            {card.missingNow.map((line) => (
                                                <AuditLine key={line} tone="warning" text={line} />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-6 flex flex-wrap gap-3">
                                    {card.links.map((link) => (
                                        <Link
                                            key={`${card.id}:${link.href}`}
                                            href={link.href}
                                            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/15"
                                        >
                                            {link.label}
                                            <ArrowRight className="h-4 w-4" />
                                        </Link>
                                    ))}
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="mt-16 rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                    <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr]">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Build Gap</div>
                            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">What still has to exist to make the moat hard to copy</h2>
                            <div className="mt-6 space-y-4 text-slate-300">
                                <GapRow title="Consumer pull" body="PetPass and owner-side network effects still do not exist in the product." />
                                <GapRow title="True federation" body="Learning loops exist, but they are still scoped by tenant rather than privacy-preserving cross-clinic federation." />
                                <GapRow title="Partner platforming" body="The core APIs exist, but external vendor onboarding, keys, docs, and account management are still missing." />
                                <GapRow title="Trust publishing" body="Public model cards now exist, but certification, attestations, and a formal publication workflow still need to be built." />
                            </div>
                        </div>

                        <div className="rounded-3xl border border-[#60a5fa]/20 bg-[#0b1324] p-6">
                            <div className="inline-flex items-center gap-2 rounded-full border border-[#60a5fa]/25 bg-[#1d4ed8]/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#bfdbfe]">
                                Next Ship
                            </div>
                            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-300">
                                <p>
                                    The strongest next moat move is to keep trust and integration ahead of the rest of the roadmap:
                                    publish model cards, stabilize external API contracts, and turn passive signals into real vendor
                                    syncs instead of operator-entered payloads.
                                </p>
                                <p>
                                    The larger moats, especially PetPass and true federation, are platform bets rather than quick UI work.
                                    This page now makes that visible instead of hiding it.
                                </p>
                            </div>
                            <div className="mt-6 flex flex-wrap gap-3">
                                <Link
                                    href="/platform/model-cards"
                                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                                >
                                    Review model cards
                                    <ShieldCheck className="h-4 w-4" />
                                </Link>
                                <Link
                                    href="/login"
                                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                                >
                                    Open console
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

function SummaryPill({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: CapabilityStatus;
}) {
    const toneClasses = tone === 'implemented'
        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
        : tone === 'partial'
            ? 'border-amber-400/25 bg-amber-400/10 text-amber-200'
            : 'border-rose-400/25 bg-rose-400/10 text-rose-200';

    return (
        <div className={`rounded-full border px-4 py-2 ${toneClasses}`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em]">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
        </div>
    );
}

function HighlightRow({
    title,
    body,
    href,
    cta,
}: {
    title: string;
    body: string;
    href: string;
    cta: string;
}) {
    return (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-semibold text-white">{title}</div>
            <p className="mt-2 text-sm leading-6 text-slate-300">{body}</p>
            <Link href={href} className="mt-4 inline-flex items-center gap-2 text-sm text-slate-100">
                {cta}
                <ArrowRight className="h-4 w-4" />
            </Link>
        </div>
    );
}

function StatusBadge({
    status,
    dark = true,
}: {
    status: CapabilityStatus;
    dark?: boolean;
}) {
    const toneClasses = status === 'implemented'
        ? dark
            ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
            : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-800'
        : status === 'partial'
            ? dark
                ? 'border-amber-400/25 bg-amber-400/10 text-amber-200'
                : 'border-amber-500/20 bg-amber-500/10 text-amber-800'
            : dark
                ? 'border-rose-400/25 bg-rose-400/10 text-rose-200'
                : 'border-rose-500/20 bg-rose-500/10 text-rose-800';

    return (
        <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClasses}`}>
            {formatStatusLabel(status)}
        </span>
    );
}

function AuditLine({
    tone,
    text,
}: {
    tone: 'positive' | 'warning';
    text: string;
}) {
    return (
        <div className="flex items-start gap-3 text-sm leading-6 text-slate-100">
            <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                tone === 'positive'
                    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                    : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
            }`}>
                {tone === 'positive' ? <Check className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
            </span>
            <span>{text}</span>
        </div>
    );
}

function GapRow({
    title,
    body,
}: {
    title: string;
    body: string;
}) {
    return (
        <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="mt-1 text-sm leading-6 text-slate-300">{body}</div>
        </div>
    );
}
