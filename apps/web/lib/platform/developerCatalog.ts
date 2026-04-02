export interface DeveloperEndpointDefinition {
    id: string;
    method: 'GET' | 'POST';
    path: string;
    auth: 'session' | 'service_account' | 'connector_key' | 'public';
    readiness: 'live' | 'internal_only' | 'public';
    purpose: string;
    notes: string[];
    samplePayload?: Record<string, unknown>;
}

export const developerEndpoints: DeveloperEndpointDefinition[] = [
    {
        id: 'inference',
        method: 'POST',
        path: '/api/inference',
        auth: 'service_account',
        readiness: 'live',
        purpose: 'Execute routed veterinary inference and return differentials, uncertainty, telemetry, and lineage.',
        notes: [
            'Registry-aware route planning and telemetry are already applied in the request path.',
            'Supports scoped machine credentials for partner or server-to-server inference.',
        ],
        samplePayload: {
            model: { name: 'VetIOS Diagnostics', version: 'latest' },
            input: {
                input_signature: {
                    species: 'Canis lupus familiaris',
                    breed: 'Golden Retriever',
                    symptoms: ['lethargy', 'vomiting'],
                    metadata: { age_years: 4 },
                },
            },
        },
    },
    {
        id: 'outcome',
        method: 'POST',
        path: '/api/outcome',
        auth: 'service_account',
        readiness: 'live',
        purpose: 'Attach clinician-grounded outcomes to prior inference events and feed the learning loop.',
        notes: [
            'This is the core data-flywheel closeout surface.',
        ],
        samplePayload: {
            inference_event_id: 'uuid-of-prior-inference',
            outcome: {
                type: 'confirmed_diagnosis',
                payload: {
                    confirmed_diagnosis: 'Pancreatitis',
                    primary_condition_class: 'gastrointestinal',
                },
                timestamp: '2026-04-01T00:00:00.000Z',
            },
        },
    },
    {
        id: 'simulate',
        method: 'POST',
        path: '/api/simulate',
        auth: 'service_account',
        readiness: 'live',
        purpose: 'Run adversarial or boundary-condition simulations through the inference pipeline.',
        notes: [
            'Useful for safety regression and failure probing before promotion.',
        ],
        samplePayload: {
            simulation: {
                type: 'adversarial_case',
                parameters: {
                    target_disease: 'Canine Distemper',
                    edge_cases: 'hypothermia + fever',
                },
            },
            inference: {
                model: 'VetIOS Diagnostics',
                model_version: 'latest',
            },
        },
    },
    {
        id: 'evaluation',
        method: 'POST',
        path: '/api/evaluation',
        auth: 'service_account',
        readiness: 'live',
        purpose: 'Create evaluation events for confidence calibration and model review.',
        notes: [
            'Feeds model assessment and governance review workflows.',
        ],
        samplePayload: {
            inference_event_id: 'uuid-of-prior-inference',
            model_name: 'VetIOS Diagnostics',
            model_version: 'latest',
            predicted_confidence: 0.82,
            trigger_type: 'inference',
        },
    },
    {
        id: 'signals-connect',
        method: 'POST',
        path: '/api/signals/connect',
        auth: 'connector_key',
        readiness: 'internal_only',
        purpose: 'Normalize passive vendor connector payloads and attach them to episodes.',
        notes: [
            'Supports lab results, refills, rechecks, referrals, and imaging reports today.',
            'Supports connector installations and machine credentials, with the older shared-secret path still present for legacy traffic.',
        ],
        samplePayload: {
            connector: {
                connector_type: 'lab_result',
                clinic_id: 'clinic_123',
                patient_id: '00000000-0000-0000-0000-000000000000',
                vendor_name: 'IDEXX',
                payload: {
                    analyte: 'ALT',
                    value: 145,
                    units: 'U/L',
                    abnormal: true,
                },
            },
        },
    },
    {
        id: 'public-model-cards',
        method: 'GET',
        path: '/api/public/model-cards',
        auth: 'public',
        readiness: 'public',
        purpose: 'Read-only public registry and governance catalog.',
        notes: [
            'Designed for transparency and external trust review.',
        ],
    },
    {
        id: 'public-network-learning',
        method: 'GET',
        path: '/api/public/network-learning',
        auth: 'public',
        readiness: 'public',
        purpose: 'Read-only learning-loop health and dataset compounding snapshot.',
        notes: [
            'Summarizes dataset versions, benchmark runs, calibration reports, and audit activity.',
        ],
    },
];
