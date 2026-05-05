'use client';

import { PlatformShell } from '@/components/platform/PlatformShell';
import Link from 'next/link';
import { ArrowLeft, Scale, AlertTriangle, Cpu, Globe } from 'lucide-react';

export default function TermsPage() {
    return (
        <PlatformShell
            badge="LEGAL // TERMS"
            title="Terms of Service"
            description="Governing the use of VetIOS clinical intelligence infrastructure and inference services."
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
                            <Scale className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-white">Agreement to Terms</h2>
                            <p className="mt-4 text-sm leading-7 text-slate-300">
                                By accessing or using the VetIOS platform, you agree to be bound by these Terms of Service. This platform is a clinical decision support tool and is intended for use by veterinary professionals only.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="rounded-[28px] border border-danger/20 bg-danger/5 p-8">
                    <div className="flex items-start gap-4">
                        <div className="mt-1 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-danger">
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-white">Clinical Disclaimer</h2>
                            <p className="mt-4 text-sm leading-7 text-slate-300">
                                <strong className="text-danger">IMPORTANT:</strong> VetIOS provides AI-generated clinical hypotheses and decision support based on available data. It is NOT a replacement for professional veterinary judgment. Final diagnosis and treatment decisions remain the sole responsibility of the attending licensed veterinarian.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="grid gap-6 md:grid-cols-2">
                    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                        <div className="mb-6 inline-flex rounded-xl border border-blue-400/20 bg-blue-400/10 p-2.5 text-blue-300">
                            <Cpu className="h-5 w-5" />
                        </div>
                        <h3 className="text-lg font-semibold text-white">Platform Usage</h3>
                        <p className="mt-3 text-sm leading-6 text-slate-400">
                            Users are prohibited from using the platform for any unlawful purpose, attempting to reverse-engineer model weights, or submitting intentionally fraudulent clinical data into the flywheel.
                        </p>
                    </div>

                    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                        <div className="mb-6 inline-flex rounded-xl border border-green-400/20 bg-green-400/10 p-2.5 text-green-300">
                            <Globe className="h-5 w-5" />
                        </div>
                        <h3 className="text-lg font-semibold text-white">Service Availability</h3>
                        <p className="mt-3 text-sm leading-6 text-slate-400">
                            While we strive for high uptime (99.9% target), VetIOS is provided "as is." We do not guarantee uninterrupted access during maintenance windows or upstream model provider outages.
                        </p>
                    </div>
                </section>

                <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                    <h2 className="text-xl font-semibold text-white">Limitation of Liability</h2>
                    <p className="mt-4 text-sm leading-7 text-slate-300">
                        To the maximum extent permitted by law, VetIOS and its operators shall not be liable for any indirect, incidental, special, or consequential damages resulting from the use or inability to use the platform, including but not limited to clinical outcomes or data loss.
                    </p>
                </section>
                
                <footer className="text-center text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">
                    Last Updated: May 2026 // Version 1.0
                </footer>
            </div>
        </PlatformShell>
    );
}
