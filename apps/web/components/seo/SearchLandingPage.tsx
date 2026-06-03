import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { PublicPageShell } from '@/components/public/PublicPageShell';
import { JsonLd } from '@/components/seo/JsonLd';
import { getConfiguredSiteOrigin } from '@/lib/site';

export interface SearchLandingPageProps {
    eyebrow: string;
    title: string;
    description: string;
    canonicalPath: string;
    keywords: string[];
    sections: Array<{
        title: string;
        body: string;
        points: string[];
    }>;
    faqs: Array<{
        question: string;
        answer: string;
    }>;
}

export function SearchLandingPage({
    eyebrow,
    title,
    description,
    canonicalPath,
    keywords,
    sections,
    faqs,
}: SearchLandingPageProps) {
    const siteOrigin = getConfiguredSiteOrigin();
    const canonicalUrl = siteOrigin ? new URL(canonicalPath, siteOrigin).toString() : undefined;

    const jsonLd = [
        {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'VetIOS',
            applicationCategory: 'Veterinary AI Software',
            operatingSystem: 'Web',
            url: canonicalUrl,
            description,
            keywords: keywords.join(', '),
            offers: {
                '@type': 'Offer',
                availability: 'https://schema.org/LimitedAvailability',
                price: '0',
                priceCurrency: 'USD',
            },
        },
        {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqs.map((faq) => ({
                '@type': 'Question',
                name: faq.question,
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: faq.answer,
                },
            })),
        },
    ];

    return (
        <PublicPageShell eyebrow={eyebrow} title={title} description={description}>
            <JsonLd data={jsonLd} />

            <section className="grid gap-4 lg:grid-cols-3">
                {sections.map((section) => (
                    <article key={section.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                        <h2 className="text-lg font-semibold text-white">{section.title}</h2>
                        <p className="mt-3 text-sm leading-7 text-white/60">{section.body}</p>
                        <ul className="mt-5 space-y-3">
                            {section.points.map((point) => (
                                <li key={point} className="flex gap-3 text-sm leading-6 text-white/58">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#6BF7CF]" />
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>
                    </article>
                ))}
            </section>

            <section className="mt-12 rounded-2xl border border-[#6BF7CF]/20 bg-[#6BF7CF]/5 p-6">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#6BF7CF]/70">Why this matters</div>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65">
                    VetIOS is built as infrastructure rather than a standalone chatbot. The platform connects structured
                    veterinary inputs, graph priors, model execution, reliability signals, outcomes, simulations, and
                    public-health research surfaces into one auditable loop.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                        href="/demo"
                        className="inline-flex items-center gap-2 rounded-full bg-[#6BF7CF] px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-[#9CFFE5]"
                    >
                        Try demo
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Read docs
                    </Link>
                    <Link
                        href="/platform"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Platform overview
                    </Link>
                </div>
            </section>

            <section className="mt-12">
                <h2 className="text-xl font-semibold text-white">Frequently asked questions</h2>
                <div className="mt-5 space-y-3">
                    {faqs.map((faq) => (
                        <details key={faq.question} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                            <summary className="cursor-pointer text-sm font-medium text-white">{faq.question}</summary>
                            <p className="mt-3 text-sm leading-7 text-white/60">{faq.answer}</p>
                        </details>
                    ))}
                </div>
            </section>
        </PublicPageShell>
    );
}
