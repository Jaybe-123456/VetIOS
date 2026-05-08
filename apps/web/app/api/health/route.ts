import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

export async function GET() {
    const supabase = getSupabaseServer();
    const { error } = await supabase
        .from('ai_inference_events')
        .select('id')
        .limit(1);

    return NextResponse.json({
        db: error ? 'error' : 'ok',
        inference: 'ok',
    });
}
