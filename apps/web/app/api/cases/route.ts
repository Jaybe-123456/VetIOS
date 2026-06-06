import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    buildCaseInputSignature,
    listClinicalCases,
    updateCaseIntakeSnapshot,
} from '@/lib/cases/caseWorkflow';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runInference } from '@/lib/vetios-inference';
import { recordProductUsageEvent } from '@/lib/billing/entitlements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OptionalNumber = z.preprocess((value) => {
    if (value === '' || value === null || value === undefined) return null;
    return typeof value === 'number' ? value : Number(value);
}, z.number().finite().nullable()).optional();

const VoiceContextSchema = z.object({
    raw_transcript: z.string().trim().max(6000).optional().nullable(),
    extraction_confidence: OptionalNumber,
    extraction_notes: z.array(z.string().trim().max(500)).max(12).optional().nullable(),
    source: z.string().trim().max(120).optional().nullable(),
    captured_at: z.string().trim().max(80).optional().nullable(),
    fallback_used: z.boolean().optional().nullable(),
}).optional().nullable();

const CaseIntakeSchema = z.object({
    patient: z.object({
        species: z.string().min(1),
        breed: z.string().optional().nullable(),
        name: z.string().optional().nullable(),
        age_years: OptionalNumber,
        weight_kg: OptionalNumber,
        sex: z.string().optional().nullable(),
        owner_name: z.string().optional().nullable(),
        owner_contact: z.record(z.string(), z.unknown()).optional().nullable(),
        microchip_id: z.string().optional().nullable(),
    }),
    presenting_complaint: z.string().min(1),
    history: z.string().optional().nullable(),
    duration_text: z.string().optional().nullable(),
    symptoms: z.array(z.string()).default([]),
    vitals: z.record(z.string(), z.unknown()).default({}),
    physical_exam: z.record(z.string(), z.unknown()).default({}),
    labs: z.record(z.string(), z.unknown()).default({}),
    images: z.array(z.unknown()).default([]),
    voice_context: VoiceContextSchema,
});

export async function GET(req: Request) {
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    try {
        const cases = await listClinicalCases(supabase, auth.actor.tenantId, {
            status: url.searchParams.get('status'),
            species: url.searchParams.get('species'),
            limit: Number(url.searchParams.get('limit') ?? '100'),
        });
        return NextResponse.json({ cases });
    } catch (error) {
        return NextResponse.json(
            { error: 'case_list_failed', detail: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}

export async function POST(req: Request) {
    const requestId = randomUUID();
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        return NextResponse.json({ error: 'invalid_input', detail: parsedJson.error }, { status: 400 });
    }

    const parsed = CaseIntakeSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        return NextResponse.json({ error: 'invalid_input', detail: formatZodErrors(parsed.error) }, { status: 400 });
    }

    const inputSignature = buildCaseInputSignature(parsed.data);
    let inference;
    try {
        inference = await runInference({
            inputSignature,
            model: { name: 'VetIOS Clinical Engine', version: 'case_entry_v1' },
            tenantId: auth.actor.tenantId,
            requestId,
            supabase,
            persist: true,
            userId: auth.actor.userId,
            sourceModule: 'case_entry_ui',
        });
    } catch (error) {
        return NextResponse.json(
            { error: 'case_inference_failed', detail: error instanceof Error ? error.message : 'Unknown inference error' },
            { status: 500 },
        );
    }

    if (!inference.clinical_case_id) {
        return NextResponse.json(
            { error: 'case_persistence_failed', detail: 'Inference completed without a canonical case id.' },
            { status: 500 },
        );
    }

    try {
        await updateCaseIntakeSnapshot(supabase, {
            tenantId: auth.actor.tenantId,
            caseId: inference.clinical_case_id,
            intake: parsed.data,
        });
    } catch (error) {
        return NextResponse.json(
            { error: 'case_intake_failed', detail: error instanceof Error ? error.message : 'Unknown case intake error' },
            { status: 500 },
        );
    }

    await recordProductUsageEvent({
        tenantId: auth.actor.tenantId,
        userId: auth.actor.userId,
        eventType: 'diagnosis',
        source: 'clinical_case',
        requestId,
        metadata: {
            clinical_case_id: inference.clinical_case_id,
            inference_event_id: inference.inference_event_id,
        },
        client: supabase,
    });

    return NextResponse.json({
        clinical_case_id: inference.clinical_case_id,
        inference_event_id: inference.inference_event_id,
        result: inference,
        request_id: requestId,
    });
}

function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}
