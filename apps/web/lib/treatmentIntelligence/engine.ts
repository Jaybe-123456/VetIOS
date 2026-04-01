import {
    extractOntologyObservations,
    getMasterDiseaseOntology,
    normalizeOntologyDiseaseName,
    type DiseaseOntologyEntry,
} from '../ai/diseaseOntology';
import type {
    TreatmentCandidateRecord,
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

export function buildTreatmentRecommendationBundle(input: BuildBundleInput): TreatmentRecommendationBundle {
    const canonicalDisease = normalizeOntologyDiseaseName(input.diagnosisLabel);
    if (!canonicalDisease) {
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
    };
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
        case 'hypoadrenocorticism':
            return buildHypoadrenoPlaybook(disease);
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
