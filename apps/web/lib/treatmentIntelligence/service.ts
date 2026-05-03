import type { SupabaseClient } from '@supabase/supabase-js';
import {
    AI_INFERENCE_EVENTS,
    CLINICAL_CASES,
    TREATMENT_CANDIDATES,
    TREATMENT_EVENTS,
    TREATMENT_OUTCOMES,
} from '@/lib/db/schemaContracts';
import {
    buildTreatmentRecommendationBundle,
    validateTreatmentBundle,
} from '@/lib/treatmentIntelligence/engine';
import { buildTreatmentOutcomeReasoningFeedback } from '@/lib/intelligence/clinicalAlignment';
import type {
    TreatmentCandidateRecord,
    TreatmentOutcomeStatus,
    TreatmentOutcomeWriteInput,
    TreatmentPathway,
    TreatmentPerformanceSummary,
    TreatmentRecommendationBundle,
    TreatmentRecommendationContext,
} from '@/lib/treatmentIntelligence/types';

type JsonRecord = Record<string, unknown>;

interface InferenceContextRecord {
    id: string;
    tenant_id: string;
    clinic_id: string | null;
    case_id: string | null;
    model_version: string;
    input_signature: JsonRecord;
    output_payload: JsonRecord;
    confidence_score: number | null;
}

interface ClinicalCaseLink {
    id: string;
    episode_id: string | null;
}

export async function recommendTreatmentPathways(
    client: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        context: TreatmentRecommendationContext;
    },
): Promise<{
    bundle: TreatmentRecommendationBundle;
    caseId: string | null;
    episodeId: string | null;
  }> {
    const inference = await loadInferenceContext(client, input.tenantId, input.inferenceEventId);
    const caseLink = inference.case_id
        ? await loadClinicalCaseLink(client, input.tenantId, inference.case_id)
        : null;
    const diagnosis = extractPrimaryDiagnosis(inference.output_payload);
    const performance = await loadTreatmentPerformance(client, {
        tenantId: input.tenantId,
        disease: diagnosis.label,
    });

    const bundle = buildTreatmentRecommendationBundle({
        inferenceEventId: inference.id,
        diagnosisLabel: diagnosis.label,
        diagnosisConfidence: diagnosis.probability ?? inference.confidence_score,
        emergencyLevel: readText(asRecord(inference.output_payload.risk_assessment).emergency_level),
        severityScore: readNumber(asRecord(inference.output_payload.risk_assessment).severity_score),
        species: readText(inference.input_signature.species),
        inputSignature: inference.input_signature,
        outputPayload: inference.output_payload,
        context: normalizeContext(input.context),
        observedPerformance: performance,
    });
    validateTreatmentBundle(bundle);

    const persistedOptions = await upsertTreatmentCandidates(client, {
        tenantId: input.tenantId,
        inferenceEventId: inference.id,
        caseId: inference.case_id,
        episodeId: caseLink?.episode_id ?? null,
        diagnosisConfidence: diagnosis.probability ?? inference.confidence_score,
        options: bundle.options,
    });

    return {
        bundle: {
            ...bundle,
            options: persistedOptions,
        },
        caseId: inference.case_id,
        episodeId: caseLink?.episode_id ?? null,
    };
}

