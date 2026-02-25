/**
 * POST /api/outcome
 *
 * Links a clinical outcome to a previously logged inference event.
 *
 * Critical rule: Never update inference logs. Outcomes are separate events.
 * Auth: Requires authenticated session. tenant_id = auth.uid().
 */

import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { logOutcome } from '@/lib/logging/outcomeLogger';

interface OutcomeRequestBody {
    tenant_id?: string; // Deprecated: now derived from session
    inference_event_id: string;
    clinic_id?: string;
    case_id?: string;
    outcome: {
        type: string;
        payload: Record<string, unknown>;
        timestamp: string;
    };
}

export async function POST(req: Request) {
    // ── Auth check ──
    const session = await resolveSessionTenant();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { tenantId } = session;

    // ── Safe JSON parse (returns 400, never 500) ──
    const parsed = await safeJson<OutcomeRequestBody>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.data;

    try {
        // ── Validate required fields ──
        if (!body.inference_event_id) {
            return NextResponse.json({ error: 'Missing inference_event_id' }, { status: 400 });
        }
        if (!body.outcome?.type) {
            return NextResponse.json({ error: 'Missing outcome.type' }, { status: 400 });
        }
        if (!body.outcome?.payload) {
            return NextResponse.json({ error: 'Missing outcome.payload' }, { status: 400 });
        }
        if (!body.outcome?.timestamp) {
            return NextResponse.json({ error: 'Missing outcome.timestamp' }, { status: 400 });
        }

        const supabase = getSupabaseServer();

        // ── Verify inference exists AND belongs to tenant ──
        const { data: inferenceRecord, error: lookupError } = await supabase
            .from('ai_inference_events')
            .select('id, tenant_id')
            .eq('id', body.inference_event_id)
            .single();

        if (lookupError || !inferenceRecord) {
            return NextResponse.json(
                { error: `Inference event not found: ${body.inference_event_id}` },
                { status: 404 },
            );
        }

        if ((inferenceRecord as { tenant_id: string }).tenant_id !== tenantId) {
            return NextResponse.json(
                { error: 'Inference event does not belong to this tenant' },
                { status: 403 },
            );
        }

        // ── Insert outcome event ──
        const outcomeEventId = await logOutcome(supabase, {
            tenant_id: tenantId,
            clinic_id: body.clinic_id ?? null,
            case_id: body.case_id ?? null,
            inference_event_id: body.inference_event_id,
            outcome_type: body.outcome.type,
            outcome_payload: body.outcome.payload,
            outcome_timestamp: body.outcome.timestamp,
        });

        return NextResponse.json({
            outcome_event_id: outcomeEventId,
            linked_inference_event_id: body.inference_event_id,
        });
    } catch (err) {
        console.error('[POST /api/outcome] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}

