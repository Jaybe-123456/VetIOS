import { NextResponse } from 'next/server';
import { shouldExposePublicPlatformDetails } from '@/lib/site';

function hasSupabaseAuthCookie(request: Request): boolean {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) {
        return false;
    }

    return cookieHeader
        .split(';')
        .map((part) => part.trim().split('=')[0] ?? '')
        .some((name) =>
            name === 'supabase-auth-token'
            || name.startsWith('supabase-auth-token.')
            || (name.startsWith('sb-') && name.includes('-auth-token')),
        );
}

export function requirePublicPlatformDetailAccess(request: Request): NextResponse | null {
    if (shouldExposePublicPlatformDetails() || hasSupabaseAuthCookie(request)) {
        return null;
    }

    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}
