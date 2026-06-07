import { NextResponse } from 'next/server';
import { acceptNativeVendorAuthorizationCallback } from '@/lib/passiveSignals/service';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const url = new URL(req.url);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (!state) {
        return NextResponse.json({ error: 'state is required.' }, { status: 400 });
    }

    try {
        const connection = await acceptNativeVendorAuthorizationCallback({
            client: getSupabaseServer(),
            state,
            code,
            error,
        });
        const redirectUrl = new URL('/settings/passive-signals', url.origin);
        redirectUrl.searchParams.set('native_adapter', connection.adapter_key);
        redirectUrl.searchParams.set('native_auth', connection.status === 'active' ? 'connected' : 'error');
        return NextResponse.redirect(redirectUrl);
    } catch (callbackError) {
        return NextResponse.json({
            error: callbackError instanceof Error ? callbackError.message : 'Native vendor authorization failed.',
        }, { status: 400 });
    }
}
