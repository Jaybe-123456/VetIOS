import {
    validateCireConformanceReport,
    type CireConformanceReport,
    type CireConformanceResult,
} from '@vetios/cire-engine';
import {
    CIRE_CONFORMANCE_API_PATH,
    CIRE_STANDARD_API_PATH,
    CIRE_STANDARD_VERSION,
} from './standard';

export interface CirePublicConformanceArtifact {
    artifact_key: 'vetios-cire-conformance-v1';
    standard_version: typeof CIRE_STANDARD_VERSION;
    standard_url: string;
    conformance_url: string;
    report: CireConformanceReport;
    validation: CireConformanceResult;
    generated_at: string;
}

export const CIRE_CONFORMANCE_REPORT: CireConformanceReport = {
    standard_version: CIRE_STANDARD_VERSION,
    implementation: {
        name: '@vetios/cire-engine',
        version: CIRE_STANDARD_VERSION,
        url: 'https://github.com/Jaybe-123456/VetIOS/tree/main/packages/cire-engine',
    },
    differential_cases: [
        {
            id: 'peaked-binary-vector',
            probabilities: [1, 0],
            expected_phi_hat: 1,
            tolerance: 0.000001,
        },
        {
            id: 'uniform-binary-vector',
            probabilities: [0.5, 0.5],
            expected_phi_hat: 0,
            tolerance: 0.000001,
        },
        {
            id: 'skewed-binary-vector',
            probabilities: [0.8, 0.2],
            expected_phi_hat: 0.278072,
            tolerance: 0.000001,
        },
    ],
    input_cases: [
        {
            id: 'complete-canine-input',
            input: {
                species: 'canine',
                breed: 'German Shepherd',
                symptoms: ['fever', 'lethargy'],
                urgency: 'urgent',
                region: 'Kenya',
                biomarkers: {
                    temperature_c: 39.4,
                },
            },
            expected_input_m_hat: 0,
            tolerance: 0.000001,
        },
        {
            id: 'contradictory-species-breed-input',
            input: {
                species: 'feline',
                breed: 'German Shepherd',
                symptoms: ['fever'],
                urgency: 'routine',
                region: 'Kenya',
            },
            min_input_m_hat: 0.05,
            max_input_m_hat: 0.2,
        },
    ],
    cps_cases: [
        {
            id: 'nominal-cps',
            phi_hat: 0.9,
            delta_rolling: 0,
            sigma_delta: 0,
            phi0: 1,
            expected_cps: 0.04,
            expected_safety_state: 'nominal',
            expected_reliability_badge: 'HIGH',
            tolerance: 0.000001,
        },
        {
            id: 'warning-cps',
            phi_hat: 0.35,
            delta_rolling: 0,
            sigma_delta: 0,
            phi0: 1,
            expected_cps: 0.26,
            expected_safety_state: 'warning',
            expected_reliability_badge: 'REVIEW',
            tolerance: 0.000001,
        },
        {
            id: 'critical-cps',
            phi_hat: 0.1,
            delta_rolling: -0.5,
            sigma_delta: 0,
            phi0: 1,
            expected_cps: 0.535,
            expected_safety_state: 'critical',
            expected_reliability_badge: 'CAUTION',
            tolerance: 0.000001,
        },
        {
            id: 'blocked-cps',
            phi_hat: 0.1,
            delta_rolling: -0.8,
            sigma_delta: 0.5,
            phi0: 1,
            expected_cps: 0.765,
            expected_safety_state: 'blocked',
            expected_reliability_badge: 'SUPPRESSED',
            tolerance: 0.000001,
        },
    ],
    output_vector_cases: [
        {
            id: 'diagnosis-top-differentials-extraction',
            output: {
                diagnosis: {
                    top_differentials: [
                        { condition: 'ehrlichiosis', probability: 0.97 },
                        { condition: 'anaplasmosis', probability: 0.03 },
                    ],
                },
            },
            preferred_path: 'diagnosis.top_differentials',
            expected_vector: [0.97, 0.03],
        },
    ],
};

function absoluteUrl(baseUrl: string, path: string): string {
    return new URL(path, baseUrl).toString();
}

export function getCirePublicConformanceArtifact(baseUrl = 'https://www.vetios.tech'): CirePublicConformanceArtifact {
    return {
        artifact_key: 'vetios-cire-conformance-v1',
        standard_version: CIRE_STANDARD_VERSION,
        standard_url: absoluteUrl(baseUrl, CIRE_STANDARD_API_PATH),
        conformance_url: absoluteUrl(baseUrl, CIRE_CONFORMANCE_API_PATH),
        report: CIRE_CONFORMANCE_REPORT,
        validation: validateCireConformanceReport(CIRE_CONFORMANCE_REPORT),
        generated_at: new Date().toISOString(),
    };
}
