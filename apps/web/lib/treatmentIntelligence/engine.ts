import {
    extractOntologyObservations,
    getMasterDiseaseOntology,
    normalizeOntologyDiseaseName,
    type DiseaseOntologyEntry,
} from '../ai/diseaseOntology';
import { findConditionByName } from '../inference/condition-registry';
import type {
    InferenceRequest,
    SelectedTreatmentPlan,
    VeterinaryCondition,
} from '../inference/types';
import { getDrugInteractionEngine } from '../drugInteraction/drugInteractionEngine';
import { HEPATIC_DOSE_ADJUSTMENTS } from '../drugInteraction/data/hepaticDoseAdjustments';
import { RENAL_DOSE_ADJUSTMENTS } from '../drugInteraction/data/renalDoseAdjustments';
import { BREED_DRUG_RISKS } from '../drugInteraction/data/breedDrugRisks';
import { selectTreatmentProtocol, type TreatmentContext } from '../treatment/treatment-engine';
import type {
    TreatmentCandidateRecord,
    TreatmentConditionModuleReport,
    TreatmentEnvironmentConstraints,
    TreatmentExpectedOutcomeRange,
    TreatmentInterventionDetails,
    TreatmentPathway,
    TreatmentPerformanceSummary,
    TreatmentRecommendationBundle,
    TreatmentRecommendationContext,
    TreatmentRiskLevel,
    TreatmentType,
    TreatmentUrgencyLevel,
    TreatmentEvidenceLevel,
    TreatmentUncertaintyEnvelope,
} from './types';

type ContraindicationFlag =
    | 'species_mismatch'
    | 'renal_compromise'
    | 'hepatic_compromise'
    | 'bleeding_risk'
    | 'pregnancy'
    | 'shock_or_instability'
    | 'neurologic_instability'
    | 'respiratory_compromise'
    | 'dehydration'
    | 'jurisdiction_review_required';

interface OptionTemplate {
    pathway: TreatmentPathway;
    treatment_type: TreatmentType;
    intervention_details: TreatmentInterventionDetails;
    indication_criteria: string[];
    contraindications: string[];
    contraindication_checks: ContraindicationFlag[];
    risk_level: TreatmentRiskLevel;
    urgency_level: TreatmentUrgencyLevel;
    evidence_level: TreatmentEvidenceLevel;
    environment_constraints: TreatmentEnvironmentConstraints;
    expected_outcome_range: TreatmentExpectedOutcomeRange;
    risks: string[];
    rationale: string;
    regulatory_notes: string[];
}

interface TreatmentPlaybook {
    gold_standard: OptionTemplate;
    resource_constrained: OptionTemplate;
    supportive_only: OptionTemplate;
}

interface BuildBundleInput {
    inferenceEventId: string;
    diagnosisLabel: string;
    diagnosisConfidence: number | null;
    emergencyLevel: string | null;
    severityScore: number | null;
    species: string | null;
    inputSignature: Record<string, unknown>;
    outputPayload: Record<string, unknown>;
    context: TreatmentRecommendationContext;
    observedPerformance?: TreatmentPerformanceSummary[];
}

interface RankedDifferential {
    name: string;
    probability: number | null;
    category: DiseaseOntologyEntry['category'] | null;
}

interface DiagnosticManagementAssessment {
    required: boolean;
    reasons: string[];
    summary: string | null;
    confirmatory_actions: string[];
}

interface ConditionModuleBuildInput {
    disease: DiseaseOntologyEntry;
    input: BuildBundleInput;
    observations: string[];
    rankedDifferentials: RankedDifferential[];
    supportingSignals: string[];
}

interface HypocalcemiaPatientContext {
    species: string | null;
    breed: string | null;
    ageYears: number | null;
    sex: string | null;
    weightKg: number | null;
    bodyConditionScore: number | null;
    region: string | null;
    progression: string | null;
    observations: Set<string>;
    rawNarrative: string;
    totalCalcium: number | null;
    ionizedCalcium: number | null;
    albumin: number | null;
    phosphorus: number | null;
    magnesium: number | null;
    bunCreatinine: string | null;
    pth: number | null;
    calcitriol: number | null;
    lipase: number | null;
    ecgNarrative: string | null;
    bloodGasNarrative: string | null;
    postpartum: boolean;
    lactating: boolean;
    pregnant: boolean;
    intactFemale: boolean;
    smallBreed: boolean;
    obese: boolean;
    acutePresentation: boolean;
    chronicPresentation: boolean;
    hasTetanyPattern: boolean;
}

interface ImhaPatientContext {
    species: string | null;
    breed: string | null;
    ageYears: number | null;
    sex: string | null;
    weightKg: number | null;
    region: string | null;
    observations: Set<string>;
    rawNarrative: string;
    packedCellVolumePercent: number | null;
    spherocytesPresent: boolean;
    coombsPositive: boolean;
    autoagglutinationPositive: boolean;
    salineAgglutinationPositive: boolean;
    regenerativeAnaemia: boolean;
    thrombocytopenia: boolean;
    paleMucousMembranes: boolean;
    tachycardia: boolean;
    weakness: boolean;
    collapse: boolean;
    tickPanelNegative: boolean;
    eastAfricaContext: boolean;
    breedElevated: boolean;
    signalmentElevated: boolean;
}

const CLINICIAN_NOTICE = 'This is a clinical decision-support system. Final decisions require licensed clinician judgment.';

const CONTRAINDICATION_LABELS: Record<ContraindicationFlag, string> = {
    species_mismatch: 'Species applicability mismatch with the current patient.',
    renal_compromise: 'Renal compromise present; avoid nephrotoxic or poorly cleared interventions unless clinician-adjusted.',
    hepatic_compromise: 'Hepatic compromise present; metabolism-sensitive therapies need clinician review.',
    bleeding_risk: 'Bleeding or coagulopathy risk present; invasive procedures and ulcerogenic therapies require caution.',
    pregnancy: 'Pregnancy or reproductive status may alter intervention safety and timing.',
    shock_or_instability: 'Hemodynamic instability present; stabilize before definitive intervention whenever possible.',
    neurologic_instability: 'Significant neurologic deficits present; sedation and certain drug classes require extra review.',
    respiratory_compromise: 'Respiratory compromise present; airway and oxygenation plans take priority.',
    dehydration: 'Volume depletion is present; correct fluid deficits before escalating risky therapies.',
    jurisdiction_review_required: 'Regional or regulatory review is required before finalizing this pathway.',
};

const LOW_RESOURCE_JURISDICTIONS = new Set(['ke', 'kenya', 'ng', 'nigeria', 'ug', 'uganda', 'tz', 'tanzania']);
const CONDITION_MODULE_DISEASE_IDS = new Set([
    'puerperal-hypocalcemia-eclampsia',
    'acute-electrolyte-derangement',
    'acute-pancreatitis',
    'chronic-kidney-disease',
    'acute-kidney-injury',
    'imha',
    'imha_canine',
    'immune-mediated-haemolytic-anaemia',
    'immune_mediated_hemolytic_anemia',
]);
const HYPOCALCEMIA_CONDITION_MODULE_IDS = new Set([
    'puerperal-hypocalcemia-eclampsia',
    'acute-electrolyte-derangement',
    'acute-pancreatitis',
    'chronic-kidney-disease',
    'acute-kidney-injury',
]);

export function buildTreatmentRecommendationBundle(input: BuildBundleInput): TreatmentRecommendationBundle {
    const canonicalDisease = normalizeOntologyDiseaseName(input.diagnosisLabel);
    if (!canonicalDisease) {
        const registryBundle = buildRegistryBackedTreatmentBundle(input);
        if (registryBundle) {
            return registryBundle;
        }
        throw new Error(`Treatment support is only available for diseases in the VetIOS ontology. Received: ${input.diagnosisLabel}`);
    }

    const disease = getMasterDiseaseOntology().find((entry) => entry.name === canonicalDisease);
    if (!disease) {
        throw new Error(`Disease ${canonicalDisease} is not present in the treatment ontology registry.`);
    }

    const observations = extractOntologyObservations(input.inputSignature);
    const contradictionFlags = extractContradictionFlags(input.outputPayload);
    const rankedDifferentials = extractRankedDifferentials(input.outputPayload, canonicalDisease);
    const alternatives = rankedDifferentials
        .map((entry) => entry.name)
        .filter((name) => name !== canonicalDisease)
        .slice(0, 3);
    const supportingSignals = deriveSupportingSignals(disease, observations);
    const contextFlags = deriveContextFlags({
        disease,
        species: input.species,
        observations,
        context: input.context,
        contradictionFlags,
    });
    const diagnosticManagement = assessDiagnosticManagement({
        disease,
        diagnosisConfidence: input.diagnosisConfidence,
        supportingSignals,
        contradictionFlags,
        rankedDifferentials,
        outputPayload: input.outputPayload,
    });
    const playbook = resolveTreatmentPlaybook(disease);
    const regulatoryNotes = buildRegulatoryNotes(input.context.regulatory_region);
    const conditionModule = buildConditionModule({
        disease,
        input,
        observations,
        rankedDifferentials,
        supportingSignals,
    });

    const options = [
        materializeOption(playbook.gold_standard, disease, input, supportingSignals, alternatives, contextFlags, regulatoryNotes, diagnosticManagement),
        materializeOption(playbook.resource_constrained, disease, input, supportingSignals, alternatives, contextFlags, regulatoryNotes, diagnosticManagement),
        materializeOption(playbook.supportive_only, disease, input, supportingSignals, alternatives, contextFlags, regulatoryNotes, diagnosticManagement),
    ].sort((left, right) => rankOption(right, input.context, input.emergencyLevel, input.severityScore) - rankOption(left, input.context, input.emergencyLevel, input.severityScore));

    return {
        inference_event_id: input.inferenceEventId,
        disease: canonicalDisease,
        species: normalizeText(input.species),
        diagnosis_confidence: input.diagnosisConfidence,
        emergency_level: normalizeText(input.emergencyLevel),
        severity_score: input.severityScore,
        evidence_basis: {
            matched_signals: supportingSignals,
            alternative_diagnoses: alternatives,
            contradiction_flags: contradictionFlags,
        },
        context: normalizeTreatmentContext(input.context),
        contraindication_flags: Array.from(new Set(options.flatMap((option) => option.detected_contraindications))),
        options,
        observed_performance: input.observedPerformance ?? [],
        clinician_notice: CLINICIAN_NOTICE,
        uncertainty_summary: buildUncertaintySummary(input.diagnosisConfidence, alternatives, contradictionFlags, options, diagnosticManagement),
        management_mode: diagnosticManagement.required ? 'diagnostic_management' : 'definitive',
        diagnostic_management_summary: diagnosticManagement.summary,
        condition_module: conditionModule ?? undefined,
    };
}

function buildRegistryBackedTreatmentBundle(input: BuildBundleInput): TreatmentRecommendationBundle | null {
    const condition = findConditionByName(input.diagnosisLabel);
    if (!condition) return null;

    const inferredRequest = coerceInferenceRequest(input.inputSignature);
    const plan = readSelectedTreatmentPlan(input.outputPayload, condition)
        ?? selectTreatmentProtocol(condition, inferSeverityClass(condition, inferredRequest), inferredRequest, buildTreatmentContext(input, inferredRequest));

    const contradictionFlags = extractContradictionFlags(input.outputPayload);
    const supportingSignals = extractRegistrySupportingSignals(input.outputPayload, condition);
    const rankedDifferentials = extractRankedDifferentials(input.outputPayload, condition.canonical_name);
    const managementMode: TreatmentRecommendationBundle['management_mode'] =
        input.diagnosisConfidence != null && input.diagnosisConfidence >= 0.85
            ? 'definitive'
            : 'diagnostic_management';
    const regulatoryNotes = buildRegulatoryNotes(input.context.regulatory_region);
    const contextFlags = deriveRegistryContextFlags(input, inferredRequest);
    const options = buildRegistryCandidateOptions({
        condition,
        plan,
        diagnosisConfidence: input.diagnosisConfidence,
        contradictionFlags,
        regulatoryNotes,
        managementMode,
        input,
        contextFlags,
    });
    const conditionModule = buildRegistryConditionModule({
        condition,
        input,
        observations: extractOntologyObservations(input.inputSignature),
        rankedDifferentials,
        supportingSignals,
    });

    return {
        inference_event_id: input.inferenceEventId,
        disease: condition.canonical_name,
        species: normalizeText(input.species),
        diagnosis_confidence: input.diagnosisConfidence,
        emergency_level: normalizeText(input.emergencyLevel),
        severity_score: input.severityScore,
        evidence_basis: {
            matched_signals: supportingSignals,
            alternative_diagnoses: rankedDifferentials
                .map((entry) => entry.name)
                .filter((name) => name !== condition.canonical_name)
                .slice(0, 3),
            contradiction_flags: contradictionFlags,
        },
        context: normalizeTreatmentContext(input.context),
        contraindication_flags: options.flatMap((option) => option.detected_contraindications),
        options,
        observed_performance: input.observedPerformance ?? [],
        clinician_notice: CLINICIAN_NOTICE,
        uncertainty_summary: managementMode === 'diagnostic_management'
            ? 'Diagnosis remains provisional; prioritise confirmatory staging while using supportive and preparation pathways.'
            : 'Registry-backed treatment pathway generated from the structured disease-specific protocol set.',
        management_mode: managementMode,
        diagnostic_management_summary: managementMode === 'diagnostic_management'
            ? 'Use stabilization and confirmatory staging before escalating to definitive disease-directed treatment.'
            : null,
        condition_module: conditionModule ?? undefined,
    };
}

function buildRegistryConditionModule(input: {
    condition: VeterinaryCondition;
    input: BuildBundleInput;
    observations: string[];
    rankedDifferentials: RankedDifferential[];
    supportingSignals: string[];
}): TreatmentConditionModuleReport | null {
    if (!isImhaConditionId(input.condition.id)) return null;
    const moduleInput: ConditionModuleBuildInput = {
        disease: {
            id: input.condition.id,
            name: input.condition.canonical_name,
            aliases: input.condition.aliases,
            category: 'Endocrine',
            subcategory: 'Immune-mediated haemolysis',
            condition_class: 'Autoimmune / Immune-Mediated',
            key_clinical_features: [],
            supporting_features: [],
            exclusion_features: [],
            lab_signatures: [],
            progression_pattern: ['acute'],
            species_relevance: ['dog'],
            zoonotic: false,
        },
        input: input.input,
        observations: input.observations,
        rankedDifferentials: input.rankedDifferentials,
        supportingSignals: input.supportingSignals,
    };
    const patient = extractImhaPatientContext(moduleInput);
    return shouldBuildImhaModule(moduleInput.disease, patient, input.rankedDifferentials, input.supportingSignals)
        ? buildImhaConditionModule(moduleInput, patient)
        : null;
}

function coerceInferenceRequest(inputSignature: Record<string, unknown>): InferenceRequest {
    const metadata = typeof inputSignature.metadata === 'object' && inputSignature.metadata != null
        ? inputSignature.metadata as Record<string, unknown>
        : {};
    return {
        species: typeof inputSignature.species === 'string' ? inputSignature.species : typeof metadata.species === 'string' ? metadata.species : 'canine',
        breed: typeof inputSignature.breed === 'string' ? inputSignature.breed : typeof metadata.breed === 'string' ? metadata.breed : undefined,
        age_years: typeof inputSignature.age_years === 'number' ? inputSignature.age_years : undefined,
        weight_kg: typeof inputSignature.weight_kg === 'number' ? inputSignature.weight_kg : typeof metadata.weight_kg === 'number' ? metadata.weight_kg : undefined,
        sex: typeof inputSignature.sex === 'string' ? inputSignature.sex : undefined,
        region: typeof inputSignature.region === 'string' ? inputSignature.region : undefined,
        presenting_signs: Array.isArray(inputSignature.presenting_signs)
            ? inputSignature.presenting_signs.filter((entry): entry is string => typeof entry === 'string')
            : Array.isArray(inputSignature.symptoms)
                ? inputSignature.symptoms.filter((entry): entry is string => typeof entry === 'string')
                : [],
        history: typeof inputSignature.history === 'object' && inputSignature.history != null ? inputSignature.history as InferenceRequest['history'] : undefined,
        preventive_history: typeof inputSignature.preventive_history === 'object' && inputSignature.preventive_history != null ? inputSignature.preventive_history as InferenceRequest['preventive_history'] : undefined,
        diagnostic_tests: typeof inputSignature.diagnostic_tests === 'object' && inputSignature.diagnostic_tests != null ? inputSignature.diagnostic_tests as InferenceRequest['diagnostic_tests'] : undefined,
        physical_exam: typeof inputSignature.physical_exam === 'object' && inputSignature.physical_exam != null ? inputSignature.physical_exam as InferenceRequest['physical_exam'] : undefined,
    };
}

function buildTreatmentContext(input: BuildBundleInput, request: InferenceRequest): TreatmentContext {
    return {
        geographic_region: input.context.regulatory_region ?? request.region ?? request.history?.geographic_region ?? 'US',
        resource_level: input.context.resource_profile === 'advanced' ? 'referral' : 'primary',
        concurrent_conditions: extractRankedDifferentials(input.outputPayload, input.diagnosisLabel)
            .map((entry) => entry.name)
            .filter((name) => name !== input.diagnosisLabel)
            .slice(0, 3),
        patient_signalment: {
            age_category: request.age_years != null && request.age_years < 1 ? 'puppy' : request.age_years != null && request.age_years >= 9 ? 'senior' : 'adult',
            reproductive_status: typeof request.sex === 'string' && request.sex.includes('intact')
                ? request.sex.includes('female') ? 'intact_female' : 'intact_male'
                : 'neutered',
            weight_kg: request.weight_kg ?? 20,
        },
    };
}

function inferSeverityClass(condition: VeterinaryCondition, request: InferenceRequest): string | null {
    if (condition.id !== 'dirofilariosis_canine') return null;
    const signs = new Set(request.presenting_signs.map((entry) => entry.toLowerCase()));
    if (signs.has('collapse') || signs.has('caval_syndrome')) return 'IV';
    if (signs.has('syncope') || signs.has('ascites') || signs.has('hemoptysis')) return 'III';
    if (signs.has('exercise_intolerance') || signs.has('chronic_cough') || signs.has('dyspnea')) return 'II';
    return 'I';
}

function readSelectedTreatmentPlan(outputPayload: Record<string, unknown>, condition: VeterinaryCondition): SelectedTreatmentPlan | null {
    const treatmentPlans = typeof outputPayload.treatment_plans === 'object' && outputPayload.treatment_plans != null
        ? outputPayload.treatment_plans as Record<string, unknown>
        : null;
    if (!treatmentPlans) return null;
    const plan = treatmentPlans[condition.id];
    return plan && typeof plan === 'object' ? plan as SelectedTreatmentPlan : null;
}

function extractRegistrySupportingSignals(outputPayload: Record<string, unknown>, condition: VeterinaryCondition): string[] {
    const diagnosis = typeof outputPayload.diagnosis === 'object' && outputPayload.diagnosis != null
        ? outputPayload.diagnosis as Record<string, unknown>
        : {};
    const differentials = Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
    const matching = differentials.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as Record<string, unknown>;
        return candidate.condition_id === condition.id
            || candidate.condition === condition.canonical_name
            || candidate.name === condition.canonical_name;
    }) as Record<string, unknown> | undefined;

    const evidence = Array.isArray(matching?.supporting_evidence) ? matching.supporting_evidence : [];
    return evidence
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            return typeof (entry as Record<string, unknown>).finding === 'string'
                ? String((entry as Record<string, unknown>).finding)
                : null;
        })
        .filter((value): value is string => value != null);
}

function buildRegistryCandidateOptions(input: {
    condition: VeterinaryCondition;
    plan: SelectedTreatmentPlan;
    diagnosisConfidence: number | null;
    contradictionFlags: string[];
    regulatoryNotes: string[];
    managementMode: TreatmentRecommendationBundle['management_mode'];
    input: BuildBundleInput;
    contextFlags: Set<ContraindicationFlag>;
}): TreatmentCandidateRecord[] {
    const gold = createRegistryOption({
        condition: input.condition,
        plan: input.plan,
        pathway: 'gold_standard',
        diagnosisConfidence: input.diagnosisConfidence,
        contradictionFlags: input.contradictionFlags,
        regulatoryNotes: input.regulatoryNotes,
        managementMode: input.managementMode,
        input: input.input,
        contextFlags: input.contextFlags,
        includePhases: input.plan.treatment_phases.map((phase) => phase.phase),
        preferredSetting: 'advanced',
        evidenceLevel: 'high',
    });

    const resource = createRegistryOption({
        condition: input.condition,
        plan: input.plan,
        pathway: 'resource_constrained',
        diagnosisConfidence: input.diagnosisConfidence,
        contradictionFlags: input.contradictionFlags,
        regulatoryNotes: input.regulatoryNotes,
        managementMode: input.managementMode,
        input: input.input,
        contextFlags: input.contextFlags,
        includePhases: input.plan.treatment_phases
            .filter((phase) => phase.phase !== 'palliative')
            .map((phase) => phase.phase),
        preferredSetting: 'low_resource',
        evidenceLevel: 'moderate',
    });

    const supportive = createRegistryOption({
        condition: input.condition,
        plan: input.plan,
        pathway: 'supportive_only',
        diagnosisConfidence: input.diagnosisConfidence,
        contradictionFlags: input.contradictionFlags,
        regulatoryNotes: input.regulatoryNotes,
        managementMode: 'diagnostic_management',
        input: input.input,
        contextFlags: input.contextFlags,
        includePhases: input.plan.treatment_phases
            .filter((phase) => ['acute_stabilisation', 'pre_treatment_preparation', 'adjunctive', 'long_term_management', 'secondary_prevention'].includes(phase.phase))
            .map((phase) => phase.phase),
        preferredSetting: 'any',
        evidenceLevel: 'moderate',
    });

    return [gold, resource, supportive];
}

