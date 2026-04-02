import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Braces, Code2 } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PublicDeveloperOnboardingForm } from '@/components/platform/PublicDeveloperOnboardingForm';
import { getPublicDeveloperPlatformSnapshot } from '@/lib/developerPlatform/service';

export const metadata: Metadata = {
    title: 'Developers',
    description: 'VetIOS developer API catalog and integration surface.',
};

export const dynamic = 'force-dynamic';

export default async function DevelopersPage() {
    const snapshot = await getPublicDeveloperPlatformSnapshot();

    return (
        <PlatformShell
            badge="DEVELOPER API"
            title="A partner platform, not just an internal endpoint list."
            description="The core VetIOS APIs already exist. This surface now adds published API products and self-serve onboarding intake so partner integration can move from internal-only to productized."
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
                <SummaryCard label="Documented endpoints" value={String(snapshot.endpoints.length)} />
                <SummaryCard label="Published products" value={String(snapshot.summary.published_products)} />
                <SummaryCard label="Active partners" value={String(snapshot.summary.active_partners)} />
            </div>

            {!snapshot.configured ? (
                <section className="mt-8 rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-6 text-amber-100">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Configuration needed</div>
                    <p className="mt-3 max-w-3xl text-sm leading-7">
                        Set <code className="rounded bg-black/20 px-1.5 py-0.5">VETIOS_PUBLIC_TENANT_ID</code> to publish partner products and accept public onboarding requests from the canonical tenant.
                    </p>
                </section>
            ) : null}

            <section className="mt-10 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Published products</div>
                        {snapshot.api_products.length > 0 ? (
                            <div className="mt-4 grid gap-4">
                                {snapshot.api_products.map((product) => (
                                    <div key={product.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <div className="font-mono text-sm text-white">{product.title}</div>
                                                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{product.product_key}</div>
                                            </div>
                                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
                                                {product.access_tier}
                                            </div>
                                        </div>
                                        <p className="mt-3 text-sm leading-6 text-slate-300">{product.summary}</p>
                                        <div className="mt-3 text-xs text-slate-400">
                                            Default scopes: {product.default_scopes.join(', ') || 'NO DATA'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-300">
                                No partner API products have been published yet.
                            </div>
                        )}
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Endpoint catalog</div>
                        <div className="mt-4 grid gap-6 xl:grid-cols-2">
                            {snapshot.endpoints.map((endpoint) => (
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
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <PublicDeveloperOnboardingForm />
                    <SummaryCard label="Open requests" value={String(snapshot.summary.pending_requests)} />
                    <SummaryCard label="Tenant source" value={snapshot.tenant_id ?? 'NOT CONFIGURED'} />
                </div>
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
