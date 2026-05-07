import {
    getConditionById,
    getConditionsForSpecies,
    normalizeSpecies,
} from '../inference/condition-registry';
import { applyBreedSpecificPriors } from '../inference/breed-priors';
import { runClinicalInferenceEngine } from '../inference/engine';
import { applyRegionalExposurePriors } from '../inference/regional-priors';
import type {
    DifferentialEntry,
    InferenceRequest,
    VeterinaryCondition,
} from '../inference/types';
import {
    SPECIES_PANEL_MAP,
    type EncounterPayloadV2,
    type Species as EncounterSpecies,
    type SystemPanel,
} from '@vetios/inference-schema';
import type {
    AdversarialStabilityReport,
    AdversarialStep,
    AdversarialSweepConfig,
    EvidenceThreshold,
    MultisystemicAdversarialScenario,
} from './types';

interface FindingSimulation {
    finding: string;
    finding_type: string;
    path: string;
    value: unknown;
}

const DEFAULT_NOISE_LEVELS = [0.1, 0.3, 0.5, 0.7, 1.0];
const DEFAULT_CONTRADICTION_LEVELS = [0.1, 0.3, 0.5, 0.7, 1.0];
const NOISE_SIGN_POOL = [
    'honking_cough',
    'productive_cough',
    'fever',
    'polyuria',
    'polydipsia',
    'vomiting',
    'diarrhea',
    'weight_gain',
    'syncope',
];

const TARGET_FINDING_LIBRARY: Record<string, FindingSimulation[]> = {
    dirofilariosis_canine: [
        {
            finding: 'dirofilaria_antigen=positive',
            finding_type: 'pathognomonic_test',
            path: 'diagnostic_tests.serology.dirofilaria_immitis_antigen',
            value: 'positive',
        },
        {
            finding: 'echocardiography_worms_visualised=present',
            finding_type: 'imaging',
            path: 'diagnostic_tests.echocardiography.worms_visualised',
            value: 'present',
        },
        {
            finding: 'pulmonary_artery_enlargement=present',
            finding_type: 'imaging',
            path: 'diagnostic_tests.thoracic_radiograph.pulmonary_artery_enlargement',
            value: 'present',
        },
        {
            finding: 'heart_murmur=grade_3_or_above',
            finding_type: 'clinical_exam',
            path: 'physical_exam.auscultation.heart_murmur',
            value: 'grade_3',
        },
    ],
    mitral_valve_disease_canine: [
        {
            finding: 'heart_murmur=grade_3_or_above',
            finding_type: 'clinical_exam',
            path: 'physical_exam.auscultation.heart_murmur',
            value: 'grade_3',
        },
        {
            finding: 'left_heart_enlargement=present',
            finding_type: 'imaging',
            path: 'diagnostic_tests.echocardiography.left_heart_enlargement',
            value: 'present',
        },
    ],
    tracheal_collapse: [
        {
            finding: 'tracheal_collapse_seen=present',
            finding_type: 'imaging',
            path: 'diagnostic_tests.thoracic_radiograph.tracheal_collapse_seen',
            value: 'present',
        },
        {
            finding: 'honking_cough=present',
            finding_type: 'symptom',
            path: 'presenting_signs',
            value: 'honking_cough',
        },
    ],
};

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function cloneRequest<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isEncounterPayloadV2(value: unknown): value is EncounterPayloadV2 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        record.patient != null
        && typeof record.patient === 'object'
        && record.encounter != null
        && typeof record.encounter === 'object'
        && Array.isArray(record.active_system_panels)
        && record.metadata != null
        && typeof record.metadata === 'object'
    );
}

function panelValueIsPopulated(value: unknown): boolean {
    if (value === 'not_done') return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    return value != null;
}

function mergePanelTests(target: Record<string, unknown>, key: string, tests: Record<string, unknown>) {
    const existing = target[key];
    target[key] = {
        ...(typeof existing === 'object' && existing != null && !Array.isArray(existing) ? existing as Record<string, unknown> : {}),
        ...tests,
    };
}

function diagnosticBucketForPanel(panel: SystemPanel): string {
    if (panel.panel === 'CBC') return 'cbc';
    if (panel.panel === 'thoracic_radiograph') return 'thoracic_radiograph';
    if (panel.panel === 'abdominal_ultrasound') return 'abdominal_ultrasound';
    if (panel.system === 'urinalysis') return 'urinalysis';
    if (panel.system === 'serology') return 'serology';
    if (panel.system === 'biochemistry' || panel.system === 'endocrine') return 'biochemistry';
    if (panel.system === 'cytology') return 'cytology';
    return panel.system;
}

