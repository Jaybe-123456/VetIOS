import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
    fallbackExtractClinicalFields,
    normalizeExtractedClinicalFields,
} from '@/lib/voice/extract';
import type { VoiceSurface } from '@/lib/voice/types';
import { resolveSessionTenant } from '@/lib/supabaseServer';
import { recordProductUsageEvent } from '@/lib/billing/entitlements';

export const runtime = 'nodejs';
export const maxDuration = 20;

const RequestSchema = z.object({
    transcript: z.string().trim().min(1).max(6000),
    surface: z.enum(['case_intake', 'inference', 'ask_vetios']),
});

export async function POST(req: Request) {
    const requestId = req.headers.get('x-request-id') ?? `voice_${randomUUID()}`;
    const session = await resolveSessionTenant();
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'invalid_voice_payload' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
    if (!apiKey) {
        await recordVoiceUsage(session, requestId, parsed.data.surface, 'local_fallback');
        return NextResponse.json({
            fields: fallbackExtractClinicalFields(parsed.data.transcript),
            source: 'local_fallback',
        });
    }

    try {
        const fields = await extractWithAnthropic(parsed.data.transcript, parsed.data.surface, apiKey);
        await recordVoiceUsage(session, requestId, parsed.data.surface, 'anthropic');
        return NextResponse.json({ fields, source: 'anthropic' });
    } catch {
        await recordVoiceUsage(session, requestId, parsed.data.surface, 'local_fallback');
        return NextResponse.json({
            fields: fallbackExtractClinicalFields(parsed.data.transcript),
            source: 'local_fallback',
        });
    }
}

async function recordVoiceUsage(
    session: Awaited<ReturnType<typeof resolveSessionTenant>>,
    requestId: string,
    surface: VoiceSurface,
    source: string,
) {
    if (!session) return;

    await recordProductUsageEvent({
        tenantId: session.tenantId,
        userId: session.userId,
        eventType: 'voice_extract',
        source: 'voice_mode',
        requestId,
        metadata: {
            surface,
            extraction_source: source,
        },
    });
}

async function extractWithAnthropic(transcript: string, surface: VoiceSurface, apiKey: string) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: process.env.ANTHROPIC_VOICE_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
            max_tokens: 900,
            temperature: 0,
            messages: [{ role: 'user', content: buildPrompt(transcript, surface) }],
        }),
    });

    if (!response.ok) {
        throw new Error(`Anthropic voice extraction failed: ${response.status}`);
    }

    const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    const text = data.content?.find((item) => item.type === 'text')?.text;
    if (!text) throw new Error('Anthropic voice extraction returned no text.');
    const parsed = JSON.parse(stripCodeFences(text));
    return normalizeExtractedClinicalFields(parsed, transcript);
}

function buildPrompt(transcript: string, surface: VoiceSurface): string {
    return [
        'You are VetIOS Voice Mode, a veterinary clinical intake extraction engine.',
        'Extract structured fields from the dictated clinical note.',
        'Return only valid JSON. No markdown. No prose.',
        '',
        'Required JSON shape:',
        '{',
        '  "species": "canine|feline|equine|bovine|avian|exotic|unknown",',
        '  "breed": "string or null",',
        '  "age_value": number or null,',
        '  "age_unit": "years|months|days" or null,',
        '  "sex": "male_intact|male_neutered|female_intact|female_spayed|unknown",',
        '  "symptoms": ["short clinical sign strings"],',
        '  "presenting_complaint": "short summary",',
        '  "duration_value": number or null,',
        '  "duration_unit": "hours|days|weeks" or null,',
        '  "severity": "low|moderate|severe",',
        '  "labs": {"pcv": 28, "glucose": 2.1},',
        '  "query": "clinical question for Ask VetIOS",',
        '  "confidence": number between 0 and 1,',
        '  "extraction_notes": []',
        '}',
        '',
        'Rules:',
        '- Do not diagnose. Extract only.',
        '- Preserve uncertainty by omitting fields rather than inventing values.',
        '- Do not include patient identity or owner information.',
        '- If extraction is weak, put the raw transcript into symptoms and query.',
        `- Surface: ${surface}.`,
        '',
        'Transcript:',
        transcript,
    ].join('\n');
}

function stripCodeFences(value: string): string {
    return value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}
