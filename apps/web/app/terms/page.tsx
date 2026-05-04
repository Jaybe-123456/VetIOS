import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicPageShell } from '@/components/public/PublicPageShell';

export const metadata: Metadata = {
    title: 'Terms of Service — VetIOS',
    description: 'Terms governing your use of the VetIOS veterinary intelligence platform.',
};

export default function TermsPage() {
    return (
        <PublicPageShell
            eyebrow="Legal"
            title="Terms of Service"
            description="Terms governing your use of the VetIOS veterinary intelligence platform. Last updated: May 4, 2026."
        >
            <nav className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/35 mb-3">Contents</div>
                <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                    {['1. Acceptance','2. Platform Use','3. AI Disclaimer','4. Accounts','5. Permitted Use','6. Prohibited Use','7. Intellectual Property','8. Availability','9. Liability','10. Termination','11. Governing Law','12. Changes','13. Contact'].map((t) => (
                        <a key={t} href={`#term-${t[0]}`} className="text-sm text-white/50 hover:text-[#6BF7CF] transition-colors">{t}</a>
                    ))}
                </div>
            </nav>

            <div className="space-y-12 text-sm leading-7 text-white/65">

                <section id="term-1" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">1. Acceptance</h2>
                    <p>By accessing or using the VetIOS platform at <strong className="text-white">vetios.tech</strong> (the &ldquo;Platform&rdquo;), you agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;). If you are using the Platform on behalf of an organisation, you represent that you have authority to bind that organisation to these Terms.</p>
                    <p className="mt-3">If you do not agree to these Terms, you may not use the Platform.</p>
                </section>

                <section id="term-2" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">2. Platform Description</h2>
                    <p>VetIOS is a closed-loop AI infrastructure platform for veterinary intelligence. It provides:</p>
                    <div className="grid gap-3 sm:grid-cols-2 mt-4">
                        {[
                            { title: 'Inference Engine', body: 'Clinical input normalisation, AI-assisted differential diagnosis, and ranked hypothesis output for veterinary cases.' },
                            { title: 'Outcome Learning', body: 'Closed-case supervision events that refine inference priors and improve future decision quality within your tenant.' },
                            { title: 'Simulation Layer', body: 'Pressure-testing of model updates and policy changes against synthetic and replayed case traffic before live rollout.' },
                            { title: 'Operator Console', body: 'Observable runtime, audit trail, telemetry dashboard, and model operations surface for platform operators.' },
                        ].map((item) => (
                            <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                                <h3 className="font-semibold text-white mb-2">{item.title}</h3>
                                <p>{item.body}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section id="term-3" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">3. AI Outputs Disclaimer</h2>
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-amber-100/80 space-y-3">
                        <p><strong className="text-amber-100">VetIOS provides AI-generated outputs for decision support purposes only.</strong></p>
                        <p>All inference outputs, ranked hypotheses, differential diagnoses, drug dose suggestions, and clinical recommendations produced by the Platform are informational aids. They are not a substitute for qualified professional veterinary diagnosis, clinical judgement, or treatment decisions.</p>
                        <p>Licensed veterinary professionals must independently evaluate all AI outputs against the specific patient presentation, applicable clinical standards, current guidelines, and their professional judgement before acting on any output.</p>
                        <p>VetIOS accepts no liability for clinical outcomes arising from reliance on AI outputs without appropriate professional review.</p>
                    </div>
                </section>

                <section id="term-4" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">4. Accounts</h2>
                    <ul className="space-y-2">
                        {[
                            'You must provide accurate and complete information when creating an account.',
                            'You are responsible for maintaining the confidentiality of your credentials and for all activity under your account.',
                            'Accounts are personal and non-transferable unless explicitly assigned as a service account by an operator.',
                            'You must notify us immediately at platform@vetios.tech if you suspect unauthorised access.',
                            'We reserve the right to suspend or terminate accounts that violate these Terms or that pose a security risk.',
                        ].map((item) => (
                            <li key={item} className="flex items-start gap-3">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6BF7CF]" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </section>

                <section id="term-5" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">5. Permitted Use</h2>
                    <p className="mb-4">You may use the Platform only for:</p>
                    <ul className="space-y-2">
                        {[
                            'Lawful veterinary clinical decision support by licensed professionals.',
                            'Veterinary research, case review, and outcome analysis within your organisation.',
                            'Integration and development activities under an authorised partner or developer agreement.',
                            'Internal operator administration of your tenant within your organisation\'s scope.',
                        ].map((item) => (
                            <li key={item} className="flex items-start gap-3">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6BF7CF]" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </section>

                <section id="term-6" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">6. Prohibited Use</h2>
                    <p className="mb-4">You must not:</p>
                    <div className="space-y-2">
                        {[
                            'Submit personal data about human patients, or any data you do not have rights to process.',
                            'Attempt to reverse-engineer, decompile, or extract model weights, inference logic, or proprietary algorithms.',
                            'Use the Platform to train competing AI models or to benchmark VetIOS against competitors for commercial redistribution.',
                            'Introduce malware, conduct denial-of-service attacks, or attempt unauthorised access to other tenants or system components.',
                            'Misrepresent AI outputs as human professional opinion, or use outputs to replace required professional review.',
                            'Resell, sublicense, or white-label the Platform without a written partnership agreement.',
                            'Submit inputs designed to elicit harmful, illegal, or deceptive outputs.',
                        ].map((item) => (
                            <div key={item} className="flex items-start gap-3 rounded-xl border border-red-400/10 bg-red-400/5 px-4 py-3">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section id="term-7" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">7. Intellectual Property</h2>
                    <p>All Platform software, AI models, inference architecture, branding, documentation, and content are the property of VetIOS and its licensors. These Terms do not grant you any ownership rights.</p>
                    <p className="mt-3">You retain ownership of clinical data you submit. By submitting data you grant VetIOS a limited, non-exclusive licence to process that data solely to provide the services described in these Terms and our Privacy Policy.</p>
                    <p className="mt-3">You may not copy, modify, distribute, reverse-engineer, or create derivative works from any part of the Platform without prior written consent.</p>
                </section>

                <section id="term-8" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">8. Availability & Maintenance</h2>
                    <p>VetIOS aims to maintain high platform availability but does not guarantee uninterrupted service. We may perform scheduled maintenance with advance notice where possible. Unplanned outages due to infrastructure failures, security incidents, or third-party provider issues may occur.</p>
                    <p className="mt-3">Platform status is available at <a href="https://vetios.tech" className="text-[#6BF7CF] hover:underline">vetios.tech</a>. Critical system incidents will be communicated to registered operators by email.</p>
                </section>

                <section id="term-9" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">9. Limitation of Liability</h2>
                    <p>To the maximum extent permitted by applicable law:</p>
                    <ul className="space-y-2 mt-3">
                        {[
                            'VetIOS shall not be liable for any indirect, incidental, consequential, special, or punitive damages arising from your use of or inability to use the Platform.',
                            'VetIOS shall not be liable for clinical outcomes, misdiagnoses, or treatment decisions made in reliance on AI outputs.',
                            'Our total aggregate liability to you for any claim arising from these Terms or your use of the Platform shall not exceed the amount you paid to VetIOS in the 12 months preceding the claim.',
                        ].map((item) => (
                            <li key={item} className="flex items-start gap-3">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </section>

                <section id="term-10" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">10. Termination</h2>
                    <p>Either party may terminate access to the Platform at any time. We may suspend or terminate your account immediately and without notice if you materially breach these Terms, engage in prohibited use, or pose a security or legal risk to the Platform or other users.</p>
                    <p className="mt-3">Upon termination, your right to use the Platform ceases immediately. Provisions that by their nature should survive termination (including Sections 3, 7, 9, and 11) will continue to apply.</p>
                </section>

                <section id="term-11" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">11. Governing Law</h2>
                    <p>These Terms are governed by and construed in accordance with the laws of Kenya, without regard to conflict of law principles. Any disputes shall be subject to the exclusive jurisdiction of the courts of Nairobi, Kenya, unless applicable law requires otherwise in your jurisdiction.</p>
                </section>

                <section id="term-12" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">12. Changes to These Terms</h2>
                    <p>We may update these Terms from time to time. We will provide at least 14 days&apos; notice of material changes by email to registered users and/or a notice on the Platform. Continued use of the Platform after changes take effect constitutes acceptance of the revised Terms.</p>
                </section>

                <section id="term-13" className="scroll-mt-24">
                    <h2 className="text-lg font-semibold text-white mb-4">13. Contact</h2>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-1.5">
                        <div><span className="text-white/35">Legal enquiries: </span><a href="mailto:platform@vetios.tech" className="text-[#6BF7CF] hover:underline">platform@vetios.tech</a></div>
                        <div><span className="text-white/35">General support: </span><a href="mailto:johnbruce12g@gmail.com" className="text-[#6BF7CF] hover:underline">johnbruce12g@gmail.com</a></div>
                        <div><span className="text-white/35">Platform: </span><span className="text-white">vetios.tech</span></div>
                    </div>
                </section>

            </div>

            <div className="mt-16 pt-8 border-t border-white/8 flex flex-wrap gap-6 text-sm text-white/35">
                <Link href="/" className="hover:text-white/60 transition-colors">← Home</Link>
                <Link href="/privacy" className="hover:text-white/60 transition-colors">Privacy Policy</Link>
                <Link href="/support" className="hover:text-white/60 transition-colors">Support</Link>
            </div>
        </PublicPageShell>
    );
}