function createRegistryOption(input: {
    condition: VeterinaryCondition;
    plan: SelectedTreatmentPlan;
    pathway: TreatmentPathway;
    diagnosisConfidence: number | null;
    contradictionFlags: string[];
    regulatoryNotes: string[];
    managementMode: TreatmentRecommendationBundle['management_mode'];
    input: BuildBundleInput;
    contextFlags: Set<ContraindicationFlag>;
    includePhases: string[];
    preferredSetting: TreatmentEnvironmentConstraints['preferred_setting'];
    evidenceLevel: TreatmentEvidenceLevel;
}): TreatmentCandidateRecord {
    const includedPhases = input.plan.treatment_phases.filter((phase) => input.includePhases.includes(phase.phase));
    const protocols = includedPhases.flatMap((phase) => phase.protocols);
    const interventionDetails: TreatmentInterventionDetails = {
        drug_classes: protocols
            .filter((protocol) => protocol.category.startsWith('pharmacological'))
            .map((protocol) => protocol.patient_specific_dose ? `${protocol.protocol_name}: ${protocol.patient_specific_dose}` : protocol.protocol_name),
        procedure_types: protocols
            .filter((protocol) => protocol.category === 'surgical' || protocol.category === 'interventional_procedure')
            .map((protocol) => protocol.protocol_name),
        supportive_measures: [
            ...includedPhases.map((phase) => `${phase.phase_label}: ${phase.phase_notes}`),
            ...input.plan.owner_instructions.slice(0, 4),
        ],
        monitoring: input.plan.monitoring_schedule.flatMap((entry) => [`${entry.timepoint}: ${entry.tests_required.join(', ')}`, `${entry.timepoint}: ${entry.clinical_parameters.join(', ')}`]),
        reference_range_notes: [input.plan.regional_availability_notes],
    };

    const whyRelevant = input.pathway === 'gold_standard'
        ? `Full disease-specific protocol for ${input.condition.canonical_name}, sequenced across stabilisation, preparation, definitive therapy, and monitoring.`
        : input.pathway === 'resource_constrained'
            ? `Resource-aware pathway for ${input.condition.canonical_name} that preserves essential disease-directed care while accounting for availability constraints.`
            : `Supportive and preparation pathway for ${input.condition.canonical_name} when definitive treatment must be delayed pending staging, stabilization, or sourcing.`;
    const detectedContraindications = [
        ...input.plan.contraindicated_treatments.map((entry) => `${entry.treatment}: ${entry.reason}`),
        ...buildDrugLevelContraindications({
            proposedDrugClasses: interventionDetails.drug_classes,
            species: input.input.species,
            breed: normalizeText(input.input.inputSignature.breed),
            conditions: [input.condition.canonical_name],
            contextFlags: input.contextFlags,
        }),
    ];

    return {
        id: '',
        disease: input.condition.canonical_name,
        species_applicability: input.condition.species_affected,
        treatment_pathway: input.pathway,
        treatment_type: protocols.some((protocol) => protocol.category === 'surgical' || protocol.category === 'interventional_procedure')
            ? 'surgical'
            : protocols.some((protocol) => protocol.category.startsWith('pharmacological'))
                ? 'medical'
                : 'supportive care',
        intervention_details: interventionDetails,
        indication_criteria: [
            `Primary diagnosis: ${input.condition.canonical_name}`,
            ...(input.plan.severity_class ? [`Severity class: ${input.plan.severity_class}`] : []),
        ],
        contraindications: input.plan.contraindicated_treatments.map((entry) => `${entry.treatment}: ${entry.reason}`),
        detected_contraindications: Array.from(new Set(detectedContraindications)),
        risk_level: input.plan.severity_class === 'IV' ? 'critical' : input.plan.severity_class === 'III' ? 'high' : 'moderate',
        urgency_level: input.plan.severity_class === 'IV' ? 'emergent' : 'urgent',
        evidence_level: input.evidenceLevel,
        environment_constraints: {
            preferred_setting: input.preferredSetting,
            notes: [input.plan.regional_availability_notes],
        },
        expected_outcome_range: {
            survival_probability_band: input.plan.total_estimated_cost_range ?? 'Guideline-dependent',
            recovery_expectation: input.plan.prognosis,
        },
        supporting_signals: extractUniqueLines([
            ...protocols.map((protocol) => protocol.evidence_summary),
            ...input.contradictionFlags.map((flag) => `Contradiction note: ${flag}`),
        ]),
        why_relevant: whyRelevant,
        risks: extractUniqueLines([
            ...protocols.flatMap((protocol) => protocol.cautions_for_this_patient),
            ...protocols.flatMap((protocol) => protocol.drug_interactions_in_plan),
        ]),
        regulatory_notes: [...input.regulatoryNotes],
        uncertainty: {
            recommendation_confidence: Math.max(0.2, Math.min(0.95, input.diagnosisConfidence ?? 0.6)),
            evidence_gaps: input.managementMode === 'diagnostic_management'
                ? ['Confirmatory staging or disease-severity confirmation is still required before irreversible treatment decisions.']
                : [],
            alternative_diagnoses: [],
            weak_evidence: input.evidenceLevel === 'moderate' || input.evidenceLevel === 'low',
            diagnostic_management_required: input.managementMode === 'diagnostic_management',
            noise_reasons: input.managementMode === 'diagnostic_management'
                ? ['Clinician review and staging remain necessary before definitive treatment execution.']
                : ['Clinician validation remains mandatory before applying any recommended protocol.'],
        },
        clinician_validation_required: true,
        autonomous_prescribing_blocked: true,
    };
}

function extractUniqueLines(lines: string[]): string[] {
    return [...new Set(lines.map((line) => line.trim()).filter((line) => line.length > 0))];
}

export function validateTreatmentBundle(bundle: TreatmentRecommendationBundle) {
    if (bundle.options.length < 3) {
        throw new Error('Treatment bundle must expose at least three pathways.');
    }
    if (!bundle.options.some((option) => option.treatment_pathway === 'gold_standard')) {
        throw new Error('Treatment bundle is missing a gold-standard pathway.');
    }
    if (!bundle.options.some((option) => option.treatment_pathway === 'resource_constrained')) {
        throw new Error('Treatment bundle is missing a resource-constrained pathway.');
    }
    if (!bundle.options.some((option) => option.treatment_pathway === 'supportive_only')) {
        throw new Error('Treatment bundle is missing a supportive-only pathway.');
    }
    if (bundle.options.some((option) => !option.autonomous_prescribing_blocked || !option.clinician_validation_required)) {
        throw new Error('Treatment bundle must always require clinician validation and block autonomous prescribing.');
    }
}

function materializeOption(
    template: OptionTemplate,
    disease: DiseaseOntologyEntry,
    input: BuildBundleInput,
    supportingSignals: string[],
    alternatives: string[],
    contextFlags: Set<ContraindicationFlag>,
    regulatoryNotes: string[],
    diagnosticManagement: DiagnosticManagementAssessment,
): TreatmentCandidateRecord {
    const speciesNormalized = normalizeSpecies(input.species);
    const detectedContraindications = new Set<string>();

    if (speciesNormalized && !disease.species_relevance.includes(speciesNormalized)) {
        detectedContraindications.add(CONTRAINDICATION_LABELS.species_mismatch);
    }

    for (const check of template.contraindication_checks) {
        if (contextFlags.has(check)) {
            detectedContraindications.add(CONTRAINDICATION_LABELS[check]);
        }
    }

    const drugLevelContraindications = buildDrugLevelContraindications({
        proposedDrugClasses: template.intervention_details.drug_classes,
        species: input.species,
        breed: normalizeText(input.inputSignature.breed),
        conditions: [disease.name, ...alternatives.slice(0, 2)],
        contextFlags,
    });
    for (const contraindication of drugLevelContraindications) {
        detectedContraindications.add(contraindication);
    }

    const uncertainty = buildUncertaintyEnvelope(
        input.diagnosisConfidence,
        alternatives,
        template.evidence_level,
        detectedContraindications.size,
        diagnosticManagement,
    );

    const baseOption: TreatmentCandidateRecord = {
        id: '',
        disease: disease.name,
        species_applicability: disease.species_relevance,
        treatment_pathway: template.pathway,
        treatment_type: template.treatment_type,
        intervention_details: template.intervention_details,
        indication_criteria: template.indication_criteria,
        contraindications: template.contraindications,
        detected_contraindications: Array.from(detectedContraindications),
        risk_level: template.risk_level,
        urgency_level: template.urgency_level,
        evidence_level: template.evidence_level,
        environment_constraints: template.environment_constraints,
        expected_outcome_range: template.expected_outcome_range,
        supporting_signals: supportingSignals,
        why_relevant: template.rationale,
        risks: template.risks,
        regulatory_notes: [...template.regulatory_notes, ...regulatoryNotes],
        uncertainty,
        clinician_validation_required: true,
        autonomous_prescribing_blocked: true,
    };

    return diagnosticManagement.required
        ? applyDiagnosticManagementOverlay(baseOption, disease, diagnosticManagement)
        : baseOption;
}

function resolveTreatmentPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    switch (disease.id) {
        case 'rabies':
            return buildRabiesPlaybook(disease);
        case 'gdv':
            return buildGdvPlaybook(disease);
        case 'septic-peritonitis':
            return buildPeritonitisPlaybook(disease);
        case 'pyometra':
            return buildPyometraPlaybook(disease);
        case 'dystocia':
            return buildDystociaPlaybook(disease);
        case 'organophosphate-toxicity':
        case 'carbamate-toxicity':
            return buildCholinergicToxicityPlaybook(disease);
        case 'anticoagulant-rodenticide-toxicity':
            return buildRodenticidePlaybook(disease);
        case 'diabetes-mellitus':
            return buildDiabetesPlaybook(disease);
        case 'imha':
        case 'immune-mediated-haemolytic-anaemia':
            return buildImhaPlaybook(disease);
        case 'imtp':
        case 'immune-mediated-thrombocytopenia':
            return buildImtpPlaybook(disease);
        case 'addisons':
        case 'hypoadrenocorticism':
            return buildAddisonsPlaybook(disease);
        case 'hypothyroidism':
            return buildHypothyroidismPlaybook(disease);
        case 'hyperthyroidism-feline':
        case 'feline-hyperthyroidism':
            return buildFelineHyperthyroidismPlaybook(disease);
        case 'diabetic-ketoacidosis':
        case 'dka':
            return buildDkaPlaybook(disease);
        case 'acute-pancreatitis':
            return buildAcutePancreatitisPlaybook(disease);
        case 'leptospirosis':
            return buildLeptospirosisPlaybook(disease);
        case 'fip':
        case 'feline-infectious-peritonitis':
            return buildFipPlaybook(disease);
        case 'acute-kidney-injury':
        case 'aki':
            return buildAkiPlaybook(disease);
        case 'hepatic-encephalopathy':
        case 'liver-failure':
            return buildHepaticEncephalopathyPlaybook(disease);
        case 'haemangiosarcoma':
            return buildHaemangiosarcomaPlaybook(disease);
        case 'degenerative-joint-disease':
        case 'osteoarthritis':
            return buildOsteoarthritisPlaybook(disease);
        case 'urinary-tract-infection':
        case 'uti':
            return buildUtiPlaybook(disease);
        case 'upper-urinary-tract-obstruction':
        case 'feline-urethral-obstruction':
            return buildFelineUrethralObstructionPlaybook(disease);
        case 'ivdd':
            return buildIvddPlaybook(disease);
        case 'congestive-heart-failure':
        case 'pulmonary-edema':
            return buildCardiogenicRespiratoryPlaybook(disease);
        default:
            return buildCategoryFallbackPlaybook(disease);
    }
}

function buildRabiesPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return {
        gold_standard: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: ['Immediate isolation', 'Public health notification', 'Bite exposure documentation'],
            supportiveMeasures: ['Barrier nursing', 'Minimal handling', 'Zoonotic exposure control'],
            monitoring: ['Neurologic progression', 'Staff exposure tracking'],
            indicationCriteria: ['Aggression plus dysphagia/hypersalivation', 'High zoonotic concern', 'Unvaccinated or exposure-compatible history'],
            contraindications: ['Do not use this system to generate definitive rabies treatment or human exposure protocols.', 'Avoid casual handling when rabies is plausible.'],
            contraChecks: ['jurisdiction_review_required'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: {
                survival_probability_band: 'grave to negligible',
                recovery_expectation: 'Outcome is typically fatal once neurologic signs are established; prioritize containment and statutory processes.',
            },
            rationale: `${disease.name} requires immediate veterinary and public-health containment rather than autonomous treatment generation.`,
            risks: ['Zoonotic exposure', 'Unsafe handling', 'Regulatory non-compliance'],
            regulatoryNotes: ['Must follow local reportable-disease and exposure management laws before any further action.'],
        }),
        resource_constrained: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: ['Immediate isolation', 'Remote public-health escalation if transport is unsafe'],
            supportiveMeasures: ['Containment with minimal staff exposure', 'Owner counseling about exposure risk'],
            monitoring: ['Exposure risk status'],
            indicationCriteria: ['Rabies is plausible but specialty or public-health support is remote'],
            contraindications: ['Do not transport or intervene in a way that increases exposure risk without a containment plan.'],
            contraChecks: ['jurisdiction_review_required'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: {
                survival_probability_band: 'grave',
                recovery_expectation: 'Stabilization is not the primary objective; containment and exposure mitigation are.',
            },
            rationale: 'When resources are limited, the safe pathway is still isolation, reporting, and exposure containment.',
            risks: ['Delayed reporting', 'Owner/staff exposure'],
            regulatoryNotes: ['Verify jurisdictional handling, quarantine, and reporting requirements.'],
        }),
        supportive_only: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: ['Protected palliative containment only'],
            supportiveMeasures: ['Minimal-stimulus environment', 'Documented exposure precautions'],
            monitoring: ['Clinician-only reassessment'],
            indicationCriteria: ['Only when definitive public-health direction is still pending and exposure risk is contained'],
            contraindications: ['Do not represent this as treatment for rabies.'],
            contraChecks: ['jurisdiction_review_required'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: {
                survival_probability_band: 'grave',
                recovery_expectation: 'Supportive-only care does not change the expected poor prognosis.',
            },
            rationale: 'Supportive-only care is a holding pattern while clinician and regulatory decisions are finalized.',
            risks: ['False reassurance', 'Exposure risk if precautions fail'],
            regulatoryNotes: ['A licensed veterinarian must validate any palliative decision.'],
        }),
    };
}

function buildGdvPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'surgical',
            drugClasses: ['Shock stabilization fluid and analgesia classes', 'Perioperative antiarrhythmic review if indicated'],
            procedures: ['Immediate gastric decompression', 'Surgical derotation and gastropexy'],
            supportiveMeasures: ['ECG monitoring', 'Perfusion support', 'Post-operative gastric and perfusion monitoring'],
            monitoring: ['Perfusion indices', 'Arrhythmias', 'Lactate or equivalent perfusion trend'],
            indicationCriteria: ['Classic GDV pattern with distension, unproductive retching, and acute deterioration'],
            contraindications: ['Do not delay decompression or transfer in a hemodynamically unstable patient.'],
            contraChecks: ['shock_or_instability', 'respiratory_compromise'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: {
                survival_probability_band: 'fair to good if rapid',
                recovery_expectation: 'Outcome improves when decompression and definitive surgery occur early.',
            },
            rationale: `${disease.name} requires immediate stabilization plus definitive surgery; this is a pathway suggestion, not an autonomous order set.`,
            risks: ['Shock', 'Gastric necrosis', 'Arrhythmia', 'Delay-sensitive mortality'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'supportive care',
            drugClasses: ['Shock stabilization and analgesia classes'],
            procedures: ['Emergency decompression if clinician-capable', 'Immediate referral or transfer activation'],
            supportiveMeasures: ['Perfusion support', 'Continuous reassessment'],
            monitoring: ['Perfusion decline', 'Abdominal expansion', 'Transfer readiness'],
            indicationCriteria: ['Suspected GDV in a clinic without immediate surgery'],
            contraindications: ['Do not frame decompression as definitive care if surgery remains unavailable.'],
            contraChecks: ['shock_or_instability', 'respiratory_compromise'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'low_resource',
            expectedOutcome: {
                survival_probability_band: 'guarded',
                recovery_expectation: 'Resource-limited care is a bridge to definitive surgery, not a substitute for it.',
            },
            rationale: 'When surgery is unavailable, the safe pathway is decompression, stabilization, and immediate referral escalation.',
            risks: ['Incomplete decompression', 'Transfer delay'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: [],
            supportiveMeasures: ['Rapid triage', 'Oxygen if needed', 'Transfer coordination'],
            monitoring: ['Clinical decline minute-to-minute'],
            indicationCriteria: ['Temporary holding pattern while clinician confirms immediate decompression or transfer plan'],
            contraindications: ['Supportive care alone is unsafe as a definitive GDV pathway.'],
            contraChecks: ['shock_or_instability', 'respiratory_compromise'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: {
                survival_probability_band: 'poor if prolonged',
                recovery_expectation: 'Only acceptable as a brief bridge to definitive intervention.',
            },
            rationale: 'This option exists to prevent false certainty; it is a temporary stabilization path only.',
            risks: ['Rapid death if definitive care is delayed'],
            regulatoryNotes: [],
        }),
    });
}

function buildPeritonitisPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'surgical',
            drugClasses: ['Broad clinician-selected antimicrobial classes', 'Analgesia and perfusion support classes'],
            procedures: ['Source control surgery', 'Abdominal lavage or drainage review'],
            supportiveMeasures: ['Sepsis resuscitation', 'Perfusion monitoring', 'Post-operative intensive care'],
            monitoring: ['Perfusion, lactate equivalents, abdominal effusion recurrence'],
            indicationCriteria: ['Septic or leakage-associated abdomen is suspected or confirmed'],
            contraindications: ['Do not delay source control when septic abdomen is likely.'],
            contraChecks: ['shock_or_instability', 'bleeding_risk'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: {
                survival_probability_band: 'guarded to fair',
                recovery_expectation: 'Source control and early resuscitation strongly influence survival.',
            },
            rationale: `${disease.name} needs source control plus aggressive supportive care, not a single medication suggestion.`,
            risks: ['Septic shock', 'Dehiscence', 'Rapid death'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'supportive care',
            drugClasses: ['Broad clinician-reviewed antimicrobial classes'],
            procedures: ['Stabilization and referral if surgery unavailable'],
            supportiveMeasures: ['Shock support', 'Pain control', 'Serial abdominal assessment'],
            monitoring: ['Perfusion decline'],
            indicationCriteria: ['Septic abdomen suspected in a lower-resource setting'],
            contraindications: ['Resource-limited management does not replace source control.'],
            contraChecks: ['shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: {
                survival_probability_band: 'guarded to poor',
                recovery_expectation: 'Outcome depends on how fast definitive source control becomes available.',
            },
            rationale: 'The safe lower-resource plan is aggressive stabilization plus referral, not false certainty.',
            risks: ['Persistent sepsis'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: [],
            supportiveMeasures: ['Immediate perfusion support and escalation'],
            monitoring: ['Clinical decline'],
            indicationCriteria: ['Very brief bridge only'],
            contraindications: ['Supportive-only care is not a definitive peritonitis plan.'],
            contraChecks: ['shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: {
                survival_probability_band: 'poor',
                recovery_expectation: 'Temporary only while definitive clinician action is arranged.',
            },
            rationale: 'The system should never imply that septic abdomen can be solved with passive supportive care alone.',
            risks: ['Septic death'],
            regulatoryNotes: [],
        }),
    });
}

function buildPyometraPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'surgical',
            drugClasses: ['Perioperative antimicrobial and analgesia classes'],
            procedures: ['Ovariohysterectomy after stabilization'],
            supportiveMeasures: ['Sepsis screening', 'Fluid support', 'Temperature and perfusion monitoring'],
            monitoring: ['Perfusion', 'Uterine rupture concern', 'Post-operative recovery'],
            indicationCriteria: ['Intact female with compatible discharge or systemic illness suspicious for pyometra'],
            contraindications: ['Do not delay source control in a systemically ill patient.'],
            contraChecks: ['shock_or_instability', 'bleeding_risk'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: {
                survival_probability_band: 'good to guarded depending on sepsis burden',
                recovery_expectation: 'Early stabilization plus surgery is the safest definitive pathway in most cases.',
            },
            rationale: `${disease.name} is usually a source-control disease, and this layer should surface that without auto-ordering surgery.`,
            risks: ['Sepsis', 'Uterine rupture'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'supportive care',
            drugClasses: ['Broad clinician-reviewed antimicrobial classes'],
            procedures: ['Stabilization and urgent referral for surgery'],
            supportiveMeasures: ['Perfusion support', 'Sepsis monitoring'],
            monitoring: ['Clinical decline', 'Abdominal pain or rupture signs'],
            indicationCriteria: ['Pyometra suspected but definitive surgery is not immediately available'],
            contraindications: ['Medical-only management is not the safest default for most unstable pyometra cases.'],
            contraChecks: ['shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: {
                survival_probability_band: 'guarded',
                recovery_expectation: 'Lower-resource care is a bridge, not definitive source control.',
            },
            rationale: 'The system should encourage stabilization and referral rather than imply medical therapy is always adequate.',
            risks: ['Rupture', 'Persistent sepsis'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: [],
            supportiveMeasures: ['Immediate reassessment and escalation only'],
            monitoring: ['Perfusion and mentation'],
            indicationCriteria: ['Brief holding path while clinician confirms referral or surgery'],
            contraindications: ['Supportive-only care is not definitive pyometra treatment.'],
            contraChecks: ['shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: {
                survival_probability_band: 'poor if prolonged',
                recovery_expectation: 'Temporary only.',
            },
            rationale: 'This option exists to prevent the UI from ever sounding autonomous in a source-control emergency.',
            risks: ['Septic deterioration'],
            regulatoryNotes: [],
        }),
    });
}

function buildDystociaPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'surgical',
            drugClasses: ['Analgesia, anesthetic, and uterotonic review only after clinician confirmation'],
            procedures: ['Obstetric assessment with assisted delivery or cesarean as indicated'],
            supportiveMeasures: ['Maternal perfusion support', 'Neonate triage preparation'],
            monitoring: ['Maternal fatigue, fetal viability, obstructive progression'],
            indicationCriteria: ['Pregnancy with labor not progressing or obstructive signs'],
            contraindications: ['Do not let the system decide between medical induction and cesarean without a clinician examination.'],
            contraChecks: ['pregnancy', 'shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: {
                survival_probability_band: 'fair to good with timely intervention',
                recovery_expectation: 'Maternal and neonatal outcome are highly timing-dependent.',
            },
            rationale: `${disease.name} pathways must stay framed as clinician-reviewed obstetric options, not automatic directives.`,
            risks: ['Fetal loss', 'Maternal exhaustion', 'Obstructive rupture'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'supportive care',
            drugClasses: ['Clinician-reviewed uterotonic discussion only if obstruction has been excluded'],
            procedures: ['Referral or field obstetric stabilization'],
            supportiveMeasures: ['Maternal stabilization', 'Neonate readiness'],
            monitoring: ['Exhaustion, continued obstructive straining'],
            indicationCriteria: ['Dystocia suspected where surgical access is delayed'],
            contraindications: ['Do not use medication-first assumptions if obstruction is still possible.'],
            contraChecks: ['pregnancy', 'shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: {
                survival_probability_band: 'guarded',
                recovery_expectation: 'Outcome depends on whether obstructive causes are recognized quickly and escalated.',
            },
            rationale: 'The safe lower-resource path emphasizes examination and referral rather than casual induction advice.',
            risks: ['Fetal or maternal loss'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: [],
            supportiveMeasures: ['Immediate reassessment and escalation'],
            monitoring: ['Progression of labor arrest'],
            indicationCriteria: ['Very short bridge only'],
            contraindications: ['Supportive-only care is not acceptable as a definitive dystocia plan.'],
            contraChecks: ['pregnancy'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: {
                survival_probability_band: 'poor if prolonged',
                recovery_expectation: 'Temporary only while definitive clinician action is arranged.',
            },
            rationale: 'This pathway deliberately avoids autonomous obstetric decision-making.',
            risks: ['Maternal and fetal deterioration'],
            regulatoryNotes: [],
        }),
    });
}

function buildCholinergicToxicityPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildToxicologyPlaybook(disease, {
        rationale: 'The definitive pathway frames antidote, decontamination, and airway support as clinician-validated actions.',
        targetedDetails: ['Appropriate antidotal class review', 'Decontamination only when airway is protected and timing is appropriate'],
    });
}

function buildRodenticidePlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildToxicologyPlaybook(disease, {
        rationale: 'The key decision-support job is reversal timing, bleeding assessment, and safe escalation.',
        targetedDetails: ['Reversal or antidotal class review', 'Blood product support review when indicated', 'Coagulation-guided intervention planning'],
    });
}

function buildDiabetesPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Veterinary insulin classes', 'DKA-directed electrolyte and fluid support classes when indicated'],
        procedures: ['Glucose and ketone staging', 'Dietary plan review'],
        supportiveMeasures: ['Hydration correction', 'Home-monitoring education'],
        diseaseRisk: 'high',
        goldOutcome: {
            survival_probability_band: 'fair to good',
            recovery_expectation: 'Stabilization is usually good with clinician-led insulin initiation and monitoring.',
        },
        rationale: 'The gold-standard pathway is insulin-based and monitoring-heavy, but still not an autonomous prescription.',
        risks: ['Hypoglycemia', 'DKA progression'],
    });
}

function buildHypoadrenoPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Mineralocorticoid and glucocorticoid replacement classes', 'Crisis fluid and electrolyte stabilization classes'],
        procedures: ['ACTH-based confirmation review when the patient is stable enough'],
        supportiveMeasures: ['Electrolyte correction', 'Perfusion support'],
        diseaseRisk: 'critical',
        goldOutcome: {
            survival_probability_band: 'fair to good with rapid stabilization',
            recovery_expectation: 'Crisis response is often favorable if recognized quickly and maintenance therapy is clinician-managed.',
        },
        rationale: 'This pathway prioritizes crisis stabilization and hormone replacement under clinician supervision.',
        risks: ['Shock', 'Electrolyte collapse'],
        urgent: 'emergent',
    });
}

function buildImhaPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'medical',
            drugClasses: [
                'Glucocorticoid class at immunosuppressive dose',
                'Thromboembolism prophylaxis class after species, renal status, and bleeding-risk review',
                'Blood product support class if PCV meets transfusion threshold',
                'Second-line immunosuppressant class consideration if no response by day 14',
            ],
            procedures: [
                'Packed cell volume assessment and transfusion-threshold evaluation',
                'Cross-matching and blood type confirmation before any transfusion',
                'Splenectomy evaluation if refractory to medical management at the appropriate interval',
            ],
            supportiveMeasures: [
                'Avoid stress and unnecessary physical activity during haemolytic crisis',
                'Nutritional support with oral route preferred where clinically possible',
                'Monitor autoagglutination trend as a treatment response marker',
                'Monitor for pulmonary thromboembolism signs as a leading mortality risk',
            ],
            monitoring: [
                'Packed cell volume every 12 hours during crisis phase',
                'Reticulocyte count every 48 hours to assess bone marrow response',
                'Platelet count to screen for concurrent Evans syndrome',
                'Coagulation markers when thromboembolism risk is elevated',
                'Liver panel every 2 weeks during immunosuppressive therapy',
            ],
            indicationCriteria: ['IMHA is confirmed or strongly supported by immune-haemolysis markers and clinical instability risk.'],
            contraindications: ['Clinician must resolve hepatic, renal, bleeding, and shock flags before selecting exact agents or transfusion plan.'],
            contraChecks: ['hepatic_compromise', 'renal_compromise', 'bleeding_risk', 'shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: {
                survival_probability_band: 'guarded to fair',
                recovery_expectation: 'Prognosis depends on diagnostic speed, anaemia severity, and early immunosuppression; severe cases have substantial mortality without rapid intervention.',
            },
            rationale: `${disease.name} requires rapid immune-haemolysis control, thrombosis planning, and transfusion readiness without autonomous prescribing.`,
            risks: ['Progressive haemolysis', 'Pulmonary thromboembolism', 'Transfusion reaction', 'Immunosuppression complications'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'medical',
            drugClasses: [
                'Glucocorticoid class at immunosuppressive dose',
                'Thromboembolism prophylaxis class where available',
                'Blood product support class if critically low PCV and product access allow',
            ],
            procedures: [
                'Serial PCV monitoring at least twice daily during crisis',
                'Referral assessment if PCV continues to fall below 15% or patient decompensates',
            ],
            supportiveMeasures: ['Strict rest', 'Minimal stress', 'Oral nutritional support', 'Warm environment to reduce metabolic demand'],
            monitoring: ['PCV trend', 'Mucous membrane colour', 'Mentation and perfusion', 'Bleeding or thrombosis signs'],
            indicationCriteria: ['IMHA is likely but referral-level resources are constrained.'],
            contraindications: ['Lower-resource care still needs urgent clinician review before drug selection.'],
            contraChecks: ['hepatic_compromise', 'bleeding_risk', 'shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: {
                survival_probability_band: 'guarded',
                recovery_expectation: 'This can bridge selected cases but falling PCV or decompensation should trigger escalation.',
            },
            rationale: 'General-practice IMHA support emphasizes accessible immunosuppression and explicit escalation triggers.',
            risks: ['Delayed transfusion', 'Uncontrolled haemolysis', 'Thromboembolic deterioration'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: ['Immediate PCV assessment', 'Referral activation if care cannot be escalated within 24 hours'],
            supportiveMeasures: [
                'Oxygen supplementation if respiratory distress or severe anaemia is present',
                'Strict rest',
                'IV fluid support only if dehydration is present and over-hydration risk is reviewed',
            ],
            monitoring: ['Respiratory effort', 'Mentation', 'PCV trend', 'Perfusion'],
            indicationCriteria: ['Only a brief bridge while definitive IMHA therapy or referral is being arranged.'],
            contraindications: ['Definitive immunosuppression should not be delayed beyond this bridge in IMHA.'],
            contraChecks: ['shock_or_instability', 'bleeding_risk'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: {
                survival_probability_band: 'poor if prolonged',
                recovery_expectation: 'Supportive-only care is not acceptable as definitive IMHA management.',
            },
            rationale: 'This pathway exists only to support immediate stabilization while definitive clinician-led care is activated.',
            risks: [
                'Progressive haemolysis without immunosuppression is the primary mortality risk',
                'Transfusion without cross-matching carries alloimmunisation risk',
            ],
            regulatoryNotes: [],
        }),
    });
}

function buildImtpPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Immunosuppressive class review', 'Bleeding-risk supportive class review', 'Blood product support class if clinically indicated'],
        procedures: ['Platelet count confirmation', 'Coagulation assessment', 'Bleeding-source assessment'],
        supportiveMeasures: ['Strict rest', 'Avoid invasive procedures when possible', 'Bleeding surveillance'],
        diseaseRisk: 'critical',
        goldOutcome: { survival_probability_band: 'guarded to fair', recovery_expectation: 'Outcome depends on bleeding burden and response to clinician-directed immunosuppression.' },
        rationale: 'IMTP management requires platelet confirmation, bleeding-risk triage, and clinician-directed immune therapy.',
        risks: ['Life-threatening bleeding', 'Evans syndrome overlap'],
        urgent: 'emergent',
    });
}

function buildAddisonsPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'medical',
            drugClasses: ['Mineralocorticoid replacement class', 'Glucocorticoid replacement class', 'Emergency IV glucocorticoid class for crisis', 'Electrolyte and fluid replacement classes'],
            procedures: ['ACTH stimulation confirmation once stable'],
            supportiveMeasures: ['Shock stabilization', 'Electrolyte correction', 'Hypoglycaemia screening'],
            monitoring: ['Electrolytes every 2-4 hours during crisis, then daily', 'Renal values', 'Blood pressure'],
            indicationCriteria: ['Addisonian crisis or confirmed hypoadrenocorticism pattern is present.'],
            contraindications: ['Do not delay crisis hormone replacement while awaiting full confirmation in an unstable patient.'],
            contraChecks: ['shock_or_instability', 'renal_compromise', 'dehydration'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: { survival_probability_band: 'fair to good with rapid stabilization', recovery_expectation: 'Many patients stabilize well when crisis therapy and maintenance planning are timely.' },
            rationale: `${disease.name} is a hormone-replacement emergency when unstable, with electrolyte and perfusion monitoring at the center.`,
            risks: ['Electrolyte collapse', 'Shock', 'Arrhythmia'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'medical',
            drugClasses: ['IV glucocorticoid class for acute crisis', 'Isotonic fluid resuscitation class', 'Oral maintenance replacement class planning once stable'],
            procedures: ['Electrolyte assessment', 'Referral for ACTH confirmation'],
            supportiveMeasures: ['Perfusion support', 'Glucose monitoring where available'],
            monitoring: ['Electrolytes', 'Perfusion', 'Mentation'],
            indicationCriteria: ['Hypoadrenocorticism is likely and advanced diagnostics are delayed.'],
            contraindications: ['Bridge care must not postpone definitive replacement planning.'],
            contraChecks: ['shock_or_instability', 'dehydration'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: { survival_probability_band: 'guarded to fair', recovery_expectation: 'Resource-limited care can stabilize temporarily if hormone replacement and referral remain active.' },
            rationale: 'Lower-resource Addisonian care prioritizes crisis stabilization and confirmation access.',
            risks: ['Recurrent crisis', 'Incomplete endocrine confirmation'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: ['Immediate escalation planning'],
            supportiveMeasures: ['Perfusion and warmth support only as a 2-4 hour bridge'],
            monitoring: ['Shock progression', 'Electrolyte deterioration'],
            indicationCriteria: ['Only a very short bridge while hormone replacement is being accessed.'],
            contraindications: ['Addisonian crisis is rapidly fatal without hormone replacement.'],
            contraChecks: ['shock_or_instability', 'dehydration'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: { survival_probability_band: 'poor if prolonged', recovery_expectation: 'Supportive-only care must not extend beyond immediate bridge stabilization.' },
            rationale: 'This pathway prevents false reassurance when hormone replacement is the definitive need.',
            risks: ['Fatal electrolyte and perfusion collapse'],
            regulatoryNotes: [],
        }),
    });
}

function buildHypothyroidismPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Thyroid hormone replacement class'],
        procedures: ['Free T4 and TSH confirmation', 'Concurrent illness screen'],
        supportiveMeasures: ['Weight and dermatologic management', 'Owner monitoring plan'],
        diseaseRisk: 'moderate',
        goldOutcome: { survival_probability_band: 'good', recovery_expectation: 'Clinical response is usually good with confirmed diagnosis and clinician-directed titration.' },
        rationale: 'Hypothyroidism care is confirmation-led and titration-dependent.',
        risks: ['Over-replacement', 'Treating euthyroid sick syndrome as primary thyroid disease'],
    });
}

function buildFelineHyperthyroidismPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Antithyroid therapy class', 'Blood-pressure management class if indicated'],
        procedures: ['Total T4 confirmation', 'Blood pressure assessment', 'Renal reassessment after stabilization'],
        supportiveMeasures: ['Nutrition support', 'Cardiac screening when indicated'],
        diseaseRisk: 'high',
        goldOutcome: { survival_probability_band: 'good with monitoring', recovery_expectation: 'Outcome is often good when thyroid control, blood pressure, and renal effects are co-managed.' },
        rationale: 'Feline hyperthyroidism requires thyroid control plus explicit renal and hypertensive monitoring.',
        risks: ['Unmasked renal disease', 'Hypertension', 'Cardiac complications'],
        urgent: 'urgent',
    });
}

function buildDkaPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'medical',
            drugClasses: ['IV fluid therapy class tailored to glucose and electrolytes', 'Insulin class using low-dose continuous protocol', 'Potassium supplementation class', 'Phosphorus supplementation class if indicated'],
            procedures: ['Blood glucose monitoring every 1-2 hours during crisis', 'Electrolyte monitoring every 4 hours', 'Urine ketone monitoring', 'Acid-base assessment'],
            supportiveMeasures: ['Urine output support', 'Nausea and nutrition support once safe'],
            monitoring: ['Glucose', 'Potassium', 'Phosphorus', 'Sodium', 'Bicarbonate', 'Ketones', 'Urine output'],
            indicationCriteria: ['DKA or diabetic ketoacidotic crisis is suspected or confirmed.'],
            contraindications: ['Insulin class should not be initiated without potassium review and clinician monitoring capacity.'],
            contraChecks: ['dehydration', 'renal_compromise', 'shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: { survival_probability_band: 'guarded to fair', recovery_expectation: 'Outcome depends on correction of dehydration, ketones, electrolytes, and concurrent disease.' },
            rationale: `${disease.name} management is monitoring-intensive and cannot be safely reduced to a static dose plan.`,
            risks: ['Hypokalaemia', 'Hypoglycaemia', 'Cerebral osmotic complications', 'Concurrent disease relapse'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'medical',
            drugClasses: ['IV fluid resuscitation class', 'Insulin class only where monitoring permits', 'Electrolyte supplementation class guided by available testing'],
            procedures: ['Serial glucose monitoring', 'Referral evaluation'],
            supportiveMeasures: ['Hydration correction', 'Temperature and mentation monitoring'],
            monitoring: ['Glucose trend', 'Hydration', 'Mentation', 'Available electrolytes'],
            indicationCriteria: ['DKA is likely but ICU resources are limited.'],
            contraindications: ['Do not attempt monitoring-dependent insulin pathways without adequate recheck capacity.'],
            contraChecks: ['dehydration', 'shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: { survival_probability_band: 'guarded', recovery_expectation: 'Resource-limited care is a bridge unless monitoring capacity is sufficient.' },
            rationale: 'Lower-resource DKA care emphasizes fluids, monitoring feasibility, and early referral decisions.',
            risks: ['Unrecognized hypokalaemia', 'Hypoglycaemia', 'Delayed ICU escalation'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: ['Immediate referral activation'],
            supportiveMeasures: ['Warmth and hydration support while definitive monitoring is arranged'],
            monitoring: ['Mentation', 'Perfusion', 'Respiratory pattern'],
            indicationCriteria: ['Brief bridge only while monitored DKA care is being accessed.'],
            contraindications: ['Supportive-only care is not definitive DKA treatment.'],
            contraChecks: ['shock_or_instability', 'dehydration'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: { survival_probability_band: 'poor if prolonged', recovery_expectation: 'DKA requires monitored fluid, insulin-class, and electrolyte therapy.' },
            rationale: 'This option prevents a monitoring-heavy endocrine emergency from being framed as passive care.',
            risks: ['Progressive acidosis', 'Electrolyte collapse'],
            regulatoryNotes: [],
        }),
    });
}

function buildAcutePancreatitisPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['IV fluid therapy class', 'Analgesic class', 'Antiemetic class', 'Nutritional support class'],
        procedures: ['Serial pancreatic lipase and abdominal reassessment', 'Abdominal imaging review'],
        supportiveMeasures: ['Early enteral nutrition planning', 'Hydration and pain scoring'],
        diseaseRisk: 'high',
        goldOutcome: { survival_probability_band: 'fair to guarded', recovery_expectation: 'Most mild cases improve with supportive care, while severe cases depend on early complication recognition.' },
        rationale: 'Pancreatitis care is supportive but intensive, with pain, perfusion, and nutrition as core decisions.',
        risks: ['Shock', 'Diabetes mellitus secondary to pancreatic injury', 'Systemic inflammation'],
        urgent: 'urgent',
    });
}

function buildLeptospirosisPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Appropriate antimicrobial class', 'Renal and hepatic supportive care classes'],
        procedures: ['MAT serovar confirmation', 'Zoonotic isolation workflow', 'Renal and hepatic staging'],
        supportiveMeasures: ['Barrier nursing', 'Fluid and urine-output support', 'Owner zoonosis counselling'],
        diseaseRisk: 'critical',
        goldOutcome: { survival_probability_band: 'guarded to fair', recovery_expectation: 'Recovery depends on renal/hepatic injury burden and early antimicrobial plus supportive care.' },
        rationale: 'Leptospirosis requires antimicrobial review, organ support, and zoonotic precautions.',
        risks: ['Acute kidney injury', 'Hepatic injury', 'Zoonotic exposure'],
        urgent: 'emergent',
    });
}

function buildFipPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Antiviral therapy class where lawful and available', 'Anti-inflammatory supportive class review'],
        procedures: ['Wet versus dry form confirmation', 'Effusion and neurologic/ocular staging'],
        supportiveMeasures: ['Nutrition support', 'Effusion monitoring', 'Owner prognosis counselling'],
        diseaseRisk: 'high',
        goldOutcome: { survival_probability_band: 'variable to fair where validated antiviral access exists', recovery_expectation: 'Outcome depends on form, neurologic involvement, legal access, and monitoring.' },
        rationale: 'FIP support must surface antiviral planning and monitoring without implying jurisdiction-free prescribing.',
        risks: ['Neurologic progression', 'Effusion recurrence', 'Regulatory constraints'],
        urgent: 'urgent',
    });
}

function buildAkiPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Fluid therapy class matched to volume status', 'Electrolyte correction class', 'Renal-protective supportive classes'],
        procedures: ['Urine output monitoring', 'Renal imaging if obstruction is possible', 'Toxin or infectious trigger review'],
        supportiveMeasures: ['Avoid nephrotoxic exposures', 'Nutrition and nausea support'],
        diseaseRisk: 'critical',
        goldOutcome: { survival_probability_band: 'guarded', recovery_expectation: 'Outcome depends on cause, urine output, and speed of renal support.' },
        rationale: 'AKI treatment is cause-directed and monitoring-heavy, especially around fluids and urine output.',
        risks: ['Oliguria or anuria', 'Fluid overload', 'Electrolyte derangement'],
        urgent: 'emergent',
    });
}

function buildHepaticEncephalopathyPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Ammonia-lowering gut-modifying class', 'Appropriate antimicrobial class if indicated', 'Anticonvulsant class review if seizures occur'],
        procedures: ['Bile acids or hepatic function staging', 'Glucose and electrolyte assessment', 'Portosystemic shunt evaluation when compatible'],
        supportiveMeasures: ['Protein-source review', 'Mentation-safe nursing', 'Avoid hepatotoxic exposures'],
        diseaseRisk: 'critical',
        goldOutcome: { survival_probability_band: 'guarded to fair', recovery_expectation: 'Neurologic recovery depends on hepatic cause, toxin control, and comorbidity burden.' },
        rationale: 'Hepatic encephalopathy pathways must prioritize neurologic safety and hepatic dose review.',
        risks: ['Seizures', 'Aspiration', 'Medication accumulation'],
        urgent: 'emergent',
    });
}

function buildHaemangiosarcomaPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'surgical',
            drugClasses: ['Perioperative analgesia class', 'Blood product support class if indicated', 'Oncology adjunct class review after staging'],
            procedures: ['Surgical staging', 'Mass-source control where clinically appropriate', 'Thoracic and abdominal metastatic assessment'],
            supportiveMeasures: ['Shock stabilization', 'Arrhythmia monitoring', 'Owner prognosis counselling'],
            monitoring: ['PCV/total solids trend', 'Perfusion', 'Arrhythmia', 'Evidence of rebleeding'],
            indicationCriteria: ['Haemangiosarcoma is leading or confirmed and procedural source control is under consideration.'],
            contraindications: ['Unstable bleeding and metastatic burden must be reviewed before definitive surgery.'],
            contraChecks: ['shock_or_instability', 'bleeding_risk'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'advanced',
            expectedOutcome: { survival_probability_band: 'guarded', recovery_expectation: 'Outcome depends on tumour site, rupture status, metastatic spread, and clinician-selected oncology plan.' },
            rationale: 'Haemangiosarcoma support is staging and source-control oriented, not a medication plan.',
            risks: ['Hemorrhagic shock', 'Metastasis', 'Perioperative arrhythmia'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'supportive care',
            drugClasses: ['Analgesic class', 'Blood product support class if available'],
            procedures: ['Focused ultrasound or radiograph triage', 'Referral activation'],
            supportiveMeasures: ['Shock support', 'Activity restriction'],
            monitoring: ['PCV trend', 'Perfusion'],
            indicationCriteria: ['Suspected haemangiosarcoma with limited staging or surgical resources.'],
            contraindications: ['Supportive care cannot replace staging and clinician prognosis review.'],
            contraChecks: ['shock_or_instability', 'bleeding_risk'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'low_resource',
            expectedOutcome: { survival_probability_band: 'guarded to poor', recovery_expectation: 'Bridge care may stabilize hemorrhage temporarily but definitive decisions require staging.' },
            rationale: 'Lower-resource care keeps stabilization and referral explicit.',
            risks: ['Rebleeding', 'Delayed source control'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: ['Quality-of-life and escalation discussion'],
            supportiveMeasures: ['Comfort support', 'Low-stress handling'],
            monitoring: ['Collapse, pain, bleeding'],
            indicationCriteria: ['Palliative bridge or staging declined.'],
            contraindications: ['Do not present supportive care as curative.'],
            contraChecks: ['shock_or_instability', 'bleeding_risk'],
            riskLevel: 'critical',
            urgencyLevel: 'urgent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: { survival_probability_band: 'poor to guarded', recovery_expectation: 'Comfort and safety are the goals when definitive staging or surgery is not pursued.' },
            rationale: 'Supportive-only haemangiosarcoma care is palliative or temporary.',
            risks: ['Sudden hemorrhage', 'Pain'],
            regulatoryNotes: [],
        }),
    });
}

function buildOsteoarthritisPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Multimodal analgesic class review', 'Joint-supportive anti-inflammatory class review where safe'],
        procedures: ['Orthopedic pain scoring', 'Weight and mobility assessment', 'Rehabilitation plan'],
        supportiveMeasures: ['Weight management', 'Environmental modification', 'Physical rehabilitation'],
        diseaseRisk: 'moderate',
        goldOutcome: { survival_probability_band: 'good for comfort goals', recovery_expectation: 'Long-term comfort usually improves with multimodal management and monitoring.' },
        rationale: 'Osteoarthritis care is chronic, multimodal, and contraindication-sensitive.',
        risks: ['Renal or hepatic contraindications', 'Under-treated chronic pain'],
    });
}

function buildUtiPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Culture-guided antimicrobial class'],
        procedures: ['Urinalysis and sediment review', 'Urine culture and susceptibility', 'Recheck testing if recurrent'],
        supportiveMeasures: ['Hydration support', 'Pain and voiding comfort review'],
        diseaseRisk: 'moderate',
        goldOutcome: { survival_probability_band: 'good', recovery_expectation: 'Outcome is usually good when antimicrobial selection is evidence-guided and recurrence triggers are investigated.' },
        rationale: 'UTI treatment should be culture-aware and stewardship-friendly.',
        risks: ['Antimicrobial resistance', 'Missed upper urinary disease'],
        urgent: 'urgent',
    });
}

function buildFelineUrethralObstructionPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'surgical',
            drugClasses: ['Smooth muscle relaxant class', 'Analgesic class', 'Electrolyte correction class'],
            procedures: ['Urethral catheterisation and deobstruction', 'Post-obstruction diuresis monitoring', 'Perineal urethrostomy planning for recurrent cases'],
            supportiveMeasures: ['Hyperkalaemia risk management', 'Stress reduction', 'Recurrence prevention planning'],
            monitoring: ['ECG during deobstruction', 'Urine output', 'BUN and creatinine reassessment 24-48 hours post-deobstruction'],
            indicationCriteria: ['Feline obstruction pattern with stranguria, anuria, or obstructive azotemia.'],
            contraindications: ['Hyperkalaemia and shock should be stabilized during deobstruction planning.'],
            contraChecks: ['renal_compromise', 'shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: { survival_probability_band: 'fair to good if promptly deobstructed', recovery_expectation: 'Recovery depends on rapid deobstruction, electrolyte correction, and recurrence prevention.' },
            rationale: `${disease.name} is a procedural emergency; deobstruction and hyperkalaemia monitoring are central.`,
            risks: ['Fatal hyperkalaemia-related arrhythmia', 'Post-obstructive diuresis', 'Re-obstruction'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'surgical',
            drugClasses: ['Analgesic class', 'Electrolyte correction class where available'],
            procedures: ['Emergency deobstruction if clinician-capable', 'Referral activation if catheterisation or monitoring is unavailable'],
            supportiveMeasures: ['Warmth and stress reduction', 'Fluid and electrolyte triage'],
            monitoring: ['Heart rhythm if equipment is available', 'Urine output', 'Mentation'],
            indicationCriteria: ['Obstruction likely in a setting with limited equipment.'],
            contraindications: ['Do not delay referral if deobstruction cannot be performed immediately.'],
            contraChecks: ['renal_compromise', 'shock_or_instability'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: { survival_probability_band: 'guarded', recovery_expectation: 'Bridge care depends on fast deobstruction or transfer.' },
            rationale: 'Lower-resource obstruction care prioritizes immediate deobstruction capacity and transfer decisions.',
            risks: ['Arrhythmia', 'Delayed catheterisation'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: ['Immediate referral activation'],
            supportiveMeasures: ['Low-stress handling', 'Warmth support'],
            monitoring: ['Collapse, heart rhythm concern, urine output absence'],
            indicationCriteria: ['Only a bridge while deobstruction is being accessed.'],
            contraindications: ['Supportive-only care is not definitive for obstruction.'],
            contraChecks: ['shock_or_instability', 'renal_compromise'],
            riskLevel: 'critical',
            urgencyLevel: 'emergent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: { survival_probability_band: 'poor if prolonged', recovery_expectation: 'Definitive procedural deobstruction is time-critical.' },
            rationale: 'This option keeps passive care from being mistaken as adequate for a urinary obstruction emergency.',
            risks: ['Fatal hyperkalaemia', 'Bladder rupture', 'Renal injury'],
            regulatoryNotes: [],
        }),
    });
}

function buildIvddPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'surgical',
            drugClasses: ['Analgesic classes selected by the clinician'],
            procedures: ['Advanced imaging confirmation', 'Decompressive surgery when neurologic grade warrants'],
            supportiveMeasures: ['Strict nursing care', 'Bladder management', 'Rehabilitation planning'],
            monitoring: ['Neurologic grade progression', 'Pain control', 'Urinary retention'],
            indicationCriteria: ['Paresis, paralysis, or refractory pain compatible with IVDD'],
            contraindications: ['Hemodynamic instability should be stabilized before anesthesia.', 'Renal compromise changes analgesic safety review.'],
            contraChecks: ['shock_or_instability', 'renal_compromise'],
            riskLevel: 'high',
            urgencyLevel: 'urgent',
            evidenceLevel: 'high',
            setting: 'advanced',
            expectedOutcome: {
                survival_probability_band: 'fair to good',
                recovery_expectation: 'Outcome is best when neurologic deterioration is recognized early and decompression timing is appropriate.',
            },
            rationale: 'The gold-standard pathway pairs neurologic grading with surgery or advanced medical management when clinically indicated.',
            risks: ['Anesthetic risk', 'Progressive neurologic loss'],
            regulatoryNotes: [],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'medical',
            drugClasses: ['Analgesic classes reviewed for spinal pain management'],
            procedures: ['Strict crate rest and structured rechecks'],
            supportiveMeasures: ['Pressure sore prevention', 'Assisted bladder care if needed'],
            monitoring: ['Ability to walk', 'Pain progression', 'Bladder function'],
            indicationCriteria: ['Mild to moderate IVDD signs or delayed surgical access'],
            contraindications: ['Rapid loss of deep pain or urinary retention should trigger urgent escalation.'],
            contraChecks: ['neurologic_instability'],
            riskLevel: 'high',
            urgencyLevel: 'urgent',
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: {
                survival_probability_band: 'fair',
                recovery_expectation: 'Medical management may work in selected mild cases but needs strict clinician oversight.',
            },
            rationale: 'When surgery is not immediately available, strict rest and monitored medical support are safer than casual outpatient management.',
            risks: ['Progression to paralysis', 'Pain under-treatment'],
            regulatoryNotes: [],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: [],
            supportiveMeasures: ['Activity restriction', 'Safe handling', 'Immediate referral triggers for deterioration'],
            monitoring: ['Ambulation and pain'],
            indicationCriteria: ['Short bridge to definitive clinician selection'],
            contraindications: ['Do not keep a deteriorating neurologic patient on supportive care alone.'],
            contraChecks: ['neurologic_instability'],
            riskLevel: 'high',
            urgencyLevel: 'urgent',
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: {
                survival_probability_band: 'variable',
                recovery_expectation: 'This pathway is for temporary stabilization only.',
            },
            rationale: 'Supportive-only care is a holding pattern pending clinician-confirmed medical or surgical choice.',
            risks: ['Lost decompression window', 'Progressive deficits'],
            regulatoryNotes: [],
        }),
    });
}

function buildCardiogenicRespiratoryPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Cardiogenic diuretic and vasoactive class review', 'Oxygen-support review'],
        procedures: ['Focused cardiac imaging or point-of-care assessment'],
        supportiveMeasures: ['Oxygen therapy', 'Stress minimization', 'Perfusion monitoring'],
        diseaseRisk: 'critical',
        goldOutcome: {
            survival_probability_band: 'fair to good if stabilized quickly',
            recovery_expectation: 'Rapid oxygenation support and congestion control improve short-term outcomes.',
        },
        rationale: 'Cardiogenic respiratory emergencies need oxygen-first, congestion-aware pathways with clinician oversight.',
        risks: ['Respiratory failure', 'Perfusion compromise'],
        urgent: 'emergent',
    });
}

function buildCategoryFallbackPlaybook(disease: DiseaseOntologyEntry): TreatmentPlaybook {
    if (disease.category === 'Toxicology') {
        return buildToxicologyPlaybook(disease, {
            rationale: 'Toxicology support should frame organ-specific stabilization and antidotal review, not a rigid single protocol.',
            targetedDetails: ['Cause-specific antidotal or detoxification class review', 'Exposure decontamination review if clinically safe'],
        });
    }
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: ['Cause-directed veterinary therapy classes selected by the clinician'],
        procedures: ['Focused confirmatory diagnostics'],
        supportiveMeasures: ['Monitoring, reassessment, and cause-directed escalation'],
        diseaseRisk: disease.category === 'Gastrointestinal' || disease.category === 'Neurological' ? 'high' : 'moderate',
        goldOutcome: {
            survival_probability_band: 'variable',
            recovery_expectation: 'Outcome depends on the final confirmed etiology and clinician-selected definitive therapy.',
        },
        rationale: `This pathway keeps ${disease.name} structured, veterinary-only, and clinician-led rather than deterministic.`,
        risks: ['Misclassification if definitive diagnostics lag'],
        urgent: disease.category === 'Gastrointestinal' || disease.category === 'Cardiopulmonary' ? 'urgent' : 'routine',
    });
}

function buildMedicalPlaybook(
    disease: DiseaseOntologyEntry,
    input: {
        goldDrugClasses: string[];
        procedures: string[];
        supportiveMeasures: string[];
        diseaseRisk: TreatmentRiskLevel;
        goldOutcome: TreatmentExpectedOutcomeRange;
        rationale: string;
        risks: string[];
        urgent?: TreatmentUrgencyLevel;
    },
): TreatmentPlaybook {
    const urgency = input.urgent ?? 'routine';
    return createThreePathwayPlaybook({
        gold: buildOption({
            pathway: 'gold_standard',
            treatmentType: 'medical',
            drugClasses: input.goldDrugClasses,
            procedures: input.procedures,
            supportiveMeasures: input.supportiveMeasures,
            monitoring: ['Clinical response', 'Hydration/perfusion trend', 'Complication emergence'],
            indicationCriteria: [`${disease.name} is the leading diagnosis and the patient can support a clinician-guided pathway`],
            contraindications: ['Drug and dosage selection still require clinician validation against species, labs, and comorbidity profile.'],
            contraChecks: ['renal_compromise', 'hepatic_compromise', 'dehydration', 'bleeding_risk'],
            riskLevel: input.diseaseRisk,
            urgencyLevel: urgency,
            evidenceLevel: 'moderate',
            setting: 'advanced',
            expectedOutcome: input.goldOutcome,
            rationale: input.rationale,
            risks: input.risks,
            regulatoryNotes: ['Antimicrobial, controlled-drug, and antidote choices must follow local veterinary rules.'],
        }),
        resource: buildOption({
            pathway: 'resource_constrained',
            treatmentType: 'medical',
            drugClasses: input.goldDrugClasses.length > 0 ? [input.goldDrugClasses[0]] : [],
            procedures: ['Focused reassessment and staged diagnostics'],
            supportiveMeasures: input.supportiveMeasures,
            monitoring: ['Clinical response', 'Escalation triggers'],
            indicationCriteria: [`${disease.name} remains likely but diagnostic or formulary resources are constrained`],
            contraindications: ['Lower-resource management still requires clinician review before treatment is chosen.'],
            contraChecks: ['renal_compromise', 'hepatic_compromise', 'dehydration'],
            riskLevel: input.diseaseRisk,
            urgencyLevel: urgency,
            evidenceLevel: 'moderate',
            setting: 'low_resource',
            expectedOutcome: {
                survival_probability_band: input.goldOutcome.survival_probability_band,
                recovery_expectation: `A lower-resource approach may still work for ${disease.name}, but only when escalation criteria stay active.`,
            },
            rationale: 'This alternative emphasizes staged diagnostics and accessible interventions without pretending to be definitive.',
            risks: input.risks,
            regulatoryNotes: ['Validate formulary availability and local prescribing rules.'],
        }),
        supportive: buildOption({
            pathway: 'supportive_only',
            treatmentType: 'supportive care',
            drugClasses: [],
            procedures: [],
            supportiveMeasures: input.supportiveMeasures,
            monitoring: ['Hydration, mentation, and progression'],
            indicationCriteria: ['A temporary holding pathway is needed while clinician confirmation or diagnostics are pending'],
            contraindications: ['Supportive-only care should not be mistaken for definitive disease control.'],
            contraChecks: ['dehydration', 'shock_or_instability'],
            riskLevel: input.diseaseRisk,
            urgencyLevel: urgency,
            evidenceLevel: 'low',
            setting: 'any',
            expectedOutcome: {
                survival_probability_band: 'variable',
                recovery_expectation: 'Useful only as a bridge until the clinician finalizes the treatment decision.',
            },
            rationale: 'This option intentionally reinforces uncertainty and clinician confirmation.',
            risks: input.risks,
            regulatoryNotes: [],
        }),
    });
}

function buildToxicologyPlaybook(
    disease: DiseaseOntologyEntry,
    input: {
        rationale: string;
        targetedDetails: string[];
    },
): TreatmentPlaybook {
    return buildMedicalPlaybook(disease, {
        goldDrugClasses: [input.targetedDetails[0] ?? 'Cause-specific antidotal class review'],
        procedures: input.targetedDetails.slice(1),
        supportiveMeasures: ['Continuous monitoring of the affected organ system', 'Perfusion and temperature support'],
        diseaseRisk: 'high',
        goldOutcome: {
            survival_probability_band: 'variable',
            recovery_expectation: 'Outcome depends on toxin burden, organ involvement, and early supportive care.',
        },
        rationale: input.rationale,
        risks: ['Delayed organ failure', 'Inappropriate decontamination'],
        urgent: 'urgent',
    });
}

function createThreePathwayPlaybook(input: {
    gold: OptionTemplate;
    resource: OptionTemplate;
    supportive: OptionTemplate;
}): TreatmentPlaybook {
    return {
        gold_standard: input.gold,
        resource_constrained: input.resource,
        supportive_only: input.supportive,
    };
}

function buildOption(input: {
    pathway: TreatmentPathway;
    treatmentType: TreatmentType;
    drugClasses: string[];
    procedures: string[];
    supportiveMeasures: string[];
    monitoring: string[];
    referenceRangeNotes?: string[];
    indicationCriteria: string[];
    contraindications: string[];
    contraChecks: ContraindicationFlag[];
    riskLevel: TreatmentRiskLevel;
    urgencyLevel: TreatmentUrgencyLevel;
    evidenceLevel: TreatmentEvidenceLevel;
    setting: TreatmentEnvironmentConstraints['preferred_setting'];
    expectedOutcome: TreatmentExpectedOutcomeRange;
    rationale: string;
    risks: string[];
    regulatoryNotes: string[];
}): OptionTemplate {
    return {
        pathway: input.pathway,
        treatment_type: input.treatmentType,
        intervention_details: {
            drug_classes: input.drugClasses,
            procedure_types: input.procedures,
            supportive_measures: input.supportiveMeasures,
            monitoring: input.monitoring,
            reference_range_notes: input.referenceRangeNotes ?? [
                'Reference only: final dosing, interval, and formulary choice must be set by a licensed veterinarian for this patient.',
            ],
        },
        indication_criteria: input.indicationCriteria,
        contraindications: input.contraindications,
        contraindication_checks: input.contraChecks,
        risk_level: input.riskLevel,
        urgency_level: input.urgencyLevel,
        evidence_level: input.evidenceLevel,
        environment_constraints: {
            preferred_setting: input.setting,
            notes: input.setting === 'low_resource'
                ? ['Designed for lower-resource or referral-limited settings.', 'Escalate if deterioration exceeds available monitoring capacity.']
                : input.setting === 'advanced'
                    ? ['Assumes access to advanced monitoring, referral, or procedural support.']
                    : ['Can be used as a short bridge in any setting, but clinician confirmation is still required.'],
        },
        expected_outcome_range: input.expectedOutcome,
        risks: input.risks,
        rationale: input.rationale,
        regulatory_notes: input.regulatoryNotes,
    };
}

function extractRankedDifferentials(outputPayload: Record<string, unknown>, primaryDiagnosis: string): RankedDifferential[] {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const differentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    const seen = new Set<string>();

    return differentials
        .map((entry): RankedDifferential | null => {
            const rawName = typeof entry === 'string'
                ? entry
                : typeof entry === 'object' && entry !== null
                    ? (entry as Record<string, unknown>).name
                    : null;
            const canonicalName = normalizeOntologyDiseaseName(rawName);
            if (!canonicalName || seen.has(canonicalName)) {
                return null;
            }
            seen.add(canonicalName);
            const ontologyEntry = getMasterDiseaseOntology().find((candidate) => candidate.name === canonicalName) ?? null;
            const probability = typeof entry === 'object' && entry !== null
                ? readNumber((entry as Record<string, unknown>).probability)
                : null;
            return {
                name: canonicalName,
                probability,
                category: ontologyEntry?.category ?? (canonicalName === primaryDiagnosis ? findDiseaseEntry(primaryDiagnosis)?.category ?? null : null),
            };
        })
        .filter((entry): entry is RankedDifferential => entry != null)
        .slice(0, 6);
}

