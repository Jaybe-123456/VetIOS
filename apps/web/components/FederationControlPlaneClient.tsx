'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
    BrainCircuit,
    GitBranchPlus,
    Network,
    RefreshCw,
    ShieldCheck,
    Users,
} from 'lucide-react';
import {
    ConsoleCard,
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
} from '@/components/ui/terminal';
import type {
    FederationControlPlaneSnapshot,
    FederationMembershipRecord,
    FederationRoundRecord,
    ModelDeltaArtifactRecord,
} from '@/lib/federation/service';

export default function FederationControlPlaneClient({
    initialSnapshot,
    tenantId,
}: {
    initialSnapshot: FederationControlPlaneSnapshot;
    tenantId: string;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [refreshing, setRefreshing] = useState(false);
    const [federationKey, setFederationKey] = useState(initialSnapshot.memberships[0]?.federation_key ?? 'network_alpha');
    const [coordinatorTenantId, setCoordinatorTenantId] = useState(initialSnapshot.memberships[0]?.coordinator_tenant_id ?? tenantId);
    const [participationMode, setParticipationMode] = useState<'full' | 'shadow'>(
        initialSnapshot.memberships[0]?.participation_mode ?? 'full',
    );
    const [weight, setWeight] = useState(String(initialSnapshot.memberships[0]?.weight ?? 1));
    const [snapshotMaxAgeHours, setSnapshotMaxAgeHours] = useState('24');
    const [actionState, setActionState] = useState<{
        status: 'idle' | 'running' | 'success' | 'error';
        message: string;
    }>({
        status: 'idle',
        message: '',
    });

    const filteredMemberships = useMemo(() => (
        snapshot.memberships.filter((membership) => !federationKey || membership.federation_key === federationKey)
    ), [federationKey, snapshot.memberships]);

    async function refreshSnapshot() {
        setRefreshing(true);
        try {
            const params = new URLSearchParams();
            if (federationKey.trim().length > 0) {
                params.set('federation_key', federationKey.trim().toLowerCase());
            }

            const res = await fetch(`/api/platform/federation?${params.toString()}`, { cache: 'no-store' });
            const data = await res.json() as { snapshot?: FederationControlPlaneSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Failed to load federation snapshot.');
            }

            setSnapshot(data.snapshot);
            if (data.snapshot.memberships[0] && !federationKey) {
                setFederationKey(data.snapshot.memberships[0].federation_key);
            }
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to refresh federation snapshot.',
            });
        } finally {
            setRefreshing(false);
        }
    }

    async function runAction(body: Record<string, unknown>, successMessage: string) {
        setActionState({ status: 'running', message: 'Running federation operation...' });
        try {
            const res = await fetch('/api/platform/federation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json() as { snapshot?: FederationControlPlaneSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Federation operation failed.');
            }
            setSnapshot(data.snapshot);
            setActionState({ status: 'success', message: successMessage });
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Federation operation failed.',
            });
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="FEDERATION CONTROL"
                description="Cross-clinic learning memberships, site snapshots, and weighted aggregation rounds for the federated outcome-learning moat."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<Network className="h-4 w-4" />} label="Federations" value={snapshot.summary.active_federations} />
                <SummaryCard icon={<Users className="h-4 w-4" />} label="Participants" value={snapshot.summary.visible_participants} />
                <SummaryCard icon={<BrainCircuit className="h-4 w-4" />} label="Completed Rounds" value={snapshot.summary.completed_rounds} />
                <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="Stale Snapshots" value={snapshot.summary.stale_snapshots} tone={snapshot.summary.stale_snapshots > 0 ? 'warning' : 'neutral'} />
            </div>

            <ConsoleCard title="Federation Actions" className="mt-6">
                <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <TerminalLabel>Federation Key</TerminalLabel>
                            <TerminalInput value={federationKey} onChange={(event) => setFederationKey(event.target.value)} />
                        </div>
                        <div>
                            <TerminalLabel>Coordinator Tenant ID</TerminalLabel>
                            <TerminalInput value={coordinatorTenantId} onChange={(event) => setCoordinatorTenantId(event.target.value)} />
                        </div>
                        <div>
                            <TerminalLabel>Participation Mode</TerminalLabel>
                            <select
                                value={participationMode}
                                onChange={(event) => setParticipationMode(event.target.value as 'full' | 'shadow')}
                                className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground"
                            >
                                <option value="full">full</option>
                                <option value="shadow">shadow</option>
                            </select>
                        </div>
                        <div>
                            <TerminalLabel>Site Weight</TerminalLabel>
                            <TerminalInput value={weight} onChange={(event) => setWeight(event.target.value)} />
                        </div>
                        <div>
                            <TerminalLabel>Snapshot Max Age (hours)</TerminalLabel>
                            <TerminalInput value={snapshotMaxAgeHours} onChange={(event) => setSnapshotMaxAgeHours(event.target.value)} />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="font-mono text-xs text-muted">
                            Memberships let multiple clinics opt into a shared federation key. Snapshot publishing captures local learning signal summaries, and rounds aggregate those summaries plus current champion artifacts into a federated candidate.
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <TerminalButton
                                variant="secondary"
                                onClick={() => void refreshSnapshot()}
                                disabled={refreshing}
                            >
                                <RefreshCw className="mr-2 h-3 w-3" />
                                {refreshing ? 'Refreshing...' : 'Refresh'}
                            </TerminalButton>
                            <TerminalButton
                                onClick={() => void runAction({
                                    action: 'upsert_membership',
                                    federation_key: federationKey,
                                    coordinator_tenant_id: coordinatorTenantId,
                                    participation_mode: participationMode,
                                    weight,
                                }, 'Federation membership saved.')}
                            >
                                <GitBranchPlus className="mr-2 h-3 w-3" />
                                Save Membership
                            </TerminalButton>
                            <TerminalButton
                                variant="secondary"
                                onClick={() => void runAction({
                                    action: 'publish_snapshot',
                                    federation_key: federationKey,
                                }, 'Fresh tenant snapshot published.')}
                            >
                                <BrainCircuit className="mr-2 h-3 w-3" />
                                Publish Snapshot
                            </TerminalButton>
                            <TerminalButton
                                variant="secondary"
                                onClick={() => void runAction({
                                    action: 'run_round',
                                    federation_key: federationKey,
                                    snapshot_max_age_hours: snapshotMaxAgeHours,
                                }, 'Federation round completed.')}
                            >
                                <Network className="mr-2 h-3 w-3" />
                                Run Round
                            </TerminalButton>
                        </div>
                    </div>
                </div>
                <ActionStatePanel state={actionState} />
            </ConsoleCard>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <ConsoleCard title="Memberships">
                    {filteredMemberships.length === 0 ? (
                        <div className="font-mono text-xs text-muted">No federation memberships are registered for this tenant yet.</div>
                    ) : (
                        <div className="space-y-4">
                            {filteredMemberships.map((membership) => (
                                <MembershipRow key={membership.id} membership={membership} />
                            ))}
                        </div>
                    )}
                </ConsoleCard>

                <ConsoleCard title="Recent Site Snapshots">
                    {snapshot.recent_site_snapshots.length === 0 ? (
                        <div className="font-mono text-xs text-muted">No federated site snapshots have been published yet.</div>
                    ) : (
                        <div className="space-y-4">
                            {snapshot.recent_site_snapshots.slice(0, 10).map((siteSnapshot) => (
                                <SnapshotRow key={siteSnapshot.id} snapshot={siteSnapshot} />
                            ))}
                        </div>
                    )}
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <ConsoleCard title="Recent Federation Rounds">
                    {snapshot.recent_rounds.length === 0 ? (
                        <div className="font-mono text-xs text-muted">No federation rounds have been executed yet.</div>
                    ) : (
                        <div className="space-y-4">
                            {snapshot.recent_rounds.slice(0, 8).map((round) => (
                                <RoundRow key={round.id} round={round} />
                            ))}
                        </div>
                    )}
                </ConsoleCard>

                <ConsoleCard title="Recent Model Delta Artifacts">
                    {snapshot.recent_artifacts.length === 0 ? (
                        <div className="font-mono text-xs text-muted">No model delta artifacts have been stored yet.</div>
                    ) : (
                        <div className="space-y-4">
                            {snapshot.recent_artifacts.slice(0, 12).map((artifact) => (
                                <ArtifactRow key={artifact.id} artifact={artifact} />
                            ))}
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
        <ConsoleCard className={tone === 'warning' ? 'border-warning/30 text-warning' : undefined}>
            <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
                <div>{icon}</div>
            </div>
            <div className="font-mono text-3xl">{value}</div>
        </ConsoleCard>
    );
}

