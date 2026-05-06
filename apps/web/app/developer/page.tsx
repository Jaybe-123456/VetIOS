import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, Code2, Database, ShieldCheck } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';

export const dynamic = 'force-dynamic';

const modules = [
    ['Audit Chain', 'Hash-chained inference, outcome, simulation, lab, imaging, telemetry, outbreak, and ADR events.'],
    ['Inference-at-Intake', 'Structured intake sessions call the existing inference route and surface gated differentials before the visit opens.'],
    ['Exotic and Livestock AI', 'Species knowledge graph priors extend inference for avian, reptile, rabbit, ferret, equine, bovine, ovine, caprine, and porcine cases.'],
    ['Cross-Clinic Learning', 'Outcome-linked population signals are anonymized, tenant-hashed, and calibrated by cron.'],
    ['Lab Agents', 'Inference events produce ranked lab panel recommendations and lab result events feed the diagnostic chain.'],
    ['Multimodal Imaging', 'Passive DICOM ingestion enriches inference with structured imaging findings.'],
    ['Wearables Telemetry', 'Passive connector telemetry stores readings, detects anomalies, and emits inference-ready events.'],
    ['Telemedicine Inference', 'Remote sessions reuse intake sessions and convert optional owner text into confirmed symptom codes only.'],
    ['Outbreak Warning', 'Population symptom clusters generate elevated and alert snapshots with webhook fanout.'],
    ['Pharma ADR Pipeline', 'Outcome-linked drug signals become anonymized research-tier ADR API events.'],
];

const routeGroups = [
    ['/api/intake', 'POST', 'Structured intake with immediate inference.'],
    ['/api/population/contribute', 'POST', 'Closed-case anonymized signal contribution.'],
    ['/api/cron/population-calibration', 'POST', 'Six-hour confidence calibration cron.'],
    ['/api/labs/recommend', 'POST', 'Lab recommendation agent.'],
    ['/api/imaging/ingest', 'POST', 'Passive DICOM and imaging connector intake.'],
    ['/api/telemetry/ingest', 'POST', 'Passive wearable telemetry batches.'],
    ['/api/teleconsult/session', 'POST', 'Remote consultation intake session creation.'],
    ['/api/cron/outbreak-scan', 'POST', 'Regional symptom cluster scan.'],
    ['/api/pharma/signals', 'GET', 'Research-tier ADR signal API.'],
    ['/api/audit/verify', 'POST', 'External audit-chain verification.'],
];

export default function DeveloperMoatPage() {
    return (
        <PlatformShell
            badge="DEVELOPER // MOAT"
            title="Closed-loop intelligence modules"
            description="Operational endpoints for the expanded VetIOS event-sourced intelligence stack. These surfaces extend the existing inference, outcome, simulation, outbox, and telemetry loops instead of replacing them."
            actions={(
                <>
                    <Link
                        href="/api-spec/openapi-v1.yaml"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        OpenAPI spec
                        <Code2 className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/developer/pharma"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Pharma API
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </>
            )}
        >
            <section className="grid gap-4 md:grid-cols-3">
                <SummaryCard icon={<ShieldCheck className="h-5 w-5" />} label="Audit posture" value="Append-only hash chain" />
                <SummaryCard icon={<Database className="h-5 w-5" />} label="Schema model" value="Structured clinical JSON and enums" />
                <SummaryCard icon={<Code2 className="h-5 w-5" />} label="Routing rule" value="Existing inference loop only" />
            </section>

            <section className="mt-8 grid gap-4 lg:grid-cols-2">
                {modules.map(([title, detail]) => (
                    <article key={title} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</div>
                        <p className="mt-3 text-sm leading-7 text-slate-300">{detail}</p>
                    </article>
                ))}
            </section>

            <section className="mt-8 rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Route Surface</div>
                <div className="mt-4 grid gap-3">
                    {routeGroups.map(([path, method, detail]) => (
                        <div key={path} className="grid gap-3 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-300 md:grid-cols-[90px_260px_1fr]">
                            <span className="font-mono text-emerald-200">{method}</span>
                            <span className="font-mono text-white">{path}</span>
                            <span>{detail}</span>
                        </div>
                    ))}
                </div>
            </section>
        </PlatformShell>
    );
}

function SummaryCard({
    icon,
    label,
    value,
}: {
    icon: ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3 text-slate-300">
                {icon}
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">{label}</span>
            </div>
            <div className="mt-3 text-sm font-semibold text-white">{value}</div>
        </div>
    );
}
