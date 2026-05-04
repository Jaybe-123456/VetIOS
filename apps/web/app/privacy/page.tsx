import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicPageShell } from '@/components/public/PublicPageShell';

export const metadata: Metadata = {
    title: 'Privacy Policy — VetIOS',
    description: 'How VetIOS collects, uses, and protects your data.',
};

export default function PrivacyPage() {
    return (
        <PublicPageShell
            eyebrow="Legal"
            title="Privacy Policy"
            description="How VetIOS collects, uses, stores, and protects your data. Last updated: May 4, 2026."
        >
            {/* TOC */}
            <nav className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/35 mb-3">Contents</div>
                <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                    {['1. Overview','2. Data We Collect','3. How We Use Data','4. Data Sharing','5. Retention','6. Security','7. Your Rights','8. Cookies','9. Changes','10. Contact'].map((t) => (
                        <a key={t} href={`#section-${t[0]}`} className="text-sm text-white/50 hover:text-[#6BF7CF] transition-colors">{t}</a>
                    ))}
                </div>
            </nav>

            <div className="space-y-12 text-sm leading-7 text-white/65">

                <section id="section-1" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">1. Overview</h2>
                    <p>VetIOS (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) operates the VetIOS platform at <strong className="text-white">vetios.tech</strong> — a closed-loop AI infrastructure service for veterinary clinical intelligence, inference routing, outcome learning, and simulation. This Privacy Policy explains what data we collect, how we use it, who we share it with, and what rights you have.</p>
                    <p className="mt-3">By using the VetIOS platform you agree to this policy. If you do not agree, please do not use the platform.</p>
                </section>

                <section id="section-2" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">2. Data We Collect</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {[
                            { title: 'Account & Identity', body: 'Name, email address, encrypted credentials, role/permission level assigned by your organisation operator, authentication tokens and session identifiers.' },
                            { title: 'Clinical Input Data', body: 'Veterinary case information, patient signals, symptom descriptions, diagnostic queries, and structured clinical inputs submitted to the inference engine. Stored in your tenant\'s isolated partition. Not used to train shared models without explicit consent.' },
                            { title: 'Usage & Telemetry', body: 'Inference session metadata, feature interaction events, latency traces, and diagnostic logs. Retained for up to 90 days to maintain reliability and improve inference quality.' },
                            { title: 'Device & Network', body: 'IP address, browser type, operating system version, referral URL, and viewport metadata — collected automatically for security monitoring and abuse prevention.' },
                        ].map((item) => (
                            <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                                <h3 className="font-semibold text-white mb-2">{item.title}</h3>
                                <p>{item.body}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section id="section-3" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">3. How We Use Your Data</h2>
                    <ul className="space-y-2">
                        {[
                            'To authenticate users and maintain secure account sessions.',
                            'To route clinical inputs through the inference engine and return ranked outputs.',
                            'To persist outcome data for closed-loop learning within your tenant partition.',
                            'To monitor system health, detect abuse, enforce rate limits, and investigate security incidents.',
                            'To send transactional emails: account verification, password reset, access invitations.',
                            'To comply with legal and regulatory obligations.',
                            'To generate anonymised, aggregated platform analytics that do not identify individual users or cases.',
                        ].map((item) => (
                            <li key={item} className="flex items-start gap-3">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6BF7CF]" />
                                {item}
                            </li>
                        ))}
                    </ul>
                    <div className="mt-5 rounded-xl border border-[#6BF7CF]/20 bg-[#6BF7CF]/5 px-4 py-3 text-[#C9FFF0]">
                        We do not sell your personal data or clinical data to any third party.
                    </div>
                </section>

                <section id="section-4" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">4. Data Sharing</h2>
                    <div className="space-y-3">
                        {[
                            { who: 'Infrastructure providers', detail: 'Supabase (database, auth), Vercel (edge delivery), and cloud compute providers — all bound by data processing agreements and operating under our instructions.' },
                            { who: 'AI model providers', detail: 'OpenAI-compatible inference endpoints used for model routing. Clinical inputs transmitted are governed by the provider\'s enterprise data handling policies. VetIOS does not permit model providers to use your clinical data for training.' },
                            { who: 'Your organisation', detail: 'Platform operators within your tenant may access inference sessions, audit logs, and usage telemetry as part of their operator role.' },
                            { who: 'Law enforcement / regulators', detail: 'When required by applicable law, valid legal process, or to protect safety. We will notify you where legally permitted to do so.' },
                        ].map((item) => (
                            <div key={item.who} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <span className="font-semibold text-white">{item.who}: </span>{item.detail}
                            </div>
                        ))}
                    </div>
                </section>

                <section id="section-5" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">5. Retention</h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {[
                            { label: 'Account data', period: 'Active account + 30 days' },
                            { label: 'Clinical inference logs', period: '90 days, then deleted' },
                            { label: 'Outcome learning data', period: 'Until deletion requested' },
                            { label: 'Security / audit logs', period: '12 months' },
                            { label: 'Anonymised telemetry', period: 'Up to 24 months' },
                            { label: 'Billing records', period: '7 years (legal)' },
                        ].map((item) => (
                            <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">{item.label}</div>
                                <div className="mt-1.5 font-medium text-white/80">{item.period}</div>
                            </div>
                        ))}
                    </div>
                </section>

                <section id="section-6" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">6. Security</h2>
                    <ul className="space-y-2">
                        {[
                            'TLS 1.2+ encryption for all data in transit.',
                            'Tenant-isolated data partitions — your clinical data is not co-mingled with other tenants.',
                            'Role-based access control (RBAC) enforced at the API layer.',
                            'Audit logs for all inference events, data access, and admin actions.',
                            'Automated vulnerability scanning and dependency monitoring.',
                            'Password hashing; no plaintext credential storage.',
                        ].map((item) => (
                            <li key={item} className="flex items-start gap-3">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6BF7CF]" />
                                {item}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-4 text-xs text-white/40">No system is completely secure. We will notify affected users of material breaches within 72 hours where required by law.</p>
                </section>

                <section id="section-7" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">7. Your Rights</h2>
                    <p className="mb-4">Depending on your jurisdiction (including GDPR, CCPA, and Kenya&apos;s Data Protection Act 2019), you may have the right to:</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {[
                            { right: 'Access', detail: 'Request a copy of the personal data we hold about you.' },
                            { right: 'Rectification', detail: 'Request correction of inaccurate or incomplete data.' },
                            { right: 'Erasure', detail: 'Request deletion of your data, subject to legal retention requirements.' },
                            { right: 'Portability', detail: 'Request a structured, machine-readable export of your data.' },
                            { right: 'Restriction', detail: 'Request we limit processing of your data in certain circumstances.' },
                            { right: 'Objection', detail: 'Object to processing based on legitimate interests.' },
                        ].map((item) => (
                            <div key={item.right} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="font-semibold text-white">{item.right}</div>
                                <div className="mt-1 text-white/55">{item.detail}</div>
                            </div>
                        ))}
                    </div>
                    <p className="mt-4">Email <a href="mailto:platform@vetios.tech" className="text-[#6BF7CF] hover:underline">platform@vetios.tech</a> to exercise any right. We respond within 30 days.</p>
                </section>

                <section id="section-8" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">8. Cookies</h2>
                    <div className="space-y-2">
                        {[
                            { name: 'auth-session', type: 'Essential', purpose: 'Maintains your authenticated session. Required for platform access.' },
                            { name: 'csrf-token', type: 'Essential', purpose: 'Prevents cross-site request forgery attacks.' },
                            { name: 'theme-preference', type: 'Functional', purpose: 'Stores your display preference. No personal data.' },
                        ].map((cookie) => (
                            <div key={cookie.name} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-start gap-4">
                                <div className="font-mono text-xs text-[#6BF7CF] bg-[#6BF7CF]/10 px-2 py-1 rounded mt-0.5 shrink-0">{cookie.name}</div>
                                <div><span className="text-xs uppercase tracking-widest text-white/35">{cookie.type} · </span>{cookie.purpose}</div>
                            </div>
                        ))}
                    </div>
                    <p className="mt-3">We do not use advertising, tracking, or third-party analytics cookies.</p>
                </section>

                <section id="section-9" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">9. Changes to This Policy</h2>
                    <p>We may update this policy from time to time. Material changes will be communicated by email to registered users and/or a notice on the platform at least 14 days before taking effect. Continued use after changes constitutes acceptance.</p>
                </section>

                <section id="section-10" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">10. Contact</h2>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-1.5">
                        <div><span className="text-white/35">Email: </span><a href="mailto:platform@vetios.tech" className="text-[#6BF7CF] hover:underline">platform@vetios.tech</a></div>
                        <div><span className="text-white/35">Platform: </span><span className="text-white">vetios.tech</span></div>
                        <div><span className="text-white/35">Support: </span><a href="mailto:johnbruce12g@gmail.com" className="text-[#6BF7CF] hover:underline">johnbruce12g@gmail.com</a></div>
                        <div><span className="text-white/35">Response time: </span>Within 30 days</div>
                    </div>
                </section>

            </div>

            <div className="mt-16 pt-8 border-t border-white/8 flex flex-wrap gap-6 text-sm text-white/35">
                <Link href="/" className="hover:text-white/60 transition-colors">← Home</Link>
                <Link href="/terms" className="hover:text-white/60 transition-colors">Terms of Service</Link>
                <Link href="/support" className="hover:text-white/60 transition-colors">Support</Link>
            </div>
        </PublicPageShell>
    );
}
