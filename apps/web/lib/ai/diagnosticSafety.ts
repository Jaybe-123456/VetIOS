import {
    FEATURE_TIER_MULTIPLIER,
    extractClinicalSignals,
    getFeatureLabel,
    type ClinicalSignals,
    type SignalKey,
} from '@/lib/ai/clinicalSignals';
import { evaluateEmergencyRules, type EmergencyRuleResult } from '@/lib/ai/emergencyRules';
import type { ContradictionResult } from '@/lib/ai/contradictionEngine';

type ConditionClass =
    | 'Mechanical'
    | 'Infectious'
    | 'Toxic'
    | 'Neoplastic'
    | 'Autoimmune / Immune-Mediated'
    | 'Metabolic / Endocrine'
    | 'Traumatic'
    | 'Degenerative'
    | 'Idiopathic / Unknown';

export interface DifferentialDriver {
    feature: string;
    weight: number;
}

export interface DifferentialEntry {
    name: string;
    probability: number;
    key_drivers?: DifferentialDriver[];
}

export interface DifferentialSpread {
    top_1_probability: number | null;
    top_2_probability: number | null;
    top_3_probability: number | null;
    spread: number | null;
}

export interface SafetyLayerResult {
    diagnosis: Record<string, unknown>;
    diagnosis_feature_importance: Record<string, number>;
    uncertainty_notes: string[];
    confidence_cap: number;
    was_capped: boolean;
    abstain_recommendation: boolean;
    abstain_reason?: string;
    rule_overrides: string[];
    differential_spread: DifferentialSpread | null;
    telemetry: Record<string, unknown>;
}

interface CandidateDefinition {
    name: string;
    aliases: string[];
    conditionClass: ConditionClass;
    features: Partial<Record<SignalKey, number>>;
    penalties?: Partial<Record<SignalKey, number>>;
}

interface CandidateScore {
    name: string;
    conditionClass: ConditionClass;
    rawScore: number;
    probability: number;
    drivers: DifferentialDriver[];
}

const CONDITION_CLASSES: ConditionClass[] = [
    'Mechanical',
    'Infectious',
    'Toxic',
    'Neoplastic',
    'Autoimmune / Immune-Mediated',
    'Metabolic / Endocrine',
    'Traumatic',
    'Degenerative',
    'Idiopathic / Unknown',
];

