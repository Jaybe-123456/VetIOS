'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    Container,
    ConsoleCard,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
} from '@/components/ui/terminal';
import {
    Activity,
    Building2,
    CheckCircle2,
    CircleDollarSign,
    Database,
    FlaskConical,
    Link2,
    RefreshCw,
    ShieldCheck,
} from 'lucide-react';

type SiteRow = {
    site_id: string;
    site_type: 'laboratory' | 'clinic';
    display_label: string;
    connector_key: string | null;
    status: string;
    operational: boolean;
    blockers: string[];
};

type EpisodeRow = {
    episode_id: string;
    site_id: string | null;
    lab_site_id: string | null;
    species: string | null;
    pathogen_key: string | null;
    stage: string;
    completion_percent: number;
    outcome_confirmed: boolean;
    calibration_eligible: boolean;
    federation_eligible: boolean;
    blockers: string[];
};

type NetworkSnapshot = {
    pilot_status: string;
    targets: {
        minimum_laboratories: number;
        minimum_clinics: number;
        target_clinics: number;
        outcome_confirmed_episodes: number;
    };
    sites: {
        operational_laboratories: number;
        operational_clinics: number;
        rows: SiteRow[];
    };
    episodes: {
        total: number;
        outcome_confirmed: number;
        calibration_eligible: number;
        federation_eligible: number;
        synthetic_excluded: number;
        privacy_blocked: number;
        target_progress_percent: number;
        rows: EpisodeRow[];
    };
    calibration_proof: {
        status: string;
        run_count: number;
        outcome_count: number;
        baseline_ece: number | null;
        current_ece: number | null;
        ece_delta: number | null;
    };
    surveillance_proof: {
        status: string;
        total_records: number;
        outcome_linked_records: number;
        outcome_link_rate: number;
        one_health_export_ready_records: number;
        resistance_signal_records: number;
        unique_trend_buckets: number;
    };
    federation_manifest: {
        network_threshold_met: boolean;
        source_digest_bundle_hash: string;
    };
    blockers: string[];
    next_actions: string[];
    proof_hash: string;
};

type OperationsSnapshot = {
    connectors: {
        total_sites: number;
        production_verified: number;
        stale: number;
        failed: number;
        rows: Array<{
            site_id: string;
            status: string;
            source_system: string;
            connector_version: string;
            schema_version: string;
            last_probe_at: string | null;
            observed_record_count: number;
            token_binding_method: string;
            blockers: string[];
        }>;
    };
    ingestion: {
        total: number;
        accepted: number;
        blocked: number;
        result_count: number;
        pending_reconciliation: number;
        matched: number;
        failed_reconciliation: number;
        rows: Array<{
            id: string;
            site_id: string;
            lab_site_id: string;
            source_system: string;
            species: string;
            specimen_type: string;
            organism_key: string;
            ingestion_status: string;
            result_count: number;
            observed_at: string | null;
        }>;
    };
    exchange: {
        agreements_total: number;
        agreements_active: number;
        metered_events: number;
        metered_amount_minor: number;
        unsettled_amount_minor: number;
        currency: string | null;
        amounts_by_currency: Array<{
            currency: string;
            metered_amount_minor: number;
            settled_amount_minor: number;
            unsettled_amount_minor: number;
        }>;
        settlement_events: number;
        agreements: Array<{
            agreement_id: string;
            product_key: string;
            purpose: string;
            privacy_class: string;
            pricing_model: string;
            currency: string;
            unit_price_minor: number;
            status: string;
            active: boolean;
            blockers: string[];
        }>;
    };
    marketplace_ready: boolean;
    blockers: string[];
    next_actions: string[];
    proof_hash: string;
};

const SITE_EVENT_TYPES = [
    'invited',
    'enrolled',
    'data_use_approved',
    'connector_failed',
    'paused',
    'retired',
];

const EPISODE_EVENT_TYPES = [
    'episode_opened',
    'culture_received',
    'ast_verified',
    'treatment_recorded',
    'clinical_review_completed',
    'outcome_confirmed',
    'episode_closed',
];

