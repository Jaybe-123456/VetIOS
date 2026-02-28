'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, TerminalButton, TerminalLabel } from '@/components/ui/terminal';
import { Play, Code, AlertTriangle, ShieldCheck, Activity } from 'lucide-react';

export default function SettingsAPIExplorer() {
    const [endpoint, setEndpoint] = useState<'/api/inference' | '/api/outcome' | '/api/simulate'>('/api/inference');

    // Default payloads based on endpoint
    const defaultPayloads = {
        '/api/inference': JSON.stringify({
            model: { name: "gpt-4-turbo", version: "1.0.0" },
            input: {
                input_signature: {
                    species: "Canis lupus familiaris",
                    breed: "Golden Retriever",
                    symptoms: ["lethargy", "fever", "loss of appetite"],
                    metadata: {}
                }
            }
        }, null, 2),
        '/api/outcome': JSON.stringify({
            inference_event_id: "evt_example123",
            actual_diagnosis: "Parvovirus Validation",
            notes: "Confirmed via PCR."
        }, null, 2),
        '/api/simulate': JSON.stringify({
            edge_cases: "hypothermia + fever",
            contradictions: "age: 2mo, weight: 80kg",
            target_disease: "Canine Distemper",
            iterations: 10
        }, null, 2),
    };

    const [payload, setPayload] = useState(defaultPayloads[endpoint]);
    const [response, setResponse] = useState<string | null>(null);
    const [status, setStatus] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);

    const handleEndpointChange = (newEndpoint: '/api/inference' | '/api/outcome' | '/api/simulate') => {
        setEndpoint(newEndpoint);
        setPayload(defaultPayloads[newEndpoint]);
        setResponse(null);
        setStatus(null);
    };

    async function handleTestAPI() {
        setLoading(true);
        setResponse(null);
        setStatus(null);

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            });

            setStatus(res.status);

            const data = await res.json();
            setResponse(JSON.stringify(data, null, 2));
        } catch (error: any) {
            setStatus(500);
            setResponse(JSON.stringify({ error: error.message }, null, 2));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="DEVELOPER API EXPLORER"
                description="Raw interaction sandbox for VetIOS integration nodes. Execute direct POST requests."
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-3 space-y-2">
                    <ConsoleCard title="Endpoints" className="p-4 gap-2 border-grid border-r-0 lg:border-r">
                        <button
                            onClick={() => handleEndpointChange('/api/inference')}
                            className={`flex flex-col items-start p-3 w-full border transition-all text-left ${endpoint === '/api/inference' ? 'border-accent bg-accent/10 border-l-4 border-l-accent' : 'border-grid hover:border-muted text-muted'}`}
                        >
                            <span className="font-mono text-xs font-bold tracking-widest uppercase flex items-center gap-2">POST <span className="text-foreground">/api/inference</span></span>
                        </button>
                        <button
                            onClick={() => handleEndpointChange('/api/outcome')}
                            className={`flex flex-col items-start p-3 w-full border transition-all text-left ${endpoint === '/api/outcome' ? 'border-accent bg-accent/10 border-l-4 border-l-accent' : 'border-grid hover:border-muted text-muted'}`}
                        >
                            <span className="font-mono text-xs font-bold tracking-widest uppercase flex items-center gap-2">POST <span className="text-foreground">/api/outcome</span></span>
                        </button>
                        <button
                            onClick={() => handleEndpointChange('/api/simulate')}
                            className={`flex flex-col items-start p-3 w-full border transition-all text-left ${endpoint === '/api/simulate' ? 'border-danger text-danger bg-danger/10 border-l-4 border-l-danger' : 'border-grid hover:border-muted text-muted'}`}
                        >
                            <span className="font-mono text-xs font-bold tracking-widest uppercase flex items-center gap-2">POST <span className="text-foreground">/api/simulate</span></span>
                        </button>
                    </ConsoleCard>

                    <ConsoleCard title="Settings" className="p-4">
                        <div className="space-y-4">
                            <div>
                                <TerminalLabel>Authorization Header</TerminalLabel>
                                <input type="text" disabled value="Bearer <Tenant_JWT_Token>" className="w-full bg-dim border border-grid p-2 font-mono text-[10px] text-muted outline-none cursor-not-allowed" />
                            </div>
                            <div>
                                <TerminalLabel>Tenant ID Override</TerminalLabel>
                                <input type="text" disabled value="tenant_xyz_001 (Locked)" className="w-full bg-dim border border-grid p-2 font-mono text-[10px] text-muted outline-none cursor-not-allowed" />
                            </div>
                        </div>
                    </ConsoleCard>
                </div>

                <div className="lg:col-span-5 flex flex-col h-full border border-grid bg-background">
                    <div className="flex items-center justify-between p-3 border-b border-grid bg-dim">
                        <span className="font-mono text-xs text-muted uppercase tracking-widest flex items-center gap-2">
                            <Code className="w-4 h-4" /> Request Payload (JSON)
                        </span>
                        <button
                            onClick={handleTestAPI}
                            disabled={loading}
                            className={`px-4 py-1.5 font-mono text-[10px] tracking-widest uppercase flex items-center gap-2 transition-colors border ${endpoint === '/api/simulate' ? 'border-danger text-danger hover:bg-danger hover:text-white' : 'border-accent text-accent hover:bg-accent hover:text-black'}`}
                        >
                            {loading ? <Activity className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                            Execute
                        </button>
                    </div>
                    <textarea
                        value={payload}
                        onChange={(e) => setPayload(e.target.value)}
                        className="flex-1 w-full bg-transparent p-4 font-mono text-xs text-foreground focus:outline-none resize-none min-h-[400px]"
                        spellCheck={false}
                    />
                </div>

                <div className="lg:col-span-4 flex flex-col h-full border border-grid bg-black relative">
                    <div className="flex items-center justify-between p-3 border-b border-grid bg-dim relative z-10">
                        <span className="font-mono text-xs text-muted uppercase tracking-widest flex items-center gap-2">
                            Raw System Response
                        </span>
                        {status && (
                            <span className={`font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border flex items-center gap-1 ${status === 200 ? 'border-accent text-accent bg-accent/10' : 'border-danger text-danger bg-danger/10'}`}>
                                {status === 200 ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                {status} {status === 200 ? 'OK' : 'ERR'}
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
        </Container>
    );
}
