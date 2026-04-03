'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, CalendarClock, GitBranchPlus, Network, RefreshCw, ShieldCheck, Users } from 'lucide-react';
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
import { readFederationGovernanceState, type FederationEnrollmentMode } from '@/lib/federation/policy';
import type { FederationControlPlaneSnapshot, FederationMembershipRecord, FederationRoundRecord, ModelDeltaArtifactRecord } from '@/lib/federation/service';

export default function FederationControlPlaneClient({ initialSnapshot, tenantId }: {
    initialSnapshot: FederationControlPlaneSnapshot;
    tenantId: string;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [refreshing, setRefreshing] = useState(false);
    const [federationKey, setFederationKey] = useState(initialSnapshot.memberships[0]?.federation_key ?? 'network_alpha');
    const [coordinatorTenantId, setCoordinatorTenantId] = useState(initialSnapshot.memberships[0]?.coordinator_tenant_id ?? tenantId);
    const [targetTenantId, setTargetTenantId] = useState('');
    const [participationMode, setParticipationMode] = useState<'full' | 'shadow'>(initialSnapshot.memberships[0]?.participation_mode ?? 'full');
    const [weight, setWeight] = useState(String(initialSnapshot.memberships[0]?.weight ?? 1));
    const [snapshotMaxAgeHours, setSnapshotMaxAgeHours] = useState('24');
    const [enrollmentMode, setEnrollmentMode] = useState<FederationEnrollmentMode>('coordinator_only');
    const [autoEnrollEnabled, setAutoEnrollEnabled] = useState(false);
    const [approvedTenantIdsText, setApprovedTenantIdsText] = useState('');
    const [autoPublishSnapshots, setAutoPublishSnapshots] = useState(true);
    const [autoRunRounds, setAutoRunRounds] = useState(false);
    const [roundIntervalHours, setRoundIntervalHours] = useState('24');
    const [minimumParticipants, setMinimumParticipants] = useState('2');
    const [minimumBenchmarkPassRate, setMinimumBenchmarkPassRate] = useState('');
    const [maximumCalibrationAvgEce, setMaximumCalibrationAvgEce] = useState('');
    const [allowShadowParticipants, setAllowShadowParticipants] = useState(false);
    const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message: string }>({ status: 'idle', message: '' });

    const filteredMemberships = useMemo(() => snapshot.memberships.filter((membership) => !federationKey || membership.federation_key === federationKey), [federationKey, snapshot.memberships]);
    const coordinatorMembership = useMemo(() => filteredMemberships.find((membership) => membership.tenant_id === membership.coordinator_tenant_id) ?? filteredMemberships[0] ?? null, [filteredMemberships]);
    const governanceState = useMemo(() => readFederationGovernanceState(coordinatorMembership?.metadata ?? {}), [coordinatorMembership]);
    const activeParticipants = useMemo(() => filteredMemberships.filter((membership) => membership.status === 'active'), [filteredMemberships]);
    const missingApprovedTenants = useMemo(() => {
        const activeTenantIds = new Set(activeParticipants.map((membership) => membership.tenant_id));
        return governanceState.policy.approved_tenant_ids.filter((candidate) => !activeTenantIds.has(candidate));
    }, [activeParticipants, governanceState.policy.approved_tenant_ids]);

    useEffect(() => {
        if (!coordinatorMembership) {
            setCoordinatorTenantId(tenantId);
            return;
        }
        const governance = readFederationGovernanceState(coordinatorMembership.metadata);
        setCoordinatorTenantId(coordinatorMembership.coordinator_tenant_id);
        setSnapshotMaxAgeHours(String(governance.policy.snapshot_max_age_hours));
        setEnrollmentMode(governance.policy.enrollment_mode);
        setAutoEnrollEnabled(governance.policy.auto_enroll_enabled);
        setApprovedTenantIdsText(governance.policy.approved_tenant_ids.join('\n'));
        setAutoPublishSnapshots(governance.policy.auto_publish_snapshots);
        setAutoRunRounds(governance.policy.auto_run_rounds);
        setRoundIntervalHours(String(governance.policy.round_interval_hours));
        setMinimumParticipants(String(governance.policy.minimum_participants));
        setMinimumBenchmarkPassRate(governance.policy.minimum_benchmark_pass_rate == null ? '' : String(Math.round(governance.policy.minimum_benchmark_pass_rate * 100)));
        setMaximumCalibrationAvgEce(governance.policy.maximum_calibration_avg_ece == null ? '' : String(Math.round(governance.policy.maximum_calibration_avg_ece * 100)));
        setAllowShadowParticipants(governance.policy.allow_shadow_participants);
    }, [coordinatorMembership, tenantId]);

    async function refreshSnapshot() {
        setRefreshing(true);
        try {
            const params = new URLSearchParams();
            if (federationKey.trim()) params.set('federation_key', federationKey.trim().toLowerCase());
            const res = await fetch(`/api/platform/federation?${params.toString()}`, { cache: 'no-store' });
            const data = await res.json() as { snapshot?: FederationControlPlaneSnapshot; error?: string };
            if (!res.ok || !data.snapshot) throw new Error(data.error ?? 'Failed to load federation snapshot.');
            setSnapshot(data.snapshot);
        } catch (error) {
            setActionState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to refresh federation snapshot.' });
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
            const data = await res.json() as { snapshot?: FederationControlPlaneSnapshot; error?: string; automation?: { skipped_reason?: string | null } };
            if (!res.ok || !data.snapshot) throw new Error(data.error ?? 'Federation operation failed.');
            setSnapshot(data.snapshot);
            setActionState({ status: 'success', message: data.automation?.skipped_reason ?? successMessage });
        } catch (error) {
            setActionState({ status: 'error', message: error instanceof Error ? error.message : 'Federation operation failed.' });
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader title="FEDERATION CONTROL" description="Cross-clinic memberships, governance, scheduler automation, and weighted aggregation rounds for the federated outcome-learning moat." />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<Network className="h-4 w-4" />} label="Federations" value={snapshot.summary.active_federations} />
                <SummaryCard icon={<Users className="h-4 w-4" />} label="Participants" value={snapshot.summary.visible_participants} />
                <SummaryCard icon={<BrainCircuit className="h-4 w-4" />} label="Completed Rounds" value={snapshot.summary.completed_rounds} />
                <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="Stale Snapshots" value={snapshot.summary.stale_snapshots} tone={snapshot.summary.stale_snapshots > 0 ? 'warning' : 'neutral'} />
            </div>

            <ConsoleCard title="Federation Actions" className="mt-6">
                <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Federation Key"><TerminalInput value={federationKey} onChange={(event) => setFederationKey(event.target.value)} /></Field>
                        <Field label="Coordinator Tenant ID"><TerminalInput value={coordinatorTenantId} onChange={(event) => setCoordinatorTenantId(event.target.value)} /></Field>
                        <Field label="Participation Mode">
                            <Select value={participationMode} onChange={(event) => setParticipationMode(event.target.value as 'full' | 'shadow')}>
                                <option value="full">full</option>
                                <option value="shadow">shadow</option>
                            </Select>
                        </Field>
                        <Field label="Site Weight"><TerminalInput value={weight} onChange={(event) => setWeight(event.target.value)} /></Field>
                        <Field label="Enroll Target Tenant"><TerminalInput value={targetTenantId} onChange={(event) => setTargetTenantId(event.target.value)} placeholder="clinic tenant uuid" /></Field>
                        <Field label="Snapshot Max Age (hours)"><TerminalInput value={snapshotMaxAgeHours} onChange={(event) => setSnapshotMaxAgeHours(event.target.value)} /></Field>
                    </div>

                    <div className="space-y-3">
                        <div className="font-mono text-xs text-muted">
                            Coordinator policy now governs who may participate, whether allow-listed clinics auto-enroll, and when the next federation round can run.
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <TerminalButton variant="secondary" onClick={() => void refreshSnapshot()} disabled={refreshing}>
                                <RefreshCw className="mr-2 h-3 w-3" />
                                {refreshing ? 'Refreshing...' : 'Refresh'}
                            </TerminalButton>
                            <TerminalButton onClick={() => void runAction({
                                action: 'upsert_membership',
                                federation_key: federationKey,
                                coordinator_tenant_id: coordinatorTenantId,
                                participation_mode: participationMode,
                                weight,
                            }, 'Federation membership saved.')}>
                                <GitBranchPlus className="mr-2 h-3 w-3" />
                                Save Membership
                            </TerminalButton>
                            <TerminalButton variant="secondary" onClick={() => void runAction({
                                action: 'enroll_tenant',
                                federation_key: federationKey,
                                target_tenant_id: targetTenantId,
                                participation_mode: participationMode,
                                weight,
                            }, 'Clinic enrolled into federation governance.')}>
                                <Users className="mr-2 h-3 w-3" />
                                Enroll Clinic
                            </TerminalButton>
                            <TerminalButton variant="secondary" onClick={() => void runAction({ action: 'publish_snapshot', federation_key: federationKey }, 'Fresh tenant snapshots published.')}>
                                <BrainCircuit className="mr-2 h-3 w-3" />
                                Publish Snapshot
                            </TerminalButton>
                            <TerminalButton variant="secondary" onClick={() => void runAction({ action: 'run_round', federation_key: federationKey, snapshot_max_age_hours: snapshotMaxAgeHours }, 'Federation round completed.')}>
                                <Network className="mr-2 h-3 w-3" />
                                Run Round
                            </TerminalButton>
                            <TerminalButton variant="secondary" onClick={() => void runAction({ action: 'run_automation', federation_key: federationKey, force: true }, 'Federation automation executed.')}>
                                <CalendarClock className="mr-2 h-3 w-3" />
                                Run Automation
                            </TerminalButton>
                        </div>
                    </div>
                </div>
                <ActionStatePanel state={actionState} />
            </ConsoleCard>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <ConsoleCard title="Governance Policy">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Enrollment Mode">
                            <Select value={enrollmentMode} onChange={(event) => setEnrollmentMode(event.target.value as FederationEnrollmentMode)}>
                                <option value="coordinator_only">coordinator_only</option>
                                <option value="allow_list">allow_list</option>
                                <option value="open">open</option>
                            </Select>
                        </Field>
                        <Field label="Auto Enroll Allow List">
                            <Select value={autoEnrollEnabled ? 'true' : 'false'} onChange={(event) => setAutoEnrollEnabled(event.target.value === 'true')}>
                                <option value="false">false</option>
                                <option value="true">true</option>
                            </Select>
                        </Field>
                        <Field label="Auto Publish Snapshots">
                            <Select value={autoPublishSnapshots ? 'true' : 'false'} onChange={(event) => setAutoPublishSnapshots(event.target.value === 'true')}>
                                <option value="true">true</option>
                                <option value="false">false</option>
                            </Select>
                        </Field>
                        <Field label="Auto Run Rounds">
                            <Select value={autoRunRounds ? 'true' : 'false'} onChange={(event) => setAutoRunRounds(event.target.value === 'true')}>
                                <option value="false">false</option>
                                <option value="true">true</option>
                            </Select>
                        </Field>
                        <Field label="Round Interval (hours)"><TerminalInput value={roundIntervalHours} onChange={(event) => setRoundIntervalHours(event.target.value)} /></Field>
                        <Field label="Minimum Participants"><TerminalInput value={minimumParticipants} onChange={(event) => setMinimumParticipants(event.target.value)} /></Field>
                        <Field label="Minimum Benchmark Pass Rate (%)"><TerminalInput value={minimumBenchmarkPassRate} onChange={(event) => setMinimumBenchmarkPassRate(event.target.value)} placeholder="blank disables gate" /></Field>
                        <Field label="Maximum Calibration Avg ECE (%)"><TerminalInput value={maximumCalibrationAvgEce} onChange={(event) => setMaximumCalibrationAvgEce(event.target.value)} placeholder="blank disables gate" /></Field>
                        <Field label="Allow Shadow Participants">
                            <Select value={allowShadowParticipants ? 'true' : 'false'} onChange={(event) => setAllowShadowParticipants(event.target.value === 'true')}>
                                <option value="false">false</option>
                                <option value="true">true</option>
                            </Select>
                        </Field>
                    </div>
                    <div className="mt-4">
                        <TerminalLabel>Approved Tenant IDs</TerminalLabel>
                        <TerminalTextarea value={approvedTenantIdsText} onChange={(event) => setApprovedTenantIdsText(event.target.value)} placeholder="one tenant id per line or comma separated" />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <TerminalButton onClick={() => void runAction({
                            action: 'set_governance',
                            federation_key: federationKey,
                            enrollment_mode: enrollmentMode,
                            auto_enroll_enabled: autoEnrollEnabled,
                            approved_tenant_ids: parseTenantIds(approvedTenantIdsText),
                            auto_publish_snapshots: autoPublishSnapshots,
                            auto_run_rounds: autoRunRounds,
                            round_interval_hours: roundIntervalHours,
                            snapshot_max_age_hours: snapshotMaxAgeHours,
                            minimum_participants: minimumParticipants,
                            minimum_benchmark_pass_rate: minimumBenchmarkPassRate,
                            maximum_calibration_avg_ece: maximumCalibrationAvgEce,
                            allow_shadow_participants: allowShadowParticipants,
                        }, 'Federation governance policy saved.')}>
                            <ShieldCheck className="mr-2 h-3 w-3" />
                            Save Governance
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Governance Status">
                    <DataRow label="Enrollment mode" value={governanceState.policy.enrollment_mode} />
                    <DataRow label="Auto enroll" value={governanceState.policy.auto_enroll_enabled ? 'ON' : 'OFF'} />
                    <DataRow label="Approved tenants" value={String(governanceState.policy.approved_tenant_ids.length)} />
                    <DataRow label="Missing approved" value={String(missingApprovedTenants.length)} />
                    <DataRow label="Auto rounds" value={governanceState.policy.auto_run_rounds ? 'ON' : 'OFF'} />
                    <DataRow label="Round interval" value={`${governanceState.policy.round_interval_hours}h`} />
                    <DataRow label="Next round due" value={formatTimestamp(governanceState.automation.next_round_due_at)} />
                    <DataRow label="Last automation" value={formatTimestamp(governanceState.automation.last_automation_run_at)} />
                    <DataRow label="Minimum participants" value={String(governanceState.policy.minimum_participants)} />
                    <DataRow label="Benchmark gate" value={formatPercentThreshold(governanceState.policy.minimum_benchmark_pass_rate)} />
                    <DataRow label="Calibration gate" value={formatPercentThreshold(governanceState.policy.maximum_calibration_avg_ece)} />
                    <DataRow label="Shadow participants" value={governanceState.policy.allow_shadow_participants ? 'ALLOWED' : 'BLOCKED'} />
                    {governanceState.automation.last_automation_error ? (
                        <div className="mt-4 border border-danger/30 bg-danger/10 px-4 py-3 font-mono text-xs text-danger">
                            {governanceState.automation.last_automation_error}
                        </div>
                    ) : null}
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <ConsoleCard title="Memberships">{filteredMemberships.length === 0 ? <EmptyState text="No federation memberships are registered for this tenant yet." /> : <div className="space-y-4">{filteredMemberships.map((membership) => <MembershipRow key={membership.id} membership={membership} />)}</div>}</ConsoleCard>
                <ConsoleCard title="Enrollment Pipeline">
                    <DataRow label="Active participants" value={String(activeParticipants.length)} />
                    <DataRow label="Approved tenants" value={String(governanceState.policy.approved_tenant_ids.length)} />
                    <DataRow label="Missing approved" value={String(missingApprovedTenants.length)} />
                    <DataRow label="Auto enroll mode" value={governanceState.policy.auto_enroll_enabled ? 'ACTIVE' : 'MANUAL'} />
                    {missingApprovedTenants.length > 0 ? <div className="mt-4 space-y-2">{missingApprovedTenants.map((candidate) => <div key={candidate} className="font-mono text-xs text-foreground">{candidate}</div>)}</div> : <EmptyState text="All approved tenants are already represented in the active federation membership set." />}
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <ConsoleCard title="Recent Site Snapshots">{snapshot.recent_site_snapshots.length === 0 ? <EmptyState text="No federated site snapshots have been published yet." /> : <div className="space-y-4">{snapshot.recent_site_snapshots.slice(0, 10).map((siteSnapshot) => <SnapshotRow key={siteSnapshot.id} snapshot={siteSnapshot} />)}</div>}</ConsoleCard>
                <ConsoleCard title="Recent Federation Rounds">{snapshot.recent_rounds.length === 0 ? <EmptyState text="No federation rounds have been executed yet." /> : <div className="space-y-4">{snapshot.recent_rounds.slice(0, 8).map((round) => <RoundRow key={round.id} round={round} />)}</div>}</ConsoleCard>
            </div>

            <div className="mt-6">
                <ConsoleCard title="Recent Model Delta Artifacts">{snapshot.recent_artifacts.length === 0 ? <EmptyState text="No model delta artifacts have been stored yet." /> : <div className="space-y-4">{snapshot.recent_artifacts.slice(0, 12).map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} />)}</div>}</ConsoleCard>
            </div>
        </Container>
    );
}

