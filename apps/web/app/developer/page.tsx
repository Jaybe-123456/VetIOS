import Link from 'next/link';
import { ArrowRight, Code2, Gauge, KeyRound, ShieldCheck } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';

export const dynamic = 'force-static';

export default function DeveloperPage() {
    return (
        <PlatformShell
            badge="DEVELOPER"
            title="Developer quickstart"
            description="Authenticate, submit your first diagnostic request, read the CIRE signals, and stay inside the tenant rate limit."
            actions={(
                <>
                    <Link
                        href="/api/public/developer-openapi.yaml"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        OpenAPI spec
                        <Code2 className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Docs
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </>
            )}
        >
            <section className="grid gap-4 lg:grid-cols-2">
                <article className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                    <KeyRound className="h-5 w-5 text-cyan-200" />
                    <h2 className="mt-4 text-xl font-semibold text-white">Authentication</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-300">
                        VetIOS API routes require an authenticated Supabase session or an issued machine API key. The full auth flow lives in <Link className="text-cyan-200 underline-offset-4 hover:underline" href="/docs">the docs</Link>.
                    </p>
                </article>

                <article className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                    <Gauge className="h-5 w-5 text-cyan-200" />
                    <h2 className="mt-4 text-xl font-semibold text-white">Rate limits</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-300">
                        The inference endpoint allows 60 requests per minute per tenant and returns 429 with rate-limit reset headers when the window is exhausted.
                    </p>
                </article>
            </section>

            <section className="mt-8 rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Your first inference request</div>
                <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-slate-200">{`curl -X POST https://www.vetios.tech/api/inference \\
  -H "Authorization: Bearer $SESSION_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": { "name": "VetIOS Diagnostics", "version": "latest" },
    "input": {
      "input_signature": {
        "species": "canine",
        "symptoms": ["vomiting", "lethargy"],
        "metadata": { "age_years": 3, "labs": { "wbc": 4.1, "pcv": 29 } }
      }
    }
  }'`}</pre>
            </section>

            <section className="mt-8 rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                <ShieldCheck className="h-5 w-5 text-cyan-200" />
                <h2 className="mt-4 text-xl font-semibold text-white">Handling the response</h2>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                    The response includes ranked differentials and CIRE signals. `phi_hat` measures differential concentration, `cps` measures runtime perturbation pressure, and `safety_state` controls publication. These signals are not clinical correctness estimates.
                </p>
                <div className="mt-5">
                    <Link
                        href="/api/public/developer-openapi.yaml"
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-400/15"
                    >
                        Open full API schema
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </section>
        </PlatformShell>
    );
}
