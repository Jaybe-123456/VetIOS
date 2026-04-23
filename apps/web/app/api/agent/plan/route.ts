import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PlannerOutput {
    reasoning: string;
    next_tool?: { name: string; input: Record<string, unknown> };
    is_complete: boolean;
    completion_summary?: string;
    safety_assessment: 'nominal' | 'caution' | 'hold' | 'escalate';
    needs_human_review: boolean;
    human_review_reason?: string;
}

/**
 * POST /api/agent/plan
 *
 * Internal endpoint called by the AgentRuntime on every step.
 * Wraps the configured AI provider and returns a structured PlannerOutput.
 * On any failure, returns a safe hold state rather than an error.
 */
export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const safeFallback = (reason: string): PlannerOutput => ({
        reasoning: reason,
        is_complete: false,
        safety_assessment: 'hold',
        needs_human_review: true,
        human_review_reason: reason,
    });

    let body: { system?: string; messages?: Array<{ role: string; content: string }>; max_tokens?: number };
    try {
        body = await req.json() as typeof body;
    } catch {
        const res = NextResponse.json(
            { data: safeFallback('Invalid JSON body.'), meta: { request_id: requestId, timestamp: new Date().toISOString() }, error: null },
            { status: 200 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    const { system, messages } = body;
    if (!system || !messages?.length) {
        const res = NextResponse.json(
            { data: safeFallback('Missing system or messages.'), meta: { request_id: requestId, timestamp: new Date().toISOString() }, error: null },
            { status: 200 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    const aiBaseUrl = process.env.AI_PROVIDER_BASE_URL;
    const aiApiKey  = process.env.AI_PROVIDER_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    const aiModel   = process.env.AI_PROVIDER_DEFAULT_MODEL ?? 'gpt-4o-mini';

    // If no AI provider is configured, return a safe deterministic plan
    if (!aiApiKey && !aiBaseUrl) {
        const output: PlannerOutput = {
            reasoning: 'No AI provider configured. Running in safe autonomous mode — completing without tool calls.',
            is_complete: true,
            completion_summary: 'Agent completed: no AI provider available for dynamic planning.',
            safety_assessment: 'nominal',
            needs_human_review: false,
        };
        const res = NextResponse.json(
            { data: output, meta: { request_id: requestId, timestamp: new Date().toISOString() }, error: null },
            { status: 200 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    try {
        const providerUrl = aiBaseUrl
            ? `${aiBaseUrl.replace(/\/$/, '')}/chat/completions`
            : 'https://api.openai.com/v1/chat/completions';

        const aiRes = await fetch(providerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiApiKey}`,
            },
            body: JSON.stringify({
                model: aiModel,
                max_tokens: body.max_tokens ?? 1000,
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    ...messages,
                ],
            }),
        });

        if (!aiRes.ok) {
            const res = NextResponse.json(
                { data: safeFallback(`AI provider returned ${aiRes.status}`), meta: { request_id: requestId, timestamp: new Date().toISOString() }, error: null },
                { status: 200 }
            );
            withRequestHeaders(res.headers, requestId, startTime);
            return res;
        }

        const aiData = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }> };
        const rawContent = aiData.choices?.[0]?.message?.content ?? '';

        let plannerOutput: PlannerOutput;
        try {
            plannerOutput = JSON.parse(rawContent.replace(/```json|```/g, '').trim()) as PlannerOutput;
            if (!plannerOutput.reasoning) plannerOutput.reasoning = 'No reasoning provided.';
            if (!plannerOutput.safety_assessment) plannerOutput.safety_assessment = 'nominal';
            if (typeof plannerOutput.is_complete !== 'boolean') plannerOutput.is_complete = false;
            if (typeof plannerOutput.needs_human_review !== 'boolean') plannerOutput.needs_human_review = false;
        } catch {
            plannerOutput = safeFallback('Could not parse AI response.');
        }

        const res = NextResponse.json(
            { data: plannerOutput, meta: { request_id: requestId, timestamp: new Date().toISOString() }, error: null },
            { status: 200 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    } catch (err) {
        const res = NextResponse.json(
            { data: safeFallback(err instanceof Error ? err.message : 'Planner error.'), meta: { request_id: requestId, timestamp: new Date().toISOString() }, error: null },
            { status: 200 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}
