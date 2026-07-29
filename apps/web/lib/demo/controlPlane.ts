export type DemoEvidenceState = 'live' | 'demo_fixture' | 'not_configured';
export type DemoStage = 'clinical' | 'outcome' | 'sovereignty' | 'amr';

export interface DemoDifferential {
    label: string;
    probability: number;
    urgency: 'high' | 'medium' | 'low';
}

export interface DemoCalibrationPreview {
    outcome_attached: boolean;
    predicted_probability: number;
    observed_target: number | null;
    calibration_residual: number | null;
    materialization_status: 'pending' | 'blocked';
    evidence_eligible: false;
    block_reason: string;
    persisted: false;
}

export const DEMO_CONTROL_PLANE_CASE = {
    case_id: 'demo-case-amr-001',
    inference_event_id: 'demo-inference-amr-001',
    outcome_event_id: 'demo-outcome-amr-001',
    tenant_label: 'Public browser fixture',
    node_id: 'clinic-demo-node-01',
    patient: {
        species: 'Canine',
        breed: 'Mixed breed',
        age: '7 years',
        sex: 'Female spayed',
        presentation: 'Recurrent dysuria, pollakiuria, fever, lumbar discomfort, and reduced appetite.',
        history: 'Two urinary episodes in six months; culture and susceptibility requested before definitive therapy.',
        laboratory_context: 'Urinalysis: pyuria and bacteriuria. Culture pending at inference time.',
    },
    inference: {
        model_name: 'vetios-demo-fixture',
        model_version: 'browser-v1',
        route_mode: 'single',
        provider_request_sent: false,
        fallback_used: false,
        confidence: 0.73,
        differentials: [
            { label: 'bacterial_pyelonephritis', probability: 0.73, urgency: 'high' },
            { label: 'complicated_bacterial_cystitis', probability: 0.52, urgency: 'medium' },
            { label: 'urolithiasis', probability: 0.24, urgency: 'medium' },
        ] satisfies DemoDifferential[],
        recommended_tests: [
            'Urine culture and antimicrobial susceptibility',
            'Renal biochemistry panel',
            'Urinary tract ultrasonography',
        ],
        cire: {
            phi_hat: 0.68,
            phi_hat_semantics: 'differential_concentration_not_correctness',
            cps: 0.23,
            cps_semantics: 'runtime_perturbation_pressure',
            input_impairment: 0.12,
            safety_state: 'review_required',
            conformance_state: 'demo_fixture_not_certified',
        },
    },
    outcome: {
        day: 2,
        confirmed_label: 'Bacterial pyelonephritis associated with Escherichia coli',
        authority: 'culture_ast_demo_fixture',
        follow_up_day: 7,
        follow_up: 'Clinical signs improved in the synthetic fixture after clinician-directed care.',
        synthetic: true,
        evidence_grade: false,
    },
    culture: {
        specimen: 'Urine, cystocentesis',
        organism: 'Escherichia coli',
        quantity: '>=100,000 CFU/mL',
        interpretation_source: 'Synthetic laboratory fixture',
        susceptibility: [
            { antimicrobial: 'Amoxicillin-clavulanate', interpretation: 'S' },
            { antimicrobial: 'Trimethoprim-sulfamethoxazole', interpretation: 'S' },
            { antimicrobial: 'Cefpodoxime', interpretation: 'I' },
            { antimicrobial: 'Enrofloxacin', interpretation: 'R' },
        ],
    },
    sovereignty: {
        protocol: 'x25519_hkdf_pairwise_masked_v1',
        protocol_state: 'demo_fixture_not_executed',
        key_version: 'demo-key-v1',
        raw_record: {
            case_id: 'demo-case-amr-001',
            patient_ref: 'demo-patient-01',
            species: 'canine',
            presentation: [
                'dysuria',
                'pollakiuria',
                'fever',
                'lumbar discomfort',
                'reduced appetite',
            ],
            free_text_history: 'Two urinary episodes in six months.',
            culture: {
                organism: 'Escherichia coli',
                quantity_cfu_ml: 100000,
                enrofloxacin: 'R',
            },
            confirmed_outcome: 'bacterial_pyelonephritis',
        },
        outbound_packet: {
            schema: 'vetios_masked_model_delta_commitment_v1',
            protocol: 'x25519_hkdf_pairwise_masked_v1',
            key_version: 'demo-key-v1',
            masked_integer_vector: {
                'dx:bacterial_pyelonephritis': 7312,
                'ast:enrofloxacin_resistant': -1844,
                'outcome:confirmed': 4096,
            },
            raw_records_included: false,
            raw_delta_included: false,
            encrypted_unmask_share_envelope_count: 2,
            submission_state: 'not_submitted_demo_fixture',
        },
        retained_locally: [
            'Patient reference',
            'Free-text clinical history',
            'Raw culture record',
            'Raw local model delta',
        ],
        outbound_fields: [
            'Masked integer vector',
            'Protocol and key version',
            'Commitment digest',
            'Encrypted unmask-share envelope count',
        ],
    },
    amr: {
        case_signal: 'Fluoroquinolone resistance phenotype in the supplied culture fixture',
        stewardship_state: 'clinician_review_required',
        regional_surveillance_state: 'not_configured',
        external_source_state: 'not_asserted',
        aggregate_counts: null,
        prescribing_recommendation: null,
    },
} as const;

export const DEMO_STAGE_LABELS: Record<DemoStage, {
    label: string;
    short_label: string;
}> = {
    clinical: {
        label: 'Clinical inference and CIRE',
        short_label: 'Inference',
    },
    outcome: {
        label: 'Outcome and calibration',
        short_label: 'Outcome',
    },
    sovereignty: {
        label: 'Node sovereignty',
        short_label: 'Sovereignty',
    },
    amr: {
        label: 'AMR network context',
        short_label: 'AMR',
    },
};

export function buildDemoCalibrationPreview(
    outcomeAttached: boolean,
): DemoCalibrationPreview {
    const predictedProbability = DEMO_CONTROL_PLANE_CASE.inference.confidence;
    if (!outcomeAttached) {
        return {
            outcome_attached: false,
            predicted_probability: predictedProbability,
            observed_target: null,
            calibration_residual: null,
            materialization_status: 'pending',
            evidence_eligible: false,
            block_reason: 'Attach the synthetic culture outcome to preview the evidence gate.',
            persisted: false,
        };
    }

    return {
        outcome_attached: true,
        predicted_probability: predictedProbability,
        observed_target: 1,
        calibration_residual: roundDemoNumber(1 - predictedProbability),
        materialization_status: 'blocked',
        evidence_eligible: false,
        block_reason: 'Synthetic public demo outcomes are excluded from calibration and learning ledgers.',
        persisted: false,
    };
}

export function stableSerializeDemoValue(value: unknown): string {
    return JSON.stringify(sortDemoValue(value), null, 2);
}

function sortDemoValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortDemoValue);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, sortDemoValue(entry)]),
    );
}

function roundDemoNumber(value: number): number {
    return Math.round(value * 1000) / 1000;
}
