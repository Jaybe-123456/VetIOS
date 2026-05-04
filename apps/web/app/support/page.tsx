import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicPageShell } from '@/components/public/PublicPageShell';

export const metadata: Metadata = {
    title: 'Support — VetIOS',
    description: 'Get help with VetIOS. Contact support, report issues, and find answers to common questions.',
};

const faqs = [
    {
        q: 'How do I get access to the VetIOS platform?',
        a: 'VetIOS is a controlled-access platform. Create an account at vetios.tech/signup. Access is reviewed and approved by the platform team. Once approved, you\'ll receive an email with your operator credentials.',
    },
    {
        q: 'I submitted a case and got no differentials. What happened?',
        a: 'This usually means the input did not pass schema validation. Ensure your request includes species, at least one symptom, and a valid input_signature structure. Check the error field in the API response for a machine-readable reason code.',
    },
    {
        q: 'How long are inference sessions retained?',
        a: 'Inference logs are retained for 90 days within your tenant partition, after which they are deleted or anonymised. Outcome events linked to confirmed diagnoses may be retained longer for learning purposes. See our Privacy Policy for full retention schedules.',
    },
    {
        q: 'Can I use VetIOS outputs directly in clinical records?',
        a: 'AI outputs from VetIOS are decision-support tools and must be reviewed by a licensed veterinary professional before being recorded as clinical findings. All outputs should be verified against the patient presentation, clinical standards, and professional judgement.',
    },
    {
        q: 'What species does the inference engine support?',
        a: 'Currently: canine, feline, equine, bovine, ovine/caprine, porcine, and avian (poultry). Exotic and wildlife species are in beta. Correct species specification in your input significantly improves differential ranking accuracy.',
    },
    {
        q: 'I\'m getting a 429 rate limit error.',
        a: 'Standard accounts are limited to 60 inference requests per minute. Check the X-RateLimit-Reset header to see when your limit resets. If you need higher limits, contact platform@vetios.tech to discuss a partner agreement.',
    },
    {
        q: 'How is my clinical data protected?',
        a: 'All clinical data is stored in tenant-isolated partitions and never co-mingled with other tenants. Data is encrypted in transit (TLS 1.2+). It is not used to train shared or external AI models without your explicit consent. See our Privacy Policy for full details.',
    },
    {
        q: 'Can I request deletion of my data?',
        a: 'Yes. Email platform@vetios.tech with your account email and a deletion request. We will process the request within 30 days. Note that billing records are retained for 7 years as required by law.',
    },
    {
        q: 'How do I report a security vulnerability?',
        a: 'Email platform@vetios.tech with the subject line "Security Report". We take security reports seriously and aim to acknowledge them within 24 hours. Do not post vulnerability details publicly before we have had a chance to respond.',
    },
    {
        q: 'Is VetIOS a replacement for a veterinarian?',
        a: 'No. VetIOS is AI infrastructure for veterinary decision support, not a replacement for professional veterinary care. All AI outputs require professional review and must not be used as a substitute for a licensed veterinarian\'s clinical judgement.',
    },
];

