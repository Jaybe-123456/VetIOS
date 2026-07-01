import { getConditionById, getConditionsForSpecies, normalizeSpecies } from './condition-registry';
import { applyBiochemistryPriors } from './biochemistry-priors';
import { applyBreedSpecificPriors } from './breed-priors';
import { applyGroundTruthConfirmation } from './ground-truth-confirmation';
import { applyHaematologicalPriors, type ScoreAdjustment } from './haematological-priors';
import { applyImagingPriors } from './imaging-priors';
import {
    buildPathognomonicDifferentials,
    evaluatePathognomicTests,
} from './pathognomic-gate';
import { applyEtiologicalPlausibilityGate } from './plausibility-gate';
import {
    mergeDiagnosticTests,
    normalizeClinicalLabEvidence,
} from './labEvidenceNormalizer';
import { applyRegionalExposurePriors } from './regional-priors';
import { applySyndromePatterns } from './syndrome-recogniser';
import {
    buildClinicalSignalProfile,
    domainsForSignal,
    formatClinicalSignalLabel,
    normalizeCanonicalSignalArray,
    specificityForSignal,
    specificityWeight,
    type ClinicalSignalClusterScores,
    type ClinicalSignalDomain,
    type ClinicalSignalProfile,
    type ClinicalSignalSpecificity,
} from './clinical-signal-ontology';
import { selectTreatmentProtocol, type TreatmentContext } from '../treatment/treatment-engine';
import { computeAnatomicalLocalization, getLocalizationMultiplier } from './anatomical-localizer';
import { routeSyndrome, getSyndromeMultiplier } from './syndrome-router';
import type {
    AbstainDecision,
    ContradictionAnalysis,
    ClinicalUrgency,
    ClinicalIntelligenceReport,
    ConfidenceCalibrationReport,
    ConditionClass,
    ContradictingEvidenceEntry,
    DifferentialBasis,
    DifferentialEntry,
    DifferentialRelationship,
    EvidenceWeight,
    EvidenceEntry,
    InformationGainRecommendation,
    InferenceExplanation,
    InferenceRequest,
    InferenceResponse,
    MechanismAnalysisEntry,
    PathwayAnalysisEntry,
    PathwayContribution,
    ReliabilityBreakdown,
    SelectedTreatmentPlan,
    Species,
    SpeciesValidationReport,
    VeterinaryCondition,
} from './types';

interface CandidateState {
    condition: VeterinaryCondition;
    score: number;
    basis: DifferentialBasis;
    supporting: EvidenceEntry[];
    contradicting: ContradictingEvidenceEntry[];
    relationship?: DifferentialRelationship;
    recommendedConfirmatoryTests: Set<string>;
    recommendedNextSteps: Set<string>;
}

interface ConditionSignalDescriptor {
    family: string;
    domains: ClinicalSignalDomain[];
    specificity: ClinicalSignalSpecificity;
    weight: number;
    label: string;
}

type AirwayLevel = 'upper' | 'lower' | 'mixed';

interface RespiratoryRoutingSummary {
    species: Species;
    speciesGate: string;
    airwayLevel: AirwayLevel;
    upperRespiratoryScore: number;
    lowerRespiratoryScore: number;
    systemicScore: number;
    upperFeatureCount: number;
    lowerEvidenceCount: number;
    lowerNegativeCount: number;
    upperComplexStrong: boolean;
    lowerEvidenceStrong: boolean;
    oralUlcerationPresent: boolean;
    hypersalivationPresent: boolean;
    conjunctivitisRhinitisDominant: boolean;
    coughDominant: boolean;
    kitten: boolean;
    noLowerAirwayEvidence: boolean;
}

export interface ClinicalInferenceEngineResult extends InferenceResponse {
    top_diagnosis: string | null;
    condition_class: string;
    severity: string | null;
    confidence: number;
    contradiction_score: number;
    feature_importance: Record<string, number>;
    diagnosis_feature_importance: Record<string, number>;
    cluster_scores: Record<string, number>;
    species_gate: string;
    airway_level: AirwayLevel;
    differential_spread: {
        top_1_probability: number | null;
        top_2_probability: number | null;
        top_3_probability: number | null;
        spread: number | null;
    } | null;
    uncertainty_notes: string[];
    species_validation: SpeciesValidationReport;
    pathway_analysis: PathwayAnalysisEntry[];
    mechanism_analysis: MechanismAnalysisEntry[];
    clinical_intelligence: ClinicalIntelligenceReport;
    confidence_calibration: Record<string, ConfidenceCalibrationReport>;
    evidence_normalization?: InferenceRequest['evidence_normalization'] | null;
    reliability_breakdown: ReliabilityBreakdown;
    information_gain_engine: ClinicalIntelligenceReport['information_gain_engine'];
    explainability_report: string[];
    causal_memory_update: ClinicalIntelligenceReport['causal_memory_update'];
}

function collectStringArray(...sources: unknown[]): string[] {
    const output: string[] = [];
    for (const source of sources) {
        if (!Array.isArray(source)) continue;
        for (const entry of source) {
            if (typeof entry === 'string' && entry.trim()) {
                output.push(entry);
            }
        }
    }
    return output;
}

const LEGACY_CONDITION_SIGNAL_HINTS: Record<string, Array<{
    family: string;
    domains: ClinicalSignalDomain[];
    specificity: ClinicalSignalSpecificity;
}>> = {
    abdominal_distension: [{ family: 'abdominal_pain', domains: ['gi'], specificity: 'high' }],
    ascites: [{ family: 'ascites', domains: ['cardio', 'gi'], specificity: 'medium' }],
    collapse: [{ family: 'syncope', domains: ['cardio', 'systemic'], specificity: 'medium' }],
    hepatomegaly: [{ family: 'abdominal_pain', domains: ['gi'], specificity: 'low' }],
    neurological_signs: [{ family: 'neurologic_signal', domains: ['neuro'], specificity: 'medium' }],
    pleural_effusion: [{ family: 'dyspnea', domains: ['respiratory', 'cardio'], specificity: 'medium' }],
    respiratory_signs: [{ family: 'respiratory_signal', domains: ['respiratory'], specificity: 'low' }],
    systemic_signs: [{ family: 'systemic_signal', domains: ['systemic'], specificity: 'low' }],
    unproductive_retching: [{ family: 'abdominal_pain', domains: ['gi'], specificity: 'high' }],
};

const UPPER_RESPIRATORY_FAMILIES = new Set([
    'sneezing',
    'nasal_discharge',
    'ocular_discharge',
    'conjunctivitis',
    'oral_ulceration',
    'hypersalivation',
]);

const LOWER_RESPIRATORY_FAMILIES = new Set([
    'dyspnea',
    'tachypnea',
    'abnormal_lung_sounds',
    'cyanosis',
    'coughing',
]);

const FELINE_URI_COMPLEX_IDS = new Set([
    'feline_upper_respiratory_complex',
    'feline_herpesvirus_1_infection',
    'feline_calicivirus_infection',
    'chlamydophila_felis_upper_respiratory_infection',
    'feline_secondary_bacterial_upper_respiratory_infection',
    'bordetella_bronchiseptica_feline',
]);

const FELINE_LOWER_AIRWAY_IDS = new Set([
    'feline_bacterial_pneumonia',
    'feline_chronic_bronchitis',
]);

function emptyClusterScores(): ClinicalSignalClusterScores {
    return {
        respiratory: 0,
        gi: 0,
        neuro: 0,
        cardio: 0,
        systemic: 0,
    };
}

function descriptorWeight(specificity: ClinicalSignalSpecificity): number {
    switch (specificity) {
        case 'high':
            return 3;
        case 'medium':
            return 2;
        default:
            return 1;
    }
}

function resolveConditionSignalDescriptors(rawSignal: string): ConditionSignalDescriptor[] {
    const canonicalSignals = normalizeCanonicalSignalArray([rawSignal]);
    if (canonicalSignals.length > 0) {
        return canonicalSignals.map((signal) => ({
            family: formatClinicalSignalLabel(signal).replace(/ /g, '_'),
            domains: domainsForSignal(signal),
            specificity: specificityForSignal(signal),
            weight: specificityWeight(signal),
            label: formatClinicalSignalLabel(signal),
        })).map((descriptor) => ({
            ...descriptor,
            family: descriptor.family === 'nasal_discharge_serous' || descriptor.family === 'nasal_discharge_mucopurulent'
                ? 'nasal_discharge'
                : descriptor.family,
        }));
    }

    const fallback = LEGACY_CONDITION_SIGNAL_HINTS[normalizeKey(rawSignal)] ?? [];
    return fallback.map((descriptor) => ({
        ...descriptor,
        weight: descriptorWeight(descriptor.specificity),
        label: formatClinicalSignalLabel(descriptor.family),
    }));
}

function featureIsAbsent(value: string, signalProfile: ClinicalSignalProfile): boolean {
    return resolveConditionSignalDescriptors(value).some((descriptor) => signalProfile.negativeFamilies.has(descriptor.family));
}

function featureIsPresent(
    value: string,
    signalProfile: ClinicalSignalProfile,
    options?: { conditionCluster?: ClinicalSignalDomain },
): boolean {
    const descriptors = resolveConditionSignalDescriptors(value);
    return descriptors.some((descriptor) => {
        if (
            options?.conditionCluster === 'gi'
            && descriptor.family === 'fever'
            && signalProfile.clusterScores.gi === 0
        ) {
            return false;
        }
        return signalProfile.positiveFamilies.has(descriptor.family);
    });
}

function determineConditionCluster(condition: VeterinaryCondition): ClinicalSignalDomain {
    const weightedCounts = emptyClusterScores();

    const addWeightedSigns = (signs: string[], weight: number) => {
        for (const sign of signs) {
            for (const descriptor of resolveConditionSignalDescriptors(sign)) {
                for (const cluster of descriptor.domains) {
                    weightedCounts[cluster] += weight * descriptor.weight;
                }
            }
        }
    };

    addWeightedSigns(condition.cardinal_signs, 2);
    addWeightedSigns(condition.common_signs, 1);
    addWeightedSigns(condition.rare_signs, 0.5);

    const ranked = (Object.entries(weightedCounts) as Array<[ClinicalSignalDomain, number]>)
        .sort((left, right) => right[1] - left[1]);
    const [topCluster, topCount] = ranked[0] ?? [null, 0];
    const secondCount = ranked[1]?.[1] ?? 0;
    if (topCluster && topCount > 0 && topCount > secondCount) return topCluster;

    switch (condition.etiological_class) {
        case 'respiratory_structural':
            return 'respiratory';
        case 'gastrointestinal_structural':
            return 'gi';
        case 'neurological':
            return 'neuro';
        case 'cardiovascular_structural':
            return 'cardio';
        default:
            return 'systemic';
    }
}

