import { buildAntigravityClinicalSignal, type AntigravityClinicalSignal } from '@/lib/ai/antigravitySignal';
import {
    detectContradictions,
    type ContradictionDetail,
    type ContradictionResult,
} from '@/lib/ai/contradictionEngine';
import {
    extractClinicalTermsFromText,
    getClinicalTermDisplayLabel,
    getClinicalVocabularyEntry,
    normalizeClinicalTerm,
    normalizeClinicalTermArray,
} from '@/lib/clinicalSignal/clinicalVocabulary';
import {
    buildSignalWeightProfile,
    type SignalWeightProfile,
    type WeightedSignal,
} from '@/lib/clinicalSignal/signalWeightEngine';
import {
    resolveFailurePatternProfile,
    type FailurePatternProfile,
} from '@/lib/learning/failureCorrectionPatterns';

const ENGINE_VERSION = 'failure-correction-v1';
const DEFAULT_GENERIC_SIGNALS = new Set([
    'vomiting',
    'diarrhea',
    'lethargy',
    'anorexia',
    'dehydration',
    'weakness',
    'fever',
    'cough',
    'ocular_discharge',
    'nasal_discharge',
]);

interface ContradictionTemplate {
    rule_id: string;
    when_all_present?: string[];
    when_any_present?: string[];
    contradiction_score_delta: number;
    severity: 'moderate' | 'high';
    explanation: string;
    generalization: string;
}

interface FeatureEnrichmentTemplate {
    rule_id: string;
    when_all_present?: string[];
    when_any_present?: string[];
    add_inferred_features: string[];
    rationale: string;
    generalization: string;
}

const CONTRADICTION_TEMPLATES: Record<string, ContradictionTemplate> = {
    bradycardia_with_dehydration: {
        rule_id: 'bradycardia_with_dehydration',
        when_all_present: ['bradycardia', 'dehydration'],
        contradiction_score_delta: 0.34,
        severity: 'high',
        explanation: 'Relative bradycardia despite dehydration is a physiologic mismatch that should interrupt generic gastrointestinal interpretation.',
        generalization: 'Unexpected cardiovascular findings during hypovolemic or shock-like illness should elevate endocrine, metabolic, or toxicologic review.',
    },
    severe_abdominal_distension_without_pain_behavior: {
        rule_id: 'severe_abdominal_distension_without_pain_behavior',
        when_all_present: ['abdominal_distension', 'pain_behavior_absent'],
        contradiction_score_delta: 0.26,
        severity: 'moderate',
        explanation: 'Marked abdominal distension paired with absent pain behavior is unusual and should trigger structural emergency review.',
        generalization: 'High-acuity structural signs paired with unusually reassuring behavior should increase ambiguity scoring.',
    },
    severe_illness_with_normal_activity: {
        rule_id: 'severe_illness_with_normal_activity',
        when_all_present: ['normal_activity'],
        when_any_present: ['collapse', 'dyspnea', 'abdominal_distension', 'pale_mucous_membranes', 'cyanosis'],
        contradiction_score_delta: 0.22,
        severity: 'moderate',
        explanation: 'Reported normal activity conflicts with severe systemic illness signals and should suppress low-risk interpretations.',
        generalization: 'Reassuring owner descriptors should not erase high-acuity physiologic or structural findings.',
    },
    urinary_obstruction_with_normal_urination: {
        rule_id: 'urinary_obstruction_with_normal_urination',
        when_all_present: ['urinary_obstruction_pattern', 'normal_urination'],
        contradiction_score_delta: 0.28,
        severity: 'high',
        explanation: 'Obstructive urinary signs conflict with reported normal urination and should be surfaced as a documentation mismatch.',
        generalization: 'Outflow-obstruction patterns should override reassuring elimination history until reconciled.',
    },
    respiratory_distress_with_normal_effort: {
        rule_id: 'respiratory_distress_with_normal_effort',
        when_all_present: ['dyspnea', 'normal_respiratory_effort'],
        contradiction_score_delta: 0.24,
        severity: 'high',
        explanation: 'Respiratory distress paired with reported normal effort is internally inconsistent and should raise safety ambiguity.',
        generalization: 'Gas-exchange or ventilation distress should never be flattened by reassuring effort language alone.',
    },
    severe_illness_with_normal_appetite: {
        rule_id: 'severe_illness_with_normal_appetite',
        when_all_present: ['normal_appetite'],
        when_any_present: ['collapse', 'dyspnea', 'dehydration', 'fever', 'abdominal_distension'],
        contradiction_score_delta: 0.18,
        severity: 'moderate',
        explanation: 'Normal appetite can be real, but it is atypical when paired with high-acuity illness signals and should widen the differential.',
        generalization: 'Preserved appetite should not prematurely down-rank serious systemic processes when other red flags are present.',
    },
};

