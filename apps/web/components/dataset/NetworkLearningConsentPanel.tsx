'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { CheckCircle2, Network, RefreshCw, ShieldCheck } from 'lucide-react';

type ConsentScope = 'deidentified_training' | 'network_learning' | 'population_signal';
type ConsentStatus = 'granted' | 'revoked';
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface NetworkLearningConsentPanelProps {
    onChanged: () => void;
}

interface TenantLearningConsentRecord {
    id: string | null;
    tenant_id: string;
    consent_scope: ConsentScope;
    status: ConsentStatus;
    consent_version: string;
    granted_at: string | null;
    revoked_at: string | null;
    updated_at: string | null;
}

interface ConsentApiResponse {
    data?: {
        consents: TenantLearningConsentRecord[];
        tenant_id?: string;
    } | null;
    error?: string | null;
    detail?: string;
    request_id?: string;
}

const CONSENT_VERSION = 'vetios_learning_consent_v1';

const SCOPE_CARDS: Array<{
    scope: ConsentScope;
    title: string;
    description: string;
    impact: string;
}> = [
    {
        scope: 'deidentified_training',
        title: 'De-identified training',
        description: 'Allows confirmed, de-identified cases from this tenant to enter the local learning dataset.',
        impact: 'Required before real imported cases become learning-ready.',
    },
    {
        scope: 'network_learning',
        title: 'Network learning',
        description: 'Allows de-identified aggregate patterns from this tenant to participate in cross-clinic model improvement.',
        impact: 'Builds the multi-clinic moat without sharing patient, owner, or raw narrative data.',
    },
    {
        scope: 'population_signal',
        title: 'Population signal',
        description: 'Allows anonymized regional/species trend signals to feed outbreak and One Health surveillance.',
        impact: 'Supports surveillance outputs while keeping tenant-specific records private.',
    },
];

