import {
    extractClinicalSignals,
    getFeatureLabel,
    parseAgeMonths,
    readBooleanField,
    readNumberField,
    type ClinicalSignals,
    type SignalKey,
} from '@/lib/ai/clinicalSignals';

export interface ContradictionResult {
    contradiction_score: number;
    contradiction_reasons: string[];
    is_plausible: boolean;
    confidence_cap: number;
    abstain: boolean;
}

export interface ContradictionConfig {
    moderate_threshold: number;
    high_threshold: number;
    mild_confidence_cap: number;
    moderate_confidence_cap: number;
    high_confidence_cap: number;
}

interface WeightedContradiction {
    reason: string;
    weight: number;
}

const DEFAULT_CONFIG: ContradictionConfig = {
    moderate_threshold: 0.4,
    high_threshold: 0.7,
    mild_confidence_cap: 0.8,
    moderate_confidence_cap: 0.6,
    high_confidence_cap: 0.45,
};

const SPECIES_WEIGHT_RANGES: Record<string, { min: number; max: number }> = {
    cat: { min: 1.5, max: 12 },
    kitten: { min: 0.1, max: 3 },
    dog: { min: 0.5, max: 90 },
    puppy: { min: 0.1, max: 15 },
    rabbit: { min: 0.5, max: 7 },
    hamster: { min: 0.02, max: 0.06 },
    bird: { min: 0.01, max: 5 },
    horse: { min: 200, max: 1000 },
    cow: { min: 200, max: 1200 },
    ferret: { min: 0.5, max: 2.5 },
    guinea_pig: { min: 0.5, max: 1.5 },
};

const BREED_WEIGHT_RANGES: Record<string, { min: number; max: number }> = {
    chihuahua: { min: 1, max: 3.5 },
    'yorkshire terrier': { min: 1.5, max: 3.5 },
    pomeranian: { min: 1.5, max: 3.5 },
    'shih tzu': { min: 4, max: 8 },
    pug: { min: 6, max: 10 },
    beagle: { min: 9, max: 14 },
    'border collie': { min: 14, max: 22 },
    'golden retriever': { min: 25, max: 36 },
    'labrador retriever': { min: 25, max: 36 },
    'german shepherd': { min: 22, max: 40 },
    rottweiler: { min: 36, max: 60 },
    'great dane': { min: 45, max: 90 },
    'domestic shorthair': { min: 3, max: 7 },
    persian: { min: 3, max: 6 },
    'maine coon': { min: 5, max: 11 },
    siamese: { min: 2.5, max: 5 },
    dachshund: { min: 7, max: 15 },
};

export function detectContradictions(
    input: Record<string, unknown>,
    overrides: Partial<ContradictionConfig> = {},
): ContradictionResult {
    const config: ContradictionConfig = { ...DEFAULT_CONFIG, ...overrides };
    const signals = extractClinicalSignals(input);
    const contradictions: WeightedContradiction[] = [];

    addMetadataConflict(contradictions, input, signals, 'abdominal_distension', false, 'abdominal distension present in symptom vector but false in metadata', 0.24);
    addMetadataConflict(contradictions, input, signals, 'productive_vomiting', true, 'retching/vomiting conflict: metadata indicates productive vomiting while symptom vector indicates unproductive retching', 0.22, 'unproductive_retching');
    addMetadataConflict(contradictions, input, signals, 'fever', false, 'fever present in symptoms but false in metadata', 0.18, 'fever');

    if (
        signals.appetite_status === 'normal' &&
        (signals.evidence.collapse.present || signals.shock_pattern_strength >= 2.5)
    ) {
        contradictions.push({
            reason: 'normal appetite inconsistent with severe collapse pattern',
            weight: 0.2,
        });
    }

    if (signals.gdv_cluster_count >= 3 && signals.duration_days != null && signals.duration_days > 2) {
        contradictions.push({
            reason: `duration of ${signals.duration_days} days is inconsistent with an untreated acute mechanical crisis presenting with collapse`,
            weight: 0.23,
        });
    }

    if (signals.gdv_cluster_count >= 3 && signals.has_small_breed_gdv_mismatch) {
        contradictions.push({
            reason: 'breed/body-size profile lowers the classic GDV prior despite a strong abdominal emergency signal cluster',
            weight: 0.08,
        });
    }

    if (
        signals.upper_airway_pattern_strength >= 2.2 &&
        signals.duration_days != null &&
        signals.duration_days > 20
    ) {
        contradictions.push({
            reason: `acute upper-airway symptom pattern is difficult to reconcile with a duration of ${signals.duration_days} days without chronic progression`,
            weight: 0.18,
        });
    }

    if (
        signals.respiratory_infection_pattern_strength >= 2.4 &&
        signals.has_isolated_environment &&
        !signals.has_exposure_risk
    ) {
        contradictions.push({
            reason: 'infectious respiratory pattern conflicts with an isolated environment and absent exposure history',
            weight: 0.14,
        });
    }

    if (
        signals.evidence.honking_cough.present &&
        !signals.has_small_breed_tracheal_collapse_risk &&
        signals.duration_days != null &&
        signals.duration_days > 20
    ) {
        contradictions.push({
            reason: 'breed/body profile weakens chronic tracheal-collapse priors despite a honking cough pattern',
            weight: 0.08,
        });
    }

    contradictions.push(...evaluateBiologicPlausibility(signals));
    contradictions.push(...evaluateStructuredTextConflicts(input, signals));

    const unique = dedupeContradictions(contradictions);
    const contradictionScore = Number(Math.min(1, unique.reduce((sum, item) => sum + item.weight, 0)).toFixed(3));
    const confidenceCap = resolveConfidenceCap(contradictionScore, config);
    const abstain =
        contradictionScore >= config.high_threshold ||
        (contradictionScore >= config.moderate_threshold && unique.length >= 3);

    return {
        contradiction_score: contradictionScore,
        contradiction_reasons: unique.map((item) => item.reason),
        is_plausible: unique.length === 0,
        confidence_cap: confidenceCap,
        abstain,
    };
}

