export function buildInferenceTestPayload() {
    return {
        model: { name: 'VetIOS Diagnostics', version: 'latest' },
        input: {
            input_signature: {
                species: 'Canis lupus familiaris',
                breed: 'Golden Retriever',
                symptoms: ['lethargy', 'fever', 'loss of appetite'],
                metadata: {
                    source: 'debug_tools',
                },
            },
        },
    };
}

export function buildOutcomeTestPayload(inferenceEventId: string) {
    return {
        inference_event_id: inferenceEventId,
        outcome: {
            type: 'confirmed_diagnosis',
            payload: {
                label: 'canine_parvovirus',
                confidence: 0.98,
                confirmed_diagnosis: 'canine_parvovirus',
                primary_condition_class: 'infectious',
                emergency_level: 'urgent',
            },
            timestamp: new Date().toISOString(),
        },
    };
}

export function buildSimulateTestPayload() {
    return {
        steps: 5,
        mode: 'adaptive',
        base_case: {
            species: 'canine',
            breed: 'mixed',
            symptoms: ['fever', 'lethargy', 'nasal discharge', 'cough'],
            metadata: {
                target_disease: 'canine_distemper',
                edge_cases: ['hypothermia_plus_fever', 'juvenile_large_weight_contradiction'],
                contradictions: {
                    age_months: 2,
                    weight_kg: 80,
                },
                labs: {
                    wbc: 3.8,
                    lymphocytes: 0.7,
                },
                source: 'debug_tools',
            },
        },
        inference: {
            model: 'VetIOS Diagnostics',
            model_version: 'latest',
        },
    };
}

export function buildEvaluationTestPayload(inferenceEventId?: string | null) {
    return {
        ...(inferenceEventId ? { inference_event_id: inferenceEventId } : {}),
        model_name: 'VetIOS Diagnostics',
        model_version: 'aggregate',
        predicted_confidence: 0.82,
        trigger_type: 'inference',
    };
}
