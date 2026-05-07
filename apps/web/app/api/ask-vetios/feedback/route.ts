import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 15;

const FeedbackSchema = z.object({
    query_id: z.string().uuid(),
    user_feedback: z.enum(['helpful', 'not_helpful']),
    feedback_notes: z.string().trim().max(200).optional(),
    reason: z.enum([
        'images_missing',
        'drug_dose_wrong',
        'sources_irrelevant',
        'information_incomplete',
    ]).optional(),
});

export async function POST(req: Request) {
    const parsed = FeedbackSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid feedback', details: parsed.error.flatten() }, { status: 400 });
    }

    const { query_id, user_feedback, feedback_notes, reason } = parsed.data;
    const supabase = getSupabaseServer();
    const notes = [reason, feedback_notes].filter(Boolean).join(': ').slice(0, 240) || null;
    const { error } = await supabase
        .from('ask_vetios_queries')
        .update({
            user_feedback,
            feedback_notes: notes,
        })
        .eq('id', query_id);
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from('outbox_events').insert({
        tenant_id: 'platform',
        topic: 'ask_vetios.feedback_received',
        handler_key: 'ask_vetios_feedback',
        target_type: 'internal_task',
        payload: {
            query_id,
            user_feedback,
            reason: reason ?? null,
        },
        metadata: { source: 'ask_vetios_response_feedback' },
    }).throwOnError();

    return NextResponse.json({ ok: true });
}