function evaluateBiologicPlausibility(signals: ClinicalSignals): WeightedContradiction[] {
    const contradictions: WeightedContradiction[] = [];
    const species = signals.species;
    const breed = signals.breed;
    const weight = signals.weight_kg;

    if (weight != null && species != null) {
        const range = SPECIES_WEIGHT_RANGES[species];
        if (range != null) {
            if (weight < range.min * 0.5) {
                contradictions.push({
                    reason: `weight ${weight.toFixed(1)}kg is implausibly below the expected range for ${species}`,
                    weight: 0.16,
                });
            }
            if (weight > range.max * 1.5) {
                contradictions.push({
                    reason: `weight ${weight.toFixed(1)}kg is implausibly above the expected range for ${species}`,
                    weight: 0.2,
                });
            }
        }
    }

    if (weight != null && breed != null) {
        const range = BREED_WEIGHT_RANGES[breed];
        if (range != null) {
            if (weight < range.min * 0.3) {
                contradictions.push({
                    reason: `weight ${weight.toFixed(1)}kg is critically low for ${breed}`,
                    weight: 0.18,
                });
            }
            if (weight > range.max * 2.5) {
                contradictions.push({
                    reason: `weight ${weight.toFixed(1)}kg is implausibly high for ${breed}`,
                    weight: 0.2,
                });
            }
        }
    }

    if (signals.age_description != null && weight != null && species != null) {
        const ageMonths = parseAgeMonths(signals.age_description);
        if (ageMonths != null) {
            if (species === 'dog' && ageMonths < 3 && weight > 10) {
                contradictions.push({
                    reason: `age ${signals.age_description} is inconsistent with weight ${weight.toFixed(1)}kg for a very young dog`,
                    weight: 0.18,
                });
            }
            if (species === 'cat' && ageMonths < 2 && weight > 3) {
                contradictions.push({
                    reason: `age ${signals.age_description} is inconsistent with weight ${weight.toFixed(1)}kg for a kitten`,
                    weight: 0.18,
                });
            }
        }
    }

    return contradictions;
}

function evaluateStructuredTextConflicts(
    input: Record<string, unknown>,
    signals: ClinicalSignals,
): WeightedContradiction[] {
    const contradictions: WeightedContradiction[] = [];

    if (signals.evidence.productive_vomiting.present && signals.evidence.unproductive_retching.present) {
        contradictions.push({
            reason: 'structured or free-text history contains both productive vomiting and unproductive retching',
            weight: 0.14,
        });
    }

    const metadataAppetite = typeof input.appetite_status === 'string'
        ? input.appetite_status.toLowerCase()
        : typeof readNestedString(input, 'appetite_status') === 'string'
            ? (readNestedString(input, 'appetite_status') as string).toLowerCase()
            : null;
    if (metadataAppetite === 'normal' && signals.evidence.anorexia.present) {
        contradictions.push({
            reason: 'normal appetite in metadata conflicts with anorexia or inappetence described elsewhere',
            weight: 0.15,
        });
    }
    return contradictions;
}

function addMetadataConflict(
    contradictions: WeightedContradiction[],
    input: Record<string, unknown>,
    signals: ClinicalSignals,
    field: string,
    expectedStructuredValue: boolean,
    reason: string,
    weight: number,
    signalKey: SignalKey = field as SignalKey,
): void {
    const metadataValue = readBooleanField(input, field);
    if (metadataValue === expectedStructuredValue && signals.evidence[signalKey].present) {
        contradictions.push({ reason, weight });
    }
}

function resolveConfidenceCap(score: number, config: ContradictionConfig): number {
    if (score > config.high_threshold) return config.high_confidence_cap;
    if (score > config.moderate_threshold) return config.moderate_confidence_cap;
    if (score > 0) return config.mild_confidence_cap;
    return 1;
}

function dedupeContradictions(items: WeightedContradiction[]): WeightedContradiction[] {
    const seen = new Map<string, WeightedContradiction>();
    for (const item of items) {
        const existing = seen.get(item.reason);
        if (!existing || existing.weight < item.weight) {
            seen.set(item.reason, item);
        }
    }
    return [...seen.values()];
}

function readNestedString(input: Record<string, unknown>, field: string): string | null {
    const direct = input[field];
    if (typeof direct === 'string') return direct;
    const metadata = input.metadata && typeof input.metadata === 'object'
        ? (input.metadata as Record<string, unknown>)
        : {};
    return typeof metadata[field] === 'string' ? (metadata[field] as string) : null;
}
