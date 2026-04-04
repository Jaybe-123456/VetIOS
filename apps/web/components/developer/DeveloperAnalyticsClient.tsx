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
                borderColor: '#0f766e',
                backgroundColor: 'rgba(15, 118, 110, 0.18)',
                fill: true,
                tension: 0.32,
            },
        ],
    }), [timeseries]);

    const errorSeries = useMemo(() => ({
        labels: errors.map((entry) => String(entry.status_code)),
        datasets: [
            {
                label: 'Error count',
                data: errors.map((entry) => entry.count),
                backgroundColor: errors.map((entry) => entry.status_code >= 500 ? '#dc2626' : '#f59e0b'),
            },
        ],
    }), [errors]);

    return (
        <div className="space-y-8">
            <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.32em] text-teal-700">Developer Analytics</p>
                <h1 className="text-3xl font-semibold text-slate-950">
                    {adminMode ? 'Partner Lifecycle Analytics' : 'API Lifecycle Analytics'}
                </h1>
                <p className="max-w-3xl text-sm text-slate-600">
                    Track quota consumption, endpoint behavior, and reliability signals for the VetIOS developer moat.
                </p>
            </div>

            {adminMode ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Partner</label>
                    <select
                        className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
                        value={selectedPartner}
                        onChange={(event) => setSelectedPartner(event.target.value)}
                    >
                        {partners.map((partner) => (
                            <option key={partner.id} value={partner.id}>
                                {partner.name} · {partner.billingEmail}
                            </option>
                        ))}
                    </select>
                </div>
            ) : null}

            {errorMessage ? (
                <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {errorMessage}
                </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Total requests" value={overview?.total_requests ?? 0} />
                <MetricCard
                    label="Success rate"
                    value={`${toPct(overview ? (overview.successful_requests / Math.max(1, overview.total_requests)) * 100 : 0)}%`}
                />
                <MetricCard label="Avg response time" value={`${overview?.avg_response_time_ms ?? 0} ms`} />
                <MetricCard label="Quota used" value={`${quota?.pct_used ?? 0}%`} />
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Quota progress</p>
                        <h2 className="text-xl font-semibold text-slate-950">
                            {quota?.requests_used ?? 0} / {quota?.requests_limit ?? 0} requests this period
                        </h2>
                    </div>
                    {!adminMode && (quota?.pct_used ?? 0) > 80 ? (
                        <a
                            href="/developer/billing"
                            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
                        >
                            Upgrade plan
                        </a>
                    ) : null}
                </div>
                <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                        className={progressClass(quota?.pct_used ?? 0)}
                        style={{ width: `${Math.min(100, quota?.pct_used ?? 0)}%` }}
                    />
                </div>
                <div className="mt-4 flex flex-wrap gap-6 text-sm text-slate-600">
                    <span>Projected month end: {quota?.projected_month_end ?? 0}</span>
                    <span>Plan: {quota?.plan ?? 'unknown'}</span>
                    <span>{quota?.on_track ? 'On track' : 'Projected to exceed plan quota'}</span>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
                <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Requests over time</p>
                            <h2 className="text-xl font-semibold text-slate-950">Usage trend</h2>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <select
                                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm"
                                value={selectedEndpoint}
                                onChange={(event) => setSelectedEndpoint(event.target.value)}
                            >
                                <option value="">All endpoints</option>
                                {endpoints.map((endpoint) => (
                                    <option key={`${endpoint.method}-${endpoint.endpoint}`} value={endpoint.endpoint}>
                                        {endpoint.method} {endpoint.endpoint}
                                    </option>
                                ))}
                            </select>
                            <div className="flex overflow-hidden rounded-full border border-slate-200">
                                {(['hour', 'day'] as const).map((option) => (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => setGranularity(option)}
                                        className={`px-4 py-2 text-sm ${granularity === option ? 'bg-slate-950 text-white' : 'bg-white text-slate-700'}`}
                                    >
                                        {option === 'hour' ? 'Hourly' : 'Daily'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="mt-6 h-[320px]">
                        <Line
                            data={requestSeries}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                            }}
                        />
                    </div>
                </section>

                <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Error breakdown</p>
                    <h2 className="text-xl font-semibold text-slate-950">HTTP error mix</h2>
                    <div className="mt-6 h-[320px]">
                        <Bar
                            data={errorSeries}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                            }}
                        />
                    </div>
                </section>
            </div>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Endpoint breakdown</p>
                <h2 className="text-xl font-semibold text-slate-950">Most active endpoints</h2>
                <div className="mt-5 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                        <thead className="text-slate-500">
                            <tr>
                                <th className="pb-3 font-medium">Endpoint</th>
                                <th className="pb-3 font-medium">Requests</th>
                                <th className="pb-3 font-medium">Success rate</th>
                                <th className="pb-3 font-medium">Avg ms</th>
                                <th className="pb-3 font-medium">P95 ms</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {endpoints.map((endpoint) => (
                                <tr key={`${endpoint.method}-${endpoint.endpoint}`}>
                                    <td className="py-3 pr-6 text-slate-900">{endpoint.method} {endpoint.endpoint}</td>
                                    <td className="py-3 pr-6 text-slate-700">{endpoint.count}</td>
                                    <td className={`py-3 pr-6 font-medium ${successRateClass(endpoint.success_rate)}`}>
                                        {endpoint.success_rate}%
                                    </td>
                                    <td className="py-3 pr-6 text-slate-700">{endpoint.avg_ms}</td>
                                    <td className="py-3 text-slate-700">{endpoint.p95_ms}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
                <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Recent API keys</p>
                    <h2 className="text-xl font-semibold text-slate-950">Credential activity</h2>
                    <div className="mt-5 space-y-3">
                        {(credentials ?? []).map((credential) => (
                            <div key={credential.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="font-medium text-slate-900">{credential.key_prefix}</p>
                                        <p className="text-sm text-slate-600">{credential.label ?? 'Unlabeled key'}</p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            Last used: {credential.last_used_at ? new Date(credential.last_used_at).toLocaleString() : 'never'}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void revokeCredential(credential.id, adminMode, selectedPartner)}
                                        className="rounded-full border border-rose-200 px-4 py-2 text-sm text-rose-700"
                                    >
                                        Revoke
                                    </button>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {credential.scopes.map((scope) => (
                                        <span key={scope} className="rounded-full bg-white px-3 py-1 text-xs text-slate-700">
                                            {scope}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Errors</p>
                    <h2 className="text-xl font-semibold text-slate-950">Recent failure profile</h2>
                    <div className="mt-5 space-y-3">
                        {errors.map((entry) => (
                            <div key={entry.status_code} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                                <div className="flex items-center justify-between gap-4">
                                    <span className="font-medium text-slate-900">HTTP {entry.status_code}</span>
                                    <span className="text-sm text-slate-600">{entry.count} events · {entry.pct}%</span>
                                </div>
                                <p className="mt-2 text-sm text-slate-600">{entry.sample_endpoint ?? 'No sample endpoint recorded.'}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {isLoading ? (
                <div className="text-sm text-slate-500">Refreshing analytics…</div>
            ) : null}
        </div>
    );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
        </div>
    );
}

function progressClass(pctUsed: number) {
    if (pctUsed > 90) return 'h-full rounded-full bg-rose-500';
    if (pctUsed > 70) return 'h-full rounded-full bg-amber-500';
    return 'h-full rounded-full bg-emerald-500';
}

function successRateClass(value: number) {
    if (value < 85) return 'text-rose-600';
    if (value < 95) return 'text-amber-600';
    return 'text-emerald-600';
}

function toPct(value: number) {
    return Math.round(value * 100) / 100;
}

async function revokeCredential(credentialId: string, adminMode: boolean, partnerId: string) {
    const url = adminMode && partnerId
        ? `/api/admin/partners/${partnerId}/credentials/revoke`
        : '/api/developer/credentials/revoke';

    const body = adminMode && partnerId
        ? { credentialId }
        : { credentialId };

    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    window.location.reload();
}