export function NetworkLearningConsentPanel({ onChanged }: NetworkLearningConsentPanelProps) {
    const [consents, setConsents] = useState<TenantLearningConsentRecord[]>([]);
    const [loadState, setLoadState] = useState<LoadState>('idle');
    const [message, setMessage] = useState<string | null>(null);
    const [savingScope, setSavingScope] = useState<ConsentScope | null>(null);
    const [isRefreshing, startRefresh] = useTransition();

    const latestByScope = useMemo(() => {
        const byScope = new Map<ConsentScope, TenantLearningConsentRecord>();
        for (const consent of consents) {
            const existing = byScope.get(consent.consent_scope);
            if (!existing || timestamp(consent.updated_at) > timestamp(existing.updated_at)) {
                byScope.set(consent.consent_scope, consent);
            }
        }
        return byScope;
    }, [consents]);

    const grantedCount = SCOPE_CARDS.filter((card) => latestByScope.get(card.scope)?.status === 'granted').length;
    const networkReady = latestByScope.get('deidentified_training')?.status === 'granted'
        && latestByScope.get('network_learning')?.status === 'granted';

    useEffect(() => {
        void loadConsents();
    }, []);

    async function loadConsents() {
        setLoadState('loading');
        setMessage(null);
        try {
            const response = await fetch('/api/clinical/learning-consent', {
                cache: 'no-store',
                credentials: 'same-origin',
            });
            const body = await response.json().catch(() => ({})) as ConsentApiResponse;
            if (!response.ok || !body.data) {
                throw new Error(body.detail ?? body.error ?? 'Failed to load network learning consent.');
            }
            setConsents(body.data.consents);
            setLoadState('ready');
        } catch (error) {
            setLoadState('error');
            setMessage(error instanceof Error ? error.message : 'Failed to load network learning consent.');
        }
    }

    async function updateConsent(scope: ConsentScope, status: ConsentStatus) {
        setSavingScope(scope);
        setMessage(null);
        try {
            const response = await fetch('/api/clinical/learning-consent', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    consent_scope: scope,
                    status,
                    consent_version: CONSENT_VERSION,
                    policy_snapshot: {
                        ui_surface: 'dataset_network_learning_consent',
                        note: 'Tenant-level learning consent managed by an authenticated clinical user.',
                    },
                }),
            });
            const body = await response.json().catch(() => ({})) as ConsentApiResponse;
            if (!response.ok || !body.data) {
                throw new Error(body.detail ?? body.error ?? 'Failed to update network learning consent.');
            }
            setConsents(body.data.consents);
            setLoadState('ready');
            setMessage(`${scopeLabel(scope)} ${status === 'granted' ? 'enabled' : 'revoked'}.`);
            startRefresh(() => onChanged());
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Failed to update network learning consent.');
        } finally {
            setSavingScope(null);
        }
    }

    return (
        <section className="border border-grid bg-black/20 p-4 font-mono">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-accent">
                        <Network className="h-3.5 w-3.5" />
                        Network learning
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">Control tenant learning consent</h2>
                    <p className="mt-2 text-sm leading-relaxed text-[hsl(0_0%_72%)]">
                        Manage what this clinic contributes to the VetIOS learning loop. These switches govern de-identified training, network aggregation, and population surveillance before imported cases become reusable signals.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => loadConsents()}
                    disabled={loadState === 'loading'}
                    className="inline-flex min-h-[38px] items-center justify-center gap-2 border border-grid px-3 text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_78%)] transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadState === 'loading' || isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
                <MoatMetric label="Granted scopes" value={`${grantedCount}/3`} />
                <MoatMetric label="Network ready" value={networkReady ? 'YES' : 'NO'} tone={networkReady ? 'accent' : 'warn'} />
                <MoatMetric label="Consent version" value={CONSENT_VERSION} />
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-3">
                {SCOPE_CARDS.map((card) => {
                    const current = latestByScope.get(card.scope);
                    const status = current?.status ?? 'revoked';
                    const isGranted = status === 'granted';
                    const isSaving = savingScope === card.scope;
                    return (
                        <div key={card.scope} className="border border-grid bg-background/40 p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold text-foreground">{card.title}</div>
                                    <p className="mt-2 text-xs leading-relaxed text-[hsl(0_0%_72%)]">{card.description}</p>
                                </div>
                                <span className={`shrink-0 border px-2 py-1 text-[9px] uppercase tracking-[0.16em] ${isGranted ? 'border-accent/50 bg-accent/10 text-accent' : 'border-amber-300/25 bg-amber-300/10 text-amber-100'}`}>
                                    {isGranted ? 'Granted' : 'Revoked'}
                                </span>
                            </div>
                            <div className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[hsl(0_0%_76%)]">
                                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                                <span>{card.impact}</span>
                            </div>
                            <div className="mt-3 text-[10px] uppercase tracking-[0.14em] text-[hsl(0_0%_62%)]">
                                Last change: {formatConsentDate(current)}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    disabled={isSaving || isGranted}
                                    onClick={() => updateConsent(card.scope, 'granted')}
                                    className="inline-flex min-h-[38px] items-center justify-center gap-2 border border-accent/55 bg-accent/10 px-3 text-[10px] uppercase tracking-[0.16em] text-accent transition hover:bg-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isSaving && !isGranted ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                    Grant
                                </button>
                                <button
                                    type="button"
                                    disabled={isSaving || !isGranted}
                                    onClick={() => updateConsent(card.scope, 'revoked')}
                                    className="inline-flex min-h-[38px] items-center justify-center border border-grid px-3 text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_78%)] transition hover:border-amber-200 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Revoke
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {message ? (
                <div className={`mt-4 border p-3 text-xs leading-relaxed ${loadState === 'error' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-accent/30 bg-accent/10 text-accent'}`}>
                    {message}
                </div>
            ) : null}

            <p className="mt-4 text-xs leading-relaxed text-[hsl(0_0%_64%)]">
                Network learning does not grant permission to store patient names, owner identifiers, raw owner contacts, or microchip IDs. Case import still rejects rows that fail de-identification checks.
            </p>
        </section>
    );
}

function MoatMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'accent' | 'warn' }) {
    const toneClass = tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-amber-100' : 'text-foreground';
    return (
        <div className="border border-grid bg-background/40 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_68%)]">{label}</div>
            <div className={`mt-2 break-all text-lg font-semibold ${toneClass}`}>{value}</div>
        </div>
    );
}

function timestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatConsentDate(record: TenantLearningConsentRecord | undefined): string {
    const value = record?.updated_at ?? record?.granted_at ?? record?.revoked_at;
    if (!value) return 'Never recorded';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function scopeLabel(scope: ConsentScope): string {
    return SCOPE_CARDS.find((card) => card.scope === scope)?.title ?? scope;
}
