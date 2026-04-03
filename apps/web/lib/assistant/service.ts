import {
    getAiProviderApiKey,
    getAiProviderBaseUrl,
    getAiProviderDefaultModel,
} from '@/lib/ai/config';
import {
    getAssistantOnboardingProgress,
    listAssistantRouteContexts,
    resolveAssistantRouteContext,
    searchRelevantAssistantRoutes,
} from '@/lib/assistant/routeContext';
import type {
    AssistantAction,
    AssistantConversationMessage,
    AssistantReply,
} from '@/lib/assistant/types';

interface AssistantQueryInput {
    message: string;
    pathname: string;
    visitedPaths: string[];
    conversation: AssistantConversationMessage[];
    tenantId: string;
    userEmail: string | null;
}

interface RawAssistantPayload {
    answer?: unknown;
    next_steps?: unknown;
    suggested_actions?: unknown;
}

export async function answerAssistantQuery(input: AssistantQueryInput): Promise<AssistantReply> {
    const routeContext = resolveAssistantRouteContext(input.pathname);
    const onboarding = getAssistantOnboardingProgress(input.visitedPaths);

    try {
        const apiKey = getAiProviderApiKey();
        const aiReply = await fetchAiAssistantReply({
            apiKey,
            input,
            routeContext,
            onboarding,
        });

        return {
            answer: aiReply.answer,
            next_steps: aiReply.next_steps,
            suggested_actions: aiReply.suggested_actions,
            route_context: {
                key: routeContext.key,
                title: routeContext.title,
                summary: routeContext.summary,
                href: routeContext.href,
            },
            onboarding: {
                visited_modules: onboarding.visitedCount,
                total_modules: onboarding.totalCount,
                next_module_title: onboarding.nextRoute?.title ?? null,
                next_module_href: onboarding.nextRoute?.href ?? null,
            },
            mode: 'ai',
        };
    } catch {
        const fallback = buildFallbackAssistantReply(input);
        return {
            ...fallback,
            mode: 'fallback',
        };
    }
}

async function fetchAiAssistantReply({
    apiKey,
    input,
    routeContext,
    onboarding,
}: {
    apiKey: string;
    input: AssistantQueryInput;
    routeContext: ReturnType<typeof resolveAssistantRouteContext>;
    onboarding: ReturnType<typeof getAssistantOnboardingProgress>;
}): Promise<{
    answer: string;
    next_steps: string[];
    suggested_actions: AssistantAction[];
}> {
    const baseUrl = getAiProviderBaseUrl();
    const model = getAiProviderDefaultModel();
    const routeCatalog = listAssistantRouteContexts().map((route) => ({
        title: route.title,
        href: route.href,
        summary: route.summary,
        primary_goal: route.primary_goal,
        keywords: route.keywords,
    }));

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 900,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: [
                        'You are VetIOS Guide, a route-aware onboarding and workflow assistant for the VetIOS clinical intelligence console.',
                        'Your job is to help new operators become productive quickly.',
                        'You explain the current page, recommend the next 1-3 actions, and suggest the right internal route when the user is on the wrong screen.',
                        'Do not invent product capabilities, experiments, datasets, or system state that were not provided.',
                        'Keep answers concise, concrete, and action-oriented.',
                        'Respond ONLY with valid JSON and exactly these keys:',
                        '{',
                        '  "answer": string,',
                        '  "next_steps": string[],',
                        '  "suggested_actions": Array<{',
                        '    "type": "navigate" | "prompt",',
                        '    "label": string,',
                        '    "description": string,',
                        '    "href"?: string,',
                        '    "prompt"?: string',
                        '  }>',
                        '}',
                        'Rules for suggested_actions:',
                        '- Use at most 3 actions.',
                        '- Only use internal hrefs that appear in the provided route catalog or seeded actions.',
                        '- Use "navigate" when the user should move to another page.',
                        '- Use "prompt" when the next best move is another guide question.',
                    ].join('\n'),
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        user_message: input.message,
                        current_route: {
                            title: routeContext.title,
                            href: routeContext.href,
                            summary: routeContext.summary,
                            primary_goal: routeContext.primary_goal,
                            recommended_steps: routeContext.recommended_steps,
                            starter_prompts: routeContext.starter_prompts,
                            suggested_actions: routeContext.suggested_actions,
                        },
                        onboarding_progress: {
                            visited_modules: onboarding.visitedCount,
                            total_modules: onboarding.totalCount,
                            next_module: onboarding.nextRoute,
                        },
                        user_context: {
                            tenant_id: input.tenantId,
                            user_email: input.userEmail,
                        },
                        recent_conversation: input.conversation.slice(-6),
                        route_catalog: routeCatalog,
                        seeded_actions: collectAllowedActions(),
                    }),
                },
            ],
        }),
    });

    if (!response.ok) {
        throw new Error(`Assistant provider returned ${response.status}`);
    }

    const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = json.choices?.[0]?.message?.content ?? '';
    if (!rawContent) {
        throw new Error('Assistant provider returned an empty response.');
    }

    const parsed = JSON.parse(rawContent) as RawAssistantPayload;
    const sanitized = sanitizeAssistantPayload(parsed, routeContext);
    if (!sanitized.answer) {
        throw new Error('Assistant provider returned an invalid payload.');
    }

    return sanitized;
}