const CANDIDATES: CandidateDefinition[] = [
    {
        name: 'Gastric Dilatation-Volvulus (GDV)',
        aliases: ['gdv', 'gastric dilatation-volvulus', 'gastric dilatation volvulus'],
        conditionClass: 'Mechanical',
        features: {
            unproductive_retching: 0.42,
            abdominal_distension: 0.4,
            collapse: 0.2,
            dyspnea: 0.12,
            tachycardia: 0.12,
            pale_mucous_membranes: 0.14,
            hypersalivation: 0.08,
        },
        penalties: {
            diarrhea: 0.03,
            fever: 0.05,
            productive_vomiting: 0.05,
        },
    },
    {
        name: 'Acute Mechanical Emergency',
        aliases: ['acute mechanical gastrointestinal emergency', 'acute abdominal emergency'],
        conditionClass: 'Mechanical',
        features: {
            unproductive_retching: 0.2,
            abdominal_distension: 0.22,
            collapse: 0.2,
            dyspnea: 0.16,
            tachycardia: 0.15,
            pale_mucous_membranes: 0.16,
            weakness: 0.08,
        },
    },
    {
        name: 'Simple Gastric Dilatation',
        aliases: ['gastric dilatation', 'simple bloat'],
        conditionClass: 'Mechanical',
        features: {
            abdominal_distension: 0.26,
            unproductive_retching: 0.18,
            hypersalivation: 0.08,
            tachycardia: 0.08,
        },
        penalties: {
            collapse: 0.04,
        },
    },
    {
        name: 'Mesenteric Volvulus',
        aliases: ['mesenteric torsion'],
        conditionClass: 'Mechanical',
        features: {
            abdominal_distension: 0.18,
            collapse: 0.18,
            dyspnea: 0.1,
            tachycardia: 0.14,
            pale_mucous_membranes: 0.14,
            weakness: 0.1,
            fever: 0.03,
        },
    },
    {
        name: 'Foreign Body Obstruction',
        aliases: ['intestinal obstruction', 'bowel obstruction', 'foreign body'],
        conditionClass: 'Mechanical',
        features: {
            productive_vomiting: 0.18,
            unproductive_retching: 0.08,
            abdominal_distension: 0.12,
            weakness: 0.08,
            hypersalivation: 0.08,
            anorexia: 0.08,
        },
    },
    {
        name: 'Acute Gastroenteritis',
        aliases: ['gastroenteritis'],
        conditionClass: 'Infectious',
        features: {
            diarrhea: 0.22,
            productive_vomiting: 0.18,
            fever: 0.14,
            lethargy: 0.08,
            anorexia: 0.08,
            weakness: 0.05,
        },
        penalties: {
            unproductive_retching: 0.14,
            abdominal_distension: 0.14,
            collapse: 0.1,
            pale_mucous_membranes: 0.08,
        },
    },
    {
        name: 'Pancreatitis',
        aliases: ['acute pancreatitis'],
        conditionClass: 'Idiopathic / Unknown',
        features: {
            productive_vomiting: 0.2,
            fever: 0.1,
            anorexia: 0.1,
            weakness: 0.08,
        },
        penalties: {
            unproductive_retching: 0.1,
            abdominal_distension: 0.1,
            collapse: 0.06,
        },
    },
    {
        name: 'Toxic Ingestion',
        aliases: ['poisoning', 'toxin exposure'],
        conditionClass: 'Toxic',
        features: {
            hypersalivation: 0.18,
            productive_vomiting: 0.12,
            collapse: 0.1,
            tachycardia: 0.1,
            weakness: 0.08,
            seizures: 0.12,
        },
    },
    {
        name: 'Sepsis / Septic Shock',
        aliases: ['sepsis', 'septic shock'],
        conditionClass: 'Infectious',
        features: {
            fever: 0.16,
            collapse: 0.14,
            tachycardia: 0.12,
            dyspnea: 0.1,
            pale_mucous_membranes: 0.1,
            weakness: 0.1,
        },
    },
    {
        name: 'Canine Distemper',
        aliases: ['distemper', 'canine distemper virus'],
        conditionClass: 'Infectious',
        features: {
            myoclonus: 0.36,
            seizures: 0.18,
            nasal_discharge: 0.16,
            pneumonia: 0.16,
            fever: 0.12,
        },
    },
    {
        name: 'Bacterial Pneumonia',
        aliases: ['pneumonia'],
        conditionClass: 'Infectious',
        features: {
            pneumonia: 0.22,
            dyspnea: 0.18,
            fever: 0.14,
            nasal_discharge: 0.1,
            weakness: 0.06,
        },
    },
    {
        name: 'Canine Parvovirus',
        aliases: ['parvovirus', 'parvo'],
        conditionClass: 'Infectious',
        features: {
            productive_vomiting: 0.14,
            diarrhea: 0.2,
            fever: 0.14,
            weakness: 0.1,
            anorexia: 0.08,
        },
    },
    {
        name: 'Unknown Mixed Presentation',
        aliases: ['unknown'],
        conditionClass: 'Idiopathic / Unknown',
        features: {
            weakness: 0.06,
            lethargy: 0.06,
            diarrhea: 0.05,
            productive_vomiting: 0.05,
        },
    },
];

const CANONICAL_NAME_ALIASES = new Map<string, string>(
    CANDIDATES.flatMap((candidate) => [
        [candidate.name.toLowerCase(), candidate.name],
        ...candidate.aliases.map((alias) => [alias.toLowerCase(), candidate.name] as const),
    ]),
);

