'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { BadgeCheck, FileCheck2, RefreshCw, Shield } from 'lucide-react';
import {
    ConsoleCard,
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
    TerminalTextarea,
} from '@/components/ui/terminal';
import type {
    ModelTrustSnapshot,
    ModelCardPublicationRecord,
} from '@/lib/modelTrust/service';

export default function ModelTrustOperationsClient({
    initialSnapshot,
    tenantId,
}: {
    initialSnapshot: ModelTrustSnapshot;
    tenantId: string;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [refreshing, setRefreshing] = useState(false);
    const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message: string }>({
        status: 'idle',
        message: '',
    });
    const [publicationDraft, setPublicationDraft] = useState({
        registry_id: initialSnapshot.registry_entries[0]?.registry_id ?? '',
        public_slug: '',
        publication_status: 'published',
        summary_override: '',
        intended_use: '',
        limitations: '',
        review_notes: '',
    });
    const [certificationDraft, setCertificationDraft] = useState({
        registry_id: initialSnapshot.registry_entries[0]?.registry_id ?? '',
        publication_id: initialSnapshot.publications[0]?.id ?? '',
        certification_name: '',
        issuer_name: '',
        status: 'active',
        certificate_ref: '',
        valid_until: '',
    });
    const [attestationDraft, setAttestationDraft] = useState({
        registry_id: initialSnapshot.registry_entries[0]?.registry_id ?? '',
        publication_id: initialSnapshot.publications[0]?.id ?? '',
        attestation_type: '',
        attestor_name: '',
        status: 'accepted',
        evidence_uri: '',
        summary: '',
    });

    const latestPublication = useMemo(() => snapshot.publications[0] ?? null, [snapshot.publications]);

    async function refreshSnapshot() {
        setRefreshing(true);
        try {
            const res = await fetch('/api/platform/model-trust', { cache: 'no-store' });
            const data = await res.json() as { snapshot?: ModelTrustSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Failed to refresh model trust snapshot.');
            }
            setSnapshot(data.snapshot);
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to refresh model trust snapshot.',
            });
        } finally {
            setRefreshing(false);
        }
    }

    async function runAction(body: Record<string, unknown>, successMessage: string) {
        setActionState({ status: 'running', message: 'Running model-trust operation...' });
        try {
            const res = await fetch('/api/platform/model-trust', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json() as { snapshot?: ModelTrustSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Model-trust operation failed.');
            }
            const nextSnapshot = data.snapshot;
            setSnapshot(nextSnapshot);
            if (nextSnapshot.publications[0]?.id) {
                setCertificationDraft((current) => ({ ...current, publication_id: current.publication_id || nextSnapshot.publications[0].id }));
                setAttestationDraft((current) => ({ ...current, publication_id: current.publication_id || nextSnapshot.publications[0].id }));
            }
            setActionState({ status: 'success', message: successMessage });
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Model-trust operation failed.',
            });
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="MODEL TRUST OPS"
                description="Publish model cards, attach certifications, and record external attestations so the trust moat is backed by explicit release evidence."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<FileCheck2 className="h-4 w-4" />} label="Published Cards" value={snapshot.summary.published_cards} />
                <SummaryCard icon={<BadgeCheck className="h-4 w-4" />} label="Active Certifications" value={snapshot.summary.active_certifications} />
                <SummaryCard icon={<Shield className="h-4 w-4" />} label="Accepted Attestations" value={snapshot.summary.accepted_attestations} />
                <SummaryCard icon={<RefreshCw className="h-4 w-4" />} label="Pending Reviews" value={snapshot.summary.pending_reviews} tone={snapshot.summary.pending_reviews > 0 ? 'warning' : 'neutral'} />
            </div>

            <ConsoleCard title="Trust Control" className="mt-6">
                <div className="flex flex-wrap items-center gap-2">
                    <TerminalButton variant="secondary" onClick={() => void refreshSnapshot()} disabled={refreshing}>
                        <RefreshCw className="mr-2 h-3 w-3" />
                        {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
                    </TerminalButton>
                    <div className="font-mono text-xs text-muted">Tenant: {tenantId}</div>
                </div>
                <ActionStatePanel state={actionState} />
            </ConsoleCard>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Publish Model Card">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Registry ID" value={publicationDraft.registry_id} onChange={(value) => setPublicationDraft((current) => ({ ...current, registry_id: value }))} />
                        <FormField label="Public Slug" value={publicationDraft.public_slug} onChange={(value) => setPublicationDraft((current) => ({ ...current, public_slug: value }))} />
                        <SelectField
                            label="Status"
                            value={publicationDraft.publication_status}
                            options={['draft', 'published', 'retired']}
                            onChange={(value) => setPublicationDraft((current) => ({ ...current, publication_status: value }))}
                        />
                    </div>
                    <div className="mt-4">
                        <TerminalLabel>Summary Override</TerminalLabel>
                        <TerminalTextarea value={publicationDraft.summary_override} onChange={(event) => setPublicationDraft((current) => ({ ...current, summary_override: event.target.value }))} />
                    </div>
                    <div className="mt-4 grid gap-4">
                        <div>
                            <TerminalLabel>Intended Use</TerminalLabel>
                            <TerminalTextarea value={publicationDraft.intended_use} onChange={(event) => setPublicationDraft((current) => ({ ...current, intended_use: event.target.value }))} />
                        </div>
                        <div>
                            <TerminalLabel>Limitations</TerminalLabel>
                            <TerminalTextarea value={publicationDraft.limitations} onChange={(event) => setPublicationDraft((current) => ({ ...current, limitations: event.target.value }))} />
                        </div>
                        <div>
                            <TerminalLabel>Review Notes</TerminalLabel>
                            <TerminalTextarea value={publicationDraft.review_notes} onChange={(event) => setPublicationDraft((current) => ({ ...current, review_notes: event.target.value }))} />
                        </div>
                    </div>
                    <div className="pt-4">
                        <TerminalButton onClick={() => void runAction({ action: 'publish_model_card', ...publicationDraft }, 'Model card publication updated.')}>
                            Publish Model Card
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Add Certification">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Registry ID" value={certificationDraft.registry_id} onChange={(value) => setCertificationDraft((current) => ({ ...current, registry_id: value }))} />
                        <FormField label="Publication ID" value={certificationDraft.publication_id} onChange={(value) => setCertificationDraft((current) => ({ ...current, publication_id: value }))} />
                        <FormField label="Certification Name" value={certificationDraft.certification_name} onChange={(value) => setCertificationDraft((current) => ({ ...current, certification_name: value }))} />
                        <FormField label="Issuer" value={certificationDraft.issuer_name} onChange={(value) => setCertificationDraft((current) => ({ ...current, issuer_name: value }))} />
                        <FormField label="Certificate Ref" value={certificationDraft.certificate_ref} onChange={(value) => setCertificationDraft((current) => ({ ...current, certificate_ref: value }))} />
                        <FormField label="Valid Until" value={certificationDraft.valid_until} onChange={(value) => setCertificationDraft((current) => ({ ...current, valid_until: value }))} />
                        <SelectField
                            label="Status"
                            value={certificationDraft.status}
                            options={['pending', 'active', 'expired', 'revoked']}
                            onChange={(value) => setCertificationDraft((current) => ({ ...current, status: value }))}
                        />
                    </div>
                    <div className="pt-4">
                        <TerminalButton onClick={() => void runAction({ action: 'create_certification', ...certificationDraft }, 'Certification created.')}>
                            Add Certification
                        </TerminalButton>
                    </div>
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Add Attestation">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Registry ID" value={attestationDraft.registry_id} onChange={(value) => setAttestationDraft((current) => ({ ...current, registry_id: value }))} />
                        <FormField label="Publication ID" value={attestationDraft.publication_id} onChange={(value) => setAttestationDraft((current) => ({ ...current, publication_id: value }))} />
                        <FormField label="Attestation Type" value={attestationDraft.attestation_type} onChange={(value) => setAttestationDraft((current) => ({ ...current, attestation_type: value }))} />
                        <FormField label="Attestor" value={attestationDraft.attestor_name} onChange={(value) => setAttestationDraft((current) => ({ ...current, attestor_name: value }))} />
                        <FormField label="Evidence URI" value={attestationDraft.evidence_uri} onChange={(value) => setAttestationDraft((current) => ({ ...current, evidence_uri: value }))} />
                        <SelectField
                            label="Status"
                            value={attestationDraft.status}
                            options={['pending', 'accepted', 'rejected']}
                            onChange={(value) => setAttestationDraft((current) => ({ ...current, status: value }))}
                        />
                    </div>
                    <div className="mt-4">
                        <TerminalLabel>Summary</TerminalLabel>
                        <TerminalTextarea value={attestationDraft.summary} onChange={(event) => setAttestationDraft((current) => ({ ...current, summary: event.target.value }))} />
                    </div>
                    <div className="pt-4">
                        <TerminalButton onClick={() => void runAction({ action: 'create_attestation', ...attestationDraft }, 'Attestation created.')}>
                            Add Attestation
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Latest Publication">
                    {latestPublication ? (
                        <PublicationDetail publication={latestPublication} />
                    ) : (
                        <div className="font-mono text-xs text-muted">No publication created yet.</div>
                    )}
                </ConsoleCard>
            </div>
        </Container>
    );
}

