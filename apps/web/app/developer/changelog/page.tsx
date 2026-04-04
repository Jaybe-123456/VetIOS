import { listChangelogEntries } from '@/lib/api/partner-service';

export const dynamic = 'force-dynamic';

export default async function DeveloperChangelogPage() {
    const entries = await listChangelogEntries();

    return (
        <div className="space-y-8">
            <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.32em] text-teal-700">Developer Changelog</p>
                <h1 className="text-3xl font-semibold text-slate-950">VetIOS API version history</h1>
                <a href="/api/developer/changelog.xml" className="text-sm text-teal-700 underline">
                    RSS feed
                </a>
            </div>

            <div className="space-y-6">
                {entries.map((entry) => (
                    <article key={entry.id} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-2xl font-semibold text-slate-950">{entry.version}</h2>
                            {entry.breaking ? (
                                <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-rose-700">
                                    Breaking
                                </span>
                            ) : null}
                            <span className="text-sm text-slate-500">
                                {entry.releasedAt?.toLocaleDateString() ?? 'Unscheduled'}
                            </span>
                        </div>
                        <p className="mt-3 text-sm text-slate-700">{entry.summary}</p>
                        <div className="mt-5 space-y-3">
                            {entry.changes.map((change, index) => (
                                <div key={`${entry.id}-${index}`} className="rounded-2xl bg-slate-50 px-4 py-3">
                                    <span className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${badgeClass(change.type)}`}>
                                        {change.type}
                                    </span>
                                    <p className="mt-2 text-sm text-slate-700">{change.description}</p>
                                </div>
                            ))}
                        </div>
                    </article>
                ))}
            </div>
        </div>
    );
}

function badgeClass(type: 'added' | 'changed' | 'deprecated' | 'removed') {
    if (type === 'changed') return 'bg-amber-100 text-amber-700';
    if (type === 'deprecated') return 'bg-rose-100 text-rose-700';
    if (type === 'removed') return 'bg-slate-200 text-slate-700';
    return 'bg-emerald-100 text-emerald-700';
}
