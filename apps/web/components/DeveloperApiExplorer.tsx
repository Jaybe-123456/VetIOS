'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConsoleCard, TerminalLabel } from '@/components/ui/terminal';
import {
    extractApiErrorMessage,
    formatHttpStatus,
    requestJson,
    stringifyApiBody,
} from '@/lib/debugTools/client';
import {
    buildEvaluationTestPayload,
    buildInferenceTestPayload,
    buildOutcomeTestPayload,
} from '@/lib/debugTools/payloads';
import { extractUuidFromText } from '@/lib/utils/uuid';
import { Activity, AlertTriangle, Code, Play, ShieldCheck } from 'lucide-react';

type ExplorerEndpoint = '/api/inference' | '/api/outcome' | '/api/simulate' | '/api/evaluation';

const ENDPOINTS: ExplorerEndpoint[] = [
    '/api/inference',
    '/api/outcome',
    '/api/simulate',
    '/api/evaluation',
];

export default function DeveloperApiExplorer({
    latestInferenceEventId,
}: {
    latestInferenceEventId?: string | null;
}) {
    const normalizedLatestInferenceEventId = useMemo(
        () => extractUuidFromText(latestInferenceEventId),
        [latestInferenceEventId],
    );

    const defaultPayloads = useMemo<Record<ExplorerEndpoint, string>>(() => ({
        '/api/inference': JSON.stringify(buildInferenceTestPayload(), null, 2),
        '/api/outcome': JSON.stringify(buildOutcomeTestPayload(normalizedLatestInferenceEventId ?? ''), null, 2),
        '/api/simulate': JSON.stringify({
            simulation: {
                type: 'adversarial_case',
                parameters: {
                    target_disease: 'Canine Distemper',
                    edge_cases: 'hypothermia + fever',
                    contradictions: 'age: 2mo, weight: 80kg',
                },
            },
            inference: {
                model: 'gpt-4o-mini',
                model_version: '1.0.0',
            },
        }, null, 2),
        '/api/evaluation': JSON.stringify(buildEvaluationTestPayload(normalizedLatestInferenceEventId), null, 2),
    }), [normalizedLatestInferenceEventId]);

    const [endpoint, setEndpoint] = useState<ExplorerEndpoint>('/api/inference');
    const [payload, setPayload] = useState(defaultPayloads['/api/inference']);
    const [responseBody, setResponseBody] = useState<unknown>(null);
    const [status, setStatus] = useState<number | null>(null);
    const [statusText, setStatusText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [authHeaderValue, setAuthHeaderValue] = useState('');
    const [tenantScopeValue, setTenantScopeValue] = useState('');
    const showAuthWarning = authHeaderValue.trim().length === 0;

    useEffect(() => {
        setPayload(defaultPayloads[endpoint]);
    }, [defaultPayloads, endpoint]);

    function handleEndpointChange(nextEndpoint: ExplorerEndpoint) {
        setEndpoint(nextEndpoint);
        setResponseBody(null);
        setStatus(null);
        setStatusText(null);
    }

    async function handleExecute() {
        setLoading(true);
        setResponseBody(null);
        setStatus(null);
        setStatusText(null);

        try {
            const { response, body } = await requestJson(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: authHeaderValue,
                    'Content-Type': 'application/json',
                    'X-Tenant-Scope': tenantScopeValue,
                },
                body: payload,
            });

            setStatus(response.status);
            setStatusText(response.statusText);
            setResponseBody(body);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            setStatus(null);
            setStatusText(null);
            setResponseBody({ error: message });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div className="xl:col-span-3 space-y-4">
                <ConsoleCard title="Endpoints" className="p-4 gap-2 border-grid border-r-0">
                    {ENDPOINTS.map((value) => (
                        <button
                            key={value}
                            onClick={() => handleEndpointChange(value)}
                            className={`flex flex-col items-start p-3 w-full border transition-all text-left ${
                                endpoint === value
                                    ? 'border-accent bg-accent/10 border-l-4 border-l-accent'
                                    : value === '/api/simulate'
                                        ? 'border-danger/30 hover:border-danger text-muted'
                                        : 'border-grid hover:border-muted text-muted'
                            }`}
                        >
                            <span className="font-mono text-xs font-bold tracking-widest uppercase flex items-center gap-2">
                                POST <span className="text-foreground">{value}</span>
                            </span>
                        </button>
                    ))}
                </ConsoleCard>

                <ConsoleCard title="Explorer Context" className="p-4">
                    <div className="space-y-4">
                        <div>
                            <TerminalLabel>Authorization Header</TerminalLabel>
                            <input
                                type="text"
                                value={authHeaderValue}
                                onChange={(event) => setAuthHeaderValue(event.target.value)}
                                placeholder="Bearer <Tenant_JWT_Token>"
                                className="w-full bg-dim border border-grid p-2 font-mono text-[10px] text-foreground outline-none"
                            />
                            {showAuthWarning && (
                                <div className="mt-2 border border-yellow-500/30 bg-yellow-500/10 p-2 font-mono text-[10px] text-yellow-300">
                                    Authorization header is empty. This request will run without one and may rely on the current session instead.
                                </div>
                            )}
                        </div>
                        <div>
                            <TerminalLabel>Tenant Scope</TerminalLabel>
                            <input
                                type="text"
                                value={tenantScopeValue}
                                onChange={(event) => setTenantScopeValue(event.target.value)}
                                placeholder="Current authenticated tenant"
                                className="w-full bg-dim border border-grid p-2 font-mono text-[10px] text-foreground outline-none"
                            />
                        </div>
                        <div>
                            <TerminalLabel>Latest Inference Event</TerminalLabel>
                            <input
                                type="text"
                                disabled
                                value={normalizedLatestInferenceEventId ?? latestInferenceEventId ?? 'No inference event available yet'}
                                className="w-full bg-dim border border-grid p-2 font-mono text-[10px] text-muted outline-none cursor-not-allowed"
                            />
                        </div>
                    </div>
                </ConsoleCard>
            </div>

            <div className="xl:col-span-5 flex flex-col h-full border border-grid bg-background">
                <div className="flex items-center justify-between p-3 border-b border-grid bg-dim">
                    <span className="font-mono text-xs text-muted uppercase tracking-widest flex items-center gap-2">
                        <Code className="w-4 h-4" /> Request Payload (JSON)
                    </span>
                    <button
                        onClick={handleExecute}
                        disabled={loading}
                        className={`px-4 py-1.5 font-mono text-[10px] tracking-widest uppercase flex items-center gap-2 transition-colors border ${
                            loading
                                ? 'border-grid text-muted cursor-not-allowed'
                                : endpoint === '/api/simulate'
                                    ? 'border-danger text-danger hover:bg-danger hover:text-white'
                                    : 'border-accent text-accent hover:bg-accent hover:text-black'
                        }`}
                    >
                        {loading ? <Activity className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        Execute
                    </button>
                </div>
                {((endpoint === '/api/outcome' || endpoint === '/api/evaluation') && !normalizedLatestInferenceEventId) && (
                    <div className="bg-danger/10 border-b border-danger/30 p-3 flex items-center gap-3">
                        <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                        <span className="font-mono text-[10px] text-danger uppercase tracking-tight">
                            Latest inference UUID is unavailable. Execute <span className="font-bold">POST /api/inference</span> first, or replace the request payload with a real inference event id before executing.
                        </span>
                    </div>
                )}
                <textarea
                    value={payload}
                    onChange={(event) => setPayload(event.target.value)}
                    className="flex-1 w-full bg-transparent p-4 font-mono text-xs text-foreground focus:outline-none resize-none min-h-[360px]"
                    spellCheck={false}
                />
            </div>

            <div className="xl:col-span-4 flex flex-col h-full border border-grid bg-black relative">
                <div className="flex items-center justify-between p-3 border-b border-grid bg-dim relative z-10">
                    <span className="font-mono text-xs text-muted uppercase tracking-widest">
                        Raw System Response
                    </span>
                </div>
                <div className="flex-1 overflow-auto p-4 font-mono text-xs text-accent/80 relative z-10">
                    {status != null && (
                        <div className="mb-3">
                            <span className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 border inline-flex items-center gap-1 ${
                                status >= 200 && status < 300
                                    ? 'border-accent text-accent bg-accent/10'
                                    : 'border-danger text-danger bg-danger/10'
                            }`}>
                                {status >= 200 && status < 300 ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                {formatHttpStatus(status, statusText)}
                            </span>
                        </div>
                    )}

                    {loading ? (
                        <div className="font-mono text-xs text-yellow-300 flex items-center gap-2">
                            <Activity className="w-4 h-4 animate-spin" />
                            WAITING FOR I/O...
                        </div>
                    ) : (
                        <pre className="max-h-[30rem] overflow-y-auto whitespace-pre-wrap break-words">
                            {responseBody == null ? 'No data. Execute request.' : stringifyApiBody(responseBody)}
                        </pre>
                    )}
                    {!loading && status != null && status >= 400 && responseBody != null && (
                        <div className="mt-3 border border-danger/30 bg-danger/10 p-3 font-mono text-[10px] text-danger">
                            {extractApiErrorMessage(responseBody, 'Request failed.')}
                        </div>
                    )}
                </div>
                <div className="absolute inset-0 z-0 bg-transparent flex items-center justify-center pointer-events-none opacity-5">
                    <span className="font-mono text-9xl tracking-widest rotate-90 scale-150">VETIOS</span>
                </div>
            </div>
        </div>
    );
}