function getSupportingMatches(
    signs: string[],
    signalProfile: ClinicalSignalProfile,
    conditionCluster: ClinicalSignalDomain,
): ConditionSignalDescriptor[] {
    const matches = new Map<string, ConditionSignalDescriptor>();
    for (const sign of signs) {
        if (!featureIsPresent(sign, signalProfile, { conditionCluster })) continue;
        for (const descriptor of resolveConditionSignalDescriptors(sign)) {
            if (!signalProfile.positiveFamilies.has(descriptor.family)) continue;
            if (
                conditionCluster === 'gi'
                && descriptor.family === 'fever'
                && signalProfile.clusterScores.gi === 0
            ) {
                continue;
            }
            const current = matches.get(descriptor.family);
            if (!current || descriptor.weight > current.weight) {
                matches.set(descriptor.family, descriptor);
            }
        }
    }
    return [...matches.values()]
        .sort((left, right) => right.weight - left.weight);
}

function getAbsentMatches(signs: string[], signalProfile: ClinicalSignalProfile): ConditionSignalDescriptor[] {
    const matches = new Map<string, ConditionSignalDescriptor>();
    for (const sign of signs) {
        if (!featureIsAbsent(sign, signalProfile)) continue;
        for (const descriptor of resolveConditionSignalDescriptors(sign)) {
            if (!signalProfile.negativeFamilies.has(descriptor.family)) continue;
            const current = matches.get(descriptor.family);
            if (!current || descriptor.weight > current.weight) {
                matches.set(descriptor.family, descriptor);
            }
        }
    }
    return [...matches.values()]
        .sort((left, right) => right.weight - left.weight);
}

function weightedMatchScore(matches: ConditionSignalDescriptor[], multiplier: number): number {
    return matches.reduce((sum, match) => sum + (match.weight * multiplier), 0);
}

function hasStrongClusterEvidence(signalProfile: ClinicalSignalProfile, cluster: ClinicalSignalDomain): boolean {
    return signalProfile.strongSignalCounts[cluster] >= 2 || signalProfile.clusterScores[cluster] >= 4;
}

function isLowSpecificityOnly(matches: ConditionSignalDescriptor[]): boolean {
    return matches.length > 0 && matches.every((match) => match.specificity === 'low');
}

function featureImportance(
    entries: DifferentialEntry[],
    signalProfile: ClinicalSignalProfile,
): Record<string, number> {
    const importance = new Map<string, number>();
    for (const signal of signalProfile.positiveSignals) {
        const label = formatClinicalSignalLabel(signal);
        importance.set(label, Number(((importance.get(label) ?? 0) + (specificityWeight(signal) / 10)).toFixed(3)));
    }
    for (const signal of signalProfile.negativeSignals) {
        const label = `absence: ${formatClinicalSignalLabel(signal)}`;
        importance.set(label, Number(((importance.get(label) ?? 0) + (specificityWeight(signal) / 12)).toFixed(3)));
    }
    for (const entry of entries.slice(0, 5)) {
        for (const evidence of entry.supporting_evidence) {
            importance.set(evidence.finding, Number(((importance.get(evidence.finding) ?? 0) + entry.probability).toFixed(3)));
        }
    }
    return Object.fromEntries([...importance.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10));
}

function computeReportedConfidence(probability: number, contradictionScore: number): number {
    let adjusted = probability;
    if (contradictionScore > 0.85) {
        adjusted *= 0.25;
    } else if (contradictionScore > 0.7) {
        adjusted *= 0.45;
    } else {
        adjusted *= 1 - (contradictionScore * 0.45);
    }
    return Number(Math.max(0, Math.min(1, adjusted)).toFixed(3));
}

function computeClinicalConfidence(
    probability: number,
    contradictionScore: number,
    topCondition: VeterinaryCondition | undefined,
    routingSummary: RespiratoryRoutingSummary,
): number {
    let confidence = computeReportedConfidence(probability, contradictionScore);

    if (
        routingSummary.species === 'feline'
        && routingSummary.upperComplexStrong
        && routingSummary.noLowerAirwayEvidence
        && isFelineUpperRespiratoryCondition(topCondition?.id)
    ) {
        confidence = Math.min(1, confidence + 0.08);
    }

    if (routingSummary.airwayLevel === 'mixed') {
        confidence = Math.max(0, confidence - 0.08);
    }

    if (
        routingSummary.species === 'feline'
        && routingSummary.noLowerAirwayEvidence
        && isFelineLowerRespiratoryCondition(topCondition?.id)
    ) {
        confidence = Math.max(0, confidence - 0.18);
    }

    return Number(confidence.toFixed(3));
}

function formatClusterLabel(cluster: ClinicalSignalDomain): string {
    switch (cluster) {
        case 'gi':
            return 'gastrointestinal';
        case 'neuro':
            return 'neurologic';
        case 'cardio':
            return 'cardiovascular';
        default:
            return cluster;
    }
}

function buildSignalUncertaintyNotes(signalProfile: ClinicalSignalProfile): string[] {
    const notes: string[] = [];
    if (signalProfile.mixedClusters.length > 1) {
        notes.push(`Signals are distributed across ${signalProfile.mixedClusters.map(formatClusterLabel).join(', ')} domains, so broader differentials should remain open.`);
    }
    if (signalProfile.totalStrongSignals === 0 && signalProfile.positiveSignals.size > 0) {
        notes.push('Only low-specificity systemic signals were captured, so the differential remains broad.');
    }
    if (signalProfile.ignoredInputs.length > 0) {
        notes.push(`Ignored non-canonical inputs: ${signalProfile.ignoredInputs.join(', ')}`);
    }
    return notes;
}

function appendFelineAirwayNotes(notes: string[], routingSummary: RespiratoryRoutingSummary) {
    if (routingSummary.species !== 'feline') {
        return;
    }
    if (routingSummary.airwayLevel === 'mixed') {
        notes.push('Upper and lower respiratory signals are mixed in this feline case, so lower-airway complications should stay in the differential.');
    } else if (routingSummary.upperComplexStrong && routingSummary.noLowerAirwayEvidence) {
        notes.push('Feline upper-airway findings dominate while lower-airway evidence is absent.');
    }
}

function mappedSignalCount(signs: string[]): number {
    return signs
        .filter((sign) => resolveConditionSignalDescriptors(sign).length > 0)
        .length;
}

function hasLowerRespiratoryImagingEvidence(request: InferenceRequest): boolean {
    const pattern = request.diagnostic_tests?.thoracic_radiograph?.pulmonary_pattern;
    return pattern != null && pattern !== 'normal';
}

function hasNegativeLowerRespiratoryImaging(request: InferenceRequest): boolean {
    const thoracic = request.diagnostic_tests?.thoracic_radiograph;
    return thoracic?.pulmonary_pattern === 'normal'
        && thoracic.pulmonary_artery_enlargement !== 'present'
        && thoracic.pleural_effusion !== 'present';
}

function hasBloodGasHypoxemia(request: InferenceRequest): boolean {
    const bloodGas = (request.diagnostic_tests as { blood_gas?: Record<string, unknown> } | undefined)?.blood_gas;
    if (!bloodGas || typeof bloodGas !== 'object') return false;
    return bloodGas.oxygenation === 'hypoxemia'
        || bloodGas.pao2 === 'low'
        || bloodGas.spo2 === 'low';
}

function buildRespiratoryRoutingSummary(
    request: InferenceRequest,
    signalProfile: ClinicalSignalProfile,
): RespiratoryRoutingSummary {
    const species = normalizeSpecies(request.species);
    const dominantDescriptorFamilies = request.presenting_signs.length > 0
        ? resolveConditionSignalDescriptors(request.presenting_signs[0]).map((descriptor) => descriptor.family)
        : [];
    const coughDominant = dominantDescriptorFamilies.includes('coughing')
        || (
            signalProfile.positiveFamilies.has('coughing')
            && !signalProfile.positiveFamilies.has('sneezing')
            && !signalProfile.positiveFamilies.has('conjunctivitis')
        );

    let upperRespiratoryScore = 0;
    for (const signal of signalProfile.positiveSignals) {
        switch (signal) {
            case 'conjunctivitis':
            case 'oral_ulceration':
            case 'hypersalivation':
                upperRespiratoryScore += 4;
                break;
            case 'nasal_discharge_mucopurulent':
                upperRespiratoryScore += 4;
                break;
            case 'sneezing':
            case 'ocular_discharge':
                upperRespiratoryScore += 3;
                break;
            case 'nasal_discharge_serous':
                upperRespiratoryScore += 2.5;
                break;
            case 'fever':
            case 'anorexia':
            case 'lethargy':
                upperRespiratoryScore += 1;
                break;
            default:
                break;
        }
    }

    let lowerRespiratoryScore = 0;
    let lowerEvidenceCount = 0;
    for (const family of ['dyspnea', 'tachypnea', 'abnormal_lung_sounds', 'cyanosis']) {
        if (signalProfile.positiveFamilies.has(family)) {
            lowerEvidenceCount += 1;
        }
    }
    if (coughDominant) {
        lowerEvidenceCount += 1;
    }
    if (hasLowerRespiratoryImagingEvidence(request)) {
        lowerEvidenceCount += 1;
    }
    if (hasBloodGasHypoxemia(request)) {
        lowerEvidenceCount += 1;
    }

    lowerRespiratoryScore += signalProfile.positiveFamilies.has('dyspnea') ? 4 : 0;
    lowerRespiratoryScore += signalProfile.positiveFamilies.has('tachypnea') ? 3 : 0;
    lowerRespiratoryScore += signalProfile.positiveFamilies.has('abnormal_lung_sounds') ? 4 : 0;
    lowerRespiratoryScore += signalProfile.positiveFamilies.has('cyanosis') ? 5 : 0;
    lowerRespiratoryScore += coughDominant ? 2.5 : 0;
    lowerRespiratoryScore += hasLowerRespiratoryImagingEvidence(request) ? 4 : 0;
    lowerRespiratoryScore += hasBloodGasHypoxemia(request) ? 4 : 0;

    let lowerNegativeCount = 0;
    for (const family of LOWER_RESPIRATORY_FAMILIES) {
        if (signalProfile.negativeFamilies.has(family)) {
            lowerNegativeCount += 1;
        }
    }
    if (hasNegativeLowerRespiratoryImaging(request)) {
        lowerNegativeCount += 1;
    }

    const upperFeatureCount = [...UPPER_RESPIRATORY_FAMILIES]
        .filter((family) => signalProfile.positiveFamilies.has(family))
        .length;
    const upperComplexStrong = species === 'feline' && upperFeatureCount >= 3;
    const lowerEvidenceStrong = lowerEvidenceCount >= 2;
    const systemicScore = signalProfile.clusterScores.systemic;
    let airwayLevel: AirwayLevel = 'mixed';

    if (upperFeatureCount > 0 && !lowerEvidenceStrong) {
        airwayLevel = 'upper';
    } else if (lowerEvidenceStrong && upperFeatureCount < 2) {
        airwayLevel = 'lower';
    } else if (upperFeatureCount > 0 || lowerEvidenceStrong) {
        airwayLevel = 'mixed';
    }

    return {
        species,
        speciesGate: species === 'feline'
            ? (upperComplexStrong ? 'feline_upper_airway_priority' : 'feline_respiratory_priority')
            : `${species}_standard_routing`,
        airwayLevel,
        upperRespiratoryScore: Number(upperRespiratoryScore.toFixed(3)),
        lowerRespiratoryScore: Number(lowerRespiratoryScore.toFixed(3)),
        systemicScore,
        upperFeatureCount,
        lowerEvidenceCount,
        lowerNegativeCount,
        upperComplexStrong,
        lowerEvidenceStrong,
        oralUlcerationPresent: signalProfile.positiveFamilies.has('oral_ulceration'),
        hypersalivationPresent: signalProfile.positiveFamilies.has('hypersalivation'),
        conjunctivitisRhinitisDominant:
            signalProfile.positiveFamilies.has('conjunctivitis')
            && signalProfile.positiveFamilies.has('nasal_discharge'),
        coughDominant,
        kitten: species === 'feline' && (request.age_years ?? 999) < 1,
        noLowerAirwayEvidence: lowerEvidenceCount < 2,
    };
}

