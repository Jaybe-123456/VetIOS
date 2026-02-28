'use client';

import { Container, PageHeader, ConsoleCard } from '@/components/ui/terminal';
import { ModelCard } from '@/components/ModelCard';

export default function ModelRegistry() {
    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="MODEL REGISTRY"
                description="Manage artifact promotion, lifecycle, and emergency rollback of base inference parameters."
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                <ModelCard
                    name="VetIOS Diagnostics Core"
                    version="v1.4.2"
                    parameters="14B"
                    accuracy={0.968}
                    status="production"
                    onRollback={() => alert('Initiating safe rollback to v1.4.1...')}
                />

                <ModelCard
                    name="VetIOS Diagnostics Next"
                    version="v1.5.0-rc1"
                    parameters="20B"
                    accuracy={0.975}
                    status="staging"
                    onPromote={() => alert('Promoting artifact to global inference network...')}
                />

                <ModelCard
                    name="VetIOS Vision Embedder"
                    version="v2.1"
                    parameters="3B"
                    accuracy={0.924}
                    status="production"
                    onRollback={() => alert('Initiating safe rollback to v2.0...')}
                />

                <ModelCard
                    name="VetIOS Therapeutics"
                    version="v1.0.0-beta"
                    parameters="7B"
                    accuracy={0.881}
                    status="training"
                />

                <ModelCard
                    name="VetIOS Diagnostics Legacy"
                    version="v1.3.9"
                    parameters="14B"
                    accuracy={0.932}
                    status="archived"
                />

                <ConsoleCard className="border-dashed border-grid bg-transparent flex items-center justify-center flex-col gap-4 opacity-50 hover:opacity-100 hover:border-accent cursor-pointer transition-all">
                    <div className="w-12 h-12 border border-accent text-accent rounded-full flex items-center justify-center font-mono text-2xl pb-1">
                        +
                    </div>
                    <span className="font-mono text-sm tracking-widest uppercase">Register New Artifact</span>
                </ConsoleCard>
            </div>
        </Container>
    );
}
