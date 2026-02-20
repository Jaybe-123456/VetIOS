import { Container, PageHeader, DataRow } from '@/components/ui/terminal';

// This would typically fetch from Supabase
async function getNetworkMetrics() {
    // Simulate database latency
    await new Promise(r => setTimeout(r, 1000));

    return {
        activeNodes: 142,
        totalInferences: '1.4M',
        outcomesAnchored: '842K',
        modelDrift: '+0.012%',
        coherenceScore: '99.4%'
    };
}

export default async function NetworkIntelligence() {
    const metrics = await getNetworkMetrics();

    return (
        <Container>
            <PageHeader
                title="NETWORK INTELLIGENCE"
                description="Global system performance and compounding intelligence metrics. Privacy-safe abstraction layer."
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mt-12">
                <div className="space-y-8">
                    <div className="border border-grid p-6 bg-dim">
                        <h2 className="font-mono text-lg mb-6 text-accent">MACRO METRICS</h2>
                        <div className="space-y-2">
                            <DataRow label="Active Network Nodes" value={metrics.activeNodes} />
                            <DataRow label="Total Inferences Generated" value={metrics.totalInferences} />
                            <DataRow label="Outcomes Anchored (Closed Loops)" value={metrics.outcomesAnchored} />
                        </div>
                    </div>

                    <div className="border border-grid p-6 bg-dim">
                        <h2 className="font-mono text-lg mb-6 text-accent">MODEL INTEGRITY</h2>
                        <div className="space-y-2">
                            <DataRow label="System Coherence Score" value={metrics.coherenceScore} />
                            <DataRow label="30-Day Model Drift" value={<span className="text-danger">{metrics.modelDrift}</span>} />
                        </div>
                        <p className="font-mono text-xs text-muted mt-6 border-t border-muted/30 pt-4">
                            Intelligence compounds non-linearly. Every anchored outcome re-weights the global baseline.
                        </p>
                    </div>
                </div>

                <div className="border border-grid p-6 flex items-center justify-center text-center">
                    <div className="space-y-4">
                        <div className="w-32 h-32 border-4 border-accent rounded-full border-t-transparent animate-spin mx-auto opacity-20"></div>
                        <div className="font-mono text-sm tracking-widest text-muted">AWAITING NEXT EVENT...</div>
                    </div>
                </div>
            </div>
        </Container>
    );
}
