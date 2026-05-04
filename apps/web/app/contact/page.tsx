import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicPageShell } from '@/components/public/PublicPageShell';

export const metadata: Metadata = {
    title: 'Contact — VetIOS',
    description: 'Contact the VetIOS platform team for access, partnerships, or enquiries.',
};

export default function ContactPage() {
    return (
        <PublicPageShell
            eyebrow="Contact"
            title="Get in Touch"
            description="Reach the VetIOS platform team for access requests, partnership enquiries, or general questions."
        >
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">

                {/* Left — contact methods */}
                <div className="space-y-5">
                    <h2 className="text-lg font-semibold text-white">Contact Details</h2>

                    {[
                        {
                            category: 'Platform & API Support',
                            email: 'platform@vetios.tech',
                            description: 'For API integration questions, account access, rate limits, data requests, security reports, and anything related to the platform runtime or console.',
                            response: 'Within 2 business days',
                            tags: ['API issues', 'Account access', 'Security', 'Data requests'],
                        },
                        {
                            category: 'General & Partnership',
                            email: 'johnbruce12g@gmail.com',
                            description: 'For partnership discussions, onboarding evaluation, press enquiries, feedback, or anything that doesn\'t fit the platform support category.',
                            response: 'Within 3 business days',
                            tags: ['Partnerships', 'Onboarding', 'Feedback', 'Press'],
                        },
                    ].map((item) => (
                        <div key={item.category} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                            <div className="text-[10px] uppercase tracking-[0.24em] text-white/35 mb-3">{item.category}</div>
                            <a href={`mailto:${item.email}`} className="font-mono text-[#6BF7CF] hover:underline text-base">{item.email}</a>
                            <p className="mt-3 text-sm text-white/60 leading-7">{item.description}</p>
                            <div className="mt-4 flex flex-wrap gap-2">
                                {item.tags.map((tag) => (
                                    <span key={tag} className="text-xs text-white/40 border border-white/10 px-2.5 py-1 rounded-full">{tag}</span>
                                ))}
                            </div>
                            <div className="mt-4 pt-4 border-t border-white/8 text-xs text-white/35">
                                Typical response: <span className="text-white/55">{item.response}</span>
                            </div>
                        </div>
                    ))}

                    {/* Security disclosure */}
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-amber-300/60 mb-3">Security Disclosures</div>
                        <a href="mailto:platform@vetios.tech" className="font-mono text-amber-200 hover:underline text-sm">platform@vetios.tech</a>
                        <p className="mt-3 text-sm text-amber-100/60 leading-7">
                            To report a security vulnerability, email the above address with subject line <strong className="text-amber-100">&ldquo;Security Report&rdquo;</strong>. Please include a description of the vulnerability, reproduction steps, and potential impact. We aim to acknowledge reports within 24 hours.
                        </p>
                        <p className="mt-3 text-xs text-amber-100/40">
                            Please do not publicly disclose vulnerability details before we have had a chance to respond and remediate.
                        </p>
                    </div>
                </div>

                {/* Right — info panel */}
                <div className="space-y-5">
                    <h2 className="text-lg font-semibold text-white">Platform Information</h2>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
                        {[
                            { label: 'Platform', value: 'vetios.tech' },
                            { label: 'Status', value: 'Controlled access — V1.0 OMEGA' },
                            { label: 'Build', value: 'V1.0 OMEGA' },
                            { label: 'Runtime', value: 'Clinical Intelligence Runtime' },
                            { label: 'Access Model', value: 'Invite / request-based' },
                        ].map((item) => (
                            <div key={item.label} className="flex justify-between gap-4 text-sm">
                                <span className="text-white/35">{item.label}</span>
                                <span className="text-white/70 text-right">{item.value}</span>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-white/35 mb-3">Access Model</div>
                        <p className="text-sm text-white/60 leading-7">
                            VetIOS operates on a controlled-access model. Platform access is not open registration — it is reviewed and granted to vetted operators, veterinary professionals, and integration partners.
                        </p>
                        <Link href="/signup" className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-[#6BF7CF]/10 border border-[#6BF7CF]/30 text-[#C9FFF0] px-5 py-3 text-sm font-medium hover:bg-[#6BF7CF]/20 transition-colors">
                            Request Platform Access
                        </Link>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-3">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">Other Resources</div>
                        {[
                            { label: 'Documentation', href: '/docs' },
                            { label: 'Platform Overview', href: '/platform' },
                            { label: 'Privacy Policy', href: '/privacy' },
                            { label: 'Terms of Service', href: '/terms' },
                            { label: 'Support Centre', href: '/support' },
                        ].map((item) => (
                            <Link key={item.label} href={item.href} className="flex items-center justify-between text-sm text-white/50 hover:text-[#6BF7CF] transition-colors group">
                                {item.label}
                                <span className="text-white/20 group-hover:text-[#6BF7CF] transition-colors">→</span>
                            </Link>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-16 pt-8 border-t border-white/8 flex flex-wrap gap-6 text-sm text-white/35">
                <Link href="/" className="hover:text-white/60 transition-colors">← Home</Link>
                <Link href="/support" className="hover:text-white/60 transition-colors">Support Centre</Link>
                <Link href="/docs" className="hover:text-white/60 transition-colors">Documentation</Link>
            </div>
        </PublicPageShell>
    );
}
