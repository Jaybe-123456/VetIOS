'use client';

import type { ReactNode } from 'react';
import { type ChangeEvent, useMemo, useState } from 'react';
import { Boxes, HardDrive, RefreshCw, Router } from 'lucide-react';
import {
    ConsoleCard,
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
    TerminalTextarea,
} from '@/components/ui/terminal';
import type {
    EdgeBoxControlPlaneSnapshot,
    EdgeBoxRecord,
} from '@/lib/edgeBox/service';

export default function EdgeBoxOperationsClient({
    initialSnapshot,
    tenantId,
}: {
    initialSnapshot: EdgeBoxControlPlaneSnapshot;
    tenantId: string;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [refreshing, setRefreshing] = useState(false);
    const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message: string }>({
        status: 'idle',
        message: '',
    });
    const [edgeDraft, setEdgeDraft] = useState({
        node_name: '',
        site_label: '',
        hardware_class: '',
        status: 'provisioning',
        software_version: '',
    });
    const [jobDraft, setJobDraft] = useState({
        edge_box_id: initialSnapshot.edge_boxes[0]?.id ?? '',
        job_type: 'config_sync',
        direction: 'cloud_to_edge',
        payload: '{\n  "scope": "full"\n}',
    });
    const [artifactDraft, setArtifactDraft] = useState({
        edge_box_id: initialSnapshot.edge_boxes[0]?.id ?? '',
        artifact_type: 'config_bundle',
        artifact_ref: '',
        content_hash: '',
        size_bytes: '0',
    });

    const latestBox = useMemo(() => snapshot.edge_boxes[0] ?? null, [snapshot.edge_boxes]);

    async function refreshSnapshot() {
        setRefreshing(true);
        try {
            const res = await fetch('/api/platform/edge-box', { cache: 'no-store' });
            const data = await res.json() as { snapshot?: EdgeBoxControlPlaneSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Failed to refresh edge-box snapshot.');
            }
            setSnapshot(data.snapshot);
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to refresh edge-box snapshot.',
            });
        } finally {
            setRefreshing(false);
        }
    }

    async function runAction(body: Record<string, unknown>, successMessage: string) {
        setActionState({ status: 'running', message: 'Running edge-box operation...' });
        try {
            const res = await fetch('/api/platform/edge-box', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json() as { snapshot?: EdgeBoxControlPlaneSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Edge-box operation failed.');
            }
            const nextSnapshot = data.snapshot;
            setSnapshot(nextSnapshot);
            if (nextSnapshot.edge_boxes[0]?.id) {
                setJobDraft((current) => ({ ...current, edge_box_id: current.edge_box_id || nextSnapshot.edge_boxes[0].id }));
                setArtifactDraft((current) => ({ ...current, edge_box_id: current.edge_box_id || nextSnapshot.edge_boxes[0].id }));
            }
            setActionState({ status: 'success', message: successMessage });
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Edge-box operation failed.',
            });
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="EDGE BOX OPS"
                description="Provision offline nodes, stage sync artifacts, and queue edge synchronization so the infrastructure moat extends beyond always-online clinics."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<HardDrive className="h-4 w-4" />} label="Online Nodes" value={snapshot.summary.online_nodes} />
                <SummaryCard icon={<Router className="h-4 w-4" />} label="Degraded Nodes" value={snapshot.summary.degraded_nodes} tone={snapshot.summary.degraded_nodes > 0 ? 'warning' : 'neutral'} />
                <SummaryCard icon={<RefreshCw className="h-4 w-4" />} label="Queued Jobs" value={snapshot.summary.queued_jobs} />
                <SummaryCard icon={<Boxes className="h-4 w-4" />} label="Staged Artifacts" value={snapshot.summary.staged_artifacts} />
            </div>

            <ConsoleCard title="Edge Control" className="mt-6">
                <div className="flex flex-wrap items-center gap-2">
                    <TerminalButton variant="secondary" onClick={() => void refreshSnapshot()} disabled={refreshing}>
                        <RefreshCw className="mr-2 h-3 w-3" />
                        {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
                    </TerminalButton>
                    <div className="font-mono text-xs text-muted">Tenant: {tenantId}</div>
                </div>
                <ActionStatePanel state={actionState} />
            </ConsoleCard>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Register Edge Box">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Node Name" value={edgeDraft.node_name} onChange={(value) => setEdgeDraft((current) => ({ ...current, node_name: value }))} />
                        <FormField label="Site Label" value={edgeDraft.site_label} onChange={(value) => setEdgeDraft((current) => ({ ...current, site_label: value }))} />
                        <FormField label="Hardware Class" value={edgeDraft.hardware_class} onChange={(value) => setEdgeDraft((current) => ({ ...current, hardware_class: value }))} />
                        <FormField label="Software Version" value={edgeDraft.software_version} onChange={(value) => setEdgeDraft((current) => ({ ...current, software_version: value }))} />
                        <SelectField
                            label="Status"
                            value={edgeDraft.status}
                            options={['provisioning', 'online', 'degraded', 'offline', 'retired']}
                            onChange={(value) => setEdgeDraft((current) => ({ ...current, status: value }))}
                        />
                    </div>
                    <div className="pt-4">
                        <TerminalButton onClick={() => void runAction({ action: 'create_edge_box', ...edgeDraft }, 'Edge box registered.')}>
                            Register Edge Box
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Queue Sync Job">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Edge Box ID" value={jobDraft.edge_box_id} onChange={(value) => setJobDraft((current) => ({ ...current, edge_box_id: value }))} />
                        <SelectField
                            label="Job Type"
                            value={jobDraft.job_type}
                            options={['config_sync', 'model_bundle', 'dataset_delta', 'telemetry_flush']}
                            onChange={(value) => setJobDraft((current) => ({ ...current, job_type: value }))}
                        />
                        <SelectField
                            label="Direction"
                            value={jobDraft.direction}
                            options={['cloud_to_edge', 'edge_to_cloud']}
                            onChange={(value) => setJobDraft((current) => ({ ...current, direction: value }))}
                        />
                    </div>
                    <div className="mt-4">
                        <TerminalLabel>Payload</TerminalLabel>
                        <TerminalTextarea value={jobDraft.payload} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setJobDraft((current) => ({ ...current, payload: event.target.value }))} />
                    </div>
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'queue_sync_job',
                                edge_box_id: jobDraft.edge_box_id,
                                job_type: jobDraft.job_type,
                                direction: jobDraft.direction,
                                payload: parseJson(jobDraft.payload),
                            }, 'Edge sync job queued.')}
                        >
                            Queue Sync Job
                        </TerminalButton>
                    </div>
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Register Edge Artifact">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Edge Box ID" value={artifactDraft.edge_box_id} onChange={(value) => setArtifactDraft((current) => ({ ...current, edge_box_id: value }))} />
                        <SelectField
                            label="Artifact Type"
                            value={artifactDraft.artifact_type}
                            options={['config_bundle', 'model_bundle', 'dataset_delta', 'telemetry_archive']}
                            onChange={(value) => setArtifactDraft((current) => ({ ...current, artifact_type: value }))}
                        />
                        <FormField label="Artifact Ref" value={artifactDraft.artifact_ref} onChange={(value) => setArtifactDraft((current) => ({ ...current, artifact_ref: value }))} />
                        <FormField label="Content Hash" value={artifactDraft.content_hash} onChange={(value) => setArtifactDraft((current) => ({ ...current, content_hash: value }))} />
                        <FormField label="Size Bytes" value={artifactDraft.size_bytes} onChange={(value) => setArtifactDraft((current) => ({ ...current, size_bytes: value }))} />
                    </div>
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'register_artifact',
                                edge_box_id: artifactDraft.edge_box_id,
                                artifact_type: artifactDraft.artifact_type,
                                artifact_ref: artifactDraft.artifact_ref,
                                content_hash: artifactDraft.content_hash,
                                size_bytes: Number(artifactDraft.size_bytes || '0'),
                            }, 'Edge artifact registered.')}
                        >
                            Stage Artifact
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Latest Edge Box">
                    {latestBox ? (
                        <EdgeBoxDetail edgeBox={latestBox} />
                    ) : (
                        <div className="font-mono text-xs text-muted">No edge box registered yet.</div>
                    )}
                </ConsoleCard>
            </div>
        </Container>
    );
}

