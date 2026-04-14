export type SafetyState = 'nominal' | 'warning' | 'critical' | 'blocked';
export type ReliabilityBadge = 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';

export interface SafetyClassification {
    safety_state: SafetyState;
    reliability_badge: ReliabilityBadge;
}

export interface InferenceInput {
    species?: string | null;
    breed?: string | null;
    age?: number | string | null;
    age_years?: number | string | null;
    weight?: number | string | null;
    weight_kg?: number | string | null;
    urgency?: string | null;
    region?: string | null;
    symptoms?: string[] | string | null;
    biomarkers?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    input_signature?: Record<string, unknown> | null;
    input?: Record<string, unknown> | null;
    [key: string]: unknown;
}

export interface RollingStateSnapshot {
    phi_ema?: number | null;
    delta_ema?: number | null;
    sigma_buffer?: number[] | null;
    window_count?: number | null;
    last_phi_hat?: number | null;
}

export interface RollingStateResult {
    phi_ema: number;
    delta_ema: number;
    sigma_buffer: number[];
    sigma_delta: number;
    delta_hat: number;
    window_count: number;
    last_phi_hat: number;
}

export interface PhiSentinelConfig {
    phi_baseline: number;
    warn_threshold_cps: number;
    critical_threshold_cps: number;
    block_threshold_cps: number;
    ema_alpha?: number;
    sigma_window?: number;
    output_vector_path?: string | null;
}

export interface PhiSentinelResult<TOutput> extends SafetyClassification {
    cps: number;
    phi_hat: number;
    input_quality: number;
    output: TOutput | null;
    raw_output: TOutput;
}

const DEFAULT_ALPHA = 0.1;
const DEFAULT_SIGMA_WINDOW = 50;

const DOG_BREEDS = new Set([
    'golden retriever',
    'labrador retriever',
    'german shepherd',
    'pomeranian',
    'chihuahua',
    'jack russell terrier',
    'doberman pinscher',
    'rottweiler',
    'boerboel',
    'mixed breed',
]);

const CAT_BREEDS = new Set([
    'domestic shorthair',
    'domestic longhair',
    'siamese',
    'maine coon',
    'persian',
    'abyssinian',
]);

const KNOWN_SPECIES = new Set([
    'dog',
    'canine',
    'cat',
    'feline',
    'horse',
    'equine',
    'goat',
    'sheep',
    'rabbit',
    'ferret',
    'bird',
    'avian',
    'pig',
    'swine',
    'cow',
    'bovine',
]);

const KNOWN_REGIONS = new Set([
    'nairobi',
    'kenya',
    'east africa',
    'uganda',
    'tanzania',
    'rwanda',
    'ethiopia',
    'maasai mara',
    'nakuru',
    'kiambu',
    'mombasa',
]);

const BIOMARKER_RANGES: Record<string, [number, number]> = {
    temperature_c: [30, 45],
    body_temperature_c: [30, 45],
    heart_rate: [20, 320],
    respiratory_rate: [4, 180],
    calcium: [1, 20],
    ionized_calcium: [0.2, 3],
    glucose: [10, 1000],
    creatinine: [0.1, 30],
    bun: [1, 300],
    phosphorus: [0.1, 20],
    magnesium: [0.1, 10],
    potassium: [1, 10],
    sodium: [80, 220],
};

/**
 * Φ̂ = 1 − H(D) / log(|D|), where |D| is the cardinality of the differential (input length).
 * H(D) = −Σ pᵢ log pᵢ over normalized probabilities (zeros contribute nothing).
 */
export function computePhiHat(differentialVector: number[]): number {
    const n = differentialVector.length;
    if (n <= 0) {
        return 0;
    }
    if (n === 1) {
        const v = differentialVector[0];
        return Number.isFinite(v) && v > 0 ? 1 : 0;
    }

    const sanitized = differentialVector.map((value) =>
        (Number.isFinite(value) && value > 0 ? value : 0),
    );
    const total = sanitized.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
        return 0;
    }

    const normalized = sanitized.map((value) => value / total);
    const entropy = normalized.reduce((sum, p) => {
        if (p <= 0) return sum;
        return sum - (p * Math.log(p));
    }, 0);
    const denom = Math.log(n);
    if (!Number.isFinite(denom) || denom <= 0) {
        return 1;
    }

    return clamp01(1 - (entropy / denom));
}