export function applyDiagnosticSafetyLayer(params: {
    inputSignature: Record<string, unknown>;
    diagnosis: Record<string, unknown>;
    contradiction: ContradictionResult | null;
    emergencyEval: EmergencyRuleResult;
    modelVersion: string;
    existingDiagnosisFeatureImportance?: Record<string, unknown> | null;
    existingUncertaintyNotes?: unknown;
    inferenceId?: string;
    simulationId?: string;
}): SafetyLayerResult {
    const signals = extractClinicalSignals(params.inputSignature);
    const contradictionScore = params.contradiction?.contradiction_score ?? 0;
    const heuristicScores = scoreCandidates(signals);
    const existingDifferentials = normalizeExistingDifferentials(params.diagnosis.top_differentials);
    const mergedDifferentials = mergeDifferentials({
        contradictionScore,
        heuristicScores,
        existingDifferentials,
        emergencyEval: params.emergencyEval,
        signals,
    });
    const differentialSpread = computeDifferentialSpread(mergedDifferentials);
    const conditionClassProbabilities = buildConditionClassProbabilities(mergedDifferentials);
    const primaryClassMass = Math.max(...Object.values(conditionClassProbabilities));
    const preservedEmergency = params.emergencyEval.emergency_rule_reasons.some((reason) => reason.toLowerCase().includes('persistence'));
    const syndromeStable = (preservedEmergency && primaryClassMass >= 0.72) || primaryClassMass >= 0.82;

    const providedConfidence = typeof params.diagnosis.confidence_score === 'number'
        ? params.diagnosis.confidence_score
        : null;
    const leadingProbability = mergedDifferentials[0]?.probability ?? 0.3;
    const margin = differentialSpread?.spread ?? 0;
    const derivedConfidence = 0.36 + (leadingProbability * 0.45) + Math.min(0.12, margin * 0.5) + (syndromeStable ? 0.16 : 0);
    const baseConfidence = clamp(
        providedConfidence != null ? Math.max(providedConfidence, derivedConfidence) : derivedConfidence,
        0.18,
        0.88,
    );
    const preCapConfidence = clamp(baseConfidence - (contradictionScore * 0.22), 0.12, 0.88);
    const confidenceCap = params.contradiction?.confidence_cap ?? 1;
    const postCapConfidence = Math.min(preCapConfidence, confidenceCap);
    const wasCapped = postCapConfidence < preCapConfidence - 0.0001;

    const isUnstable =
        !syndromeStable && (
            mergedDifferentials.length < 3 ||
            leadingProbability < 0.5 ||
            (differentialSpread?.spread ?? 0) < 0.12
        );
    const abstainRecommendation =
        Boolean(params.contradiction?.abstain) ||
        (contradictionScore >= 0.4 && isUnstable) ||
        (!syndromeStable && isUnstable && (postCapConfidence <= 0.45 || leadingProbability <= 0.34));
    const abstainReason = !abstainRecommendation
        ? undefined
        : contradictionScore >= 0.4
            ? 'Contradictory clinical context exceeds safe diagnosis-confidence threshold while emergency severity remains high'
            : 'Differential remains too broad for a safe high-confidence diagnosis; clinician review is recommended';

    const diagnosisFeatureImportance = buildDiagnosisFeatureImportance(signals, heuristicScores);
    const uncertaintyNotes = buildUncertaintyNotes({
        contradiction: params.contradiction,
        contradictionScore,
        emergencyEval: params.emergencyEval,
        isUnstable,
        postCapConfidence,
        existingNotes: params.existingUncertaintyNotes,
        signals,
    });
    const primaryConditionClass = pickPrimaryConditionClass(mergedDifferentials, params.diagnosis.primary_condition_class);
    const diagnosisAnalysis = buildAnalysisText(params.diagnosis.analysis, mergedDifferentials, contradictionScore, params.emergencyEval);

    const diagnosis: Record<string, unknown> = {
        ...params.diagnosis,
        analysis: diagnosisAnalysis,
        primary_condition_class: primaryConditionClass,
        condition_class_probabilities: conditionClassProbabilities,
        top_differentials: mergedDifferentials,
        confidence_score: postCapConfidence,
    };

    return {
        diagnosis,
        diagnosis_feature_importance: diagnosisFeatureImportance,
        uncertainty_notes: uncertaintyNotes,
        confidence_cap: confidenceCap,
        was_capped: wasCapped,
        abstain_recommendation: abstainRecommendation,
        abstain_reason: abstainReason,
        rule_overrides: [...params.emergencyEval.emergency_rule_reasons],
        differential_spread: differentialSpread,
        telemetry: {
            model_version: params.modelVersion,
            inference_id: params.inferenceId ?? null,
            simulation_id: params.simulationId ?? null,
            pre_cap_confidence: Number(preCapConfidence.toFixed(3)),
            post_cap_confidence: Number(postCapConfidence.toFixed(3)),
            contradiction_triggers: params.contradiction?.contradiction_reasons ?? [],
            persistence_rule_triggers: params.emergencyEval.emergency_rule_reasons.filter((reason) => reason.toLowerCase().includes('persistence')),
            differential_widened: contradictionScore >= 0.4,
        },
    };
}