export default function SupportPage() {
    return (
        <PublicPageShell
            eyebrow="Support"
            title="Help & Support"
            description="Get help with platform access, API integration, or clinical questions."
        >
            {/* Contact cards */}
            <div className="grid gap-4 sm:grid-cols-3 mb-14">
                {[
                    {
                        label: 'Platform Support',
                        email: 'platform@vetios.tech',
                        desc: 'API issues, account access, billing, security reports.',
                        response: 'Within 2 business days',
                        accent: '[#6BF7CF]',
                    },
                    {
                        label: 'General Enquiries',
                        email: 'johnbruce12g@gmail.com',
                        desc: 'Partnership enquiries, onboarding questions, platform feedback.',
                        response: 'Within 3 business days',
                        accent: '[#7CFF4E]',
                    },
                    {
                        label: 'Security Reports',
                        email: 'platform@vetios.tech',
                        desc: 'Vulnerability disclosures and security incidents. Subject: "Security Report".',
                        response: 'Within 24 hours',
                        accent: 'amber-400',
                    },
                ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col gap-3">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">{item.label}</div>
                        <a href={`mailto:${item.email}`} className="text-[#6BF7CF] hover:underline font-mono text-sm break-all">{item.email}</a>
                        <p className="text-sm text-white/55 leading-6 flex-1">{item.desc}</p>
                        <div className="text-xs text-white/35 border-t border-white/8 pt-3">
                            <span className="text-white/25">Response: </span>{item.response}
                        </div>
                    </div>
                ))}
            </div>

            {/* Status */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-14 flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/35 mb-2">Platform Status</div>
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[#6BF7CF] shadow-[0_0_8px_rgba(107,247,207,0.8)]" />
                        <span className="font-medium text-white">All systems operational</span>
                    </div>
                    <p className="mt-1 text-sm text-white/45">Controlled access — V1.0 OMEGA</p>
                </div>
                <div className="text-sm text-white/40 space-y-1 text-right">
                    <div>Inference Engine: <span className="text-[#6BF7CF]">Operational</span></div>
                    <div>Outcome Learning: <span className="text-[#6BF7CF]">Operational</span></div>
                    <div>Simulation Layer: <span className="text-[#6BF7CF]">Operational</span></div>
                </div>
            </div>

            {/* FAQ */}
            <section id="faq" className="scroll-mt-24 mb-14">
                <h2 className="text-xl font-semibold text-white mb-6">Frequently Asked Questions</h2>
                <div className="space-y-4">
                    {faqs.map((item) => (
                        <details key={item.q} className="group rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                            <summary className="flex cursor-pointer items-start justify-between gap-4 px-6 py-5 text-sm font-medium text-white hover:text-[#6BF7CF] transition-colors list-none">
                                {item.q}
                                <span className="shrink-0 text-white/30 group-open:rotate-45 transition-transform text-lg leading-none mt-0.5">+</span>
                            </summary>
                            <div className="px-6 pb-5 text-sm text-white/60 leading-7 border-t border-white/8 pt-4">
                                {item.a}
                            </div>
                        </details>
                    ))}
                </div>
            </section>

            {/* Quick links */}
            <section className="mb-14">
                <h2 className="text-xl font-semibold text-white mb-4">Resources</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                    {[
                        { label: 'API Documentation', href: '/docs', desc: 'Inference, outcome, and simulation API reference.' },
                        { label: 'Privacy Policy', href: '/privacy', desc: 'How we collect, use, and protect your data.' },
                        { label: 'Terms of Service', href: '/terms', desc: 'Terms governing your use of the platform.' },
                        { label: 'Platform Overview', href: '/platform', desc: 'What VetIOS is and how it is designed.' },
                        { label: 'Create Account', href: '/signup', desc: 'Request access to the VetIOS platform.' },
                        { label: 'Contact Team', href: '/contact', desc: 'Reach the VetIOS platform team directly.' },
                    ].map((item) => (
                        <Link key={item.label} href={item.href} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-[#6BF7CF]/30 hover:bg-[#6BF7CF]/5 transition-all group">
                            <div className="font-medium text-white group-hover:text-[#6BF7CF] transition-colors text-sm">{item.label}</div>
                            <div className="mt-1 text-xs text-white/40">{item.desc}</div>
                        </Link>
                    ))}
                </div>
            </section>

            <div className="mt-8 pt-8 border-t border-white/8 flex flex-wrap gap-6 text-sm text-white/35">
                <Link href="/" className="hover:text-white/60 transition-colors">← Home</Link>
                <Link href="/docs" className="hover:text-white/60 transition-colors">Documentation</Link>
                <Link href="/contact" className="hover:text-white/60 transition-colors">Contact</Link>
            </div>
        </PublicPageShell>
    );
}