export function computeInputMHat(inputPayload: InferenceInput): number {
    const normalized = normalizeInputEnvelope(inputPayload);
    const symptoms = normalizeSymptoms(normalized.symptoms);
    const species = normalizeText(normalized.species);
    const breed = normalizeText(normalized.breed);
    const urgency = normalizeText(normalized.urgency ?? normalized.metadata?.urgency);
    const region = normalizeText(normalized.region ?? normalized.metadata?.region);
    const ageYears = readNumber(normalized.age_years ?? normalized.age ?? normalized.metadata?.age_years);
    const weightKg = readNumber(normalized.weight_kg ?? normalized.weight ?? normalized.metadata?.weight_kg);

    const expectedFields: unknown[] = [
        species,
        breed,
        symptoms.length > 0 ? symptoms : null,
        urgency,
        region,
    ];
    const missingFields = expectedFields.filter((value) => isMissing(value)).length;
    const completenessM = expectedFields.length > 0 ? missingFields / expectedFields.length : 0;

    let contradictionPairsChecked = 0;
    let contradictoryPairs = 0;

    if (species || breed) {
        contradictionPairsChecked += 1;
        if (
            (species?.includes('cat') || species?.includes('feline')) && breed && DOG_BREEDS.has(breed)
            || (species?.includes('dog') || species?.includes('canine')) && breed && CAT_BREEDS.has(breed)
        ) {
            contradictoryPairs += 1;
        }
    }

    if (ageYears != null) {
        contradictionPairsChecked += 1;
        if (ageYears < 0 || ageYears > 80) {
            contradictoryPairs += 1;
        }
    }

    if (weightKg != null) {
        contradictionPairsChecked += 1;
        if (weightKg <= 0 || weightKg > 1200) {
            contradictoryPairs += 1;
        } else if ((species?.includes('cat') || species?.includes('feline')) && weightKg > 30) {
            contradictoryPairs += 1;
        } else if ((species?.includes('dog') || species?.includes('canine')) && weightKg > 120) {
            contradictoryPairs += 1;
        }
    }

    if (symptoms.length > 0 || urgency) {
        contradictionPairsChecked += 1;
        const saysHealthy = symptoms.some((symptom) => symptom.includes('healthy') || symptom.includes('no issues'));
        const distress = symptoms.some((symptom) =>
            ['collapse', 'seizure', 'dyspnea', 'vomiting', 'bleeding', 'shock', 'tachycardia', 'trauma']
                .some((needle) => symptom.includes(needle)),
        );
        if ((saysHealthy && distress) || (saysHealthy && urgency?.includes('critical'))) {
            contradictoryPairs += 1;
        }
    }

    if (species) {
        contradictionPairsChecked += 1;
        if (
            (species.includes('dog') && species.includes('cat'))
            || species.includes('all species')
            || species.includes('no species')
        ) {
            contradictoryPairs += 1;
        }
    }

    const contradictionM = contradictionPairsChecked > 0
        ? contradictoryPairs / contradictionPairsChecked
        : 0;

    let oodFieldsChecked = 0;
    let oodFields = 0;

    if (species) {
        oodFieldsChecked += 1;
        if (!Array.from(KNOWN_SPECIES).some((entry) => species.includes(entry))) {
            oodFields += 1;
        }
    }

    if (region) {
        oodFieldsChecked += 1;
        if (!Array.from(KNOWN_REGIONS).some((entry) => region.includes(entry))) {
            oodFields += 1;
        }
    }

    const biomarkers = normalizeBiomarkers(normalized);
    for (const [field, value] of Object.entries(biomarkers)) {
        const range = BIOMARKER_RANGES[field];
        if (!range) continue;
        oodFieldsChecked += 1;
        if (value < range[0] || value > range[1]) {
            oodFields += 1;
        }
    }

    const oodM = oodFieldsChecked > 0 ? oodFields / oodFieldsChecked : 0;

    return clamp01((0.40 * completenessM) + (0.35 * contradictionM) + (0.25 * oodM));
}

export function computeCPS(
    phiHat: number,
    deltaRolling: number,
    sigmaDelta: number,
    phi0: number,
): number {
    const safePhi0 = Math.max(phi0, 0.0001);
    const cps = (0.40 * (1 - (phiHat / safePhi0)))
        + (0.35 * Math.max(0, -deltaRolling) / safePhi0)
        + (0.25 * sigmaDelta / safePhi0);

    return clamp01(cps);
}

