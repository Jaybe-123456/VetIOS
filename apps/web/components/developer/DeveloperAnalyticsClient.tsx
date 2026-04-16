'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    BarElement,
    CategoryScale,
    Chart as ChartJS,
    Filler,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    Tooltip,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import {
    ConsoleCard,
    TerminalButton,
    DataRow,
} from '@/components/ui/terminal';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

interface AnalyticsClientProps {
    adminMode?: boolean;
}

interface OverviewResponse {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    avg_response_time_ms: number;
    p95_response_time_ms: number;
    requests_by_day: Array<{ date: string; count: number }>;
    quota_used_pct: number;
    billable_requests: number;
    estimated_cost_usd: number;
    recent_credentials?: Array<{
        id: string;
        key_prefix: string;
        label: string | null;
        last_used_at: string | null;
        scopes: string[];
        revoked_at: string | null;
    }>;
}

interface EndpointRow {
    endpoint: string;
    method: string;
    count: number;
    success_rate: number;
    avg_ms: number;
    p95_ms: number;
}

interface ErrorRow {
    status_code: number;
    count: number;
    pct: number;
    sample_endpoint: string | null;
}

interface TimeseriesPoint {
    window_start: string;
    count: number;
    avg_ms: number;
}

interface QuotaUsage {
    plan: string;
    period_start: string;
    period_end: string;
    requests_used: number;
    requests_limit: number;
    pct_used: number;
    projected_month_end: number;
    on_track: boolean;
}

interface PartnerSummary {
    id: string;
    name: string;
    billingEmail: string;
    status: string;
    plan?: { displayName: string; name: string } | null;
}