export function createHeuristicInferencePayload(params: {
    inputSignature: Record<string, unknown>;
    contradiction: ContradictionResult | null;
    modelVersion: string;
    fallbackReason: string;
}): Record<string, unknown> {
    const emergencyEval = evaluateEmergencyRules(params.inputSignature);
    const seedDiagnosis: Record<string, unknown> = {
        analysis: `Deterministic fallback reasoning activated: ${params.fallbackReason}`,
        primary_condition_class: 'Idiopathic / Unknown',
        condition_class_probabilities: {},
        top_differentials: [],
        confidence_score: 0.45,
    };

    const safetyLayer = applyDiagnosticSafetyLayer({
        inputSignature: params.inputSignature,
        diagnosis: seedDiagnosis,
        contradiction: params.contradiction,
        emergencyEval,
        modelVersion: params.modelVersion,
        existingUncertaintyNotes: [`Deterministic fallback reasoning activated: ${params.fallbackReason}`],
    });

    const signals = extractClinicalSignals(params.inputSignature);
    const baseSeverity = inferFallbackSeverity(signals);

    return {
        diagnosis: safetyLayer.diagnosis,
        risk_assessment: {
            severity_score: baseSeverity.score,
            emergency_level: baseSeverity.level,
        },
        diagnosis_feature_importance: safetyLayer.diagnosis_feature_importance,
        severity_feature_importance: buildSeverityFeatureImportance(signals),
        uncertainty_notes: safetyLayer.uncertainty_notes,
    };
}

export function buildSeverityFeatureImportance(signals: ClinicalSignals): Record<string, number> {
    const features: Record<string, number> = {};
    const keys: SignalKey[] = ['collapse', 'dyspnea', 'tachycardia', 'pale_mucous_membranes', 'seizures', 'abdominal_distension'];
    for (const key of keys) {
        const evidence = signals.evidence[key];
        if (evidence.present) {
            features[getFeatureLabel(key)] = Number((FEATURE_TIER_MULTIPLIER[evidence.tier] * evidence.strength).toFixed(2));
        }
    }
    return features;
}

function scoreCandidates(signals: ClinicalSignals): CandidateScore[] {
    return CANDIDATES.map((candidate) => {
        const drivers: DifferentialDriver[] = [];
        let rawScore = 0;

        for (const [signalKey, baseWeight] of Object.entries(candidate.features) as Array<[SignalKey, number]>) {
            const evidence = signals.evidence[signalKey];
            if (!evidence.present) continue;
            const weight = baseWeight * FEATURE_TIER_MULTIPLIER[evidence.tier] * evidence.strength;
            rawScore += weight;
            drivers.push({
                feature: getFeatureLabel(signalKey),
                weight: Number(weight.toFixed(2)),
            });
        }

        for (const [signalKey, penalty] of Object.entries(candidate.penalties ?? {}) as Array<[SignalKey, number]>) {
            if (signals.evidence[signalKey].present) {
                rawScore -= penalty;
            }
        }

        if (candidate.name === 'Gastric Dilatation-Volvulus (GDV)' && signals.has_deep_chested_breed_risk) {
            rawScore += 0.16;
            drivers.push({ feature: 'deep-chested breed risk', weight: 0.16 });
        }

        if (candidate.name === 'Canine Distemper' && signals.age_months != null && signals.age_months <= 12) {
            rawScore += 0.08;
            drivers.push({ feature: 'young dog age profile', weight: 0.08 });
        }

        return {
            name: candidate.name,
            conditionClass: candidate.conditionClass,
            rawScore: Math.max(0.01, Number(rawScore.toFixed(3))),
            probability: 0,
            drivers: drivers.sort((a, b) => b.weight - a.weight).slice(0, 4),
        };
    });
}