function buildOutputClusterScores(
    signalProfile: ClinicalSignalProfile,
    routingSummary: RespiratoryRoutingSummary,
): Record<string, number> {
    const baseScores: Record<string, number> = {
        ...signalProfile.clusterScores,
        lower_respiratory: routingSummary.lowerRespiratoryScore,
        systemic: routingSummary.systemicScore,
    };

    if (routingSummary.species === 'feline') {
        baseScores.feline_upper_respiratory = routingSummary.upperRespiratoryScore;
    }

    return baseScores;
}

function isFelineUpperRespiratoryCondition(conditionId: string | undefined): boolean {
    return conditionId != null && FELINE_URI_COMPLEX_IDS.has(conditionId);
}

function isFelineLowerRespiratoryCondition(conditionId: string | undefined): boolean {
    return conditionId != null && FELINE_LOWER_AIRWAY_IDS.has(conditionId);
}

function reportedConditionClass(condition: VeterinaryCondition | undefined): string {
    if (condition && (isFelineUpperRespiratoryCondition(condition.id) || condition.id === 'feline_upper_respiratory_complex')) {
        return 'Upper respiratory viral-bacterial syndrome';
    }
    return classifyConditionClass(condition);
}

function resolveSeverity(
    entries: DifferentialEntry[],
    treatmentPlans: Record<string, SelectedTreatmentPlan>,
): string | null {
    const top = entries[0];
    if (!top) return null;
    if (top.condition_id && treatmentPlans[top.condition_id]?.severity_class) {
        return treatmentPlans[top.condition_id]?.severity_class ?? null;
    }
    return top.clinical_urgency ?? null;
}

function analyzeContradictions(
    request: InferenceRequest,
    differentials: DifferentialEntry[],
    signalProfile: ClinicalSignalProfile,
    routingSummary: RespiratoryRoutingSummary,
): ContradictionAnalysis {
    const reasons: string[] = [];
    let score = 0;

    const diabetesConfirmed =
        request.diagnostic_tests?.biochemistry?.glucose === 'hyperglycemia'
        && request.diagnostic_tests?.urinalysis?.glucose_in_urine === 'present';
    const hypothyroidConfirmed =
        request.diagnostic_tests?.serology?.t4_total === 'low'
        || request.diagnostic_tests?.serology?.free_t4 === 'low';

    if (
        diabetesConfirmed
        && hypothyroidConfirmed
        && (request.symptom_vector?.includes('weight_loss') || request.presenting_signs.includes('weight_loss'))
    ) {
        score = Math.max(score, 0.75);
        reasons.push('Confirmed diabetes and hypothyroid evidence are pulling in opposite metabolic directions for the current weight-loss presentation.');
    }

    const top = differentials[0];
    if (
        top?.condition_id === 'dirofilariosis_canine'
        && request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen === 'negative'
    ) {
        score = Math.max(score, 0.85);
        reasons.push('Heartworm antigen is negative despite heartworm leading the differential.');
    }

    const topCondition = top?.condition_id ? getConditionById(top.condition_id) : undefined;
    if (topCondition) {
        const absentCardinalSignals = getAbsentMatches(topCondition.cardinal_signs, signalProfile);
        const absentCommonSignals = getAbsentMatches(topCondition.common_signs, signalProfile);
        if (absentCardinalSignals.length > 0 || absentCommonSignals.length > 0) {
            const contradictionSignals = [...new Set(
                [...absentCardinalSignals, ...absentCommonSignals].map((signal) => signal.label),
            )];
            const contradictionPenalty = Math.min(
                0.9,
                weightedMatchScore(absentCardinalSignals, 0.12) + weightedMatchScore(absentCommonSignals, 0.07),
            );
            score = Math.max(score, contradictionPenalty);
            reasons.push(
                `${topCondition.canonical_name} depends on ${contradictionSignals.join(', ')}, but the history explicitly marks those signals as absent.`,
            );
        }

        const topCluster = determineConditionCluster(topCondition);
        const giFamilies = ['vomiting', 'diarrhea', 'bloody_diarrhea', 'melena', 'hematemesis', 'abdominal_pain', 'tenesmus', 'inappetence', 'weight_loss'];
        const hasPositiveGiEvidence = giFamilies.some((family) => signalProfile.positiveFamilies.has(family)) || signalProfile.clusterScores.gi > 0;
        const explicitGiAbsence = ['vomiting', 'diarrhea', 'bloody_diarrhea'].some((family) => signalProfile.negativeFamilies.has(family));
        const explicitNormalThoracicImaging =
            request.diagnostic_tests?.thoracic_radiograph?.pulmonary_pattern === 'normal'
            && request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement === 'absent'
            && request.diagnostic_tests?.thoracic_radiograph?.pleural_effusion === 'absent';

        if (
            signalProfile.dominantCluster === 'respiratory'
            && topCluster === 'gi'
            && !hasStrongClusterEvidence(signalProfile, 'gi')
        ) {
            score = Math.max(score, 0.78);
            reasons.push('Respiratory signals dominate this case, while the leading diagnosis is gastrointestinal without strong GI evidence.');
        }
        if (
            signalProfile.dominantCluster === 'gi'
            && topCluster === 'respiratory'
            && !hasStrongClusterEvidence(signalProfile, 'respiratory')
        ) {
            score = Math.max(score, 0.78);
            reasons.push('Gastrointestinal signals dominate this case, while the leading diagnosis is respiratory without strong respiratory evidence.');
        }
        if (topCluster === 'gi' && !hasPositiveGiEvidence) {
            score = Math.max(score, 0.72);
            reasons.push('The leading diagnosis is gastrointestinal, but no validated gastrointestinal signals were observed.');
        }
        if (topCluster === 'gi' && explicitGiAbsence) {
            score = Math.max(score, 0.88);
            reasons.push('The leading gastrointestinal diagnosis conflicts with explicitly absent vomiting or diarrhea signals.');
        }
        if (
            topCluster === 'respiratory'
            && top?.clinical_urgency === 'urgent'
            && explicitNormalThoracicImaging
        ) {
            score = Math.max(score, 0.58);
            reasons.push('An urgent respiratory diagnosis is leading despite explicitly normal thoracic imaging markers.');
        }

        if (
            routingSummary.species === 'feline'
            && routingSummary.upperComplexStrong
            && routingSummary.noLowerAirwayEvidence
            && isFelineLowerRespiratoryCondition(topCondition.id)
        ) {
            score = Math.max(score, 0.84);
            reasons.push('This feline case has a strong upper respiratory syndrome without lower-airway evidence, so bronchitis or pneumonia should not lead.');
        }

        if (
            routingSummary.species === 'feline'
            && isFelineUpperRespiratoryCondition(topCondition.id)
            && routingSummary.lowerEvidenceStrong
            && routingSummary.airwayLevel === 'mixed'
        ) {
            score = Math.max(score, 0.42);
            reasons.push('Upper and lower respiratory signals are mixed in this feline case, so a single upper-airway diagnosis should remain provisional.');
        }
    }

    return {
        contradiction_score: Number(score.toFixed(3)),
        contradiction_reasons: reasons,
    };
}

