import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
    title: 'Terms of Service — VetIOS',
    description: 'Terms of Service for VetIOS, the AI infrastructure platform for veterinary intelligence.',
};

export default function TermsPage() {
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
                    <h1 className="text-3xl font-bold tracking-tight text-white mt-4">Terms of Service</h1>
                    <p className="text-white/40 text-sm font-mono mt-2">Last updated: May 4, 2026</p>
                </div>

                <div className="prose prose-invert max-w-none space-y-10 text-white/75 leading-relaxed">

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">1. Acceptance</h2>
                        <p>
                            By accessing or using VetIOS ("the Platform") at <strong className="text-white">vetios.tech</strong>, you agree to these Terms of Service. If you do not agree, do not use the Platform.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">2. Platform Use</h2>
                        <p>VetIOS is an AI-assisted veterinary intelligence platform. It is intended for use by licensed veterinary professionals and researchers. You agree to:</p>
                        <ul className="list-disc pl-5 space-y-2 mt-2">
                            <li>Use the Platform only for lawful veterinary and research purposes.</li>
                            <li>Not submit personal data about humans or data you do not have the right to process.</li>
                            <li>Not attempt to reverse-engineer, abuse, or disrupt the Platform.</li>
                            <li>Not use AI outputs as a substitute for professional veterinary judgement.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">3. AI Outputs Disclaimer</h2>
                        <p>
                            VetIOS provides AI-generated inference outputs for informational and decision-support purposes only. Outputs are not a substitute for qualified veterinary diagnosis, treatment, or advice. Always apply professional judgement. VetIOS accepts no liability for clinical decisions based solely on AI outputs.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">4. Accounts</h2>
                        <p>
                            You are responsible for maintaining the confidentiality of your account credentials. Notify us immediately at <a href="mailto:platform@vetios.tech" className="text-accent hover:underline">platform@vetios.tech</a> if you suspect unauthorised access. We reserve the right to suspend accounts that violate these Terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">5. Intellectual Property</h2>
                        <p>
                            All Platform software, models, branding, and content are the property of VetIOS and its licensors. You may not copy, modify, or distribute any part of the Platform without prior written consent.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">6. Limitation of Liability</h2>
                        <p>
                            To the maximum extent permitted by law, VetIOS shall not be liable for any indirect, incidental, consequential, or punitive damages arising from your use of the Platform. Our total liability shall not exceed the amount you paid to us in the 12 months preceding the claim.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">7. Changes</h2>
                        <p>
                            We may update these Terms at any time. Continued use of the Platform after changes constitutes acceptance of the revised Terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">8. Contact</h2>
                        <p>
                            Questions about these Terms? Contact us at <a href="mailto:platform@vetios.tech" className="text-accent hover:underline">platform@vetios.tech</a>.
                        </p>
                    </section>
                </div>

                <div className="mt-16 pt-8 border-t border-white/8 flex gap-6 text-sm text-white/30">
                    <Link href="/" className="hover:text-white/60 transition-colors">Home</Link>
                    <Link href="/privacy" className="hover:text-white/60 transition-colors">Privacy Policy</Link>
                </div>
            </div>
        </div>
    );
}
