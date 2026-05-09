export interface LabPanelRecommendation {
    panel_code: string;
    rationale?: string;
    priority?: string;
    estimated_diagnostic_lift?: number;
}

export interface LabOrderPayloadInput {
    recommendationId: string;
    inferenceEventId: string;
    patientId: string | null;
    panels: LabPanelRecommendation[];
    vendor: string | null;
    mode: 'auto' | 'manual';
}

export function shouldAutoOrderLabs(input: {
    enabled: boolean;
    agentConfidence: number | null;
    panels: LabPanelRecommendation[];
    threshold: number;
}) {
    if (!input.enabled) return false;
    if ((input.agentConfidence ?? 0) < input.threshold) return false;
    return input.panels.some((panel) => panel.priority === 'high' || (panel.estimated_diagnostic_lift ?? 0) >= 0.16);
}

export function buildLabOrderPayload(input: LabOrderPayloadInput) {
    return {
        lab_recommendation_id: input.recommendationId,
        inference_event_id: input.inferenceEventId,
        patient_id: input.patientId,
        vendor: input.vendor ?? 'default_lab_connector',
        ordering_mode: input.mode,
        panels: input.panels.map((panel) => ({
            panel_code: panel.panel_code,
            priority: panel.priority ?? 'routine',
            rationale: panel.rationale ?? 'Recommended by VetIOS lab ordering agent.',
            estimated_diagnostic_lift: panel.estimated_diagnostic_lift ?? null,
        })),
    };
}