function shouldAbstain(
    differentials: DifferentialEntry[],
    _request: InferenceRequest,
    contradictionAnalysis: ContradictionAnalysis,
): AbstainDecision {
    if (
        contradictionAnalysis.contradiction_score > 0.85
        && contradictionAnalysis.contradiction_reasons.length > 0
    ) {
        return {
            abstain: true,
            reason: 'genuine_clinical_contradiction',
            details: contradictionAnalysis.contradiction_reasons,
        };
    }

    const pathognomicCount = differentials.filter(
        (entry) => entry.determination_basis === 'pathognomonic_test',
    ).length;
    const hasMetabolicConflict =
        contradictionAnalysis.contradiction_score > 0.7
        && contradictionAnalysis.contradiction_reasons.some((reason) =>
            reason.toLowerCase().includes('diabetes') && reason.toLowerCase().includes('hypothyroid'),
        );
    if (hasMetabolicConflict) {
        return {
            abstain: true,
            reason: 'genuine_clinical_contradiction',
            details: contradictionAnalysis.contradiction_reasons,
        };
    }
    if (
        pathognomicCount > 1
        && contradictionAnalysis.contradiction_score > 0.7
        && contradictionAnalysis.contradiction_reasons.length > 0
    ) {
        return {
            abstain: true,
            reason: 'genuine_clinical_contradiction',
            details: contradictionAnalysis.contradiction_reasons,
        };
    }
    if (pathognomicCount > 0) {
        return { abstain: false, reason: 'pathognomonic_finding_present' };
    }

    if (
        contradictionAnalysis.contradiction_score > 0.7
        && contradictionAnalysis.contradiction_reasons.length > 0
    ) {
        return {
            abstain: false,
            reason: null,
            details: contradictionAnalysis.contradiction_reasons,
            competitive_differential: true,
            confirmatory_testing_urgent: true,
            message: 'Clinical contradictions remain unresolved - confirmatory testing is required before committing to the leading diagnosis.',
        };
    }

    const maxProbability = Math.max(...differentials.map((entry) => entry.probability), 0);
    if (maxProbability < 0.05) {
        return {
            abstain: true,
            reason: 'insufficient_clinical_signal',
            details: ['No presenting signs or history provided'],
        };
    }

    const spread = differentials[0] && differentials[1]
        ? differentials[0].probability - differentials[1].probability
        : 1;
    if (spread < 0.05 || maxProbability < 0.55) {
        return {
            abstain: false,
            reason: null,
            competitive_differential: true,
            confirmatory_testing_urgent: true,
            message: 'Differential is competitive - confirmatory testing required to distinguish the top diagnoses',
        };
    }

    return { abstain: false, reason: null };
}

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function mergeObject<T>(primary: T | undefined, secondary: T | undefined): T | undefined {
    if (primary != null) return primary;
    return secondary;
}

function coerceInferenceRequest(raw: InferenceRequest | Record<string, unknown>): InferenceRequest {
    const candidate = raw as Record<string, unknown>;
    const metadata = candidate.metadata && typeof candidate.metadata === 'object'
        ? candidate.metadata as Record<string, unknown>
        : {};
    const normalizedLabEvidence = normalizeClinicalLabEvidence(candidate, metadata);
    const diagnosticTests = mergeDiagnosticTests(
        metadata.diagnostic_tests as InferenceRequest['diagnostic_tests'] | undefined,
        normalizedLabEvidence.diagnostic_tests,
        candidate.diagnostic_tests as InferenceRequest['diagnostic_tests'] | undefined,
    );
    const presenting = [
        ...collectStringArray(candidate.presenting_signs, candidate.symptom_vector, candidate.symptoms),
        ...collectStringArray(metadata.presenting_signs, metadata.symptom_vector, metadata.symptoms),
    ];
    const normalizedPresenting = [...new Set(
        presenting
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => normalizeKey(entry)),
    )];
    const canonicalSymptomVector = normalizeCanonicalSignalArray(presenting);

    return {
        species: typeof candidate.species === 'string' ? candidate.species : typeof metadata.species === 'string' ? metadata.species : 'canine',
        breed: typeof candidate.breed === 'string' ? candidate.breed : typeof metadata.breed === 'string' ? metadata.breed : undefined,
        age_years: typeof candidate.age_years === 'number'
            ? candidate.age_years
            : typeof metadata.age_years === 'number'
                ? metadata.age_years
                : typeof metadata.age_months === 'number'
                    ? Number((Number(metadata.age_months) / 12).toFixed(2))
                    : undefined,
        weight_kg: typeof candidate.weight_kg === 'number'
            ? candidate.weight_kg
            : typeof metadata.weight_kg === 'number'
                ? metadata.weight_kg
                : undefined,
        sex: typeof candidate.sex === 'string' ? candidate.sex : typeof metadata.sex === 'string' ? metadata.sex : undefined,
        region: typeof candidate.region === 'string' ? candidate.region : typeof metadata.region === 'string' ? metadata.region : undefined,
        symptom_vector: canonicalSymptomVector,
        presenting_signs: normalizedPresenting,
        history: mergeObject(candidate.history as InferenceRequest['history'] | undefined, metadata.history as InferenceRequest['history'] | undefined),
        preventive_history: mergeObject(candidate.preventive_history as InferenceRequest['preventive_history'] | undefined, metadata.preventive_history as InferenceRequest['preventive_history'] | undefined),
        diagnostic_tests: diagnosticTests,
        evidence_normalization: normalizedLabEvidence.normalized_findings.length > 0 || normalizedLabEvidence.warnings.length > 0
            ? {
                normalized_findings: normalizedLabEvidence.normalized_findings,
                warnings: normalizedLabEvidence.warnings,
            }
            : undefined,
        physical_exam: mergeObject(candidate.physical_exam as InferenceRequest['physical_exam'] | undefined, metadata.physical_exam as InferenceRequest['physical_exam'] | undefined),
    };
}

function buildInitialState(candidate: VeterinaryCondition, score: number): CandidateState {
    const recommendedConfirmatoryTests = new Set<string>();
    for (const rule of candidate.pathognomonic_tests) {
        recommendedConfirmatoryTests.add(rule.evidence_label ?? rule.test);
    }
    for (const rule of candidate.supporting_tests) {
        recommendedConfirmatoryTests.add(rule.evidence_label ?? rule.test);
    }

    return {
        condition: candidate,
        score,
        basis: 'symptom_scoring',
        supporting: [],
        contradicting: [],
        recommendedConfirmatoryTests,
        recommendedNextSteps: new Set<string>(),
    };
}

function applyAdjustments(states: Map<string, CandidateState>, adjustments: ScoreAdjustment[]) {
    for (const adjustment of adjustments) {
        const state = states.get(adjustment.condition_id);
        if (!state) continue;

        state.score = Math.max(0, state.score + adjustment.delta);
        if (adjustment.penalty) {
            state.contradicting.push({
                finding: adjustment.finding,
                weight: Math.abs(adjustment.delta) >= 0.3 ? 'excludes' : 'weakens',
            });
        } else {
            state.supporting.push({
                finding: adjustment.finding,
                weight: toEvidenceWeight(adjustment.weight),
            });
            if (adjustment.determination_basis) {
                state.basis = adjustment.determination_basis;
            }
            if (adjustment.relationship_to_primary) {
                state.relationship = adjustment.relationship_to_primary;
            }
        }
    }
}

function toEvidenceWeight(weight: ScoreAdjustment['weight']): EvidenceWeight {
    return weight === 'weakens' || weight === 'excludes' ? 'minor' : weight;
}

function applyFelineRespiratoryRouting(
    states: Map<string, CandidateState>,
    request: InferenceRequest,
    signalProfile: ClinicalSignalProfile,
    routingSummary: RespiratoryRoutingSummary,
) {
    if (routingSummary.species !== 'feline') {
        return;
    }

    for (const state of states.values()) {
        const conditionId = state.condition.id;
        let delta = 0;

        if (conditionId === 'feline_upper_respiratory_complex') {
            if (routingSummary.upperComplexStrong) {
                delta += 0.62;
            }
            if (routingSummary.airwayLevel === 'upper') {
                delta += 0.18;
            }
            if (routingSummary.noLowerAirwayEvidence) {
                delta += 0.12;
            }
            if (routingSummary.lowerNegativeCount > 0) {
                delta += 0.08;
            }
        }

        if (conditionId === 'feline_herpesvirus_1_infection' && routingSummary.conjunctivitisRhinitisDominant) {
            delta += 0.24;
            state.supporting.push({
                finding: 'Conjunctivitis with rhinitis strongly routes toward feline herpesvirus involvement',
                weight: 'supportive',
            });
        }

        if (conditionId === 'feline_calicivirus_infection' && (routingSummary.oralUlcerationPresent || routingSummary.hypersalivationPresent)) {
            delta += 0.28;
            state.supporting.push({
                finding: 'Oral ulceration or hypersalivation strongly routes toward feline calicivirus',
                weight: 'supportive',
            });
        }

        if (conditionId === 'chlamydophila_felis_upper_respiratory_infection' && routingSummary.conjunctivitisRhinitisDominant) {
            delta += 0.2;
            state.supporting.push({
                finding: 'Conjunctivitis with rhinitis supports Chlamydophila-associated upper respiratory disease',
                weight: 'supportive',
            });
        }

        if (
            conditionId === 'feline_secondary_bacterial_upper_respiratory_infection'
            && signalProfile.positiveSignals.has('nasal_discharge_mucopurulent')
        ) {
            delta += 0.18;
            state.supporting.push({
                finding: 'Mucopurulent nasal discharge supports secondary bacterial upper respiratory infection',
                weight: 'supportive',
            });
        }

        if (
            conditionId === 'bordetella_bronchiseptica_feline'
            && routingSummary.kitten
            && (routingSummary.coughDominant || routingSummary.lowerEvidenceStrong)
        ) {
            delta += 0.18;
            state.supporting.push({
                finding: 'Kitten lower-airway involvement keeps Bordetella in the differential',
                weight: 'minor',
            });
        }

        if (isFelineUpperRespiratoryCondition(conditionId) && routingSummary.upperComplexStrong) {
            delta += 0.14;
        }

        if (isFelineLowerRespiratoryCondition(conditionId)) {
            if (routingSummary.noLowerAirwayEvidence) {
                delta -= 0.38;
            }
            if (routingSummary.upperComplexStrong) {
                delta -= 0.22;
            }
            if (routingSummary.lowerNegativeCount > 0) {
                delta -= 0.18;
            }
            if (
                signalProfile.positiveFamilies.has('conjunctivitis')
                || signalProfile.positiveFamilies.has('oral_ulceration')
                || signalProfile.positiveFamilies.has('hypersalivation')
            ) {
                delta -= 0.12;
            }
            if (routingSummary.lowerEvidenceStrong) {
                delta += 0.24;
            }
            if (routingSummary.airwayLevel === 'mixed') {
                delta -= 0.08;
            }

            if (delta < 0) {
                state.contradicting.push({
                    finding: 'Feline upper-airway syndrome is stronger than lower-airway evidence in this case',
                    weight: 'weakens',
                });
            }
        }

        if (delta > 0 && isFelineUpperRespiratoryCondition(conditionId)) {
            state.supporting.push({
                finding: 'Species gate prioritizes feline upper respiratory disease patterns',
                weight: 'supportive',
            });
        }

        state.score = Math.max(0, Number((state.score + delta).toFixed(3)));
    }
}

