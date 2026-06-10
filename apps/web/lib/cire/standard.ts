export const CIRE_STANDARD_VERSION = '1.0.0';
export const CIRE_STANDARD_KEY = 'vetios-cire-open-standard';
export const CIRE_STANDARD_PATH = '/platform/cire-standard';
export const CIRE_STANDARD_API_PATH = '/api/public/cire-standard';

export type CireSignalKey =
    | 'phi_hat'
    | 'input_m_hat'
    | 'delta_rolling'
    | 'sigma_delta'
    | 'cps';

export interface CireFormulaDefinition {
    key: CireSignalKey;
    name: string;
    formula: string;
    interpretation: string;
    range: string;
}
export interface CireSafetyStateDefinition {
    safety_state: 'nominal' | 'warning' | 'critical' | 'blocked';
    reliability_badge: 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';
    meaning: string;
    expected_action: string;
}

export interface CireOpenStandard {
    standard_key: typeof CIRE_STANDARD_KEY;
    version: typeof CIRE_STANDARD_VERSION;
    status: 'public_reference';
    title: string;
    summary: string;
    canonical_url: string;
    machine_readable_url: string;
    implementation: {
        package_name: '@vetios/cire-engine';
        runtime_surface: 'inference_event_lineage';
        compatibility: string;
    };
    formulas: CireFormulaDefinition[];
    safety_states: CireSafetyStateDefinition[];
    default_parameters: {
        ema_alpha: number;
        sigma_window: number;
        phi_baseline_minimum: number;
    };
    required_runtime_fields: string[];
    event_lineage: {
        source_table: string;
        outcome_table: string;
        minimum_fields: string[];
    };
    public_api_surfaces: string[];
    example: {
        input: Record<string, unknown>;
        output: Record<string, unknown>;
    };
    generated_at: string;
}

const formulas: CireFormulaDefinition[] = [
    {
        key: 'phi_hat',
        name: 'Inference certainty entropy score',
        formula: 'phi_hat = 1 - H(D) / ln(|D|), where H(D) = -sum(p_i * ln(p_i)) over normalized differential probabilities',
        interpretation: 'Higher values mean the differential distribution is more concentrated and easier to act on.',
        range: '0.0 to 1.0',
    },
    {
        key: 'input_m_hat',
        name: 'Input quality risk score',
        formula: 'input_m_hat = 0.40 * missingness + 0.35 * contradiction_rate + 0.25 * out_of_distribution_rate',
        interpretation: 'Higher values mean the clinical input is incomplete, contradictory, or outside the supported operating envelope.',
        range: '0.0 to 1.0',
    },
    {
        key: 'delta_rolling',
        name: 'Rolling reliability drift',
        formula: 'delta_rolling = EMA(delta_hat, alpha = 0.1)',
        interpretation: 'Tracks short-horizon movement in reliability compared with prior inference behavior.',
        range: 'negative to positive real number',
    },
    {
        key: 'sigma_delta',
        name: 'Reliability volatility',
        formula: 'sigma_delta = standard_deviation(last 50 delta_hat values)',
        interpretation: 'Higher values indicate less stable reliability behavior across recent events.',
        range: '0.0 and above',
    },
    {
        key: 'cps',
        name: 'Clinical perturbation score',
        formula: 'cps = 0.40 * (1 - phi_hat / phi0) + 0.35 * max(0, -delta_rolling) / phi0 + 0.25 * sigma_delta / phi0',
        interpretation: 'Composite safety score used to decide whether an inference is high confidence, reviewable, cautionary, or suppressed.',
        range: '0.0 and above',
    },
];

const safetyStates: CireSafetyStateDefinition[] = [
    {
        safety_state: 'nominal',
        reliability_badge: 'HIGH',
        meaning: 'The inference is within the expected reliability envelope.',
        expected_action: 'Show the differential with normal clinical decision-support language.',
    },
    {
        safety_state: 'warning',
        reliability_badge: 'REVIEW',
        meaning: 'The inference should be interpreted with clinician review because reliability has weakened.',
        expected_action: 'Surface uncertainty and recommend additional diagnostic confirmation.',
    },
    {
        safety_state: 'critical',
        reliability_badge: 'CAUTION',
        meaning: 'The inference is unstable enough to require explicit caution.',
        expected_action: 'Show the result as decision support only and avoid workflow automation.',
    },
    {
        safety_state: 'blocked',
        reliability_badge: 'SUPPRESSED',
        meaning: 'The inference is outside the safe publication envelope.',
        expected_action: 'Suppress the clinical answer and require human review or better input.',
    },
];

function absoluteUrl(baseUrl: string, path: string): string {
    return new URL(path, baseUrl).toString();
}

export function getCireOpenStandard(baseUrl = 'https://www.vetios.tech'): CireOpenStandard {
    return {
        standard_key: CIRE_STANDARD_KEY,
        version: CIRE_STANDARD_VERSION,
        status: 'public_reference',
        title: 'CIRE Open Standard',
        summary: 'A versioned clinical inference reliability contract for publishing phi_hat, input quality, drift, volatility, and safety-state lineage across veterinary AI workflows.',
        canonical_url: absoluteUrl(baseUrl, CIRE_STANDARD_PATH),
        machine_readable_url: absoluteUrl(baseUrl, CIRE_STANDARD_API_PATH),
        implementation: {
            package_name: '@vetios/cire-engine',
            runtime_surface: 'inference_event_lineage',
            compatibility: 'VetIOS inference events, model cards, outcome feedback, and partner API products.',
        },
        formulas,
        safety_states: safetyStates,
        default_parameters: {
            ema_alpha: 0.1,
            sigma_window: 50,
            phi_baseline_minimum: 0.0001,
        },
        required_runtime_fields: [
            'phi_hat',
            'input_m_hat',
            'cps',
            'safety_state',
            'reliability_badge',
            'model_name',
            'model_version',
            'input_signature',
            'created_at',
        ],
        event_lineage: {
            source_table: 'ai_inference_events',
            outcome_table: 'clinical_outcome_events',
            minimum_fields: [
                'inference_event_id',
                'tenant_id',
                'request_id',
                'phi_hat',
                'cps',
                'safety_state',
                'differentials',
                'confirmed_diagnosis',
            ],
        },
        public_api_surfaces: [
            CIRE_STANDARD_API_PATH,
            '/api/public/model-cards',
            '/api/public/developer-catalog',
        ],
        example: {
            input: {
                differential_probabilities: [0.82, 0.41, 0.18, 0.09],
                missingness: 0.1,
                contradiction_rate: 0,
                out_of_distribution_rate: 0.05,
            },
            output: {
                phi_hat: 0.38,
                input_m_hat: 0.0525,
                cps: 0.18,
                safety_state: 'nominal',
                reliability_badge: 'HIGH',
            },
        },
        generated_at: new Date().toISOString(),
    };
}
