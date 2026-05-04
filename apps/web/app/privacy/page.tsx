import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
    title: 'Privacy Policy — VetIOS',
    description: 'Privacy Policy for VetIOS, the AI infrastructure platform for veterinary intelligence.',
};

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-[#080808] text-white">
            <div className="max-w-3xl mx-auto px-6 py-16 sm:py-24">
                {/* Header */}
                <div className="mb-12">
                    <Link
                        href="/"
                        className="text-xs uppercase tracking-[0.2em] text-accent/70 font-mono hover:text-accent transition-colors mb-8 inline-block"
                    >
                        ← VetIOS
                    </Link>
                    <h1 className="text-3xl font-bold tracking-tight text-white mt-4">Privacy Policy</h1>
                    <p className="text-white/40 text-sm font-mono mt-2">Last updated: May 4, 2026</p>
                </div>

                <div className="prose prose-invert max-w-none space-y-10 text-white/75 leading-relaxed">

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">1. Overview</h2>
                        <p>
                            VetIOS ("we", "our", or "us") operates the VetIOS platform at <strong className="text-white">vetios.tech</strong> — an AI infrastructure service for veterinary intelligence, inference, and outcome learning. This Privacy Policy explains what data we collect, why we collect it, and how we handle it.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">2. Information We Collect</h2>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong className="text-white">Account data:</strong> name, email address, and credentials when you register.</li>
                            <li><strong className="text-white">Usage data:</strong> inference queries, session metadata, feature usage, and diagnostic logs used to improve platform reliability.</li>
                            <li><strong className="text-white">Clinical input data:</strong> veterinary case information you submit to the inference engine. This data is processed to generate AI responses and is not used to train external models without your explicit consent.</li>
                            <li><strong className="text-white">Device & browser data:</strong> IP address, browser type, operating system, and referral URL collected automatically for security and analytics.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">3. How We Use Your Data</h2>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>To provide and operate the VetIOS platform and its AI inference services.</li>
                            <li>To authenticate users and maintain account security.</li>
                            <li>To monitor system health, detect abuse, and improve platform performance.</li>
                            <li>To send transactional emails (e.g. account verification, password reset).</li>
                            <li>To comply with legal obligations.</li>
                        </ul>
                        <p className="mt-4">We do not sell your personal data to third parties.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">4. Data Sharing</h2>
                        <p>We share data only with:</p>
                        <ul className="list-disc pl-5 space-y-2 mt-2">
                            <li><strong className="text-white">Infrastructure providers</strong> (e.g. Supabase, Vercel) that process data on our behalf under data processing agreements.</li>
                            <li><strong className="text-white">AI model providers</strong> for inference processing, bound by their own privacy and data handling policies.</li>
                            <li><strong className="text-white">Law enforcement or regulators</strong> when required by applicable law.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">5. Data Retention</h2>
                        <p>
                            We retain account data for as long as your account is active. Inference logs are retained for up to 90 days for debugging purposes, after which they are deleted or anonymised. You may request deletion of your data at any time.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">6. Security</h2>
                        <p>
                            We use industry-standard security measures including encrypted data transmission (TLS), access controls, and audit logging. No system is completely secure, and we cannot guarantee absolute security of your data.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">7. Your Rights</h2>
                        <p>Depending on your jurisdiction, you may have the right to:</p>
                        <ul className="list-disc pl-5 space-y-2 mt-2">
                            <li>Access the personal data we hold about you.</li>
                            <li>Request correction or deletion of your data.</li>
                            <li>Object to or restrict certain processing.</li>
                            <li>Request a portable copy of your data.</li>
                        </ul>
                        <p className="mt-4">To exercise any of these rights, contact us at <a href="mailto:platform@vetios.tech" className="text-accent hover:underline">platform@vetios.tech</a>.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">8. Cookies</h2>
                        <p>
                            We use essential cookies to maintain authentication sessions. We do not use tracking or advertising cookies.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">9. Changes to This Policy</h2>
                        <p>
                            We may update this policy from time to time. Material changes will be communicated via email or a notice on the platform. Continued use after changes constitutes acceptance.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">10. Contact</h2>
                        <p>
                            For any privacy-related questions or requests, contact us at:<br />
                            <a href="mailto:platform@vetios.tech" className="text-accent hover:underline">platform@vetios.tech</a>
                        </p>
                    </section>
                </div>

                <div className="mt-16 pt-8 border-t border-white/8 flex gap-6 text-sm text-white/30">
                    <Link href="/" className="hover:text-white/60 transition-colors">Home</Link>
                    <Link href="/terms" className="hover:text-white/60 transition-colors">Terms of Service</Link>
                </div>
            </div>
        </div>
    );
}