export async function recordTreatmentDecisionAndOutcome(
    client: SupabaseClient,
    input: {
        tenantId: string;
        body: TreatmentOutcomeWriteInput;
    },
) {
    const inference = await loadInferenceContext(client, input.tenantId, input.body.inference_event_id);
    const caseLink = inference.case_id
        ? await loadClinicalCaseLink(client, input.tenantId, inference.case_id)
        : null;
    let candidate = input.body.treatment_candidate_id
        ? await loadTreatmentCandidateById(client, input.tenantId, input.body.treatment_candidate_id)
        : null;
    let treatmentEventId = input.body.treatment_event_id ?? null;

    if (!candidate) {
        const refresh = await recommendTreatmentPathways(client, {
            tenantId: input.tenantId,
            inferenceEventId: input.body.inference_event_id,
            context: normalizeContext({
                resource_profile: readResourceProfile(input.body.selection.context.resource_profile),
                regulatory_region: readText(input.body.selection.context.regulatory_region),
                care_environment: readText(input.body.selection.context.care_environment),
                comorbidities: readStringArray(input.body.selection.context.comorbidities),
                lab_flags: readStringArray(input.body.selection.context.lab_flags),
            }),
        });
        candidate = refresh.bundle.options.find((option) =>
            option.disease === input.body.selection.disease
            && option.treatment_pathway === input.body.selection.treatment_pathway,
        ) ?? null;
    }

    const treatmentEvent = treatmentEventId
        ? await loadTreatmentEventById(client, input.tenantId, treatmentEventId)
        : null;

    if (!treatmentEvent) {
        const createdEvent = await createTreatmentEvent(client, {
            tenantId: input.tenantId,
            inferenceEventId: input.body.inference_event_id,
            caseId: inference.case_id,
            episodeId: caseLink?.episode_id ?? null,
            treatmentCandidateId: candidate?.id ?? null,
            disease: input.body.selection.disease,
            selectedTreatment: {
                treatment_pathway: input.body.selection.treatment_pathway,
                clinician_confirmed: input.body.selection.clinician_confirmed,
                clinician_override: input.body.selection.clinician_override,
                actual_intervention: input.body.selection.actual_intervention,
                candidate_snapshot: candidate,
            },
            clinicianOverride: input.body.selection.clinician_override,
            clinicianValidationStatus: input.body.selection.clinician_override
                ? 'overridden'
                : input.body.selection.clinician_confirmed
                    ? 'confirmed'
                    : 'pending',
            contextJson: input.body.selection.context,
        });
        treatmentEventId = createdEvent.id;
    }

    const treatmentOutcome = input.body.outcome
        ? await upsertTreatmentOutcome(client, {
            tenantId: input.tenantId,
            treatmentEventId: treatmentEventId!,
            outcome: {
                ...input.body.outcome,
                outcome_json: {
                    ...(input.body.outcome.outcome_json ?? {}),
                    reasoning_feedback: buildTreatmentOutcomeReasoningFeedback({
                        disease: input.body.selection.disease,
                        treatmentPathway: input.body.selection.treatment_pathway,
                        outcomeStatus: input.body.outcome.outcome_status,
                    }),
                },
            },
        })
        : null;

    return {
        treatment_event_id: treatmentEventId,
        treatment_outcome_id: treatmentOutcome?.id ?? null,
        performance: await loadTreatmentPerformance(client, {
            tenantId: input.tenantId,
            disease: input.body.selection.disease,
        }),
        reasoning_feedback: treatmentOutcome
            ? buildTreatmentOutcomeReasoningFeedback({
                disease: input.body.selection.disease,
                treatmentPathway: input.body.selection.treatment_pathway,
                outcomeStatus: input.body.outcome?.outcome_status ?? null,
            })
            : null,
    };
}

