'use client';

import { useState, useEffect } from 'react';
import { Container, PageHeader, ConsoleCard } from '@/components/ui/terminal';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { Activity, Terminal } from 'lucide-react';

const generateDriftData = () => Array.from({ length: 40 }).map((_, i) => ({
    time: `t-${40 - i}`,
    drift: Math.sin(i / 5) * 0.05 + 0.02 + Math.random() * 0.02
}));

const generateLatencyData = () => Array.from({ length: 40 }).map((_, i) => ({
    time: `t-${40 - i}`,
    latency: 120 + Math.sin(i / 3) * 40 + Math.random() * 20
}));

export default function TelemetrySystem() {
    const [logs, setLogs] = useState<string[]>([]);

    useEffect(() => {
        const interval = setInterval(() => {
            const types = ['INFO', 'WARN', 'ERROR', 'DEBUG'];
            const type = types[Math.floor(Math.random() * types.length)] || 'INFO';
            const hash = Math.random().toString(36).substr(2, 8);
            const msg = `[${type}] INFERENCE_NODE_7: Processed vector ${hash} in ${Math.floor(Math.random() * 200 + 50)}ms`;

            setLogs(prev => [msg, ...prev].slice(0, 15));
        }, 1500);
        return () => clearInterval(interval);
    }, []);

    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="TELEMETRY OBSERVATOR"
                description="Live system health, metric streaming, and model drift telemetry."
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <ConsoleCard className="p-4 border-accent/20">
                    <div className="font-mono text-[10px] text-muted uppercase mb-1">Global API Error Rate</div>
                    <div className="font-mono text-2xl text-accent">0.04%</div>
                </ConsoleCard>
                <ConsoleCard className="p-4 border-danger/30">
                    <div className="font-mono text-[10px] text-muted uppercase mb-1">Confidence Drift (24h)</div>
                    <div className="font-mono text-2xl text-danger">-2.1% <span className="text-xs">shift</span></div>
                </ConsoleCard>
                <ConsoleCard className="p-4 border-accent/20">
                    <div className="font-mono text-[10px] text-muted uppercase mb-1">W-Delta Reinforcement</div>
                    <div className="font-mono text-2xl text-accent">+0.0042 <span className="text-xs">avg</span></div>
                </ConsoleCard>
                <ConsoleCard className="p-4 border-accent/20">
                    <div className="font-mono text-[10px] text-muted uppercase mb-1">Simulated Edge Cases</div>
                    <div className="font-mono text-2xl text-accent">45,210 <span className="text-xs">evals</span></div>
                </ConsoleCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <ConsoleCard title="Inference Latency (Global p95) - ms" className="h-[300px]">
                    <div className="flex-1 -mx-4">
                        <TelemetryChart data={generateLatencyData()} dataKey="latency" color="#00ff41" />
                    </div>
                </ConsoleCard>
                <ConsoleCard title="Data Label Drift Distance (L2 Norm)" className="h-[300px]">
                    <div className="flex-1 -mx-4">
                        <TelemetryChart data={generateDriftData()} dataKey="drift" color="#ff3333" />
                    </div>
                </ConsoleCard>
            </div>

            <ConsoleCard title="System Log Stream">
                <div className="bg-black border border-grid/50 p-4 h-[250px] overflow-hidden flex flex-col font-mono text-xs">
                    <div className="flex items-center gap-2 text-accent/50 mb-4 border-b border-grid/50 pb-2">
                        <Terminal className="w-4 h-4" />
                        <span>TAIL -F /VAR/LOG/VETIOS/RUNTIME.LOG</span>
                        <Activity className="w-3 h-3 ml-auto animate-pulse" />
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1 text-muted/80">
                        {logs.map((log, i) => (
                            <div key={i} className={`truncate ${log.includes('ERROR') ? 'text-danger' : log.includes('WARN') ? 'text-[#ffcc00]' : ''}`}>
                                <span className="text-muted/40 mr-2">{new Date().toISOString().split('T')[1].slice(0, 12)}</span>
                                {log}
                            </div>
                        ))}
                    </div>
                </div>
            </ConsoleCard>
        </Container>
    );
}