export function classifySafetyState(cps: number): SafetyClassification {
    if (cps < 0.25) {
        return { safety_state: 'nominal', reliability_badge: 'HIGH' };
    }
    if (cps < 0.50) {
        return { safety_state: 'warning', reliability_badge: 'REVIEW' };
    }
    if (cps < 0.75) {
        return { safety_state: 'critical', reliability_badge: 'CAUTION' };
    }
    return { safety_state: 'blocked', reliability_badge: 'SUPPRESSED' };
}

export function updateRollingState(
    currentState: RollingStateSnapshot | null | undefined,
    phiHat: number,
    options: {
        alpha?: number;
        sigmaWindow?: number;
    } = {},
): RollingStateResult {
    const alpha = options.alpha ?? DEFAULT_ALPHA;
    const sigmaWindow = options.sigmaWindow ?? DEFAULT_SIGMA_WINDOW;
    const previousPhi = currentState?.last_phi_hat
        ?? currentState?.phi_ema
        ?? phiHat;
    const previousPhiEma = currentState?.phi_ema ?? previousPhi;
    const previousDeltaEma = currentState?.delta_ema ?? 0;
    const sigmaBuffer = Array.isArray(currentState?.sigma_buffer)
        ? currentState.sigma_buffer.filter((value): value is number => Number.isFinite(value))
        : [];

    const deltaHat = phiHat - previousPhi;
    const nextPhiEma = (alpha * phiHat) + ((1 - alpha) * previousPhiEma);
    const nextDeltaEma = (alpha * deltaHat) + ((1 - alpha) * previousDeltaEma);
    const nextSigmaBuffer = [...sigmaBuffer, deltaHat].slice(-sigmaWindow);
    const sigmaDelta = standardDeviation(nextSigmaBuffer);
    const windowCount = (currentState?.window_count ?? 0) + 1;

    return {
        phi_ema: roundNumber(nextPhiEma, 6),
        delta_ema: roundNumber(nextDeltaEma, 6),
        sigma_buffer: nextSigmaBuffer.map((value) => roundNumber(value, 6)),
        sigma_delta: roundNumber(sigmaDelta, 6),
        delta_hat: roundNumber(deltaHat, 6),
        window_count: windowCount,
        last_phi_hat: roundNumber(phiHat, 6),
    };
}

export function extractProbabilityVectorFromOutput(
    output: unknown,
    preferredPath?: string | null,
): number[] {
    const fromPreferred = preferredPath ? readNumericArrayAtPath(output, preferredPath) : [];
    if (fromPreferred.length > 0) {
        return fromPreferred;
    }

    const candidatePaths = [
        'diagnosis.top_differentials',
        'data.probabilities',
        'probabilities',
        'choices[0].logprobs',
    ];

    for (const path of candidatePaths) {
        const value = readAtPath(output, path);
        const vector = normalizeProbabilityVector(value);
        if (vector.length > 0) {
            return vector;
        }
    }

    return [];
}

export class PhiSentinel {
    private readonly config: Required<Pick<PhiSentinelConfig, 'phi_baseline' | 'warn_threshold_cps' | 'critical_threshold_cps' | 'block_threshold_cps' | 'ema_alpha' | 'sigma_window'>> & {
        output_vector_path: string | null;
    };
    private rollingState: RollingStateSnapshot | null = null;

    constructor(config: PhiSentinelConfig) {
        this.config = {
            phi_baseline: Math.max(config.phi_baseline, 0.0001),
            warn_threshold_cps: config.warn_threshold_cps,
            critical_threshold_cps: config.critical_threshold_cps,
            block_threshold_cps: config.block_threshold_cps,
            ema_alpha: config.ema_alpha ?? DEFAULT_ALPHA,
            sigma_window: config.sigma_window ?? DEFAULT_SIGMA_WINDOW,
            output_vector_path: config.output_vector_path ?? null,
        };
    }