function panelsToDiagnosticTests(panels: SystemPanel[]): Record<string, unknown> {
    const diagnosticTests: Record<string, unknown> = {};
    for (const panel of panels) {
        const activeTests = Object.fromEntries(
            Object.entries(panel.tests).filter(([, value]) => panelValueIsPopulated(value)),
        );
        if (Object.keys(activeTests).length === 0) continue;

        mergePanelTests(diagnosticTests, diagnosticBucketForPanel(panel), activeTests);
        diagnosticTests[`${panel.system}_${panel.panel}`] = activeTests;
    }
    return diagnosticTests;
}

function coerceEncounterPayloadV2(payload: EncounterPayloadV2): InferenceRequest {
    const mmColour = payload.encounter.vitals.mm_colour;
    const mucousMembraneColor = mmColour === 'yellow'
        ? 'icteric'
        : mmColour === 'brick_red' || mmColour === 'muddy'
            ? 'injected'
            : mmColour === 'white'
                ? 'pale'
                : mmColour ?? undefined;

    return {
        species: payload.patient.species,
        breed: payload.patient.breed || undefined,
        age_years: payload.patient.age_years ?? undefined,
        weight_kg: payload.patient.weight_kg ?? undefined,
        sex: payload.patient.sex,
        presenting_signs: payload.encounter.presenting_complaints.map(normalizeKey),
        history: {
            ...(payload.encounter.history.duration_days != null ? { duration_days: payload.encounter.history.duration_days } : {}),
            owner_observations: payload.encounter.history.free_text ? [payload.encounter.history.free_text] : [],
        },
        diagnostic_tests: panelsToDiagnosticTests(payload.active_system_panels) as InferenceRequest['diagnostic_tests'],
        physical_exam: {
            ...(payload.encounter.vitals.temp_c != null ? { temperature: payload.encounter.vitals.temp_c } : {}),
            ...(payload.encounter.vitals.heart_rate_bpm != null ? { heart_rate: payload.encounter.vitals.heart_rate_bpm } : {}),
            ...(payload.encounter.vitals.respiratory_rate_bpm != null ? { respiratory_rate: payload.encounter.vitals.respiratory_rate_bpm } : {}),
            ...(mucousMembraneColor ? { mucous_membrane_color: mucousMembraneColor } : {}),
            ...(payload.encounter.vitals.crt_seconds != null ? { capillary_refill_time_s: payload.encounter.vitals.crt_seconds } : {}),
        } as InferenceRequest['physical_exam'],
    };
}

function coerceInferenceRequest(rawRequest: InferenceRequest | EncounterPayloadV2 | Record<string, unknown>): InferenceRequest {
    if (isEncounterPayloadV2(rawRequest)) {
        return coerceEncounterPayloadV2(rawRequest);
    }

    const candidate = rawRequest as Record<string, unknown>;
    const metadata = candidate.metadata && typeof candidate.metadata === 'object'
        ? candidate.metadata as Record<string, unknown>
        : {};
    const presenting = Array.isArray(candidate.presenting_signs)
        ? candidate.presenting_signs
        : Array.isArray(candidate.symptoms)
            ? candidate.symptoms
            : Array.isArray(metadata.presenting_signs)
                ? metadata.presenting_signs
                : Array.isArray(metadata.symptoms)
                    ? metadata.symptoms
                    : [];

    return {
        species: typeof candidate.species === 'string' ? candidate.species : typeof metadata.species === 'string' ? metadata.species : 'canine',
        breed: typeof candidate.breed === 'string' ? candidate.breed : typeof metadata.breed === 'string' ? metadata.breed : undefined,
        age_years: typeof candidate.age_years === 'number' ? candidate.age_years : undefined,
        weight_kg: typeof candidate.weight_kg === 'number' ? candidate.weight_kg : undefined,
        sex: typeof candidate.sex === 'string' ? candidate.sex : undefined,
        region: typeof candidate.region === 'string' ? candidate.region : typeof metadata.region === 'string' ? metadata.region : undefined,
        presenting_signs: presenting
            .filter((entry): entry is string => typeof entry === 'string')
            .map(normalizeKey),
        history: typeof candidate.history === 'object' && candidate.history != null
            ? candidate.history as InferenceRequest['history']
            : typeof metadata.history === 'object' && metadata.history != null
                ? metadata.history as InferenceRequest['history']
                : undefined,
        preventive_history: typeof candidate.preventive_history === 'object' && candidate.preventive_history != null
            ? candidate.preventive_history as InferenceRequest['preventive_history']
            : typeof metadata.preventive_history === 'object' && metadata.preventive_history != null
                ? metadata.preventive_history as InferenceRequest['preventive_history']
                : undefined,
        diagnostic_tests: typeof candidate.diagnostic_tests === 'object' && candidate.diagnostic_tests != null
            ? candidate.diagnostic_tests as InferenceRequest['diagnostic_tests']
            : typeof metadata.diagnostic_tests === 'object' && metadata.diagnostic_tests != null
                ? metadata.diagnostic_tests as InferenceRequest['diagnostic_tests']
                : undefined,
        physical_exam: typeof candidate.physical_exam === 'object' && candidate.physical_exam != null
            ? candidate.physical_exam as InferenceRequest['physical_exam']
            : typeof metadata.physical_exam === 'object' && metadata.physical_exam != null
                ? metadata.physical_exam as InferenceRequest['physical_exam']
                : undefined,
    };
}

