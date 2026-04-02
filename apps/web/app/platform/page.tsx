import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, CircleDashed } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { countStatuses, formatStatusLabel, moatCards, platformLayers, type CapabilityStatus } from '@/lib/platform/moatCatalog';

export const metadata: Metadata = {
    title: 'Platform',
    description: 'VetIOS platform coverage and moat audit across product, data, infrastructure, and trust surfaces.',
};

const moatCounts = countStatuses(moatCards);

export default function PlatformPage() {
    return (
        <PlatformShell
            badge="MOAT"
            title="Built to be irreplaceable, but only where the code actually proves it."
            description="This surface audits the six moat claims against the real VetIOS codebase. It keeps the strong parts, marks the partial parts honestly, and calls out the missing layers that still need product and infrastructure work."
            actions={(
                <>
                    <Link
                        href="/platform/model-cards"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        Public model cards
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/platform/developers"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Developer portal
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </>
            )}
        >
            <div className="grid gap-4 md:grid-cols-3">
                <SummaryPill label="Implemented" value={moatCounts.implemented} tone="implemented" />
                <SummaryPill label="Partial" value={moatCounts.partial} tone="partial" />
                <SummaryPill label="Missing" value={moatCounts.missing} tone="missing" />
            </div>

            <section className="mt-12">
                <div className="mb-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Platform Coverage</div>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">What the product already covers</h2>
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
                        Each claim below is tagged by what exists today: implemented, partial, or missing. The goal is to make the moat operational, not just presentational.
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
                <div className="grid gap-8 lg:grid-cols-2">
                    <GapRow title="Consumer pull" body="PetPass now has real owner-network infrastructure behind it, but the full consumer distribution and app adoption loop still need productization." />
                    <GapRow title="True federation" body="Learning loops exist and the new public network-learning surface exposes them, but cross-clinic privacy-preserving federation is still future work." />
                    <GapRow title="Partner platforming" body="The new developer portal and public endpoint catalog make the API legible, but self-serve partner keys and vendor onboarding still need to be built." />
                    <GapRow title="Trust publishing" body="Public model cards are now live, but certification and third-party attestations remain future trust layers." />
                </div>
            </section>
        </PlatformShell>
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
        <div className={`rounded-[24px] border px-5 py-4 ${toneClasses}`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em]">{label}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
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
        <div className="rounded-2xl border border-white/8 bg-black/15 p-5">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-300">{body}</div>
        </div>
    );
}