function assessDiagnosticManagement(input: {
    disease: DiseaseOntologyEntry;
    diagnosisConfidence: number | null;
    supportingSignals: string[];
    contradictionFlags: string[];
    rankedDifferentials: RankedDifferential[];
    outputPayload: Record<string, unknown>;
}): DiagnosticManagementAssessment {
    const contradictionAnalysis = asRecord(input.outputPayload.contradiction_analysis);
    const contradictionScore = readNumber(contradictionAnalysis.contradiction_score)
        ?? readNumber(input.outputPayload.contradiction_score)
        ?? 0;
    const abstainRecommended = readBoolean(input.outputPayload.abstain_recommendation) === true
        || readBoolean(contradictionAnalysis.abstain) === true;
    const ranked = input.rankedDifferentials.length > 0
        ? input.rankedDifferentials
        : [{ name: input.disease.name, probability: input.diagnosisConfidence, category: input.disease.category }];
    const topProbability = ranked[0]?.probability ?? input.diagnosisConfidence;
    const secondProbability = ranked[1]?.probability ?? null;
    const margin = topProbability != null && secondProbability != null
        ? topProbability - secondProbability
        : null;
    const crossCategoryAlternatives = ranked
        .filter((entry) => entry.name !== input.disease.name && entry.category != null && entry.category !== input.disease.category)
        .map((entry) => entry.name)
        .slice(0, 3);

    const reasons: string[] = [];
    let noiseScore = 0;

    if (abstainRecommended) {
        reasons.push('The diagnostic safety layer already recommends clinician-led confirmation before definitive treatment.');
        noiseScore += 3;
    }
    if (contradictionScore >= 0.35 || input.contradictionFlags.length >= 2) {
        reasons.push('Contradictory case context is widening the differential and lowering treatment certainty.');
        noiseScore += contradictionScore >= 0.35 ? 2 : 1;
    }
    if ((topProbability ?? input.diagnosisConfidence ?? 1) < 0.72) {
        reasons.push(`Primary diagnosis confidence remains limited at ${(((topProbability ?? input.diagnosisConfidence ?? 0) as number) * 100).toFixed(0)}%.`);
        noiseScore += (topProbability ?? input.diagnosisConfidence ?? 1) < 0.58 ? 2 : 1;
    }
    if (margin != null && margin < 0.18) {
        reasons.push('Top differentials remain too close to justify disease-specific treatment as the default.');
        noiseScore += margin < 0.1 ? 2 : 1;
    }
    if (input.supportingSignals.length < 2) {
        reasons.push('Too few disease-specific supporting signals were matched from the available case data.');
        noiseScore += 1;
    }
    if (crossCategoryAlternatives.length > 0) {
        reasons.push(`Meaningful alternatives from other clinical domains are still active: ${formatDiseaseList(crossCategoryAlternatives)}.`);
        noiseScore += 1;
    }

    const required = abstainRecommended
        || contradictionScore >= 0.45
        || (margin != null && margin < 0.1)
        || noiseScore >= 3;
    const confirmatoryActions = required
        ? deriveDiagnosticManagementActions(input.disease, crossCategoryAlternatives, input.contradictionFlags)
        : [];

    return {
        required,
        reasons,
        summary: required
            ? `Diagnostic-management mode active. ${reasons.slice(0, 3).join(' ')}`
            : null,
        confirmatory_actions: confirmatoryActions,
    };
}

function deriveDiagnosticManagementActions(
    disease: DiseaseOntologyEntry,
    crossCategoryAlternatives: string[],
    contradictionFlags: string[],
): string[] {
    const actions = [
        'Confirmatory diagnostics should precede definitive disease-specific treatment whenever the patient can tolerate that delay.',
    ];

    switch (disease.category) {
        case 'Neurological':
            actions.push('Repeat focused neurologic examination and lesion localization before committing to a definitive pathway.');
            actions.push('Use advanced imaging, CSF analysis, or infectious/toxic screening to separate structural, inflammatory, and exposure-driven causes.');
            break;
        case 'Gastrointestinal':
            actions.push('Use targeted imaging and repeat abdominal assessment to separate obstructive, inflammatory, and surgical abdominal disease.');
            actions.push('Trend perfusion and abdominal findings while confirmatory diagnostics are being assembled.');
            break;
        case 'Toxicology':
            actions.push('Reconcile exposure history and toxidrome-defining findings before selecting cause-specific antidotal management.');
            break;
        case 'Cardiopulmonary':
            actions.push('Prioritize oxygenation/perfusion stabilization plus confirmatory cardiopulmonary imaging or point-of-care assessment.');
            break;
        case 'Renal':
            actions.push('Clarify obstructive, intrinsic, and systemic contributors with focused urinary and renal diagnostics before locking into definitive therapy.');
            break;
        case 'Reproductive':
            actions.push('Use reproductive imaging and focused examination to confirm the pathology before definitive intervention.');
            break;
        case 'Endocrine':
            actions.push('Confirm endocrine-specific laboratory anchors before escalating disease-specific long-course management.');
            break;
        default:
            actions.push('Use focused confirmatory diagnostics and repeat clinician examination to narrow the differential before definitive therapy.');
            break;
    }

    if (crossCategoryAlternatives.length > 0) {
        actions.push(`Explicitly discriminate ${disease.name} from ${formatDiseaseList(crossCategoryAlternatives)} before committing to a definitive treatment path.`);
    }
    if (contradictionFlags.length > 0) {
        actions.push('Resolve contradictory history, metadata, or exposure signals before translating this pathway into definitive treatment.');
    }

    return dedupeStrings(actions).slice(0, 4);
}

function applyDiagnosticManagementOverlay(
    option: TreatmentCandidateRecord,
    disease: DiseaseOntologyEntry,
    diagnosticManagement: DiagnosticManagementAssessment,
): TreatmentCandidateRecord {
    const pathwayLead = option.treatment_pathway === 'gold_standard'
        ? 'Advanced diagnostic-management pathway prioritizes stabilization plus confirmatory workup before definitive disease-directed treatment.'
        : option.treatment_pathway === 'resource_constrained'
            ? 'Resource-constrained diagnostic-management pathway favors staged diagnostics and monitored reassessment over premature definitive treatment.'
            : 'Bridge-only diagnostic-management pathway keeps the patient stabilized while clinician confirmation and escalation decisions are pending.';
    const provisionalDrugClasses = option.treatment_pathway === 'supportive_only'
        ? []
        : ['Only clinician-selected stabilization or symptom-control classes should be considered until confirmatory diagnostics narrow the differential.'];
    const confirmatoryProcedures = diagnosticManagement.confirmatory_actions;

    return {
        ...option,
        treatment_type: option.treatment_pathway === 'supportive_only' ? 'supportive care' : 'medical',
        intervention_details: {
            ...option.intervention_details,
            drug_classes: provisionalDrugClasses,
            procedure_types: dedupeStrings([
                ...confirmatoryProcedures,
                ...option.intervention_details.procedure_types.filter((entry) => /confirm|diagnostic|reassess|assessment|screen/i.test(entry)),
            ]),
            supportive_measures: dedupeStrings([
                'Serial reassessment while tracking which differential is becoming better anchored.',
                ...option.intervention_details.supportive_measures,
                'Escalate immediately if instability or disease-defining features emerge during workup.',
            ]),
            monitoring: dedupeStrings([
                'Monitor the findings that discriminate the leading differential set.',
                ...option.intervention_details.monitoring,
            ]),
            reference_range_notes: dedupeStrings([
                ...option.intervention_details.reference_range_notes,
                'Definitive disease-specific prescribing or procedures should wait for confirmatory diagnostics whenever clinically feasible.',
            ]),
        },
        indication_criteria: dedupeStrings([
            `Use when ${disease.name} remains plausible but the differential is too noisy for definitive disease-directed management.`,
            ...option.indication_criteria,
        ]),
        evidence_level: option.evidence_level === 'high' ? 'moderate' : option.evidence_level,
        expected_outcome_range: {
            ...option.expected_outcome_range,
            recovery_expectation: 'Outcome depends on rapid stabilization, confirmatory diagnostics, and timely clinician escalation once the leading diagnosis is better anchored.',
        },
        why_relevant: `${pathwayLead} ${option.why_relevant}`.trim(),
        risks: dedupeStrings([
            'Premature commitment to the wrong disease-specific pathway.',
            ...option.risks,
        ]),
        regulatory_notes: dedupeStrings([
            ...option.regulatory_notes,
            'Translate this pathway into definitive therapy only after clinician review of confirmatory diagnostics and the current safety context.',
        ]),
        uncertainty: {
            ...option.uncertainty,
            recommendation_confidence: clamp(Number((option.uncertainty.recommendation_confidence - 0.12).toFixed(3)), 0.12, 0.9),
            evidence_gaps: dedupeStrings([
                ...option.uncertainty.evidence_gaps,
                ...diagnosticManagement.reasons,
            ]),
            weak_evidence: true,
            diagnostic_management_required: true,
            noise_reasons: diagnosticManagement.reasons,
        },
    };
}

function buildUncertaintyEnvelope(
    diagnosisConfidence: number | null,
    alternatives: string[],
    evidenceLevel: TreatmentEvidenceLevel,
    detectedContraindicationCount: number,
    diagnosticManagement: DiagnosticManagementAssessment,
): TreatmentUncertaintyEnvelope {
    const boundedConfidence = clamp(diagnosisConfidence ?? 0.5, 0.2, 0.98);
    const penalty = detectedContraindicationCount * 0.08
        + (evidenceLevel === 'low' ? 0.12 : evidenceLevel === 'moderate' ? 0.05 : 0)
        + (diagnosticManagement.required ? 0.12 : 0);
    const recommendationConfidence = clamp(Number((boundedConfidence - penalty).toFixed(3)), 0.15, 0.97);
    const evidenceGaps = [
        alternatives.length > 0 ? 'Top differentials remain close enough that pathway choice should be validated against confirmatory diagnostics.' : null,
        evidenceLevel === 'low' ? 'Published or internally observed evidence is limited for this exact context.' : null,
        detectedContraindicationCount > 0 ? 'Potential contraindications were detected and require clinician review before definitive intervention.' : null,
        diagnosticManagement.required ? 'Diagnostic-management mode is active because the current differential is too noisy for definitive disease-directed treatment.' : null,
    ].filter((value): value is string => value != null);

    return {
        recommendation_confidence: recommendationConfidence,
        evidence_gaps: evidenceGaps,
        alternative_diagnoses: alternatives,
        weak_evidence: evidenceLevel === 'low' || recommendationConfidence < 0.55 || diagnosticManagement.required,
        diagnostic_management_required: diagnosticManagement.required,
        noise_reasons: diagnosticManagement.reasons,
    };
}

function buildUncertaintySummary(
    diagnosisConfidence: number | null,
    alternatives: string[],
    contradictionFlags: string[],
    options: TreatmentCandidateRecord[],
    diagnosticManagement: DiagnosticManagementAssessment,
) {
    const caveats = [
        diagnosticManagement.required
            ? diagnosticManagement.summary
            : null,
        diagnosisConfidence != null && diagnosisConfidence < 0.65
            ? `Primary diagnosis confidence is only ${(diagnosisConfidence * 100).toFixed(0)}%.`
            : null,
        alternatives.length > 0
            ? `Alternative diagnoses still in play: ${alternatives.join(', ')}.`
            : null,
        contradictionFlags.length > 0
            ? `Contradiction flags present: ${contradictionFlags.join(', ')}.`
            : null,
        options.some((option) => option.detected_contraindications.length > 0)
            ? 'At least one pathway has detected contraindications that must be resolved by the clinician.'
            : null,
    ].filter((value): value is string => value != null);

    return caveats.length > 0
        ? caveats.join(' ')
        : 'Pathways are ranked from the closed-world treatment library, but the system still expects clinician confirmation before any intervention is chosen.';
}

function buildConditionModule(input: ConditionModuleBuildInput): TreatmentConditionModuleReport | null {
    const imhaPatient = extractImhaPatientContext(input);
    if (shouldBuildImhaModule(input.disease, imhaPatient, input.rankedDifferentials, input.supportingSignals)) {
        return buildImhaConditionModule(input, imhaPatient);
    }

    const patient = extractHypocalcemiaPatientContext(input);
    if (!shouldBuildHypocalcemiaModule(input.disease, patient, input.rankedDifferentials, input.supportingSignals)) {
        return null;
    }

    const differentials = buildHypocalcemiaDifferentials(input, patient);
    const signalTriage = buildHypocalcemiaSignalTriage(patient, input);
    const signalmentPrior = buildHypocalcemiaSignalmentPrior(patient);
    const diagnostics = buildHypocalcemiaDiagnostics(patient, differentials[0]?.condition ?? input.disease.name);
    const treatmentPathway = buildHypocalcemiaTreatmentPathway(patient, differentials[0]?.condition ?? input.disease.name, signalTriage.urgency_classification);
    const monitoring = buildHypocalcemiaMonitoring(patient);
    const confidenceSummary = buildHypocalcemiaConfidenceSummary(patient, differentials);

    return {
        module_key: 'hypocalcaemia_small_animals',
        title: 'HYPOCALCAEMIA MODULE (Dogs & Cats)',
        step_1_signal_triage: signalTriage,
        step_2_species_signalment_prior: signalmentPrior,
        step_3_aetiology_differential_ranking: differentials,
        step_4_diagnostic_recommendations: diagnostics,
        step_5_treatment_pathway: treatmentPathway,
        step_6_monitoring_protocol: monitoring,
        step_7_confidence_summary: confidenceSummary,
        actionable_now: confidenceSummary.recommended_action,
    };
}

function isImhaConditionId(value: string): boolean {
    return ['imha', 'imha_canine', 'immune-mediated-haemolytic-anaemia', 'immune_mediated_hemolytic_anemia'].includes(value);
}

function shouldBuildImhaModule(
    disease: DiseaseOntologyEntry,
    patient: ImhaPatientContext,
    rankedDifferentials: RankedDifferential[],
    supportingSignals: string[],
) {
    const diseaseMatch =
        CONDITION_MODULE_DISEASE_IDS.has(disease.id)
        || /immune.*h[ae]emolytic|imha/i.test(disease.name)
        || isImhaConditionId(disease.id);
    const differentialMatch = rankedDifferentials.some((entry) => /immune.*h[ae]emolytic|imha/i.test(entry.name));
    const signalMatch =
        patient.spherocytesPresent
        || patient.coombsPositive
        || patient.autoagglutinationPositive
        || patient.salineAgglutinationPositive
        || supportingSignals.some((signal) => /spherocyte|coombs|autoagglutination|haemolysis|hemolysis/i.test(signal));
    const clinicalMatch =
        patient.paleMucousMembranes
        || patient.weakness
        || patient.collapse
        || patient.regenerativeAnaemia
        || (patient.packedCellVolumePercent != null && patient.packedCellVolumePercent < 25);
    const canineMatch = normalizeSpecies(patient.species) === 'dog';

    return canineMatch && (diseaseMatch || differentialMatch) && signalMatch && clinicalMatch;
}

function extractImhaPatientContext(input: ConditionModuleBuildInput): ImhaPatientContext {
    const signature = input.input.inputSignature;
    const metadata = asRecord(signature.metadata);
    const history = asRecord(signature.history);
    const diagnosticTests = asRecord(signature.diagnostic_tests);
    const cbc = asRecord(diagnosticTests.cbc);
    const serology = asRecord(diagnosticTests.serology);
    const physicalExam = asRecord(signature.physical_exam);
    const scalarEntries = collectScalarEntries(signature);
    const rawNarrative = collectStringsFromUnknown(signature).join(' | ').toLowerCase();
    const observations = new Set([
        ...input.observations,
        ...readStringArray(signature.presenting_signs).map(normalizeImhaToken),
        ...readStringArray(signature.symptoms).map(normalizeImhaToken),
    ]);
    const species = normalizeText(signature.species) ?? normalizeText(metadata.species);
    const breed = normalizeText(signature.breed) ?? normalizeText(metadata.breed);
    const ageYears = readMeasurementNumber(signature.age_years) ?? readMeasurementNumber(metadata.age_years);
    const weightKg = readMeasurementNumber(signature.weight_kg) ?? readMeasurementNumber(metadata.weight_kg);
    const sex = normalizeText(signature.sex) ?? normalizeText(metadata.sex);
    const region =
        normalizeText(signature.region)
        ?? normalizeText(history.geographic_region)
        ?? normalizeText(metadata.region)
        ?? normalizeText(input.input.context.regulatory_region);
    const packedCellVolumePercent =
        readMeasurementNumber(cbc.packed_cell_volume_percent)
        ?? readScalarEntryNumber(scalarEntries, /(packed_?cell_?volume|pcv|haematocrit|hematocrit)/i);
    const spherocytesPresent = normalizeText(cbc.spherocytes) === 'present' || normalizeText(cbc.spherocytosis) === 'present' || /spherocyte/.test(rawNarrative);
    const coombsPositive = normalizeText(serology.coombs_test) === 'positive' || /coombs.*positive|positive.*coombs/.test(rawNarrative);
    const autoagglutinationPositive = normalizeText(cbc.autoagglutination) === 'positive' || /autoagglutination.*positive|positive.*autoagglutination/.test(rawNarrative);
    const salineAgglutinationPositive = normalizeText(serology.saline_agglutination) === 'positive' || /saline.*agglutination.*positive|positive.*saline.*agglutination/.test(rawNarrative);
    const regenerativeAnaemia =
        normalizeText(cbc.anemia_type) === 'regenerative'
        || normalizeText(cbc.reticulocytosis) === 'elevated'
        || /regenerative an[ae]mia|reticulocytosis/.test(rawNarrative);
    const thrombocytopenia =
        normalizeText(cbc.thrombocytopenia) != null
        && normalizeText(cbc.thrombocytopenia) !== 'absent';
    const paleMucousMembranes =
        normalizeText(physicalExam.mucous_membrane_color) === 'pale'
        || observations.has('pale_mucous_membranes')
        || /pale (mucous membranes|gums)/.test(rawNarrative);
    const tachycardia =
        observations.has('tachycardia')
        || (readMeasurementNumber(physicalExam.heart_rate) ?? 0) >= 140
        || /tachycard/.test(rawNarrative);
    const weakness = observations.has('weakness') || /weakness|weak\b/.test(rawNarrative);
    const collapse = observations.has('collapse') || /collapse|collapsed/.test(rawNarrative);
    const tickPanelNegative = normalizeText(serology.tick_borne_disease_panel) === 'negative';
    const eastAfricaContext = region != null && /(nairobi|kenya|east[_ -]?africa|ke\b)/i.test(region);
    const normalizedBreed = breed?.toLowerCase().replace(/[^a-z0-9]+/g, '_') ?? '';
    const breedElevated = ['cocker_spaniel', 'english_springer_spaniel', 'old_english_sheepdog'].some((candidate) => normalizedBreed.includes(candidate));
    const sexLower = (sex ?? '').toLowerCase();
    const signalmentElevated =
        normalizeSpecies(species) === 'dog'
        && (ageYears ?? 0) >= 2
        && (ageYears ?? 99) <= 8
        && sexLower.includes('female')
        && (sexLower.includes('spay') || sexLower.includes('spayed'));

    return {
        species,
        breed,
        ageYears,
        sex,
        weightKg,
        region,
        observations,
        rawNarrative,
        packedCellVolumePercent,
        spherocytesPresent,
        coombsPositive,
        autoagglutinationPositive,
        salineAgglutinationPositive,
        regenerativeAnaemia,
        thrombocytopenia,
        paleMucousMembranes,
        tachycardia,
        weakness,
        collapse,
        tickPanelNegative,
        eastAfricaContext,
        breedElevated,
        signalmentElevated,
    };
}

function buildImhaConditionModule(
    input: ConditionModuleBuildInput,
    patient: ImhaPatientContext,
): TreatmentConditionModuleReport {
    const signalTriage = buildImhaSignalTriage(patient, input);
    const differentials = buildImhaDifferentials(patient);
    const confidenceSummary = buildImhaConfidenceSummary(patient, differentials);

    return {
        module_key: 'imha_canine',
        title: 'IMHA MODULE (Canine)',
        step_1_signal_triage: signalTriage,
        step_2_species_signalment_prior: buildImhaSignalmentPrior(patient),
        step_3_aetiology_differential_ranking: differentials,
        step_4_diagnostic_recommendations: buildImhaDiagnostics(patient),
        step_5_treatment_pathway: buildImhaTreatmentPathway(patient, signalTriage.urgency_classification),
        step_6_monitoring_protocol: buildImhaMonitoring(patient),
        step_7_confidence_summary: confidenceSummary,
        actionable_now: confidenceSummary.recommended_action,
    };
}

function buildImhaSignalTriage(
    patient: ImhaPatientContext,
    input: ConditionModuleBuildInput,
): TreatmentConditionModuleReport['step_1_signal_triage'] {
    const emergency =
        (patient.packedCellVolumePercent != null && patient.packedCellVolumePercent < 15)
        || (patient.autoagglutinationPositive && patient.collapse)
        || (patient.tachycardia && patient.paleMucousMembranes && patient.weakness)
        || input.input.emergencyLevel?.toUpperCase() === 'CRITICAL';
    const urgent = emergency || patient.spherocytesPresent || patient.coombsPositive || patient.collapse || patient.paleMucousMembranes;
    const urgencyClassification = emergency ? 'EMERGENCY' : urgent ? 'URGENT' : 'STABLE';

    return {
        urgency_classification: urgencyClassification,
        summary: urgencyClassification === 'EMERGENCY'
            ? 'Immune-haemolysis evidence is paired with physiologic instability; crisis stabilization and PCV triage are immediate priorities.'
            : urgencyClassification === 'URGENT'
                ? 'Immune-haemolysis evidence is present and should be worked up urgently before immunosuppression decisions.'
                : 'IMHA signal is present but current instability markers are limited; confirmatory staging remains necessary.',
        bullets: dedupeStrings([
            patient.packedCellVolumePercent != null ? `PCV provided: ${patient.packedCellVolumePercent.toFixed(1)}%.` : 'PCV is missing; immediate packed cell volume assessment is still needed.',
            patient.autoagglutinationPositive ? 'Autoagglutination is positive and supports antibody-mediated erythrocyte clumping.' : null,
            patient.spherocytesPresent ? 'Spherocytes are present and strongly support canine IMHA.' : null,
            patient.coombsPositive ? 'Coombs test is positive.' : null,
            patient.tachycardia && patient.paleMucousMembranes && patient.weakness ? 'Tachycardia, pale mucous membranes, and weakness form an instability cluster.' : null,
        ]),
    };
}