function MembershipRow({ membership }: { membership: FederationMembershipRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{membership.federation_key}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {membership.status} · {membership.participation_mode} · weight {membership.weight}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Tenant" value={membership.tenant_id} />
                <DataRow label="Coordinator" value={membership.coordinator_tenant_id} />
                <DataRow label="Last Snapshot" value={formatTimestamp(membership.last_snapshot_at)} />
                <DataRow label="Updated" value={formatTimestamp(membership.updated_at)} />
            </div>
        </div>
    );
}

function SnapshotRow({ snapshot }: { snapshot: FederationControlPlaneSnapshot['recent_site_snapshots'][number] }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{snapshot.federation_key}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {snapshot.tenant_id} · dataset {snapshot.dataset_version ?? 'NO DATA'}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Rows" value={snapshot.total_dataset_rows.toLocaleString('en-US')} />
                <DataRow label="Benchmarks" value={String(snapshot.benchmark_reports)} />
                <DataRow label="Calibrations" value={String(snapshot.calibration_reports)} />
                <DataRow label="Created" value={formatTimestamp(snapshot.created_at)} />
            </div>
        </div>
    );
}

function RoundRow({ round }: { round: FederationRoundRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{round.round_key}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {round.federation_key} · {round.status}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Participants" value={String(round.participant_count)} />
                <DataRow label="Aggregate Rows" value={String(round.aggregate_payload.aggregate_dataset_rows ?? 0)} />
                <DataRow label="Completed" value={formatTimestamp(round.completed_at)} />
                <DataRow label="Benchmark Pass Rate" value={formatPercent(round.aggregate_payload.benchmark_pass_rate)} />
            </div>
        </div>
    );
}

function ArtifactRow({ artifact }: { artifact: ModelDeltaArtifactRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{artifact.task_type} · {artifact.artifact_role}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {artifact.model_version ?? 'NO MODEL VERSION'}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Round" value={artifact.federation_round_id} />
                <DataRow label="Tenant" value={artifact.tenant_id ?? 'aggregate'} />
                <DataRow label="Dataset" value={artifact.dataset_version ?? 'NO DATA'} />
                <DataRow label="Created" value={formatTimestamp(artifact.created_at)} />
            </div>
        </div>
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

function formatTimestamp(value: string | null): string {
    if (!value) return 'NO DATA';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatPercent(value: unknown): string {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : null;
    return parsed != null && Number.isFinite(parsed) ? `${(parsed * 100).toFixed(1)}%` : 'NO DATA';
}
