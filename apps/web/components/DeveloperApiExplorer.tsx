'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConsoleCard, TerminalLabel } from '@/components/ui/terminal';
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
        '/api/inference': JSON.stringify({
            model: { name: 'gpt-4o-mini', version: '1.0.0' },
            input: {
                input_signature: {
                    species: 'Canis lupus familiaris',
                    breed: 'Golden Retriever',
                    symptoms: ['lethargy', 'fever', 'loss of appetite'],
                    metadata: {},
                },
            },
        }, null, 2),
        '/api/outcome': JSON.stringify({
            inference_event_id: normalizedLatestInferenceEventId ?? '00000000-0000-0000-0000-000000000000',
            outcome: {
                type: 'confirmed_diagnosis',
                payload: {
                    confirmed_diagnosis: 'Parvovirus',
                    primary_condition_class: 'infectious',
                    emergency_level: 'urgent',
                },
                timestamp: new Date().toISOString(),
            },
        }, null, 2),
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
        '/api/evaluation': JSON.stringify({
            inference_event_id: normalizedLatestInferenceEventId ?? undefined,
            model_name: 'VetIOS Diagnostics',
            model_version: '1.0.0',
            predicted_confidence: 0.82,
            trigger_type: 'inference',
        }, null, 2),
    }), [normalizedLatestInferenceEventId]);

    const [endpoint, setEndpoint] = useState<ExplorerEndpoint>('/api/inference');
    const [payload, setPayload] = useState(defaultPayloads['/api/inference']);
    const [response, setResponse] = useState<string | null>(null);
    const [status, setStatus] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setPayload(defaultPayloads[endpoint]);
    }, [defaultPayloads, endpoint]);

    function handleEndpointChange(nextEndpoint: ExplorerEndpoint) {
        setEndpoint(nextEndpoint);
        setResponse(null);
        setStatus(null);
    }

    async function handleExecute() {
        setLoading(true);
        setResponse(null);
        setStatus(null);

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
            });

            setStatus(res.status);
            const data = await res.json();
            setResponse(JSON.stringify(data, null, 2));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            setStatus(500);
            setResponse(JSON.stringify({ error: message }, null, 2));
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
                                disabled
                                value="Bearer <Tenant_JWT_Token>"
                                className="w-full bg-dim border border-grid p-2 font-mono text-[10px] text-muted outline-none cursor-not-allowed"
                            />
                        </div>
                        <div>
                            <TerminalLabel>Tenant Scope</TerminalLabel>
                            <input
                                type="text"
                                disabled
                                value="Current authenticated tenant"
                                className="w-full bg-dim border border-grid p-2 font-mono text-[10px] text-muted outline-none cursor-not-allowed"
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
                        disabled={loading || ((endpoint === '/api/outcome' || endpoint === '/api/evaluation') && !normalizedLatestInferenceEventId)}
                        className={`px-4 py-1.5 font-mono text-[10px] tracking-widest uppercase flex items-center gap-2 transition-colors border ${
                            loading || ((endpoint === '/api/outcome' || endpoint === '/api/evaluation') && !normalizedLatestInferenceEventId)
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
                            Critical Dependency Missing: No canonical inference UUID found. Run <span className="font-bold">POST /api/inference</span> first, or use a value that contains the real inference UUID.
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
                    {status != null && (
                        <span className={`font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border flex items-center gap-1 ${
                            status >= 200 && status < 300
                                ? 'border-accent text-accent bg-accent/10'
                                : 'border-danger text-danger bg-danger/10'
                        }`}>
                            {status >= 200 && status < 300 ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                            {status >= 200 && status < 300 ? `${status} OK` : `${status} ERR`}
                        </span>
                    )}
                </div>
                <div className="flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre text-accent/80 relative z-10">
                    {loading ? 'WAITING FOR I/O...' : response || 'No data. Execute request.'}
                </div>
                <div className="absolute inset-0 z-0 bg-transparent flex items-center justify-center pointer-events-none opacity-5">
                    <span className="font-mono text-9xl tracking-widest rotate-90 scale-150">VETIOS</span>
                </div>
            </div>
        </div>
    );
}