function SummaryCard({
    icon,
    label,
    value,
    tone = 'neutral',
}: {
    icon: ReactNode;
    label: string;
    value: number;
    tone?: 'neutral' | 'warning';
}) {
    return (
        <ConsoleCard className={tone === 'warning' ? 'border-warning/30 text-warning' : undefined}>
            <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
                <div>{icon}</div>
            </div>
            <div className="font-mono text-3xl">{value}</div>
        </ConsoleCard>
    );
}

function FormField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            <TerminalInput value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
        </div>
    );
}

function SelectField({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            <select
                value={value}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
                className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground"
            >
                {options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        </div>
    );
}

function EdgeBoxDetail({ edgeBox }: { edgeBox: EdgeBoxRecord }) {
    return (
        <>
            <DataRow label="Node" value={edgeBox.node_name} />
            <DataRow label="Site" value={edgeBox.site_label} />
            <DataRow label="Status" value={edgeBox.status.toUpperCase()} />
            <DataRow label="Hardware" value={edgeBox.hardware_class ?? 'NO DATA'} />
            <DataRow label="Software" value={edgeBox.software_version ?? 'NO DATA'} />
            <DataRow label="Heartbeat" value={edgeBox.last_heartbeat_at ?? 'NO DATA'} />
        </>
    );
}

function ActionStatePanel({
    state,
}: {
    state: {
        status: 'idle' | 'running' | 'success' | 'error';
        message: string;
    };
}) {
    if (state.status === 'idle' || !state.message) {
        return null;
    }

    const tone = state.status === 'error'
        ? 'border-danger/30 bg-danger/10 text-danger'
        : state.status === 'success'
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-warning/30 bg-warning/10 text-warning';

    return <div className={`mt-4 border px-4 py-3 font-mono text-xs ${tone}`}>{state.message}</div>;
}

function parseJson(value: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}
