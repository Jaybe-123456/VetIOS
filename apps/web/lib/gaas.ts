/**
 * GaaS Platform — Singleton Instance
 *
 * Bootstraps the GaaS runtime once per Next.js server process.
 * All API routes import from here so they share the same in-memory
 * run store, HITL manager, and agent runtime.
 *
 * In production, swap InMemoryStore → SupabaseMemoryStore by
 * providing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import {
    bootstrapGaaSPlatform,
    type GaaSPlatform,
    type PlannerFn,
} from '@vetios/gaas';

let _instance: GaaSPlatform | null = null;

/**
 * Inline planner — calls the AI provider directly.
 * Avoids HTTP self-calls which fail in Vercel serverless environment.
 */
const inlinePlannerFn: PlannerFn = async (system, messages) => {
    const safeHold = {
        reasoning: 'No AI provider configured. Agent completing safely.',
        is_complete: true as const,
        completion_summary: 'Agent completed without AI planning — no provider configured.',
        safety_assessment: 'nominal' as const,
        needs_human_review: false,
    };

    const aiApiKey  = process.env.AI_PROVIDER_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    const aiBaseUrl = process.env.AI_PROVIDER_BASE_URL;
    const aiModel   = process.env.AI_PROVIDER_DEFAULT_MODEL ?? 'gpt-4o-mini';

    if (!aiApiKey) return safeHold;

    try {
        const providerUrl = aiBaseUrl
            ? `${aiBaseUrl.replace(/\/$/, '')}/chat/completions`
            : 'https://api.openai.com/v1/chat/completions';

        const res = await fetch(providerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${aiApiKey}`,
            },
            body: JSON.stringify({
                model: aiModel,
                max_tokens: 1000,
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, ...messages],
            }),
        });

        if (!res.ok) return safeHold;

        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const raw = data.choices?.[0]?.message?.content ?? '';
        if (!raw) return safeHold;

        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        return {
            reasoning: parsed.reasoning ?? 'No reasoning.',
            next_tool: parsed.next_tool,
            is_complete: typeof parsed.is_complete === 'boolean' ? parsed.is_complete : false,
            completion_summary: parsed.completion_summary,
            safety_assessment: parsed.safety_assessment ?? 'nominal',
            needs_human_review: typeof parsed.needs_human_review === 'boolean' ? parsed.needs_human_review : false,
            human_review_reason: parsed.human_review_reason,
        };
    } catch {
        return safeHold;
    }
};

export function getGaaSPlatform(): GaaSPlatform {
    if (!_instance) {
        _instance = bootstrapGaaSPlatform({
            vetiosBaseUrl:
                process.env.VETIOS_API_BASE_URL ??
                process.env.NEXT_PUBLIC_SUPABASE_URL ??
                'https://api.vetios.tech/v1',
            authToken:
                process.env.VETIOS_AUTH_TOKEN ??
                process.env.SUPABASE_SERVICE_ROLE_KEY ??
                '',
            // Only use Supabase persistence after gaas_* migrations are applied.
            // Set VETIOS_GAAS_DB=true in Vercel env vars once migrations are done.
            supabaseUrl: process.env.VETIOS_GAAS_DB === 'true'
                ? process.env.NEXT_PUBLIC_SUPABASE_URL
                : undefined,
            supabaseServiceKey: process.env.VETIOS_GAAS_DB === 'true'
                ? process.env.SUPABASE_SERVICE_ROLE_KEY
                : undefined,
            notifyOnHITL: async (interrupt) => {
                console.log(
                    `[GaaS] HITL interrupt raised: ${interrupt.interrupt_id} — ${interrupt.reason}`
                );
            },
            // Inline planner avoids HTTP self-calls which fail in Vercel serverless
            plannerFn: inlinePlannerFn,
        });

        console.log('[GaaS] Platform bootstrapped ✓');
    }

    return _instance;
}
