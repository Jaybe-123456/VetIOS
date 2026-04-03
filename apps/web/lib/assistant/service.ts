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
    const deterministicReply = buildDeterministicAssistantReply(input);
    const routeContext = resolveAssistantRouteContext(input.pathname);
    const onboarding = getAssistantOnboardingProgress(input.visitedPaths);

    try {
        const apiKey = getAiProviderApiKey();
        const aiReply = await fetchAiAssistantReply({
            apiKey,
            input,
            routeContext,
            onboarding,
            deterministicReply,
        });

        return {
            ...deterministicReply,
            answer: aiReply.answer || deterministicReply.answer,
            next_steps: aiReply.next_steps.length > 0 ? aiReply.next_steps : deterministicReply.next_steps,
            suggested_actions: mergeActions(aiReply.suggested_actions, deterministicReply.suggested_actions).slice(0, 3),
            mode: 'ai',
        };
    } catch {
        return {
            ...deterministicReply,
            mode: 'fallback',
        };
    }
}

async function fetchAiAssistantReply({
    apiKey,
    input,
    routeContext,
    onboarding,
    deterministicReply,
}: {
    apiKey: string;
    input: AssistantQueryInput;
    routeContext: ReturnType<typeof resolveAssistantRouteContext>;
    onboarding: ReturnType<typeof getAssistantOnboardingProgress>;
    deterministicReply: AssistantReply;
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
                        deterministic_baseline: {
                            answer: deterministicReply.answer,
                            next_steps: deterministicReply.next_steps,
                            suggested_actions: deterministicReply.suggested_actions,
                        },
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

function buildDeterministicAssistantReply(input: AssistantQueryInput): AssistantReply {
    const currentRoute = resolveAssistantRouteContext(input.pathname);
    const onboarding = getAssistantOnboardingProgress(input.visitedPaths);
    const normalizedMessage = input.message.trim().toLowerCase();
    const intent = detectIntent(normalizedMessage);
    const targetRoute = resolveTargetRoute(normalizedMessage, currentRoute, intent);
    const answer = buildOperationalAnswer({
        currentRoute,
        targetRoute,
        intent,
        onboarding,
    });
    const nextSteps = buildOperationalSteps({
        currentRoute,
        targetRoute,
        intent,
        onboarding,
    });
    const suggestedActions = buildOperationalActions({
        currentRoute,
        targetRoute,
        intent,
        onboarding,
    });

    return {
        answer,
        next_steps: nextSteps,
        suggested_actions: suggestedActions,
        route_context: {
            key: targetRoute.key,
            title: targetRoute.title,
            summary: targetRoute.summary,
            href: targetRoute.href,
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

type AssistantIntent =
    | 'explain'
    | 'start'
    | 'navigate'
    | 'compare'
    | 'promote'
    | 'troubleshoot'
    | 'ground_truth'
    | 'admin'
    | 'workflow';

function detectIntent(query: string): AssistantIntent {
    if (/ground truth|actual diagnosis|outcome|confirm diagnosis/.test(query)) {
        return 'ground_truth';
    }

    if (/compare|comparison|benchmark|reproduc|evaluate|which run|best run/.test(query)) {
        return 'compare';
    }

    if (/promote|promotion|registry|ship model|trust this model|ready for deployment/.test(query)) {
        return 'promote';
    }

    if (/issue|failing|failure|drift|latency|unhealthy|debug|problem|wrong/.test(query)) {
        return 'troubleshoot';
    }

    if (/settings|permission|access|admin|petpass|federation|developer platform|credentials|api key/.test(query)) {
        return 'admin';
    }

    if (/where|which page|take me|go to|navigate|open/.test(query)) {
        return 'navigate';
    }

    if (/where do i start|what should i do next|first step|new user|onboard|begin|how do i use|help me use|first time/.test(query)) {
        return 'start';
    }

    if (/explain|what does|what is|what am i looking at|help me understand|meaning/.test(query)) {
        return 'explain';
    }

    return 'workflow';
}

function resolveTargetRoute(
    query: string,
    currentRoute: ReturnType<typeof resolveAssistantRouteContext>,
    intent: AssistantIntent,
) {
    const explicitRoute = resolveExplicitRouteMatch(query);
    if (explicitRoute) {
        return explicitRoute;
    }

    const relevantRoutes = searchRelevantAssistantRoutes(query);
    if (relevantRoutes[0]) {
        return relevantRoutes[0];
    }

    if (intent === 'ground_truth') {
        return resolveRouteByKey('outcome-learning') ?? currentRoute;
    }

    if (intent === 'compare') {
        return resolveRouteByKey('experiments') ?? currentRoute;
    }

    if (intent === 'promote') {
        return resolveRouteByKey('models') ?? currentRoute;
    }

    if (intent === 'troubleshoot') {
        return resolveRouteByKey('telemetry') ?? currentRoute;
    }

    if (intent === 'admin') {
        return resolveRouteByKey('settings') ?? currentRoute;
    }

    return currentRoute;
}

function resolveExplicitRouteMatch(query: string) {
    const explicitMatches: Array<{ pattern: RegExp; key: string }> = [
        { pattern: /dashboard|overview|control plane/, key: 'dashboard' },
        { pattern: /inference|diagnosis|triage|clinical input|case/, key: 'inference' },
        { pattern: /outcome|ground truth|actual diagnosis/, key: 'outcome-learning' },
        { pattern: /simulate|simulation|adversarial/, key: 'simulate' },
        { pattern: /dataset|data|artifact|record/, key: 'dataset' },
        { pattern: /experiment|compare runs|run comparison|reproduc|benchmark/, key: 'experiments' },
        { pattern: /model registry|model version|promotion|registry/, key: 'models' },
        { pattern: /telemetry|latency|drift|observer|logs/, key: 'telemetry' },
        { pattern: /network|topology|dependency graph|intelligence graph/, key: 'intelligence' },
        { pattern: /settings|petpass|federation|developer platform|edge box|outbox|permissions|credentials/, key: 'settings' },
    ];

    const match = explicitMatches.find((candidate) => candidate.pattern.test(query));
    return match ? resolveRouteByKey(match.key) : null;
}

function resolveRouteByKey(key: string) {
    return listAssistantRouteContexts().find((route) => route.key === key) ?? null;
}

function buildOperationalAnswer({
    currentRoute,
    targetRoute,
    intent,
    onboarding,
}: {
    currentRoute: ReturnType<typeof resolveAssistantRouteContext>;
    targetRoute: ReturnType<typeof resolveAssistantRouteContext>;
    intent: AssistantIntent;
    onboarding: ReturnType<typeof getAssistantOnboardingProgress>;
}): string {
    const moveToTargetPrefix = targetRoute.href !== currentRoute.href
        ? `For that job, move from ${currentRoute.title} to ${targetRoute.title}. `
        : '';

    switch (targetRoute.key) {
        case 'dashboard':
            if (intent === 'troubleshoot') {
                return `${moveToTargetPrefix}Use the dashboard to identify what is failing and where to investigate next. It is the triage surface for the control plane, not the place to do deep analysis.`;
            }
            return `${moveToTargetPrefix}${targetRoute.title} is the fastest place to understand overall system state. A new operator should use it to decide whether to pivot into Telemetry, Network, or a workflow surface like Inference.`;
        case 'inference':
            return `${moveToTargetPrefix}Inference Console is where new users become productive fastest. The clean path is structured input, normalized preview, confirmed submission, then result review across vectors and diagnostics before any ground-truth attachment.`;
        case 'outcome-learning':
            return `${moveToTargetPrefix}Outcome Learning is where VetIOS stops being a one-way predictor and starts learning from reality. Use it after an inference event when you have a confirmed diagnosis or outcome that should feed calibration and downstream review.`;
        case 'simulate':
            return `${moveToTargetPrefix}Adversarial Sim is for controlled failure exploration. Use it when you want to see how a model behaves under contradiction, stress, or unusual edge conditions before trusting it in deployment or promotion decisions.`;
        case 'dataset':
            return `${moveToTargetPrefix}Clinical Dataset is the evidence surface behind the rest of the platform. Review what cases and artifacts exist here before assuming you have enough signal for experiments, comparisons, or promotion decisions.`;
        case 'experiments':
            if (intent === 'compare') {
                return `${moveToTargetPrefix}Experiment Track is the right place to compare runs and verify model claims. Start by selecting comparable runs, then review calibration, robustness, and comparison evidence before you treat a result as promotion-ready.`;
            }
            return `${moveToTargetPrefix}Experiment Track is the reproducible AI research stack in VetIOS. It is where dataset versions, hyperparameters, model lineage, and comparison evidence come together so results can be rerun and defended.`;
        case 'models':
            if (intent === 'promote') {
                return `${moveToTargetPrefix}Model Registry is where trust and promotion decisions happen. Use it to verify lineage, readiness, and governance status before a version is treated as deployable.`;
            }
            return `${moveToTargetPrefix}Model Registry turns experiment outputs into governed artifacts. It matters when you need to answer which version exists, where it came from, and whether it is safe to trust operationally.`;
        case 'telemetry':
            return `${moveToTargetPrefix}Telemetry is the operational truth surface for drift, latency, observer state, and failure signals. It should be your first deep-dive page when the system feels unhealthy or a model starts behaving unexpectedly.`;
        case 'intelligence':
            return `${moveToTargetPrefix}Network explains how dependencies connect across VetIOS. Use it when the question is not just what failed, but how that failure propagates through models, flows, and operational relationships.`;
        case 'settings':
            return `${moveToTargetPrefix}Settings is the administrative control plane. Treat it as the place for identity, credentials, subsystem operations, and policy changes after you already know which subsystem you are trying to operate.`;
        default:
            return `${moveToTargetPrefix}${targetRoute.summary}`;
    }
}

function buildOperationalSteps({
    currentRoute,
    targetRoute,
    intent,
    onboarding,
}: {
    currentRoute: ReturnType<typeof resolveAssistantRouteContext>;
    targetRoute: ReturnType<typeof resolveAssistantRouteContext>;
    intent: AssistantIntent;
    onboarding: ReturnType<typeof getAssistantOnboardingProgress>;
}): string[] {
    const baseSteps = targetRoute.recommended_steps.slice(0, 3);

    if (targetRoute.key === 'inference') {
        return [
            'Choose structured input first so species, breed, symptoms, and metadata normalize cleanly.',
            'Review the normalized preview before submitting so the first result is trustworthy.',
            'After the result returns, inspect vectors and diagnostics, then attach ground truth if a confirmed outcome exists.',
        ];
    }

    if (targetRoute.key === 'experiments') {
        return [
            'Select a run family or a comparable run pair before interpreting anything.',
            'Review calibration, robustness, and comparison evidence instead of only looking at one headline metric.',
            'Move strong results into Model Registry only after the run has enough reproducible evidence behind it.',
        ];
    }

    if (targetRoute.key === 'models') {
        return [
            'Trace the artifact back to the experiment that produced it.',
            'Review governance and readiness signals before treating the version as trusted.',
            'Use Telemetry if you need to confirm how the version behaves under real operational load.',
        ];
    }

    if (targetRoute.key === 'telemetry') {
        return [
            'Start with latency, drift, and observer state to classify the issue quickly.',
            'Use failure telemetry and the log stream to isolate a repeatable pattern.',
            'Move back to Dashboard or Model Registry once you know whether the issue is systemic or model-specific.',
        ];
    }

    if (intent === 'start' && onboarding.nextRoute && onboarding.nextRoute.href !== currentRoute.href && onboarding.nextRoute.href !== targetRoute.href) {
        return [...baseSteps.slice(0, 2), `After that, continue into ${onboarding.nextRoute.title} to keep the onboarding path moving.`];
    }

    return baseSteps;
}

function buildOperationalActions({
    currentRoute,
    targetRoute,
    intent,
    onboarding,
}: {
    currentRoute: ReturnType<typeof resolveAssistantRouteContext>;
    targetRoute: ReturnType<typeof resolveAssistantRouteContext>;
    intent: AssistantIntent;
    onboarding: ReturnType<typeof getAssistantOnboardingProgress>;
}): AssistantAction[] {
    const actions: AssistantAction[] = [];

    if (targetRoute.href !== currentRoute.href) {
        actions.push({
            type: 'navigate',
            label: `Open ${targetRoute.title}`,
            description: `Move to ${targetRoute.title} for this workflow.`,
            href: targetRoute.href,
        });
    }

    if (intent === 'start' && onboarding.nextRoute && onboarding.nextRoute.href !== currentRoute.href) {
        actions.push({
            type: 'navigate',
            label: `Next: ${onboarding.nextRoute.title}`,
            description: 'Follow the next recommended onboarding module.',
            href: onboarding.nextRoute.href,
        });
    }

    if (targetRoute.key === 'experiments') {
        actions.push({
            type: 'prompt',
            label: 'Compare Runs',
            description: 'Ask for a practical run comparison workflow.',
            prompt: 'Show me how to compare runs in Experiment Track as a new operator.',
        });
    }

    if (targetRoute.key === 'inference') {
        actions.push({
            type: 'prompt',
            label: 'First Inference',
            description: 'Get the shortest first-case workflow.',
            prompt: 'Guide me through my first inference run step by step.',
        });
    }

    if (targetRoute.key === 'telemetry') {
        actions.push({
            type: 'prompt',
            label: 'Read Telemetry',
            description: 'Translate telemetry panels into plain language.',
            prompt: 'Explain how to read the key telemetry panels as a new operator.',
        });
    }

    actions.push(...targetRoute.suggested_actions);

    return mergeActions(actions).slice(0, 3);
}