function resolveCondition(conditionIdOrName: string, species: string): VeterinaryCondition | null {
    const normalizedTarget = normalizeKey(conditionIdOrName);
    const candidates = getConditionsForSpecies(normalizeSpecies(species));
    return candidates.find((condition) =>
        condition.id === normalizedTarget
        || normalizeKey(condition.canonical_name) === normalizedTarget
        || condition.aliases.some((alias) => normalizeKey(alias) === normalizedTarget),
    ) ?? getConditionById(normalizedTarget) ?? null;
}

function getRank(differentials: DifferentialEntry[], conditionId: string): number {
    return differentials.find((entry) => entry.condition_id === conditionId)?.rank ?? (differentials.length + 1);
}

function getProbability(differentials: DifferentialEntry[], conditionId: string): number {
    return differentials.find((entry) => entry.condition_id === conditionId)?.probability ?? 0;
}

function buildBaselineCandidatePool(request: InferenceRequest) {
    const candidates = getConditionsForSpecies(normalizeSpecies(request.species));
    const regionalScores = applyRegionalExposurePriors(candidates, request);
    const breedScores = applyBreedSpecificPriors(candidates, regionalScores, request);
    return {
        candidates,
        breedScores,
    };
}

function addUniqueSign(list: string[], sign: string) {
    if (!list.includes(sign)) {
        list.push(sign);
    }
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown) {
    const parts = path.split('.').filter(Boolean);
    let current: Record<string, unknown> = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const key = parts[index];
        const existing = current[key];
        if (typeof existing !== 'object' || existing == null || Array.isArray(existing)) {
            current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
}

function applyFinding(request: InferenceRequest, simulation: FindingSimulation): InferenceRequest {
    const next = cloneRequest(request);
    if (simulation.path === 'presenting_signs') {
        addUniqueSign(next.presenting_signs, String(simulation.value));
        return next;
    }

    setNestedValue(next as unknown as Record<string, unknown>, simulation.path, simulation.value);
    return next;
}

function deterministicScore(seed: string): number {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash % 1000) / 1000;
}

function buildPerturbedRequest(
    request: InferenceRequest,
    noiseLevel: number,
    contradictionLevel: number,
    targetConditionId: string,
): InferenceRequest {
    const next = cloneRequest(request);
    const retained = next.presenting_signs.filter((sign) => {
        const anchor = ['cough', 'dyspnea', 'exercise_intolerance'].includes(sign) ? 0.12 : 0;
        return deterministicScore(`${sign}:${noiseLevel}`) >= Math.max(0.05, (noiseLevel * 0.45) - anchor);
    });

    next.presenting_signs = retained.length > 0 ? retained : next.presenting_signs.slice(0, 1);

    const additions = Math.min(
        NOISE_SIGN_POOL.length,
        Math.max(0, Math.round(noiseLevel * 3) + (contradictionLevel >= 0.5 ? 1 : 0)),
    );
    for (let index = 0; index < additions; index += 1) {
        const candidate = NOISE_SIGN_POOL[index];
        addUniqueSign(next.presenting_signs, candidate);
    }

    if (targetConditionId === 'dirofilariosis_canine' && noiseLevel >= 0.35) {
        addUniqueSign(next.presenting_signs, 'honking_cough');
    }
    if (contradictionLevel >= 0.55) {
        addUniqueSign(next.presenting_signs, 'weight_gain');
        addUniqueSign(next.presenting_signs, 'polyuria');
    }

    return next;
}