function scoreSymptoms(
    states: Map<string, CandidateState>,
    signalProfile: ClinicalSignalProfile,
    routingSummary: RespiratoryRoutingSummary,
) {
    for (const state of states.values()) {
        const condition = state.condition;
        const conditionCluster = determineConditionCluster(condition);
        let delta = 0;

        const cardinalHits = getSupportingMatches(condition.cardinal_signs, signalProfile, conditionCluster);
        const commonHits = getSupportingMatches(condition.common_signs, signalProfile, conditionCluster);
        const rareHits = getSupportingMatches(condition.rare_signs, signalProfile, conditionCluster);
        const exclusionHits = getSupportingMatches(condition.signs_that_exclude, signalProfile, conditionCluster);
        const absentCardinalSignals = getAbsentMatches(condition.cardinal_signs, signalProfile);
        const absentCommonSignals = getAbsentMatches(condition.common_signs, signalProfile);
        const positiveHits = [...cardinalHits, ...commonHits, ...rareHits];
        const allowLowSpecificityContribution = positiveHits.some((match) => match.specificity !== 'low') || signalProfile.totalStrongSignals > 0;

        delta += weightedMatchScore(cardinalHits.filter((match) => match.specificity !== 'low'), 0.08);
        delta += weightedMatchScore(commonHits.filter((match) => match.specificity !== 'low'), 0.04);
        delta += weightedMatchScore(rareHits.filter((match) => match.specificity !== 'low'), 0.015);
        if (allowLowSpecificityContribution) {
            delta += weightedMatchScore(cardinalHits.filter((match) => match.specificity === 'low'), 0.02);
            delta += weightedMatchScore(commonHits.filter((match) => match.specificity === 'low'), 0.015);
            delta += weightedMatchScore(rareHits.filter((match) => match.specificity === 'low'), 0.01);
        }
        delta -= weightedMatchScore(exclusionHits, 0.08);
        delta -= weightedMatchScore(absentCardinalSignals, 0.10);
        delta -= weightedMatchScore(absentCommonSignals, 0.055);

        if (mappedSignalCount(condition.cardinal_signs) > 0 && cardinalHits.length === 0) {
            delta -= 0.06;
        }
        if (isLowSpecificityOnly(positiveHits)) {
            delta -= 0.04;
        }

        if (signalProfile.dominantCluster === 'respiratory') {
            if (conditionCluster === 'respiratory') {
                delta += 0.16;
            } else if (
                conditionCluster === 'gi'
                && !hasStrongClusterEvidence(signalProfile, 'gi')
            ) {
                delta -= 0.22;
            } else if (!signalProfile.mixedClusters.includes(conditionCluster)) {
                delta -= 0.06;
            }
        }
        if (signalProfile.dominantCluster === 'gi') {
            if (conditionCluster === 'gi') {
                delta += 0.16;
            } else if (
                conditionCluster === 'respiratory'
                && !hasStrongClusterEvidence(signalProfile, 'respiratory')
            ) {
                delta -= 0.22;
            } else if (!signalProfile.mixedClusters.includes(conditionCluster)) {
                delta -= 0.06;
            }
        }

        if (routingSummary.species === 'feline') {
            if (isFelineUpperRespiratoryCondition(condition.id) && routingSummary.upperComplexStrong) {
                delta += 0.16;
            }
            if (isFelineLowerRespiratoryCondition(condition.id) && routingSummary.noLowerAirwayEvidence) {
                delta -= 0.2;
            }
        }

        if (delta > 0) {
            state.supporting.push(...cardinalHits.map((finding) => ({
                finding: `Presenting sign: ${finding.label}`,
                weight: finding.specificity === 'low' ? 'minor' as const : 'supportive' as const,
            })));
            state.supporting.push(...commonHits.map((finding) => ({
                finding: `Presenting sign: ${finding.label}`,
                weight: finding.specificity === 'high' ? 'supportive' as const : 'minor' as const,
            })));
            state.supporting.push(...rareHits.map((finding) => ({
                finding: `Presenting sign: ${finding.label}`,
                weight: 'minor' as const,
            })));
            if (signalProfile.dominantCluster && conditionCluster === signalProfile.dominantCluster) {
                state.supporting.push({
                    finding: `Dominant ${formatClusterLabel(conditionCluster)} cluster aligns with this diagnosis`,
                    weight: 'supportive',
                });
            }
        }
        if (delta < 0 && exclusionHits.length > 0) {
            state.contradicting.push(...exclusionHits.map((finding) => ({
                finding: `Sign pattern weakens this diagnosis: ${finding.label}`,
                weight: 'weakens' as const,
            })));
        }
        if (absentCardinalSignals.length > 0 || absentCommonSignals.length > 0) {
            state.contradicting.push(...absentCardinalSignals.map((finding) => ({
                finding: `History explicitly denies required signal: ${finding.label}`,
                weight: 'excludes' as const,
            })));
            state.contradicting.push(...absentCommonSignals.map((finding) => ({
                finding: `History explicitly denies supporting signal: ${finding.label}`,
                weight: 'weakens' as const,
            })));
        }
        if (
            signalProfile.dominantCluster === 'respiratory'
            && conditionCluster === 'gi'
            && !hasStrongClusterEvidence(signalProfile, 'gi')
        ) {
            state.contradicting.push({
                finding: 'Respiratory cluster dominates without strong gastrointestinal evidence',
                weight: 'weakens',
            });
        }
        if (
            signalProfile.dominantCluster === 'gi'
            && conditionCluster === 'respiratory'
            && !hasStrongClusterEvidence(signalProfile, 'respiratory')
        ) {
            state.contradicting.push({
                finding: 'Gastrointestinal cluster dominates without strong respiratory evidence',
                weight: 'weakens',
            });
        }
        if (isLowSpecificityOnly(positiveHits)) {
            state.contradicting.push({
                finding: 'Only low-specificity systemic signals support this diagnosis',
                weight: 'weakens',
            });
        }

        state.score = Math.max(0, Number((state.score + delta).toFixed(3)));
    }
}

function normalise(entries: DifferentialEntry[]): DifferentialEntry[] {
    const positiveTotal = entries.reduce((sum, entry) => sum + Math.max(0, entry.probability), 0) || 1;
    return entries
        .map((entry) => ({
            ...entry,
            probability: Math.max(0, entry.probability) / positiveTotal,
        }))
        .filter((entry) => entry.probability > 0)
        .sort((left, right) => right.probability - left.probability)
        .map((entry, index) => ({
            ...entry,
            rank: index + 1,
        }));
}

function confidenceFromProbability(probability: number): DifferentialEntry['confidence'] {
    if (probability >= 0.75) return 'high';
    if (probability >= 0.3) return 'moderate';
    return 'low';
}

function urgencyForCondition(conditionId: string): ClinicalUrgency {
    if (['dirofilariosis_canine', 'babesiosis_canine', 'leptospirosis', 'parvoviral_enteritis', 'gastric_dilatation_volvulus'].includes(conditionId)) {
        return 'urgent';
    }
    return 'routine';
}

function buildDifferentials(states: Map<string, CandidateState>): DifferentialEntry[] {
    const rawEntries: DifferentialEntry[] = [...states.values()].map((state) => ({
        rank: 0,
        condition: state.condition.canonical_name,
        condition_id: state.condition.id,
        icd_vet_code: state.condition.icd_vet_code,
        probability: state.score,
        confidence: confidenceFromProbability(state.score),
        determination_basis: state.basis,
        supporting_evidence: dedupeEvidence(state.supporting),
        contradicting_evidence: dedupeContradictions(state.contradicting),
        relationship_to_primary: state.relationship,
        clinical_urgency: urgencyForCondition(state.condition.id),
        recommended_confirmatory_tests: [...state.recommendedConfirmatoryTests],
        recommended_next_steps: [...state.recommendedNextSteps],
    }));

    return normalise(rawEntries);
}

function dedupeEvidence(entries: EvidenceEntry[]): EvidenceEntry[] {
    const seen = new Set<string>();
    const output: EvidenceEntry[] = [];
    for (const entry of entries) {
        const key = `${entry.finding}::${entry.weight}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(entry);
    }
    return output;
}

function dedupeContradictions(entries: ContradictingEvidenceEntry[]): ContradictingEvidenceEntry[] {
    const seen = new Set<string>();
    const output: ContradictingEvidenceEntry[] = [];
    for (const entry of entries) {
        const key = `${entry.finding}::${entry.weight}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(entry);
    }
    return output;
}

function classifyConditionClass(condition: VeterinaryCondition | undefined): ConditionClass {
    switch (condition?.etiological_class) {
        case 'parasitic_helminth':
        case 'parasitic_protozoan':
        case 'parasitic_ectoparasite':
        case 'bacterial':
        case 'viral':
        case 'fungal':
            return 'Infectious';
        case 'metabolic_endocrine':
            return 'Metabolic / Endocrine';
        case 'cardiovascular_structural':
        case 'respiratory_structural':
        case 'gastrointestinal_structural':
        case 'congenital':
            return 'Mechanical';
        case 'immune_mediated':
            return 'Autoimmune / Immune-Mediated';
        case 'neoplastic':
            return 'Neoplastic';
        case 'traumatic':
            return 'Traumatic';
        case 'toxic':
            return 'Toxic';
        default:
            return 'Idiopathic / Unknown';
    }
}

function buildConditionClassProbabilities(entries: DifferentialEntry[]): Record<ConditionClass, number> {
    const totals: Record<ConditionClass, number> = {
        Mechanical: 0,
        Infectious: 0,
        Toxic: 0,
        Neoplastic: 0,
        'Autoimmune / Immune-Mediated': 0,
        'Metabolic / Endocrine': 0,
        Traumatic: 0,
        Degenerative: 0,
        'Idiopathic / Unknown': 0,
    };
    for (const entry of entries) {
        const condition = entry.condition_id ? getConditionById(entry.condition_id) : undefined;
        totals[classifyConditionClass(condition)] += entry.probability;
    }
    return totals;
}

function computeDataCompleteness(request: InferenceRequest): number {
    const checks = [
        request.species,
        request.breed,
        request.presenting_signs.length > 0 ? 'signs' : null,
        request.preventive_history?.heartworm_prevention,
        request.preventive_history?.vector_exposure?.mosquito_endemic != null ? 'mosquito' : null,
        request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen,
        request.diagnostic_tests?.cbc?.eosinophilia,
        request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement,
        request.diagnostic_tests?.echocardiography?.worms_visualised,
    ];
    const present = checks.filter((value) => value != null).length;
    return Number((present / checks.length).toFixed(2));
}