export async function loadTreatmentPerformance(
    client: SupabaseClient,
    input: {
        tenantId: string;
        disease?: string | null;
        pathway?: TreatmentPathway | null;
    },
): Promise<TreatmentPerformanceSummary[]> {
    const eventColumns = [
        TREATMENT_EVENTS.COLUMNS.id,
        TREATMENT_EVENTS.COLUMNS.disease,
        TREATMENT_EVENTS.COLUMNS.clinician_confirmed_diagnosis,
        TREATMENT_EVENTS.COLUMNS.diagnosis_source,
        TREATMENT_EVENTS.COLUMNS.selected_treatment,
        TREATMENT_EVENTS.COLUMNS.clinician_override,
    ].join(', ');

    let eventsQuery = client
        .from(TREATMENT_EVENTS.TABLE)
        .select(eventColumns)
        .eq(TREATMENT_EVENTS.COLUMNS.tenant_id, input.tenantId)
        .order(TREATMENT_EVENTS.COLUMNS.created_at, { ascending: false })
        .limit(500);

    if (input.disease) {
        eventsQuery = eventsQuery.eq(TREATMENT_EVENTS.COLUMNS.disease, input.disease);
    }

    const { data: eventRows, error: eventError } = await eventsQuery;
    if (eventError) {
        throw new Error(`Failed to load treatment events: ${eventError.message}`);
    }

    const events = ((eventRows ?? []) as unknown[]).map((row) => row as JsonRecord);
    const filteredEvents = events.filter((row) => {
        if (!input.pathway) return true;
        return readText(asRecord(row.selected_treatment).treatment_pathway) === input.pathway;
    });
    const eventIds = filteredEvents
        .map((row) => readText(row.id))
        .filter((value): value is string => value != null);

    const outcomes = await loadTreatmentOutcomesByEventIds(client, eventIds);
    const outcomesByEventId = new Map(outcomes.map((row) => [row.event_id, row]));
    const groups = new Map<string, Array<{ event: JsonRecord; outcome: TreatmentOutcomeRow | null }>>();

    for (const event of filteredEvents) {
        const disease = readText(event.clinician_confirmed_diagnosis) ?? readText(event.disease);
        const pathway = readText(asRecord(event.selected_treatment).treatment_pathway);
        if (!disease || !pathway) continue;
        const key = `${disease}::${pathway}`;
        const current = groups.get(key) ?? [];
        current.push({
            event,
            outcome: outcomesByEventId.get(readText(event.id) ?? '') ?? null,
        });
        groups.set(key, current);
    }

    return Array.from(groups.entries()).map(([key, rows]) => {
        const [disease, pathway] = key.split('::');
        const completed = rows.filter((row) => row.outcome != null);
        const successful = completed.filter((row) => isSuccessfulOutcome(row.outcome!.outcome_status));
        const complicated = completed.filter((row) => isComplicatedOutcome(row.outcome!.outcome_status));
        const recoveryTimes = completed
            .map((row) => row.outcome!.recovery_time_days)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            .sort((a, b) => a - b);
        const overrideCount = rows.filter((row) => readBoolean(row.event.clinician_override) === true).length;
        const clinicianConfirmedRows = rows.filter((row) => readText(row.event.clinician_confirmed_diagnosis) != null);
        const aiMatchCount = clinicianConfirmedRows.filter((row) =>
            normalizeDiagnosisLabel(readText(row.event.disease)) === normalizeDiagnosisLabel(readText(row.event.clinician_confirmed_diagnosis))
        ).length;

        return {
            disease,
            pathway: pathway as TreatmentPathway,
            sample_size: rows.length,
            success_rate: completed.length > 0 ? successful.length / completed.length : null,
            complication_rate: completed.length > 0 ? complicated.length / completed.length : null,
            median_recovery_time_days: median(recoveryTimes),
            clinician_override_rate: rows.length > 0 ? overrideCount / rows.length : null,
            ai_accuracy_rate: clinicianConfirmedRows.length > 0 ? aiMatchCount / clinicianConfirmedRows.length : null,
        } satisfies TreatmentPerformanceSummary;
    });
}

interface TreatmentOutcomeRow {
    id: string;
    event_id: string;
    outcome_status: TreatmentOutcomeStatus;
    recovery_time_days: number | null;
}

async function loadInferenceContext(client: SupabaseClient, tenantId: string, inferenceEventId: string): Promise<InferenceContextRecord> {
    const C = AI_INFERENCE_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(AI_INFERENCE_EVENTS.TABLE)
        .select(`${C.id}, ${C.tenant_id}, ${C.clinic_id}, ${C.case_id}, ${C.model_version}, ${C.input_signature}, ${C.output_payload}, ${C.confidence_score}`)
        .eq(C.tenant_id, tenantId)
        .eq(C.id, inferenceEventId)
        .single();

    if (error || !data) {
        throw new Error(`Failed to load inference event for treatment support: ${error?.message ?? 'Not found'}`);
    }

    const row = data as JsonRecord;
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        clinic_id: readText(row.clinic_id),
        case_id: readText(row.case_id),
        model_version: readText(row.model_version) ?? 'unknown',
        input_signature: asRecord(row.input_signature),
        output_payload: asRecord(row.output_payload),
        confidence_score: readNumber(row.confidence_score),
    };
}