function buildFindingSimulations(condition: VeterinaryCondition | null): FindingSimulation[] {
    if (!condition) return [];

    const qualifyPath = (path: string) => (
        path.startsWith('diagnostic_tests.')
        || path.startsWith('physical_exam.')
        || path.startsWith('preventive_history.')
        || path.startsWith('history.')
        || path === 'presenting_signs'
            ? path
            : `diagnostic_tests.${path}`
    );

    const registryFindings: FindingSimulation[] = [
        ...condition.pathognomonic_tests.map((test) => ({
            finding: `${normalizeKey(test.evidence_label ?? test.test)}=${normalizeKey(test.result)}`,
            finding_type: 'pathognomonic_test',
            path: qualifyPath(test.test),
            value: test.result,
        })),
        ...condition.supporting_tests.map((test) => ({
            finding: `${normalizeKey(test.evidence_label)}=${normalizeKey(test.result ?? 'present')}`,
            finding_type: 'supporting_test',
            path: qualifyPath(test.test),
            value: test.result ?? 'present',
        })),
        ...condition.imaging_patterns.map((pattern) => ({
            finding: `${normalizeKey(pattern.evidence_label)}=${normalizeKey(pattern.result)}`,
            finding_type: 'imaging',
            path: qualifyPath(pattern.finding),
            value: pattern.result,
        })),
        ...condition.haematological_patterns.map((pattern) => ({
            finding: `${normalizeKey(pattern.evidence_label)}=${normalizeKey(pattern.result)}`,
            finding_type: 'haematology',
            path: qualifyPath(pattern.finding),
            value: pattern.result,
        })),
    ];

    const custom = TARGET_FINDING_LIBRARY[condition.id] ?? [];
    const deduped = new Map<string, FindingSimulation>();
    for (const entry of [...registryFindings, ...custom]) {
        deduped.set(entry.finding, entry);
    }
    return [...deduped.values()];
}

function buildEvidenceThresholdMap(
    baselineRequest: InferenceRequest,
    baselineDifferential: DifferentialEntry[],
    targetCondition: VeterinaryCondition | null,
) {
    const baselineRank = targetCondition ? getRank(baselineDifferential, targetCondition.id) : baselineDifferential.length + 1;
    const baselineProbability = targetCondition ? getProbability(baselineDifferential, targetCondition.id) : 0;
    const findings = buildFindingSimulations(targetCondition);

    const thresholds: EvidenceThreshold[] = findings.map((simulation) => {
        const simulatedRequest = applyFinding(baselineRequest, simulation);
        const result = runClinicalInferenceEngine(simulatedRequest);
        const resultingProbability = targetCondition ? getProbability(result.differentials, targetCondition.id) : 0;
        const resultingRank = targetCondition ? getRank(result.differentials, targetCondition.id) : result.differentials.length + 1;
        return {
            finding: simulation.finding,
            finding_type: simulation.finding_type,
            probability_delta: Number((resultingProbability - baselineProbability).toFixed(4)),
            resulting_probability: Number(resultingProbability.toFixed(4)),
            resulting_rank: resultingRank,
            is_sufficient_alone: resultingRank === 1,
        };
    }).sort((left, right) => right.resulting_probability - left.resulting_probability);

    return {
        condition_id: targetCondition?.id ?? normalizeKey(baselineRequest.species),
        currently_at_rank: baselineRank,
        findings_to_reach_rank_1: thresholds,
        minimum_probability_achievable: thresholds.length > 0
            ? Math.min(...thresholds.map((entry) => entry.resulting_probability))
            : baselineProbability,
        maximum_probability_achievable: thresholds.length > 0
            ? Math.max(...thresholds.map((entry) => entry.resulting_probability))
            : baselineProbability,
    };
}

function calculateDivergence(
    baselineDifferential: DifferentialEntry[],
    currentDifferential: DifferentialEntry[],
): number {
    const ids = new Set<string>();
    for (const entry of baselineDifferential) {
        if (entry.condition_id) ids.add(entry.condition_id);
    }
    for (const entry of currentDifferential) {
        if (entry.condition_id) ids.add(entry.condition_id);
    }
    if (ids.size === 0) return 0;

    let total = 0;
    for (const conditionId of ids) {
        total += Math.abs(
            getProbability(baselineDifferential, conditionId)
            - getProbability(currentDifferential, conditionId),
        );
    }

    return Number((total / ids.size).toFixed(4));
}

