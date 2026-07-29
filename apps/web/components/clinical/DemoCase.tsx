'use client';

import Link from 'next/link';
import {
    Activity,
    ArrowRight,
    BrainCircuit,
    CheckCircle2,
    ClipboardCheck,
    Database,
    GitBranch,
    LockKeyhole,
    Microscope,
    Network,
    RefreshCw,
    Server,
    ShieldCheck,
    TestTube2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
    buildDemoCalibrationPreview,
    DEMO_CONTROL_PLANE_CASE,
    DEMO_STAGE_LABELS,
    stableSerializeDemoValue,
    type DemoEvidenceState,
    type DemoStage,
} from '@/lib/demo/controlPlane';
import { formatClinicalLabel, formatPercent } from './clinicalTypes';

type ExecutionState = 'ready' | 'running' | 'complete';
type SovereigntyView = 'local' | 'outbound';

const STAGES: Array<{
    id: DemoStage;
    icon: typeof BrainCircuit;
}> = [
    { id: 'clinical', icon: BrainCircuit },
    { id: 'outcome', icon: ClipboardCheck },
    { id: 'sovereignty', icon: ShieldCheck },
    { id: 'amr', icon: Microscope },
];

export function DemoCase() {
    const [activeStage, setActiveStage] = useState<DemoStage>('clinical');
    const [executionState, setExecutionState] = useState<ExecutionState>('ready');
    const [outcomeAttached, setOutcomeAttached] = useState(false);
    const [sovereigntyView, setSovereigntyView] = useState<SovereigntyView>('local');
    const [digests, setDigests] = useState({ local: 'calculating', outbound: 'calculating' });
    const calibration = useMemo(
        () => buildDemoCalibrationPreview(outcomeAttached),
        [outcomeAttached],
    );

    useEffect(() => {
        if (executionState !== 'running') return;
        const timer = window.setTimeout(() => setExecutionState('complete'), 700);
        return () => window.clearTimeout(timer);
    }, [executionState]);

    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            sha256Hex(stableSerializeDemoValue(DEMO_CONTROL_PLANE_CASE.sovereignty.raw_record)),
            sha256Hex(stableSerializeDemoValue(DEMO_CONTROL_PLANE_CASE.sovereignty.outbound_packet)),
        ]).then(([local, outbound]) => {
            if (!cancelled) setDigests({ local, outbound });
        });
        return () => {
            cancelled = true;
        };
    }, []);

    function runFixture() {
        setOutcomeAttached(false);
        setExecutionState('running');
        setActiveStage('clinical');
    }

    function resetFixture() {
        setExecutionState('ready');
        setOutcomeAttached(false);
        setActiveStage('clinical');
    }

    return (
        <div className="min-h-screen bg-[#070A0D] text-white">
            <header className="border-b border-white/10 bg-[#090D10]">
                <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
                    <Link
                        href="/"
                        className="font-mono text-sm font-semibold tracking-[0.14em] text-accent"
                    >
                        VETIOS
                    </Link>
                    <div className="hidden items-center gap-3 text-xs text-white/55 sm:flex">
                        <StatusDot tone="green" />
                        Public control plane
                        <span className="text-white/25">|</span>
                        Browser isolated
                    </div>
                    <nav className="flex items-center gap-4 text-sm">
                        <Link className="text-white/65 transition hover:text-white" href="/platform">
                            Platform
                        </Link>
                        <Link className="text-white/75 transition hover:text-white" href="/login">
                            Sign in
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                <section aria-labelledby="demo-heading" className="border-b border-white/10 pb-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div className="max-w-3xl">
                            <div className="text-xs uppercase tracking-[0.18em] text-accent">
                                Clinical intelligence lifecycle
                            </div>
                            <h1 id="demo-heading" className="mt-3 text-3xl font-semibold tracking-normal sm:text-4xl">
                                VetIOS Clinical Intelligence Control Plane
                            </h1>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/64 sm:text-base">
                                One synthetic culture case, traced from clinical inference through outcome evidence,
                                privacy boundaries, and AMR context.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <EvidenceBadge state="demo_fixture" />
                            <span className="border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/62">
                                {DEMO_CONTROL_PLANE_CASE.case_id}
                            </span>
                            {executionState !== 'ready' ? (
                                <button
                                    type="button"
                                    onClick={resetFixture}
                                    className="inline-flex min-h-10 items-center gap-2 border border-white/12 px-3 text-xs text-white/72 transition hover:border-white/25 hover:text-white"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                                    Reset
                                </button>
                            ) : null}
                        </div>
                    </div>
                </section>

                <LifecycleStatus
                    executionState={executionState}
                    outcomeAttached={outcomeAttached}
                />

                <section className="mt-5 border border-white/10 bg-[#0A0E11]">
                    <StageTabs activeStage={activeStage} onChange={setActiveStage} />
                    <div
                        id={`demo-panel-${activeStage}`}
                        role="tabpanel"
                        aria-labelledby={`demo-tab-${activeStage}`}
                        className="min-h-[560px]"
                    >
                        {activeStage === 'clinical' ? (
                            <ClinicalStage
                                executionState={executionState}
                                onRun={runFixture}
                            />
                        ) : null}
                        {activeStage === 'outcome' ? (
                            <OutcomeStage
                                executionState={executionState}
                                outcomeAttached={outcomeAttached}
                                onAttach={() => setOutcomeAttached(true)}
                                onReset={() => setOutcomeAttached(false)}
                                calibration={calibration}
                            />
                        ) : null}
                        {activeStage === 'sovereignty' ? (
                            <SovereigntyStage
                                view={sovereigntyView}
                                onViewChange={setSovereigntyView}
                                digest={sovereigntyView === 'local' ? digests.local : digests.outbound}
                            />
                        ) : null}
                        {activeStage === 'amr' ? (
                            <AmrStage outcomeAttached={outcomeAttached} />
                        ) : null}
                    </div>
                </section>

                <footer className="flex flex-col gap-4 border-t border-white/10 py-6 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-2xl text-xs leading-5 text-white/48">
                        This public fixture never writes patient, outcome, calibration, federation, or surveillance
                        records. Licensed clinician review remains required for real clinical decisions.
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs">
                        <Link className="text-cyan-300 transition hover:text-cyan-200" href="/platform/cire-standard">
                            CIRE specification
                        </Link>
                        <Link className="text-cyan-300 transition hover:text-cyan-200" href="/platform/network-learning">
                            Network learning
                        </Link>
                        <Link className="text-accent transition hover:text-accent/80" href="/signup">
                            Request access
                        </Link>
                    </div>
                </footer>
            </main>
        </div>
    );
}

