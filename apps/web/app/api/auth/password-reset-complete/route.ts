import { NextResponse } from 'next/server';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 5, windowMs: 60_000, maxBodySize: 16 * 1024 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const userResult = await session.supabase.auth.getUser();
    const user = userResult.data.user;
    if (userResult.error || !user) {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const passwordChangedAt = new Date().toISOString();
    const appMetadata = user.app_metadata && typeof user.app_metadata === 'object'
        ? user.app_metadata
        : {};
    const adminClient = getSupabaseServer();
    const updateResult = await adminClient.auth.admin.updateUserById(session.userId, {
        app_metadata: {
            ...appMetadata,
            password_changed_at: passwordChangedAt,
            session_revocation_reason: 'password_reset',
        },
    });

    if (updateResult.error) {
        return NextResponse.json(
            {
                error: 'password_session_revocation_failed',
                detail: updateResult.error.message,
                request_id: requestId,
            },
            { status: 500 },
        );
    }

    const response = NextResponse.json({
        ok: true,
        password_changed_at: passwordChangedAt,
        request_id: requestId,
    });
    response.headers.set('cache-control', 'no-store, max-age=0');
    response.headers.set('pragma', 'no-cache');
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
