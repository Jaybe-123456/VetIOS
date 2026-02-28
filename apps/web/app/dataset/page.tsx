'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard } from '@/components/ui/terminal';
import { DatasetTable } from '@/components/DatasetTable';
import { Search } from 'lucide-react';

const mockClinicalCases = [
    { 'CASE_ID': 'cas_992x1', 'SPECIES': 'Canis lupus', 'BREED': 'Retriever', 'SYMPTOMS': 'lethargy, fever', 'TIMESTAMP': '2026-02-28 08:12' },
    { 'CASE_ID': 'cas_84m2q', 'SPECIES': 'Felis catus', 'BREED': 'Siamese', 'SYMPTOMS': 'vomiting, diarrhea', 'TIMESTAMP': '2026-02-28 07:44' },
    { 'CASE_ID': 'cas_22p9c', 'SPECIES': 'Canis lupus', 'BREED': 'Bulldog', 'SYMPTOMS': 'respiratory distress', 'TIMESTAMP': '2026-02-28 06:15' },
];

const mockInferenceEvents = [
    { 'EVENT_ID': 'evt_98f4jd82', 'CASE_ID': 'cas_992x1', 'TOP_PRED': 'Parvovirus', 'CONFIDENCE': '94%', 'MODEL_V': 'v1.4' },
    { 'EVENT_ID': 'evt_11z9mx33', 'CASE_ID': 'cas_84m2q', 'TOP_PRED': 'Toxin Ingestion', 'CONFIDENCE': '81%', 'MODEL_V': 'v1.4' },
    { 'EVENT_ID': 'evt_55bxz91a', 'CASE_ID': 'cas_22p9c', 'TOP_PRED': 'Brachycephalic Syndrome', 'CONFIDENCE': '99%', 'MODEL_V': 'v1.4' },
];

export default function ClinicalDataset() {
    const [activeTab, setActiveTab] = useState<'cases' | 'inference'>('cases');

    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="CLINICAL DATASET MANAGER"
                description="Explore structured clinical cases, inference logs, and outcome reinforcement events across the tenant boundary."
            />

            <div className="flex flex-col gap-6 mb-8">
                <div className="flex items-center justify-between gap-4 border border-grid p-2 bg-background/50">
                    <div className="flex items-center gap-2 flex-1">
                        <Search className="w-4 h-4 text-muted ml-2" />
                        <input
                            type="text"
                            placeholder="QUERY_VECTORS (e.g. EVENT_ID: evt_98f...)"
                            className="bg-transparent border-none text-sm font-mono text-foreground focus:outline-none w-full"
                        />
                    </div>
                </div>

                <div className="flex items-center font-mono text-xs tracking-wider uppercase border-b border-grid">
                    <button
                        onClick={() => setActiveTab('cases')}
                        className={`px-6 py-3 border-b-2 transition-colors ${activeTab === 'cases' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}
                    >
                        Clinical Cases
                    </button>
                    <button
                        onClick={() => setActiveTab('inference')}
                        className={`px-6 py-3 border-b-2 transition-colors ${activeTab === 'inference' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}
                    >
                        Inference Events
                    </button>
                </div>
            </div>

            {activeTab === 'cases' && (
                <DatasetTable
                    title="Tenant Clinical Cases [Live]"
                    columns={['CASE_ID', 'SPECIES', 'BREED', 'SYMPTOMS', 'TIMESTAMP']}
                    data={mockClinicalCases}
                />
            )}

            {activeTab === 'inference' && (
                <DatasetTable
                    title="Inference Logs [Normalized]"
                    columns={['EVENT_ID', 'CASE_ID', 'TOP_PRED', 'CONFIDENCE', 'MODEL_V']}
                    data={mockInferenceEvents}
                />
            )}
        </Container>
    );
}
