import Link from 'next/link';
import { ArrowLeft, Code2 } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';

export const dynamic = 'force-dynamic';

const sampleResponse = {
    data: {
        signals: [
            {
                signal_id: '2a5f2e69-5e2f-4ddf-b410-73aef9e3c2df',
                species: 'canine',
                drug_code: 'maropitant',
                symptom_codes: ['vomiting', 'lethargy'],
                outcome_severity: 'moderate',
            },
        ],
    },
    error: null,
};

export default function PharmaDeveloperPage() {
    return (
        <PlatformShell
            badge="DEVELOPER // PHARMA"
            title="Adverse event signal API"
            description="Research-tier API access to anonymized veterinary adverse drug reaction signals. The API exposes signal-level drug, species, symptom, and severity data only; no patient, clinic, tenant, or clinical-case linkage is returned."
            actions={(
                <Link
                    href="/developer"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Moat docs
                </Link>
            )}
        >
            <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Endpoint</div>
                    <h2 className="mt-4 font-mono text-xl text-white">GET /api/pharma/signals</h2>
                    <p className="mt-4 text-sm leading-7 text-slate-300">
                        Authenticate with a research-tier API key using a bearer token or x-vetios-api-key header. Filters support species, drug_class, severity, from, to, and limit query parameters.
                    </p>
                    <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-300">
                        Returned fields are intentionally limited to signal_id, species, drug_code, drug_class, symptom_codes, outcome_severity, and created_at.
                    </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-[#0a1323] p-6">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        <Code2 className="h-4 w-4" />
                        Sample response
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-white/6 bg-black/20 p-4 font-mono text-xs leading-6 text-slate-200">
                        {JSON.stringify(sampleResponse, null, 2)}
                    </pre>
                </div>
            </section>
        </PlatformShell>
    );
}
