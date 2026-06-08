import type { ConfirmedCaseCollectionStats } from '@/lib/cases/confirmedCaseCollection';
import type { OutcomeDataSnapshot } from '@/lib/cases/outcomeDataSnapshots';
import { formatClinicalLabel } from './clinicalTypes';

export function ConfirmedCaseCollectionPanel({
    stats,
    snapshot,
}: {
    stats: ConfirmedCaseCollectionStats;
    snapshot?: OutcomeDataSnapshot | null;
}) {
    return (
        <section className="rounded-lg border border-accent/20 bg-accent/[0.035] p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                        Confirmed case moat
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-white">Real outcome collection is active</h2>
                    <p className="mt-2 text-sm leading-relaxed text-white/68">
                        Every confirmed diagnosis closes a clinical loop. Cases with de-identified learning enabled become labeled signals for validation, calibration, and future model improvement.
                    </p>
                </div>
                <div className="min-w-[180px] rounded-md border border-white/10 bg-black/20 p-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
                        Validation target
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-4">
                        <span className="text-2xl font-semibold text-white">{stats.confirmed_cases}</span>
                        <span className="pb-1 font-mono text-xs text-white/54">/ {stats.milestone_target}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${stats.milestone_percent}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-white/58">
                        {stats.ready_for_validation ? 'Ready for early validation cohorting.' : 'Collect 30 confirmed cases for first calibration reads.'}
                    </div>
                </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <CollectionMetric label="Confirmed cases" value={stats.confirmed_cases} />
                <CollectionMetric label="Learning signals" value={stats.deidentified_learning_signals} />
                <CollectionMetric label="Pending outcomes" value={stats.pending_cases} />
                <CollectionMetric label="Last 7 days" value={stats.confirmed_last_7d} />
                <CollectionMetric label="Label coverage" value={stats.label_count} />
                <CollectionMetric label="Ledger status" value={snapshot ? 'Stored' : 'Pending'} />
            </div>

            <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-white/62">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
                    Outcome data ledger
                </div>
                <div className="mt-2">
                    {snapshot ? (
                        <>
                            Latest append-only snapshot: {formatSnapshotDate(snapshot.snapshot_date)} ·{' '}
                            {snapshot.deidentified_learning_signals} de-identified learning signal
                            {snapshot.deidentified_learning_signals === 1 ? '' : 's'} · closure rate{' '}
                            {formatPercent(snapshot.closure_rate)}.
                        </>
                    ) : (
                        <>
                            Awaiting the next daily snapshot. The live counters above remain available while the append-only
                            ledger catches up.
                        </>
                    )}
                </div>
            </div>

            {stats.top_labels.length > 0 ? (
                <div className="mt-4 border-t border-white/10 pt-4">
                    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
                        Leading confirmed labels
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {stats.top_labels.map((entry) => (
                            <span key={entry.label} className="inline-flex min-h-[30px] items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 text-xs text-white/72">
                                <span>{formatClinicalLabel(entry.label)}</span>
                                <span className="font-mono text-accent">{entry.count}</span>
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}

            {stats.warnings.length > 0 ? (
                <div className="mt-4 rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-xs leading-relaxed text-amber-100">
                    Collection stats are running with limited data: {stats.warnings.join(' ')}
                </div>
            ) : null}
        </section>
    );
}

function CollectionMetric({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
        </div>
    );
}

function formatSnapshotDate(value: string): string {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}
