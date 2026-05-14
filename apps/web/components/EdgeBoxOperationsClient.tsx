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
    EdgeSyncArtifactRecord,
    EdgeSyncJobRecord,
} from '@/lib/edgeBox/service';

const EDGE_CARD_CLASS = 'ring-1 ring-[hsl(0_0%_24%)] shadow-[0_14px_40px_rgba(0,0,0,0.35)]';
const EDGE_INPUT_CLASS = 'border-[hsl(0_0%_38%)] bg-[hsl(0_0%_10%)] text-[hsl(0_0%_98%)] placeholder:text-[hsl(0_0%_68%)] focus:border-accent';
const EDGE_SELECT_CLASS = 'w-full border border-[hsl(0_0%_38%)] bg-[hsl(0_0%_10%)] p-3 font-mono text-sm font-semibold text-[hsl(0_0%_98%)] focus:border-accent focus:outline-none';
const EDGE_TEXTAREA_CLASS = 'border-[hsl(0_0%_38%)] bg-[hsl(0_0%_10%)] text-[hsl(0_0%_98%)] placeholder:text-[hsl(0_0%_68%)] focus:border-accent';
const EDGE_ROW_CLASS = 'border border-[hsl(0_0%_28%)] bg-[hsl(0_0%_8%)] p-3';
const EDGE_EMPTY_CLASS = 'border border-[hsl(0_0%_28%)] bg-[hsl(0_0%_8%)] p-3 font-mono text-xs text-[hsl(0_0%_78%)]';

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
    const [provisioning, setProvisioning] = useState<{ edge_box_id: string; token: string; endpoint: string } | null>(null);
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
            const data = await res.json() as {
                snapshot?: EdgeBoxControlPlaneSnapshot;
                edge_box?: EdgeBoxRecord;
                provisioning_token?: string;
                sync_endpoint?: string;
                error?: string;
            };
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
            const data = await res.json() as {
                snapshot?: EdgeBoxControlPlaneSnapshot;
                edge_box?: EdgeBoxRecord;
                provisioning_token?: string;
                sync_endpoint?: string;
                error?: string;
            };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Edge-box operation failed.');
            }
            const nextSnapshot = data.snapshot;
            setSnapshot(nextSnapshot);
            if (nextSnapshot.edge_boxes[0]?.id) {
                setJobDraft((current) => ({ ...current, edge_box_id: current.edge_box_id || nextSnapshot.edge_boxes[0].id }));
                setArtifactDraft((current) => ({ ...current, edge_box_id: current.edge_box_id || nextSnapshot.edge_boxes[0].id }));
            }
            if (data.edge_box && data.provisioning_token) {
                setProvisioning({
                    edge_box_id: data.edge_box.id,
                    token: data.provisioning_token,
                    endpoint: data.sync_endpoint ?? '/api/edge-box/sync',
                });
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

            <ConsoleCard title="Edge Control" className={`mt-6 ${EDGE_CARD_CLASS}`}>
                <div className="flex flex-wrap items-center gap-2">
                    <TerminalButton variant="secondary" onClick={() => void refreshSnapshot()} disabled={refreshing}>
                        <RefreshCw className="mr-2 h-3 w-3" />
                        {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
                    </TerminalButton>
                    <div className="border border-[hsl(0_0%_30%)] bg-[hsl(0_0%_8%)] px-3 py-2 font-mono text-xs text-[hsl(0_0%_82%)]">
                        Tenant: <span className="text-[hsl(0_0%_96%)]">{tenantId}</span>
                    </div>
                </div>
                <ActionStatePanel state={actionState} />
                {provisioning && (
                    <div className="mt-4 border border-warning/70 bg-warning/15 p-4 font-mono text-xs text-[hsl(45_100%_76%)]">
                        <div className="uppercase tracking-[0.18em]">One-time provisioning token</div>
                        <DataRow label="Edge Box ID" value={provisioning.edge_box_id} tone="warning" />
                        <DataRow label="Sync Endpoint" value={provisioning.endpoint} tone="warning" />
                        <DataRow label="Token" value={provisioning.token} tone="warning" />
                    </div>
                )}
            </ConsoleCard>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Register Edge Box" className={EDGE_CARD_CLASS}>
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

                <ConsoleCard title="Queue Sync Job" className={EDGE_CARD_CLASS}>
                    <div className="grid gap-4 md:grid-cols-2">
                        <EdgeBoxSelect
                            label="Edge Box"
                            value={jobDraft.edge_box_id}
                            edgeBoxes={snapshot.edge_boxes}
                            onChange={(value) => setJobDraft((current) => ({ ...current, edge_box_id: value }))}
                        />
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
                        <TerminalTextarea className={EDGE_TEXTAREA_CLASS} value={jobDraft.payload} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setJobDraft((current) => ({ ...current, payload: event.target.value }))} />
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
                <ConsoleCard title="Register Edge Artifact" className={EDGE_CARD_CLASS}>
                    <div className="grid gap-4 md:grid-cols-2">
                        <EdgeBoxSelect
                            label="Edge Box"
                            value={artifactDraft.edge_box_id}
                            edgeBoxes={snapshot.edge_boxes}
                            allowGlobal
                            onChange={(value) => setArtifactDraft((current) => ({ ...current, edge_box_id: value }))}
                        />
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

                <ConsoleCard title="Latest Edge Box" className={EDGE_CARD_CLASS}>
                    {latestBox ? (
                        <EdgeBoxDetail edgeBox={latestBox} />
                    ) : (
                        <div className={EDGE_EMPTY_CLASS}>No edge box registered yet.</div>
                    )}
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Sync Job Queue" className={EDGE_CARD_CLASS}>
                    {snapshot.sync_jobs.length === 0 ? (
                        <div className={EDGE_EMPTY_CLASS}>No edge sync jobs queued.</div>
                    ) : (
                        <div className="space-y-3">
                            {snapshot.sync_jobs.slice(0, 10).map((job) => <SyncJobRow key={job.id} job={job} edgeBoxes={snapshot.edge_boxes} />)}
                        </div>
                    )}
                </ConsoleCard>

                <ConsoleCard title="Artifact Staging" className={EDGE_CARD_CLASS}>
                    {snapshot.sync_artifacts.length === 0 ? (
                        <div className={EDGE_EMPTY_CLASS}>No edge artifacts staged.</div>
                    ) : (
                        <div className="space-y-3">
                            {snapshot.sync_artifacts.slice(0, 10).map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} edgeBoxes={snapshot.edge_boxes} />)}
                        </div>
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
        <ConsoleCard className={`${EDGE_CARD_CLASS} ${tone === 'warning' ? 'ring-warning/50 text-warning' : ''}`}>
            <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[hsl(0_0%_78%)]">{label}</div>
                <div className={tone === 'warning' ? 'text-warning' : 'text-accent'}>{icon}</div>
            </div>
            <div className="font-mono text-3xl font-semibold text-[hsl(0_0%_98%)]">{value}</div>
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
            <TerminalInput className={EDGE_INPUT_CLASS} value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
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
                className={EDGE_SELECT_CLASS}
            >
                {options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        </div>
    );
}

