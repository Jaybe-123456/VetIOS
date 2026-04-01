import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Braces, Code2 } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { developerEndpoints } from '@/lib/platform/developerCatalog';

export const metadata: Metadata = {
    title: 'Developers',
    description: 'VetIOS developer API catalog and integration surface.',
};

export default function DevelopersPage() {
    return (
        <PlatformShell
            badge="DEVELOPER API"
            title="A real integration surface, not just an internal button panel."
            description="The core VetIOS APIs already exist. This page turns them into a public-facing integration catalog so the developer moat is visible and usable, even before full partner credentialing and onboarding are in place."
            actions={(
                <>
                    <Link
                        href="/api/public/developer-catalog"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        JSON catalog
                        <Braces className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/settings"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Internal explorer
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </>
            )}
        >
            <div className="grid gap-4 md:grid-cols-3">
                <SummaryCard label="Documented endpoints" value={String(developerEndpoints.length)} />
                <SummaryCard label="Public endpoints" value={String(developerEndpoints.filter((endpoint) => endpoint.readiness === 'public').length)} />
                <SummaryCard label="Partner gap" value="API keys + onboarding still missing" />
            </div>

            <section className="mt-10 grid gap-6 xl:grid-cols-2">
                {developerEndpoints.map((endpoint) => (
                    <article key={endpoint.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-3">
                                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                                        {endpoint.method}
                                    </span>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                                        {formatReadiness(endpoint.readiness)}
                                    </span>
                                </div>
                                <h2 className="mt-4 font-mono text-lg text-white">{endpoint.path}</h2>
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                                Auth: {endpoint.auth.replace('_', ' ')}
                            </div>
                        </div>

                        <p className="mt-4 text-sm leading-7 text-slate-300">{endpoint.purpose}</p>

                        <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Operational notes</div>
                            <div className="mt-3 space-y-2 text-sm text-slate-300">
                                {endpoint.notes.map((note) => (
                                    <div key={note} className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2">
                                        {note}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {endpoint.samplePayload ? (
                            <div className="mt-5 rounded-2xl border border-white/8 bg-[#0a1323] p-4">
                                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                    <Code2 className="h-4 w-4" />
                                    Sample payload
                                </div>
                                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-white/6 bg-black/20 p-3 font-mono text-xs leading-6 text-slate-200">
                                    {JSON.stringify(endpoint.samplePayload, null, 2)}
                                </pre>
                            </div>
                        ) : null}
                    </article>
                ))}
            </section>
        </PlatformShell>
    );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{value}</div>
        </div>
    );
}

function formatReadiness(readiness: string): string {
    return readiness.replace('_', ' ').toUpperCase();
}
