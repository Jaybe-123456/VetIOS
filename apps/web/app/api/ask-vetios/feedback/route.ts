import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
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
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, maxBodySize: 16 * 1024 });
    if (guard.blocked) return guard.response!;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['rag:read'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: guard.requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const json = await safeJson(req);
    const parsed = FeedbackSchema.safeParse(json.ok ? json.data : null);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid feedback', details: parsed.error.flatten() }, { status: 400 });
    }

    const { query_id, user_feedback, feedback_notes, reason } = parsed.data;
    const notes = [reason, feedback_notes].filter(Boolean).join(': ').slice(0, 240) || null;
    const { data: updated, error } = await supabase
        .from('ask_vetios_queries')
        .update({
            user_feedback,
            feedback_notes: notes,
        })
        .eq('id', query_id)
        .eq('tenant_id', auth.actor.tenantId)
        .select('id')
        .maybeSingle();
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updated) {
        return NextResponse.json({ error: 'Feedback target not found' }, { status: 404 });
    }

    await supabase.from('outbox_events').insert({
        tenant_id: auth.actor.tenantId,
        topic: 'ask_vetios.feedback_received',
        handler_key: 'ask_vetios_feedback',
        target_type: 'internal_task',
        payload: {
            query_id,
            user_feedback,
            reason: reason ?? null,
            actor_user_id: auth.actor.userId,
        },
        metadata: { source: 'ask_vetios_response_feedback' },
    }).throwOnError();

    return NextResponse.json({ ok: true });
}