const ENRICHMENT_TEMPLATES: FeatureEnrichmentTemplate[] = [
    {
        rule_id: 'infer_hemodynamic_mismatch_flag',
        when_all_present: ['bradycardia', 'dehydration'],
        add_inferred_features: ['hemodynamic_mismatch_flag', 'endocrine_metabolic_instability_pattern'],
        rationale: 'Relative bradycardia in a dehydrated patient is a high-value mismatch pattern rather than a generic gastrointestinal signal.',
        generalization: 'Unexpected cardiocirculatory pairings should create a dedicated instability feature for downstream reasoning.',
    },
    {
        rule_id: 'infer_recurrent_fluid_responsive_instability',
        when_all_present: ['recurrent_episodic_course', 'fluid_responsive_instability'],
        add_inferred_features: ['supportive_care_transient_response', 'endocrine_metabolic_instability_pattern'],
        rationale: 'Recurrent episodes with only temporary improvement after fluids should be encoded as a hidden instability pattern.',
        generalization: 'Transient supportive-care response plus recurrence should elevate intermittent endocrine or metabolic processes.',
    },
    {
        rule_id: 'infer_mechanical_upper_gi_emergency',
        when_all_present: ['retching_unproductive', 'abdominal_distension'],
        add_inferred_features: ['mechanical_upper_gi_emergency_pattern', 'structural_perfusion_risk'],
        rationale: 'Nonproductive retching plus abdominal distension is more informative than generic vomiting language.',
        generalization: 'Mechanical obstruction signatures should be explicitly represented as pattern-level features.',
    },
    {
        rule_id: 'infer_lower_urinary_obstruction_pattern',
        when_all_present: ['urinary_obstruction_pattern', 'stranguria'],
        add_inferred_features: ['lower_urinary_obstruction_pattern', 'postrenal_emergency_flag'],
        rationale: 'Stranguria with obstructive elimination pattern should create a direct obstruction feature, not remain a loose symptom bundle.',
        generalization: 'Outflow failure signs should collapse into a dedicated post-renal obstruction pattern feature.',
    },
    {
        rule_id: 'infer_reproductive_sepsis_pattern',
        when_all_present: ['intact_female', 'recent_estrus', 'vaginal_discharge'],
        add_inferred_features: ['reproductive_sepsis_pattern', 'uterine_source_risk'],
        rationale: 'Recent estrus in an intact female with discharge carries more discriminatory value than generic lethargy or vomiting.',
        generalization: 'Reproductive status and timing should be promoted into explicit septic-source features.',
    },
    {
        rule_id: 'infer_gas_exchange_failure_pattern',
        when_all_present: ['dyspnea'],
        when_any_present: ['cyanosis', 'normal_respiratory_effort'],
        add_inferred_features: ['gas_exchange_failure_pattern', 'respiratory_safety_override'],
        rationale: 'Dyspnea with gas-exchange compromise or reporting mismatch needs a dedicated respiratory failure feature.',
        generalization: 'Severe respiratory patterns should receive a safety override feature before downstream differential ranking.',
    },
    {
        rule_id: 'infer_toxicologic_neurosecretory_pattern',
        when_any_present: ['tremors', 'seizures', 'hypersalivation', 'toxin_exposure_possible'],
        add_inferred_features: ['toxicologic_neurosecretory_pattern'],
        rationale: 'Neurologic and secretory clusters are more specific than isolated vomiting or lethargy.',
        generalization: 'Toxicologic pattern features should be created when neurosecretory signs cluster together.',
    },
];

export interface FailureCorrectionInput {
    case_input: Record<string, unknown>;
    model_output?: Record<string, unknown> | null;
    predicted_condition: string | null;
    target_condition: string | null;
    predicted_condition_class?: string | null;
    target_condition_class?: string | null;
    diagnosis_feature_importance?: Record<string, unknown> | null;
    contradiction_analysis?: Record<string, unknown> | null;
    signal_weight_profile?: SignalWeightProfile | Record<string, unknown> | null;
    clinical_signal?: AntigravityClinicalSignal | Record<string, unknown> | null;
}

export interface FailureDiagnosisSummary {
    dominant_wrong_signals: string[];
    missing_or_underweighted_signals: string[];
    overweighted_generic_signals: string[];
    temporal_pattern_misinterpretation: string[];
    ignored_contradictions: string[];
    missing_contextual_features: string[];
    summary_text: string;
}

export interface FailurePatternSnapshot {
    label: string;
    family: string;
    description: string;
}

export interface SignalWeightingUpdateRule {
    rule_id: string;
    when_all_present?: string[];
    when_any_present?: string[];
    boost_signals: string[];
    penalize_signals: string[];
    boost_pattern_families: string[];
    penalize_pattern_families: string[];
    boost_weight_delta: number;
    penalize_weight_delta: number;
    rationale: string;
    generalization: string;
}

export interface ContradictionRuleUpdate {
    rule_id: string;
    when_all_present?: string[];
    when_any_present?: string[];
    contradiction_score_delta: number;
    severity: 'moderate' | 'high';
    explanation: string;
    generalization: string;
}

export interface TemporalPatternRule {
    rule_id: string;
    when_all_present?: string[];
    when_any_present?: string[];
    add_temporal_flags: string[];
    boost_pattern_families: string[];
    penalize_pattern_families: string[];
    rationale: string;
}

export interface FeatureEnrichmentRule {
    rule_id: string;
    when_all_present?: string[];
    when_any_present?: string[];
    add_inferred_features: string[];
    rationale: string;
    generalization: string;
}

export interface FailureCorrectionReport {
    engine_version: string;
    predicted_condition: string;
    target_condition: string;
    failure_diagnosis_summary: FailureDiagnosisSummary;
    pattern_differentiation: {
        predicted_pattern: FailurePatternSnapshot;
        target_pattern: FailurePatternSnapshot;
        discriminating_features: string[];
        critical_differentiators: string[];
        red_flag_signals: string[];
        temporal_differences: string[];
        contradiction_signatures: string[];
        generalization_tags: string[];
    };
    updated_signal_weighting_rules: SignalWeightingUpdateRule[];
    updated_contradiction_rules: ContradictionRuleUpdate[];
    temporal_pattern_rules: TemporalPatternRule[];
    feature_enrichment_rules: FeatureEnrichmentRule[];
    before_vs_after_reasoning: {
        before: string[];
        after: string[];
    };
    corrected_inference_behavior_example: {
        prioritized_signals: string[];
        deprioritized_generic_signals: string[];
        contradiction_guardrails: string[];
        contextual_anchors: string[];
        expected_behavior: string;
    };
}