function countRankInversions(
    baselineDifferential: DifferentialEntry[],
    currentDifferential: DifferentialEntry[],
): number {
    const ids = new Set<string>();
    for (const entry of baselineDifferential.slice(0, 8)) {
        if (entry.condition_id) ids.add(entry.condition_id);
    }
    for (const entry of currentDifferential.slice(0, 8)) {
        if (entry.condition_id) ids.add(entry.condition_id);
    }

    let inversions = 0;
    for (const conditionId of ids) {
        if (getRank(baselineDifferential, conditionId) !== getRank(currentDifferential, conditionId)) {
            inversions += 1;
        }
    }
    return inversions;
}

function detectCollapse(
    baselineDifferential: DifferentialEntry[],
    currentDifferential: DifferentialEntry[],
    targetConditionId: string,
): { collapseDetected: boolean; collapseType?: string } {
    const baselineTargetRank = getRank(baselineDifferential, targetConditionId);
    const currentTargetRank = getRank(currentDifferential, targetConditionId);
    const currentTargetProbability = getProbability(currentDifferential, targetConditionId);
    const topProbability = currentDifferential[0]?.probability ?? 0;
    const topConditionId = currentDifferential[0]?.condition_id ?? '';
    const topFive = currentDifferential.slice(0, 5).map((entry) => entry.probability);
    const diffuseConfusion = topFive.length >= 3
        && (Math.max(...topFive) - Math.min(...topFive)) < 0.05;

    if (currentTargetRank > baselineTargetRank + 3) {
        return { collapseDetected: true, collapseType: 'rank_inversion' };
    }
    if (topProbability > 0.80 && topConditionId !== targetConditionId) {
        return { collapseDetected: true, collapseType: 'probability_explosion' };
    }
    if (diffuseConfusion) {
        return { collapseDetected: true, collapseType: 'confidence_collapse' };
    }
    if (currentTargetProbability < 0.01) {
        return { collapseDetected: true, collapseType: 'abstain_lock' };
    }

    return { collapseDetected: false };
}

function buildAdversarialStep(
    baselineDifferential: DifferentialEntry[],
    perturbedDifferential: DifferentialEntry[],
    targetConditionId: string,
    stepNumber: number,
    noiseLevel: number,
    contradictionLevel: number,
): AdversarialStep {
    const divergence = calculateDivergence(baselineDifferential, perturbedDifferential);
    const rankInversions = countRankInversions(baselineDifferential, perturbedDifferential);
    const collapse = detectCollapse(baselineDifferential, perturbedDifferential, targetConditionId);
    const totalConditions = Math.max(
        1,
        new Set([
            ...baselineDifferential.map((entry) => entry.condition_id).filter(Boolean),
            ...perturbedDifferential.map((entry) => entry.condition_id).filter(Boolean),
        ]).size,
    );
    const phi = Number(
        Math.max(
            0,
            1 - Math.min(1, ((rankInversions / totalConditions) * 0.6) + (divergence * 1.4) + (collapse.collapseDetected ? 0.15 : 0)),
        ).toFixed(4),
    );

    return {
        step_number: stepNumber,
        noise_level: noiseLevel,
        contradiction_level: contradictionLevel,
        differential_at_step: perturbedDifferential.slice(0, 8).map((entry) => ({
            condition_id: entry.condition_id ?? normalizeKey(entry.condition),
            probability: entry.probability,
            rank: entry.rank,
        })),
        target_condition_rank: getRank(perturbedDifferential, targetConditionId),
        target_condition_probability: getProbability(perturbedDifferential, targetConditionId),
        phi,
        divergence_from_baseline: divergence,
        rank_inversions: rankInversions,
        collapse_detected: collapse.collapseDetected,
        collapse_type: collapse.collapseType,
    };
}

function buildMetastableConditions(
    baselineDifferential: DifferentialEntry[],
    stepResults: AdversarialStep[],
    evidenceThresholds: EvidenceThreshold[],
): AdversarialStabilityReport['metastable_conditions'] {
    const baselineTop = baselineDifferential.slice(0, 6);
    const moderateStep = [...stepResults].sort(
        (left, right) => Math.abs(left.noise_level - 0.3) - Math.abs(right.noise_level - 0.3),
    )[0];
    const metastable = new Map<string, AdversarialStabilityReport['metastable_conditions'][number]>();

    if (moderateStep) {
        for (const entry of baselineTop) {
            const conditionId = entry.condition_id;
            if (!conditionId) continue;
            const stepRank = moderateStep.differential_at_step.find((stepEntry) => stepEntry.condition_id === conditionId)?.rank
                ?? (moderateStep.differential_at_step.length + 1);
            if (stepRank === entry.rank) continue;
            metastable.set(conditionId, {
                condition_id: conditionId,
                current_rank: entry.rank,
                current_probability: entry.probability,
                flip_probability: Number(Math.min(1, Math.abs(stepRank - entry.rank) / 5).toFixed(3)),
                flip_direction: stepRank < entry.rank ? 'up' : 'down',
                trigger_finding: 'moderate symptom-noise perturbation',
            });
        }
    }

    for (const threshold of evidenceThresholds) {
        if (!threshold.finding.includes('heart_murmur') && !threshold.finding.includes('antigen')) continue;
        for (const entry of baselineTop) {
            const conditionId = entry.condition_id;
            if (!conditionId) continue;
            if (conditionId !== 'mitral_valve_disease_canine' && !threshold.finding.includes('antigen')) continue;
            if (!metastable.has(conditionId)) {
                metastable.set(conditionId, {
                    condition_id: conditionId,
                    current_rank: entry.rank,
                    current_probability: entry.probability,
                    flip_probability: threshold.finding.includes('heart_murmur') ? 0.6 : 0.8,
                    flip_direction: threshold.finding.includes('heart_murmur') ? 'up' : 'down',
                    trigger_finding: threshold.finding,
                });
            }
        }
    }

    return [...metastable.values()];
}