function buildFallbackAssistantReply(input: AssistantQueryInput): AssistantReply {
    const routeContext = resolveAssistantRouteContext(input.pathname);
    const onboarding = getAssistantOnboardingProgress(input.visitedPaths);
    const normalizedMessage = input.message.trim().toLowerCase();
    const relevantRoutes = searchRelevantAssistantRoutes(normalizedMessage);
    const topRelevantRoute = relevantRoutes[0] ?? null;
    const asksForExplanation = /explain|what does|what is|what am i looking at|help me understand/.test(normalizedMessage);
    const asksForStart = /where do i start|what should i do next|first step|new user|onboard|begin|how do i use|help me use/.test(normalizedMessage);
    const asksForNavigation = /where|which page|take me|go to|navigate|open/.test(normalizedMessage);

    let answer = `${routeContext.title} is the right place to ${lowercaseFirst(routeContext.primary_goal)} ${routeContext.summary}`;
    let nextSteps = routeContext.recommended_steps.slice(0, 3);
    const dynamicActions: AssistantAction[] = [];

    if (topRelevantRoute && topRelevantRoute.href !== routeContext.href && (asksForNavigation || asksForStart)) {
        answer = `${topRelevantRoute.title} is the best next page for that workflow. ${topRelevantRoute.summary}`;
        nextSteps = topRelevantRoute.recommended_steps.slice(0, 3);
        dynamicActions.push({
            type: 'navigate',
            label: `Open ${topRelevantRoute.title}`,
            description: `Jump to ${topRelevantRoute.title} and continue there.`,
            href: topRelevantRoute.href,
        });
    } else if (asksForExplanation) {
        answer = `${routeContext.title} is designed to ${lowercaseFirst(routeContext.primary_goal)} ${routeContext.summary}`;
    } else if (asksForStart) {
        answer = `${routeContext.summary} Start by ${lowercaseFirst(routeContext.recommended_steps[0] ?? 'reviewing the current workflow carefully')}`;
        if (onboarding.nextRoute && onboarding.nextRoute.href !== routeContext.href) {
            answer += ` After this page, move to ${onboarding.nextRoute.title} so you build a clean end-to-end understanding of VetIOS.`;
            dynamicActions.push({
                type: 'navigate',
                label: `Next: ${onboarding.nextRoute.title}`,
                description: 'Follow the next recommended onboarding module.',
                href: onboarding.nextRoute.href,
            });
        }
    }

    if (!dynamicActions.some((action) => action.type === 'prompt')) {
        dynamicActions.push({
            type: 'prompt',
            label: 'Explain This Page',
            description: 'Ask the guide to translate the current screen into plain language.',
            prompt: 'Explain this page for a new operator and tell me what matters most.',
        });
    }

    const suggestedActions = mergeActions(dynamicActions, routeContext.suggested_actions).slice(0, 3);

    return {
        answer,
        next_steps: nextSteps,
        suggested_actions: suggestedActions,
        route_context: {
            key: routeContext.key,
            title: routeContext.title,
            summary: routeContext.summary,
            href: routeContext.href,
        },
        onboarding: {
            visited_modules: onboarding.visitedCount,
            total_modules: onboarding.totalCount,
            next_module_title: onboarding.nextRoute?.title ?? null,
            next_module_href: onboarding.nextRoute?.href ?? null,
        },
        mode: 'fallback',
    };
}

