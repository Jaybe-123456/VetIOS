'use client';

import { PlatformShell } from '@/components/platform/PlatformShell';
import Link from 'next/link';
import { ArrowLeft, Shield, Lock, Eye, FileText } from 'lucide-react';

export default function PrivacyPage() {
    return (
        <PlatformShell
            badge="LEGAL // PRIVACY"
            title="Privacy Policy"
            description="How VetIOS handles clinical data, inference traces, and operator telemetry across the platform mesh."
            showNav={false}
            actions={
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Homepage
                </Link>
            }
        >
            <div className="mx-auto max-w-4xl space-y-12 pb-20">
                <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8 md:p-10">
                    <div className="flex items-start gap-4">
                        <div className="mt-1 rounded-xl border border-accent/20 bg-accent/10 p-2.5 text-accent">
                            <Shield className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-white">Data Collection Architecture</h2>
                            <p className="mt-4 text-sm leading-7 text-slate-300">
                                VetIOS is designed with a "privacy-first" clinical mesh. We collect three primary categories of data to facilitate veterinary intelligence:
                            </p>
                            <ul className="mt-6 space-y-4">
                                <li className="flex gap-3 text-sm text-slate-300">
                                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                                    <div>
                                        <strong className="text-white">Clinical Signal Ingress:</strong> Inputs provided for inference (species, breed, symptoms, vitals). This data is processed through our CIRE (Clinical Intelligence Runtime Engine).
                                    </div>
                                </li>
                                <li className="flex gap-3 text-sm text-slate-300">
                                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                                    <div>
                                        <strong className="text-white">Inference Traces:</strong> Metadata regarding model resolution, confidence bands, and performance metrics used for system optimization.
                                    </div>
                                </li>
                                <li className="flex gap-3 text-sm text-slate-300">
                                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                                    <div>
                                        <strong className="text-white">Operator Telemetry:</strong> Usage patterns within the console to ensure security, auditability, and platform stability.
                                    </div>
                                </li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section className="grid gap-6 md:grid-cols-2">
                    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                        <div className="mb-6 inline-flex rounded-xl border border-blue-400/20 bg-blue-400/10 p-2.5 text-blue-300">
                            <Lock className="h-5 w-5" />
                        </div>
                        <h3 className="text-lg font-semibold text-white">Security & Encryption</h3>
                        <p className="mt-3 text-sm leading-6 text-slate-400">
                            All data is encrypted in transit via TLS 1.3 and at rest using AES-256. We utilize Supabase for robust authentication and Row Level Security (RLS) to ensure that clinical signals are only accessible to authorized tenants.
                        </p>
                    </div>

                    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                        <div className="mb-6 inline-flex rounded-xl border border-purple-400/20 bg-purple-400/10 p-2.5 text-purple-300">
                            <Eye className="h-5 w-5" />
                        </div>
                        <h3 className="text-lg font-semibold text-white">Third-Party Disclosure</h3>
                        <p className="mt-3 text-sm leading-6 text-slate-400">
                            VetIOS does not sell clinical data. We may use anonymized, aggregated signals to train and refine our veterinary models, but specific patient or clinic identities are never shared with external advertisers.
                        </p>
                    </div>
                </section>

                <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                    <div className="flex items-start gap-4">
                        <div className="mt-1 rounded-xl border border-amber-400/20 bg-amber-400/10 p-2.5 text-amber-300">
                            <FileText className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-white">Your Rights & Compliance</h2>
                            <p className="mt-4 text-sm leading-7 text-slate-300">
                                As a platform operator or partner, you retain ownership of your clinical inputs. You may request data exports or deletion of your tenant space at any time via the Control Plane or by contacting our platform team.
                            </p>
                            <div className="mt-8 rounded-2xl border border-white/5 bg-white/5 p-6">
                                <h4 className="text-sm font-medium text-white uppercase tracking-wider">Contact Privacy Team</h4>
                                <p className="mt-2 text-xs text-slate-400">
                                    For inquiries regarding GDPR, CCPA, or specific clinical data handling policies, please reach out to:
                                </p>
                                <p className="mt-2 text-sm font-mono text-accent">privacy@vetios.tech</p>
                            </div>
                        </div>
                    </div>
                </section>
                
                <footer className="text-center text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">
                    Last Updated: May 2026 // Version 1.0
                </footer>
            </div>
        </PlatformShell>
    );
}