interface WeightedFeature {
    label: string;
    term: string | null;
    score: number;
}

export function generateFailureCorrectionReport(input: FailureCorrectionInput): FailureCorrectionReport {
    const caseInput = input.case_input ?? {};
    const modelOutput = readRecord(input.model_output);
    const contradiction = resolveContradiction(input.contradiction_analysis ?? modelOutput?.contradiction_analysis, caseInput);
    const signalWeightProfile = resolveSignalWeightProfile(input.signal_weight_profile ?? modelOutput?.signal_weight_profile, caseInput, contradiction);
    const clinicalSignal = resolveClinicalSignal(input.clinical_signal ?? modelOutput?.clinical_signal, caseInput);
    const observedTerms = collectObservedTerms(caseInput, signalWeightProfile, clinicalSignal, input.diagnosis_feature_importance ?? modelOutput?.diagnosis_feature_importance);
    const supplementalMarkers = deriveSupplementalMarkers(caseInput, clinicalSignal);
    const observedMarkers = new Set<string>([...observedTerms, ...supplementalMarkers]);
    const targetProfile = resolveFailurePatternProfile(input.target_condition, input.target_condition_class);
    const predictedProfile = resolveFailurePatternProfile(input.predicted_condition, input.predicted_condition_class);
    const modelFeatures = resolveWeightedFeatures(input.diagnosis_feature_importance ?? modelOutput?.diagnosis_feature_importance);
    const weightByTerm = new Map(signalWeightProfile.weighted_signals.map((entry) => [entry.canonical_term, entry]));

    const presentTargetDiscriminators = filterObservedSignals(targetProfile.discriminating_signals, observedMarkers, contradiction);
    const presentTargetRedFlags = filterObservedSignals(targetProfile.red_flag_signals, observedMarkers, contradiction);
    const presentTargetContext = filterObservedSignals(targetProfile.contextual_features, observedMarkers, contradiction);
    const dominantWrongSignals = buildDominantWrongSignals(modelFeatures, signalWeightProfile, predictedProfile);
    const underweightedSignals = buildUnderweightedSignals(
        [...presentTargetDiscriminators, ...presentTargetRedFlags],
        modelFeatures,
        weightByTerm,
    );
    const overweightedGenericSignals = buildOverweightedGenericSignals(modelFeatures, predictedProfile, targetProfile);
    const ignoredContradictions = buildIgnoredContradictions(contradiction, targetProfile, observedMarkers);
    const temporalMisinterpretation = buildTemporalMisinterpretation(observedMarkers, predictedProfile, targetProfile);
    const missingContextualFeatures = presentTargetContext
        .filter((term) => !isModeledAsImportant(term, modelFeatures))
        .map(formatTerm);
    const discriminatingFeatures = uniqueDisplayTerms([
        ...presentTargetDiscriminators,
        ...presentTargetRedFlags,
        ...presentTargetContext,
        ...supplementalMarkers.filter((marker) => targetProfile.contextual_features.includes(marker)),
    ]);
    const criticalDifferentiators = uniqueDisplayTerms([
        ...presentTargetDiscriminators.filter((term) => !predictedProfile.generic_overlap_signals.includes(term)),
        ...presentTargetRedFlags,
        ...presentTargetContext.filter((term) => !predictedProfile.contextual_features.includes(term)),
    ]);
    const updatedSignalWeightingRules = buildSignalWeightingRules({
        predictedProfile,
        targetProfile,
        presentTargetAnchors: [...presentTargetDiscriminators, ...presentTargetRedFlags],
        presentTargetContext,
        genericSignals: overweightedGenericSignals.map(toCanonicalTerm),
    });
    const updatedContradictionRules = buildContradictionRuleUpdates({
        contradiction,
        targetProfile,
        observedMarkers,
    });
    const temporalPatternRules = buildTemporalPatternRules({
        observedMarkers,
        predictedProfile,
        targetProfile,
    });
    const featureEnrichmentRules = buildFeatureEnrichmentRules(observedMarkers);
    const summaryText = buildSummaryText({
        targetProfile,
        dominantWrongSignals,
        underweightedSignals,
        ignoredContradictions,
        temporalMisinterpretation,
        missingContextualFeatures,
    });

    return {
        engine_version: ENGINE_VERSION,
        predicted_condition: input.predicted_condition ?? 'unknown',
        target_condition: input.target_condition ?? 'unknown',
        failure_diagnosis_summary: {
            dominant_wrong_signals: dominantWrongSignals,
            missing_or_underweighted_signals: underweightedSignals,
            overweighted_generic_signals: overweightedGenericSignals,
            temporal_pattern_misinterpretation: temporalMisinterpretation,
            ignored_contradictions: ignoredContradictions,
            missing_contextual_features: missingContextualFeatures,
            summary_text: summaryText,
        },
        pattern_differentiation: {
            predicted_pattern: snapshotPattern(input.predicted_condition, predictedProfile),
            target_pattern: snapshotPattern(input.target_condition, targetProfile),
            discriminating_features: discriminatingFeatures,
            critical_differentiators: criticalDifferentiators,
            red_flag_signals: uniqueDisplayTerms(presentTargetRedFlags),
            temporal_differences: temporalMisinterpretation,
            contradiction_signatures: ignoredContradictions,
            generalization_tags: dedupeStrings(targetProfile.generalization_tags),
        },
        updated_signal_weighting_rules: updatedSignalWeightingRules,
        updated_contradiction_rules: updatedContradictionRules,
        temporal_pattern_rules: temporalPatternRules,
        feature_enrichment_rules: featureEnrichmentRules,
        before_vs_after_reasoning: {
            before: buildBeforeReasoning(dominantWrongSignals, overweightedGenericSignals, predictedProfile),
            after: buildAfterReasoning(targetProfile, underweightedSignals, ignoredContradictions, missingContextualFeatures),
        },
        corrected_inference_behavior_example: {
            prioritized_signals: uniqueDisplayTerms([
                ...presentTargetDiscriminators,
                ...presentTargetRedFlags,
                ...presentTargetContext,
            ]),
            deprioritized_generic_signals: overweightedGenericSignals,
            contradiction_guardrails: ignoredContradictions,
            contextual_anchors: uniqueDisplayTerms([...presentTargetContext, ...supplementalMarkers]),
            expected_behavior: buildExpectedBehavior(targetProfile, predictedProfile, ignoredContradictions),
        },
    };
}