function sanitizeAssistantPayload(
    payload: RawAssistantPayload,
    routeContext: ReturnType<typeof resolveAssistantRouteContext>,
): {
    answer: string;
    next_steps: string[];
    suggested_actions: AssistantAction[];
} {
    const answer = typeof payload.answer === 'string'
        ? payload.answer.trim()
        : '';
    const nextSteps = Array.isArray(payload.next_steps)
        ? payload.next_steps
            .filter((step): step is string => typeof step === 'string')
            .map((step) => step.trim())
            .filter(Boolean)
            .slice(0, 4)
        : [];
    const suggestedActions = sanitizeSuggestedActions(payload.suggested_actions, routeContext);

    return {
        answer,
        next_steps: nextSteps.length > 0 ? nextSteps : routeContext.recommended_steps.slice(0, 3),
        suggested_actions: suggestedActions,
    };
}

function sanitizeSuggestedActions(
    value: unknown,
    routeContext: ReturnType<typeof resolveAssistantRouteContext>,
): AssistantAction[] {
    if (!Array.isArray(value)) {
        return routeContext.suggested_actions.slice(0, 3);
    }

    const sanitized: AssistantAction[] = [];

    for (const item of value) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            continue;
        }

        const candidate = item as Record<string, unknown>;
        const type = candidate.type === 'navigate' || candidate.type === 'prompt'
            ? candidate.type
            : null;
        const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
        const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';

        if (!type || !label || !description) {
            continue;
        }

        if (type === 'navigate') {
            const href = normalizeAllowedHref(candidate.href);
            if (!href) {
                continue;
            }
            sanitized.push({ type, label, description, href });
        } else {
            const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
            if (!prompt) {
                continue;
            }
            sanitized.push({ type, label, description, prompt });
        }
    }

    return sanitized.length > 0
        ? mergeActions(sanitized, routeContext.suggested_actions).slice(0, 3)
        : routeContext.suggested_actions.slice(0, 3);
}

function mergeActions(...actionSets: AssistantAction[][]): AssistantAction[] {
    const merged: AssistantAction[] = [];
    const seen = new Set<string>();

    for (const actionSet of actionSets) {
        for (const action of actionSet) {
            const key = [
                action.type,
                action.href ?? '',
                action.prompt ?? '',
                action.label.toLowerCase(),
            ].join('::');

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            merged.push(action);
        }
    }

    return merged;
}

function normalizeAllowedHref(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const href = value.trim();
    if (!href.startsWith('/')) {
        return null;
    }

    return collectAllowedHrefs().has(href) ? href : null;
}

function collectAllowedHrefs(): Set<string> {
    const hrefs = new Set<string>();

    for (const route of listAssistantRouteContexts()) {
        hrefs.add(route.href);
        for (const action of route.suggested_actions) {
            if (action.type === 'navigate' && action.href) {
                hrefs.add(action.href);
            }
        }
    }

    return hrefs;
}

function collectAllowedActions(): AssistantAction[] {
    return listAssistantRouteContexts()
        .flatMap((route) => route.suggested_actions)
        .slice(0, 24);
}

function lowercaseFirst(value: string): string {
    return value.length > 0 ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
}
