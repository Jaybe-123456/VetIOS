const fs = require('fs');

const file = 'apps/web/components/DashboardControlPlaneClient.tsx';
let content = fs.readFileSync(file, 'utf8');

// Add new imports to lucide-react
content = content.replace(
    "    Workflow,\n} from 'lucide-react';",
    "    Workflow,\n    Database,\n    Network,\n    ShieldAlert,\n    Cpu,\n} from 'lucide-react';"
);
content = content.replace(
    "    Workflow,\r\n} from 'lucide-react';",
    "    Workflow,\r\n    Database,\r\n    Network,\r\n    ShieldAlert,\r\n    Cpu,\r\n} from 'lucide-react';"
);

// We want to replace the second half of the header div that contains the "ml-auto" refresh span and the terminal buttons.
// Let's use a regex to replace everything between `<span className="ml-auto text-muted normal-case tracking-normal">`
// and `</div>\n\n                {requestError ? (` (which is the end of the top status area).

const regex = /<span className="ml-auto text-muted normal-case tracking-normal">[\s\S]*?Topology update \{formatTimestampOrState\(lastTopologyUpdate, topologyStreamStatus\)\}\s*<\/span>\s*<\/div>/g;

const replacement = `{/* ── Control Plane Operations HUD ── */}
                <ConsoleCard title="Control Plane Core Operations" className="mt-4 border-accent shadow-[0_0_15px_rgba(0,255,65,0.15)] bg-black/40 backdrop-blur-md" collapsible defaultCollapsed={false}>
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
                        <button type="button" onClick={() => void refreshSnapshot(false)} className="col-span-2 xl:col-span-1 border border-accent/60 shadow-[0_0_10px_rgba(0,255,65,0.2)] bg-accent/5 hover:bg-accent hover:text-black text-accent flex flex-col items-center justify-center gap-2 h-full py-5 transition-all text-[10px] sm:text-xs font-mono uppercase tracking-widest disabled:opacity-50">
                            <Activity className={\`w-6 h-6 \${refreshing ? 'animate-spin' : ''}\`} />
                            {refreshing ? 'REFRESHING...' : 'REFRESH\\nSNAPSHOT'}
                        </button>
                        <Link href="/settings" className="border border-grid hover:border-accent/50 bg-background/50 flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.8)]"><Route className="w-6 h-6" /></div>
                            <div className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-muted group-hover:text-foreground">Outbox Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-grid hover:border-accent/50 bg-background/50 flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.8)]"><Workflow className="w-6 h-6" /></div>
                            <div className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-muted group-hover:text-foreground">Federation Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-grid hover:border-[#ffcc00]/50 bg-background/50 flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-[#ffcc00] group-hover:drop-shadow-[0_0_8px_rgba(255,204,0,0.8)]"><Database className="w-6 h-6" /></div>
                            <div className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-muted group-hover:text-foreground">PetPass Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-grid hover:border-accent/50 bg-background/50 flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.8)]"><Network className="w-6 h-6" /></div>
                            <div className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-muted group-hover:text-foreground">Partner Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-grid hover:border-accent/50 bg-background/50 flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.8)]"><ShieldAlert className="w-6 h-6" /></div>
                            <div className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-muted group-hover:text-foreground">Trust Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-danger/50 hover:border-danger bg-background/50 flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-danger group-hover:drop-shadow-[0_0_8px_rgba(255,0,0,0.8)]"><Cpu className="w-6 h-6" /></div>
                            <div className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-danger group-hover:text-white">Edge Ops</div>
                        </Link>
                    </div>

                    <div className="flex flex-wrap items-center justify-between font-mono text-[10px] sm:text-[11px] text-muted tracking-widest uppercase border-t border-grid pt-3">
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-6">
                            <span>
                                T-UPDATE: <span className="text-foreground">{formatTimestampOrState(lastTelemetryUpdate, telemetryStreamStatus)}</span>
                            </span>
                            <span>
                                N-UPDATE: <span className="text-foreground">{formatTimestampOrState(lastTopologyUpdate, topologyStreamStatus)}</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-accent mt-2 sm:mt-0 drop-shadow-[0_0_3px_rgba(0,255,65,0.5)]">
                            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                            {snapshot?.refreshed_at
                                ? \`SYNCED \${new Date(snapshot.refreshed_at).toLocaleTimeString()}\`
                                : loadingWithoutData
                                    ? 'CONNECTING...'
                                    : 'STANDBY'}
                        </div>
                    </div>
                </ConsoleCard>
            </div>
            
            <div className="mb-4 sm:mb-6 flex flex-col gap-3">`;

content = content.replace(regex, replacement);

fs.writeFileSync(file, content);
console.log("Patched HUD operations.");