function SummaryCard({
    icon,
    label,
    value,
    tone = 'neutral',
}: {
    icon: ReactNode;
    label: string;
    value: number;
    tone?: 'neutral' | 'warning';
}) {
    return (
        <ConsoleCard className={tone === 'warning' ? 'border-warning/30 text-warning' : undefined}>
            <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
                <div>{icon}</div>
            </div>
            <div className="font-mono text-3xl">{value}</div>
        </ConsoleCard>
    );
}

function FormField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            <TerminalInput value={value} onChange={(event) => onChange(event.target.value)} />
        </div>
    );
}

function SelectField({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground"
            >
                {options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        </div>
    );
}

function PublicationDetail({ publication }: { publication: ModelCardPublicationRecord }) {
    return (
        <>
            <DataRow label="Registry ID" value={publication.registry_id} />
            <DataRow label="Slug" value={publication.public_slug} />
            <DataRow label="Status" value={publication.publication_status.toUpperCase()} />
            <DataRow label="Published At" value={publication.published_at ?? 'NO DATA'} />
            <DataRow label="Intended Use" value={publication.intended_use ?? 'NO DATA'} />
            <DataRow label="Limitations" value={publication.limitations ?? 'NO DATA'} />
        </>
    );
}

function ActionStatePanel({
    state,
}: {
    state: {
        status: 'idle' | 'running' | 'success' | 'error';
        message: string;
    };
}) {
    if (state.status === 'idle' || !state.message) {
        return null;
    }

    const tone = state.status === 'error'
        ? 'border-danger/30 bg-danger/10 text-danger'
        : state.status === 'success'
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-warning/30 bg-warning/10 text-warning';

    return <div className={`mt-4 border px-4 py-3 font-mono text-xs ${tone}`}>{state.message}</div>;
}