async function loadClinicalCaseLink(client: SupabaseClient, tenantId: string, caseId: string): Promise<ClinicalCaseLink | null> {
    const C = CLINICAL_CASES.COLUMNS;
    const { data, error } = await client
        .from(CLINICAL_CASES.TABLE)
        .select(`${C.id}, ${C.episode_id}`)
        .eq(C.tenant_id, tenantId)
        .eq(C.id, caseId)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to load clinical case link: ${error.message}`);
    }
    if (!data) return null;
    const row = data as JsonRecord;
    return {
        id: String(row.id),
        episode_id: readText(row.episode_id),
    };
}

function extractPrimaryDiagnosis(outputPayload: JsonRecord) {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const differentials = Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
    const top = differentials.find((entry) => typeof entry === 'object' && entry !== null) as JsonRecord | undefined;
    const label = readText(top?.name) ?? readText(diagnosis.primary_diagnosis) ?? 'Undifferentiated';
    return {
        label,
        probability: readNumber(top?.probability),
    };
}

async function upsertTreatmentCandidates(
    client: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        caseId: string | null;
        episodeId: string | null;
        diagnosisConfidence: number | null;
        options: TreatmentCandidateRecord[];
    },
): Promise<TreatmentCandidateRecord[]> {
    const C = TREATMENT_CANDIDATES.COLUMNS;
    const payload = input.options.map((option) => ({
        [C.tenant_id]: input.tenantId,
        [C.inference_event_id]: input.inferenceEventId,
        [C.case_id]: input.caseId,
        [C.episode_id]: input.episodeId,
        [C.disease]: option.disease,
        [C.diagnosis_source]: 'ai_inference',
        [C.diagnosis_confidence]: input.diagnosisConfidence,
        [C.species_applicability]: option.species_applicability,
        [C.treatment_pathway]: option.treatment_pathway,
        [C.treatment_type]: option.treatment_type,
        [C.intervention_json]: option.intervention_details,
        [C.indication_criteria]: option.indication_criteria,
        [C.contraindications]: option.contraindications,
        [C.detected_contraindications]: option.detected_contraindications,
        [C.risk_level]: option.risk_level,
        [C.urgency_level]: option.urgency_level,
        [C.evidence_level]: option.evidence_level,
        [C.environment_constraints]: option.environment_constraints,
        [C.expected_outcome_json]: option.expected_outcome_range,
        [C.uncertainty_json]: option.uncertainty,
        [C.risks]: option.risks,
        [C.regulatory_notes]: option.regulatory_notes,
        [C.supporting_signals]: option.supporting_signals,
        [C.rationale]: option.why_relevant,
        [C.clinician_validation_required]: option.clinician_validation_required,
    }));

    const { data, error } = await client
        .from(TREATMENT_CANDIDATES.TABLE)
        .upsert(payload, { onConflict: 'tenant_id,inference_event_id,treatment_pathway,disease' })
        .select('*');

    if (error) {
        throw new Error(`Failed to persist treatment candidates: ${error.message}`);
    }

    const rows = (data ?? []).map((row) => mapTreatmentCandidateRow(row as JsonRecord));
    const rowByPathway = new Map(rows.map((row) => [`${row.disease}::${row.treatment_pathway}`, row]));
    return input.options.map((option) => rowByPathway.get(`${option.disease}::${option.treatment_pathway}`) ?? option);
}

async function loadTreatmentCandidateById(client: SupabaseClient, tenantId: string, candidateId: string): Promise<TreatmentCandidateRecord | null> {
    const C = TREATMENT_CANDIDATES.COLUMNS;
    const { data, error } = await client
        .from(TREATMENT_CANDIDATES.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, candidateId)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to load treatment candidate: ${error.message}`);
    }
    return data ? mapTreatmentCandidateRow(data as JsonRecord) : null;
}

