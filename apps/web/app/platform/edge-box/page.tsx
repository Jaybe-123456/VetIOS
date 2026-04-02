import type { Metadata } from 'next';
import Link from 'next/link';
import { Database, HardDrive } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { getPublicEdgeBoxSnapshot } from '@/lib/edgeBox/service';

export const metadata: Metadata = {
    title: 'Edge Box',
    description: 'Offline edge nodes and synchronization plane for VetIOS.',
};

export const dynamic = 'force-dynamic';

export default async function EdgeBoxPage() {
    const snapshot = await getPublicEdgeBoxSnapshot();

    return (
        <PlatformShell
            badge="EDGE BOX"
            title="Offline clinics still stay on the network."
            description="Edge Box extends VetIOS beyond always-online clinics with node registration, staged artifacts, and queued cloud-edge synchronization."
            actions={(
                <Link
                    href="/api/public/edge-box"
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                >
                    JSON endpoint
                    <Database className="h-4 w-4" />
                </Link>
            )}
        >
            <div className="grid gap-4 md:grid-cols-4">
                <StatCard label="Online nodes" value={String(snapshot.summary.online_nodes)} />
                <StatCard label="Degraded nodes" value={String(snapshot.summary.degraded_nodes)} />
                <StatCard label="Queued jobs" value={String(snapshot.summary.queued_jobs)} />
                <StatCard label="Staged artifacts" value={String(snapshot.summary.staged_artifacts)} />
            </div>

            <section className="mt-10 grid gap-6 xl:grid-cols-2">
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        <HardDrive className="h-4 w-4" />
                        Edge node inventory
                    </div>
                    <div className="mt-4 space-y-4">
                        {snapshot.edge_boxes.length > 0 ? snapshot.edge_boxes.map((box) => (
                            <div key={box.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <div className="font-mono text-sm text-white">{box.node_name}</div>
                                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{box.site_label}</div>
                                    </div>
                                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
                                        {box.status}
                                    </div>
                                </div>
                                <div className="mt-3 text-sm text-slate-300">
                                    Hardware: {box.hardware_class ?? 'NO DATA'} | Version: {box.software_version ?? 'NO DATA'}
                                </div>
                            </div>
                        )) : (
                            <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-300">
                                No public edge nodes are registered yet.
                            </div>
                        )}
                    </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recent sync work</div>
                    <div className="mt-4 space-y-4">
                        {snapshot.sync_jobs.length > 0 ? snapshot.sync_jobs.map((job) => (
                            <div key={job.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="font-mono text-sm text-white">{job.job_type}</div>
                                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
                                        {job.status}
                                    </div>
                                </div>
                                <div className="mt-2 text-sm text-slate-300">
                                    {job.direction} | scheduled {formatDateTime(job.scheduled_at)}
                                </div>
                            </div>
                        )) : (
                            <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-300">
                                No edge sync jobs are published yet.
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </PlatformShell>
    );
}

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{value}</div>
        </div>
    );
}

function formatDateTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}
