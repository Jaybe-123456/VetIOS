'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { ConsoleCard, TerminalButton, TerminalInput, TerminalLabel, TerminalTextarea } from '@/components/ui/terminal';
import type {
    TreatmentCandidateRecord,
    TreatmentPerformanceSummary,
    TreatmentRecommendationBundle,
    TreatmentResourceProfile,
} from '@/lib/treatmentIntelligence/types';

interface TreatmentPathwaysPanelProps {
    inferenceEventId: string;
    diagnosisLabel: string | null;
}

type LoadState =
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; bundle: TreatmentRecommendationBundle; message?: string | null }
    | { status: 'error'; message: string };

export function TreatmentPathwaysPanel({ inferenceEventId, diagnosisLabel }: TreatmentPathwaysPanelProps) {
    const [resourceProfile, setResourceProfile] = useState<TreatmentResourceProfile>('advanced');
    const [regulatoryRegion, setRegulatoryRegion] = useState('US');
    const [careEnvironment, setCareEnvironment] = useState('general practice');
    const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
    const [formState, setFormState] = useState({
        pathway: 'gold_standard',
        clinicianConfirmed: true,
        clinicianOverride: false,
        actualIntervention: '',
        outcomeStatus: '',
        recoveryTimeDays: '',
        complications: '',
        notes: '',
        saving: false,
        message: '',
        error: '',
    });

    const loadRecommendations = useCallback(async () => {
        setLoadState((current) => current.status === 'ready'
            ? { status: 'ready', bundle: current.bundle, message: current.message ?? null }
            : { status: 'loading' });

        try {
            const response = await fetch('/api/treatment/recommend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({
                    inference_event_id: inferenceEventId,
                    context: {
                        resource_profile: resourceProfile,
                        regulatory_region: regulatoryRegion,
                        care_environment: careEnvironment,
                    },
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Failed to load treatment pathways.');
            }
            setLoadState({ status: 'ready', bundle: result as TreatmentRecommendationBundle });
            setFormState((current) => ({ ...current, error: '', message: '' }));
        } catch (error) {
            setLoadState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to load treatment pathways.',
            });
        }
    }, [careEnvironment, inferenceEventId, regulatoryRegion, resourceProfile]);

    useEffect(() => {
        void loadRecommendations();
    }, [loadRecommendations]);

    const pathwayOptions = useMemo(() => loadState.status === 'ready'
        ? loadState.bundle.options
        : [], [loadState]);

    async function handleLogTreatment(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (loadState.status !== 'ready') return;
        const selectedOption = loadState.bundle.options.find((option) => option.treatment_pathway === formState.pathway);
        if (!selectedOption) {
            setFormState((current) => ({ ...current, error: 'Select a valid treatment pathway.', message: '' }));
            return;
        }

        setFormState((current) => ({ ...current, saving: true, error: '', message: '' }));

        try {
            const response = await fetch('/api/treatment/outcome', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({
                    inference_event_id: inferenceEventId,
                    treatment_candidate_id: selectedOption.id,
                    selection: {
                        disease: loadState.bundle.disease,
                        treatment_pathway: selectedOption.treatment_pathway,
                        clinician_confirmed: formState.clinicianConfirmed,
                        clinician_override: formState.clinicianOverride,
                        actual_intervention: {
                            notes: formState.actualIntervention,
                        },
                        context: {
                            resource_profile: resourceProfile,
                            regulatory_region: regulatoryRegion,
                            care_environment: careEnvironment,
                        },
                    },
                    outcome: formState.outcomeStatus
                        ? {
                            outcome_status: formState.outcomeStatus,
                            recovery_time_days: formState.recoveryTimeDays ? Number(formState.recoveryTimeDays) : undefined,
                            complications: formState.complications
                                .split(',')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            notes: formState.notes || undefined,
                        }
                        : undefined,
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Failed to log treatment selection.');
            }

            const refreshedBundle = await fetch(`/api/treatment/performance?disease=${encodeURIComponent(loadState.bundle.disease)}`, {
                credentials: 'same-origin',
                cache: 'no-store',
            }).then(async (perfResponse) => {
                const perfResult = await perfResponse.json();
                return perfResponse.ok ? perfResult.performance as TreatmentPerformanceSummary[] : loadState.bundle.observed_performance;
            });

            setLoadState({
                status: 'ready',
                bundle: {
                    ...loadState.bundle,
                    observed_performance: refreshedBundle,
                },
                message: 'Treatment selection and outcome log saved. VetIOS will use this relationship in future pathway performance summaries.',
            });
            setFormState((current) => ({
                ...current,
                saving: false,
                error: '',
                message: 'Treatment event logged.',
            }));
        } catch (error) {
            setFormState((current) => ({
                ...current,
                saving: false,
                error: error instanceof Error ? error.message : 'Failed to log treatment selection.',
                message: '',
            }));
        }
    }

    return (
        <div className="space-y-6">
            <ConsoleCard title="Treatment Pathways" className="border-blue-400/30">
                <div className="border border-yellow-500/40 bg-yellow-500/10 p-3 font-mono text-xs text-yellow-300">
                    {loadState.status === 'ready' ? loadState.bundle.clinician_notice : 'This is a clinical decision-support system. Final decisions require licensed clinician judgment.'}
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <label className="space-y-2">
                        <TerminalLabel htmlFor="treatment-resource-profile">Resource Profile</TerminalLabel>
                        <select
                            id="treatment-resource-profile"
                            className="w-full border border-grid bg-black/20 px-3 py-2 font-mono text-xs text-foreground outline-none"
                            value={resourceProfile}
                            onChange={(event) => setResourceProfile(event.target.value as TreatmentResourceProfile)}
                        >
                            <option value="advanced">Advanced / Referral</option>
                            <option value="low_resource">Low Resource</option>
                        </select>
                    </label>
                    <label className="space-y-2">
                        <TerminalLabel htmlFor="treatment-region">Regulatory Region</TerminalLabel>
                        <TerminalInput id="treatment-region" value={regulatoryRegion} onChange={(event) => setRegulatoryRegion(event.target.value)} />
                    </label>
                    <label className="space-y-2">
                        <TerminalLabel htmlFor="treatment-environment">Care Environment</TerminalLabel>
                        <TerminalInput id="treatment-environment" value={careEnvironment} onChange={(event) => setCareEnvironment(event.target.value)} />
                    </label>
                </div>

                <div className="mt-4 flex justify-end">
                    <TerminalButton type="button" onClick={loadRecommendations} disabled={loadState.status === 'loading'}>
                        {loadState.status === 'loading' ? 'REFRESHING...' : 'REFRESH PATHWAYS'}
                    </TerminalButton>
                </div>

                {loadState.status === 'error' ? (
                    <div className="mt-4 border border-danger/40 bg-danger/5 p-3 font-mono text-xs text-danger">
                        ERR: {loadState.message}
                    </div>
                ) : null}

                {loadState.status === 'loading' ? (
                    <div className="mt-4 border border-grid p-4 font-mono text-xs text-muted">
                        Loading structured treatment pathways for {diagnosisLabel ?? 'current diagnosis'}...
                    </div>
                ) : null}

                {loadState.status === 'ready' ? (
                    <div className="mt-4 space-y-4">
                        <div className="grid gap-3 md:grid-cols-4">
                            <MetricBox label="Primary Disease" value={loadState.bundle.disease} />
                            <MetricBox label="Emergency Level" value={loadState.bundle.emergency_level ?? 'UNKNOWN'} />
                            <MetricBox label="Mode" value={loadState.bundle.management_mode === 'diagnostic_management' ? 'DIAGNOSTIC MANAGEMENT' : 'DEFINITIVE READY'} />
                            <MetricBox label="Uncertainty" value={loadState.bundle.uncertainty_summary} />
                        </div>

                        {loadState.message ? (
                            <div className="border border-accent/30 bg-accent/5 p-3 font-mono text-xs text-accent">
                                {loadState.message}
                            </div>
                        ) : null}

                        {loadState.bundle.management_mode === 'diagnostic_management' ? (
                            <div className="border border-yellow-500/40 bg-yellow-500/10 p-3 font-mono text-xs text-yellow-200">
                                <div className="mb-2 flex items-center gap-2 uppercase tracking-[0.15em]">
                                    <AlertTriangle className="h-4 w-4" />
                                    Diagnostic Management Mode
                                </div>
                                <div>{loadState.bundle.diagnostic_management_summary ?? 'The differential remains too noisy for definitive disease-directed treatment; prioritize stabilization and confirmatory diagnostics.'}</div>
                            </div>
                        ) : null}

                        {loadState.bundle.contraindication_flags.length > 0 ? (
                            <div className="border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-300">
                                <div className="mb-2 flex items-center gap-2 uppercase tracking-[0.15em]">
                                    <ShieldAlert className="h-4 w-4" />
                                    Detected Contraindications
                                </div>
                                <div>{loadState.bundle.contraindication_flags.join(' | ')}</div>
                            </div>
                        ) : null}

                        <div className="space-y-4">
                            {loadState.bundle.options.map((option) => (
                                <TreatmentOptionCard
                                    key={`${option.disease}-${option.treatment_pathway}`}
                                    option={option}
                                    performance={loadState.bundle.observed_performance.find((item) => item.pathway === option.treatment_pathway)}
                                />
                            ))}
                        </div>
                    </div>
                ) : null}
            </ConsoleCard>

            {loadState.status === 'ready' ? (
                <ConsoleCard title="Clinician Validation Log" className="border-grid">
                    <form onSubmit={handleLogTreatment} className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-2">
                                <TerminalLabel htmlFor="treatment-pathway">Selected Pathway</TerminalLabel>
                                <select
                                    id="treatment-pathway"
                                    className="w-full border border-grid bg-black/20 px-3 py-2 font-mono text-xs text-foreground outline-none"
                                    value={formState.pathway}
                                    onChange={(event) => setFormState((current) => ({ ...current, pathway: event.target.value }))}
                                >
                                    {pathwayOptions.map((option) => (
                                        <option key={option.treatment_pathway} value={option.treatment_pathway}>
                                            {option.treatment_pathway.replace(/_/g, ' ')}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="space-y-2">
                                <TerminalLabel htmlFor="treatment-outcome-status">Outcome Status (optional)</TerminalLabel>
                                <select
                                    id="treatment-outcome-status"
                                    className="w-full border border-grid bg-black/20 px-3 py-2 font-mono text-xs text-foreground outline-none"
                                    value={formState.outcomeStatus}
                                    onChange={(event) => setFormState((current) => ({ ...current, outcomeStatus: event.target.value }))}
                                >
                                    <option value="">No outcome yet</option>
                                    <option value="planned">Planned</option>
                                    <option value="ongoing">Ongoing</option>
                                    <option value="improved">Improved</option>
                                    <option value="resolved">Resolved</option>
                                    <option value="complication">Complication</option>
                                    <option value="deteriorated">Deteriorated</option>
                                    <option value="deceased">Deceased</option>
                                    <option value="unknown">Unknown</option>
                                </select>
                            </label>
                        </div>

                        <label className="space-y-2">
                            <TerminalLabel htmlFor="treatment-actual-intervention">Actual Intervention Performed</TerminalLabel>
                            <TerminalTextarea
                                id="treatment-actual-intervention"
                                rows={3}
                                value={formState.actualIntervention}
                                onChange={(event) => setFormState((current) => ({ ...current, actualIntervention: event.target.value }))}
                                placeholder="Describe what the clinician actually did. VetIOS stores this for outcome learning, not as a replacement for the medical record."
                            />
                        </label>

                        <div className="grid gap-4 md:grid-cols-3">
                            <label className="space-y-2">
                                <TerminalLabel htmlFor="treatment-recovery-days">Recovery Time (days)</TerminalLabel>
                                <TerminalInput
                                    id="treatment-recovery-days"
                                    type="number"
                                    min="0"
                                    value={formState.recoveryTimeDays}
                                    onChange={(event) => setFormState((current) => ({ ...current, recoveryTimeDays: event.target.value }))}
                                />
                            </label>
                            <label className="flex items-center gap-2 border border-grid p-3 font-mono text-xs">
                                <input
                                    type="checkbox"
                                    checked={formState.clinicianConfirmed}
                                    onChange={(event) => setFormState((current) => ({ ...current, clinicianConfirmed: event.target.checked }))}
                                />
                                Licensed clinician reviewed this pathway
                            </label>
                            <label className="flex items-center gap-2 border border-grid p-3 font-mono text-xs">
                                <input
                                    type="checkbox"
                                    checked={formState.clinicianOverride}
                                    onChange={(event) => setFormState((current) => ({ ...current, clinicianOverride: event.target.checked }))}
                                />
                                Clinician override used
                            </label>
                        </div>

                        <label className="space-y-2">
                            <TerminalLabel htmlFor="treatment-complications">Complications (comma separated)</TerminalLabel>
                            <TerminalInput
                                id="treatment-complications"
                                value={formState.complications}
                                onChange={(event) => setFormState((current) => ({ ...current, complications: event.target.value }))}
                                placeholder="arrhythmia, aspiration, hypotension"
                            />
                        </label>

                        <label className="space-y-2">
                            <TerminalLabel htmlFor="treatment-notes">Outcome Notes</TerminalLabel>
                            <TerminalTextarea
                                id="treatment-notes"
                                rows={3}
                                value={formState.notes}
                                onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                                placeholder="Short-term response, complications, recovery progress..."
                            />
                        </label>

                        {formState.error ? (
                            <div className="border border-danger/40 bg-danger/5 p-3 font-mono text-xs text-danger">
                                ERR: {formState.error}
                            </div>
                        ) : null}
                        {formState.message ? (
                            <div className="border border-accent/30 bg-accent/5 p-3 font-mono text-xs text-accent">
                                {formState.message}
                            </div>
                        ) : null}

                        <TerminalButton type="submit" disabled={formState.saving || !formState.clinicianConfirmed}>
                            {formState.saving ? 'LOGGING TREATMENT...' : 'LOG CLINICIAN TREATMENT DECISION'}
                        </TerminalButton>
                    </form>
                </ConsoleCard>
            ) : null}
        </div>
    );
}

function TreatmentOptionCard({
    option,
    performance,
}: {
    option: TreatmentCandidateRecord;
    performance?: TreatmentPerformanceSummary;
}) {
    return (
        <div className="border border-grid p-4 font-mono text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-accent uppercase tracking-[0.18em]">
                    {option.treatment_pathway.replace(/_/g, ' ')}
                </div>
                <div className="flex flex-wrap gap-2">
                    <StatusPill label={option.treatment_type} tone="neutral" />
                    <StatusPill label={option.urgency_level} tone={option.urgency_level === 'emergent' ? 'danger' : option.urgency_level === 'urgent' ? 'warn' : 'neutral'} />
                    <StatusPill label={`evidence ${option.evidence_level}`} tone={option.evidence_level === 'high' ? 'success' : option.evidence_level === 'moderate' ? 'neutral' : 'warn'} />
                    {option.uncertainty.diagnostic_management_required ? (
                        <StatusPill label="diagnostic management" tone="warn" />
                    ) : null}
                </div>
            </div>

            <div className="mt-3 text-muted">{option.why_relevant}</div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <MiniBlock title="Intervention Details" lines={[
                    ...option.intervention_details.drug_classes,
                    ...option.intervention_details.procedure_types,
                    ...option.intervention_details.supportive_measures,
                ]} />
                <MiniBlock title="Expected Outcome" lines={[
                    option.expected_outcome_range.survival_probability_band,
                    option.expected_outcome_range.recovery_expectation,
                ]} />
                <MiniBlock title="Supporting Signals" lines={option.supporting_signals} />
                <MiniBlock title="Risks" lines={option.risks} />
                <MiniBlock title="Contraindications" lines={option.detected_contraindications.length > 0 ? option.detected_contraindications : option.contraindications} />
                <MiniBlock title="Regulatory Notes" lines={option.regulatory_notes} />
            </div>

            {performance ? (
                <div className="mt-4 border border-grid/70 bg-black/20 p-3">
                    <div className="mb-2 uppercase tracking-[0.15em] text-muted">Observed VetIOS Performance</div>
                    <div className="grid gap-2 md:grid-cols-4">
                        <MetricBox label="Sample Size" value={String(performance.sample_size)} compact />
                        <MetricBox label="Success Rate" value={formatRate(performance.success_rate)} compact />
                        <MetricBox label="Complication Rate" value={formatRate(performance.complication_rate)} compact />
                        <MetricBox label="Median Recovery" value={performance.median_recovery_time_days != null ? `${performance.median_recovery_time_days.toFixed(1)} days` : 'N/A'} compact />
                    </div>
                </div>
            ) : null}

            <div className="mt-4 flex items-start gap-2 border border-yellow-500/30 bg-yellow-500/5 p-3 text-yellow-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                    Recommendation confidence {(option.uncertainty.recommendation_confidence * 100).toFixed(0)}%.{' '}
                    {option.uncertainty.diagnostic_management_required
                        ? `Diagnostic-management mode is active. ${option.uncertainty.noise_reasons.join(' ')}`
                        : option.uncertainty.evidence_gaps.length > 0
                            ? option.uncertainty.evidence_gaps.join(' ')
                            : 'Evidence gaps are low, but clinician confirmation is still required.'}
                </div>
            </div>
        </div>
    );
}

function MiniBlock({ title, lines }: { title: string; lines: string[] }) {
    const safeLines = lines.filter((line) => line.trim().length > 0);
    return (
        <div className="border border-grid/70 bg-black/20 p-3">
            <div className="mb-2 uppercase tracking-[0.15em] text-muted">{title}</div>
            {safeLines.length > 0 ? (
                <div className="space-y-1 text-foreground">
                    {safeLines.map((line, index) => (
                        <div key={`${title}-${index}`}>{line}</div>
                    ))}
                </div>
            ) : (
                <div className="text-muted">No data recorded.</div>
            )}
        </div>
    );
}

function MetricBox({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
    return (
        <div className={`border border-grid/70 bg-black/20 ${compact ? 'p-2' : 'p-3'}`}>
            <div className="text-[9px] uppercase tracking-[0.15em] text-muted">{label}</div>
            <div className={`mt-1 ${compact ? 'text-xs' : 'text-sm'} text-foreground`}>{value}</div>
        </div>
    );
}

function StatusPill({ label, tone }: { label: string; tone: 'neutral' | 'warn' | 'danger' | 'success' }) {
    const toneClass = tone === 'danger'
        ? 'border-red-500/40 text-red-300'
        : tone === 'warn'
            ? 'border-yellow-500/40 text-yellow-300'
            : tone === 'success'
                ? 'border-green-500/40 text-green-300'
                : 'border-grid text-foreground';
    return (
        <span className={`border px-2 py-1 text-[10px] uppercase tracking-[0.15em] ${toneClass}`}>
            {label}
        </span>
    );
}

function formatRate(value: number | null) {
    return value != null ? `${(value * 100).toFixed(1)}%` : 'N/A';
}
