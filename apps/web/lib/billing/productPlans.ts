export type ProductPlanKey =
    | 'free'
    | 'clinic'
    | 'practice'
    | 'research'
    | 'developer'
    | 'federation'
    | 'enterprise';

export type ProductFeatureKey =
    | 'clinical_cases'
    | 'voice_capture'
    | 'soap_notes'
    | 'ask_vetios'
    | 'patient_records'
    | 'petpass'
    | 'datasets'
    | 'model_trust'
    | 'console'
    | 'api'
    | 'webhooks'
    | 'developer_portal'
    | 'federation'
    | 'edge_box'
    | 'network_learning'
    | 'custom_sla';

export interface ProductPlan {
    key: ProductPlanKey;
    displayName: string;
    description: string;
    monthlyDiagnosisLimit: number | null;
    monthlyPriceUsd: number | null;
    features: Partial<Record<ProductFeatureKey, boolean>>;
    recommendedFor: string;
    cta: string;
    custom: boolean;
}

export const PRODUCT_PLANS: ProductPlan[] = [
    {
        key: 'free',
        displayName: 'Free',
        description: 'Clinical trial workspace for individual veterinarians.',
        monthlyDiagnosisLimit: 30,
        monthlyPriceUsd: 0,
        recommendedFor: 'Trying VetIOS with real case workflow.',
        cta: 'Use Free',
        custom: false,
        features: {
            clinical_cases: true,
            ask_vetios: true,
        },
    },
    {
        key: 'clinic',
        displayName: 'Clinic',
        description: 'Core workflow for one active clinic.',
        monthlyDiagnosisLimit: 300,
        monthlyPriceUsd: 49,
        recommendedFor: 'Small clinics using VetIOS every week.',
        cta: 'Start Clinic',
        custom: false,
        features: {
            clinical_cases: true,
            voice_capture: true,
            soap_notes: true,
            ask_vetios: true,
        },
    },
    {
        key: 'practice',
        displayName: 'Practice',
        description: 'Unlimited clinical workspace for multi-vet practices.',
        monthlyDiagnosisLimit: null,
        monthlyPriceUsd: 149,
        recommendedFor: 'Teams that need records, PetPass, and higher volume.',
        cta: 'Start Practice',
        custom: false,
        features: {
            clinical_cases: true,
            voice_capture: true,
            soap_notes: true,
            ask_vetios: true,
            patient_records: true,
            petpass: true,
        },
    },
    {
        key: 'research',
        displayName: 'Research',
        description: 'Validation, cohort review, datasets, and intelligence analytics.',
        monthlyDiagnosisLimit: null,
        monthlyPriceUsd: 499,
        recommendedFor: 'Clinical studies and model validation programs.',
        cta: 'Start Research',
        custom: false,
        features: {
            clinical_cases: true,
            voice_capture: true,
            soap_notes: true,
            ask_vetios: true,
            datasets: true,
            model_trust: true,
            console: true,
        },
    },
    {
        key: 'developer',
        displayName: 'Developer',
        description: 'API access, webhooks, SDK usage, sandbox credentials, and rate limits.',
        monthlyDiagnosisLimit: null,
        monthlyPriceUsd: 149,
        recommendedFor: 'PIMS, telehealth, lab, and platform integrations.',
        cta: 'Start Developer',
        custom: false,
        features: {
            clinical_cases: true,
            voice_capture: true,
            soap_notes: true,
            ask_vetios: true,
            console: true,
            api: true,
            webhooks: true,
            developer_portal: true,
        },
    },
    {
        key: 'federation',
        displayName: 'Federation Partner',
        description: 'Shared learning networks for schools, NGOs, governments, and surveillance groups.',
        monthlyDiagnosisLimit: null,
        monthlyPriceUsd: null,
        recommendedFor: 'Multi-site surveillance and public-interest networks.',
        cta: 'Contact VetIOS',
        custom: true,
        features: {
            clinical_cases: true,
            voice_capture: true,
            soap_notes: true,
            ask_vetios: true,
            console: true,
            api: true,
            federation: true,
            edge_box: true,
            network_learning: true,
        },
    },
    {
        key: 'enterprise',
        displayName: 'Enterprise',
        description: 'Custom infrastructure, private deployment, governance, and SLA terms.',
        monthlyDiagnosisLimit: null,
        monthlyPriceUsd: null,
        recommendedFor: 'Organizations needing private or governed infrastructure.',
        cta: 'Contact VetIOS',
        custom: true,
        features: {
            clinical_cases: true,
            voice_capture: true,
            soap_notes: true,
            ask_vetios: true,
            console: true,
            api: true,
            federation: true,
            custom_sla: true,
        },
    },
];

export const DEFAULT_PRODUCT_PLAN_KEY: ProductPlanKey = 'free';

export function getProductPlan(planKey: string | null | undefined): ProductPlan {
    return PRODUCT_PLANS.find((plan) => plan.key === planKey) ?? PRODUCT_PLANS[0]!;
}

export function isProductPlanKey(value: string | null | undefined): value is ProductPlanKey {
    return PRODUCT_PLANS.some((plan) => plan.key === value);
}

export function canAccessConsole(planKey: string | null | undefined): boolean {
    const plan = getProductPlan(planKey);
    return plan.features.console === true
        || plan.features.api === true
        || plan.features.federation === true;
}

export function formatPlanLimit(limit: number | null): string {
    return limit == null ? 'Unlimited diagnoses' : `${limit.toLocaleString()} diagnoses/month`;
}

export function formatPlanPrice(plan: ProductPlan): string {
    if (plan.monthlyPriceUsd == null) return 'Custom';
    if (plan.monthlyPriceUsd === 0) return 'Free';
    return `$${plan.monthlyPriceUsd}/month`;
}
