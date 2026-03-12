'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard } from '@/components/ui/terminal';
import { ModelCard } from '@/components/ModelCard';

interface Model {
    id: string;
    name: string;
    version: string;
    parameters: string;
    accuracy: number;
    status: 'production' | 'staging' | 'training' | 'archived';
}

export default function ModelRegistry() {
    const [models, setModels] = useState<Model[]>([
        { id: '1', name: "VetIOS Diagnostics Core", version: "v1.4.2", parameters: "14B", accuracy: 0.968, status: "production" as const },
        { id: '2', name: "VetIOS Diagnostics Next", version: "v1.5.0-rc1", parameters: "20B", accuracy: 0.975, status: "staging" as const },
        { id: '3', name: "VetIOS Vision Embedder", version: "v2.1", parameters: "3B", accuracy: 0.924, status: "production" as const },
        { id: '4', name: "VetIOS Therapeutics", version: "v1.0.0-beta", parameters: "7B", accuracy: 0.881, status: "training" as const },
        { id: '5', name: "VetIOS Diagnostics Legacy", version: "v1.3.9", parameters: "14B", accuracy: 0.932, status: "archived" as const },
    ]);

    const [actionState, setActionState] = useState<{ active: boolean; message: string; type: 'info' | 'success' | 'error' | 'warning' } | null>(null);

    const handlePromote = (id: string) => {
        setActionState({ active: true, message: 'Promoting artifact to global inference network...', type: 'info' });
        setTimeout(() => {
            setModels(models.map(m => m.id === id ? { ...m, status: 'production' } : m));
            setActionState({ active: true, message: 'Artifact successfully promoted to production.', type: 'success' });
            setTimeout(() => setActionState(null), 3000);
        }, 1500);
    };

    const handleRollback = (id: string, name: string) => {
        setActionState({ active: true, message: `Initiating emergency rollback for ${name}...`, type: 'warning' });
        setTimeout(() => {
            setModels(models.map(m => m.id === id ? { ...m, status: 'archived' } : m));
            setActionState({ active: true, message: 'Rollback complete. Traffic routed to previous stable artifact.', type: 'success' });
            setTimeout(() => setActionState(null), 3000);
        }, 2000);
    };

    const handleRegister = () => {
        setActionState({ active: true, message: 'Registering new blank artifact container...', type: 'info' });
        setTimeout(() => {
            const newModel = {
                id: Math.random().toString(36).substring(7),
                name: "VetIOS Custom Module",
                version: "v1.0.0-alpha",
                parameters: "1B",
                accuracy: 0.0,
                status: "training" as const
            };
            setModels([...models, newModel]);
            setActionState({ active: true, message: 'New artifact metadata registered successfully.', type: 'success' });
            setTimeout(() => setActionState(null), 3000);
        }, 1200);
    };

    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="MODEL REGISTRY"
                description="Manage artifact promotion, lifecycle, and emergency rollback of base inference parameters."
            />

            {actionState && (
                <div className={`mb-6 p-4 border font-mono text-sm flex items-center gap-3 animate-in fade-in duration-300 ${
                    actionState.type === 'info' ? 'border-accent text-accent animate-pulse bg-accent/5' :
                    actionState.type === 'success' ? 'border-accent text-accent' :
                    actionState.type === 'warning' ? 'border-danger text-danger bg-danger/5 animate-pulse' :
                    'border-danger text-danger'
                }`}>
                    <div className="w-2 h-2 rounded-full bg-current" />
                    {actionState.message}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {models.map(model => (
                    <ModelCard
                        key={model.id}
                        name={model.name}
                        version={model.version}
                        parameters={model.parameters}
                        accuracy={model.accuracy}
                        status={model.status}
                        onRollback={() => handleRollback(model.id, model.name)}
                        onPromote={() => handlePromote(model.id)}
                    />
                ))}

                <ConsoleCard 
                    onClick={handleRegister}
                    className="border-dashed border-grid bg-transparent flex items-center justify-center flex-col gap-4 opacity-50 hover:opacity-100 hover:border-accent cursor-pointer transition-all min-h-[250px]"
                >
                    <div className="w-12 h-12 border border-accent text-accent rounded-full flex items-center justify-center font-mono text-2xl pb-1">
                        +
                    </div>
                    <span className="font-mono text-sm tracking-widest uppercase">Register New Artifact</span>
                </ConsoleCard>
            </div>
        </Container>
    );
}
