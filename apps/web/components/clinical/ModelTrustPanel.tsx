import type { ReactNode } from 'react';
import type { CaseDetail } from '@/lib/cases/caseWorkflow';
import type { ClinicalDiagnosisResult } from './clinicalTypes';
import { formatCaseNumber, formatClinicalLabel } from './clinicalTypes';

export function ModelTrustPanel({
    clinicalCase,
    result,
}: {
    clinicalCase: CaseDetail;
    result: ClinicalDiagnosisResult | null;
}) {
    const inference = asRecord(clinicalCase.latest_inference);
    const output = asRecord(inference.output_payload);
    const outputCire = asRecord(output.cire);
    const inferenceCire = asRecord(inference.cire);
    const resultCire = asRecord(result?.cire);
    const cire = { ...outputCire, ...inferenceCire, ...resultCire };
    const inferenceId = result?.inference_event_id
        ?? readText(inference.id)
        ?? clinicalCase.latest_inference_event_id;
    const modelName = readText(inference.model_name) ?? 'VetIOS clinical inference';
    const modelVersion = readText(inference.model_version);
    const promptHash = readText(inference.prompt_template_hash);
    const promptVersion = readText(inference.prompt_template_version);
    const schemaVersion = readText(inference.schema_version);
    const latencyMs = readNumber(inference.inference_latency_ms)
        ?? readNumber(inference.latency_ms)
        ?? readNumber(asRecord(inference.compute_profile).latency_ms);
    const phi = readNumber(cire.phi_hat)
        ?? readNumber(inference.phi_hat)
        ?? result?.confidence
        ?? null;
    const cps = readNumber(cire.cps);
    const safetyState = readText(cire.safety_state) ?? inferSafetyState(phi);
    const outcomeLinked = Boolean(
        clinicalCase.latest_outcome_event_id
        || clinicalCase.confirmed_diagnosis
        || clinicalCase.outcomes.length > 0
        || inference.outcome_confirmed === true,
    );
    const trustItems = [
        Boolean(inferenceId),
        Boolean(modelVersion),
        Boolean(promptHash || promptVersion || schemaVersion),
        phi !== null,
        outcomeLinked,
    ];
    const trustScore = trustItems.filter(Boolean).length;

    return (
        <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <TrustMetric label="Audit readiness" value={`${trustScore}/5`} tone={trustScore >= 4 ? 'accent' : 'warn'} />
                <TrustMetric label="Reliability" value={phi == null ? 'No score' : phi.toFixed(2)} tone={phi != null && phi >= 0.75 ? 'accent' : 'warn'} />
                <TrustMetric label="Safety state" value={formatClinicalLabel(safetyState ?? 'unscored')} tone={safetyState === 'nominal' ? 'accent' : 'warn'} />
                <TrustMetric label="Outcome link" value={outcomeLinked ? 'Linked' : 'Pending'} tone={outcomeLinked ? 'accent' : 'warn'} />
                <TrustMetric label="Latency" value={latencyMs == null ? 'No data' : `${Math.round(latencyMs)}ms`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <TrustBlock title="Inference Lineage">
                    <TrustRow label="Trace" value={inferenceId ? formatCaseNumber(inferenceId) : 'Not recorded'} />
                    <TrustRow label="Model" value={`${modelName}${modelVersion ? ` / ${modelVersion}` : ''}`} />
                    <TrustRow label="Prompt lineage" value={formatPromptLineage(promptHash, promptVersion)} />
                    <TrustRow label="Schema" value={schemaVersion ?? 'Not recorded'} />
                </TrustBlock>

                <TrustBlock title="Reliability Controls">
                    <TrustRow label="CIRE phi" value={phi == null ? 'Not scored' : phi.toFixed(3)} />
                    <TrustRow label="CPS" value={cps == null ? 'Not scored' : cps.toFixed(3)} />
                    <TrustRow label="Safety" value={safetyState ? formatClinicalLabel(safetyState) : 'Not recorded'} />
                    <TrustRow label="Confirmed outcome" value={outcomeLinked ? 'Linked to the case record' : 'Awaiting clinician confirmation'} />
                </TrustBlock>
            </div>

            <div className="rounded-md border border-accent/20 bg-accent/[0.04] p-4 text-sm leading-relaxed text-white/70">
                Trust moat status: {trustScore >= 4
                    ? 'this case has enough lineage for clinical audit review.'
                    : 'this case is usable clinically, but audit strength improves after outcome confirmation and full lineage capture.'}
            </div>
        </div>
    );
}

function TrustMetric({
    label,
    value,
    tone = 'default',
}: {
    label: string;
    value: string;
    tone?: 'default' | 'accent' | 'warn';
}) {
    const toneClass = tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-amber-200' : 'text-white';
    return (
        <div className="rounded-md border border-white/10 bg-white/[0.025] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">{label}</div>
            <div className={`mt-2 text-lg font-semibold ${toneClass}`}>{value}</div>
        </div>
    );
}

function TrustBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">{title}</div>
            <div className="mt-3 divide-y divide-white/8">{children}</div>
        </div>
    );
}

function TrustRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 py-2 text-sm">
            <span className="text-white/48">{label}</span>
            <span className="max-w-[68%] break-words text-right text-white/76">{value}</span>
        </div>
    );
}

function formatPromptLineage(hash: string | null, version: string | null): string {
    const parts = [
        version ? `v${version.replace(/^v/i, '')}` : null,
        hash ? `hash ${shortHash(hash)}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : 'Not recorded';
}

function shortHash(value: string): string {
    const cleaned = value.replace(/[^a-zA-Z0-9]/g, '');
    if (cleaned.length <= 12) return cleaned || value.slice(0, 12);
    return `${cleaned.slice(0, 6)}...${cleaned.slice(-4)}`;
}

function inferSafetyState(phi: number | null): string | null {
    if (phi == null) return null;
    if (phi >= 0.75) return 'nominal';
    if (phi >= 0.5) return 'review';
    return 'caution';
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
