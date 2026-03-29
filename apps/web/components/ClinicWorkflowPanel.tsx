'use client';

import { useState } from 'react';
import {
    ConsoleCard,
    DataRow,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
    TerminalTextarea,
} from '@/components/ui/terminal';

type JsonRecord = Record<string, unknown>;

export interface WorkflowBenchmarkSnapshot {
    id: string;
    metric_name: string;
    support_n: number;
    observed_value: number | null;
    expected_value: number | null;
    risk_adjusted_value: number | null;
    oe_ratio: number | null;
    confidence_interval: JsonRecord;
    window_start: string;
    window_end: string;
}

export interface WorkflowEpisodeDetail {
    episode: {
        id: string;
        clinic_id: string | null;
        patient_id: string;
        latest_encounter_id: string | null;
        status: string;
        outcome_state: string;
        summary: JsonRecord;
    };
    signals: Array<{
        id: string;
        signal_type: string;
        signal_subtype: string | null;
        observed_at: string;
        normalized_facts: JsonRecord;
    }>;
    protocol_executions: Array<{
        id: string;
        status: string;
        trigger_source?: string | null;
        started_at?: string | null;
        recommended_actions?: unknown;
    }>;
    timeline: Array<{
        id: string;
        kind: string;
        at: string;
        title: string;
    }>;
}

interface ClinicWorkflowPanelProps {
    episodeDetail: WorkflowEpisodeDetail;
    benchmarkSnapshot: WorkflowBenchmarkSnapshot | null;
    onEpisodeRefresh: (detail: WorkflowEpisodeDetail) => void;
}

type ConnectorState =
    | { status: 'idle' }
    | { status: 'submitting' }
    | { status: 'success'; message: string }
    | { status: 'error'; message: string };

const CONNECTOR_OPTIONS = [
    { value: 'lab_result', label: 'Lab Result' },
    { value: 'prescription_refill', label: 'Prescription Refill' },
    { value: 'recheck', label: 'Recheck' },
    { value: 'referral', label: 'Referral' },
    { value: 'imaging_report', label: 'Imaging Report' },
] as const;