function mergeDifferentials(params: {
    contradictionScore: number;
    heuristicScores: CandidateScore[];
    existingDifferentials: DifferentialEntry[];
    emergencyEval: EmergencyRuleResult;
    signals: ClinicalSignals;
}): DifferentialEntry[] {
    const temperature = 0.78 + (params.contradictionScore * 1.1);
    const heuristicProbabilities = softmax(params.heuristicScores.map((candidate) => candidate.rawScore), temperature);
    const heuristicByName = new Map<string, CandidateScore>();

    params.heuristicScores.forEach((candidate, index) => {
        heuristicByName.set(candidate.name, {
            ...candidate,
            probability: heuristicProbabilities[index] ?? 0,
        });
    });

    const combined = new Map<string, DifferentialEntry>();
    const heuristicWeight = params.contradictionScore >= 0.4 ? 0.68 : 0.58;
    const modelWeight = 1 - heuristicWeight;

    for (const heuristic of heuristicByName.values()) {
        combined.set(heuristic.name, {
            name: heuristic.name,
            probability: heuristic.probability * heuristicWeight,
            key_drivers: heuristic.drivers,
        });
    }

    for (const differential of params.existingDifferentials) {
        const canonicalName = toCanonicalName(differential.name);
        const existing = combined.get(canonicalName);
        const mergedProbability = (differential.probability * modelWeight) + (existing?.probability ?? 0);
        combined.set(canonicalName, {
            name: canonicalName,
            probability: mergedProbability,
            key_drivers: existing?.key_drivers ?? differential.key_drivers,
        });
    }

    if (params.contradictionScore >= 0.4) {
        widenDifferentials(combined, 0.08 + (params.contradictionScore * 0.08));
    }

    applyPersistenceProtection(combined, params);
    normalizeProbabilities(combined);

    return [...combined.values()]
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 6)
        .map((entry) => ({
            ...entry,
            probability: Number(entry.probability.toFixed(3)),
        }));
}

function applyPersistenceProtection(
    combined: Map<string, DifferentialEntry>,
    params: {
        contradictionScore: number;
        emergencyEval: EmergencyRuleResult;
        signals: ClinicalSignals;
    },
): void {
    const persistenceTriggered = params.emergencyEval.emergency_rule_reasons.some((reason) => reason.toLowerCase().includes('persistence'));
    if (!persistenceTriggered) {
        return;
    }

    const floors = params.contradictionScore >= 0.7
        ? new Map<string, number>([
            ['Gastric Dilatation-Volvulus (GDV)', 0.24],
            ['Acute Mechanical Emergency', 0.21],
            ['Simple Gastric Dilatation', 0.16],
            ['Mesenteric Volvulus', 0.14],
            ['Foreign Body Obstruction', 0.12],
        ])
        : new Map<string, number>([
            ['Gastric Dilatation-Volvulus (GDV)', 0.34],
            ['Acute Mechanical Emergency', 0.26],
            ['Simple Gastric Dilatation', 0.18],
            ['Mesenteric Volvulus', 0.14],
            ['Foreign Body Obstruction', 0.13],
        ]);

    for (const [name, floor] of floors.entries()) {
        const existing = combined.get(name);
        combined.set(name, {
            name,
            probability: Math.max(existing?.probability ?? 0, floor),
            key_drivers: existing?.key_drivers,
        });
    }

    if (params.signals.has_small_breed_gdv_mismatch) {
        const gdv = combined.get('Gastric Dilatation-Volvulus (GDV)');
        if (gdv != null) {
            gdv.probability = Math.max(gdv.probability, params.contradictionScore >= 0.7 ? 0.24 : 0.28);
        }
    }
}