function buildImhaSignalmentPrior(patient: ImhaPatientContext): TreatmentConditionModuleReport['step_2_species_signalment_prior'] {
    return {
        summary: 'Canine signalment and breed priors are used only after immune-haemolysis evidence is present.',
        bullets: dedupeStrings([
            patient.signalmentElevated ? 'Spayed female dog aged 2-8 years elevates the IMHA prior.' : null,
            patient.breedElevated ? `${patient.breed ?? 'Breed'} is an IMHA-predisposed breed group.` : null,
            patient.breed ? `Breed recorded: ${patient.breed}.` : 'Breed was not supplied, so breed prior could not be applied.',
            patient.ageYears != null ? `Age recorded: ${patient.ageYears.toFixed(1)} years.` : null,
            patient.sex ? `Sex/reproductive status recorded: ${patient.sex}.` : null,
        ]),
    };
}

function buildImhaDifferentials(patient: ImhaPatientContext): TreatmentConditionModuleReport['step_3_aetiology_differential_ranking'] {
    const candidates = [
        {
            condition: 'Primary IMHA',
            score: 30 + (patient.spherocytesPresent ? 24 : 0) + (patient.coombsPositive ? 22 : 0) + (patient.autoagglutinationPositive ? 22 : 0) + (patient.regenerativeAnaemia ? 8 : 0) + (patient.breedElevated ? 6 : 0),
            mechanism: 'Autoantibody-mediated erythrocyte destruction drives haemolysis, anaemia, and thromboembolic risk.',
            supporting: dedupeStrings([
                patient.spherocytesPresent ? 'Spherocytosis supports extravascular immune erythrocyte destruction.' : null,
                patient.coombsPositive ? 'Coombs positivity confirms antibody involvement.' : null,
                patient.autoagglutinationPositive ? 'Autoagglutination supports immune RBC clumping.' : null,
                patient.tickPanelNegative ? 'Negative tick-borne panel reduces infectious haemolysis as the primary driver.' : null,
            ]),
            confirms_if: ['Spherocytes, positive Coombs or agglutination, and compatible haemolytic anaemia remain concordant.', 'Tick-borne mimics are excluded or treated as co-infections.'],
            excludes_if: ['Babesia or other haemoparasite is directly identified as the primary cause.', 'Anaemia is non-regenerative without evidence of immune destruction.'],
        },
        {
            condition: 'Evans syndrome (IMHA + IMTP)',
            score: 18 + (patient.thrombocytopenia ? 24 : 0) + (patient.coombsPositive || patient.autoagglutinationPositive ? 12 : 0),
            mechanism: 'Concurrent immune-mediated erythrocyte and platelet destruction raises bleeding and thrombotic complexity.',
            supporting: dedupeStrings([
                patient.thrombocytopenia ? 'Thrombocytopenia is present and raises Evans syndrome concern.' : null,
                patient.autoagglutinationPositive ? 'Autoagglutination supports the IMHA component.' : null,
            ]),
            confirms_if: ['Platelet count confirms clinically relevant thrombocytopenia alongside IMHA.', 'Bleeding signs or petechiae are documented.'],
            excludes_if: ['Platelet count is normal and no platelet immune marker is present.'],
        },
        {
            condition: 'Secondary IMHA',
            score: 16 + (patient.tickPanelNegative ? -4 : 8) + (patient.eastAfricaContext ? 6 : 0),
            mechanism: 'Drug, vaccine, infectious, or neoplastic triggers can drive immune haemolysis and must be searched for before long-term labeling.',
            supporting: dedupeStrings([
                patient.eastAfricaContext ? 'East African tick-borne co-infection prevalence keeps secondary/infectious triggers in the workup.' : null,
                !patient.tickPanelNegative ? 'Tick-borne exclusion is incomplete.' : null,
            ]),
            confirms_if: ['Trigger exposure, infection, or neoplasia is identified alongside immune haemolysis.'],
            excludes_if: ['Trigger workup is unrevealing and primary IMHA pattern remains dominant.'],
        },
        {
            condition: 'Haemangiosarcoma-associated haemolysis',
            score: 10 + (patient.packedCellVolumePercent != null && patient.packedCellVolumePercent < 20 ? 5 : 0),
            mechanism: 'Occult splenic or hepatic neoplasia can contribute to anaemia and haemolysis-like presentations.',
            supporting: ['Anaemia severity warrants neoplasia screening if signalment or imaging supports it.'],
            confirms_if: ['Thoracic imaging or abdominal ultrasound identifies compatible mass or metastatic pattern.'],
            excludes_if: ['Imaging and staging do not support neoplasia and immune markers dominate.'],
        },
    ].sort((left, right) => right.score - left.score);
    const totalScore = candidates.reduce((sum, candidate) => sum + Math.max(candidate.score, 1), 0) || 1;
    return candidates.map((candidate, index) => ({
        rank: index + 1,
        condition: candidate.condition,
        confidence_percent: clamp(Math.round((Math.max(candidate.score, 1) / totalScore) * 100), 8, 92),
        mechanism: candidate.mechanism,
        supporting: candidate.supporting,
        confirms_if: candidate.confirms_if,
        excludes_if: candidate.excludes_if,
    }));
}

function buildImhaDiagnostics(patient: ImhaPatientContext): TreatmentConditionModuleReport['step_4_diagnostic_recommendations'] {
    return [
        { priority: 'urgent', test_name: 'PCV plus blood smear for spherocytes', rules_in_or_out: 'Confirms anaemia severity and immune haemolysis morphology.', expected_if_hypothesis_correct: 'Low PCV with spherocytes and compatible haemolysis pattern.' },
        { priority: 'urgent', test_name: 'Saline agglutination test', rules_in_or_out: 'Rapidly supports immune-mediated RBC agglutination.', expected_if_hypothesis_correct: 'Persistent agglutination after saline dilution.' },
        { priority: 'essential', test_name: 'Coombs test', rules_in_or_out: 'Confirms antibody-mediated erythrocyte destruction when positive in context.', expected_if_hypothesis_correct: patient.coombsPositive ? 'Already positive in submitted data.' : 'Positive or supportive immune marker.' },
        { priority: 'essential', test_name: 'Complete CBC with reticulocyte count and platelet count', rules_in_or_out: 'Separates regenerative IMHA, Evans syndrome, and marrow-limited mimics.', expected_if_hypothesis_correct: 'Regenerative anaemia with platelet status clarified.' },
        { priority: 'essential', test_name: 'Biochemistry panel including ALT, bilirubin, and creatinine', rules_in_or_out: 'Frames hepatic, haemolytic, renal, and medication-safety constraints.', expected_if_hypothesis_correct: 'Bilirubin may be elevated; organ compromise may alter treatment safety.' },
        { priority: 'essential', test_name: 'Tick-borne disease screening', rules_in_or_out: 'Excludes infectious mimics before immunosuppression decisions.', expected_if_hypothesis_correct: patient.eastAfricaContext ? 'Negative or co-infection clarified despite elevated regional prior.' : 'Negative or clinically reconciled with immune markers.' },
        { priority: 'optional', test_name: 'Thoracic radiographs', rules_in_or_out: 'Screens for neoplastic or cardiopulmonary comorbidity.', expected_if_hypothesis_correct: 'No competing primary neoplastic thoracic pattern, unless secondary IMHA trigger exists.' },
        { priority: 'optional', test_name: 'Abdominal ultrasound', rules_in_or_out: 'Screens splenic and hepatic triggers including haemangiosarcoma.', expected_if_hypothesis_correct: 'No primary mass driver, or trigger identified for secondary IMHA.' },
        { priority: 'advanced', test_name: 'Bone marrow aspirate if non-regenerative anaemia persists', rules_in_or_out: 'Assesses marrow disease when regeneration is absent or delayed.', expected_if_hypothesis_correct: 'Used only if expected regenerative response remains absent.' },
    ];
}

function buildImhaTreatmentPathway(
    patient: ImhaPatientContext,
    urgencyClassification: 'EMERGENCY' | 'URGENT' | 'STABLE',
): TreatmentConditionModuleReport['step_5_treatment_pathway'] {
    return [
        {
            tier: 'tier_1_emergency_stabilisation',
            title: 'TIER 1 - EMERGENCY STABILISATION',
            items: dedupeStrings([
                urgencyClassification === 'EMERGENCY' ? 'Emergency IMHA trigger is active; PCV and perfusion stabilization should not wait.' : 'Keep emergency stabilization ready if PCV falls or perfusion worsens.',
                'Blood product support threshold evaluation; compatibility and cross-match are clinician-determined.',
                'Oxygen support if severe anaemia or respiratory distress is present.',
                patient.packedCellVolumePercent != null ? `Current PCV input: ${patient.packedCellVolumePercent.toFixed(1)}%.` : 'Immediate PCV measurement remains a first action.',
            ]),
        },
        {
            tier: 'tier_2_short_term_stabilisation',
            title: 'TIER 2 - SHORT-TERM STABILISATION',
            items: [
                'Primary immunosuppression initiation after clinician review of infectious mimics and contraindications.',
                'Thromboembolism prophylaxis decision after bleeding-risk and platelet assessment.',
                'Reassess PCV, reticulocyte response, bilirubin, and perfusion trend frequently during the crisis window.',
            ],
        },
        {
            tier: 'tier_3_long_term_maintenance',
            title: 'TIER 3 - LONG-TERM / MAINTENANCE',
            items: [
                'Steroid taper protocol must be clinician-directed and response-based.',
                'Second-line agent timing if response is inadequate by the expected interval.',
                'Splenectomy evaluation criteria if refractory disease persists despite appropriate medical management.',
            ],
        },
    ];
}

function buildImhaMonitoring(patient: ImhaPatientContext): TreatmentConditionModuleReport['step_6_monitoring_protocol'] {
    return {
        summary: 'IMHA monitoring must track anaemia response, thrombosis risk, Evans syndrome overlap, and immunosuppression safety.',
        bullets: dedupeStrings([
            'PCV every 12 hours during crisis phase.',
            'Reticulocyte count every 48 hours to assess bone marrow response.',
            'Platelet count to screen for Evans syndrome.',
            'Daily clinical assessment for thromboembolism signs.',
            'Liver panel every 2 weeks during immunosuppressive therapy.',
            'Autoagglutination trend as a treatment response marker.',
            patient.tickPanelNegative ? 'Tick-borne screen is negative in current data.' : 'Tick-borne screening remains important before immunosuppression is finalized.',
        ]),
    };
}

function buildImhaConfidenceSummary(
    patient: ImhaPatientContext,
    differentials: TreatmentConditionModuleReport['step_3_aetiology_differential_ranking'],
): TreatmentConditionModuleReport['step_7_confidence_summary'] {
    const dataGaps = [
        patient.packedCellVolumePercent == null ? 'PCV is missing.' : null,
        !patient.coombsPositive ? 'Coombs confirmation is missing or not positive.' : null,
        !patient.tickPanelNegative ? 'Tick-borne exclusion is incomplete.' : null,
        !patient.regenerativeAnaemia ? 'Reticulocyte/regeneration status is incomplete.' : null,
        !patient.thrombocytopenia ? 'Platelet status should be confirmed to screen for Evans syndrome.' : null,
    ].filter((value): value is string => value != null);
    const score =
        42
        + (patient.spherocytesPresent ? 15 : 0)
        + (patient.coombsPositive ? 14 : 0)
        + (patient.autoagglutinationPositive ? 12 : 0)
        + (patient.paleMucousMembranes ? 6 : 0)
        + (patient.breedElevated ? 4 : 0)
        - Math.min(24, dataGaps.length * 4);
    const systemConfidenceScore = clamp(Math.round(score), 30, 96);
    const certaintyBand: TreatmentConditionModuleReport['step_7_confidence_summary']['certainty_band'] =
        systemConfidenceScore >= 85 ? 'Very High'
            : systemConfidenceScore >= 70 ? 'High'
                : systemConfidenceScore >= 55 ? 'Moderate'
                    : 'Low';
    const evidenceStrength: TreatmentConditionModuleReport['step_7_confidence_summary']['evidence_strength'] =
        patient.spherocytesPresent && (patient.coombsPositive || patient.autoagglutinationPositive)
            ? 'Strong'
            : patient.spherocytesPresent || patient.coombsPositive
                ? 'Moderate'
                : 'Weak';
    const calibration = patient.eastAfricaContext
        ? 'Applied - Nairobi/East African calibration keeps tick-borne disease co-infection prevalence elevated; IMHA and tick-borne haemolysis must be distinguished by testing before immunosuppression.'
        : 'Not materially applied - no Nairobi/East African region cue was supplied, but tick-borne mimics still require exclusion before immunosuppression.';

    return {
        system_confidence_score: systemConfidenceScore,
        certainty_band: certaintyBand,
        primary_diagnosis: differentials[0]?.condition ?? 'Primary IMHA',
        evidence_strength: evidenceStrength,
        data_gaps: dataGaps.length > 0 ? dataGaps : ['Major immediate data gaps are limited; clinician confirmation is still required before definitive therapy.'],
        nairobi_prevalence_calibration: calibration,
        recommended_action: patient.packedCellVolumePercent != null && patient.packedCellVolumePercent < 15
            ? 'Activate emergency IMHA stabilization, transfusion-threshold evaluation, cross-match workflow, and tick-borne exclusion immediately.'
            : 'Confirm PCV, smear, Coombs/agglutination status, platelet count, and tick-borne screen before finalizing immunosuppression and thromboprophylaxis.',
    };
}

function normalizeImhaToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
}

function shouldBuildHypocalcemiaModule(
    disease: DiseaseOntologyEntry,
    patient: HypocalcemiaPatientContext,
    rankedDifferentials: RankedDifferential[],
    supportingSignals: string[],
) {
    const diseaseMatch = HYPOCALCEMIA_CONDITION_MODULE_IDS.has(disease.id);
    const differentialMatch = rankedDifferentials.some((entry) =>
        entry.name === 'Puerperal Hypocalcemia (Eclampsia)'
        || entry.name === 'Acute Electrolyte Derangement',
    );
    const calciumSignal =
        patient.observations.has('hypocalcemia')
        || (patient.ionizedCalcium != null && patient.ionizedCalcium < 1.1)
        || (patient.totalCalcium != null && patient.totalCalcium < 8)
        || supportingSignals.includes('hypocalcemia')
        || (patient.postpartum && patient.hasTetanyPattern);

    if (disease.id === 'acute-pancreatitis' || disease.id === 'chronic-kidney-disease' || disease.id === 'acute-kidney-injury') {
        return calciumSignal;
    }

    return diseaseMatch || differentialMatch || calciumSignal;
}

function extractHypocalcemiaPatientContext(input: ConditionModuleBuildInput): HypocalcemiaPatientContext {
    const signature = input.input.inputSignature;
    const metadata = asRecord(signature.metadata);
    const history = asRecord(signature.history);
    const diagnosticTests = asRecord(signature.diagnostic_tests);
    const scalarEntries = collectScalarEntries(signature);
    const rawNarrative = collectStringsFromUnknown(signature).join(' | ').toLowerCase();
    const species = normalizeText(signature.species) ?? normalizeText(metadata.species);
    const breed = normalizeText(signature.breed) ?? normalizeText(metadata.breed);
    const ageYears = readMeasurementNumber(signature.age_years) ?? readMeasurementNumber(metadata.age_years);
    const weightKg = readMeasurementNumber(signature.weight_kg) ?? readMeasurementNumber(metadata.weight_kg);
    const sex = normalizeText(signature.sex) ?? normalizeText(metadata.sex);
    const bodyConditionScore =
        readMeasurementNumber(signature.body_condition_score)
        ?? readMeasurementNumber(signature.body_condition)
        ?? readMeasurementNumber(metadata.body_condition_score)
        ?? readMeasurementNumber(metadata.body_condition);
    const progression =
        normalizeText(history.progression)
        ?? (rawNarrative.includes('peracute') ? 'peracute' : rawNarrative.includes('subacute') ? 'subacute' : rawNarrative.includes('chronic') ? 'chronic' : rawNarrative.includes('acute') ? 'acute' : null);
    const region =
        normalizeText(signature.region)
        ?? normalizeText(history.geographic_region)
        ?? normalizeText(metadata.region)
        ?? normalizeText(input.input.context.regulatory_region);
    const observations = new Set(input.observations);
    const totalCalcium = readScalarEntryNumber(scalarEntries, /(total_?calcium|calcium_total|serum_?calcium)/i);
    const ionizedCalcium = readScalarEntryNumber(scalarEntries, /(ioni[sz]ed_?calcium|ioni[sz]ed_?ca|ionized_?ica|ionised_?ica|ica\b)/i);
    const albumin = readScalarEntryNumber(scalarEntries, /\balbumin\b/i);
    const phosphorus = readScalarEntryNumber(scalarEntries, /(phosphorus|phosphate)/i);
    const magnesium = readScalarEntryNumber(scalarEntries, /\bmagnesium\b|\bmg\b/i);
    const pth = readScalarEntryNumber(scalarEntries, /\bpth\b|parathyroid_?hormone/i);
    const calcitriol = readScalarEntryNumber(scalarEntries, /\bcalcitriol\b|vitamin_?d/i);
    const lipase = readScalarEntryNumber(scalarEntries, /\blipase\b|\bcpli\b|\bfpli\b/i);
    const ecgNarrative = readScalarEntryText(scalarEntries, /\becg\b|electrocardiogram/i);
    const bloodGasNarrative = readScalarEntryText(scalarEntries, /(blood_?gas|acid_?base|ph|alkalosis|acidosis)/i);
    const bunCreatinine =
        readScalarEntryText(scalarEntries, /(bun_?creatinine|creatinine|azotemia)/i)
        ?? normalizeText(asRecord(diagnosticTests.biochemistry).bun_creatinine);
    const postpartum = observations.has('postpartum') || /(postpartum|post-partum|post whelp|post-whelp|post queening|recent whelping|recent queening)/i.test(rawNarrative);
    const lactating = /(lactating|nursing|currently nursing|milk production|suckling)/i.test(rawNarrative);
    const pregnant = /(pregnant|gestat)/i.test(rawNarrative) || observations.has('pregnant');
    const sexLower = (sex ?? '').toLowerCase();
    const intactFemale =
        ((sexLower.includes('female') || sexLower.includes('bitch') || sexLower.includes('queen')) && !sexLower.includes('spayed') && !sexLower.includes('neutered'))
        || /(intact female|entire female|unspayed bitch|unspayed queen)/i.test(rawNarrative);
    const smallBreed = isSmallBreed(breed) || (weightKg != null && weightKg <= 8);
    const obese = (bodyConditionScore != null && bodyConditionScore >= 7) || /(obese|overweight)/i.test(rawNarrative);
    const acutePresentation =
        observations.has('acute_onset')
        || progression === 'acute'
        || progression === 'peracute'
        || /(acute onset|sudden onset|hours|same day)/i.test(rawNarrative);
    const chronicPresentation =
        observations.has('chronic_duration')
        || progression === 'chronic'
        || /(weeks|months|chronic)/i.test(rawNarrative);
    const hasTetanyPattern =
        observations.has('seizures')
        || observations.has('tremors')
        || observations.has('muscle_rigidity')
        || /(tetany|fasciculation|muscle twitch|muscle tremor|seizure|convulsion)/i.test(rawNarrative);

    return {
        species,
        breed,
        ageYears,
        sex,
        weightKg,
        bodyConditionScore,
        region,
        progression,
        observations,
        rawNarrative,
        totalCalcium,
        ionizedCalcium,
        albumin,
        phosphorus,
        magnesium,
        bunCreatinine,
        pth,
        calcitriol,
        lipase,
        ecgNarrative,
        bloodGasNarrative,
        postpartum,
        lactating,
        pregnant,
        intactFemale,
        smallBreed,
        obese,
        acutePresentation,
        chronicPresentation,
        hasTetanyPattern,
    };
}

function buildHypocalcemiaSignalTriage(
    patient: HypocalcemiaPatientContext,
    input: ConditionModuleBuildInput,
): TreatmentConditionModuleReport['step_1_signal_triage'] {
    const emergencyPattern =
        patient.hasTetanyPattern
        || patient.observations.has('hyperthermia')
        || patient.observations.has('tachycardia')
        || /prolonged qt|arrhythmia|bradycardia/i.test(patient.ecgNarrative ?? '')
        || input.input.emergencyLevel?.toUpperCase() === 'CRITICAL';
    const urgentPattern =
        emergencyPattern
        || patient.observations.has('weakness')
        || patient.observations.has('lethargy')
        || patient.observations.has('anorexia')
        || patient.observations.has('collapse');
    const correctedTotalCalcium = computeCorrectedTotalCalcium(patient.totalCalcium, patient.albumin);
    const urgencyClassification = patient.postpartum && patient.smallBreed && patient.hasTetanyPattern
        ? 'EMERGENCY'
        : emergencyPattern
            ? 'EMERGENCY'
            : urgentPattern
                ? 'URGENT'
                : 'STABLE';
    const bullets = dedupeStrings([
        emergencyPattern ? 'Tetany-pattern neurologic signs are present, so IV calcium readiness should not wait for a long differential workup.' : null,
        patient.postpartum && patient.smallBreed ? 'Post-partum small-breed status sharply increases puerperal tetany risk and triggers emergency escalation even before full lab confirmation.' : null,
        patient.ionizedCalcium != null ? `Ionized calcium available: ${patient.ionizedCalcium.toFixed(2)} mmol/L.` : null,
        patient.ionizedCalcium == null && correctedTotalCalcium != null ? `⚠️ IONIZED Ca NOT AVAILABLE — corrected total Ca ${correctedTotalCalcium.toFixed(2)} mg/dL used, reduced confidence.` : null,
        patient.ionizedCalcium == null && correctedTotalCalcium == null ? '⚠️ ASSUMPTION: No ionized calcium was provided, so urgency is being inferred from clinical signs and available total-calcium cues.' : null,
    ]);

    return {
        urgency_classification: urgencyClassification,
        summary: urgencyClassification === 'EMERGENCY'
            ? 'Neuromuscular instability is compatible with true hypocalcaemic crisis and should be stabilized immediately.'
            : urgencyClassification === 'URGENT'
                ? 'Compatible hypocalcaemia signs are present, but the current payload does not prove active tetany.'
                : 'Current data suggests a lower-acuity hypocalcaemia workup rather than immediate crash stabilization.',
        bullets,
    };
}

