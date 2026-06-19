import type { AskVetiosCaseGraphSnapshot } from '@/lib/askVetios/caseGraph';
import type { AskVetiosIntakeSummary } from '@/lib/askVetios/intake';

export type AskVetiosWorkflowIntegrationStatus =
    | 'non_clinical'
    | 'needs_intake'
    | 'case_handoff_ready'
    | 'diagnostics_workflow_ready'
    | 'outcome_workflow_ready';

export interface AskVetiosWorkflowIntegrationSnapshot {
    schema_version: 'ask-vetios-workflow-integration-v1';
    status: AskVetiosWorkflowIntegrationStatus;
    workflow_boundary: 'clinical_case_workflow';
    handoffs: {
        clinical_case_form_ready: boolean;
        clinical_case_href: string;
        inference_ready: boolean;
        inference_href: string;
        case_graph_ready: boolean;
        clinician_confirmation_required: boolean;
    };
    connected_data: {
        patient_signalment: boolean;
        patient_history: boolean;
        clinical_signs: boolean;
        duration: boolean;
        lab_data: boolean;
        imaging: boolean;
        treatment: boolean;
        outcome_signal: boolean;
        ranked_differentials: boolean;
        recommended_diagnostics: boolean;
    };
    downstream_workflows: {
        clinical_case_record: 'ready' | 'blocked';
        inference_console: 'ready' | 'blocked';
        diagnostic_review: 'ready' | 'blocked';
        outcome_capture: 'ready' | 'blocked';
        model_trust_review: 'ready' | 'blocked';
    };
    quality_gates: {
        minimum_case_fields_complete: boolean;
        evidence_status: string | null;
        model_trust_status: string | null;
        emergency_red_flags: boolean;
    };
    next_actions: string[];
}

interface BuildAskVetiosWorkflowIntegrationSnapshotInput {
    mode: string;
    metadata: Record<string, unknown>;
    intake: AskVetiosIntakeSummary;
    caseGraphSnapshot?: AskVetiosCaseGraphSnapshot | null;
}

export function buildAskVetiosWorkflowIntegrationSnapshot(
    input: BuildAskVetiosWorkflowIntegrationSnapshotInput,
): AskVetiosWorkflowIntegrationSnapshot {
    const draft = input.intake.case_draft;
    const clinical = input.mode === 'clinical' || input.intake.is_clinical_intake;
    const differentials = readArray(input.metadata.diagnosis_ranked);
    const recommendedTests = readStringArray(input.metadata.recommended_tests);
    const labData = draft.labs_or_tests.length > 0;
    const imaging = draft.imaging.length > 0;
    const treatment = draft.treatments.length > 0;
    const outcomeSignal = draft.outcome_signals.length > 0;
    const diagnosticsReady = input.intake.case_handoff.ready
        && (labData || imaging || recommendedTests.length > 0)
        && differentials.length > 0;
    const status = determineStatus({
        clinical,
        handoffReady: input.intake.case_handoff.ready,
        diagnosticsReady,
        outcomeSignal,
    });
    const connectedData = {
        patient_signalment: draft.species !== 'unknown' && (draft.age_years !== null || Boolean(draft.sex)),
        patient_history: Boolean(draft.duration) || draft.outcome_signals.length > 0 || draft.treatments.length > 0,
        clinical_signs: draft.clinical_signs.length > 0,
        duration: Boolean(draft.duration),
        lab_data: labData,
        imaging,
        treatment,
        outcome_signal: outcomeSignal,
        ranked_differentials: differentials.length > 0,
        recommended_diagnostics: recommendedTests.length > 0,
    };
    const qualityGates = {
        minimum_case_fields_complete: input.intake.status === 'case_ready' || input.intake.status === 'strong',
        evidence_status: readString(input.metadata.veterinary_retrieval_status),
        model_trust_status: readString(input.metadata.model_trust_status),
        emergency_red_flags: draft.red_flags.length > 0 || input.metadata.urgency_level === 'emergency',
    };

    return {
        schema_version: 'ask-vetios-workflow-integration-v1',
        status,
        workflow_boundary: 'clinical_case_workflow',
        handoffs: {
            clinical_case_form_ready: input.intake.case_handoff.ready,
            clinical_case_href: input.intake.case_handoff.clinical_case_href,
            inference_ready: input.intake.case_handoff.ready,
            inference_href: input.intake.case_handoff.inference_href,
            case_graph_ready: input.caseGraphSnapshot?.promotion.clinical_cases_ready === true,
            clinician_confirmation_required: true,
        },
        connected_data: connectedData,
        downstream_workflows: {
            clinical_case_record: input.intake.case_handoff.ready ? 'ready' : 'blocked',
            inference_console: input.intake.case_handoff.ready ? 'ready' : 'blocked',
            diagnostic_review: diagnosticsReady ? 'ready' : 'blocked',
            outcome_capture: outcomeSignal ? 'ready' : 'blocked',
            model_trust_review: qualityGates.model_trust_status ? 'ready' : 'blocked',
        },
        quality_gates: qualityGates,
        next_actions: buildNextActions({
            connectedData,
            handoffReady: input.intake.case_handoff.ready,
            diagnosticsReady,
            outcomeSignal,
            emergencyRedFlags: qualityGates.emergency_red_flags,
            graphActions: input.caseGraphSnapshot?.promotion.required_next_actions ?? [],
        }),
    };
}

function determineStatus(input: {
    clinical: boolean;
    handoffReady: boolean;
    diagnosticsReady: boolean;
    outcomeSignal: boolean;
}): AskVetiosWorkflowIntegrationStatus {
    if (!input.clinical) return 'non_clinical';
    if (!input.handoffReady) return 'needs_intake';
    if (input.outcomeSignal) return 'outcome_workflow_ready';
    if (input.diagnosticsReady) return 'diagnostics_workflow_ready';
    return 'case_handoff_ready';
}

function buildNextActions(input: {
    connectedData: AskVetiosWorkflowIntegrationSnapshot['connected_data'];
    handoffReady: boolean;
    diagnosticsReady: boolean;
    outcomeSignal: boolean;
    emergencyRedFlags: boolean;
    graphActions: string[];
}): string[] {
    const actions: string[] = [];
    if (input.emergencyRedFlags) actions.push('urgent_veterinary_review');
    if (!input.handoffReady) actions.push('capture_minimum_case_fields');
    if (input.handoffReady) actions.push('open_case_form');
    if (input.handoffReady) actions.push('open_inference');
    if (!input.connectedData.lab_data) actions.push('attach_labs_or_tests');
    if (!input.connectedData.imaging) actions.push('attach_imaging_if_available');
    if (!input.diagnosticsReady) actions.push('review_ranked_differentials');
    if (!input.outcomeSignal) actions.push('capture_outcome');
    actions.push('clinician_confirmation');
    return unique([...actions, ...input.graphActions]);
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
}
