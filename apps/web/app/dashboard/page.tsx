'use client';

import { Container, PageHeader, ConsoleCard, DataRow } from '@/components/ui/terminal';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { Activity, Cpu, Database, Network } from 'lucide-react';

const mockLatencyData = Array.from({ length: 20 }).map((_, i) => ({
    time: `10:${(i * 2).toString().padStart(2, '0')}`,
    latency: Math.floor(Math.random() * 300) + 50
}));

const mockAccuracyData = Array.from({ length: 20 }).map((_, i) => ({
    time: `10:${(i * 2).toString().padStart(2, '0')}`,
    accuracy: 94 + Math.random() * 4
}));

export default function DashboardPage() {
    return (
        <Container>
            <PageHeader
                title="SYSTEM DASHBOARD"
                description="Real-time telemetry and network overview."
            />

            {/* Top Metrics Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-4 sm:mb-6">
                <ConsoleCard>
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10px] sm:text-xs text-muted uppercase">Inference Throughput</span>
                        <Cpu className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
                    </div>
                    <div className="font-mono text-lg sm:text-2xl">1,024 <span className="text-[10px] sm:text-xs text-muted">req/s</span></div>
                    <div className="font-mono text-[10px] text-accent mt-1 sm:mt-2">+12.5% from last hr</div>
                </ConsoleCard>
                <ConsoleCard>
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10px] sm:text-xs text-muted uppercase">Global Accuracy</span>
                        <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
                    </div>
                    <div className="font-mono text-lg sm:text-2xl">96.8% <span className="text-[10px] sm:text-xs text-muted">avg</span></div>
                    <div className="font-mono text-[10px] text-muted mt-1 sm:mt-2">Trailing 24h Window</div>
                </ConsoleCard>
                <ConsoleCard>
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10px] sm:text-xs text-muted uppercase">Active Clinics</span>
                        <Network className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
                    </div>
                    <div className="font-mono text-lg sm:text-2xl">142 <span className="text-[10px] sm:text-xs text-muted">nodes</span></div>
                    <div className="font-mono text-[10px] text-accent mt-1 sm:mt-2">3 new initialized</div>
                </ConsoleCard>
                <ConsoleCard>
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10px] sm:text-xs text-muted uppercase">Sim Stress Limit</span>
                        <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-danger" />
                    </div>
                    <div className="font-mono text-lg sm:text-2xl text-danger">88.5% <span className="text-[10px] sm:text-xs text-danger/50">cap</span></div>
                    <div className="font-mono text-[10px] text-danger mt-1 sm:mt-2">Approaching threshold</div>
                </ConsoleCard>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 lg:gap-6 mb-4 sm:mb-6">
                <ConsoleCard title="Network Latency (ms)" className="h-[240px] sm:h-[300px]" collapsible>
                    <div className="flex-1 -mx-2 sm:-mx-4">
                        <TelemetryChart data={mockLatencyData} dataKey="latency" color="#00ff41" />
                    </div>
                </ConsoleCard>
                <ConsoleCard title="Model Confidence Volatility" className="h-[240px] sm:h-[300px]" collapsible>
                    <div className="flex-1 -mx-2 sm:-mx-4">
                        <TelemetryChart data={mockAccuracyData} dataKey="accuracy" color="#00ff41" />
                    </div>
                </ConsoleCard>
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                <div className="lg:col-span-2">
                    <ConsoleCard title="Recent Inferences" collapsible>
                        <DataRow label="evt_98f4jd82" value={<span className="text-accent">Success (98% conf)</span>} />
                        <DataRow label="evt_23m5nx11" value={<span className="text-accent">Success (91% conf)</span>} />
                        <DataRow label="evt_p90lk12m" value={<span className="text-accent">Success (94% conf)</span>} />
                        <DataRow label="evt_84nvk29s" value={<span className="text-danger">Failed (Timeout)</span>} />
                        <DataRow label="evt_55bxz91a" value={<span className="text-accent">Success (89% conf)</span>} />
                    </ConsoleCard>
                </div>
                <div>
                    <ConsoleCard title="System Alerts" collapsible>
                        <div className="space-y-3 sm:space-y-4">
                            <div className="flex gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-danger mt-1.5 shrink-0" />
                                <div className="flex flex-col gap-1">
                                    <span className="font-mono text-xs text-danger uppercase tracking-wider">Sim Failure</span>
                                    <span className="font-mono text-[10px] text-muted">Adversarial node collapsed under 500req/s test load.</span>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
                                <div className="flex flex-col gap-1">
                                    <span className="font-mono text-xs text-accent uppercase tracking-wider">Deploy Success</span>
                                    <span className="font-mono text-[10px] text-muted">Model version v1.2 promoted to main inference queue.</span>
                                </div>
                            </div>
                        </div>
                    </ConsoleCard>
                </div>
            </div>
        </Container>
    );
}
