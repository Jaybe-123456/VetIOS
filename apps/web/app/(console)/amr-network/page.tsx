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
    FlaskConical,
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

const SITE_EVENT_TYPES = [
    'invited',
    'enrolled',
    'data_use_approved',
    'connector_verified',
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
    const [siteId, setSiteId] = useState('');
    const [episodeId, setEpisodeId] = useState('');
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadSnapshot = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/amr/outcome-network', {
                credentials: 'same-origin',
                cache: 'no-store',
            });
            const body = await response.json();
            if (!response.ok) throw new Error(formatApiError(body, 'AMR outcome network unavailable'));
            setSnapshot(body.snapshot);
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

    async function handleSiteSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const eventType = String(form.get('event_type'));
        await submitAction(compactObject({
            action: 'record_site_event',
            request_id: crypto.randomUUID(),
            site_id: siteId || undefined,
            site_type: String(form.get('site_type')),
            event_type: eventType,
            display_label: textValue(form.get('display_label')),
            site_ref: textValue(form.get('site_ref')),
            connector_key: textValue(form.get('connector_key')),
            evidence: compactObject({
                agreement_version: textValue(form.get('agreement_version')),
                connector_version: textValue(form.get('connector_version')),
                verification_method: eventType === 'connector_verified'
                    ? String(form.get('verification_method'))
                    : undefined,
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
                                <SelectField
                                    label="Verification"
                                    name="verification_method"
                                    options={['production_probe', 'schema_validation', 'dry_run', 'manual_attestation']}
                                />
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

function formatMetric(value: number | null): string {
    return value == null ? 'unavailable' : value.toFixed(4);
}

function humanize(value: string): string {
    return value.replaceAll('_', ' ');
}

function formatApiError(body: Record<string, unknown>, fallback: string): string {
    const error = typeof body.error === 'string' ? body.error : fallback;
    const detail = typeof body.detail === 'string' ? body.detail : null;
    return detail ? `${error}: ${detail}` : error;
}