export function buildFailureCorrectionFeatureVector(report: FailureCorrectionReport): Record<string, number> {
    const features: Record<string, number> = {};

    addFeature(features, `fc_target_${sanitizeFeatureToken(report.pattern_differentiation.target_pattern.family)}`, 1);
    addFeature(features, `fc_predicted_${sanitizeFeatureToken(report.pattern_differentiation.predicted_pattern.family)}`, 1);
    addFeature(features, 'fc_missing_signal_pressure', clamp(report.failure_diagnosis_summary.missing_or_underweighted_signals.length / 4, 0, 1));
    addFeature(features, 'fc_contradiction_pressure', clamp(report.failure_diagnosis_summary.ignored_contradictions.length / 3, 0, 1));

    for (const label of report.pattern_differentiation.critical_differentiators.slice(0, 6)) {
        addFeature(features, `fc_discriminator_${sanitizeFeatureToken(label)}`, 1);
    }
    for (const label of report.corrected_inference_behavior_example.contextual_anchors.slice(0, 4)) {
        addFeature(features, `fc_context_${sanitizeFeatureToken(label)}`, 1);
    }
    for (const rule of report.updated_contradiction_rules.slice(0, 4)) {
        addFeature(features, `fc_contradiction_${sanitizeFeatureToken(rule.rule_id)}`, 1);
    }
    for (const rule of report.temporal_pattern_rules.slice(0, 3)) {
        for (const flag of rule.add_temporal_flags.slice(0, 3)) {
            addFeature(features, `fc_temporal_${sanitizeFeatureToken(flag)}`, 1);
        }
    }
    for (const rule of report.feature_enrichment_rules.slice(0, 4)) {
        for (const feature of rule.add_inferred_features.slice(0, 3)) {
            addFeature(features, `fc_enriched_${sanitizeFeatureToken(feature)}`, 1);
        }
    }

    return features;
}

function resolveContradiction(value: unknown, caseInput: Record<string, unknown>): ContradictionResult {
    const record = readRecord(value);
    if (record && Array.isArray(record.contradiction_reasons)) {
        return {
            contradiction_score: readNumber(record.contradiction_score) ?? 0,
            contradiction_reasons: coerceStringArray(record.contradiction_reasons),
            contradiction_details: coerceContradictionDetails(record.contradiction_details),
            matched_rule_ids: coerceStringArray(record.matched_rule_ids),
            score_band: coerceScoreBand(record.score_band),
            is_plausible: record.is_plausible !== false,
            confidence_cap: readNumber(record.confidence_cap) ?? 1,
            abstain: record.abstain === true,
        };
    }

    return detectContradictions(caseInput);
}

function resolveSignalWeightProfile(
    value: unknown,
    caseInput: Record<string, unknown>,
    contradiction: ContradictionResult,
): SignalWeightProfile {
    const record = readRecord(value);
    if (record && Array.isArray(record.weighted_signals) && Array.isArray(record.normalized_terms)) {
        return record as unknown as SignalWeightProfile;
    }

    return buildSignalWeightProfile(caseInput, { contradiction });
}

function resolveClinicalSignal(value: unknown, caseInput: Record<string, unknown>): AntigravityClinicalSignal {
    const record = readRecord(value);
    if (record && Array.isArray(record.symptom_vector)) {
        return record as unknown as AntigravityClinicalSignal;
    }

    return buildAntigravityClinicalSignal(caseInput);
}

function collectObservedTerms(
    caseInput: Record<string, unknown>,
    signalWeightProfile: SignalWeightProfile,
    clinicalSignal: AntigravityClinicalSignal,
    diagnosisFeatureImportance: unknown,
): Set<string> {
    const observed = new Set<string>(signalWeightProfile.normalized_terms);

    for (const term of normalizeClinicalTermArray(caseInput.symptoms)) {
        observed.add(term);
    }
    for (const term of normalizeClinicalTermArray(clinicalSignal.symptom_vector)) {
        observed.add(term);
    }

    const narrative = collectNarrative(caseInput, clinicalSignal);
    for (const term of extractClinicalTermsFromText(narrative)) {
        observed.add(term);
    }
    for (const signal of clinicalSignal.derived_signals.exposure_risks ?? []) {
        observed.add(normalizeLooseKey(signal));
    }
    for (const signal of clinicalSignal.derived_signals.temporal_pattern ?? []) {
        observed.add(normalizeLooseKey(signal));
    }
    for (const signal of clinicalSignal.derived_signals.reproductive_relevance ?? []) {
        observed.add(normalizeLooseKey(signal));
    }

    for (const feature of resolveWeightedFeatures(diagnosisFeatureImportance)) {
        if (feature.term) observed.add(feature.term);
    }

    return observed;
}