function buildIntegrityVerdict(
    collapseRisk: number,
    globalPhi: number,
    metastableConditions: AdversarialStabilityReport['metastable_conditions'],
): AdversarialStabilityReport['integrity_verdict'] {
    if (collapseRisk >= 0.4 || globalPhi < 0.55) return 'collapsed';
    if (collapseRisk >= 0.2 || globalPhi < 0.75) return 'fragile';
    if (metastableConditions.length > 0 || globalPhi < 0.9) return 'metastable';
    return 'stable';
}

function buildEncounterPayloadV2(input: {
    id: string;
    species: EncounterSpecies;
    presentingComplaints: string[];
    activePanels: SystemPanel[];
    history: string;
    breed?: string;
}): EncounterPayloadV2 {
    return {
        patient: {
            species: input.species,
            breed: input.breed ?? '',
            weight_kg: null,
            age_years: null,
            sex: 'unknown',
        },
        encounter: {
            presenting_complaints: input.presentingComplaints,
            vitals: {
                temp_c: null,
                heart_rate_bpm: null,
                respiratory_rate_bpm: null,
                mm_colour: null,
                crt_seconds: null,
            },
            history: {
                duration_days: null,
                free_text: input.history,
                medications: [],
            },
        },
        active_system_panels: input.activePanels,
        imaging: {},
        metadata: {
            encounter_id: input.id,
            timestamp: '2026-05-07T00:00:00.000Z',
            clinician_id: null,
            clinic_id: null,
        },
    };
}

function findSpeciesPanelViolations(payload: EncounterPayloadV2): string[] {
    const allowedPanels = SPECIES_PANEL_MAP[payload.patient.species] ?? [];
    return payload.active_system_panels
        .filter((panel) => !allowedPanels.some((entry) => entry.system === panel.system && entry.panel === panel.panel))
        .map((panel) => `${payload.patient.species}:${panel.system}/${panel.panel}`);
}