function buildDiagnosisFeatureImportance(
    signals: ClinicalSignals,
    heuristicScores: CandidateScore[],
): Record<string, number> {
    const importance: Record<string, number> = {};
    const leadingCandidates = heuristicScores
        .sort((left, right) => right.rawScore - left.rawScore)
        .slice(0, 3);

    for (const candidate of leadingCandidates) {
        for (const driver of candidate.drivers) {
            importance[driver.feature] = Math.max(importance[driver.feature] ?? 0, driver.weight);
        }
    }

    for (const [signalKey, evidence] of Object.entries(signals.evidence) as Array<[SignalKey, ClinicalSignals['evidence'][SignalKey]]>) {
        if (!evidence.present) continue;
        const label = getFeatureLabel(signalKey);
        importance[label] = Math.max(
            importance[label] ?? 0,
            Number((FEATURE_TIER_MULTIPLIER[evidence.tier] * evidence.strength).toFixed(2)),
        );
    }

    return importance;
}

function buildUncertaintyNotes(params: {
    contradiction: ContradictionResult | null;
    contradictionScore: number;
    emergencyEval: EmergencyRuleResult;
    isUnstable: boolean;
    postCapConfidence: number;
    existingNotes: unknown;
    signals: ClinicalSignals;
}): string[] {
    const notes = new Set<string>();

    if (Array.isArray(params.existingNotes)) {
        for (const note of params.existingNotes) {
            if (typeof note === 'string' && note.trim().length > 0) {
                notes.add(note);
            }
        }
    }

    if (params.contradictionScore > 0) {
        notes.add('Contradictions were treated as uncertainty penalties rather than as authoritative replacements for core symptom truth.');
    }
    if (params.contradictionScore >= 0.4) {
        notes.add('Differential was intentionally widened because the structured context is internally inconsistent.');
    }
    if (params.emergencyEval.emergency_rule_reasons.some((reason) => reason.toLowerCase().includes('persistence'))) {
        notes.add('High-risk abdominal emergency signatures were preserved in the differential despite contradictory metadata.');
    }
    if (params.signals.has_small_breed_gdv_mismatch) {
        notes.add('Breed/body-size metadata lowers the classic GDV prior but does not invalidate the emergency syndrome when the signal cluster is strong.');
    }
    if (params.isUnstable) {
        notes.add('Top differentials remain relatively close, so diagnosis certainty should stay conservative.');
    }
    if (params.postCapConfidence <= 0.45) {
        notes.add('Confidence was kept low to reflect unresolved contradiction burden.');
    }

    return [...notes];
}

function computeDifferentialSpread(differentials: DifferentialEntry[]): DifferentialSpread | null {
    if (differentials.length < 2) return null;
    const top1 = differentials[0]?.probability ?? null;
    const top2 = differentials[1]?.probability ?? null;
    const top3 = differentials[2]?.probability ?? null;
    return {
        top_1_probability: top1,
        top_2_probability: top2,
        top_3_probability: top3,
        spread: top1 != null && top2 != null ? Number((top1 - top2).toFixed(3)) : null,
    };
}