export function ClinicWorkflowPanel({
    episodeDetail,
    benchmarkSnapshot,
    onEpisodeRefresh,
}: ClinicWorkflowPanelProps) {
    const [connectorState, setConnectorState] = useState<ConnectorState>({ status: 'idle' });

    async function handleConnectorSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const rawPayload = formData.get('rawPayload')?.toString().trim() ?? '{}';
        let payload: JsonRecord;

        try {
            const parsed = JSON.parse(rawPayload);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new Error('Connector payload must be a JSON object.');
            }
            payload = parsed as JsonRecord;
        } catch (error) {
            setConnectorState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Invalid JSON payload.',
            });
            return;
        }

        setConnectorState({ status: 'submitting' });

        try {
            const response = await fetch('/api/signals/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({
                    connector: {
                        connector_type: formData.get('connectorType'),
                        clinic_id: episodeDetail.episode.clinic_id ?? undefined,
                        patient_id: episodeDetail.episode.patient_id,
                        encounter_id: episodeDetail.episode.latest_encounter_id ?? undefined,
                        episode_id: episodeDetail.episode.id,
                        vendor_name: formData.get('vendorName')?.toString().trim() || undefined,
                        vendor_account_ref: formData.get('vendorAccountRef')?.toString().trim() || undefined,
                        observed_at: formData.get('observedAt')?.toString().trim() || undefined,
                        payload,
                    },
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Failed to ingest passive connector signal.');
            }

            const refreshedEpisodeId = typeof result.episode?.id === 'string'
                ? result.episode.id
                : episodeDetail.episode.id;
            const detailResponse = await fetch(`/api/episodes/${refreshedEpisodeId}?limit=20`, {
                credentials: 'same-origin',
                cache: 'no-store',
            });
            const detailResult = await detailResponse.json();
            if (!detailResponse.ok) {
                throw new Error(detailResult.error || 'Passive signal attached, but episode refresh failed.');
            }

            onEpisodeRefresh(detailResult as WorkflowEpisodeDetail);
            setConnectorState({
                status: 'success',
                message: `Attached ${result.connector?.signal_type ?? 'connector'} signal to the current episode.`,
            });
            event.currentTarget.reset();
        } catch (error) {
            setConnectorState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Connector ingestion failed.',
            });
        }
    }

    const benchmarkSummary = benchmarkSnapshot ?? deriveBenchmarkSnapshotFromSummary(episodeDetail.episode.summary);

    return (
        <div className="space-y-6">
            <ConsoleCard title="Clinic Workflow Actions" className="border-blue-400/30">
                <div className="grid gap-4 xl:grid-cols-[1.1fr,1fr]">
                    <div className="space-y-3">
                        <DataRow label="Episode" value={<span className="text-accent">{episodeDetail.episode.id}</span>} />
                        <DataRow label="Status" value={episodeDetail.episode.status} />
                        <DataRow label="Outcome State" value={episodeDetail.episode.outcome_state} />
                        <DataRow label="Passive Signals" value={String(episodeDetail.signals.length)} />
                    </div>

                    <div className="border border-grid p-3 font-mono text-xs">
                        <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted">Benchmark Snapshot</div>
                        {benchmarkSummary ? (
                            <div className="space-y-2">
                                <div className="text-accent text-sm">{benchmarkSummary.metric_name}</div>
                                <div className="grid grid-cols-2 gap-2">
                                    <MiniMetric label="Observed" value={formatPercent(benchmarkSummary.observed_value)} />
                                    <MiniMetric label="Expected" value={formatPercent(benchmarkSummary.expected_value)} />
                                    <MiniMetric label="Risk Adjusted" value={formatPercent(benchmarkSummary.risk_adjusted_value)} />
                                    <MiniMetric label="Support" value={String(benchmarkSummary.support_n)} />
                                </div>
                            </div>
                        ) : (
                            <div className="text-muted">Benchmark rollup will appear after an outcome computes a matched cohort snapshot.</div>
                        )}
                    </div>
                </div>
            </ConsoleCard>

            <ConsoleCard title="Protocol Queue" className="border-grid">
                {episodeDetail.protocol_executions.length === 0 ? (
                    <div className="text-muted font-mono text-xs">No protocol executions are attached to this episode yet.</div>
                ) : (
                    <div className="space-y-4">
                        {episodeDetail.protocol_executions.slice(0, 3).map((execution) => {
                            const actions = asActionList(execution.recommended_actions);
                            return (
                                <div key={execution.id} className="border border-grid p-3 font-mono text-xs">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-accent">{execution.trigger_source ?? execution.id}</span>
                                        <span className="text-muted">{execution.status}</span>
                                    </div>
                                    {actions.length > 0 ? (
                                        <div className="mt-3 space-y-2">
                                            {actions.slice(0, 3).map((action, index) => (
                                                <div key={`${execution.id}-${index}`} className="border border-grid/60 bg-black/20 p-2">
                                                    <div className="text-foreground">{readText(action.title) ?? readText(action.action_key) ?? 'Recommended action'}</div>
                                                    {readText(action.rationale) ? (
                                                        <div className="mt-1 text-muted">{readText(action.rationale)}</div>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="mt-3 text-muted">Protocol execution exists, but no recommended actions were stored.</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </ConsoleCard>

            <ConsoleCard title="Passive Signal Dock" className="border-grid">
                <form onSubmit={handleConnectorSubmit} className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                            <TerminalLabel htmlFor="connector-type">Connector Type</TerminalLabel>
                            <select
                                id="connector-type"
                                name="connectorType"
                                className="w-full border border-grid bg-black/20 px-3 py-2 font-mono text-xs text-foreground outline-none"
                                defaultValue="lab_result"
                            >
                                {CONNECTOR_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="space-y-2">
                            <TerminalLabel htmlFor="connector-observed-at">Observed At</TerminalLabel>
                            <TerminalInput
                                id="connector-observed-at"
                                name="observedAt"
                                type="datetime-local"
                            />
                        </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                            <TerminalLabel htmlFor="connector-vendor-name">Vendor Name</TerminalLabel>
                            <TerminalInput
                                id="connector-vendor-name"
                                name="vendorName"
                                placeholder="e.g. IDEXX, Covetrus, ezyVet"
                            />
                        </label>

                        <label className="space-y-2">
                            <TerminalLabel htmlFor="connector-vendor-account">Vendor Account Ref</TerminalLabel>
                            <TerminalInput
                                id="connector-vendor-account"
                                name="vendorAccountRef"
                                placeholder="Optional account or clinic reference"
                            />
                        </label>
                    </div>

                    <label className="space-y-2">
                        <TerminalLabel htmlFor="connector-payload">Raw Connector Payload (JSON)</TerminalLabel>
                        <TerminalTextarea
                            id="connector-payload"
                            name="rawPayload"
                            rows={8}
                            defaultValue={`{\n  "external_id": "evt_001",\n  "status": "final",\n  "analyte": "CBC",\n  "abnormal": true,\n  "primary_condition_class": "${readText(episodeDetail.episode.summary.latest_condition_class) ?? ''}"\n}`}
                        />
                    </label>

                    <TerminalButton type="submit" disabled={connectorState.status === 'submitting'}>
                        {connectorState.status === 'submitting' ? 'ATTACHING PASSIVE SIGNAL...' : 'INGEST PASSIVE CONNECTOR EVENT'}
                    </TerminalButton>

                    {connectorState.status === 'success' ? (
                        <div className="border border-accent/30 bg-accent/5 p-3 font-mono text-xs text-accent">
                            {connectorState.message}
                        </div>
                    ) : null}
                    {connectorState.status === 'error' ? (
                        <div className="border border-danger/40 bg-danger/5 p-3 font-mono text-xs text-danger">
                            ERR: {connectorState.message}
                        </div>
                    ) : null}
                </form>
            </ConsoleCard>

            <ConsoleCard title="Recent Passive Signals" className="border-grid">
                {episodeDetail.signals.length === 0 ? (
                    <div className="text-muted font-mono text-xs">No passive signals have been attached to this episode yet.</div>
                ) : (
                    <div className="space-y-3">
                        {episodeDetail.signals.slice(0, 5).map((signal) => (
                            <div key={signal.id} className="border border-grid p-3 font-mono text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-accent">
                                        {signal.signal_subtype ? `${signal.signal_type}:${signal.signal_subtype}` : signal.signal_type}
                                    </span>
                                    <span className="text-muted">{formatTimestamp(signal.observed_at)}</span>
                                </div>
                                <div className="mt-2 text-muted">
                                    {summarizeFacts(signal.normalized_facts)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </ConsoleCard>
        </div>
    );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-grid/60 bg-black/20 p-2">
            <div className="text-[9px] uppercase tracking-[0.15em] text-muted">{label}</div>
            <div className="mt-1 text-foreground">{value}</div>
        </div>
    );
}

function asActionList(value: unknown): JsonRecord[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is JsonRecord => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
        : [];
}

function deriveBenchmarkSnapshotFromSummary(summary: JsonRecord): WorkflowBenchmarkSnapshot | null {
    const metricName = readText(summary.latest_benchmark_metric);
    const snapshotId = readText(summary.latest_benchmark_snapshot_id);
    if (!metricName && !snapshotId) return null;

    return {
        id: snapshotId ?? 'summary-derived',
        metric_name: metricName ?? 'episode_benchmark',
        support_n: readNumber(summary.benchmark_support_n) ?? 0,
        observed_value: readNumber(summary.benchmark_observed_value),
        expected_value: readNumber(summary.benchmark_expected_value),
        risk_adjusted_value: readNumber(summary.benchmark_risk_adjusted_value),
        oe_ratio: readNumber(summary.benchmark_oe_ratio),
        confidence_interval: asObject(summary.benchmark_confidence_interval),
        window_start: readText(summary.benchmark_window_start) ?? '',
        window_end: readText(summary.benchmark_window_end) ?? '',
    };
}

function summarizeFacts(facts: JsonRecord) {
    const parts = [
        readText(facts.analyte),
        readText(facts.medication),
        readText(facts.destination),
        readText(facts.modality),
        readText(facts.result_status),
        typeof facts.abnormal === 'boolean' ? (facts.abnormal ? 'abnormal' : 'not abnormal') : null,
        typeof facts.critical === 'boolean' ? (facts.critical ? 'critical' : null) : null,
        readText(facts.recheck_status),
    ].filter((value): value is string => Boolean(value));
    return parts.length > 0 ? parts.join(' | ') : 'No normalized facts available.';
}

function formatPercent(value: number | null) {
    return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'N/A';
}

function formatTimestamp(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asObject(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}