function deriveSupplementalMarkers(
    caseInput: Record<string, unknown>,
    clinicalSignal: AntigravityClinicalSignal,
): string[] {
    const narrative = collectNarrative(caseInput, clinicalSignal).toLowerCase();
    const markers = new Set<string>();

    if (/\b(?:come(?:s)? and go(?:es)?|off and on|waxing and waning|recurrent|episodic)\b/.test(narrative)) {
        markers.add('recurrent_episodic_course');
    }
    if (/\b(?:improved|better|responded)\b.{0,24}\bfluids?\b|\bfluids?\b.{0,24}\b(?:helped|improved|better)\b/.test(narrative)) {
        markers.add('fluid_responsive_instability');
    }
    if (/\b(?:stress|stressed|boarding|surgery|travel|hospitalization)\b/.test(narrative)) {
        markers.add('recent_stress_trigger');
    }

    return [...markers];
}

function resolveWeightedFeatures(value: unknown): WeightedFeature[] {
    const record = readRecord(value);
    if (!record) return [];

    return Object.entries(record)
        .map(([label, score]) => ({
            label,
            term: normalizeFeatureLabel(label),
            score: readNumber(score) ?? 0,
        }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score);
}

function buildDominantWrongSignals(
    modelFeatures: WeightedFeature[],
    signalWeightProfile: SignalWeightProfile,
    predictedProfile: FailurePatternProfile,
): string[] {
    const aligned = modelFeatures
        .filter((feature) =>
            feature.term
            && (
                predictedProfile.discriminating_signals.includes(feature.term)
                || predictedProfile.generic_overlap_signals.includes(feature.term)
                || DEFAULT_GENERIC_SIGNALS.has(feature.term)
            ))
        .slice(0, 4)
        .map((feature) => `${formatTerm(feature.term ?? feature.label)} (${feature.score.toFixed(2)})`);

    if (aligned.length > 0) {
        return aligned;
    }

    return signalWeightProfile.weighted_signals
        .slice(0, 4)
        .map((entry) => `${entry.display_label} (${entry.weight.toFixed(2)})`);
}

function buildUnderweightedSignals(
    targetSignals: string[],
    modelFeatures: WeightedFeature[],
    weightByTerm: Map<string, WeightedSignal>,
): string[] {
    return dedupeStrings(targetSignals)
        .filter((term) => {
            const modeled = modelFeatures.find((feature) => feature.term === term);
            const signalWeight = weightByTerm.get(term)?.weight ?? 0;
            return !modeled || modeled.score < 0.45 || signalWeight < 0.68;
        })
        .map((term) => {
            const modeled = modelFeatures.find((feature) => feature.term === term);
            if (!modeled) return `${formatTerm(term)} (present but absent from dominant model features)`;
            return `${formatTerm(term)} (model feature ${modeled.score.toFixed(2)}; should be higher priority)`;
        });
}

function buildOverweightedGenericSignals(
    modelFeatures: WeightedFeature[],
    predictedProfile: FailurePatternProfile,
    targetProfile: FailurePatternProfile,
): string[] {
    const targetAnchors = new Set([
        ...targetProfile.discriminating_signals,
        ...targetProfile.red_flag_signals,
        ...targetProfile.contextual_features,
    ]);

    return modelFeatures
        .filter((feature) => {
            if (!feature.term) return false;
            if (targetAnchors.has(feature.term)) return false;
            return predictedProfile.generic_overlap_signals.includes(feature.term) || DEFAULT_GENERIC_SIGNALS.has(feature.term);
        })
        .slice(0, 4)
        .map((feature) => `${formatTerm(feature.term ?? feature.label)} (${feature.score.toFixed(2)})`);
}

function buildIgnoredContradictions(
    contradiction: ContradictionResult,
    targetProfile: FailurePatternProfile,
    observedMarkers: Set<string>,
): string[] {
    const relevantTemplates = targetProfile.contradiction_signatures
        .map((signature) => CONTRADICTION_TEMPLATES[signature])
        .filter((template): template is ContradictionTemplate => Boolean(template))
        .filter((template) => matchesTemplate(observedMarkers, template.when_all_present, template.when_any_present))
        .map((template) => template.explanation);

    const direct = contradiction.contradiction_details
        .filter((detail) =>
            targetProfile.contradiction_signatures.includes(detail.rule_id)
            || detail.evidence.some((evidence) => observedMarkers.has(normalizeLooseKey(evidence)))
        )
        .map((detail) => detail.explanation);

    return dedupeStrings([...direct, ...relevantTemplates]);
}

function buildTemporalMisinterpretation(
    observedMarkers: Set<string>,
    predictedProfile: FailurePatternProfile,
    targetProfile: FailurePatternProfile,
): string[] {
    const differences: string[] = [];
    const observedTemporal = targetProfile.temporal_features.filter((signal) => observedMarkers.has(signal));

    if (observedTemporal.length > 0 && !observedTemporal.some((signal) => predictedProfile.temporal_features.includes(signal))) {
        differences.push(
            `${observedTemporal.map(formatTerm).join(', ')} was present but underused; it supports ${targetProfile.pattern_family.replace(/_/g, ' ')} over ${predictedProfile.pattern_family.replace(/_/g, ' ')}.`,
        );
    }
    if (observedMarkers.has('recurrent_episodic_course') && predictedProfile.pattern_family.includes('generic_gastrointestinal')) {
        differences.push('Recurrent episodic course argues against a simple self-limited gastrointestinal interpretation.');
    }
    if (observedMarkers.has('fluid_responsive_instability')) {
        differences.push('Temporary improvement with fluids should be treated as instability context, not as evidence that the original low-complexity diagnosis was correct.');
    }

    return dedupeStrings(differences);
}

function buildSignalWeightingRules(input: {
    predictedProfile: FailurePatternProfile;
    targetProfile: FailurePatternProfile;
    presentTargetAnchors: string[];
    presentTargetContext: string[];
    genericSignals: string[];
}): SignalWeightingUpdateRule[] {
    const anchors = dedupeStrings(input.presentTargetAnchors).slice(0, 4);
    const context = dedupeStrings(input.presentTargetContext).slice(0, 3);
    const generic = dedupeStrings(input.genericSignals.map(normalizeLooseKey).filter(Boolean)).slice(0, 4);
    const rules: SignalWeightingUpdateRule[] = [];

    if (anchors.length > 0) {
        rules.push({
            rule_id: `promote_${sanitizeFeatureToken(input.targetProfile.pattern_family)}_anchors`,
            when_all_present: anchors.slice(0, Math.min(2, anchors.length)),
            when_any_present: generic.length > 0 ? generic : undefined,
            boost_signals: anchors,
            penalize_signals: generic,
            boost_pattern_families: [input.targetProfile.pattern_family],
            penalize_pattern_families: input.predictedProfile.pattern_family !== input.targetProfile.pattern_family
                ? [input.predictedProfile.pattern_family]
                : [],
            boost_weight_delta: anchors.some((anchor) => input.targetProfile.red_flag_signals.includes(anchor)) ? 0.22 : 0.16,
            penalize_weight_delta: generic.length > 0 ? 0.10 : 0.06,
            rationale: `Discriminating ${input.targetProfile.pattern_family.replace(/_/g, ' ')} anchors should outrank low-specificity overlap symptoms when both are present.`,
            generalization: 'When high-specificity anchors coexist with shared nonspecific symptoms, the engine should promote the anchor pattern family before generic mimics.',
        });
    }

    if (context.length > 0) {
        rules.push({
            rule_id: `promote_${sanitizeFeatureToken(input.targetProfile.pattern_family)}_context`,
            when_all_present: context.length > 1 ? context.slice(0, 2) : undefined,
            when_any_present: context.length === 1 ? context : anchors.slice(0, 2),
            boost_signals: context,
            penalize_signals: generic,
            boost_pattern_families: [input.targetProfile.pattern_family],
            penalize_pattern_families: input.predictedProfile.pattern_family !== input.targetProfile.pattern_family
                ? [input.predictedProfile.pattern_family]
                : [],
            boost_weight_delta: 0.14,
            penalize_weight_delta: generic.length > 0 ? 0.08 : 0.04,
            rationale: 'Contextual reproductive, exposure, or recurrence features should remain available as independent weighting anchors rather than narrative footnotes.',
            generalization: 'History and context features should be promoted when they narrow the pattern family more than generic symptom terms do.',
        });
    }

    return rules;
}

function buildContradictionRuleUpdates(input: {
    contradiction: ContradictionResult;
    targetProfile: FailurePatternProfile;
    observedMarkers: Set<string>;
}): ContradictionRuleUpdate[] {
    const rules: ContradictionRuleUpdate[] = input.contradiction.contradiction_details.map((detail) => ({
        rule_id: detail.rule_id,
        when_all_present: detail.evidence.map(normalizeLooseKey).filter(Boolean),
        contradiction_score_delta: Number(clamp(detail.weight + 0.04, 0, 1).toFixed(2)),
        severity: detail.severity === 'mild' ? 'moderate' : detail.severity,
        explanation: detail.explanation,
        generalization: 'Persist clinically unusual signal pairings as explicit contradiction features so they can down-rank overly simple interpretations.',
    }));

    for (const signature of input.targetProfile.contradiction_signatures) {
        const template = CONTRADICTION_TEMPLATES[signature];
        if (!template || !matchesTemplate(input.observedMarkers, template.when_all_present, template.when_any_present)) {
            continue;
        }
        rules.push({
            rule_id: template.rule_id,
            when_all_present: template.when_all_present,
            when_any_present: template.when_any_present,
            contradiction_score_delta: template.contradiction_score_delta,
            severity: template.severity,
            explanation: template.explanation,
            generalization: template.generalization,
        });
    }

    return dedupeRuleUpdates(rules);
}

function buildTemporalPatternRules(input: {
    observedMarkers: Set<string>;
    predictedProfile: FailurePatternProfile;
    targetProfile: FailurePatternProfile;
}): TemporalPatternRule[] {
    const rules: TemporalPatternRule[] = [];
    const observedTargetTemporal = input.targetProfile.temporal_features.filter((term) => input.observedMarkers.has(term));

    if (observedTargetTemporal.length > 0) {
        rules.push({
            rule_id: `temporal_${sanitizeFeatureToken(input.targetProfile.pattern_family)}_alignment`,
            when_all_present: observedTargetTemporal.slice(0, Math.min(2, observedTargetTemporal.length)),
            when_any_present: input.targetProfile.discriminating_signals.filter((term) => input.observedMarkers.has(term)).slice(0, 2),
            add_temporal_flags: dedupeStrings([
                ...observedTargetTemporal,
                ...(input.observedMarkers.has('recurrent_episodic_course') ? ['recurrent_episodic_course'] : []),
                ...(input.observedMarkers.has('fluid_responsive_instability') ? ['fluid_responsive_instability'] : []),
            ]),
            boost_pattern_families: [input.targetProfile.pattern_family],
            penalize_pattern_families: input.predictedProfile.pattern_family !== input.targetProfile.pattern_family
                ? [input.predictedProfile.pattern_family]
                : [],
            rationale: 'Observed temporal behavior should shape pattern-family weighting instead of being collapsed into symptom-only reasoning.',
        });
    }

    if (input.observedMarkers.has('recurrent_episodic_course') && input.observedMarkers.has('fluid_responsive_instability')) {
        rules.push({
            rule_id: 'temporal_recurrent_fluid_responsive_instability',
            when_all_present: ['recurrent_episodic_course', 'fluid_responsive_instability'],
            add_temporal_flags: ['recurrent_episodic_course', 'fluid_responsive_instability'],
            boost_pattern_families: [input.targetProfile.pattern_family],
            penalize_pattern_families: ['generic_gastrointestinal_inflammation'],
            rationale: 'Recurrence plus temporary fluid response should suppress self-limited interpretations and elevate hidden instability patterns.',
        });
    }

    return dedupeTemporalRules(rules);
}

function buildFeatureEnrichmentRules(observedMarkers: Set<string>): FeatureEnrichmentRule[] {
    return ENRICHMENT_TEMPLATES
        .filter((template) => matchesTemplate(observedMarkers, template.when_all_present, template.when_any_present))
        .map((template) => ({
            rule_id: template.rule_id,
            when_all_present: template.when_all_present,
            when_any_present: template.when_any_present,
            add_inferred_features: template.add_inferred_features,
            rationale: template.rationale,
            generalization: template.generalization,
        }));
}

function buildSummaryText(input: {
    targetProfile: FailurePatternProfile;
    dominantWrongSignals: string[];
    underweightedSignals: string[];
    ignoredContradictions: string[];
    temporalMisinterpretation: string[];
    missingContextualFeatures: string[];
}): string {
    const parts = [
        input.dominantWrongSignals.length > 0
            ? `The miss was driven by overweighted ${input.dominantWrongSignals.length > 1 ? 'generic/shared' : 'dominant'} signals.`
            : null,
        input.underweightedSignals.length > 0
            ? `Higher-value ${input.targetProfile.pattern_family.replace(/_/g, ' ')} discriminators were present but not sufficiently prioritized.`
            : null,
        input.ignoredContradictions.length > 0
            ? 'Clinically unusual pairings were available but not used as a safety brake.'
            : null,
        input.temporalMisinterpretation.length > 0
            ? 'Temporal structure also favored the higher-priority pattern and should be encoded explicitly.'
            : null,
        input.missingContextualFeatures.length > 0
            ? 'Contextual anchors were present but underrepresented.'
            : null,
    ].filter((value): value is string => Boolean(value));

    return parts.length > 0
        ? parts.join(' ')
        : 'The failure should be treated as an anchor-prioritization problem: shared symptoms dominated over more discriminating pattern-level evidence.';
}

function snapshotPattern(label: string | null | undefined, profile: FailurePatternProfile): FailurePatternSnapshot {
    return {
        label: label ?? profile.canonical_label,
        family: profile.pattern_family,
        description: profile.description,
    };
}

function buildBeforeReasoning(
    dominantWrongSignals: string[],
    overweightedGenericSignals: string[],
    predictedProfile: FailurePatternProfile,
): string[] {
    const reasoning = [
        dominantWrongSignals.length > 0
            ? `The model anchored on ${dominantWrongSignals.join(', ')}.`
            : null,
        overweightedGenericSignals.length > 0
            ? `Generic overlap features from ${predictedProfile.pattern_family.replace(/_/g, ' ')} were allowed to dominate.`
            : null,
    ].filter((value): value is string => Boolean(value));

    return reasoning.length > 0
        ? reasoning
        : [`The model defaulted toward ${predictedProfile.pattern_family.replace(/_/g, ' ')} because shared symptoms were easier to match than the hidden pattern signature.`];
}

function buildAfterReasoning(
    targetProfile: FailurePatternProfile,
    underweightedSignals: string[],
    ignoredContradictions: string[],
    missingContextualFeatures: string[],
): string[] {
    const reasoning = [
        underweightedSignals.length > 0
            ? `Prioritize ${underweightedSignals.join(', ')} as stronger anchors for ${targetProfile.pattern_family.replace(/_/g, ' ')}.`
            : null,
        ignoredContradictions.length > 0
            ? `Apply contradiction guardrails using ${ignoredContradictions.join(', ')}.`
            : null,
        missingContextualFeatures.length > 0
            ? `Promote contextual anchors such as ${missingContextualFeatures.join(', ')} into first-class features.`
            : null,
    ].filter((value): value is string => Boolean(value));

    return reasoning.length > 0
        ? reasoning
        : ['Maintain a broader differential by protecting high-specificity pattern anchors before shared symptom clusters.'];
}

function buildExpectedBehavior(
    targetProfile: FailurePatternProfile,
    predictedProfile: FailurePatternProfile,
    ignoredContradictions: string[],
): string {
    const contradictionText = ignoredContradictions.length > 0
        ? ' and treat contradiction pressure as a confidence brake'
        : '';

    return `When this signal pattern recurs, promote ${targetProfile.pattern_family.replace(/_/g, ' ')} ahead of ${predictedProfile.pattern_family.replace(/_/g, ' ')}${contradictionText}.`;
}

function filterObservedSignals(
    signals: string[],
    observedMarkers: Set<string>,
    contradiction: ContradictionResult,
): string[] {
    return dedupeStrings(signals).filter((signal) =>
        observedMarkers.has(signal)
        || contradiction.contradiction_details.some((detail) => detail.evidence.map(normalizeLooseKey).includes(signal)),
    );
}

function isModeledAsImportant(term: string, modelFeatures: WeightedFeature[]): boolean {
    const matched = modelFeatures.find((feature) => feature.term === term);
    return Boolean(matched && matched.score >= 0.45);
}

function normalizeFeatureLabel(label: string): string | null {
    const direct = normalizeClinicalTerm(label);
    if (direct) return direct;

    const extracted = extractClinicalTermsFromText(label);
    return extracted[0] ?? null;
}

function collectNarrative(
    caseInput: Record<string, unknown>,
    clinicalSignal: AntigravityClinicalSignal,
): string {
    const metadata = readRecord(caseInput.metadata);
    return [
        coerceString(caseInput.history),
        coerceString(caseInput.notes),
        coerceString(caseInput.presenting_complaint),
        coerceString(caseInput.narrative),
        coerceString(metadata?.raw_note),
        coerceString(clinicalSignal.patient_history_summary),
    ].filter(Boolean).join('\n');
}

function coerceContradictionDetails(value: unknown): ContradictionDetail[] {
    if (!Array.isArray(value)) return [];

    return value
        .map((entry) => readRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({
            rule_id: coerceString(entry.rule_id) ?? 'unknown_rule',
            label: coerceString(entry.label) ?? 'Unknown contradiction',
            rule_type: coerceString(entry.rule_type) ?? 'unknown',
            severity: coerceSeverity(entry.severity),
            weight: readNumber(entry.weight) ?? 0,
            explanation: coerceString(entry.explanation) ?? 'No explanation available.',
            evidence: coerceStringArray(entry.evidence),
            source: coerceContradictionSource(entry.source),
        }));
}

function coerceSeverity(value: unknown): 'mild' | 'moderate' | 'high' {
    return value === 'mild' || value === 'high' ? value : 'moderate';
}

function coerceContradictionSource(value: unknown): 'rule_registry' | 'metadata_conflict' | 'biologic_plausibility' {
    return value === 'metadata_conflict' || value === 'biologic_plausibility'
        ? value
        : 'rule_registry';
}

function coerceScoreBand(value: unknown): 'none' | 'low' | 'moderate' | 'high' {
    return value === 'low' || value === 'moderate' || value === 'high'
        ? value
        : 'none';
}

function matchesTemplate(
    observedMarkers: Set<string>,
    whenAllPresent?: string[],
    whenAnyPresent?: string[],
): boolean {
    if (whenAllPresent && !whenAllPresent.every((term) => observedMarkers.has(term))) {
        return false;
    }
    if (whenAnyPresent && !whenAnyPresent.some((term) => observedMarkers.has(term))) {
        return false;
    }
    return Boolean(
        (whenAllPresent && whenAllPresent.length > 0)
        || (whenAnyPresent && whenAnyPresent.length > 0),
    );
}

function dedupeRuleUpdates(rules: ContradictionRuleUpdate[]): ContradictionRuleUpdate[] {
    const unique = new Map<string, ContradictionRuleUpdate>();
    for (const rule of rules) {
        const existing = unique.get(rule.rule_id);
        if (!existing || existing.contradiction_score_delta < rule.contradiction_score_delta) {
            unique.set(rule.rule_id, {
                ...rule,
                when_all_present: dedupeStrings(rule.when_all_present ?? []),
                when_any_present: dedupeStrings(rule.when_any_present ?? []),
            });
        }
    }
    return [...unique.values()];
}

function dedupeTemporalRules(rules: TemporalPatternRule[]): TemporalPatternRule[] {
    const unique = new Map<string, TemporalPatternRule>();
    for (const rule of rules) {
        unique.set(rule.rule_id, {
            ...rule,
            when_all_present: dedupeStrings(rule.when_all_present ?? []),
            when_any_present: dedupeStrings(rule.when_any_present ?? []),
            add_temporal_flags: dedupeStrings(rule.add_temporal_flags),
        });
    }
    return [...unique.values()];
}

function uniqueDisplayTerms(values: string[]): string[] {
    return dedupeStrings(values.filter(Boolean).map((value) => formatTerm(value)));
}

function formatTerm(value: string): string {
    const vocabularyEntry = getClinicalVocabularyEntry(value);
    return vocabularyEntry ? getClinicalTermDisplayLabel(value) : value.replace(/_/g, ' ');
}

function toCanonicalTerm(value: string): string {
    return normalizeClinicalTerm(value) ?? normalizeLooseKey(value);
}

function addFeature(features: Record<string, number>, key: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    features[key] = Number(value.toFixed(3));
}

function sanitizeFeatureToken(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeLooseKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/['\u2019]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function coerceString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function coerceStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}
