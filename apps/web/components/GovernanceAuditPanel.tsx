'use client';

import { useEffect, useState } from 'react';
import { ConsoleCard } from '@/components/ui/terminal';
import { extractApiErrorMessage, extractEnvelopeData, requestJson } from '@/lib/debugTools/client';
import { Activity, RefreshCw } from 'lucide-react';

type AuditRow = {
    id?: string;
    event_type?: string;
    actor?: string | null;
    created_at?: string;
    payload?: Record<string, unknown>;
};

export default function GovernanceAuditPanel() {
    const [rows, setRows] = useState<AuditRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function loadAuditRows() {
        setLoading(true);
        setError(null);

        try {
            const { response, body } = await requestJson('/api/governance/audit?limit=25');
            if (!response.ok) {
                throw new Error(extractApiErrorMessage(body, 'Failed to load governance audit log.'));
            }

            const data = extractEnvelopeData<AuditRow[]>(body);
            setRows(Array.isArray(data) ? data : []);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load governance audit log.');
            setRows([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadAuditRows();
    }, []);

    return (
        <ConsoleCard title="Governance Audit Trail">
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                    Live append-only governance events
                </div>
                <button
                    type="button"
                    onClick={() => void loadAuditRows()}
                    className="inline-flex items-center gap-2 border border-grid px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted hover:border-accent hover:text-accent"
                >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                </button>
            </div>

            {loading ? (
                <div className="font-mono text-xs text-muted flex items-center gap-2">
                    <Activity className="w-4 h-4 animate-spin" />
                    Loading governance audit log...
                </div>
            ) : error ? (
                <div className="border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">
                    {error}
                </div>
            ) : rows.length === 0 ? (
                <div className="font-mono text-xs text-muted">
                    No governance audit events have been recorded yet.
                </div>
            ) : (
                <div className="space-y-2 max-h-[24rem] overflow-y-auto">
                    {rows.map((row, index) => (
                        <div key={`${row.id ?? row.created_at ?? index}`} className="border border-grid p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-accent">
                                    {row.event_type ?? 'unknown_event'}
                                </div>
                                <div className="font-mono text-[10px] text-muted">
                                    {row.created_at ? new Date(row.created_at).toLocaleString() : 'NO DATA'}
                                </div>
                            </div>
                            <div className="font-mono text-[10px] text-muted mb-2">
                                actor: {row.actor ?? 'system'}
                            </div>
                            <pre className="max-h-[12rem] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">
                                {JSON.stringify(row.payload ?? {}, null, 2)}
                            </pre>
                        </div>
                    ))}
                </div>
            )}
        </ConsoleCard>
    );
}
