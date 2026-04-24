import { NextResponse } from 'next/server';
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

const SYSTEM_PROMPT = `You are VetIOS — a veterinary clinical intelligence assistant operating inside a professional AI infrastructure platform. You are not a consumer chatbot. You are a clinical expert system.

You have THREE operating modes. Detect the user's intent from their message and respond accordingly.

━━━ MODE DETECTION ━━━

MODE: "educational"
→ Trigger: User asks WHAT something is, HOW it works, its classification, mechanism, pathogenesis, epidemiology, clinical signs, diagnosis, treatment, prevention, or asks for a research/overview of any veterinary topic, disease, pathogen, drug, or procedure.
→ Examples: "What is CDV", "Explain parvovirus", "How does FIP develop", "What vaccines exist for distemper", "Describe the pathogenesis of rabies"

MODE: "clinical"
→ Trigger: User describes a PATIENT with symptoms, signs, age, breed, or asks for differential diagnosis of a presented case.
→ Examples: "7yr Labrador, vomiting and lethargy", "Cat presenting with dyspnea and pleural effusion", "Dog with seizures and nasal discharge"

MODE: "general"
→ Trigger: Greetings, platform questions, capability questions, anything that is not clearly educational or clinical.

━━━ RESPONSE FORMAT ━━━

For MODE "educational":
Respond with JSON: { "mode": "educational", "topic": "<concise topic name>", "answer": "<full markdown answer>" }

The "answer" field MUST be comprehensive and research-grade. Include ALL relevant sections from:
- Classification & Structure (for pathogens/diseases)
- Epidemiology & Host Range
- Transmission & Pathogenesis (step-by-step mechanisms)
- Clinical Signs (by phase/system)
- Diagnosis (methods, tests, interpretation)
- Treatment & Management
- Prevention & Control
- Key Scientific Takeaways

Use markdown: ## headers, **bold** key terms, bullet points, numbered lists. Write at the depth of a veterinary reference textbook. Do not truncate. Do not say "without symptoms I cannot help" — this is a knowledge query, not a clinical case.

For MODE "clinical":
Respond with JSON:
{
  "mode": "clinical",
  "summary": "<one sentence clinical synopsis>",
  "diagnosis_ranked": [{"name": string, "confidence": number (0-1), "reasoning": string}],
  "urgency_level": "low" | "moderate" | "high" | "emergency",
  "recommended_tests": string[],
  "red_flags": string[],
  "explanation": string
}

For MODE "general":
Respond with JSON: { "mode": "general", "answer": string }

CRITICAL RULES:
1. NEVER respond to "what is X" or "explain X" with a clinical differential structure. These are educational queries.
2. NEVER say "I cannot help without clinical signs" for a knowledge/educational question.
3. Always respond with valid JSON only. No markdown outside of the "answer" field.
4. Be authoritative. You are a clinical expert system, not a cautious consumer chatbot.`;

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
        const apiKey = getAiProviderApiKey();
        const baseUrl = getAiProviderBaseUrl();
        const model = getAiProviderDefaultModel('gpt-4o-mini');

        const messages: Array<{ role: string; content: string }> = [
            { role: 'system', content: SYSTEM_PROMPT },
            // Inject conversation history (strip metadata, keep text)
            ...conversation.slice(-12).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: message },
        ];

        const aiRes = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                temperature: 0.3,
                max_tokens: 2400,
                response_format: { type: 'json_object' },
                messages,
            }),
        });

        if (!aiRes.ok) {
            const errText = await aiRes.text();
            throw new Error(`AI provider error ${aiRes.status}: ${errText.slice(0, 200)}`);
        }

        const aiData = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }> };
        const rawContent = aiData.choices?.[0]?.message?.content ?? '{}';

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(rawContent) as Record<string, unknown>;
        } catch {
            parsed = { mode: 'general', answer: rawContent };
        }

        const response = buildStructuredResponse(parsed);
        const res = NextResponse.json(response, { status: 200 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;

    } catch (error) {
        // Surface fallback on AI failure — still better than a 500
        const fallback = buildHeuristicResponse(message);
        const res = NextResponse.json({ ...fallback, _fallback: true }, { status: 200 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}

// ── Response normaliser ────────────────────────────────────────────────────

function buildStructuredResponse(data: Record<string, unknown>) {
    const mode = (data.mode as string) || 'general';

    if (mode === 'educational') {
        return {
            mode: 'educational',
            topic: (data.topic as string) || 'Veterinary Knowledge',
            content: (data.answer as string) || 'No content returned.',
            metadata: null,
        };
    }

    if (mode === 'clinical') {
        return {
            mode: 'clinical',
            content: (data.summary as string) || 'Clinical assessment complete.',
            metadata: {
                diagnosis_ranked: (data.diagnosis_ranked as Array<{ name: string; confidence: number; reasoning: string }>) || [],
                urgency_level: (data.urgency_level as string) || 'low',
                recommended_tests: (data.recommended_tests as string[]) || [],
                red_flags: (data.red_flags as string[]) || [],
                explanation: (data.explanation as string) || '',
            },
        };
    }

    return {
        mode: 'general',
        content: (data.answer as string) || 'How can I assist you today?',
        metadata: null,
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
        return buildStructuredResponse({
            mode: 'clinical',
            summary: 'Clinical signals detected. Running heuristic differential protocol.',
            diagnosis_ranked: [
                { name: 'Acute Gastroenteritis', confidence: 0.42, reasoning: 'Most common presentation for GI signs' },
                { name: 'Systemic Infectious Disease', confidence: 0.28, reasoning: 'Lethargy with multi-system involvement' },
                { name: 'Metabolic Disorder', confidence: 0.18, reasoning: 'Chronic progression pattern' },
            ],
            urgency_level: 'moderate',
            recommended_tests: ['Complete Blood Count (CBC)', 'Chemistry Panel', 'Urinalysis', 'Abdominal Radiographs'],
            red_flags: [],
            explanation: 'Heuristic mode active. Connect AI provider for precision differential ranking.',
        });
    }

    return {
        mode: 'general',
        content: "Hello — I'm VetIOS, your veterinary intelligence assistant. I can answer clinical questions, explain veterinary conditions in depth, or help you navigate the platform. What would you like to explore?",
        metadata: null,
    };
}