function buildConditionClassProbabilities(differentials: DifferentialEntry[]): Record<ConditionClass, number> {
    const totals = new Map<ConditionClass, number>(CONDITION_CLASSES.map((conditionClass) => [conditionClass, 0]));

    for (const differential of differentials) {
        const definition = CANDIDATES.find((candidate) => candidate.name === differential.name);
        const conditionClass = definition?.conditionClass ?? 'Idiopathic / Unknown';
        totals.set(conditionClass, (totals.get(conditionClass) ?? 0) + differential.probability);
    }

    const totalProbability = [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;
    const result = {} as Record<ConditionClass, number>;
    for (const conditionClass of CONDITION_CLASSES) {
        result[conditionClass] = Number(((totals.get(conditionClass) ?? 0) / totalProbability).toFixed(3));
    }
    return result;
}

function pickPrimaryConditionClass(differentials: DifferentialEntry[], fallback: unknown): ConditionClass {
    const classProbabilities = buildConditionClassProbabilities(differentials);
    const sorted = Object.entries(classProbabilities)
        .sort((left, right) => right[1] - left[1]) as Array<[ConditionClass, number]>;
    return sorted[0]?.[0] ?? (typeof fallback === 'string' ? (fallback as ConditionClass) : 'Idiopathic / Unknown');
}

function buildAnalysisText(
    existingAnalysis: unknown,
    differentials: DifferentialEntry[],
    contradictionScore: number,
    emergencyEval: EmergencyRuleResult,
): string {
    const topNames = differentials.slice(0, 3).map((differential) => differential.name).join(', ');
    const preservedEmergency = emergencyEval.emergency_rule_reasons.some((reason) => reason.toLowerCase().includes('persistence'));
    const summary = `Deterministic safety layer preserved the leading syndrome pattern and re-ranked the differential as: ${topNames}.`;

    if (typeof existingAnalysis !== 'string' || existingAnalysis.trim().length === 0) {
        return preservedEmergency && contradictionScore > 0
            ? `${summary} Contradictory metadata lowered certainty but did not erase the high-risk emergency pattern.`
            : summary;
    }

    const suffix = preservedEmergency
        ? ' High-risk emergency persistence logic remained active during final ranking.'
        : '';
    return `${existingAnalysis.trim()} ${summary}${suffix}`.trim();
}

function inferFallbackSeverity(signals: ClinicalSignals): { score: number; level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' } {
    if (signals.gdv_cluster_count >= 3 || signals.shock_pattern_strength >= 2.5) {
        return { score: 0.95, level: 'CRITICAL' };
    }
    if (signals.evidence.seizures.present || signals.evidence.dyspnea.present || signals.distemper_pattern_strength >= 2) {
        return { score: 0.78, level: 'HIGH' };
    }
    if (signals.evidence.fever.present || signals.evidence.productive_vomiting.present || signals.evidence.diarrhea.present) {
        return { score: 0.52, level: 'MODERATE' };
    }
    return { score: 0.3, level: 'LOW' };
}

function normalizeExistingDifferentials(raw: unknown): DifferentialEntry[] {
    if (!Array.isArray(raw)) return [];

    const mapped: Array<DifferentialEntry | null> = raw
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const candidate = entry as Record<string, unknown>;
            const name = typeof candidate.name === 'string'
                ? candidate.name
                : typeof candidate.condition === 'string'
                    ? candidate.condition
                    : null;
            if (!name) return null;
            const probability = typeof candidate.probability === 'number' ? candidate.probability : 0.1;
            return {
                name: toCanonicalName(name),
                probability,
                key_drivers: Array.isArray(candidate.key_drivers)
                    ? (candidate.key_drivers as DifferentialDriver[])
                    : undefined,
            };
        });

    return mapped.filter((entry): entry is DifferentialEntry => entry !== null);
}

function toCanonicalName(name: string): string {
    const normalized = name.trim().toLowerCase();
    return CANONICAL_NAME_ALIASES.get(normalized) ?? name.trim();
}

function softmax(values: number[], temperature: number): number[] {
    const max = Math.max(...values);
    const exps = values.map((value) => Math.exp((value - max) / temperature));
    const total = exps.reduce((sum, value) => sum + value, 0) || 1;
    return exps.map((value) => value / total);
}

function widenDifferentials(combined: Map<string, DifferentialEntry>, factor: number): void {
    const size = combined.size || 1;
    const uniformProbability = 1 / size;

    for (const entry of combined.values()) {
        entry.probability = (entry.probability * (1 - factor)) + (uniformProbability * factor);
    }
}

function normalizeProbabilities(combined: Map<string, DifferentialEntry>): void {
    const total = [...combined.values()].reduce((sum, entry) => sum + Math.max(0, entry.probability), 0) || 1;
    for (const entry of combined.values()) {
        entry.probability = Math.max(0, entry.probability) / total;
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