export function DeveloperAnalyticsClient({ adminMode = false }: AnalyticsClientProps) {
    const [overview, setOverview] = useState<OverviewResponse | null>(null);
    const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
    const [errors, setErrors] = useState<ErrorRow[]>([]);
    const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
    const [quota, setQuota] = useState<QuotaUsage | null>(null);
    const [credentials, setCredentials] = useState<OverviewResponse['recent_credentials']>([]);
    const [partners, setPartners] = useState<PartnerSummary[]>([]);
    const [selectedPartner, setSelectedPartner] = useState<string>('');
    const [selectedEndpoint, setSelectedEndpoint] = useState<string>('');
    const [granularity, setGranularity] = useState<'hour' | 'day'>('day');
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!adminMode) {
            return;
        }

        void (async () => {
            const response = await fetch('/api/admin/partners', { cache: 'no-store' });
            if (!response.ok) {
                return;
            }
            const data = await response.json() as PartnerSummary[];
            setPartners(data);
            setSelectedPartner((current) => current || data[0]?.id || '');
        })();
    }, [adminMode]);

    useEffect(() => {
        const controller = new AbortController();

        void (async () => {
            if (adminMode && !selectedPartner) {
                return;
            }

            setIsLoading(true);
            setErrorMessage(null);

            try {
                const query = adminMode && selectedPartner ? `?partner_id=${encodeURIComponent(selectedPartner)}` : '';
                const timeQuery = new URLSearchParams();
                if (adminMode && selectedPartner) timeQuery.set('partner_id', selectedPartner);
                if (selectedEndpoint) timeQuery.set('endpoint', selectedEndpoint);
                timeQuery.set('granularity', granularity);

                const [overviewResponse, endpointResponse, errorResponse, timeseriesResponse, quotaResponse, credentialsResponse] = await Promise.all([
                    fetch(`/api/developer/analytics/overview${query}`, { cache: 'no-store', signal: controller.signal }),
                    fetch(`/api/developer/analytics/endpoints${query}`, { cache: 'no-store', signal: controller.signal }),
                    fetch(`/api/developer/analytics/errors${query}`, { cache: 'no-store', signal: controller.signal }),
                    fetch(`/api/developer/analytics/usage-timeseries?${timeQuery.toString()}`, { cache: 'no-store', signal: controller.signal }),
                    fetch(`/api/developer/analytics/quota-usage${query}`, { cache: 'no-store', signal: controller.signal }),
                    fetch(adminMode && selectedPartner
                        ? `/api/admin/partners/${selectedPartner}/credentials`
                        : '/api/developer/credentials', { cache: 'no-store', signal: controller.signal }),
                ]);

                if (!overviewResponse.ok || !endpointResponse.ok || !errorResponse.ok || !timeseriesResponse.ok || !quotaResponse.ok) {
                    throw new Error('Unable to load developer analytics.');
                }

                const [
                    overviewData,
                    endpointData,
                    errorData,
                    timeseriesData,
                    quotaData,
                    credentialsData,
                ] = await Promise.all([
                    overviewResponse.json() as Promise<OverviewResponse>,
                    endpointResponse.json() as Promise<EndpointRow[]>,
                    errorResponse.json() as Promise<ErrorRow[]>,
                    timeseriesResponse.json() as Promise<TimeseriesPoint[]>,
                    quotaResponse.json() as Promise<QuotaUsage>,
                    credentialsResponse.ok ? credentialsResponse.json() : Promise.resolve([]),
                ]);

                setOverview(overviewData);
                setEndpoints(endpointData);
                setErrors(errorData);
                setTimeseries(timeseriesData);
                setQuota(quotaData);
                setCredentials(Array.isArray(credentialsData) ? credentialsData : overviewData.recent_credentials ?? []);
            } catch (error) {
                if (!controller.signal.aborted) {
                    setErrorMessage(error instanceof Error ? error.message : 'Unable to load analytics.');
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        })();

        const refreshOnVisible = () => {
            if (document.visibilityState === 'visible') {
                setSelectedEndpoint((current) => current);
            }
        };

        const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                setSelectedEndpoint((current) => current);
            }
        }, 30_000);

        document.addEventListener('visibilitychange', refreshOnVisible);
        return () => {
            controller.abort();
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', refreshOnVisible);
        };
    }, [adminMode, selectedPartner, selectedEndpoint, granularity]);

    const requestSeries = useMemo(() => ({
        labels: timeseries.map((point) => new Date(point.window_start).toLocaleDateString()),
        datasets: [
            {
                label: 'Requests',
                data: timeseries.map((point) => point.count),
                borderColor: '#00F0FF',
                backgroundColor: 'rgba(0, 240, 255, 0.1)',
                fill: true,
                tension: 0.2,
                pointRadius: 2,
            },
        ],
    }), [timeseries]);

    const errorSeries = useMemo(() => ({
        labels: errors.map((entry) => String(entry.status_code)),
        datasets: [
            {
                label: 'Error count',
                data: errors.map((entry) => entry.count),
                backgroundColor: errors.map((entry) => entry.status_code >= 500 ? '#FF3B3B' : '#FFD700'),
            },
        ],
    }), [errors]);

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-accent animate-pulse" />
                    <p className="text-[10px] uppercase font-mono tracking-[0.32em] text-accent font-bold">Developer Analytics</p>
                </div>
                <h1 className="text-2xl font-mono tracking-tighter uppercase font-bold text-foreground">
                    {adminMode ? 'Partner Lifecycle Analytics' : 'API Lifecycle Analytics'}
                </h1>
                <p className="max-w-3xl font-mono text-xs text-[hsl(0_0%_80%)] leading-relaxed font-medium">
                    Track quota consumption, endpoint behavior, and reliability signals for the VetIOS developer moat.
                </p>
            </div>

            {adminMode ? (
                <ConsoleCard title="Target Partner Selection">
                    <div className="p-1">
                        <select
                            className="w-full border border-grid bg-black/40 px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
                            value={selectedPartner}
                            onChange={(event) => setSelectedPartner(event.target.value)}
                        >
                            {partners.map((partner) => (
                                <option key={partner.id} value={partner.id} className="bg-black text-foreground">
                                    {partner.name} · {partner.billingEmail}
                                </option>
                            ))}
                        </select>
                    </div>
                </ConsoleCard>
            ) : null}

            {errorMessage ? (
                <div className="border border-danger/40 bg-danger/10 p-3 font-mono text-xs text-danger font-bold">
                    ERR: {errorMessage}
                </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Total requests" value={overview?.total_requests ?? 0} />
                <MetricCard
                    label="Success rate"
                    value={`${toPct(overview ? (overview.successful_requests / Math.max(1, overview.total_requests)) * 100 : 0)}%`}
                    tone={(overview?.successful_requests ?? 0) / Math.max(1, overview?.total_requests ?? 0) < 0.95 ? 'warning' : 'default'}
                />
                <MetricCard label="Avg response time" value={`${overview?.avg_response_time_ms ?? 0} ms`} />
                <MetricCard label="Quota used" value={`${quota?.pct_used ?? 0}%`} tone={(quota?.pct_used ?? 0) > 90 ? 'danger' : (quota?.pct_used ?? 0) > 70 ? 'warning' : 'default'} />
            </div>

            <ConsoleCard title="Quota Progress">
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_88%)] font-bold mb-1">Consumption Vector</div>
                            <div className="text-xl font-mono font-bold text-foreground">
                                {quota?.requests_used?.toLocaleString() ?? 0} / {quota?.requests_limit?.toLocaleString() ?? 0} requests
                            </div>
                        </div>
                        {!adminMode && (quota?.pct_used ?? 0) > 80 ? (
                            <TerminalButton onClick={() => window.location.href = '/developer/billing'}>
                                UPGRADE PLAN
                            </TerminalButton>
                        ) : null}
                    </div>
                    
                    <div className="h-2 border border-grid bg-black/40">
                        <div
                            className={`h-full transition-all duration-500 ${
                                (quota?.pct_used ?? 0) > 90 ? 'bg-danger' : 
                                (quota?.pct_used ?? 0) > 75 ? 'bg-warning' : 
                                'bg-accent'
                            }`}
                            style={{ width: `${Math.min(100, quota?.pct_used ?? 0)}%` }}
                        />
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                        <div className="font-mono text-[10px] uppercase tracking-widest text-[hsl(0_0%_75%)] font-bold">
                            Projected: <span className="text-foreground ml-1">{quota?.projected_month_end?.toLocaleString() ?? 0}</span>
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-[hsl(0_0%_75%)] font-bold">
                            Plan: <span className="text-foreground ml-1">{quota?.plan ?? 'LOADING...'}</span>
                        </div>
                        <div className={`font-mono text-[10px] uppercase tracking-widest font-bold ${quota?.on_track ? 'text-accent' : 'text-warning'}`}>
                            {quota?.on_track ? 'Status: Nominal' : 'Status: Over-Quota Projection'}
                        </div>
                    </div>
                </div>
            </ConsoleCard>

            <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
                <ConsoleCard title="Requests Over Time">
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_88%)] font-bold">Temporal Usage Trend</div>
                            <div className="flex flex-wrap gap-2">
                                <select
                                    className="border border-grid bg-black/40 px-3 py-1 font-mono text-[10px] text-foreground outline-none focus:border-accent"
                                    value={selectedEndpoint}
                                    onChange={(event) => setSelectedEndpoint(event.target.value)}
                                >
                                    <option value="">ALL ENDPOINTS</option>
                                    {endpoints.map((endpoint) => (
                                        <option key={`${endpoint.method}-${endpoint.endpoint}`} value={endpoint.endpoint}>
                                            {endpoint.method} {endpoint.endpoint}
                                        </option>
                                    ))}
                                </select>
                                <div className="flex border border-grid bg-black/40">
                                    {(['hour', 'day'] as const).map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            onClick={() => setGranularity(option)}
                                            className={`px-3 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                                                granularity === option ? 'bg-accent text-black font-bold' : 'text-[hsl(0_0%_75%)] hover:text-foreground'
                                            }`}
                                        >
                                            {option}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="h-[280px] w-full">
                            <Line
                                data={requestSeries}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    scales: {
                                        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { family: 'monospace', size: 9 } } },
                                        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { family: 'monospace', size: 9 } } }
                                    },
                                    plugins: { legend: { display: false } },
                                }}
                            />
                        </div>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Error Breakdown">
                    <div className="space-y-4">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_88%)] font-bold">HTTP Status Distribution</div>
                        <div className="h-[280px] w-full">
                            <Bar
                                data={errorSeries}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    scales: {
                                        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { family: 'monospace', size: 9 } } },
                                        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { family: 'monospace', size: 9 } } }
                                    },
                                    plugins: { legend: { display: false } },
                                }}
                            />
                        </div>
                    </div>
                </ConsoleCard>
            </div>

            <ConsoleCard title="Endpoint Performance Matrix">
                <div className="overflow-x-auto p-1">
                    <table className="w-full font-mono text-[11px] leading-relaxed">
                        <thead>
                            <tr className="border-b border-grid text-[hsl(0_0%_88%)] uppercase tracking-wider font-bold">
                                <th className="py-2 text-left">Endpoint</th>
                                <th className="py-2 text-right">Count</th>
                                <th className="py-2 text-right">Success</th>
                                <th className="py-2 text-right">Avg MS</th>
                                <th className="py-2 text-right">P95 MS</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-grid/20">
                            {endpoints.map((endpoint) => (
                                <tr key={`${endpoint.method}-${endpoint.endpoint}`} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="py-2 text-foreground font-bold">{endpoint.method} {endpoint.endpoint}</td>
                                    <td className="py-2 text-right text-[hsl(0_0%_80%)]">{endpoint.count.toLocaleString()}</td>
                                    <td className={`py-2 text-right font-bold ${endpoint.success_rate < 95 ? 'text-warning' : 'text-accent'}`}>
                                        {endpoint.success_rate}%
                                    </td>
                                    <td className="py-2 text-right text-[hsl(0_0%_80%)]">{endpoint.avg_ms}ms</td>
                                    <td className="py-2 text-right text-[hsl(0_0%_80%)]">{endpoint.p95_ms}ms</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ConsoleCard>

            <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
                <ConsoleCard title="Credential Activity Log">
                    <div className="space-y-3">
                        {(credentials ?? []).map((credential) => (
                            <div key={credential.id} className="border border-grid bg-black/20 p-3 font-mono">
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                                    <div>
                                        <div className="text-accent font-bold truncate max-w-[200px]">{credential.key_prefix}...</div>
                                        <div className="text-[10px] text-[hsl(0_0%_88%)] font-bold">{credential.label ?? 'ROOT_KEY'}</div>
                                    </div>
                                    <TerminalButton 
                                        onClick={() => void revokeCredential(credential.id, adminMode, selectedPartner)}
                                        className="text-[9px] px-2 py-1 h-auto"
                                    >
                                        REVOKE
                                    </TerminalButton>
                                </div>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {credential.scopes.map((scope) => (
                                        <span key={scope} className="text-[9px] border border-grid px-1.5 py-0.5 text-[hsl(0_0%_80%)] uppercase font-bold">
                                            {scope}
                                        </span>
                                    ))}
                                </div>
                                <div className="text-[9px] text-[hsl(0_0%_72%)] font-medium">
                                    LAST_USED: {credential.last_used_at ? new Date(credential.last_used_at).toLocaleTimeString() : 'INIT'}
                                </div>
                            </div>
                        ))}
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Recent Failure Profile">
                    <div className="space-y-3">
                        {errors.map((entry) => (
                            <div key={entry.status_code} className="border border-grid bg-black/20 p-3 font-mono">
                                <div className="flex items-center justify-between gap-3 mb-1">
                                    <span className={`text-[11px] font-bold ${entry.status_code >= 500 ? 'text-danger' : 'text-warning'}`}>
                                        HTTP {entry.status_code}
                                    </span>
                                    <span className="text-[10px] text-[hsl(0_0%_88%)] font-bold">
                                        {entry.count} EVTS · {entry.pct}%
                                    </span>
                                </div>
                                <p className="text-[10px] text-[hsl(0_0%_75%)] font-medium truncate italic">
                                    {entry.sample_endpoint ?? 'N/A_PATH'}
                                </p>
                            </div>
                        ))}
                        {errors.length === 0 && (
                            <div className="text-[10px] text-accent font-bold uppercase tracking-widest">No terminal errors detected.</div>
                        )}
                    </div>
                </ConsoleCard>
            </div>

            {isLoading ? (
                <div className="font-mono text-[10px] text-accent font-bold animate-pulse">SYNCHRONIZING ANALYTICS STREAM...</div>
            ) : null}
        </div>
    );
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: string | number, tone?: 'default' | 'warning' | 'danger' }) {
    const toneColors = {
        default: 'text-foreground',
        warning: 'text-warning',
        danger: 'text-danger'
    };
    
    return (
        <ConsoleCard className="p-4">
            <p className="text-[9px] uppercase tracking-[0.24em] text-[hsl(0_0%_88%)] font-bold mb-2">{label}</p>
            <p className={`text-2xl font-mono font-bold ${toneColors[tone]}`}>{value}</p>
        </ConsoleCard>
    );
}

function toPct(value: number) {
    return Math.round(value * 100) / 100;
}

async function revokeCredential(credentialId: string, adminMode: boolean, partnerId: string) {
    if (!confirm('CONFIRM CREDENTIAL REVOCATION? THIS ACTION IS IRREVERSIBLE.')) return;
    
    const url = adminMode && partnerId
        ? `/api/admin/partners/${partnerId}/credentials/revoke`
        : '/api/developer/credentials/revoke';

    const body = { credentialId };

    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    window.location.reload();
}