function buildHypocalcemiaSignalmentPrior(patient: HypocalcemiaPatientContext): TreatmentConditionModuleReport['step_2_species_signalment_prior'] {
    const species = normalizeSpecies(patient.species);
    const speciesLabel = species === 'dog' ? 'Dog' : species === 'cat' ? 'Cat' : patient.species ?? 'Small-animal patient';
    const bullets = dedupeStrings([
        species === 'dog' ? 'Dog prior raises suspicion for eclampsia, pancreatitis-associated hypocalcaemia, protein-losing enteropathy, and primary hypoparathyroidism.' : null,
        species === 'cat' ? 'Cat prior raises suspicion for CKD-associated hypocalcaemia and idiopathic hypoparathyroidism.' : null,
        patient.ageYears != null && patient.ageYears < 1 ? 'Young age keeps nutritional, neonatal, and malabsorptive causes in play.' : null,
        patient.ageYears != null && patient.ageYears >= 8 ? 'Older age increases renal and chronic-systemic causes.' : null,
        patient.postpartum || patient.lactating ? 'Post-partum/lactating status is a major Bayesian shift toward puerperal hypocalcaemia.' : null,
        patient.smallBreed ? 'Small-breed status further raises eclampsia prior.' : null,
        patient.obese ? 'Higher body condition adds support for pancreatitis as a hypocalcaemia driver.' : null,
        !patient.postpartum && !patient.lactating && !patient.pregnant
            ? '⚠️ ASSUMPTION: No reproductive-state cue was found, so endocrine and renal causes are weighted more heavily than eclampsia.'
            : null,
    ]);

    return {
        summary: `${speciesLabel} signalment is being used as the primary prior layer before ranking hypocalcaemia aetiologies.`,
        bullets,
    };
}

function buildHypocalcemiaDifferentials(
    input: ConditionModuleBuildInput,
    patient: HypocalcemiaPatientContext,
): TreatmentConditionModuleReport['step_3_aetiology_differential_ranking'] {
    const lowIonized = patient.ionizedCalcium != null && patient.ionizedCalcium < 1.1;
    const lowTotal = patient.totalCalcium != null && patient.totalCalcium < 8;
    const phosphorusHigh = patient.phosphorus != null && patient.phosphorus > 6;
    const magnesiumLow = patient.magnesium != null && patient.magnesium < 1.6;
    const albuminLow = patient.albumin != null && patient.albumin < 2.6;
    const azotemia = (patient.bunCreatinine ?? '').toLowerCase().includes('azot');
    const vomitingOrDiarrhea = patient.observations.has('vomiting') || patient.observations.has('diarrhea');
    const abdominalPattern = patient.observations.has('abdominal_pain') || patient.observations.has('abdominal_distension') || patient.lipase != null || input.disease.id === 'acute-pancreatitis';
    const toxinPattern = /(ethylene glycol|antifreeze|citrate|transfusion|furosemide|loop diuretic|parathyroidectomy|toxin exposure|toxicity)/i.test(patient.rawNarrative);
    const species = normalizeSpecies(patient.species);

    const candidates = [
        {
            condition: 'Puerperal Hypocalcaemia (Eclampsia)',
            score: 18 + (patient.postpartum ? 34 : 0) + (patient.lactating ? 18 : 0) + (patient.smallBreed ? 12 : 0) + (patient.intactFemale ? 8 : 0) + (patient.hasTetanyPattern ? 16 : 0) + (patient.acutePresentation ? 10 : 0) + (lowIonized || lowTotal || patient.observations.has('hypocalcemia') ? 24 : 0) - (patient.chronicPresentation ? 18 : 0) - (species === 'cat' ? 10 : 0),
            mechanism: 'Lactation-driven calcium demand exceeds PTH/calcitriol compensation, dropping ionized calcium and producing acute neuromuscular excitability.',
            supporting: dedupeStrings([
                patient.postpartum ? 'Recent post-partum timing is directly compatible with puerperal tetany.' : null,
                patient.lactating ? 'Active nursing/lactation increases calcium draw.' : null,
                patient.smallBreed ? 'Small-breed status raises eclampsia prior.' : null,
                patient.hasTetanyPattern ? 'Tremors, rigidity, or seizures fit hypocalcaemic tetany.' : null,
                lowIonized ? 'Ionized calcium is below the target range.' : null,
                !patient.postpartum && !patient.lactating ? '⚠️ ASSUMPTION: Reproductive cues were incomplete, so eclampsia remains provisional until history is verified.' : null,
            ]),
            confirms_if: [
                'Ionized calcium is low during the episode.',
                'The patient is lactating or recently post-partum.',
                'Clinical signs improve rapidly during ECG-monitored IV calcium administration.',
            ],
            excludes_if: [
                'Reproductive history rules out recent lactation/post-partum status.',
                'Ionized calcium is normal during active signs.',
                'A stronger competing explanation such as toxin exposure or renal failure is proven.',
            ],
        },
        {
            condition: 'Primary Hypoparathyroidism',
            score: 16 + (lowIonized || lowTotal || patient.observations.has('hypocalcemia') ? 24 : 0) + (phosphorusHigh ? 16 : 0) + (!patient.postpartum && !patient.lactating ? 12 : 0) + (species === 'dog' || species === 'cat' ? 10 : 0) - (azotemia ? 12 : 0) - (albuminLow ? 8 : 0),
            mechanism: 'Inadequate PTH reduces renal calcium conservation, bone mobilization, and calcitriol activation, producing true hypocalcaemia.',
            supporting: dedupeStrings([
                lowIonized || lowTotal ? 'Low calcium phenotype is present.' : null,
                phosphorusHigh ? 'Concurrent hyperphosphataemia supports impaired PTH effect.' : null,
                !patient.postpartum && !patient.lactating ? 'No strong lactation trigger is present.' : null,
                patient.pth != null ? `PTH value is available at ${patient.pth.toFixed(2)} and should be interpreted against calcium status.` : null,
                patient.pth == null ? '⚠️ ASSUMPTION: PTH was not supplied, so endocrine confirmation is still missing.' : null,
            ]),
            confirms_if: [
                'PTH is inappropriately low or non-elevated in a truly hypocalcaemic patient.',
                'Phosphorus is elevated without a better renal explanation.',
                'Hypocalcaemia persists outside the lactation window.',
            ],
            excludes_if: [
                'PTH is appropriately elevated for the degree of hypocalcaemia.',
                'A post-partum/lactational cause fully explains the episode.',
                'Correcting magnesium or albumin resolves the apparent hypocalcaemia pattern.',
            ],
        },
        {
            condition: 'CKD-Associated Hypocalcaemia',
            score: 14 + (species === 'cat' ? 18 : 0) + ((patient.ageYears ?? 0) >= 8 ? 14 : 0) + (azotemia ? 26 : 0) + (patient.chronicPresentation ? 14 : 0) + (phosphorusHigh ? 10 : 0) - (patient.postpartum && patient.hasTetanyPattern ? 20 : 0),
            mechanism: 'Renal disease lowers calcitriol generation and promotes phosphorus retention, reducing effective calcium homeostasis.',
            supporting: dedupeStrings([
                species === 'cat' ? 'Feline species prior supports CKD-related calcium disturbance.' : null,
                azotemia ? 'Renal values appear compatible with azotemia.' : null,
                patient.chronicPresentation ? 'The timeline sounds chronic rather than isolated and periparturient.' : null,
                phosphorusHigh ? 'High phosphorus strengthens renal-mediated hypocalcaemia.' : null,
                !azotemia ? '⚠️ ASSUMPTION: Full renal chemistry was not available, so CKD remains a lower-confidence systemic cause.' : null,
            ]),
            confirms_if: [
                'Azotemia and urine concentrating failure support chronic renal disease.',
                'Phosphorus is elevated and calcitriol deficiency is plausible.',
                'Ionized hypocalcaemia persists alongside chronic renal findings.',
            ],
            excludes_if: [
                'Renal values and urinalysis are normal.',
                'The episode is clearly post-partum eclampsia with rapid calcium response.',
                'A pancreatic or toxic cause explains the acute event better.',
            ],
        },
        {
            condition: 'Acute Pancreatitis-Associated Hypocalcaemia',
            score: 14 + (species === 'dog' ? 10 : 0) + (patient.obese ? 12 : 0) + (vomitingOrDiarrhea ? 16 : 0) + (abdominalPattern ? 18 : 0) + (patient.acutePresentation ? 10 : 0) + (input.disease.id === 'acute-pancreatitis' ? 24 : 0) - (patient.postpartum ? 12 : 0),
            mechanism: 'Inflammation and fat saponification in pancreatitis can reduce ionized calcium while critical illness worsens calcium handling.',
            supporting: dedupeStrings([
                vomitingOrDiarrhea ? 'GI signs are compatible with pancreatitis.' : null,
                abdominalPattern ? 'Abdominal pain, lipase signal, or pancreatic concern is present.' : null,
                patient.obese ? 'Higher body condition raises pancreatitis prior.' : null,
                input.disease.id === 'acute-pancreatitis' ? 'The current primary ontology diagnosis already includes acute pancreatitis.' : null,
                !abdominalPattern ? '⚠️ ASSUMPTION: Pancreatitis remains inferential until lipase or imaging data are supplied.' : null,
            ]),
            confirms_if: [
                'Pancreatic lipase or abdominal imaging supports pancreatitis.',
                'Ionized calcium is low in the setting of compatible GI/inflammatory disease.',
                'No stronger endocrine or renal explanation is found.',
            ],
            excludes_if: [
                'Pancreatic testing and abdominal imaging are unrevealing.',
                'A clear endocrine trigger such as eclampsia or hypoparathyroidism is proven.',
                'The patient lacks abdominal/GI evidence for pancreatitis.',
            ],
        },
        {
            condition: 'Pseudohypocalcaemia Secondary to Hypoalbuminaemia',
            score: 10 + (albuminLow ? 28 : 0) + (lowTotal ? 16 : 0) + (patient.ionizedCalcium == null ? 8 : 0) - (lowIonized ? 22 : 0),
            mechanism: 'Low albumin lowers total calcium concentration without necessarily lowering ionized, biologically active calcium.',
            supporting: dedupeStrings([
                albuminLow ? 'Albumin is reduced enough to make pseudohypocalcaemia plausible.' : null,
                lowTotal ? 'Total calcium appears low.' : null,
                patient.ionizedCalcium == null ? '⚠️ ASSUMPTION: Ionized calcium is missing, so true versus pseudo-hypocalcaemia cannot yet be separated confidently.' : null,
                patient.ionizedCalcium != null ? `Ionized calcium ${patient.ionizedCalcium.toFixed(2)} mmol/L helps adjudicate whether the total-calcium drop is biologically important.` : null,
            ]),
            confirms_if: [
                'Ionized calcium is normal despite low total calcium.',
                'Albumin is low enough to explain the total-calcium drop.',
                'Clinical neuromuscular signs are absent or disproportionate to the total-calcium change.',
            ],
            excludes_if: [
                'Ionized calcium is clearly low.',
                'Tetany/seizures resolve with IV calcium and true hypocalcaemia is documented.',
                'Another endocrine, renal, or pancreatic driver is confirmed.',
            ],
        },
        {
            condition: 'Toxic or Iatrogenic Hypocalcaemia',
            score: 8 + (toxinPattern ? 34 : 0) + (patient.acutePresentation ? 10 : 0) + (lowIonized || lowTotal ? 10 : 0),
            mechanism: 'Chelation, renal injury, or drug-related shifts can reduce serum calcium abruptly after toxic or iatrogenic exposure.',
            supporting: dedupeStrings([
                toxinPattern ? 'History includes a toxin, transfusion, or medication cue that can precipitate hypocalcaemia.' : null,
                patient.acutePresentation ? 'The onset appears abrupt.' : null,
                !toxinPattern ? '⚠️ ASSUMPTION: No clear toxin history was supplied, so this remains a lower-priority exclusion differential.' : null,
            ]),
            confirms_if: [
                'Exposure history confirms ethylene glycol, citrate load, loop diuretic effect, or post-surgical calcium loss.',
                'Laboratory changes are temporally linked to the exposure.',
                'Concurrent renal or acid-base findings support the toxic mechanism.',
            ],
            excludes_if: [
                'Exposure history is negative and no compatible treatment/surgery occurred.',
                'A more direct endocrine, renal, or pancreatic explanation is confirmed.',
            ],
        },
        {
            condition: 'Hypomagnesaemia-Mediated Hypocalcaemia',
            score: 8 + (magnesiumLow ? 34 : 0) + (patient.hasTetanyPattern ? 10 : 0) + (vomitingOrDiarrhea ? 8 : 0),
            mechanism: 'Magnesium depletion impairs PTH secretion and end-organ responsiveness, making hypocalcaemia refractory until magnesium is corrected.',
            supporting: dedupeStrings([
                magnesiumLow ? 'Magnesium is low enough to interfere with PTH signaling.' : null,
                patient.hasTetanyPattern ? 'Neuromuscular irritability is compatible with refractory electrolyte disease.' : null,
                patient.magnesium == null ? '⚠️ ASSUMPTION: Magnesium was not supplied, so a correctable cofactor deficit cannot be excluded.' : null,
            ]),
            confirms_if: [
                'Magnesium is low and calcium correction is incomplete until magnesium is supplemented.',
                'No better primary endocrine explanation is found.',
            ],
            excludes_if: [
                'Magnesium is normal and calcium responds normally to therapy.',
                'A stronger direct cause such as eclampsia or CKD is confirmed.',
            ],
        },
    ]
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);

    const totalScore = candidates.reduce((sum, candidate) => sum + candidate.score, 0) || 1;

    return candidates.map((candidate, index) => ({
        rank: index + 1,
        condition: candidate.condition,
        confidence_percent: clamp(Math.round((candidate.score / totalScore) * 100), 8, 92),
        mechanism: candidate.mechanism,
        supporting: candidate.supporting,
        confirms_if: candidate.confirms_if,
        excludes_if: candidate.excludes_if,
    }));
}

function buildHypocalcemiaDiagnostics(
    patient: HypocalcemiaPatientContext,
    primaryDiagnosis: string,
): TreatmentConditionModuleReport['step_4_diagnostic_recommendations'] {
    const correctedTotalCalcium = computeCorrectedTotalCalcium(patient.totalCalcium, patient.albumin);

    return [
        {
            priority: 'urgent',
            test_name: 'Ionized calcium',
            rules_in_or_out: 'Confirms true biologically active hypocalcaemia and separates it from pseudohypocalcaemia.',
            expected_if_hypothesis_correct: primaryDiagnosis.includes('Pseudohypocalcaemia')
                ? 'Ionized calcium remains normal despite low total calcium.'
                : 'Ionized calcium is below the target range, often <1.1 mmol/L.',
        },
        {
            priority: 'urgent',
            test_name: 'Continuous ECG during stabilization',
            rules_in_or_out: 'Identifies calcium-associated rhythm disturbance and treatment-limiting bradyarrhythmia/QT changes.',
            expected_if_hypothesis_correct: 'Prolonged QT or rhythm irritability may be present in symptomatic true hypocalcaemia.',
        },
        {
            priority: 'essential',
            test_name: 'Phosphorus + magnesium + albumin + glucose panel',
            rules_in_or_out: 'Separates hypoparathyroidism, hypomagnesaemia, pseudohypocalcaemia, and competing metabolic mimics.',
            expected_if_hypothesis_correct: primaryDiagnosis.includes('Hypoparathyroidism')
                ? 'High phosphorus with low calcium.'
                : primaryDiagnosis.includes('Pseudohypocalcaemia')
                    ? 'Low albumin with discordantly normal ionized calcium.'
                    : 'Low calcium with either low magnesium, low albumin, or parallel metabolic disturbance.',
        },
        {
            priority: 'essential',
            test_name: 'BUN/creatinine + urinalysis',
            rules_in_or_out: 'Assesses CKD/AKI contribution and whether renal disease is driving phosphorus and calcitriol abnormalities.',
            expected_if_hypothesis_correct: 'Azotemia and impaired urine concentration are present in renal-associated cases.',
        },
        {
            priority: 'optional',
            test_name: 'Pancreatic lipase and focused abdominal imaging',
            rules_in_or_out: 'Confirms or demotes pancreatitis as the inflammatory cause of hypocalcaemia.',
            expected_if_hypothesis_correct: 'Lipase and imaging support pancreatitis when GI or abdominal signs are present.',
        },
        {
            priority: 'advanced',
            test_name: 'PTH +/- calcitriol once stabilized',
            rules_in_or_out: 'Confirms endocrine calcium-regulation failure after true hypocalcaemia is documented.',
            expected_if_hypothesis_correct: 'PTH is inappropriately low/non-elevated for the degree of hypocalcaemia; calcitriol may also be low in renal disease.',
        },
        {
            priority: 'advanced',
            test_name: 'Blood gas / acid-base assessment',
            rules_in_or_out: 'Detects alkalosis-driven ionized calcium reduction and frames the urgency of metabolic correction.',
            expected_if_hypothesis_correct: 'Alkalosis can worsen ionized calcium suppression even when total calcium appears less dramatic.',
        },
        ...(patient.ionizedCalcium == null && correctedTotalCalcium != null
            ? [{
                priority: 'essential' as const,
                test_name: 'Albumin-corrected total calcium check',
                rules_in_or_out: 'Temporary surrogate only when ionized calcium is unavailable.',
                expected_if_hypothesis_correct: `⚠️ IONIZED Ca NOT AVAILABLE — corrected total Ca currently estimates ${correctedTotalCalcium.toFixed(2)} mg/dL, but ionized calcium should replace this as soon as possible.`,
            }]
            : []),
    ];
}

function buildHypocalcemiaTreatmentPathway(
    patient: HypocalcemiaPatientContext,
    primaryDiagnosis: string,
    urgencyClassification: 'EMERGENCY' | 'URGENT' | 'STABLE',
): TreatmentConditionModuleReport['step_5_treatment_pathway'] {
    const bolusLine = patient.weightKg != null
        ? `⚠️ VERIFY DOSE with attending clinician: Calcium gluconate 10% IV 0.5–1.5 mL/kg slow IV over 10–20 minutes (approximately ${(patient.weightKg * 0.5).toFixed(1)}-${(patient.weightKg * 1.5).toFixed(1)} mL total for ${patient.weightKg.toFixed(1)} kg).`
        : '⚠️ VERIFY DOSE with attending clinician: Calcium gluconate 10% IV 0.5–1.5 mL/kg slow IV over 10–20 minutes.';

    return [
        {
            tier: 'tier_1_emergency_stabilisation',
            title: 'TIER 1 - EMERGENCY STABILISATION',
            items: dedupeStrings([
                urgencyClassification === 'EMERGENCY'
                    ? 'Emergency trigger is active because tetany-pattern instability is present or strongly suspected.'
                    : 'Emergency trigger is not yet definitive, but the calcium rescue protocol should stay ready if tremors, tetany, or seizures emerge.',
                bolusLine,
                'Continuous ECG monitoring is mandatory; stop or slow administration if bradycardia or new arrhythmia develops.',
                'Expected response: neuromuscular improvement should begin within minutes if true hypocalcaemia is the main driver.',
                'If response is incomplete, reassess ionized calcium, magnesium, glucose, and the possibility of a competing diagnosis.',
            ]),
        },
        {
            tier: 'tier_2_short_term_stabilisation',
            title: 'TIER 2 - SHORT-TERM STABILISATION (24-72h)',
            items: dedupeStrings([
                'If repeated calcium support is required, transition to clinician-directed serial boluses or a calcium infusion with formulation-specific verification.',
                '⚠️ VERIFY DOSE with attending clinician: This module does not auto-set a calcium CRI rate without a verified formulation-to-elemental-calcium map.',
                'Correct concurrent hypomagnesaemia, acid-base derangement, glucose abnormalities, and dehydration in parallel.',
                'Recheck ionized calcium every 4-6 hours until the trend is stable, then widen the interval.',
                'Once signs are controlled, transition toward oral calcium support and aetiology-specific therapy.',
            ]),
        },
        {
            tier: 'tier_3_long_term_maintenance',
            title: 'TIER 3 - LONG-TERM / MAINTENANCE',
            items: dedupeStrings([
                `Primary diagnosis focus: ${primaryDiagnosis}.`,
                'Primary hypoparathyroidism -> ⚠️ VERIFY DOSE with attending clinician: lifelong oral calcium plus calcitriol 0.01-0.03 mcg/kg/day, titrated to ionized calcium.',
                'Eclampsia -> continue calcium supplementation, reduce nursing demand, and wean puppies/kittens early if recurrence risk is high.',
                'CKD-associated hypocalcaemia -> renal diet strategy, phosphorus control, calcitriol consideration, and serial renal/ionized calcium monitoring.',
                'Pancreatitis / critical illness -> treat the primary inflammatory disease while continuing calcium support only as needed for true ionized hypocalcaemia.',
                'Hypomagnesaemia -> replete magnesium because calcium control may remain refractory until magnesium is corrected.',
                'Pseudohypocalcaemia -> treat the hypoalbuminaemia source; calcium supplementation is not indicated if ionized calcium is normal.',
                'Toxic / iatrogenic causes -> remove the trigger, treat the toxin-specific emergency, and use calcium support only with ECG-guided clinician oversight.',
            ]),
        },
    ];
}

