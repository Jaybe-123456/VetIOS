'use client';

import { Database, Gauge, Link2, MessageSquareText, ShieldCheck, Syringe } from 'lucide-react';
import type { PublicEvidenceSnapshot } from '@/lib/platform/publicEvidenceSnapshot';

export default function TrainingSection({ evidenceSnapshot }: { evidenceSnapshot: PublicEvidenceSnapshot }) {
    const metrics = buildEvidenceMetrics(evidenceSnapshot);
    const terminalRows = buildTerminalRows(evidenceSnapshot);

    return (
        <section className="relative overflow-hidden bg-[#050807] py-24 text-[#E8F5EE]">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,136,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,136,0.035)_1px,transparent_1px)] bg-[size:40px_40px]" />
            <div className="relative mx-auto max-w-7xl px-6 lg:px-10">
                <div className="mx-auto mb-14 max-w-3xl text-center">
                    <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[#00FF88]">
                        VetIOS Evidence Infrastructure
                    </div>
                    <h2 className="text-3xl font-semibold tracking-normal text-white md:text-5xl">
                        Building a verifiable clinical dataset
                    </h2>
                    <p className="mt-5 text-base leading-7 text-[#8EA899]">
                        VetIOS now reports the evidence it can verify: case intake, confirmed labels, CIRE validation coverage,
                        and workflow signals from the connected platform. When public dataset access is not configured, this
                        section says so plainly.
                    </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {metrics.map((metric) => (
                        <div key={metric.label} className="rounded-lg border border-[#12352A] bg-[#07110D]/95 p-5">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <metric.icon className="h-5 w-5 text-[#00FF88]" aria-hidden="true" />
                                <span className="rounded border border-[#1D4F3E] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#79DDAE]">
                                    {metric.status}
                                </span>
                            </div>
                            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6B8A76]">
                                {metric.label}
                            </div>
                            <div className="mt-2 text-3xl font-semibold text-white">{metric.value}</div>
                            <p className="mt-3 min-h-[44px] text-sm leading-6 text-[#8EA899]">{metric.detail}</p>
                        </div>
                    ))}
                </div>

                <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="rounded-lg border border-[#12352A] bg-[#07110D]/95 p-6">
                        <div className="mb-5 flex items-center justify-between gap-4">
                            <div>
                                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#00FF88]">
                                    Current Evidence Loop
                                </div>
                                <h3 className="mt-2 text-xl font-semibold text-white">What is real right now</h3>
                            </div>
                            <span className="font-mono text-xs text-[#6B8A76]">{formatTimestamp(evidenceSnapshot.generated_at)}</span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <EvidenceItem label="Real-case import path" value="Live" detail="Consent-gated, de-identified case rows can enter the dataset API." />
                            <EvidenceItem label="Governance lineage" value="Live" detail="Inference events carry prompt, schema, model, and CIRE lineage." />
                            <EvidenceItem label="PIMS workflow intake" value="Live" detail="Clinic workflow events normalize into passive signal contracts." />
                            <EvidenceItem label="CIRE claim status" value={titleCase(evidenceSnapshot.inference.cire_status)} detail={cireDetail(evidenceSnapshot)} />
                            <EvidenceItem label="Claim posture" value={titleCase(evidenceSnapshot.integrity.public_claim_posture)} detail={integrityDetail(evidenceSnapshot)} />
                        </div>
                    </div>

                    <div className="rounded-lg border border-[#12352A] bg-[#020905] p-6 font-mono">
                        <div className="mb-5 flex items-center gap-2">
                            <div className="h-2.5 w-2.5 rounded-full bg-[#FF5F56]" />
                            <div className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
                            <div className="h-2.5 w-2.5 rounded-full bg-[#27C93F]" />
                            <span className="ml-2 text-[11px] uppercase tracking-[0.16em] text-[#6B8A76]">
                                evidence-snapshot
                            </span>
                        </div>
                        <div className="space-y-2 text-xs leading-6">
                            {terminalRows.map((row) => (
                                <div key={row.key} className="grid grid-cols-[120px_1fr] gap-3">
                                    <span className="text-[#00FF88]">{row.key}</span>
                                    <span className={row.tone === 'warning' ? 'text-[#F5A623]' : 'text-[#E8F5EE]'}>
                                        {row.value}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {evidenceSnapshot.warnings.length > 0 && (
                            <div className="mt-5 border border-[#4D3512] bg-[#100A02] p-3 text-[11px] leading-5 text-[#F5A623]">
                                {evidenceSnapshot.warnings.slice(0, 2).join(' ')}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

function EvidenceItem({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className="rounded-md border border-[#12352A] bg-[#06100C] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6B8A76]">{label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{value}</div>
            <p className="mt-2 text-sm leading-6 text-[#8EA899]">{detail}</p>
        </div>
    );
}

function buildEvidenceMetrics(snapshot: PublicEvidenceSnapshot) {
    return [
        {
            label: 'Clinical cases',
            value: formatNumber(snapshot.dataset.clinical_cases),
            detail: snapshot.configured
                ? `${formatNumber(snapshot.dataset.real_case_imports)} imported through the real-case path.`
                : 'Awaiting a configured public tenant before reporting dataset scale.',
            status: snapshot.configured ? 'measured' : 'pending',
            icon: Database,
        },
        {
            label: 'Confirmed labels',
            value: formatNumber(snapshot.dataset.confirmed_labels),
            detail: `${formatNumber(snapshot.dataset.learning_ready_cases)} cases are currently marked learning-ready.`,
            status: snapshot.dataset.confirmed_labels > 0 ? 'measured' : 'building',
            icon: ShieldCheck,
        },
        {
            label: 'CIRE pairs',
            value: formatNumber(snapshot.inference.cire_sample_size),
            detail: cireDetail(snapshot),
            status: titleCase(snapshot.inference.cire_status),
            icon: Gauge,
        },
        {
            label: 'Workflow signals',
            value: formatNumber(snapshot.workflow.passive_signal_events),
            detail: `${formatNumber(snapshot.workflow.pims_templates)} PIMS packs and ${formatNumber(snapshot.workflow.supported_connector_types)} passive event types are defined.`,
            status: snapshot.workflow.passive_signal_events > 0 ? 'measured' : 'ready',
            icon: Link2,
        },
        {
            label: 'Ask VetIOS governance',
            value: formatNumber(snapshot.ask_vetios.query_events),
            detail: `${formatNumber(snapshot.ask_vetios.regulatory_reviewable)} reviewable CDS drafts and ${formatNumber(snapshot.ask_vetios.human_review_required)} human-review routes recorded.`,
            status: snapshot.ask_vetios.query_events > 0 ? 'measured' : 'pending',
            icon: MessageSquareText,
        },
        {
            label: 'AMR loop',
            value: formatNumber(snapshot.amr.stewardship_events),
            detail: `${formatNumber(snapshot.amr.culture_guided_events)} culture-guided stewardship events and ${formatNumber(snapshot.amr.outcome_tracked_events)} outcome-tracked events.`,
            status: snapshot.amr.stewardship_events > 0 || snapshot.amr.genomic_events > 0 ? 'measured' : 'ready',
            icon: Syringe,
        },
    ];
}

function buildTerminalRows(snapshot: PublicEvidenceSnapshot): Array<{ key: string; value: string; tone?: 'warning' }> {
    return [
        {
            key: 'tenant',
            value: snapshot.tenant_id ? `${snapshot.tenant_id.slice(0, 8)}... (${snapshot.source})` : `not configured (${snapshot.source})`,
            tone: snapshot.tenant_id ? undefined : 'warning',
        },
        { key: 'cases', value: formatNumber(snapshot.dataset.clinical_cases) },
        { key: 'labels', value: formatNumber(snapshot.dataset.confirmed_labels) },
        { key: 'imports', value: formatNumber(snapshot.dataset.real_case_imports) },
        { key: 'inferences', value: formatNumber(snapshot.inference.inference_events) },
        { key: 'outcomes', value: formatNumber(snapshot.inference.outcome_linked_inferences) },
        { key: 'cire', value: titleCase(snapshot.inference.cire_status), tone: snapshot.inference.cire_status === 'validated' ? undefined : 'warning' },
        { key: 'ask', value: `${formatNumber(snapshot.ask_vetios.query_events)} governed queries` },
        { key: 'amr', value: `${formatNumber(snapshot.amr.stewardship_events)} stewardship events` },
        { key: 'posture', value: titleCase(snapshot.integrity.public_claim_posture), tone: snapshot.integrity.public_claim_posture === 'evidence_grade_claims' ? undefined : 'warning' },
        { key: 'connectors', value: `${formatNumber(snapshot.workflow.connector_templates)} templates` },
        ...(snapshot.error ? [{ key: 'snapshot', value: snapshot.error, tone: 'warning' as const }] : []),
    ];
}

function cireDetail(snapshot: PublicEvidenceSnapshot): string {
    if (snapshot.inference.cire_status === 'validated') {
        return `Validated with Spearman r=${snapshot.inference.cire_spearman_r ?? 'n/a'}.`;
    }
    if (snapshot.inference.cire_sample_size > 0) {
        return `${formatNumber(snapshot.inference.cire_sample_size)} outcome-linked inference pairs collected; validation threshold not yet met.`;
    }
    return 'Awaiting outcome-linked inference pairs before reliability claims are evidence-grade.';
}

function integrityDetail(snapshot: PublicEvidenceSnapshot): string {
    if (snapshot.integrity.public_claim_posture === 'evidence_grade_claims') {
        return 'Outcome-confirmed evidence and CIRE validation support evidence-grade reliability claims.';
    }
    if (snapshot.integrity.public_claim_posture === 'measured_activity') {
        return 'Live counters are active, but outcome-confirmed reliability claims still need more confirmed pairs.';
    }
    if (!snapshot.configured) {
        return 'Public evidence tenant is not configured, so the page reports architecture only.';
    }
    return 'Architecture is present, but live evidence counters are still at zero.';
}

function formatNumber(value: number): string {
    return Number.isFinite(value) ? value.toLocaleString() : '0';
}

function formatTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'snapshot pending';
    return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function titleCase(value: string): string {
    return value
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