export function generateMultisystemicAdversarialScenarios(): MultisystemicAdversarialScenario[] {
    const scenarios: Array<Omit<MultisystemicAdversarialScenario, 'expected_species_panel_violations'>> = [
        {
            id: 'v2_monosystemic_equine_saa',
            label: 'Monosystemic baseline - equine SAA inflammatory signal',
            scenario_class: 'monosystemic_baseline',
            payload: buildEncounterPayloadV2({
                id: 'v2_monosystemic_equine_saa',
                species: 'equine',
                breed: 'Thoroughbred',
                presentingComplaints: ['fever', 'lethargy'],
                history: 'Equine patient with fever and elevated serum amyloid A.',
                activePanels: [
                    {
                        system: 'biochemistry',
                        panel: 'SAA',
                        tests: {
                            saa_level: 'elevated',
                            saa_value: 640,
                        },
                    },
                ],
            }),
            expected_reasoning_focus: ['equine-specific panel allowance', 'monosystemic inflammatory baseline'],
        },
        {
            id: 'v2_dual_system_haemolysis_conflict',
            label: 'Dual-system conflict - regenerative anaemia with haemoglobinuria',
            scenario_class: 'dual_system_conflict',
            payload: buildEncounterPayloadV2({
                id: 'v2_dual_system_haemolysis_conflict',
                species: 'feline',
                breed: 'Domestic shorthair',
                presentingComplaints: ['pale gums', 'lethargy', 'red urine'],
                history: 'CBC suggests regenerative anaemia while urine pigment suggests intravascular haemolysis.',
                activePanels: [
                    {
                        system: 'haematology',
                        panel: 'CBC',
                        tests: {
                            anemia_type: 'regenerative',
                            reticulocytosis: 'elevated',
                            spherocytes: 'present',
                        },
                    },
                    {
                        system: 'urinalysis',
                        panel: 'urinalysis',
                        tests: {
                            hemoglobinuria: 'present',
                            proteinuria: 'present',
                        },
                    },
                ],
            }),
            expected_reasoning_focus: ['extravascular versus intravascular haemolysis', 'cross-system contradiction resolution'],
        },
        {
            id: 'v2_triple_system_imha_addison_pln',
            label: 'Triple-system co-morbidity - IMHA, Addisonian pattern, PLN',
            scenario_class: 'triple_system_comorbidity',
            payload: buildEncounterPayloadV2({
                id: 'v2_triple_system_imha_addison_pln',
                species: 'canine',
                breed: 'Mixed breed',
                presentingComplaints: ['collapse', 'vomiting', 'pale gums', 'weight loss'],
                history: 'Concurrent immune haemolysis, blunted adrenal response, and protein-losing nephropathy signals.',
                activePanels: [
                    {
                        system: 'haematology',
                        panel: 'CBC',
                        tests: {
                            spherocytes: 'present',
                            autoagglutination: 'positive',
                            anemia_type: 'regenerative',
                        },
                    },
                    {
                        system: 'endocrine',
                        panel: 'adrenal',
                        tests: {
                            acth_stimulation: 'blunted',
                            sodium_potassium_ratio: 18.2,
                        },
                    },
                    {
                        system: 'urinalysis',
                        panel: 'urinalysis',
                        tests: {
                            proteinuria: 'present',
                            upc: 4.2,
                        },
                    },
                    {
                        system: 'biochemistry',
                        panel: 'renal',
                        tests: {
                            albumin: 'low',
                            creatinine: 'elevated',
                        },
                    },
                ],
            }),
            expected_reasoning_focus: ['multi-diagnosis co-morbidity', 'renal protein loss interaction', 'endocrine-electrolyte interaction'],
        },
        {
            id: 'v2_species_mismatch_reptile_adrenal',
            label: 'Species mismatch - reptile submitted with mammalian adrenal panel',
            scenario_class: 'species_mismatch',
            payload: buildEncounterPayloadV2({
                id: 'v2_species_mismatch_reptile_adrenal',
                species: 'reptile',
                breed: 'Bearded dragon',
                presentingComplaints: ['lethargy', 'anorexia'],
                history: 'Wrong panel intentionally injected to verify species-panel gating.',
                activePanels: [
                    {
                        system: 'endocrine',
                        panel: 'adrenal',
                        tests: {
                            acth_stimulation: 'blunted',
                        },
                    },
                ],
            }),
            expected_reasoning_focus: ['species-panel rejection', 'avian/reptile default panel gating'],
        },
    ];

    return scenarios.map((scenario) => ({
        ...scenario,
        expected_species_panel_violations: findSpeciesPanelViolations(scenario.payload),
    }));
}