async function loadTreatmentEventById(client: SupabaseClient, tenantId: string, treatmentEventId: string): Promise<JsonRecord | null> {
    const C = TREATMENT_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(TREATMENT_EVENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, treatmentEventId)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to load treatment event: ${error.message}`);
    }
    return data ? data as JsonRecord : null;
}

async function createTreatmentEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        caseId: string | null;
        episodeId: string | null;
        treatmentCandidateId: string | null;
        disease: string;
        selectedTreatment: JsonRecord;
        clinicianOverride: boolean;
        clinicianValidationStatus: string;
        contextJson: JsonRecord;
    },
) {
    const C = TREATMENT_EVENTS.COLUMNS;
    const actualIntervention = input.selectedTreatment.actual_intervention;
    const clinicianConfirmedDiagnosis = input.clinicianOverride
        ? readText(actualIntervention)
            ?? readText(asRecord(actualIntervention).diagnosis)
            ?? readText(asRecord(actualIntervention).diagnosis_label)
            ?? readText(asRecord(actualIntervention).condition)
        : null;
    const { data, error } = await client
        .from(TREATMENT_EVENTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.inference_event_id]: input.inferenceEventId,
            [C.case_id]: input.caseId,
            [C.episode_id]: input.episodeId,
            [C.treatment_candidate_id]: input.treatmentCandidateId,
            [C.disease]: input.disease,
            [C.clinician_confirmed_diagnosis]: clinicianConfirmedDiagnosis,
            [C.diagnosis_source]: input.clinicianOverride ? 'clinician_override' : 'ai_inference',
            [C.selected_treatment]: input.selectedTreatment,
            [C.clinician_override]: input.clinicianOverride,
            [C.clinician_validation_status]: input.clinicianValidationStatus,
            [C.context_json]: input.contextJson,
        })
        .select('*')
        .single();
    if (error || !data) {
        throw new Error(`Failed to create treatment event: ${error?.message ?? 'Unknown error'}`);
    }
    const row = data as JsonRecord;
    return {
        id: String(row.id),
    };
}

async function upsertTreatmentOutcome(
    client: SupabaseClient,
    input: {
        tenantId: string;
        treatmentEventId: string;
        outcome: NonNullable<TreatmentOutcomeWriteInput['outcome']>;
    },
) {
    const C = TREATMENT_OUTCOMES.COLUMNS;
    const { data, error } = await client
        .from(TREATMENT_OUTCOMES.TABLE)
        .upsert({
            [C.event_id]: input.treatmentEventId,
            [C.tenant_id]: input.tenantId,
            [C.outcome_status]: input.outcome.outcome_status,
            [C.recovery_time_days]: input.outcome.recovery_time_days ?? null,
            [C.complications]: input.outcome.complications ?? [],
            [C.notes]: input.outcome.notes ?? null,
            [C.short_term_response]: input.outcome.short_term_response ?? null,
            [C.outcome_json]: input.outcome.outcome_json ?? {},
            [C.observed_at]: input.outcome.observed_at ?? new Date().toISOString(),
        }, { onConflict: 'event_id' })
        .select('*')
        .single();
    if (error || !data) {
        throw new Error(`Failed to persist treatment outcome: ${error?.message ?? 'Unknown error'}`);
    }
    return {
        id: String((data as JsonRecord).id),
        event_id: String((data as JsonRecord).event_id),
        outcome_status: readText((data as JsonRecord).outcome_status) as TreatmentOutcomeStatus,
        recovery_time_days: readNumber((data as JsonRecord).recovery_time_days),
    } satisfies TreatmentOutcomeRow;
}

async function loadTreatmentOutcomesByEventIds(client: SupabaseClient, eventIds: string[]): Promise<TreatmentOutcomeRow[]> {
    if (eventIds.length === 0) return [];
    const C = TREATMENT_OUTCOMES.COLUMNS;
    const { data, error } = await client
        .from(TREATMENT_OUTCOMES.TABLE)
        .select(`${C.id}, ${C.event_id}, ${C.outcome_status}, ${C.recovery_time_days}`)
        .in(C.event_id, eventIds);
    if (error) {
        throw new Error(`Failed to load treatment outcomes: ${error.message}`);
    }
    return (data ?? []).map((row) => ({
        id: String((row as JsonRecord).id),
        event_id: String((row as JsonRecord).event_id),
        outcome_status: readText((row as JsonRecord).outcome_status) as TreatmentOutcomeStatus,
        recovery_time_days: readNumber((row as JsonRecord).recovery_time_days),
    }));
}

function mapTreatmentCandidateRow(row: JsonRecord): TreatmentCandidateRecord {
    return {
        id: String(row.id),
        disease: readText(row.disease) ?? 'Unknown',
        species_applicability: readStringArray(row.species_applicability),
        treatment_pathway: (readText(row.treatment_pathway) ?? 'supportive_only') as TreatmentPathway,
        treatment_type: (readText(row.treatment_type) ?? 'supportive care') as TreatmentCandidateRecord['treatment_type'],
        intervention_details: {
            drug_classes: readStringArray(asRecord(row.intervention_json).drug_classes),
            procedure_types: readStringArray(asRecord(row.intervention_json).procedure_types),
            supportive_measures: readStringArray(asRecord(row.intervention_json).supportive_measures),
            monitoring: readStringArray(asRecord(row.intervention_json).monitoring),
            reference_range_notes: readStringArray(asRecord(row.intervention_json).reference_range_notes),
        },
        indication_criteria: readStringArray(row.indication_criteria),
        contraindications: readStringArray(row.contraindications),
        detected_contraindications: readStringArray(row.detected_contraindications),
        risk_level: (readText(row.risk_level) ?? 'moderate') as TreatmentCandidateRecord['risk_level'],
        urgency_level: (readText(row.urgency_level) ?? 'routine') as TreatmentCandidateRecord['urgency_level'],
        evidence_level: (readText(row.evidence_level) ?? 'moderate') as TreatmentCandidateRecord['evidence_level'],
        environment_constraints: {
            preferred_setting: (readText(asRecord(row.environment_constraints).preferred_setting) ?? 'any') as TreatmentCandidateRecord['environment_constraints']['preferred_setting'],
            notes: readStringArray(asRecord(row.environment_constraints).notes),
        },
        expected_outcome_range: {
            survival_probability_band: readText(asRecord(row.expected_outcome_json).survival_probability_band) ?? 'variable',
            recovery_expectation: readText(asRecord(row.expected_outcome_json).recovery_expectation) ?? 'Clinician confirmation required.',
        },
        supporting_signals: readStringArray(row.supporting_signals),
        why_relevant: readText(row.rationale) ?? 'Clinician validation required.',
        risks: readStringArray(row.risks),
        regulatory_notes: readStringArray(row.regulatory_notes),
        uncertainty: {
            recommendation_confidence: readNumber(asRecord(row.uncertainty_json).recommendation_confidence) ?? 0.5,
            evidence_gaps: readStringArray(asRecord(row.uncertainty_json).evidence_gaps),
            alternative_diagnoses: readStringArray(asRecord(row.uncertainty_json).alternative_diagnoses),
            weak_evidence: readBoolean(asRecord(row.uncertainty_json).weak_evidence) === true,
            diagnostic_management_required: readBoolean(asRecord(row.uncertainty_json).diagnostic_management_required) === true,
            noise_reasons: readStringArray(asRecord(row.uncertainty_json).noise_reasons),
        },
        clinician_validation_required: readBoolean(row.clinician_validation_required) !== false,
        autonomous_prescribing_blocked: true,
    };
}

function normalizeContext(context: Partial<TreatmentRecommendationContext>): TreatmentRecommendationContext {
    return {
        resource_profile: context.resource_profile === 'low_resource' ? 'low_resource' : 'advanced',
        regulatory_region: readText(context.regulatory_region),
        care_environment: readText(context.care_environment),
        comorbidities: Array.isArray(context.comorbidities) ? context.comorbidities.map(String).filter(Boolean) : [],
        lab_flags: Array.isArray(context.lab_flags) ? context.lab_flags.map(String).filter(Boolean) : [],
    };
}

function readResourceProfile(value: unknown): TreatmentRecommendationContext['resource_profile'] {
    return value === 'low_resource' ? 'low_resource' : 'advanced';
}

function isSuccessfulOutcome(status: TreatmentOutcomeStatus) {
    return status === 'improved' || status === 'resolved';
}

function isComplicatedOutcome(status: TreatmentOutcomeStatus) {
    return status === 'complication' || status === 'deteriorated' || status === 'deceased';
}

function median(values: number[]) {
    if (values.length === 0) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle];
}

function normalizeDiagnosisLabel(value: string | null) {
    return value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? null;
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

function readStringArray(value: unknown) {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
        : [];
}

function asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}