function buildInferenceExplanation(
    request: InferenceRequest,
    differentials: DifferentialEntry[],
    excludedConditions: InferenceExplanation['excluded_conditions'],
    primaryBasis: DifferentialBasis,
    keyFinding: string,
): InferenceExplanation {
    const top = differentials[0];
    const missingData = new Set<string>();
    const topCondition = top?.condition_id ? getConditionById(top.condition_id) : undefined;
    for (const rule of topCondition?.pathognomonic_tests ?? []) {
        const label = rule.evidence_label ?? rule.test;
        if ((top?.supporting_evidence ?? []).every((entry) => entry.finding !== label)) {
            missingData.add(label);
        }
    }

    return {
        primary_determination: primaryBasis,
        key_finding: keyFinding,
        excluded_conditions: excludedConditions,
        evidence_quality: top?.probability != null && top.probability >= 0.8 ? 'high' : top?.probability != null && top.probability >= 0.4 ? 'moderate' : 'low',
        data_completeness_score: computeDataCompleteness(request),
        missing_data_that_would_help: [...missingData],
    };
}

function inferHeartwormSeverityClass(request: InferenceRequest): string | null {
    const signs = new Set(request.presenting_signs);
    const cyanotic = request.physical_exam?.mucous_membrane_color === 'cyanotic';
    const delayedPerfusion = (request.physical_exam?.capillary_refill_time_s ?? 0) > 3;
    if (signs.has('collapse') || signs.has('caval_syndrome') || cyanotic || delayedPerfusion) return 'IV';
    if (signs.has('syncope') || signs.has('ascites') || signs.has('hemoptysis')) return 'III';
    if (signs.has('exercise_intolerance') || signs.has('chronic_cough') || signs.has('dyspnea')) return 'II';
    return 'I';
}

function buildTreatmentPlans(entries: DifferentialEntry[], request: InferenceRequest): Record<string, SelectedTreatmentPlan> {
    const topThree = entries.slice(0, 3);
    const context: TreatmentContext = {
        geographic_region: request.region ?? request.history?.geographic_region ?? 'east_africa',
        resource_level: 'secondary',
        concurrent_conditions: topThree.slice(1).map((entry) => entry.condition),
        patient_signalment: {
            age_category: request.age_years != null && request.age_years < 1 ? 'puppy' : request.age_years != null && request.age_years >= 9 ? 'senior' : 'adult',
            reproductive_status: request.sex?.includes('intact') ? (request.sex as TreatmentContext['patient_signalment']['reproductive_status']) : 'neutered',
            weight_kg: request.weight_kg ?? 20,
        },
    };

    const plans: Record<string, SelectedTreatmentPlan> = {};
    for (const entry of topThree) {
        if (!entry.condition_id) continue;
        const condition = getConditionById(entry.condition_id);
        if (!condition) continue;
        const severityClass = entry.condition_id === 'dirofilariosis_canine' ? inferHeartwormSeverityClass(request) : null;
        plans[entry.condition_id] = selectTreatmentProtocol(condition, severityClass, request, context);
    }

    return plans;
}

function buildGroundTruthSummary(entries: DifferentialEntry[]): InferenceResponse['ground_truth_summary'] {
    const primary = entries[0];
    const status = primary?.ground_truth_explanation?.confirmation_status ?? 'unconfirmed';
    return {
        primary_diagnosis_status: status === 'confirmed' || status === 'highly_supported' ? status : 'unconfirmed',
        key_confirmatory_finding: primary?.supporting_evidence[0]?.finding,
        missing_confirmatory_tests: primary?.ground_truth_explanation?.missing_criteria ?? [],
        confidence_level: primary?.confidence ?? 'low',
        recommended_immediate_actions: primary?.recommended_next_steps ?? [],
    };
}

function buildDiagnosisSummary(entries: DifferentialEntry[]): InferenceResponse['diagnosis'] {
    const top = entries[0];
    return {
        analysis: top
            ? `${top.condition} is prioritised based on ${top.determination_basis.replace(/_/g, ' ')} with linked confirmatory evidence and clinical plausibility filtering.`
            : 'No defensible differential could be established from the provided data.',
        primary_condition_class: classifyConditionClass(top?.condition_id ? getConditionById(top.condition_id) : undefined),
        condition_class_probabilities: buildConditionClassProbabilities(entries),
        top_differentials: entries,
        confidence_score: top?.probability ?? 0,
    };
}