function EdgeBoxSelect({
    label,
    value,
    edgeBoxes,
    allowGlobal = false,
    onChange,
}: {
    label: string;
    value: string;
    edgeBoxes: EdgeBoxRecord[];
    allowGlobal?: boolean;
    onChange: (value: string) => void;
}) {
    if (edgeBoxes.length === 0) {
        return <FormField label={`${label} ID`} value={value} onChange={onChange} />;
    }

    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            <select
                value={value}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
                className={EDGE_SELECT_CLASS}
            >
                {allowGlobal && <option value="">All edge boxes</option>}
                {edgeBoxes.map((box) => (
                    <option key={box.id} value={box.id}>{box.node_name} / {box.site_label}</option>
                ))}
            </select>
        </div>
    );
}

function EdgeBoxDetail({ edgeBox }: { edgeBox: EdgeBoxRecord }) {
    return (
        <>
            <DataRow label="ID" value={edgeBox.id} />
            <DataRow label="Node" value={edgeBox.node_name} />
            <DataRow label="Site" value={edgeBox.site_label} />
            <DataRow label="Status" value={edgeBox.status.toUpperCase()} />
            <DataRow label="Hardware" value={edgeBox.hardware_class ?? 'NO DATA'} />
            <DataRow label="Software" value={edgeBox.software_version ?? 'NO DATA'} />
            <DataRow label="Heartbeat" value={edgeBox.last_heartbeat_at ?? 'NO DATA'} />
        </>
    );
}

function SyncJobRow({ job, edgeBoxes }: { job: EdgeSyncJobRecord; edgeBoxes: EdgeBoxRecord[] }) {
    const edgeBox = edgeBoxes.find((box) => box.id === job.edge_box_id);
    return (
        <div className={EDGE_ROW_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-sm font-semibold text-[hsl(0_0%_98%)]">{job.job_type}</div>
                <StatusPill status={job.status} />
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
                <DataRow label="Node" value={edgeBox ? `${edgeBox.node_name} / ${edgeBox.site_label}` : job.edge_box_id} />
                <DataRow label="Direction" value={job.direction} />
                <DataRow label="Scheduled" value={formatTimestamp(job.scheduled_at)} />
                <DataRow label="Completed" value={job.completed_at ? formatTimestamp(job.completed_at) : 'pending'} tone={job.completed_at ? 'accent' : 'muted'} />
            </div>
            {job.error_message && <div className="mt-2 font-mono text-xs text-danger">{job.error_message}</div>}
        </div>
    );
}

function ArtifactRow({ artifact, edgeBoxes }: { artifact: EdgeSyncArtifactRecord; edgeBoxes: EdgeBoxRecord[] }) {
    const edgeBox = edgeBoxes.find((box) => box.id === artifact.edge_box_id);
    return (
        <div className={EDGE_ROW_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-sm font-semibold text-[hsl(0_0%_98%)]">{artifact.artifact_type}</div>
                <StatusPill status={artifact.status} />
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
                <DataRow label="Target" value={edgeBox ? `${edgeBox.node_name} / ${edgeBox.site_label}` : 'all edge boxes'} />
                <DataRow label="Size" value={`${artifact.size_bytes} bytes`} />
                <DataRow label="Artifact Ref" value={artifact.artifact_ref} />
                <DataRow label="SHA-256" value={artifact.content_hash} tone="muted" />
            </div>
        </div>
    );
}

function StatusPill({ status }: { status: string }) {
    const tone = status === 'failed' || status === 'offline'
        ? 'border-danger/70 bg-danger/15 text-[hsl(0_85%_72%)]'
        : status === 'running' || status === 'queued' || status === 'staged'
            ? 'border-warning/70 bg-warning/15 text-[hsl(45_100%_72%)]'
            : 'border-accent/70 bg-accent/15 text-[hsl(142_76%_68%)]';

    return (
        <span className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}>
            {status}
        </span>
    );
}

function formatTimestamp(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
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
        ? 'border-danger/70 bg-danger/15 text-[hsl(0_85%_72%)]'
        : state.status === 'success'
            ? 'border-accent/70 bg-accent/15 text-[hsl(142_76%_68%)]'
            : 'border-warning/70 bg-warning/15 text-[hsl(45_100%_72%)]';

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