export default function AMROutcomeNetworkPage() {
    const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
    const [operations, setOperations] = useState<OperationsSnapshot | null>(null);
    const [siteId, setSiteId] = useState('');
    const [episodeId, setEpisodeId] = useState('');
    const [agreementId, setAgreementId] = useState('');
    const [settlementId, setSettlementId] = useState('');
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [operationsError, setOperationsError] = useState<string | null>(null);

    const loadSnapshot = useCallback(async () => {
        setLoading(true);
        setError(null);
        setOperationsError(null);
        try {
            const [networkResponse, operationsResponse] = await Promise.all([
                fetch('/api/amr/outcome-network', {
                    credentials: 'same-origin',
                    cache: 'no-store',
                }),
                fetch('/api/amr/network-operations', {
                    credentials: 'same-origin',
                    cache: 'no-store',
                }),
            ]);
            const [networkBody, operationsBody] = await Promise.all([
                networkResponse.json(),
                operationsResponse.json(),
            ]);
            if (!networkResponse.ok) {
                throw new Error(formatApiError(networkBody, 'AMR outcome network unavailable'));
            }
            setSnapshot(networkBody.snapshot);
            if (operationsResponse.ok) {
                setOperations(operationsBody.snapshot);
            } else {
                setOperations(null);
                setOperationsError(formatApiError(
                    operationsBody,
                    'AMR operations kernel unavailable',
                ));
            }
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'AMR outcome network unavailable');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSnapshot();
    }, [loadSnapshot]);

    async function submitAction(payload: Record<string, unknown>) {
        setWorking(true);
        setError(null);
        setNotice(null);
        try {
            const response = await fetch('/api/amr/outcome-network', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(formatApiError(body, 'Operation failed'));
            if (body.site_id) setSiteId(String(body.site_id));
            if (body.episode_id) setEpisodeId(String(body.episode_id));
            setNotice(body.cached ? 'Idempotent replay returned the existing event.' : 'Append-only event recorded.');
            await loadSnapshot();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Operation failed');
        } finally {
            setWorking(false);
        }
    }

    async function submitExchangeAction(payload: Record<string, unknown>) {
        setWorking(true);
        setError(null);
        setNotice(null);
        try {
            const response = await fetch('/api/amr/private-exchange', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(formatApiError(body, 'Exchange operation failed'));
            if (body.agreement_id) setAgreementId(String(body.agreement_id));
            if (body.settlement_id) setSettlementId(String(body.settlement_id));
            setNotice(body.cached
                ? 'Idempotent replay returned the existing ledger event.'
                : 'Governed exchange event recorded.');
            await loadSnapshot();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Exchange operation failed');
        } finally {
            setWorking(false);
        }
    }

    async function handleSiteSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await submitAction(compactObject({
            action: 'record_site_event',
            request_id: crypto.randomUUID(),
            site_id: siteId || undefined,
            site_type: String(form.get('site_type')),
            event_type: String(form.get('event_type')),
            display_label: textValue(form.get('display_label')),
            site_ref: textValue(form.get('site_ref')),
            connector_key: textValue(form.get('connector_key')),
            evidence: compactObject({
                agreement_version: textValue(form.get('agreement_version')),
                connector_version: textValue(form.get('connector_version')),
            }),
        }));
    }

    async function handleEpisodeSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const eventType = String(form.get('event_type'));
        await submitAction(compactObject({
            action: 'record_episode_event',
            request_id: crypto.randomUUID(),
            episode_id: episodeId || undefined,
            event_type: eventType,
            site_id: textValue(form.get('site_id')),
            lab_site_id: textValue(form.get('lab_site_id')),
            case_id: textValue(form.get('case_id')),
            inference_event_id: textValue(form.get('inference_event_id')),
            clinical_outcome_id: textValue(form.get('clinical_outcome_id')),
            amr_stewardship_event_id: textValue(form.get('amr_stewardship_event_id')),
            amr_lab_feed_event_id: textValue(form.get('amr_lab_feed_event_id')),
            species: textValue(form.get('species')),
            pathogen_key: textValue(form.get('pathogen_key')),
            drug_class: textValue(form.get('drug_class')),
            outcome_status: eventType === 'outcome_confirmed'
                ? String(form.get('outcome_status'))
                : undefined,
            consent_status: String(form.get('consent_status')),
            review_status: eventType === 'clinical_review_completed' ? 'completed' : undefined,
            reviewer_ref: textValue(form.get('reviewer_ref')),
            is_synthetic: form.get('is_synthetic') === 'on',
            deidentified: form.get('deidentified') === 'on',
            source_record_digest: textValue(form.get('source_record_digest')),
            evidence_packet_hash: textValue(form.get('evidence_packet_hash')),
            evidence: compactObject({
                source_system: textValue(form.get('source_system')),
                source_version: textValue(form.get('source_version')),
                ast_method: textValue(form.get('ast_method')),
                interpretation_standard: textValue(form.get('interpretation_standard')),
                interpretation_standard_version: textValue(form.get('interpretation_standard_version')),
                treatment_strategy: eventType === 'treatment_recorded'
                    ? String(form.get('treatment_strategy'))
                    : undefined,
                followup_days: numberValue(form.get('followup_days')),
            }),
        }));
    }

    async function handleAgreementSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await submitExchangeAction(compactObject({
            action: 'record_agreement_event',
            request_id: crypto.randomUUID(),
            agreement_id: agreementId || undefined,
            event_type: String(form.get('event_type')),
            product_key: textValue(form.get('product_key')),
            provider_site_id: textValue(form.get('provider_site_id')),
            consumer_tenant_id: textValue(form.get('consumer_tenant_id')),
            counterparty_ref: textValue(form.get('counterparty_ref')),
            purpose: textValue(form.get('purpose')),
            license_key: textValue(form.get('license_key')),
            privacy_class: textValue(form.get('privacy_class')),
            permitted_species: commaValues(form.get('permitted_species')),
            permitted_geographies: commaValues(form.get('permitted_geographies')),
            permitted_use_cases: commaValues(form.get('permitted_use_cases')),
            pricing_model: textValue(form.get('pricing_model')),
            currency: textValue(form.get('currency'))?.toUpperCase(),
            unit_price_minor: numberValue(form.get('unit_price_minor')),
            platform_fee_bps: numberValue(form.get('platform_fee_bps')),
            terms_hash: textValue(form.get('terms_hash')),
            data_use_agreement_hash: textValue(form.get('data_use_agreement_hash')),
            effective_at: dateTimeValue(form.get('effective_at')),
            expires_at: dateTimeValue(form.get('expires_at')),
        }));
    }

    async function handleSettlementSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await submitExchangeAction(compactObject({
            action: 'materialize_settlement',
            request_id: crypto.randomUUID(),
            agreement_id: textValue(form.get('agreement_id')),
            period_start: dateTimeValue(form.get('period_start')),
            period_end: dateTimeValue(form.get('period_end')),
        }));
    }

    async function handleSettlementStateSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await submitExchangeAction(compactObject({
            action: 'record_settlement_state',
            request_id: crypto.randomUUID(),
            settlement_id: settlementId || textValue(form.get('settlement_id')),
            event_type: String(form.get('event_type')),
            confirmation_hash: textValue(form.get('confirmation_hash')),
        }));
    }

    return (
        <Container className="min-w-0">
            <div className="flex min-w-0 flex-col gap-4 border-b border-[hsl(0_0%_100%_/_0.08)] pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 [&_h1]:break-words [&_p]:break-words [&_p]:[overflow-wrap:anywhere]">
                    <PageHeader
                        title="AMR OUTCOME NETWORK"
                        description="Operational ledger for laboratory and clinic enrollment, culture/AST episode closure, calibration evidence, and federation eligibility."
                    />
                </div>
                <div className="grid w-full shrink-0 grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
                    <TerminalButton
                        type="button"
                        variant="secondary"
                        disabled={loading || working || !snapshot}
                        onClick={() => void submitAction({
                            action: 'run_calibration',
                            request_id: crypto.randomUUID(),
                            minimum_required_outcomes: 20,
                        })}
                    >
                        <Activity className="mr-2 h-4 w-4" />
                        Calibrate
                    </TerminalButton>
                    <TerminalButton
                        type="button"
                        variant="secondary"
                        disabled={loading || working}
                        onClick={() => void loadSnapshot()}
                    >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh
                    </TerminalButton>
                    <TerminalButton
                        type="button"
                        disabled={loading || working || !snapshot}
                        onClick={() => void submitAction({
                            action: 'persist_snapshot',
                            request_id: crypto.randomUUID(),
                        })}
                    >
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Seal
                    </TerminalButton>
                </div>
            </div>

            {(notice || error) && (
                <div className={`my-4 break-words border px-4 py-3 font-mono text-xs [overflow-wrap:anywhere] ${
                    error
                        ? 'border-destructive/60 text-destructive'
                        : 'border-accent/50 text-accent'
                }`}>
                    {error ?? notice}
                </div>
            )}
            {operationsError && !error && (
                <div className="my-4 break-words border border-warning/60 px-4 py-3 font-mono text-xs text-warning [overflow-wrap:anywhere]">
                    {operationsError}
                </div>
            )}

            {loading ? (
                <div className="grid min-h-48 place-items-center font-mono text-sm text-muted">
                    LOADING PILOT EVIDENCE...
                </div>
            ) : snapshot ? (
                <div className="space-y-6 pt-6">
                    <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                        <Metric
                            icon={<Activity className="h-4 w-4" />}
                            label="Pilot"
                            value={snapshot.pilot_status}
                            active={snapshot.pilot_status === 'evidence_ready'}
                        />
                        <Metric
                            icon={<FlaskConical className="h-4 w-4" />}
                            label="Laboratories"
                            value={`${snapshot.sites.operational_laboratories}/${snapshot.targets.minimum_laboratories}`}
                            active={snapshot.sites.operational_laboratories >= snapshot.targets.minimum_laboratories}
                        />
                        <Metric
                            icon={<Building2 className="h-4 w-4" />}
                            label="Clinics"
                            value={`${snapshot.sites.operational_clinics}/${snapshot.targets.minimum_clinics}`}
                            active={snapshot.sites.operational_clinics >= snapshot.targets.minimum_clinics}
                        />
                        <Metric
                            icon={<CheckCircle2 className="h-4 w-4" />}
                            label="Outcomes"
                            value={`${snapshot.episodes.outcome_confirmed}/${snapshot.targets.outcome_confirmed_episodes}`}
                            active={snapshot.episodes.outcome_confirmed >= snapshot.targets.outcome_confirmed_episodes}
                        />
                        <Metric
                            icon={<ShieldCheck className="h-4 w-4" />}
                            label="Federation"
                            value={`${snapshot.episodes.federation_eligible}`}
                            active={snapshot.federation_manifest.network_threshold_met}
                        />
                    </section>

                    {operations && (
                        <>
                            <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                                <Metric
                                    icon={<Link2 className="h-4 w-4" />}
                                    label="Connectors"
                                    value={`${operations.connectors.production_verified}/${operations.connectors.total_sites}`}
                                    active={operations.connectors.production_verified > 0}
                                />
                                <Metric
                                    icon={<Database className="h-4 w-4" />}
                                    label="AST accepted"
                                    value={`${operations.ingestion.accepted}`}
                                    active={operations.ingestion.accepted > 0}
                                />
                                <Metric
                                    icon={<CheckCircle2 className="h-4 w-4" />}
                                    label="Reconciled"
                                    value={`${operations.ingestion.matched}`}
                                    active={operations.ingestion.matched > 0}
                                />
                                <Metric
                                    icon={<ShieldCheck className="h-4 w-4" />}
                                    label="Agreements"
                                    value={`${operations.exchange.agreements_active}/${operations.exchange.agreements_total}`}
                                    active={operations.exchange.agreements_active > 0}
                                />
                                <Metric
                                    icon={<CircleDollarSign className="h-4 w-4" />}
                                    label="Unsettled"
                                    value={formatMinorMoney(
                                        operations.exchange.unsettled_amount_minor,
                                        operations.exchange.currency,
                                    )}
                                    active={operations.exchange.unsettled_amount_minor > 0}
                                />
                                <Metric
                                    icon={<Activity className="h-4 w-4" />}
                                    label="Exchange"
                                    value={operations.marketplace_ready ? 'ready' : 'blocked'}
                                    active={operations.marketplace_ready}
                                />
                            </section>

                            <div className="grid gap-6 xl:grid-cols-2">
                                <ConsoleCard title="Connector & AST Operations">
                                    <DataRow label="Production verified" value={operations.connectors.production_verified} tone={operations.connectors.production_verified > 0 ? 'accent' : 'warning'} />
                                    <DataRow label="Stale connectors" value={operations.connectors.stale} tone={operations.connectors.stale > 0 ? 'warning' : 'muted'} />
                                    <DataRow label="Blocked ingestions" value={operations.ingestion.blocked} tone={operations.ingestion.blocked > 0 ? 'danger' : 'muted'} />
                                    <DataRow label="Normalized AST results" value={operations.ingestion.result_count} />
                                    <DataRow label="Pending reconciliation" value={operations.ingestion.pending_reconciliation} tone={operations.ingestion.pending_reconciliation > 0 ? 'warning' : 'accent'} />
                                    <DataRow label="Failed reconciliation" value={operations.ingestion.failed_reconciliation} tone={operations.ingestion.failed_reconciliation > 0 ? 'danger' : 'muted'} />
                                </ConsoleCard>

                                <ConsoleCard title="Private Exchange State">
                                    <DataRow label="Marketplace gate" value={operations.marketplace_ready ? 'ready' : 'blocked'} tone={operations.marketplace_ready ? 'accent' : 'warning'} />
                                    <DataRow label="Metered events" value={operations.exchange.metered_events} />
                                    <DataRow label="Metered value" value={formatMinorMoney(operations.exchange.metered_amount_minor, operations.exchange.currency)} />
                                    <DataRow label="Settlement events" value={operations.exchange.settlement_events} />
                                    {operations.exchange.amounts_by_currency.map((amounts) => (
                                        <DataRow
                                            key={amounts.currency}
                                            label={`${amounts.currency} unsettled`}
                                            value={formatMinorMoney(amounts.unsettled_amount_minor, amounts.currency)}
                                        />
                                    ))}
                                    <div className="border-t border-grid pt-3">
                                        {operations.blockers.length === 0 ? (
                                            <div className="font-mono text-xs text-accent">NO EXCHANGE GATE BLOCKERS</div>
                                        ) : operations.blockers.map((blocker) => (
                                            <div key={blocker} className="py-1 font-mono text-[11px] text-warning">
                                                {humanize(blocker)}
                                            </div>
                                        ))}
                                    </div>
                                </ConsoleCard>
                            </div>
                        </>
                    )}

                    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                        <ConsoleCard title="Pilot Readiness">
                            <div className="h-2 overflow-hidden border border-grid bg-black">
                                <div
                                    className="h-full bg-accent transition-[width] duration-500"
                                    style={{ width: `${snapshot.episodes.target_progress_percent}%` }}
                                />
                            </div>
                            <DataRow label="Episode progress" value={`${snapshot.episodes.target_progress_percent.toFixed(1)}%`} tone="accent" />
                            <DataRow label="Calibration eligible" value={snapshot.episodes.calibration_eligible} />
                            <DataRow label="Synthetic excluded" value={snapshot.episodes.synthetic_excluded} tone="muted" />
                            <DataRow label="Privacy blocked" value={snapshot.episodes.privacy_blocked} tone={snapshot.episodes.privacy_blocked > 0 ? 'danger' : 'muted'} />
                            <DataRow label="Calibration proof" value={snapshot.calibration_proof.status} tone={snapshot.calibration_proof.status === 'improved' ? 'accent' : 'warning'} />
                            <DataRow label="Current ECE" value={formatMetric(snapshot.calibration_proof.current_ece)} />
                            <DataRow label="Surveillance proof" value={snapshot.surveillance_proof.status} tone={snapshot.surveillance_proof.status === 'evidence_ready' ? 'accent' : 'warning'} />
                            <DataRow label="Outcome-linked lab rows" value={snapshot.surveillance_proof.outcome_linked_records} />
                            <DataRow label="Trend buckets" value={snapshot.surveillance_proof.unique_trend_buckets} />
                        </ConsoleCard>

                        <ConsoleCard title="Active Blockers">
                            {snapshot.blockers.length === 0 ? (
                                <div className="font-mono text-xs text-accent">NO PILOT GATE BLOCKERS</div>
                            ) : (
                                <div className="space-y-2">
                                    {snapshot.blockers.map((blocker) => (
                                        <div key={blocker} className="border-l-2 border-warning px-3 py-2 font-mono text-xs text-[hsl(0_0%_82%)]">
                                            {humanize(blocker)}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="border-t border-grid pt-3">
                                {snapshot.next_actions.map((action) => (
                                    <div key={action} className="py-1 font-mono text-[11px] text-muted">
                                        {humanize(action)}
                                    </div>
                                ))}
                            </div>
                        </ConsoleCard>
                    </div>

                    {operations && (
                        <div className="grid gap-6 xl:grid-cols-2">
                            <ConsoleCard title="Private Exchange Agreement Event">
                                <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleAgreementSubmit}>
                                    <Field label="Agreement ID">
                                        <TerminalInput
                                            value={agreementId}
                                            onChange={(event) => setAgreementId(event.target.value)}
                                            placeholder="Generated on draft"
                                        />
                                    </Field>
                                    <SelectField label="Event" name="event_type" options={[
                                        'drafted',
                                        'offered',
                                        'accepted',
                                        'activated',
                                        'suspended',
                                        'revoked',
                                        'expired',
                                    ]} />
                                    <SelectField label="Product" name="product_key" options={[
                                        'amr.culture_ast.normalized.v1',
                                        'amr.outcome_evidence.aggregate.v1',
                                        'amr.surveillance.signal.v1',
                                        'amr.federated_compute.v1',
                                        'amr.specialist_review.v1',
                                    ]} />
                                    <SelectField label="Privacy class" name="privacy_class" options={[
                                        'deidentified_record',
                                        'aggregate_only',
                                        'federated_only',
                                    ]} />
                                    <Field label="Provider site ID"><TerminalInput name="provider_site_id" /></Field>
                                    <Field label="Consumer tenant ID"><TerminalInput name="consumer_tenant_id" /></Field>
                                    <Field label="External counterparty reference">
                                        <TerminalInput name="counterparty_ref" placeholder="Hashed before storage" />
                                    </Field>
                                    <Field label="Purpose"><TerminalInput name="purpose" placeholder="AMR surveillance" /></Field>
                                    <Field label="License key"><TerminalInput name="license_key" placeholder="vetios-amr-private-v1" /></Field>
                                    <SelectField label="Pricing" name="pricing_model" options={[
                                        'per_record',
                                        'per_episode',
                                        'subscription',
                                        'no_charge',
                                    ]} />
                                    <Field label="Currency"><TerminalInput name="currency" defaultValue="USD" maxLength={3} /></Field>
                                    <Field label="Unit price, minor"><TerminalInput name="unit_price_minor" type="number" min="0" defaultValue="0" /></Field>
                                    <Field label="Platform fee, bps"><TerminalInput name="platform_fee_bps" type="number" min="0" max="10000" defaultValue="0" /></Field>
                                    <Field label="Species"><TerminalInput name="permitted_species" placeholder="canine, bovine" /></Field>
                                    <Field label="Geographies"><TerminalInput name="permitted_geographies" placeholder="KE, US" /></Field>
                                    <Field label="Permitted uses"><TerminalInput name="permitted_use_cases" placeholder="surveillance, research" /></Field>
                                    <Field label="Terms hash"><TerminalInput name="terms_hash" placeholder="SHA-256" /></Field>
                                    <Field label="Data-use agreement hash"><TerminalInput name="data_use_agreement_hash" placeholder="SHA-256" /></Field>
                                    <Field label="Effective at"><TerminalInput name="effective_at" type="datetime-local" /></Field>
                                    <Field label="Expires at"><TerminalInput name="expires_at" type="datetime-local" /></Field>
                                    <TerminalButton className="sm:col-span-2" disabled={working} type="submit">
                                        Record agreement event
                                    </TerminalButton>
                                </form>
                            </ConsoleCard>

                            <ConsoleCard title="Settlement Ledger">
                                <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSettlementSubmit}>
                                    <Field label="Agreement ID">
                                        <TerminalInput
                                            name="agreement_id"
                                            value={agreementId}
                                            onChange={(event) => setAgreementId(event.target.value)}
                                        />
                                    </Field>
                                    <Field label="Period start"><TerminalInput name="period_start" type="datetime-local" /></Field>
                                    <Field label="Period end"><TerminalInput name="period_end" type="datetime-local" /></Field>
                                    <div className="flex items-end">
                                        <TerminalButton className="w-full" disabled={working} type="submit">
                                            Calculate
                                        </TerminalButton>
                                    </div>
                                </form>
                                <form className="mt-6 grid gap-4 border-t border-grid pt-6 sm:grid-cols-2" onSubmit={handleSettlementStateSubmit}>
                                    <Field label="Settlement ID">
                                        <TerminalInput
                                            name="settlement_id"
                                            value={settlementId}
                                            onChange={(event) => setSettlementId(event.target.value)}
                                        />
                                    </Field>
                                    <SelectField label="State" name="event_type" options={[
                                        'approved',
                                        'invoiced',
                                        'paid',
                                        'voided',
                                    ]} />
                                    <Field label="External confirmation hash">
                                        <TerminalInput name="confirmation_hash" placeholder="Required for paid" />
                                    </Field>
                                    <div className="flex items-end">
                                        <TerminalButton className="w-full" disabled={working} type="submit">
                                            Record state
                                        </TerminalButton>
                                    </div>
                                </form>
                            </ConsoleCard>
                        </div>
                    )}

                    {operations && (
                        <>
                            <div className="grid gap-6 xl:grid-cols-2">
                                <ConsoleCard title="Connector Proof Ledger">
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[620px] text-left font-mono text-xs">
                                            <thead className="text-muted">
                                                <tr className="border-b border-grid">
                                                    <th className="px-2 py-3 font-normal">Site</th>
                                                    <th className="px-2 py-3 font-normal">Source</th>
                                                    <th className="px-2 py-3 font-normal">Binding</th>
                                                    <th className="px-2 py-3 font-normal">Status</th>
                                                    <th className="px-2 py-3 font-normal">Last proof</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {operations.connectors.rows.slice(0, 50).map((connector) => (
                                                    <tr key={connector.site_id} className="border-b border-grid/70">
                                                        <td className="px-2 py-3 text-muted">{connector.site_id}</td>
                                                        <td className="px-2 py-3 text-white">{connector.source_system}</td>
                                                        <td className="px-2 py-3 text-muted">{connector.token_binding_method}</td>
                                                        <td className={`px-2 py-3 ${connector.status === 'verified' ? 'text-accent' : 'text-warning'}`}>
                                                            {humanize(connector.status)}
                                                        </td>
                                                        <td className="px-2 py-3 text-muted">{formatTimestamp(connector.last_probe_at)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Canonical AST Ingestion">
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[640px] text-left font-mono text-xs">
                                            <thead className="text-muted">
                                                <tr className="border-b border-grid">
                                                    <th className="px-2 py-3 font-normal">Source</th>
                                                    <th className="px-2 py-3 font-normal">Species</th>
                                                    <th className="px-2 py-3 font-normal">Organism</th>
                                                    <th className="px-2 py-3 font-normal">Results</th>
                                                    <th className="px-2 py-3 font-normal">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {operations.ingestion.rows.slice(0, 50).map((ingestion) => (
                                                    <tr key={ingestion.id} className="border-b border-grid/70">
                                                        <td className="px-2 py-3 text-white">{ingestion.source_system}</td>
                                                        <td className="px-2 py-3 text-muted">{ingestion.species}</td>
                                                        <td className="px-2 py-3 text-white">{ingestion.organism_key}</td>
                                                        <td className="px-2 py-3 text-muted">{ingestion.result_count}</td>
                                                        <td className={`px-2 py-3 ${ingestion.ingestion_status === 'accepted' ? 'text-accent' : 'text-warning'}`}>
                                                            {ingestion.ingestion_status}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </ConsoleCard>
                            </div>

                            <ConsoleCard title="Private Exchange Agreements">
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[880px] text-left font-mono text-xs">
                                        <thead className="text-muted">
                                            <tr className="border-b border-grid">
                                                <th className="px-2 py-3 font-normal">Agreement</th>
                                                <th className="px-2 py-3 font-normal">Product</th>
                                                <th className="px-2 py-3 font-normal">Privacy</th>
                                                <th className="px-2 py-3 font-normal">Pricing</th>
                                                <th className="px-2 py-3 font-normal">Unit price</th>
                                                <th className="px-2 py-3 font-normal">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {operations.exchange.agreements.slice(0, 100).map((agreement) => (
                                                <tr key={agreement.agreement_id} className="border-b border-grid/70">
                                                    <td className="px-2 py-3 text-muted">{agreement.agreement_id}</td>
                                                    <td className="px-2 py-3 text-white">{agreement.product_key}</td>
                                                    <td className="px-2 py-3 text-muted">{humanize(agreement.privacy_class)}</td>
                                                    <td className="px-2 py-3 text-muted">{humanize(agreement.pricing_model)}</td>
                                                    <td className="px-2 py-3 text-white">
                                                        {formatMinorMoney(agreement.unit_price_minor, agreement.currency)}
                                                    </td>
                                                    <td className={`px-2 py-3 ${agreement.active ? 'text-accent' : 'text-warning'}`}>
                                                        {humanize(agreement.status)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </ConsoleCard>
                        </>
                    )}

                    <div className="grid gap-6 xl:grid-cols-2">
                        <ConsoleCard title="Site Enrollment Event">
                            <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSiteSubmit}>
                                <Field label="Site ID">
                                    <TerminalInput
                                        value={siteId}
                                        onChange={(event) => setSiteId(event.target.value)}
                                        placeholder="Generated on invite"
                                    />
                                </Field>
                                <SelectField label="Site type" name="site_type" options={['laboratory', 'clinic']} />
                                <SelectField label="Event" name="event_type" options={SITE_EVENT_TYPES} />
                                <Field label="Display label">
                                    <TerminalInput name="display_label" placeholder="Pilot Lab 01" />
                                </Field>
                                <Field label="Private site reference">
                                    <TerminalInput name="site_ref" placeholder="Hashed before storage" />
                                </Field>
                                <Field label="Connector key">
                                    <TerminalInput name="connector_key" placeholder="lab.connector.v1" />
                                </Field>
                                <Field label="Agreement version">
                                    <TerminalInput name="agreement_version" placeholder="dua-2026-01" />
                                </Field>
                                <Field label="Connector version">
                                    <TerminalInput name="connector_version" placeholder="1.0.0" />
                                </Field>
                                <div className="flex items-end">
                                    <TerminalButton className="w-full" disabled={working} type="submit">
                                        Record
                                    </TerminalButton>
                                </div>
                            </form>
                        </ConsoleCard>

                        <ConsoleCard title="Episode Milestone Event">
                            <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleEpisodeSubmit}>
                                <Field label="Episode ID">
                                    <TerminalInput
                                        value={episodeId}
                                        onChange={(event) => setEpisodeId(event.target.value)}
                                        placeholder="Generated when opened"
                                    />
                                </Field>
                                <SelectField label="Milestone" name="event_type" options={EPISODE_EVENT_TYPES} />
                                <Field label="Clinic site ID"><TerminalInput name="site_id" /></Field>
                                <Field label="Laboratory site ID"><TerminalInput name="lab_site_id" /></Field>
                                <Field label="Species"><TerminalInput name="species" placeholder="canine" /></Field>
                                <Field label="Pathogen key"><TerminalInput name="pathogen_key" placeholder="escherichia_coli" /></Field>
                                <Field label="Drug class"><TerminalInput name="drug_class" placeholder="beta_lactam" /></Field>
                                <Field label="Source digest"><TerminalInput name="source_record_digest" placeholder="SHA-256" /></Field>
                                <Field label="Evidence packet hash"><TerminalInput name="evidence_packet_hash" placeholder="SHA-256" /></Field>
                                <Field label="Lab feed event ID"><TerminalInput name="amr_lab_feed_event_id" /></Field>
                                <Field label="Stewardship event ID"><TerminalInput name="amr_stewardship_event_id" /></Field>
                                <Field label="Inference event ID"><TerminalInput name="inference_event_id" /></Field>
                                <Field label="Clinical outcome ID"><TerminalInput name="clinical_outcome_id" /></Field>
                                <Field label="Case ID"><TerminalInput name="case_id" /></Field>
                                <Field label="Reviewer reference"><TerminalInput name="reviewer_ref" placeholder="Hashed before storage" /></Field>
                                <Field label="Source system"><TerminalInput name="source_system" placeholder="laboratory_lis" /></Field>
                                <Field label="Source version"><TerminalInput name="source_version" /></Field>
                                <Field label="AST method"><TerminalInput name="ast_method" placeholder="broth_microdilution" /></Field>
                                <Field label="AST standard"><TerminalInput name="interpretation_standard" placeholder="CLSI VET01S" /></Field>
                                <Field label="Standard version"><TerminalInput name="interpretation_standard_version" /></Field>
                                <SelectField
                                    label="Treatment strategy"
                                    name="treatment_strategy"
                                    options={['culture_directed', 'de_escalated', 'empiric', 'supportive_only', 'no_antimicrobial']}
                                />
                                <SelectField
                                    label="Outcome"
                                    name="outcome_status"
                                    options={['resolved', 'improved', 'unchanged', 'worsened', 'relapsed', 'adverse_event']}
                                />
                                <SelectField
                                    label="Learning consent"
                                    name="consent_status"
                                    options={['approved', 'pending', 'declined', 'revoked']}
                                />
                                <Field label="Follow-up days"><TerminalInput name="followup_days" type="number" min="0" max="3650" /></Field>
                                <label className="flex min-h-11 items-center gap-3 border border-grid px-3 font-mono text-xs text-muted">
                                    <input name="deidentified" type="checkbox" defaultChecked />
                                    De-identified
                                </label>
                                <label className="flex min-h-11 items-center gap-3 border border-grid px-3 font-mono text-xs text-muted">
                                    <input name="is_synthetic" type="checkbox" />
                                    Synthetic audit row
                                </label>
                                <TerminalButton className="sm:col-span-2" disabled={working} type="submit">
                                    Record milestone
                                </TerminalButton>
                            </form>
                        </ConsoleCard>
                    </div>

                    <ConsoleCard title="Network Sites">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[680px] text-left font-mono text-xs">
                                <thead className="text-muted">
                                    <tr className="border-b border-grid">
                                        <th className="px-2 py-3 font-normal">Site</th>
                                        <th className="px-2 py-3 font-normal">Type</th>
                                        <th className="px-2 py-3 font-normal">Status</th>
                                        <th className="px-2 py-3 font-normal">Connector</th>
                                        <th className="px-2 py-3 font-normal">ID</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snapshot.sites.rows.map((site) => (
                                        <tr key={site.site_id} className="border-b border-grid/70">
                                            <td className="px-2 py-3 text-white">{site.display_label}</td>
                                            <td className="px-2 py-3 text-muted">{site.site_type}</td>
                                            <td className={`px-2 py-3 ${site.operational ? 'text-accent' : 'text-warning'}`}>{site.status}</td>
                                            <td className="px-2 py-3 text-muted">{site.connector_key ?? '-'}</td>
                                            <td className="px-2 py-3 text-muted">{site.site_id}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </ConsoleCard>

                    <ConsoleCard title="Recent Culture/AST Episodes">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[820px] text-left font-mono text-xs">
                                <thead className="text-muted">
                                    <tr className="border-b border-grid">
                                        <th className="px-2 py-3 font-normal">Episode</th>
                                        <th className="px-2 py-3 font-normal">Species</th>
                                        <th className="px-2 py-3 font-normal">Pathogen</th>
                                        <th className="px-2 py-3 font-normal">Stage</th>
                                        <th className="px-2 py-3 font-normal">Calibration</th>
                                        <th className="px-2 py-3 font-normal">Federation</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snapshot.episodes.rows.slice(0, 50).map((episode) => (
                                        <tr key={episode.episode_id} className="border-b border-grid/70">
                                            <td className="px-2 py-3 text-muted">{episode.episode_id}</td>
                                            <td className="px-2 py-3 text-white">{episode.species ?? '-'}</td>
                                            <td className="px-2 py-3 text-white">{episode.pathogen_key ?? '-'}</td>
                                            <td className="px-2 py-3 text-muted">{humanize(episode.stage)}</td>
                                            <td className={`px-2 py-3 ${episode.calibration_eligible ? 'text-accent' : 'text-warning'}`}>
                                                {episode.calibration_eligible ? 'eligible' : 'blocked'}
                                            </td>
                                            <td className={`px-2 py-3 ${episode.federation_eligible ? 'text-accent' : 'text-warning'}`}>
                                                {episode.federation_eligible ? 'eligible' : 'blocked'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </ConsoleCard>
                </div>
            ) : null}
        </Container>
    );
}

function Metric(input: {
    icon: React.ReactNode;
    label: string;
    value: string;
    active: boolean;
}) {
    return (
        <div className="console-card-glass min-h-24 p-3 sm:p-4">
            <div className={`mb-3 flex items-center gap-2 ${input.active ? 'text-accent' : 'text-muted'}`}>
                {input.icon}
                <span className="font-mono text-[10px] uppercase tracking-[0.14em]">{input.label}</span>
            </div>
            <div className="break-words font-mono text-base text-white sm:text-lg">{humanize(input.value)}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            {children}
        </div>
    );
}

function SelectField(input: { label: string; name: string; options: string[] }) {
    return (
        <Field label={input.label}>
            <select
                name={input.name}
                className="min-h-11 w-full border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_8%)] px-3 font-mono text-sm text-[hsl(0_0%_94%)] focus:border-accent/60 focus:outline-none"
            >
                {input.options.map((option) => (
                    <option key={option} value={option}>{humanize(option)}</option>
                ))}
            </select>
        </Field>
    );
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''),
    );
}

function textValue(value: FormDataEntryValue | null): string | undefined {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || undefined;
}

function numberValue(value: FormDataEntryValue | null): number | undefined {
    const text = textValue(value);
    if (!text) return undefined;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function commaValues(value: FormDataEntryValue | null): string[] | undefined {
    const text = textValue(value);
    if (!text) return undefined;
    const values = Array.from(new Set(
        text.split(',').map((entry) => entry.trim()).filter(Boolean),
    ));
    return values.length > 0 ? values : undefined;
}

function dateTimeValue(value: FormDataEntryValue | null): string | undefined {
    const text = textValue(value);
    if (!text) return undefined;
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function formatMetric(value: number | null): string {
    return value == null ? 'unavailable' : value.toFixed(4);
}

function formatMinorMoney(amountMinor: number, currency: string | null): string {
    if (!currency) return `${amountMinor} minor`;
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
        }).format(amountMinor / 100);
    } catch {
        return `${currency} ${(amountMinor / 100).toFixed(2)}`;
    }
}

function formatTimestamp(value: string | null): string {
    if (!value) return 'never';
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function humanize(value: string): string {
    return value.replaceAll('_', ' ');
}

function formatApiError(body: Record<string, unknown>, fallback: string): string {
    const error = typeof body.error === 'string' ? body.error : fallback;
    const detail = typeof body.detail === 'string' ? body.detail : null;
    return detail ? `${error}: ${detail}` : error;
}
