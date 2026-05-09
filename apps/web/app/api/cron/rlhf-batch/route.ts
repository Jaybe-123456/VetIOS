import { NextResponse } from 'next/server';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getRequestId } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runRlhfBatch } from '@/lib/rlhf/processor';
import { authorizeCronRequest } from '@/lib/http/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
    const requestId = getRequestId(req);
    const startTime = Date.now();

    const auth = authorizeCronRequest(req, 'rlhf-batch');
    if (!auth.authorized) {
        if (auth.reason === 'CRON_SECRET not configured') {
            return NextResponse.json({ error: 'Misconfigured' }, { status: 500 });
        }
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const supabase = getSupabaseServer();
        const result = await runRlhfBatch(supabase);

        console.log('[cron/rlhf-batch] completed:', result);

        const response = NextResponse.json({
            success: true,
            ...result,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[cron/rlhf-batch] fatal:', message);
        return NextResponse.json({ error: 'Batch failed', detail: message, request_id: requestId }, { status: 500 });
    }
}
