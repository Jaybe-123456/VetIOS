'use client';

import { Container, PageHeader } from '@/components/ui/terminal';
import ReactFlow, { Background, Controls, Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { Network, Server, Database, ShieldAlert, Activity } from 'lucide-react';

const nodeStylePrimary = {
    background: '#000',
    color: '#00ff41',
    border: '1px solid #00ff41',
    borderRadius: '2px',
    padding: '12px 16px',
    fontFamily: 'monospace',
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    boxShadow: '0 0 10px rgba(0,255,65,0.2)',
    minWidth: '150px'
};

const nodeStyleSecondary = {
    ...nodeStylePrimary,
    background: '#111',
    color: '#aaa',
    border: '1px solid #333',
    boxShadow: 'none'
};

const nodeStyleDanger = {
    ...nodeStylePrimary,
    background: '#1a0000',
    color: '#ff3333',
    border: '1px solid #ff3333',
    boxShadow: '0 0 10px rgba(255,51,51,0.2)'
};

const initialNodes: Node[] = [
    { id: 'master', position: { x: 400, y: 50 }, data: { label: 'vetios_master_node' }, style: nodeStylePrimary },

    // Models
    { id: 'model_1', position: { x: 200, y: 150 }, data: { label: 'inf_core_v1.4' }, style: nodeStylePrimary },
    { id: 'model_2', position: { x: 600, y: 150 }, data: { label: 'vision_embed_v2.1' }, style: nodeStyleSecondary },

    // Datasets
    { id: 'data_1', position: { x: 100, y: 300 }, data: { label: 'clinical_db_tenant_A' }, style: nodeStyleSecondary },
    { id: 'data_2', position: { x: 300, y: 300 }, data: { label: 'clinical_db_tenant_B' }, style: nodeStyleSecondary },

    // Sim Nodes
    { id: 'sim_1', position: { x: 500, y: 300 }, data: { label: 'adv_sim_cluster_alpha' }, style: nodeStyleDanger },
    { id: 'sim_2', position: { x: 700, y: 300 }, data: { label: 'adv_sim_cluster_beta' }, style: nodeStyleDanger },

    // Clinics
    { id: 'clinic_1', position: { x: 50, y: 450 }, data: { label: 'clinic_nyk_01' }, style: nodeStyleSecondary },
    { id: 'clinic_2', position: { x: 150, y: 450 }, data: { label: 'clinic_lon_04' }, style: nodeStyleSecondary },
    { id: 'clinic_3', position: { x: 250, y: 450 }, data: { label: 'clinic_sfo_02' }, style: nodeStyleSecondary },
    { id: 'clinic_4', position: { x: 350, y: 450 }, data: { label: 'clinic_ber_01' }, style: nodeStyleSecondary },
];

const initialEdges: Edge[] = [
    { id: 'e-m1', source: 'master', target: 'model_1', animated: true, style: { stroke: '#00ff41' } },
    { id: 'e-m2', source: 'master', target: 'model_2', animated: true, style: { stroke: '#333' } },

    { id: 'e-d1', source: 'model_1', target: 'data_1', animated: true, style: { stroke: '#333' } },
    { id: 'e-d2', source: 'model_1', target: 'data_2', animated: true, style: { stroke: '#333' } },

    { id: 'e-s1', source: 'model_2', target: 'sim_1', style: { stroke: '#ff3333' }, animated: true },
    { id: 'e-s2', source: 'model_2', target: 'sim_2', style: { stroke: '#ff3333' }, animated: true },

    { id: 'e-c1', source: 'data_1', target: 'clinic_1', style: { stroke: '#333' } },
    { id: 'e-c2', source: 'data_1', target: 'clinic_2', style: { stroke: '#333' } },
    { id: 'e-c3', source: 'data_2', target: 'clinic_3', style: { stroke: '#333' } },
    { id: 'e-c4', source: 'data_2', target: 'clinic_4', style: { stroke: '#333' } },
];

export default function AINetworkMap() {
    return (
        <Container className="max-w-7xl h-full pb-0 flex flex-col mb-4 bg-background">
            <PageHeader
                title="AI ECOSYSTEM TOPOLOGY"
                description="Live orbital view of intelligence nodes, model deployments, active clinics, and adversarial simulation clusters."
            />

            <div className="w-full min-h-[600px] border border-grid bg-background/50 relative overflow-hidden" style={{ minHeight: '65vh' }}>
                <ReactFlow
                    nodes={initialNodes}
                    edges={initialEdges}
                    fitView
                    className="bg-background !pointer-events-auto"
                >
                    <Background color="#111" gap={20} size={1} />
                    <Controls className="fill-accent border-accent !bg-black" />
                </ReactFlow>

                <div className="absolute top-4 left-4 border border-grid bg-black/80 p-4 font-mono text-[10px] uppercase text-muted backdrop-blur-sm z-10 flex flex-col gap-2 pointer-events-none">
                    <span className="text-accent border-b border-grid/50 pb-2 mb-1 flex items-center gap-2">
                        <Network className="w-3 h-3" /> Topology Legend
                    </span>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 bg-accent" /> Master / Inference Node</div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 bg-muted" /> Clinic / Dataset Component</div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 bg-danger" /> Adv. Simulation Cluster</div>
                </div>
            </div>
        </Container>
    );
}
