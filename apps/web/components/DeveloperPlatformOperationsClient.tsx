'use client';

import type { ReactNode, ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, KeyRound, RefreshCw, UsersRound } from 'lucide-react';
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
    DeveloperPlatformSnapshot,
    PartnerOnboardingRequestRecord,
} from '@/lib/developerPlatform/service';

export default function DeveloperPlatformOperationsClient({
    initialSnapshot,
    tenantId,
}: {
    initialSnapshot: DeveloperPlatformSnapshot;
    tenantId: string;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [refreshing, setRefreshing] = useState(false);
    const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message: string }>({
        status: 'idle',
        message: '',
    });
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const [partnerDraft, setPartnerDraft] = useState({
        legal_name: '',
        display_name: '',
        website_url: '',
        contact_name: '',
        contact_email: '',
        partner_tier: 'sandbox',
    });
    const [productDraft, setProductDraft] = useState({
        product_key: '',
        title: '',
        summary: '',
        access_tier: 'sandbox',
        default_scopes: 'inference:write',
    });
    const [onboardingDraft, setOnboardingDraft] = useState({
        company_name: '',
        contact_name: '',
        contact_email: '',
        use_case: '',
        requested_products: '',
        requested_scopes: 'inference:write',
    });
    const [approvalDraft, setApprovalDraft] = useState({
        request_id: initialSnapshot.onboarding_requests[0]?.id ?? '',
        partner_tier: 'sandbox',
        environment: 'sandbox',
        service_account_label: '',
        scopes: 'inference:write',
    });

    const latestRequest = useMemo(() => snapshot.onboarding_requests[0] ?? null, [snapshot.onboarding_requests]);

    async function refreshSnapshot() {
        setRefreshing(true);
        try {
            const res = await fetch('/api/platform/developer-platform', { cache: 'no-store' });
            const data = await res.json() as { snapshot?: DeveloperPlatformSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Failed to refresh developer platform snapshot.');
            }
            setSnapshot(data.snapshot);
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to refresh developer platform snapshot.',
            });
        } finally {
            setRefreshing(false);
        }
    }

    async function runAction(body: Record<string, unknown>, successMessage: string) {
        setActionState({ status: 'running', message: 'Running developer-platform operation...' });
        setGeneratedKey(null);
        try {
            const res = await fetch('/api/platform/developer-platform', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json() as { snapshot?: DeveloperPlatformSnapshot; error?: string; generated_api_key?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Developer-platform operation failed.');
            }
            const nextSnapshot = data.snapshot;
            setSnapshot(nextSnapshot);
            setGeneratedKey(typeof data.generated_api_key === 'string' ? data.generated_api_key : null);
            if (nextSnapshot.onboarding_requests[0]?.id) {
                setApprovalDraft((current) => ({
                    ...current,
                    request_id: current.request_id || nextSnapshot.onboarding_requests[0].id,
                }));
            }
            setActionState({ status: 'success', message: successMessage });
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Developer-platform operation failed.',
            });
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="DEVELOPER PLATFORM OPS"
                description="Productize the partner moat with published API products, onboarding intake, and scoped machine credentials issued from the control plane."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<UsersRound className="h-4 w-4" />} label="Active Partners" value={snapshot.summary.active_partners} />
                <SummaryCard icon={<Boxes className="h-4 w-4" />} label="Published Products" value={snapshot.summary.published_products} />
                <SummaryCard icon={<ArrowRight className="h-4 w-4" />} label="Pending Requests" value={snapshot.summary.pending_requests} tone={snapshot.summary.pending_requests > 0 ? 'warning' : 'neutral'} />
                <SummaryCard icon={<KeyRound className="h-4 w-4" />} label="Provisioned Keys" value={snapshot.summary.provisioned_service_accounts} />
            </div>

            <ConsoleCard title="Partner Platform Control" className="mt-6">
                <div className="flex flex-wrap items-center gap-2">
                    <TerminalButton variant="secondary" onClick={() => void refreshSnapshot()} disabled={refreshing}>
                        <RefreshCw className="mr-2 h-3 w-3" />
                        {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
                    </TerminalButton>
                    <div className="font-mono text-xs text-muted">Tenant: {tenantId}</div>
                </div>
                <ActionStatePanel state={actionState} />
                {generatedKey ? (
                    <div className="mt-4 border border-warning/30 bg-warning/10 px-4 py-3 font-mono text-xs text-warning">
                        Generated partner API key: {generatedKey}
                    </div>
                ) : null}
            </ConsoleCard>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Create Partner Organization">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Legal Name" value={partnerDraft.legal_name} onChange={(value) => setPartnerDraft((current) => ({ ...current, legal_name: value }))} />
                        <FormField label="Display Name" value={partnerDraft.display_name} onChange={(value) => setPartnerDraft((current) => ({ ...current, display_name: value }))} />
                        <FormField label="Website" value={partnerDraft.website_url} onChange={(value) => setPartnerDraft((current) => ({ ...current, website_url: value }))} />
                        <FormField label="Contact Name" value={partnerDraft.contact_name} onChange={(value) => setPartnerDraft((current) => ({ ...current, contact_name: value }))} />
                        <FormField label="Contact Email" value={partnerDraft.contact_email} onChange={(value) => setPartnerDraft((current) => ({ ...current, contact_email: value }))} />
                        <SelectField
                            label="Tier"
                            value={partnerDraft.partner_tier}
                            options={['sandbox', 'production', 'strategic']}
                            onChange={(value) => setPartnerDraft((current) => ({ ...current, partner_tier: value }))}
                        />
                    </div>
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'create_partner_organization',
                                ...partnerDraft,
                            }, 'Partner organization created.')}
                        >
                            Create Partner
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Publish API Product">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Product Key" value={productDraft.product_key} onChange={(value) => setProductDraft((current) => ({ ...current, product_key: value }))} />
                        <FormField label="Title" value={productDraft.title} onChange={(value) => setProductDraft((current) => ({ ...current, title: value }))} />
                        <SelectField
                            label="Access Tier"
                            value={productDraft.access_tier}
                            options={['sandbox', 'production', 'strategic']}
                            onChange={(value) => setProductDraft((current) => ({ ...current, access_tier: value }))}
                        />
                        <FormField label="Default Scopes" value={productDraft.default_scopes} onChange={(value) => setProductDraft((current) => ({ ...current, default_scopes: value }))} />
                    </div>
                    <div className="mt-4">
                        <TerminalLabel>Summary</TerminalLabel>
                        <TerminalTextarea value={productDraft.summary} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setProductDraft((current) => ({ ...current, summary: event.target.value }))} />
                    </div>
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'create_api_product',
                                ...productDraft,
                                default_scopes: splitCsv(productDraft.default_scopes),
                            }, 'API product created.')}
                        >
                            Publish Product
                        </TerminalButton>
                    </div>
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Submit Onboarding Request">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Company Name" value={onboardingDraft.company_name} onChange={(value) => setOnboardingDraft((current) => ({ ...current, company_name: value }))} />
                        <FormField label="Contact Name" value={onboardingDraft.contact_name} onChange={(value) => setOnboardingDraft((current) => ({ ...current, contact_name: value }))} />
                        <FormField label="Contact Email" value={onboardingDraft.contact_email} onChange={(value) => setOnboardingDraft((current) => ({ ...current, contact_email: value }))} />
                        <FormField label="Requested Products" value={onboardingDraft.requested_products} onChange={(value) => setOnboardingDraft((current) => ({ ...current, requested_products: value }))} />
                        <FormField label="Requested Scopes" value={onboardingDraft.requested_scopes} onChange={(value) => setOnboardingDraft((current) => ({ ...current, requested_scopes: value }))} />
                    </div>
                    <div className="mt-4">
                        <TerminalLabel>Use Case</TerminalLabel>
                        <TerminalTextarea value={onboardingDraft.use_case} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setOnboardingDraft((current) => ({ ...current, use_case: event.target.value }))} />
                    </div>
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'submit_onboarding_request',
                                ...onboardingDraft,
                                requested_products: splitCsv(onboardingDraft.requested_products),
                                requested_scopes: splitCsv(onboardingDraft.requested_scopes),
                            }, 'Onboarding request created.')}
                        >
                            Submit Request
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Approve Onboarding Request">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Request ID" value={approvalDraft.request_id} onChange={(value) => setApprovalDraft((current) => ({ ...current, request_id: value }))} />
                        <FormField label="Service Account Label" value={approvalDraft.service_account_label} onChange={(value) => setApprovalDraft((current) => ({ ...current, service_account_label: value }))} />
                        <SelectField
                            label="Partner Tier"
                            value={approvalDraft.partner_tier}
                            options={['sandbox', 'production', 'strategic']}
                            onChange={(value) => setApprovalDraft((current) => ({ ...current, partner_tier: value }))}
                        />
                        <SelectField
                            label="Environment"
                            value={approvalDraft.environment}
                            options={['sandbox', 'production']}
                            onChange={(value) => setApprovalDraft((current) => ({ ...current, environment: value }))}
                        />
                        <FormField label="Scopes" value={approvalDraft.scopes} onChange={(value) => setApprovalDraft((current) => ({ ...current, scopes: value }))} />
                    </div>
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'approve_onboarding_request',
                                ...approvalDraft,
                                scopes: splitCsv(approvalDraft.scopes),
                            }, 'Onboarding request approved and credential issued.')}
                        >
                            Approve + Issue Key
                        </TerminalButton>
                    </div>
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <ConsoleCard title="Recent Requests">
                    <div className="space-y-4">
                        {snapshot.onboarding_requests.slice(0, 4).map((request) => (
                            <OnboardingRequestRow key={request.id} request={request} />
                        ))}
                        {snapshot.onboarding_requests.length === 0 && (
                            <div className="font-mono text-xs text-muted">No onboarding requests yet.</div>
                        )}
                    </div>
                </ConsoleCard>
                <ConsoleCard title="Latest Request Detail">
                    {latestRequest ? (
                        <>
                            <DataRow label="Company" value={latestRequest.company_name} />
                            <DataRow label="Contact" value={latestRequest.contact_name} />
                            <DataRow label="Email" value={latestRequest.contact_email} />
                            <DataRow label="Status" value={latestRequest.status.toUpperCase()} />
                            <DataRow label="Products" value={latestRequest.requested_products.join(', ') || 'NO DATA'} />
                            <DataRow label="Scopes" value={latestRequest.requested_scopes.join(', ') || 'NO DATA'} />
                        </>
                    ) : (
                        <div className="font-mono text-xs text-muted">No request selected yet.</div>
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
            <TerminalInput value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
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
                onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
                className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground"
            >
                {options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        </div>
    );
}

function OnboardingRequestRow({ request }: { request: PartnerOnboardingRequestRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{request.company_name}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {request.status} | {request.contact_email}
            </div>
            <div className="mt-2 text-sm text-muted">{request.use_case}</div>
        </div>
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

function splitCsv(value: string): string[] {
    return value.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}