export async function runAdversarialSweep(
    rawRequest: InferenceRequest | EncounterPayloadV2 | Record<string, unknown>,
    targetConditionId: string,
    sweepConfig: Partial<AdversarialSweepConfig> = {},
): Promise<AdversarialStabilityReport> {
    const baselineRequest = coerceInferenceRequest(rawRequest);
    const targetCondition = resolveCondition(
        sweepConfig.target_condition ?? targetConditionId,
        baselineRequest.species,
    );
    const resolvedTargetId = targetCondition?.id ?? normalizeKey(targetConditionId);
    const noiseLevels = (sweepConfig.noise_levels?.length ? sweepConfig.noise_levels : DEFAULT_NOISE_LEVELS)
        .map((value) => Number(value.toFixed(3)));
    const contradictionLevels = (sweepConfig.contradiction_levels?.length ? sweepConfig.contradiction_levels : DEFAULT_CONTRADICTION_LEVELS)
        .map((value) => Number(value.toFixed(3)));

    buildBaselineCandidatePool(baselineRequest);
    const baselineResult = runClinicalInferenceEngine(baselineRequest);
    const baselineDifferential = baselineResult.differentials.slice(0, 8);
    const baselineTargetRank = getRank(baselineDifferential, resolvedTargetId);
    const baselineTargetProbability = getProbability(baselineDifferential, resolvedTargetId);
    const evidenceThresholdMap = buildEvidenceThresholdMap(
        baselineRequest,
        baselineDifferential,
        targetCondition,
    );

    const stepResults: AdversarialStep[] = [];
    const maxSteps = Math.max(noiseLevels.length, contradictionLevels.length, sweepConfig.sweep_steps ?? noiseLevels.length);

    for (let index = 0; index < maxSteps; index += 1) {
        const noiseLevel = noiseLevels[index] ?? noiseLevels[noiseLevels.length - 1] ?? 1;
        const contradictionLevel = contradictionLevels[index] ?? contradictionLevels[contradictionLevels.length - 1] ?? noiseLevel;
        const perturbedRequest = buildPerturbedRequest(
            baselineRequest,
            noiseLevel,
            contradictionLevel,
            resolvedTargetId,
        );
        const perturbedResult = runClinicalInferenceEngine(perturbedRequest);
        stepResults.push(
            buildAdversarialStep(
                baselineDifferential,
                perturbedResult.differentials.slice(0, 8),
                resolvedTargetId,
                index + 1,
                noiseLevel,
                contradictionLevel,
            ),
        );
    }

    const collapseSteps = stepResults.filter((step) => step.collapse_detected);
    const globalPhi = Number(
        (
            1
            - (stepResults.reduce((sum, step) => sum + (step.rank_inversions / Math.max(1, step.differential_at_step.length)), 0)
                / Math.max(1, stepResults.length))
        ).toFixed(4),
    );
    const divergence = Number(
        (stepResults.reduce((sum, step) => sum + step.divergence_from_baseline, 0) / Math.max(1, stepResults.length)).toFixed(4),
    );
    const collapseRisk = Number((collapseSteps.length / Math.max(1, stepResults.length)).toFixed(4));
    const ciiIndex = Number((1 - collapseRisk).toFixed(4));
    const metastableConditions = buildMetastableConditions(
        baselineDifferential,
        stepResults,
        evidenceThresholdMap.findings_to_reach_rank_1,
    );
    const maxNoiseStep = [...stepResults].sort((left, right) => right.noise_level - left.noise_level)[0];
    const adversarialAtMax = maxNoiseStep
        ? runClinicalInferenceEngine(
            buildPerturbedRequest(
                baselineRequest,
                maxNoiseStep.noise_level,
                maxNoiseStep.contradiction_level,
                resolvedTargetId,
            ),
        ).differentials.slice(0, 8)
        : baselineDifferential;

    return {
        sweep_config: {
            target_condition: resolvedTargetId,
            perturbation_types: sweepConfig.perturbation_types?.length
                ? sweepConfig.perturbation_types
                : ['symptom_noise', 'contradiction_pressure'],
            noise_levels: noiseLevels,
            contradiction_levels: contradictionLevels,
            sweep_steps: maxSteps,
        },
        baseline_request: baselineRequest,
        baseline_differential: baselineDifferential,
        baseline_target_rank: baselineTargetRank,
        baseline_target_probability: baselineTargetProbability,
        step_results: stepResults,
        global_phi: globalPhi,
        collapse_risk: collapseRisk,
        cii_index: ciiIndex,
        divergence,
        evidence_thresholds: evidenceThresholdMap,
        metastable_conditions: metastableConditions,
        collapse_conditions: collapseSteps.map((step) => ({
            perturbation_vector: `noise=${step.noise_level.toFixed(2)}, contradiction=${step.contradiction_level.toFixed(2)}`,
            collapse_threshold: step.noise_level,
            failure_mode: (step.collapse_type ?? 'confidence_collapse') as 'rank_inversion' | 'probability_explosion' | 'confidence_collapse' | 'abstain_lock',
            description: `Target rank ${step.target_condition_rank} with probability ${step.target_condition_probability.toFixed(3)} at noise ${step.noise_level.toFixed(2)}.`,
        })),
        adversarial_differential_at_max_noise: {
            warning: 'NOT_CLINICAL_OUTPUT — adversarial degradation result only',
            differential: adversarialAtMax,
            degradation_vs_baseline: baselineDifferential.slice(0, 8).map((entry) => ({
                condition_id: entry.condition_id ?? normalizeKey(entry.condition),
                baseline_probability: entry.probability,
                adversarial_probability: getProbability(adversarialAtMax, entry.condition_id ?? normalizeKey(entry.condition)),
                rank_change: getRank(adversarialAtMax, entry.condition_id ?? normalizeKey(entry.condition)) - entry.rank,
            })),
        },
        clean_clinical_differential: baselineDifferential,
        integrity_verdict: buildIntegrityVerdict(collapseRisk, globalPhi, metastableConditions),
    };
}
