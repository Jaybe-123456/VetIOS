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
}