function computeDifferentialSpread(entries: DifferentialEntry[]) {
    return {
        top_1_probability: entries[0]?.probability ?? null,
        top_2_probability: entries[1]?.probability ?? null,
        top_3_probability: entries[2]?.probability ?? null,
        spread: entries[0] && entries[1] ? Number((entries[0].probability - entries[1].probability).toFixed(4)) : null,
    };
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function evidenceDensity(entry: DifferentialEntry): number {
    const supporting = entry.supporting_evidence.length;
    const contradicting = entry.contradicting_evidence.length;
    const missing = entry.missing_evidence?.length ?? 0;
    return clamp01(supporting / Math.max(1, supporting + contradicting + missing));
}

function addMissingEvidence(entries: DifferentialEntry[]): DifferentialEntry[] {
    return entries.map((entry) => {
        const condition = entry.condition_id ? getConditionById(entry.condition_id) : undefined;
        const observedFindings = new Set([
            ...entry.supporting_evidence.map((evidence) => evidence.finding),
            ...entry.contradicting_evidence.map((evidence) => evidence.finding),
        ]);
        const missing: EvidenceEntry[] = [];

        for (const rule of condition?.pathognomonic_tests ?? []) {
            const label = rule.evidence_label ?? rule.test;
            if (!observedFindings.has(label)) {
                missing.push({ finding: label, weight: rule.required_for_confirmation ? 'strong' : 'supportive' });
            }
        }
        for (const rule of condition?.supporting_tests ?? []) {
            const label = rule.evidence_label ?? rule.test;
            if (!observedFindings.has(label)) {
                missing.push({ finding: label, weight: 'supportive' });
            }
        }

        const density = evidenceDensity({
            ...entry,
            missing_evidence: dedupeEvidence(missing),
        });

        return {
            ...entry,
            missing_evidence: dedupeEvidence(missing).slice(0, 6),
            evidence_density: density,
            probability_interval: buildProbabilityInterval(entry.probability, density, entry.contradicting_evidence.length),
        };
    });
}

function buildProbabilityInterval(
    probability: number,
    density: number,
    contradictionCount: number,
): { low: number; high: number } {
    const width = Math.max(0.04, Math.min(0.32, 0.24 - (density * 0.12) + (contradictionCount * 0.035)));
    return {
        low: clamp01(probability - width),
        high: clamp01(probability + width),
    };
}

function contradictionScoreForEntry(entry: DifferentialEntry): number {
    const hard = entry.contradicting_evidence.filter((evidence) => evidence.weight === 'excludes').length;
    const weak = entry.contradicting_evidence.length - hard;
    return clamp01((hard * 0.45) + (weak * 0.16));
}

function enrichDifferentials(entries: DifferentialEntry[]): DifferentialEntry[] {
    return addMissingEvidence(entries).map((entry) => ({
        ...entry,
        evidence_density: evidenceDensity(entry),
        contradiction_score: contradictionScoreForEntry(entry),
        probability_interval: buildProbabilityInterval(
            entry.probability,
            evidenceDensity(entry),
            entry.contradicting_evidence.length,
        ),
    }));
}

function buildSpeciesValidationReport(
    request: InferenceRequest,
    routingSummary: RespiratoryRoutingSummary,
): SpeciesValidationReport {
    const eligibleConditionCount = getConditionsForSpecies(routingSummary.species).length;
    const excludedSpecies = (['canine', 'feline', 'bovine', 'ovine', 'caprine', 'equine'] as Species[])
        .filter((species) => species !== routingSummary.species);
    const excludedConditionCount = excludedSpecies
        .reduce((sum, species) => sum + getConditionsForSpecies(species).length, 0);

    return {
        input_species: request.species,
        canonical_species: routingSummary.species,
        eligible_species: [routingSummary.species],
        eligible_condition_count: eligibleConditionCount,
        excluded_condition_count: excludedConditionCount,
        excluded_species: excludedSpecies,
        gate: `species:${routingSummary.species}:eligible_disease_space_before_scoring`,
    };
}

function pathwayContributions(
    domain: ClinicalSignalDomain,
    signalProfile: ClinicalSignalProfile,
): PathwayContribution[] {
    const contributions: PathwayContribution[] = [];
    for (const signal of signalProfile.positiveSignals) {
        if (!domainsForSignal(signal).includes(domain)) continue;
        contributions.push({
            finding: formatClinicalSignalLabel(signal),
            weight: specificityWeight(signal),
            reason: `${formatClusterLabel(domain)} pathway receives ${specificityForSignal(signal)}-specificity positive evidence.`,
        });
    }
    return contributions.sort((left, right) => right.weight - left.weight);
}

function buildPathwayAnalysis(
    signalProfile: ClinicalSignalProfile,
    routingSummary: RespiratoryRoutingSummary,
): PathwayAnalysisEntry[] {
    const systems = (['respiratory', 'gi', 'neuro', 'cardio', 'systemic'] as ClinicalSignalDomain[])
        .map((domain) => ({
            system: formatClusterLabel(domain),
            score: Number((signalProfile.clusterScores[domain] ?? 0).toFixed(3)),
            contributing_findings: pathwayContributions(domain, signalProfile),
        }))
        .filter((entry) => entry.score > 0 || entry.contributing_findings.length > 0);

    if (routingSummary.species === 'feline' && routingSummary.upperRespiratoryScore > 0) {
        systems.push({
            system: 'feline upper respiratory',
            score: Number(routingSummary.upperRespiratoryScore.toFixed(3)),
            contributing_findings: [
                ...pathwayContributions('respiratory', signalProfile)
                    .filter((entry) => UPPER_RESPIRATORY_FAMILIES.has(entry.finding.replace(/ /g, '_')) || /nasal|ocular|conjunctivitis|oral|salivation|sneezing/i.test(entry.finding)),
            ],
        });
    }

    return systems.sort((left, right) => right.score - left.score);
}

function mechanismForCondition(condition: VeterinaryCondition | undefined): string {
    switch (condition?.etiological_class) {
        case 'gastrointestinal_structural':
            return 'obstruction or inflammatory gastrointestinal dysfunction';
        case 'respiratory_structural':
            return 'airway or pulmonary structural dysfunction';
        case 'cardiovascular_structural':
            return 'cardiovascular pump or vascular dysfunction';
        case 'metabolic_endocrine':
            return 'endocrine or metabolic regulation failure';
        case 'bacterial':
        case 'viral':
        case 'fungal':
        case 'parasitic_helminth':
        case 'parasitic_protozoan':
        case 'parasitic_ectoparasite':
            return 'infectious pathophysiology';
        case 'immune_mediated':
            return 'immune-mediated tissue injury';
        case 'toxic':
            return 'toxic insult';
        case 'traumatic':
            return 'traumatic injury';
        default:
            return 'undifferentiated mechanism';
    }
}

function buildMechanismAnalysis(
    entries: DifferentialEntry[],
    signalProfile: ClinicalSignalProfile,
): MechanismAnalysisEntry[] {
    return entries.slice(0, 5).map((entry) => {
        const condition = entry.condition_id ? getConditionById(entry.condition_id) : undefined;
        const system = condition ? determineConditionCluster(condition) : signalProfile.dominantCluster ?? 'systemic';
        return {
            system: formatClusterLabel(system),
            mechanism: mechanismForCondition(condition),
            syndrome: reportedConditionClass(condition),
            score: entry.probability,
            reason: `${entry.condition} is considered after routing through ${formatClusterLabel(system)} signals and ${mechanismForCondition(condition)}.`,
        };
    });
}

function buildConfidenceCalibration(
    entries: DifferentialEntry[],
    contradictionAnalysis: ContradictionAnalysis,
): Record<string, ConfidenceCalibrationReport> {
    return Object.fromEntries(entries.map((entry) => {
        const density = evidenceDensity(entry);
        const interval = entry.probability_interval ?? buildProbabilityInterval(entry.probability, density, entry.contradicting_evidence.length);
        const contradictionPenalty = Math.max(contradictionAnalysis.contradiction_score, entry.contradiction_score ?? 0);
        const confidence = computeReportedConfidence(entry.probability, contradictionPenalty);
        return [entry.condition_id ?? entry.condition, {
            probability: entry.probability,
            confidence,
            evidence_density: density,
            uncertainty_range: interval,
            calibration_notes: [
                density < 0.45 ? 'Evidence density is low; confidence remains intentionally conservative.' : 'Evidence density supports the reported probability.',
                contradictionPenalty > 0 ? `Contradiction burden reduced confidence by ${Math.round(contradictionPenalty * 100)}%.` : 'No major contradiction burden detected.',
            ],
        }];
    }));
}

function buildReliabilityBreakdown(
    request: InferenceRequest,
    entries: DifferentialEntry[],
    signalProfile: ClinicalSignalProfile,
    contradictionAnalysis: ContradictionAnalysis,
    routingSummary: RespiratoryRoutingSummary,
): ReliabilityBreakdown {
    const top = entries[0];
    const spread = entries[0] && entries[1] ? entries[0].probability - entries[1].probability : 0;
    const evidence = top ? evidenceDensity(top) : 0;
    const ontologyMatch = clamp01((signalProfile.positiveSignals.size - signalProfile.ignoredInputs.length) / Math.max(1, signalProfile.positiveSignals.size + signalProfile.ignoredInputs.length));
    const breakdown = {
        input_completeness: computeDataCompleteness(request),
        species_confidence: routingSummary.species === normalizeSpecies(request.species) ? 1 : 0.72,
        evidence_density: evidence,
        diagnostic_separation: clamp01(spread * 2.2),
        ontology_match: ontologyMatch,
        contradiction_burden: clamp01(1 - contradictionAnalysis.contradiction_score),
        composite_reliability_score: 0,
    };
    breakdown.composite_reliability_score = clamp01(
        (breakdown.input_completeness * 0.18)
        + (breakdown.species_confidence * 0.18)
        + (breakdown.evidence_density * 0.22)
        + (breakdown.diagnostic_separation * 0.16)
        + (breakdown.ontology_match * 0.14)
        + (breakdown.contradiction_burden * 0.12),
    );
    return breakdown;
}

function buildInformationGain(
    entries: DifferentialEntry[],
): ClinicalIntelligenceReport['information_gain_engine'] {
    const topEntries = entries.slice(0, 3);
    const missing = topEntries.flatMap((entry) => (entry.missing_evidence ?? []).map((evidence) => ({
        entry,
        evidence,
    })));
    const questions: InformationGainRecommendation[] = [];
    const tests: InformationGainRecommendation[] = [];

    for (const item of missing) {
        const isTest = /\b(test|radiograph|ultrasound|pcr|serology|antigen|cbc|glucose|urinalysis|echocardiographic|visualisation|lipase|acth|t4|cytology)\b/i.test(item.evidence.finding);
        const reduction = clamp01((item.entry.probability * 0.42) + (item.evidence.weight === 'strong' || item.evidence.weight === 'definitive' ? 0.18 : 0.08));
        const recommendation: InformationGainRecommendation = {
            type: isTest ? 'test' : 'question',
            prompt: isTest ? item.evidence.finding : `Is ${item.evidence.finding.toLowerCase()} present?`,
            expected_uncertainty_reduction: reduction,
            resolves: [item.entry.condition],
            reason: `This ${isTest ? 'test' : 'question'} targets missing evidence for ${item.entry.condition}.`,
        };
        if (isTest) {
            tests.push(recommendation);
        } else {
            questions.push(recommendation);
        }
    }

    if (questions.length === 0 && topEntries[0]) {
        questions.push({
            type: 'question',
            prompt: `Has the patient shown ${topEntries[0].supporting_evidence[0]?.finding.replace(/^Presenting sign:\s*/i, '').toLowerCase() ?? 'progression of the leading signs'}?`,
            expected_uncertainty_reduction: 0.18,
            resolves: [topEntries[0].condition],
            reason: 'Clarifies persistence and progression of the leading pathway.',
        });
    }

    return {
        next_best_questions: questions.sort((left, right) => right.expected_uncertainty_reduction - left.expected_uncertainty_reduction).slice(0, 3),
        next_best_tests: tests.sort((left, right) => right.expected_uncertainty_reduction - left.expected_uncertainty_reduction).slice(0, 5),
    };
}

function buildClinicalIntelligenceReport(input: {
    request: InferenceRequest;
    entries: DifferentialEntry[];
    signalProfile: ClinicalSignalProfile;
    routingSummary: RespiratoryRoutingSummary;
    contradictionAnalysis: ContradictionAnalysis;
    uncertaintyNotes: string[];
}): ClinicalIntelligenceReport & { reliability_breakdown: ReliabilityBreakdown } {
    const speciesValidation = buildSpeciesValidationReport(input.request, input.routingSummary);
    const pathwayAnalysis = buildPathwayAnalysis(input.signalProfile, input.routingSummary);
    const mechanismAnalysis = buildMechanismAnalysis(input.entries, input.signalProfile);
    const confidenceCalibration = buildConfidenceCalibration(input.entries, input.contradictionAnalysis);
    const informationGain = buildInformationGain(input.entries);
    const recommendedTests = [...new Set(input.entries.slice(0, 5).flatMap((entry) => entry.recommended_confirmatory_tests ?? []))];
    const reliabilityBreakdown = buildReliabilityBreakdown(
        input.request,
        input.entries,
        input.signalProfile,
        input.contradictionAnalysis,
        input.routingSummary,
    );
    const evidenceFor = Object.fromEntries(input.entries.map((entry) => [entry.condition_id ?? entry.condition, entry.supporting_evidence]));
    const evidenceAgainst = Object.fromEntries(input.entries.map((entry) => [entry.condition_id ?? entry.condition, entry.contradicting_evidence]));
    const missingEvidence = Object.fromEntries(input.entries.map((entry) => [entry.condition_id ?? entry.condition, entry.missing_evidence ?? []]));
    const top = input.entries[0];
    const explainability = [
        `Species was resolved to ${speciesValidation.canonical_species}; incompatible disease spaces were excluded before scoring.`,
        pathwayAnalysis[0]
            ? `${pathwayAnalysis[0].system} is the dominant pathway because of ${pathwayAnalysis[0].contributing_findings.map((finding) => finding.finding).slice(0, 3).join(', ') || 'available clinical evidence'}.`
            : 'No dominant pathway was identified from the supplied signals.',
        top ? `${top.condition} leads with evidence density ${evidenceDensity(top)} and probability interval ${top.probability_interval?.low}-${top.probability_interval?.high}.` : 'No primary differential was generated.',
        ...input.uncertaintyNotes,
    ];

    return {
        species_validation: speciesValidation,
        pathway_analysis: pathwayAnalysis,
        mechanism_analysis: mechanismAnalysis,
        differential_diagnosis: input.entries,
        evidence_for: evidenceFor,
        evidence_against: evidenceAgainst,
        missing_evidence: missingEvidence,
        contradiction_audit: input.contradictionAnalysis,
        confidence_calibration: confidenceCalibration,
        information_gain_engine: informationGain,
        recommended_tests: recommendedTests,
        outcome_learning_hooks: [
            'Persist prediction lineage in ai_inference_events.',
            'Attach confirmed diagnosis and treatment response through /api/outcome.',
            'Update tenant label calibration and clinical case memory after outcome validation.',
        ],
        explainability_report: explainability,
        causal_memory_update: {
            event: 'awaiting_outcome_validation',
            learning_key: top?.condition_id ?? top?.condition ?? 'undetermined',
            update_policy: 'strengthen supported mechanisms and weaken contradicted mechanisms once outcome ground truth is submitted',
        },
        reliability_breakdown: reliabilityBreakdown,
    };
}

function applyClinicalIntelligence(
    base: Omit<
        ClinicalInferenceEngineResult,
        'species_validation' | 'pathway_analysis' | 'mechanism_analysis' | 'clinical_intelligence' | 'confidence_calibration' | 'reliability_breakdown' | 'information_gain_engine' | 'explainability_report' | 'causal_memory_update'
    >,
    request: InferenceRequest,
    signalProfile: ClinicalSignalProfile,
    routingSummary: RespiratoryRoutingSummary,
    contradictionAnalysis: ContradictionAnalysis,
): ClinicalInferenceEngineResult {
    const enrichedDifferentials = enrichDifferentials(base.differentials);
    const uncertaintyNotes = base.uncertainty_notes ?? [];
    const report = buildClinicalIntelligenceReport({
        request,
        entries: enrichedDifferentials,
        signalProfile,
        routingSummary,
        contradictionAnalysis,
        uncertaintyNotes,
    });

    return {
        ...base,
        differentials: enrichedDifferentials,
        diagnosis: {
            ...base.diagnosis,
            top_differentials: enrichedDifferentials,
        },
        species_validation: report.species_validation,
        pathway_analysis: report.pathway_analysis,
        mechanism_analysis: report.mechanism_analysis,
        clinical_intelligence: report,
        confidence_calibration: report.confidence_calibration,
        evidence_normalization: request.evidence_normalization ?? null,
        reliability_breakdown: report.reliability_breakdown,
        information_gain_engine: report.information_gain_engine,
        explainability_report: report.explainability_report,
        causal_memory_update: report.causal_memory_update,
    };
}

function buildStructuredSummary(
    entries: DifferentialEntry[],
    treatmentPlans: Record<string, SelectedTreatmentPlan>,
    contradictionAnalysis: ContradictionAnalysis,
    signalProfile: ClinicalSignalProfile,
    routingSummary: RespiratoryRoutingSummary,
): Pick<ClinicalInferenceEngineResult, 'top_diagnosis' | 'condition_class' | 'severity' | 'confidence' | 'contradiction_score' | 'cluster_scores' | 'species_gate' | 'airway_level'> {
    const top = entries[0];
    const topCondition = top?.condition_id ? getConditionById(top.condition_id) : undefined;
    return {
        top_diagnosis: top?.condition ?? null,
        condition_class: reportedConditionClass(topCondition),
        severity: resolveSeverity(entries, treatmentPlans),
        confidence: computeClinicalConfidence(
            top?.probability ?? 0,
            contradictionAnalysis.contradiction_score,
            topCondition,
            routingSummary,
        ),
        contradiction_score: contradictionAnalysis.contradiction_score,
        cluster_scores: buildOutputClusterScores(signalProfile, routingSummary),
        species_gate: routingSummary.speciesGate,
        airway_level: routingSummary.airwayLevel,
    };
}

export function runClinicalInferenceEngine(
    rawRequest: InferenceRequest | Record<string, unknown>,
): ClinicalInferenceEngineResult {
    const request = coerceInferenceRequest(rawRequest);
    const signalProfile = buildClinicalSignalProfile(
        request.symptom_vector,
        request.history?.owner_observations,
    );
    const routingSummary = buildRespiratoryRoutingSummary(request, signalProfile);
    const candidates = getConditionsForSpecies(routingSummary.species);
    const regionalScores = applyRegionalExposurePriors(candidates, request);
    const breedAdjustedScores = applyBreedSpecificPriors(candidates, regionalScores, request);
    const states = new Map<string, CandidateState>(
        candidates.map((candidate) => [candidate.id, buildInitialState(candidate, breedAdjustedScores.get(candidate.id) ?? 0.01)]),
    );

    const pathognomicResult = evaluatePathognomicTests(candidates, request);
    if (pathognomicResult.pathognomicConditionFound && pathognomicResult.primaryCondition) {
        const rawDifferentials = buildPathognomonicDifferentials(pathognomicResult);
        const confirmed = applyGroundTruthConfirmation(rawDifferentials, request).slice(0, 8);
        const treatmentPlans = buildTreatmentPlans(confirmed, request);
        const explanation = buildInferenceExplanation(
            request,
            confirmed,
            pathognomicResult.excludedConditions,
            'pathognomonic_test',
            pathognomicResult.keyFinding,
        );
        const contradictionAnalysis = analyzeContradictions(request, confirmed, signalProfile, routingSummary);
        const abstainDecision = shouldAbstain(confirmed, request, contradictionAnalysis);
        const outputFeatureImportance = featureImportance(confirmed, signalProfile);
        const uncertaintyNotes = [
            ...pathognomicResult.anomalyNotes,
            ...buildSignalUncertaintyNotes(signalProfile),
        ];
        appendFelineAirwayNotes(uncertaintyNotes, routingSummary);
        if (abstainDecision.message) {
            uncertaintyNotes.push(abstainDecision.message);
        }
        const baseResult = {
            differentials: confirmed,
            inference_explanation: explanation,
            diagnosis: buildDiagnosisSummary(confirmed),
            treatment_plans: treatmentPlans,
            ground_truth_summary: buildGroundTruthSummary(confirmed),
            contradiction_analysis: contradictionAnalysis,
            abstain_recommendation: abstainDecision.abstain,
            abstain_reason: abstainDecision.reason,
            competitive_differential: abstainDecision.competitive_differential,
            urgent_confirmatory_testing: abstainDecision.confirmatory_testing_urgent,
            ...buildStructuredSummary(confirmed, treatmentPlans, contradictionAnalysis, signalProfile, routingSummary),
            feature_importance: outputFeatureImportance,
            diagnosis_feature_importance: outputFeatureImportance,
            differential_spread: computeDifferentialSpread(confirmed),
            uncertainty_notes: uncertaintyNotes,
        };
        return applyClinicalIntelligence(baseResult, request, signalProfile, routingSummary, contradictionAnalysis);
    }

    applyAdjustments(states, applySyndromePatterns(request));
    applyAdjustments(states, applyHaematologicalPriors(request));
    applyAdjustments(states, applyBiochemistryPriors(request));
    applyAdjustments(states, applyImagingPriors(request));
    scoreSymptoms(states, signalProfile, routingSummary);
    applyFelineRespiratoryRouting(states, request, signalProfile, routingSummary);


    // ── Anatomical Localization (Layer 1) + Syndrome Routing (Layer 4) ────────
    // Collect all signals from presenting signs, history, and diagnostic tests
    const allSignals: string[] = [
        ...(request.presenting_signs ?? []),
        ...(request.symptom_vector ?? []),
        ...((request.history as { owner_observations?: string[] })?.owner_observations ?? []),
    ];

    // Inject diagnostic test results as named signals for localization
    const dt = (request.diagnostic_tests ?? {}) as Record<string, Record<string, string>>;
    if (dt.serology?.clostridium_enterotoxin_elisa === 'positive') allSignals.push('clostridium_enterotoxin_elisa_positive');
    if (dt.serology?.parvovirus_antigen === 'positive') allSignals.push('parvovirus_antigen_positive');
    if (dt.cytology?.fecal_gram_positive_rods === 'present') allSignals.push('fecal_gram_positive_rods');
    if (dt.serology?.spec_cpl === 'elevated') allSignals.push('spec_cpl_elevated');
    if (dt.cytology?.abdominocentesis === 'septic_exudate') allSignals.push('abdominocentesis_septic_exudate');
    if (dt.ultrasound?.whirlpool_sign === 'present') allSignals.push('whirlpool_sign');

    const historyStr = String((request.history as { dietary_history?: string })?.dietary_history ?? '');
    if (historyStr.toLowerCase().includes('spoiled') || historyStr.toLowerCase().includes('meat')) {
        allSignals.push('spoiled_meat_ingestion');
    }

    const localization = computeAnatomicalLocalization(allSignals);
    const syndrome = routeSyndrome(allSignals);

    // Apply combined multiplier: localization (60%) + syndrome (40%)
    for (const [conditionId, state] of states.entries()) {
        const locMult = getLocalizationMultiplier(conditionId, localization);
        const synMult = getSyndromeMultiplier(conditionId, syndrome);
        const combinedMult = (locMult * 0.60) + (synMult * 0.40);
        state.score = Math.max(0, Number((state.score * combinedMult).toFixed(3)));
    }
    // ──────────────────────────────────────────────────────────────────────────

    let differentials = buildDifferentials(states);
    const plausibility = applyEtiologicalPlausibilityGate(differentials, request);
    differentials = normalise(plausibility.differentials).slice(0, 8);
    differentials = applyGroundTruthConfirmation(differentials, request).slice(0, 8);

    const treatmentPlans = buildTreatmentPlans(differentials, request);
    const top = differentials[0];
    const explanation = buildInferenceExplanation(
        request,
        differentials,
        plausibility.excluded_conditions,
        top?.determination_basis ?? 'symptom_scoring',
        top?.supporting_evidence[0]?.finding ?? 'No single confirmatory finding available',
    );

    const uncertaintyNotes: string[] = buildSignalUncertaintyNotes(signalProfile);
    appendFelineAirwayNotes(uncertaintyNotes, routingSummary);
    if ((top?.probability ?? 0) < 0.55) {
        uncertaintyNotes.push('No pathognomonic finding was present, so probabilities remain provisional until confirmatory testing is completed.');
    }
    if (request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen == null && differentials.some((entry) => entry.condition_id === 'dirofilariosis_canine')) {
        uncertaintyNotes.push('Heartworm disease remains plausible; confirm with Dirofilaria immitis antigen testing.');
    }
    const contradictionAnalysis = analyzeContradictions(request, differentials, signalProfile, routingSummary);
    const abstainDecision = shouldAbstain(differentials, request, contradictionAnalysis);
    if (abstainDecision.message) {
        uncertaintyNotes.push(abstainDecision.message);
    }
    const outputFeatureImportance = featureImportance(differentials, signalProfile);

    const baseResult = {
        differentials,
        inference_explanation: explanation,
        diagnosis: buildDiagnosisSummary(differentials),
        treatment_plans: treatmentPlans,
        ground_truth_summary: buildGroundTruthSummary(differentials),
        contradiction_analysis: contradictionAnalysis,
        abstain_recommendation: abstainDecision.abstain,
        abstain_reason: abstainDecision.reason,
        competitive_differential: abstainDecision.competitive_differential,
        urgent_confirmatory_testing: abstainDecision.confirmatory_testing_urgent,
        ...buildStructuredSummary(differentials, treatmentPlans, contradictionAnalysis, signalProfile, routingSummary),
        feature_importance: outputFeatureImportance,
        diagnosis_feature_importance: outputFeatureImportance,
        differential_spread: computeDifferentialSpread(differentials),
        uncertainty_notes: uncertaintyNotes,
    };
    return applyClinicalIntelligence(baseResult, request, signalProfile, routingSummary, contradictionAnalysis);
}
