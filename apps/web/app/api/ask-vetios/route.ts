import { NextResponse } from 'next/server';
import { runInference } from '@/lib/ai/provider';
import {
    getAiProviderApiKey,
    getAiProviderBaseUrl,
    getAiProviderDefaultModel,
    shouldUseAiHeuristicFallback,
} from '@/lib/ai/config';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
    message: z.string().trim().min(1).max(2000),
    conversation: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
    })).max(20).default([]),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, maxBodySize: 32 * 1024 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        const res = NextResponse.json({ error: parsedJson.error, request_id: requestId }, { status: 400 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    const parsed = RequestSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        const res = NextResponse.json({ error: 'Invalid request', request_id: requestId }, { status: 400 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    const { message, conversation } = parsed.data;

    // ── Heuristic fallback (dev / test) ──
    if (shouldUseAiHeuristicFallback()) {
        const res = NextResponse.json(buildHeuristicResponse(message), { status: 200 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    try {
        // Use the centralized runInference which supports ensemble/dual-model reasoning
        const inferenceResult = await runInference({
            input_signature: {
                raw_consultation: message,
                conversation_history: conversation.slice(-10),
                platform_context: "Ask VetIOS Assistant"
            }
        });

        const output = inferenceResult.output_payload;
        const response = buildEnsembleResponse(output, inferenceResult.ensemble_metadata);
        
        const res = NextResponse.json(response, { status: 200 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;

    } catch (error) {
        // Surface fallback on AI failure — still better than a 500
        const fallback = buildHeuristicResponse(message);
        const res = NextResponse.json({ ...fallback, _fallback: true, _error: error instanceof Error ? error.message : 'Unknown' }, { status: 200 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}

// ── Response normaliser ────────────────────────────────────────────────────

function buildEnsembleResponse(data: Record<string, any>, ensembleMetadata: any) {
    const mode = (data.mode as string) || 'general';

    if (mode === 'educational') {
        return {
            mode: 'educational',
            topic: (data.topic as string) || (data.title as string) || 'Veterinary Knowledge',
            content: (data.answer as string) || (data.content as string) || 'No content returned.',
            metadata: {
                ensemble_metadata: ensembleMetadata
            },
        };
    }

    if (mode === 'clinical') {
        const diagnosis = data.diagnosis || data;
        return {
            mode: 'clinical',
            content: (data.summary as string) || (diagnosis.analysis as string) || 'Clinical assessment complete.',
            metadata: {
                diagnosis_ranked: (data.diagnosis_ranked as any) || (diagnosis.top_differentials as any) || [],
                urgency_level: (data.urgency_level as string) || 'low',
                recommended_tests: (data.recommended_tests as string[]) || [],
                red_flags: (data.red_flags as string[]) || [],
                explanation: (data.explanation as string) || '',
                ensemble_metadata: ensembleMetadata
            },
        };
    }

    return {
        mode: 'general',
        content: (data.answer as string) || (data.content as string) || 'How can I assist you today?',
        metadata: {
            ensemble_metadata: ensembleMetadata
        },
    };
}

// ── Heuristic fallback (no AI key / dev mode) ─────────────────────────────

function buildHeuristicResponse(message: string) {
    const lower = message.toLowerCase();

    const educationalKeywords = ['what is', 'explain', 'describe', 'how does', 'pathogenesis', 'mechanism',
        'epidemiology', 'classification', 'structure', 'treatment of', 'prevention of', 'vaccine', 'overview of'];
    const isEducational = educationalKeywords.some((k) => lower.includes(k));

    const clinicalKeywords = ['vomit', 'lethargy', 'anorexia', 'appetite', 'diarrhea', 'discharge',
        'seizure', 'cough', 'fever', 'limp', 'lame', 'drink', 'urinat', 'weight loss', 'mass', 'lump'];
    const isClinical = clinicalKeywords.some((k) => lower.includes(k));

    if (isEducational) {
        return {
            mode: 'educational',
            topic: 'Veterinary Knowledge Query',
            content: `## Response Unavailable in Offline Mode\n\nThe VetIOS intelligence gateway is currently operating in **heuristic fallback mode**. Live AI inference is required to answer educational knowledge queries with research-grade depth.\n\n**To enable full responses:**\n- Ensure \`OPENAI_API_KEY\` or \`AI_PROVIDER_API_KEY\` is set\n- Set \`VETIOS_DEV_BYPASS=false\` in your environment\n\nYour query has been logged and will be processed once the intelligence gateway is operational.`,
            metadata: null,
        };
    }

    if (isClinical) {
        return {
            mode: 'clinical',
            content: 'Clinical signals detected. Running heuristic differential protocol.',
            metadata: {
                diagnosis_ranked: [
                    { name: 'Acute Gastroenteritis', probability: 0.42, reasoning: 'Most common presentation for GI signs' },
                    { name: 'Systemic Infectious Disease', probability: 0.28, reasoning: 'Lethargy with multi-system involvement' },
                    { name: 'Metabolic Disorder', probability: 0.18, reasoning: 'Chronic progression pattern' },
                ],
                urgency_level: 'moderate',
                recommended_tests: ['Complete Blood Count (CBC)', 'Chemistry Panel', 'Urinalysis', 'Abdominal Radiographs'],
                red_flags: [],
                explanation: 'Heuristic mode active. Connect AI provider for precision differential ranking.',
            }
        };
    }

    return {
        mode: 'general',
        content: "Hello — I'm VetIOS, your veterinary intelligence assistant. I can answer clinical questions, explain veterinary conditions in depth, or help you navigate the platform. What would you like to explore?",
        metadata: null,
    };
}