function SummaryCard({ icon, label, value, tone = 'neutral' }: { icon: ReactNode; label: string; value: number; tone?: 'neutral' | 'warning' }) {
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

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <div><TerminalLabel>{label}</TerminalLabel>{children}</div>;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return <select {...props} className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground" />;
}

function EmptyState({ text }: { text: string }) {
    return <div className="font-mono text-xs text-muted">{text}</div>;
}

function MembershipRow({ membership }: { membership: FederationMembershipRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{membership.federation_key}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{membership.status} / {membership.participation_mode} / weight {membership.weight}</div>
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
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{snapshot.tenant_id} / dataset {snapshot.dataset_version ?? 'NO DATA'}</div>
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
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{round.federation_key} / {round.status}</div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Participants" value={String(round.participant_count)} />
                <DataRow label="Aggregate Rows" value={String(round.aggregate_payload.aggregate_dataset_rows ?? 0)} />
                <DataRow label="Completed" value={formatTimestamp(round.completed_at)} />
                <DataRow label="Benchmark Pass Rate" value={formatPercent(round.aggregate_payload.benchmark_pass_rate)} />
            </div>
            {round.notes ? <div className="mt-3 font-mono text-xs text-muted">{round.notes}</div> : null}
        </div>
    );
}

function ArtifactRow({ artifact }: { artifact: ModelDeltaArtifactRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{artifact.task_type} / {artifact.artifact_role}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{artifact.model_version ?? 'NO MODEL VERSION'}</div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Round" value={artifact.federation_round_id} />
                <DataRow label="Tenant" value={artifact.tenant_id ?? 'aggregate'} />
                <DataRow label="Dataset" value={artifact.dataset_version ?? 'NO DATA'} />
                <DataRow label="Created" value={formatTimestamp(artifact.created_at)} />
            </div>
        </div>
    );
}

function ActionStatePanel({ state }: { state: { status: 'idle' | 'running' | 'success' | 'error'; message: string } }) {
    if (state.status === 'idle' || !state.message) return null;
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

function formatPercentThreshold(value: number | null): string {
    return value == null ? 'DISABLED' : `${(value * 100).toFixed(0)}%`;
}

function parseTenantIds(value: string): string[] {
    return Array.from(new Set(value.split(/[\s,]+/).map((entry) => entry.trim()).filter((entry) => entry.length > 0)));
}
