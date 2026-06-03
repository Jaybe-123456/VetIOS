import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { PublicPageShell } from '@/components/public/PublicPageShell';
import { JsonLd } from '@/components/seo/JsonLd';
import { getConfiguredSiteOrigin } from '@/lib/site';

export const metadata: Metadata = {
    title: 'About VetIOS',
    description:
        'VetIOS is AI-native veterinary intelligence infrastructure for clinical inference, outcome learning, graph intelligence, simulation, and quantum-ready AMR research.',
    alternates: { canonical: '/about' },
    keywords: ['VetIOS', 'about VetIOS', 'AI-native veterinary intelligence infrastructure', 'veterinary AI infrastructure'],
    openGraph: {
        title: 'About VetIOS',
        description:
            'VetIOS is AI-native veterinary intelligence infrastructure for clinical inference, outcome learning, graph intelligence, simulation, and quantum-ready AMR research.',
        url: '/about',
        type: 'website',
        images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'About VetIOS' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'About VetIOS',
        description: 'AI-native veterinary intelligence infrastructure for clinical inference, outcome learning, and quantum-ready AMR research.',
        images: ['/opengraph-image'],
    },
};

const pillars = [
    'Structured veterinary inference',
    'Confirmed outcome learning',
    'Veterinary knowledge graph intelligence',
    'Simulation and reliability monitoring',
    'Quantum-ready AMR research infrastructure',
];

export default function AboutPage() {
    const siteUrl = getConfiguredSiteOrigin() ?? 'https://www.vetios.tech';

    return (
        <PublicPageShell
            eyebrow="About VetIOS"
            title="VetIOS is AI-native veterinary intelligence infrastructure."
            description="VetIOS is built to turn structured clinical signals into auditable inference, outcome learning, graph intelligence, simulation, and research-grade AMR workflows."
        >
            <JsonLd
                data={[
                    {
                        '@context': 'https://schema.org',
                        '@type': 'AboutPage',
                        '@id': `${siteUrl}/about#about`,
                        name: 'About VetIOS',
                        url: `${siteUrl}/about`,
                        isPartOf: { '@id': `${siteUrl}/#website` },
                        about: { '@id': `${siteUrl}/#organization` },
                    },
                    {
                        '@context': 'https://schema.org',
                        '@type': 'Brand',
                        '@id': `${siteUrl}/#brand`,
                        name: 'VetIOS',
                        slogan: 'AI-Native Veterinary Intelligence Infrastructure',
                        url: siteUrl,
                        logo: `${siteUrl}/icon.svg`,
                        sameAs: ['https://github.com/Jaybe-123456/VetIOS'],
                    },
                ]}
            />

            <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                    <h2 className="text-xl font-semibold text-white">What VetIOS means</h2>
                    <p className="mt-4 text-sm leading-7 text-white/62">
                        VetIOS is the system layer for veterinary intelligence. It is not positioned as a
                        consumer chatbot or passive record system; it is infrastructure for teams that need
                        traceable clinical inference, feedback from confirmed outcomes, graph priors, simulation,
                        and research surfaces for antimicrobial resistance.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Link
                            href="/veterinary-ai"
                            className="inline-flex items-center gap-2 rounded-full bg-[#6BF7CF] px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-[#9CFFE5]"
                        >
                            Veterinary AI
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href="/platform"
                            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                        >
                            Platform overview
                        </Link>
                    </div>
                </article>

                <aside className="rounded-2xl border border-[#6BF7CF]/20 bg-[#6BF7CF]/5 p-6">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#6BF7CF]/70">
                        Brand entity
                    </div>
                    <dl className="mt-5 space-y-4 text-sm">
                        <div>
                            <dt className="text-white/42">Name</dt>
                            <dd className="mt-1 font-semibold text-white">VetIOS</dd>
                        </div>
                        <div>
                            <dt className="text-white/42">Canonical domain</dt>
                            <dd className="mt-1 text-white">www.vetios.tech</dd>
                        </div>
                        <div>
                            <dt className="text-white/42">Category</dt>
                            <dd className="mt-1 text-white">Veterinary AI infrastructure</dd>
                        </div>
                    </dl>
                </aside>
            </section>

            <section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-lg font-semibold text-white">Core pillars</h2>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {pillars.map((pillar) => (
                        <li key={pillar} className="flex gap-3 text-sm leading-6 text-white/60">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#6BF7CF]" />
                            <span>{pillar}</span>
                        </li>
                    ))}
                </ul>
            </section>
        </PublicPageShell>
    );
}