function StageTabs({
    activeStage,
    onChange,
}: {
    activeStage: DemoStage;
    onChange: (stage: DemoStage) => void;
}) {
    return (
        <div
            role="tablist"
            aria-label="Clinical intelligence lifecycle"
            className="grid grid-cols-2 border-b border-white/10 lg:grid-cols-4"
        >
            {STAGES.map(({ id, icon: Icon }, index) => {
                const selected = activeStage === id;
                const labels = DEMO_STAGE_LABELS[id];
                return (
                    <button
                        key={id}
                        id={`demo-tab-${id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`demo-panel-${id}`}
                        onClick={() => onChange(id)}
                        className={`flex min-h-14 items-center gap-3 border-white/10 px-3 text-left text-xs transition sm:px-4 ${
                            index % 2 === 0 ? 'border-r' : ''
                        } lg:border-r lg:last:border-r-0 ${
                            index < 2 ? 'border-b lg:border-b-0' : ''
                        } ${
                            selected
                                ? 'bg-accent/10 text-accent'
                                : 'bg-[#0A0E11] text-white/58 hover:bg-white/[0.03] hover:text-white'
                        }`}
                    >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0">
                            <span className="block text-[10px] text-white/35">0{index + 1}</span>
                            <span className="block sm:hidden">{labels.short_label}</span>
                            <span className="hidden sm:block">{labels.label}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function LifecycleStatus({
    executionState,
    outcomeAttached,
}: {
    executionState: ExecutionState;
    outcomeAttached: boolean;
}) {
    const items = [
        {
            label: 'Data boundary',
            value: 'Local browser',
            state: 'live' as DemoEvidenceState,
        },
        {
            label: 'Inference',
            value: executionState === 'complete' ? 'Fixture complete' : executionState,
            state: 'demo_fixture' as DemoEvidenceState,
        },
        {
            label: 'Outcome',
            value: outcomeAttached ? 'Synthetic attached' : 'Pending',
            state: 'demo_fixture' as DemoEvidenceState,
        },
        {
            label: 'Federation',
            value: 'Not submitted',
            state: 'demo_fixture' as DemoEvidenceState,
        },
        {
            label: 'Regional AMR',
            value: 'No live feed',
            state: 'not_configured' as DemoEvidenceState,
        },
    ];

    return (
        <section aria-label="Lifecycle status" className="grid border-b border-white/10 sm:grid-cols-2 lg:grid-cols-5">
            {items.map((item) => (
                <div
                    key={item.label}
                    className="flex min-h-20 items-center justify-between gap-3 border-x border-t border-white/10 px-4 py-3 first:border-l lg:border-l-0 lg:first:border-l"
                >
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">{item.label}</div>
                        <div className="mt-1 text-xs capitalize text-white/78">{item.value}</div>
                    </div>
                    <EvidenceBadge state={item.state} compact />
                </div>
            ))}
        </section>
    );
}

function ClinicalStage({
    executionState,
    onRun,
}: {
    executionState: ExecutionState;
    onRun: () => void;
}) {
    const { patient, inference } = DEMO_CONTROL_PLANE_CASE;

    return (
        <div className="grid lg:grid-cols-[0.82fr_1.18fr]">
            <section className="border-b border-white/10 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                <SectionHeader
                    icon={Database}
                    eyebrow="Local clinical input"
                    title="Culture-pending urinary case"
                    state="live"
                />
                <dl className="mt-6 divide-y divide-white/8 border-y border-white/8">
                    <DetailRow label="Species" value={patient.species} />
                    <DetailRow label="Signalment" value={`${patient.breed}, ${patient.age}, ${patient.sex}`} />
                    <DetailRow label="Presentation" value={patient.presentation} />
                    <DetailRow label="History" value={patient.history} />
                    <DetailRow label="Lab context" value={patient.laboratory_context} />
                </dl>
                <button
                    type="button"
                    onClick={onRun}
                    disabled={executionState === 'running'}
                    className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 border border-accent/65 bg-accent/10 px-4 text-sm font-medium text-accent transition hover:bg-accent hover:text-black disabled:cursor-wait disabled:opacity-65"
                >
                    {executionState === 'running' ? (
                        <>
                            <Activity className="h-4 w-4 animate-pulse" aria-hidden="true" />
                            Executing deterministic fixture
                        </>
                    ) : (
                        <>
                            {executionState === 'complete' ? 'Run fixture again' : 'Run controlled inference'}
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </>
                    )}
                </button>
                <p className="mt-3 text-xs leading-5 text-white/44">
                    Execution remains in this browser. No model provider request or persistence occurs.
                </p>
            </section>

            <section aria-live="polite" className="p-4 sm:p-6">
                {executionState === 'ready' ? <InferenceReady /> : null}
                {executionState === 'running' ? <InferenceRunning /> : null}
                {executionState === 'complete' ? <InferenceComplete /> : null}
            </section>
        </div>
    );
}

function InferenceReady() {
    return (
        <div className="flex min-h-[460px] items-center justify-center border border-dashed border-white/12 p-6 text-center">
            <div className="max-w-md">
                <BrainCircuit className="mx-auto h-8 w-8 text-cyan-300" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-semibold">Inference gate ready</h2>
                <p className="mt-2 text-sm leading-6 text-white/58">
                    The fixture will reveal ranked hypotheses, CIRE runtime signals, and the governed route record.
                </p>
                <div className="mt-5 flex justify-center">
                    <EvidenceBadge state="demo_fixture" />
                </div>
            </div>
        </div>
    );
}

function InferenceRunning() {
    const steps = [
        'Structured clinical signals normalized',
        'Differential fixture materialized',
        'CIRE semantics attached',
        'Non-persistent route record assembled',
    ];

    return (
        <div className="min-h-[460px]">
            <SectionHeader
                icon={Activity}
                eyebrow="Execution trace"
                title="Deterministic browser runtime"
                state="demo_fixture"
            />
            <ol className="mt-6 divide-y divide-white/8 border-y border-white/8">
                {steps.map((step, index) => (
                    <li key={step} className="flex min-h-14 items-center gap-3 py-3 text-sm text-white/72">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                        <span className="w-7 text-xs text-white/35">0{index + 1}</span>
                        {step}
                    </li>
                ))}
            </ol>
        </div>
    );
}

function InferenceComplete() {
    const { inference } = DEMO_CONTROL_PLANE_CASE;
    return (
        <div>
            <div className="flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="text-xs uppercase tracking-[0.16em] text-white/38">
                        {DEMO_CONTROL_PLANE_CASE.inference_event_id}
                    </div>
                    <h2 className="mt-1 text-xl font-semibold">Ranked clinical hypotheses</h2>
                </div>
                <span className="border border-amber-300/35 bg-amber-300/8 px-3 py-2 text-xs text-amber-200">
                    Review required
                </span>
            </div>

            <div className="mt-5 space-y-3">
                {inference.differentials.map((entry, index) => (
                    <div key={entry.label} className="border border-white/10 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm font-medium">
                                {index + 1}. {formatClinicalLabel(entry.label)}
                            </div>
                            <span className={urgencyClass(entry.urgency)}>{entry.urgency} urgency</span>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                            <div
                                role="progressbar"
                                aria-label={`${formatClinicalLabel(entry.label)} demo score`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(entry.probability * 100)}
                                className="h-2 flex-1 bg-white/[0.06]"
                            >
                                <div
                                    className={scoreClass(entry.probability)}
                                    style={{ width: formatPercent(entry.probability) }}
                                />
                            </div>
                            <span className="w-11 text-right text-sm text-white/72">
                                {formatPercent(entry.probability)}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 grid border-y border-white/10 sm:grid-cols-3">
                <MetricCell
                    label="Phi-hat"
                    value={inference.cire.phi_hat.toFixed(2)}
                    note="Differential concentration"
                    tone="cyan"
                />
                <MetricCell
                    label="CPS"
                    value={inference.cire.cps.toFixed(2)}
                    note="Perturbation pressure"
                    tone="amber"
                />
                <MetricCell
                    label="Input impairment"
                    value={formatPercent(inference.cire.input_impairment)}
                    note="Fixture signal"
                    tone="neutral"
                />
            </div>

            <div className="mt-6 grid gap-5 border-t border-white/10 pt-5 md:grid-cols-2">
                <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <GitBranch className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                        Governed route
                    </div>
                    <dl className="mt-3 divide-y divide-white/8 text-xs">
                        <CompactRow label="Model" value={`${inference.model_name}:${inference.model_version}`} />
                        <CompactRow label="Mode" value={inference.route_mode} />
                        <CompactRow label="Provider request" value="not sent" />
                        <CompactRow label="Decision persisted" value="no" />
                    </dl>
                </div>
                <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <TestTube2 className="h-4 w-4 text-accent" aria-hidden="true" />
                        Next evidence
                    </div>
                    <ul className="mt-3 space-y-2 text-xs leading-5 text-white/62">
                        {inference.recommended_tests.map((test) => (
                            <li key={test} className="flex gap-2">
                                <span className="text-accent">+</span>
                                {test}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <p className="mt-5 border-l-2 border-cyan-300/60 pl-3 text-xs leading-5 text-white/50">
                Phi-hat is a concentration signal, not diagnostic correctness. These scores are deterministic
                fixture values and are not calibrated clinical probabilities.
            </p>
        </div>
    );
}

function OutcomeStage({
    executionState,
    outcomeAttached,
    onAttach,
    onReset,
    calibration,
}: {
    executionState: ExecutionState;
    outcomeAttached: boolean;
    onAttach: () => void;
    onReset: () => void;
    calibration: ReturnType<typeof buildDemoCalibrationPreview>;
}) {
    const { outcome } = DEMO_CONTROL_PLANE_CASE;
    const inferenceReady = executionState === 'complete';

    return (
        <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            <section className="border-b border-white/10 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                <SectionHeader
                    icon={ClipboardCheck}
                    eyebrow="Append-only lineage preview"
                    title="Inference to outcome closure"
                    state="demo_fixture"
                />
                <ol className="mt-6 border-y border-white/10">
                    <TimelineRow
                        day="Day 0"
                        title="Inference fixture"
                        detail="Bacterial pyelonephritis ranked first at 0.73."
                        status={inferenceReady ? 'complete' : 'pending'}
                    />
                    <TimelineRow
                        day={`Day ${outcome.day}`}
                        title="Culture and AST attached"
                        detail={outcome.confirmed_label}
                        status={outcomeAttached ? 'complete' : 'pending'}
                    />
                    <TimelineRow
                        day={`Day ${outcome.follow_up_day}`}
                        title="Synthetic follow-up"
                        detail={outcome.follow_up}
                        status={outcomeAttached ? 'complete' : 'pending'}
                    />
                    <TimelineRow
                        day="Gate"
                        title="Calibration materialization"
                        detail={calibration.block_reason}
                        status={outcomeAttached ? 'blocked' : 'pending'}
                    />
                </ol>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                        type="button"
                        disabled={!inferenceReady || outcomeAttached}
                        onClick={onAttach}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 border border-accent/60 bg-accent/10 px-4 text-sm text-accent transition hover:bg-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                        {outcomeAttached ? 'Synthetic outcome attached' : 'Attach culture outcome'}
                    </button>
                    {outcomeAttached ? (
                        <button
                            type="button"
                            onClick={onReset}
                            className="inline-flex min-h-11 items-center justify-center gap-2 border border-white/12 px-4 text-sm text-white/68 transition hover:border-white/25 hover:text-white"
                        >
                            <RefreshCw className="h-4 w-4" aria-hidden="true" />
                            Reset outcome
                        </button>
                    ) : null}
                </div>
                {!inferenceReady ? (
                    <p className="mt-3 text-xs text-amber-200/75">
                        Run the controlled inference before attaching its outcome.
                    </p>
                ) : null}
            </section>

            <section className="p-4 sm:p-6">
                <SectionHeader
                    icon={ShieldCheck}
                    eyebrow="Evidence gate"
                    title="Calibration posture"
                    state={outcomeAttached ? 'demo_fixture' : 'not_configured'}
                />
                <div className="mt-6 grid grid-cols-2 border-y border-white/10">
                    <MetricCell
                        label="Predicted score"
                        value={formatPercent(calibration.predicted_probability)}
                        note="Fixture"
                        tone="cyan"
                    />
                    <MetricCell
                        label="Observed target"
                        value={calibration.observed_target == null ? '--' : calibration.observed_target.toFixed(1)}
                        note="Synthetic"
                        tone="neutral"
                    />
                    <MetricCell
                        label="Residual"
                        value={calibration.calibration_residual == null ? '--' : `+${calibration.calibration_residual.toFixed(2)}`}
                        note="Observed minus predicted"
                        tone="amber"
                    />
                    <MetricCell
                        label="Learning eligible"
                        value="NO"
                        note="Synthetic exclusion"
                        tone="red"
                    />
                </div>
                <div className="mt-6 border border-red-400/25 bg-red-400/[0.06] p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-red-200">
                        <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                        Evidence blocked from learning
                    </div>
                    <p className="mt-2 text-xs leading-5 text-red-100/65">
                        {calibration.block_reason} A production record would additionally require evidence-grade
                        authority, provenance, consent, and outcome validation.
                    </p>
                </div>
                <dl className="mt-5 divide-y divide-white/8 text-xs">
                    <CompactRow label="Authority" value={outcome.authority} />
                    <CompactRow label="Persisted" value="false" />
                    <CompactRow label="Calibration update" value="none" />
                    <CompactRow label="Model promotion effect" value="none" />
                </dl>
            </section>
        </div>
    );
}

function SovereigntyStage({
    view,
    onViewChange,
    digest,
}: {
    view: SovereigntyView;
    onViewChange: (view: SovereigntyView) => void;
    digest: string;
}) {
    const { sovereignty } = DEMO_CONTROL_PLANE_CASE;
    const payload = view === 'local' ? sovereignty.raw_record : sovereignty.outbound_packet;

    return (
        <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
            <section className="border-b border-white/10 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                <SectionHeader
                    icon={Server}
                    eyebrow="Clinic node boundary"
                    title={view === 'local' ? 'Raw record retained locally' : 'Outbound commitment preview'}
                    state="demo_fixture"
                />
                <div
                    role="group"
                    aria-label="Sovereignty payload view"
                    className="mt-5 grid grid-cols-2 border border-white/10"
                >
                    <button
                        type="button"
                        aria-pressed={view === 'local'}
                        onClick={() => onViewChange('local')}
                        className={`min-h-11 px-3 text-xs transition ${
                            view === 'local' ? 'bg-cyan-300/10 text-cyan-200' : 'text-white/55 hover:text-white'
                        }`}
                    >
                        Raw local record
                    </button>
                    <button
                        type="button"
                        aria-pressed={view === 'outbound'}
                        onClick={() => onViewChange('outbound')}
                        className={`min-h-11 border-l border-white/10 px-3 text-xs transition ${
                            view === 'outbound' ? 'bg-accent/10 text-accent' : 'text-white/55 hover:text-white'
                        }`}
                    >
                        Outbound packet
                    </button>
                </div>
                <pre className="mt-4 max-h-[430px] overflow-auto border border-white/10 bg-black/35 p-4 text-[11px] leading-5 text-white/72">
                    {stableSerializeDemoValue(payload)}
                </pre>
                <div className="mt-3 break-all border-l-2 border-cyan-300/60 pl-3 text-[10px] leading-5 text-white/48">
                    <span className="text-white/72">Browser-computed SHA-256:</span> {digest}
                </div>
            </section>

            <section className="p-4 sm:p-6">
                <SectionHeader
                    icon={LockKeyhole}
                    eyebrow="Boundary assertion"
                    title="What crosses the node"
                    state="demo_fixture"
                />
                <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <BoundaryList
                        title="Retained locally"
                        items={sovereignty.retained_locally}
                        tone="cyan"
                    />
                    <BoundaryList
                        title="Outbound fields"
                        items={sovereignty.outbound_fields}
                        tone="green"
                    />
                </div>
                <dl className="mt-6 divide-y divide-white/8 border-y border-white/8 text-xs">
                    <CompactRow label="Protocol shape" value={sovereignty.protocol} />
                    <CompactRow label="Protocol execution" value="not executed" />
                    <CompactRow label="Raw records included" value="false" />
                    <CompactRow label="Raw delta included" value="false" />
                    <CompactRow label="Network submission" value="not submitted" />
                </dl>
                <p className="mt-5 border-l-2 border-amber-300/60 pl-3 text-xs leading-5 text-white/50">
                    This view proves the displayed browser fixture and its SHA-256 digest only. It does not claim
                    zero-knowledge proof execution, live X25519 key exchange, or production partner submission.
                </p>
            </section>
        </div>
    );
}

function AmrStage({ outcomeAttached }: { outcomeAttached: boolean }) {
    const { culture, amr } = DEMO_CONTROL_PLANE_CASE;

    return (
        <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
            <section className="border-b border-white/10 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                <SectionHeader
                    icon={TestTube2}
                    eyebrow="Culture and susceptibility"
                    title={outcomeAttached ? culture.organism : 'Culture fixture pending attachment'}
                    state="demo_fixture"
                />
                {outcomeAttached ? (
                    <>
                        <dl className="mt-5 grid gap-px bg-white/10 sm:grid-cols-3">
                            <LabFact label="Specimen" value={culture.specimen} />
                            <LabFact label="Organism" value={culture.organism} />
                            <LabFact label="Quantity" value={culture.quantity} />
                        </dl>
                        <div className="mt-6 overflow-x-auto">
                            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                                <caption className="pb-3 text-left text-xs text-white/48">
                                    Interpretations supplied by the synthetic laboratory fixture
                                </caption>
                                <thead>
                                    <tr className="border-y border-white/10 text-[10px] uppercase tracking-[0.14em] text-white/40">
                                        <th className="px-3 py-3 font-normal">Antimicrobial</th>
                                        <th className="px-3 py-3 font-normal">Interpretation</th>
                                        <th className="px-3 py-3 font-normal">Case signal</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/8">
                                    {culture.susceptibility.map((row) => (
                                        <tr key={row.antimicrobial}>
                                            <td className="px-3 py-3 text-white/78">{row.antimicrobial}</td>
                                            <td className="px-3 py-3">
                                                <AstBadge interpretation={row.interpretation} />
                                            </td>
                                            <td className="px-3 py-3 text-xs text-white/52">
                                                {row.interpretation === 'R' ? 'Resistance phenotype' : 'Lab result only'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                ) : (
                    <div className="mt-6 flex min-h-[340px] items-center justify-center border border-dashed border-white/12 p-6 text-center">
                        <div className="max-w-sm">
                            <TestTube2 className="mx-auto h-8 w-8 text-amber-200" aria-hidden="true" />
                            <p className="mt-4 text-sm leading-6 text-white/58">
                                Run the clinical fixture, then attach its culture outcome in stage 02.
                            </p>
                        </div>
                    </div>
                )}
                <p className="mt-5 text-xs leading-5 text-white/45">
                    No prescribing recommendation is generated. Susceptibility interpretation, patient factors,
                    jurisdiction, and clinician judgment govern treatment.
                </p>
            </section>

            <section className="p-4 sm:p-6">
                <SectionHeader
                    icon={Network}
                    eyebrow="One Health network"
                    title="Surveillance posture"
                    state="not_configured"
                />
                <div className="mt-6 border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs uppercase tracking-[0.14em] text-white/42">
                            Regional resistance drift
                        </span>
                        <EvidenceBadge state="not_configured" compact />
                    </div>
                    <div className="mt-5 text-3xl font-semibold text-white/32">NO LIVE DATA</div>
                    <p className="mt-3 text-xs leading-5 text-white/48">
                        The public demo has no configured surveillance tenant and does not fabricate regional counts.
                    </p>
                </div>
                <dl className="mt-5 divide-y divide-white/8 border-y border-white/8 text-xs">
                    <CompactRow
                        label="Case-level signal"
                        value={outcomeAttached ? amr.case_signal : 'awaiting synthetic outcome'}
                    />
                    <CompactRow label="Stewardship posture" value={amr.stewardship_state} />
                    <CompactRow label="Regional aggregate" value="not configured" />
                    <CompactRow label="WOAH / CDC context" value="not asserted" />
                    <CompactRow label="Learning contribution" value="blocked synthetic fixture" />
                </dl>
                <div className="mt-6 flex items-start gap-3 border-l-2 border-accent/60 pl-3">
                    <Microscope className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    <p className="text-xs leading-5 text-white/52">
                        In production, evidence-grade culture/AST episodes can enter stewardship, surveillance, and
                        federated eligibility workflows only after provenance and outcome gates pass.
                    </p>
                </div>
            </section>
        </div>
    );
}

function SectionHeader({
    icon: Icon,
    eyebrow,
    title,
    state,
}: {
    icon: typeof Activity;
    eyebrow: string;
    title: string;
    state: DemoEvidenceState;
}) {
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/40">
                    <Icon className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                    {eyebrow}
                </div>
                <h2 className="mt-2 text-lg font-semibold tracking-normal">{title}</h2>
            </div>
            <EvidenceBadge state={state} compact />
        </div>
    );
}

function EvidenceBadge({
    state,
    compact = false,
}: {
    state: DemoEvidenceState;
    compact?: boolean;
}) {
    const config = {
        live: {
            label: 'LIVE',
            className: 'border-accent/35 bg-accent/10 text-accent',
        },
        demo_fixture: {
            label: 'DEMO FIXTURE',
            className: 'border-amber-300/35 bg-amber-300/8 text-amber-200',
        },
        not_configured: {
            label: 'NOT CONFIGURED',
            className: 'border-white/15 bg-white/[0.03] text-white/48',
        },
    }[state];

    return (
        <span
            className={`inline-flex shrink-0 items-center border font-mono text-[9px] uppercase tracking-[0.12em] ${config.className} ${
                compact ? 'px-2 py-1' : 'px-3 py-2'
            }`}
        >
            {config.label}
        </span>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid gap-1 py-3 sm:grid-cols-[120px_1fr] sm:gap-4">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</dt>
            <dd className="text-sm leading-6 text-white/76">{value}</dd>
        </div>
    );
}

function CompactRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid gap-1 py-2.5 sm:grid-cols-[132px_1fr] sm:gap-3">
            <dt className="text-white/40">{label}</dt>
            <dd className="break-words text-white/72">{value}</dd>
        </div>
    );
}

function MetricCell({
    label,
    value,
    note,
    tone,
}: {
    label: string;
    value: string;
    note: string;
    tone: 'cyan' | 'amber' | 'red' | 'neutral';
}) {
    const valueClass = {
        cyan: 'text-cyan-200',
        amber: 'text-amber-200',
        red: 'text-red-300',
        neutral: 'text-white/80',
    }[tone];
    return (
        <div className="min-h-24 border-b border-r border-white/10 p-3 last:border-r-0 sm:border-b-0">
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/38">{label}</div>
            <div className={`mt-2 text-2xl font-semibold ${valueClass}`}>{value}</div>
            <div className="mt-1 text-[10px] text-white/42">{note}</div>
        </div>
    );
}

function TimelineRow({
    day,
    title,
    detail,
    status,
}: {
    day: string;
    title: string;
    detail: string;
    status: 'complete' | 'pending' | 'blocked';
}) {
    const icon = status === 'complete'
        ? <CheckCircle2 className="h-4 w-4 text-accent" aria-hidden="true" />
        : status === 'blocked'
            ? <LockKeyhole className="h-4 w-4 text-red-300" aria-hidden="true" />
            : <Activity className="h-4 w-4 text-white/35" aria-hidden="true" />;
    return (
        <li className="grid gap-3 border-b border-white/8 py-4 last:border-b-0 sm:grid-cols-[72px_24px_1fr]">
            <div className="text-xs text-cyan-200">{day}</div>
            <div>{icon}</div>
            <div>
                <div className="text-sm font-medium text-white/82">{title}</div>
                <div className="mt-1 text-xs leading-5 text-white/50">{detail}</div>
            </div>
        </li>
    );
}

function BoundaryList({
    title,
    items,
    tone,
}: {
    title: string;
    items: readonly string[];
    tone: 'cyan' | 'green';
}) {
    const marker = tone === 'cyan' ? 'text-cyan-300' : 'text-accent';
    return (
        <div>
            <div className="text-xs font-medium text-white/78">{title}</div>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-white/54">
                {items.map((item) => (
                    <li key={item} className="flex gap-2">
                        <span className={marker}>+</span>
                        {item}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function LabFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-[#0A0E11] p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/38">{label}</div>
            <div className="mt-2 text-sm text-white/76">{value}</div>
        </div>
    );
}

function AstBadge({ interpretation }: { interpretation: string }) {
    const config = interpretation === 'R'
        ? 'border-red-400/35 bg-red-400/[0.07] text-red-200'
        : interpretation === 'I'
            ? 'border-amber-300/35 bg-amber-300/[0.07] text-amber-200'
            : 'border-accent/35 bg-accent/[0.07] text-accent';
    return (
        <span className={`inline-flex min-w-8 items-center justify-center border px-2 py-1 text-xs ${config}`}>
            {interpretation}
        </span>
    );
}

function StatusDot({ tone }: { tone: 'green' }) {
    return <span className={`h-2 w-2 ${tone === 'green' ? 'bg-accent' : 'bg-white/40'}`} aria-hidden="true" />;
}

function scoreClass(value: number) {
    if (value >= 0.7) return 'h-2 bg-red-400';
    if (value >= 0.4) return 'h-2 bg-amber-300';
    return 'h-2 bg-cyan-300';
}

function urgencyClass(value: 'high' | 'medium' | 'low') {
    const tone = value === 'high'
        ? 'border-red-400/35 text-red-200'
        : value === 'medium'
            ? 'border-amber-300/35 text-amber-200'
            : 'border-white/15 text-white/55';
    return `border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${tone}`;
}

async function sha256Hex(value: string): Promise<string> {
    if (!globalThis.crypto?.subtle) return 'unavailable';
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}
