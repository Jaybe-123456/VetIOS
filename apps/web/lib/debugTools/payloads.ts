export function buildInferenceTestPayload() {
    return {
        model: { name: 'gpt-4o-mini', version: '1.0.0' },
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
                confirmed_diagnosis: 'Parvovirus',
                primary_condition_class: 'infectious',
                emergency_level: 'urgent',
            },
            timestamp: new Date().toISOString(),
        },
    };
}

export function buildEvaluationTestPayload(inferenceEventId?: string | null) {
    return {
        ...(inferenceEventId ? { inference_event_id: inferenceEventId } : {}),
        model_name: 'VetIOS Diagnostics',
        model_version: '1.0.0',
        predicted_confidence: 0.82,
        trigger_type: 'inference',
    };
}