    async wrap<TInput, TOutput>(
        inferenceFn: (input: TInput) => Promise<TOutput>,
        input: TInput,
    ): Promise<PhiSentinelResult<TOutput>> {
        const rawOutput = await inferenceFn(input);
        const vector = extractProbabilityVectorFromOutput(rawOutput, this.config.output_vector_path);
        const phiHat = computePhiHat(vector);
        const nextRollingState = updateRollingState(this.rollingState, phiHat, {
            alpha: this.config.ema_alpha,
            sigmaWindow: this.config.sigma_window,
        });
        this.rollingState = nextRollingState;

        const inputMHat = computeInputMHat(input as InferenceInput);
        const cps = computeCPS(
            phiHat,
            nextRollingState.delta_ema,
            nextRollingState.sigma_delta,
            this.config.phi_baseline,
        );
        const classification = classifyWithThresholds(cps, {
            warn: this.config.warn_threshold_cps,
            critical: this.config.critical_threshold_cps,
            block: this.config.block_threshold_cps,
        });

        return {
            ...classification,
            cps: roundNumber(cps, 6),
            phi_hat: roundNumber(phiHat, 6),
            input_quality: roundNumber(1 - inputMHat, 6),
            output: classification.safety_state === 'blocked' ? null : rawOutput,
            raw_output: rawOutput,
        };
    }
}

function classifyWithThresholds(
    cps: number,
    thresholds: {
        warn: number;
        critical: number;
        block: number;
    },
): SafetyClassification {
    if (cps < thresholds.warn) {
        return { safety_state: 'nominal', reliability_badge: 'HIGH' };
    }
    if (cps < thresholds.critical) {
        return { safety_state: 'warning', reliability_badge: 'REVIEW' };
    }
    if (cps < thresholds.block) {
        return { safety_state: 'critical', reliability_badge: 'CAUTION' };
    }
    return { safety_state: 'blocked', reliability_badge: 'SUPPRESSED' };
}

function normalizeInputEnvelope(inputPayload: InferenceInput): Record<string, unknown> & {
    metadata: Record<string, unknown>;
    symptoms?: unknown;
    species?: unknown;
    breed?: unknown;
    urgency?: unknown;
    region?: unknown;
    age?: unknown;
    age_years?: unknown;
    weight?: unknown;
    weight_kg?: unknown;
    biomarkers?: unknown;
} {
    const root = asRecord(inputPayload);
    const nestedInput = asRecord(root.input);
    const inputSignature = asRecord(nestedInput.input_signature ?? root.input_signature);
    const metadata = asRecord(inputSignature.metadata ?? root.metadata);

    return {
        ...root,
        ...inputSignature,
        metadata,
    };
}

function normalizeBiomarkers(input: Record<string, unknown>) {
    const biomarkers = {
        ...asRecord(input.biomarkers),
        ...asRecord(asRecord(input.metadata).biomarkers),
    };
    const normalized: Record<string, number> = {};

    for (const [key, value] of Object.entries(biomarkers)) {
        const numericValue = readNumber(value);
        if (numericValue != null) {
            normalized[normalizeText(key) ?? key] = numericValue;
        }
    }

    for (const key of Object.keys(BIOMARKER_RANGES)) {
        const numericValue = readNumber(input[key]);
        if (numericValue != null) {
            normalized[key] = numericValue;
        }
    }

    return normalized;
}

function normalizeSymptoms(value: unknown) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => normalizeText(entry))
            .filter((entry): entry is string => Boolean(entry));
    }
    const text = normalizeText(value);
    return text ? text.split(/[,;|]/).map((entry) => entry.trim()).filter(Boolean) : [];
}

function normalizeProbabilityVector(value: unknown): number[] {
    if (Array.isArray(value)) {
        if (value.every((entry) => typeof entry === 'number')) {
            return value.filter((entry): entry is number => Number.isFinite(entry) && entry >= 0);
        }
        if (value.every((entry) => typeof entry === 'object' && entry !== null)) {
            return value
                .map((entry) => {
                    const record = asRecord(entry);
                    return readNumber(record.probability ?? record.value ?? record.score ?? record.logprob);
                })
                .filter((entry): entry is number => entry != null && entry >= 0);
        }
    }
    return [];
}

function readNumericArrayAtPath(value: unknown, path: string) {
    return normalizeProbabilityVector(readAtPath(value, path));
}

function readAtPath(value: unknown, path: string): unknown {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current: unknown = value;

    for (const part of parts) {
        if (Array.isArray(current)) {
            const index = Number(part);
            if (!Number.isInteger(index)) return null;
            current = current[index];
            continue;
        }
        if (typeof current !== 'object' || current === null) {
            return null;
        }
        current = (current as Record<string, unknown>)[part];
    }

    return current;
}

function standardDeviation(values: number[]) {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    return Math.sqrt(Math.max(variance, 0));
}

function clamp01(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function roundNumber(value: number, precision: number) {
    return Number(value.toFixed(precision));
}

function normalizeText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim().toLowerCase()
        : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function isMissing(value: unknown) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.trim().length === 0;
    return false;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
