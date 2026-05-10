export type AssistantActionType = 'navigate' | 'prompt';

export interface AssistantAction {
    type: AssistantActionType;
    label: string;
    description: string;
    href?: string;
    prompt?: string;
}

export interface AssistantConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface AssistantRouteSummary {
    key: string;
    title: string;
    summary: string;
    href: string;
}

export interface GuideSynapseSignal {
    label: string;
    value: string;
    tone: 'accent' | 'warning' | 'danger' | 'muted';
}

export interface GuideSynapseState {
    status: 'active' | 'degraded' | 'idle';
    route_key: string;
    title: string;
    summary: string;
    signals: GuideSynapseSignal[];
    warnings: string[];
    next_actions: string[];
    generated_at: string;
}

export interface AssistantReply {
    answer: string;
    next_steps: string[];
    suggested_actions: AssistantAction[];
    route_context: AssistantRouteSummary;
    onboarding: {
        visited_modules: number;
        total_modules: number;
        next_module_title: string | null;
        next_module_href: string | null;
    };
    mode: 'ai' | 'fallback';
    synapse?: GuideSynapseState;
}