function buildHypocalcemiaMonitoring(patient: HypocalcemiaPatientContext): TreatmentConditionModuleReport['step_6_monitoring_protocol'] {
    return {
        summary: 'Monitoring should stay anchored to ionized calcium rather than total calcium alone, with active surveillance for overcorrection.',
        bullets: dedupeStrings([
            'Recheck ionized calcium every 4-6 hours during active stabilization; once stable, extend toward 12-24 hour intervals and then outpatient rechecks.',
            'Target ionized calcium range: 1.1-1.4 mmol/L for dogs and cats.',
            'Hypercalcaemia risk flags: vomiting, facial rubbing, polyuria/polydipsia, bradycardia, or new arrhythmia after supplementation.',
            'Co-monitor phosphorus, magnesium, renal values, hydration/perfusion status, and ECG when IV calcium is being administered.',
            'Escalate or refer if seizures persist, calcium remains unstable after initial therapy, hypoparathyroidism is suspected, CKD is advanced, or toxin/ICU care exceeds local monitoring capacity.',
            patient.bloodGasNarrative == null ? '⚠️ ASSUMPTION: Acid-base status was not supplied, so alkalosis as a suppressor of ionized calcium has not yet been excluded.' : null,
        ]),
    };
}

function buildHypocalcemiaConfidenceSummary(
    patient: HypocalcemiaPatientContext,
    differentials: TreatmentConditionModuleReport['step_3_aetiology_differential_ranking'],
): TreatmentConditionModuleReport['step_7_confidence_summary'] {
    const primary = differentials[0];
    const missingDataGaps = [
        patient.ionizedCalcium == null ? 'Ionized calcium is missing.' : null,
        patient.magnesium == null ? 'Magnesium is missing.' : null,
        patient.phosphorus == null ? 'Phosphorus is missing.' : null,
        patient.albumin == null ? 'Albumin is missing.' : null,
        patient.pth == null ? 'PTH is missing for endocrine confirmation.' : null,
        patient.bunCreatinine == null ? 'Renal values are incomplete.' : null,
        patient.lipase == null ? 'Pancreatic testing is incomplete if pancreatitis remains plausible.' : null,
    ].filter((value): value is string => value != null);
    const baseScore =
        (primary?.confidence_percent ?? 45)
        + (patient.ionizedCalcium != null ? 12 : 0)
        + (patient.postpartum ? 10 : 0)
        + (patient.hasTetanyPattern ? 8 : 0)
        - Math.min(24, missingDataGaps.length * 4);
    const systemConfidenceScore = clamp(Math.round(baseScore), 28, 96);
    const certaintyBand: TreatmentConditionModuleReport['step_7_confidence_summary']['certainty_band'] =
        systemConfidenceScore >= 85 ? 'Very High'
            : systemConfidenceScore >= 70 ? 'High'
                : systemConfidenceScore >= 55 ? 'Moderate'
                    : 'Low';
    const evidenceStrength: TreatmentConditionModuleReport['step_7_confidence_summary']['evidence_strength'] =
        patient.ionizedCalcium != null || (patient.postpartum && patient.hasTetanyPattern)
            ? 'Strong'
            : missingDataGaps.length <= 3
                ? 'Moderate'
                : 'Weak';
    const nairobiCalibration = patient.region != null && /(nairobi|kenya|east[_ -]?africa|ke\b)/i.test(patient.region)
        ? 'Applied - Nairobi/East African prevalence priors remained active, but this ranking stayed physiology-dominant rather than vector-borne.'
        : 'Applied - Nairobi-calibrated prevalence priors were active, but they did not materially outweigh the physiology-first hypocalcaemia pattern.';
    const recommendedAction = patient.postpartum && patient.smallBreed && patient.hasTetanyPattern
        ? 'Start ECG-monitored IV calcium gluconate immediately, obtain ionized calcium plus magnesium/phosphorus now, and reduce nursing demand while confirming puerperal tetany.'
        : patient.hasTetanyPattern
            ? 'Start ECG-monitored calcium rescue immediately while obtaining ionized calcium, magnesium, phosphorus, albumin, and renal values.'
            : 'Measure ionized calcium now and complete the magnesium/phosphorus/albumin/renal panel before committing to long-term supplementation.';

    return {
        system_confidence_score: systemConfidenceScore,
        certainty_band: certaintyBand,
        primary_diagnosis: primary?.condition ?? 'Hypocalcaemia syndrome under evaluation',
        evidence_strength: evidenceStrength,
        data_gaps: missingDataGaps.length > 0
            ? missingDataGaps
            : ['Major immediate data gaps are limited; clinician confirmation is still required before definitive long-term therapy.'],
        nairobi_prevalence_calibration: nairobiCalibration,
        recommended_action: recommendedAction,
    };
}

function deriveSupportingSignals(disease: DiseaseOntologyEntry, observations: string[]) {
    const observationSet = new Set(observations);
    return [
        ...disease.key_clinical_features.map((feature) => feature.term),
        ...disease.supporting_features.map((feature) => feature.term),
        ...disease.lab_signatures.map((feature) => feature.term),
    ]
        .filter((term, index, all) => all.indexOf(term) === index)
        .filter((term) => observationSet.has(term))
        .map((term) => term.replace(/_/g, ' '));
}

function deriveContextFlags(input: {
    disease: DiseaseOntologyEntry;
    species: string | null;
    observations: string[];
    context: TreatmentRecommendationContext;
    contradictionFlags: string[];
}) {
    const observationSet = new Set(input.observations);
    const flags = new Set<ContraindicationFlag>();
    const normalizedSpecies = normalizeSpecies(input.species);

    if (normalizedSpecies && !input.disease.species_relevance.includes(normalizedSpecies)) {
        flags.add('species_mismatch');
    }
    if (hasAny(observationSet, ['azotemia', 'oliguria', 'anuria'])) flags.add('renal_compromise');
    if (hasAny(observationSet, ['icterus', 'head_pressing', 'mentation_change']) || input.disease.id === 'hepatic-encephalopathy') flags.add('hepatic_compromise');
    if (hasAny(observationSet, ['bleeding', 'coagulopathy', 'petechiae', 'ecchymosis', 'melena', 'hematemesis'])) flags.add('bleeding_risk');
    if (hasAny(observationSet, ['pregnant'])) flags.add('pregnancy');
    if (hasAny(observationSet, ['collapse', 'pale_mucous_membranes', 'tachycardia'])) flags.add('shock_or_instability');
    if (hasAny(observationSet, ['seizures', 'tremors', 'ataxia', 'paralysis'])) flags.add('neurologic_instability');
    if (hasAny(observationSet, ['dyspnea', 'respiratory_distress', 'open_mouth_breathing', 'cyanosis'])) flags.add('respiratory_compromise');
    if (hasAny(observationSet, ['dehydration', 'vomiting', 'diarrhea'])) flags.add('dehydration');
    if (input.context.regulatory_region && LOW_RESOURCE_JURISDICTIONS.has(input.context.regulatory_region.trim().toLowerCase())) {
        flags.add('jurisdiction_review_required');
    }
    for (const flag of input.contradictionFlags) {
        if (flag.includes('contraindication') || flag.includes('mismatch')) {
            flags.add('jurisdiction_review_required');
        }
    }
    return flags;
}

function deriveRegistryContextFlags(input: BuildBundleInput, request: InferenceRequest): Set<ContraindicationFlag> {
    const flags = new Set<ContraindicationFlag>();
    const observations = new Set([
        ...extractOntologyObservations(input.inputSignature),
        ...input.context.comorbidities.map((entry) => entry.toLowerCase().replace(/[\s-]+/g, '_')),
        ...input.context.lab_flags.map((entry) => entry.toLowerCase().replace(/[\s-]+/g, '_')),
    ]);
    const rawNarrative = collectStringsFromUnknown(input.inputSignature).join(' ').toLowerCase();
    const diagnosticTests = asRecord(input.inputSignature.diagnostic_tests);
    const biochemistry = asRecord(diagnosticTests.biochemistry);

    if (hasAny(observations, ['azotemia', 'oliguria', 'anuria']) || normalizeText(biochemistry.bun_creatinine) === 'azotemia' || /renal|kidney|azotem/.test(rawNarrative)) {
        flags.add('renal_compromise');
    }
    if (hasAny(observations, ['icterus', 'head_pressing', 'mentation_change']) || /hepatic|liver|icter/.test(rawNarrative)) {
        flags.add('hepatic_compromise');
    }
    if (hasAny(observations, ['bleeding', 'coagulopathy', 'petechiae', 'ecchymosis', 'melena', 'hematemesis']) || /bleed|coagul/.test(rawNarrative)) {
        flags.add('bleeding_risk');
    }
    if (hasAny(observations, ['pregnant']) || /pregnan|gestat/.test(rawNarrative)) {
        flags.add('pregnancy');
    }
    if (hasAny(observations, ['collapse', 'pale_mucous_membranes', 'tachycardia']) || /shock|collapse|unstable/.test(rawNarrative)) {
        flags.add('shock_or_instability');
    }
    if (hasAny(observations, ['seizures', 'tremors', 'ataxia', 'paralysis'])) {
        flags.add('neurologic_instability');
    }
    if (hasAny(observations, ['dyspnea', 'respiratory_distress', 'open_mouth_breathing', 'cyanosis'])) {
        flags.add('respiratory_compromise');
    }
    if (hasAny(observations, ['dehydration', 'vomiting', 'diarrhea']) || /dehydrat/.test(rawNarrative)) {
        flags.add('dehydration');
    }
    if (input.context.regulatory_region && LOW_RESOURCE_JURISDICTIONS.has(input.context.regulatory_region.trim().toLowerCase())) {
        flags.add('jurisdiction_review_required');
    }
    if (request.species && normalizeText(request.species) == null) {
        flags.add('species_mismatch');
    }
    return flags;
}

function buildDrugLevelContraindications(input: {
    proposedDrugClasses: string[];
    species: string | null;
    breed: string | null;
    conditions: string[];
    contextFlags: Set<ContraindicationFlag>;
}): string[] {
    const drugLevelContraindications: string[] = [];
    try {
        const die = getDrugInteractionEngine();
        const proposedDrugClasses = input.proposedDrugClasses;
        const species = normalizeDrugInteractionSpecies(input.species);
        const conditions = input.conditions;
        const resolvedDrugKeys = resolveDrugKeysForClasses(proposedDrugClasses);

        if (resolvedDrugKeys.length > 1) {
            const interactions = die.check({ drugs: resolvedDrugKeys, species, conditions });
            drugLevelContraindications.push(
                ...interactions.interactions
                    .filter((interaction) => interaction.severity === 'major' || interaction.severity === 'contraindicated')
                    .map((interaction) => `${interaction.drug1} x ${interaction.drug2}: ${interaction.clinicalEffect}`),
            );
        }

        if (input.contextFlags.has('hepatic_compromise')) {
            drugLevelContraindications.push(...getHepaticContraindicationsForClasses(proposedDrugClasses, species));
        }

        if (input.contextFlags.has('renal_compromise')) {
            drugLevelContraindications.push(...getRenalContraindicationsForClasses(proposedDrugClasses, species));
        }

        drugLevelContraindications.push(...getBreedDrugRisks(proposedDrugClasses, species, input.breed ?? ''));
    } catch { /* non-critical */ }
    return Array.from(new Set(drugLevelContraindications));
}

function getHepaticContraindicationsForClasses(proposedDrugClasses: string[], _species: string): string[] {
    return resolveDrugKeysForClasses(proposedDrugClasses)
        .flatMap((drugKey) => {
            const rule = HEPATIC_DOSE_ADJUSTMENTS[drugKey];
            if (!rule) return [];
            if (rule.severe.avoid) {
                return [`${formatDrugKey(drugKey)} class review: avoid or replace in severe hepatic compromise. ${rule.severe.notes}`];
            }
            if (rule.moderate.reduction > 0 || rule.severe.reduction > 0) {
                return [`${formatDrugKey(drugKey)} class review: hepatic dose adjustment required. ${rule.moderate.notes}`];
            }
            return [];
        });
}

function getRenalContraindicationsForClasses(proposedDrugClasses: string[], _species: string): string[] {
    return resolveDrugKeysForClasses(proposedDrugClasses)
        .flatMap((drugKey) => {
            const rule = RENAL_DOSE_ADJUSTMENTS[drugKey];
            if (!rule) return [];
            if (rule.avoid_stage != null && rule.avoid_stage <= 3) {
                return [`${formatDrugKey(drugKey)} class review: avoid or replace in advanced renal compromise. ${rule.stage3.notes ?? rule.stage4.notes ?? 'Renal adjustment required.'}`];
            }
            if (rule.stage3.reduction > 0 || rule.stage4.reduction > 0) {
                return [`${formatDrugKey(drugKey)} class review: renal dose adjustment required. ${rule.stage3.notes ?? rule.stage4.notes ?? 'Renal adjustment required.'}`];
            }
            return [];
        });
}

function getBreedDrugRisks(proposedDrugClasses: string[], species: string, breed: string): string[] {
    const normalizedBreed = breed.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!normalizedBreed) return [];
    const breedRisk = BREED_DRUG_RISKS[normalizedBreed];
    if (!breedRisk || breedRisk.species !== species) return [];
    const drugKeys = resolveDrugKeysForClasses(proposedDrugClasses);
    const warnings: string[] = [];
    for (const drugKey of drugKeys) {
        if (breedRisk.avoid.includes(drugKey)) {
            warnings.push(`${formatDrugKey(drugKey)} class review: avoid in ${breed}. ${breedRisk.notes}`);
        }
        if (breedRisk.useWithCaution.includes(drugKey)) {
            warnings.push(`${formatDrugKey(drugKey)} class review: use with caution in ${breed}. ${breedRisk.notes}`);
        }
        const elevated = breedRisk.elevatedRisk.find((risk) => risk.drug.toLowerCase().replace(/[^a-z0-9]+/g, '_') === drugKey);
        if (elevated) {
            warnings.push(`${formatDrugKey(drugKey)} class review: ${elevated.risk}`);
        }
    }
    return warnings;
}

function resolveDrugKeysForClasses(proposedDrugClasses: string[]): string[] {
    const keys = new Set<string>();
    for (const label of proposedDrugClasses) {
        const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        for (const key of [
            ...Object.keys(HEPATIC_DOSE_ADJUSTMENTS),
            ...Object.keys(RENAL_DOSE_ADJUSTMENTS),
            'meloxicam',
            'prednisolone',
            'enrofloxacin',
            'furosemide',
            'benazepril',
        ]) {
            if (normalized.includes(key)) keys.add(key);
        }
        if (/glucocorticoid|corticosteroid|immunosuppress/.test(normalized)) keys.add('prednisolone');
        if (/anti_inflammatory|nsaid|analgesic|pain/.test(normalized)) keys.add('meloxicam');
        if (/antimicrobial|antibiotic|infectious/.test(normalized)) {
            keys.add('enrofloxacin');
            keys.add('metronidazole');
            keys.add('doxycycline');
        }
        if (/diuretic|fluid_overload|congestion/.test(normalized)) keys.add('furosemide');
        if (/ace|vasoactive|cardiac/.test(normalized)) keys.add('benazepril');
        if (/anticonvulsant|seizure/.test(normalized)) keys.add('phenobarbital');
    }
    return Array.from(keys);
}

function normalizeDrugInteractionSpecies(value: string | null): string {
    const normalized = normalizeText(value)?.toLowerCase() ?? '';
    if (normalized === 'dog' || normalized === 'canine' || normalized === 'puppy') return 'canine';
    if (normalized === 'cat' || normalized === 'feline' || normalized === 'kitten') return 'feline';
    return normalized || 'canine';
}

function formatDrugKey(value: string): string {
    return value.replace(/_/g, ' ');
}

function extractAlternativeDiagnoses(outputPayload: Record<string, unknown>, primaryDiagnosis: string) {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const differentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    return differentials
        .map((entry) => {
            if (typeof entry === 'string') return normalizeOntologyDiseaseName(entry);
            if (typeof entry === 'object' && entry !== null) {
                return normalizeOntologyDiseaseName((entry as Record<string, unknown>).name);
            }
            return null;
        })
        .filter((value): value is string => value != null && value !== primaryDiagnosis)
        .slice(0, 3);
}

function extractContradictionFlags(outputPayload: Record<string, unknown>) {
    const contradictionAnalysis = asRecord(outputPayload.contradiction_analysis);
    const flags = contradictionAnalysis.contradiction_flags;
    if (!Array.isArray(flags)) return [];
    return flags
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim());
}

function normalizeTreatmentContext(context: TreatmentRecommendationContext): TreatmentRecommendationContext {
    return {
        resource_profile: context.resource_profile,
        regulatory_region: normalizeText(context.regulatory_region),
        care_environment: normalizeText(context.care_environment),
        comorbidities: context.comorbidities.map((item) => item.trim()).filter(Boolean),
        lab_flags: context.lab_flags.map((item) => item.trim()).filter(Boolean),
    };
}

function buildRegulatoryNotes(region: string | null) {
    const normalized = normalizeText(region);
    if (!normalized) {
        return ['Jurisdictional review required before translating any pathway into an actual prescription, controlled-drug order, or restricted procedure.'];
    }
    return [
        `Regulatory placeholder: verify ${normalized} veterinary prescribing, antidote access, and procedure rules before acting on this pathway.`,
        'This support layer intentionally avoids jurisdiction-specific dosing or human medical protocols.',
    ];
}

function rankOption(
    option: TreatmentCandidateRecord,
    context: TreatmentRecommendationContext,
    emergencyLevel: string | null,
    severityScore: number | null,
) {
    let score = option.treatment_pathway === 'gold_standard' ? 30 : option.treatment_pathway === 'resource_constrained' ? 20 : 10;
    if (context.resource_profile === 'low_resource') {
        score += option.treatment_pathway === 'resource_constrained' ? 8 : option.treatment_pathway === 'gold_standard' ? -6 : 2;
    } else {
        score += option.treatment_pathway === 'gold_standard' ? 5 : 0;
    }
    if (normalizeText(emergencyLevel)?.toUpperCase() === 'CRITICAL' || (severityScore ?? 0) >= 0.85) {
        score += option.urgency_level === 'emergent' ? 6 : option.urgency_level === 'urgent' ? 3 : -2;
    }
    score -= option.detected_contraindications.length * 5;
    score += Math.round(option.uncertainty.recommendation_confidence * 10);
    return score;
}

function findDiseaseEntry(name: string) {
    return getMasterDiseaseOntology().find((entry) => entry.name === name) ?? null;
}

function formatDiseaseList(values: string[]) {
    return values.join(', ');
}

function dedupeStrings(values: Array<string | null | undefined>) {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const value of values) {
        const normalized = normalizeText(value);
        if (!normalized) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        ordered.push(normalized);
    }
    return ordered;
}

function normalizeSpecies(value: string | null | undefined) {
    const normalized = normalizeText(value)?.toLowerCase() ?? null;
    if (!normalized) return null;
    const aliases: Record<string, string> = {
        canine: 'dog',
        dog: 'dog',
        puppy: 'dog',
        feline: 'cat',
        cat: 'cat',
        kitten: 'cat',
        equine: 'horse',
        horse: 'horse',
        bovine: 'cow',
        cow: 'cow',
    };
    return aliases[normalized] ?? normalized;
}

function hasAny(values: Set<string>, targets: string[]) {
    return targets.some((target) => values.has(target));
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function computeCorrectedTotalCalcium(totalCalcium: number | null, albumin: number | null) {
    if (totalCalcium == null || albumin == null) return null;
    return totalCalcium - albumin + 3.5;
}

function isSmallBreed(breed: string | null) {
    if (!breed) return false;
    return /(chihuahua|yorkshire terrier|yorkie|pomeranian|maltese|toy poodle|miniature poodle|mini poodle|papillon|pug|shih tzu|miniature schnauzer|dachshund|jack russell|bichon|pekingese|pinscher)/i.test(breed);
}

function collectScalarEntries(value: unknown, prefix = ''): Array<{ path: string; value: unknown }> {
    const entries: Array<{ path: string; value: unknown }> = [];
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            const path = prefix ? `${prefix}.${index}` : String(index);
            if (typeof item === 'object' && item != null) {
                entries.push(...collectScalarEntries(item, path));
            } else {
                entries.push({ path, value: item });
            }
        });
        return entries;
    }
    if (typeof value !== 'object' || value == null) {
        if (prefix) entries.push({ path: prefix, value });
        return entries;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof nested === 'object' && nested != null) {
            entries.push(...collectScalarEntries(nested, path));
        } else {
            entries.push({ path, value: nested });
        }
    }
    return entries;
}

function collectStringsFromUnknown(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
    if (Array.isArray(value)) return value.flatMap((entry) => collectStringsFromUnknown(entry));
    if (typeof value === 'object' && value != null) {
        return Object.values(value as Record<string, unknown>).flatMap((entry) => collectStringsFromUnknown(entry));
    }
    return [];
}

function readScalarEntryNumber(entries: Array<{ path: string; value: unknown }>, matcher: RegExp) {
    for (const entry of entries) {
        if (!matcher.test(entry.path)) continue;
        const value = readMeasurementNumber(entry.value);
        if (value != null) return value;
    }
    return null;
}

function readScalarEntryText(entries: Array<{ path: string; value: unknown }>, matcher: RegExp) {
    for (const entry of entries) {
        if (!matcher.test(entry.path)) continue;
        const value = normalizeText(entry.value);
        if (value != null) return value;
    }
    return null;
}

function readMeasurementNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: unknown) {
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

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

export function __getMasterDiseaseOntologyForTreatmentTest() {
    return getMasterDiseaseOntology();
}
