import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import {
    acceptOwnerInvitation,
    previewOwnerInvitation,
    type PetPassChannel,
} from '@/lib/petpass/service';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InviteAcceptancePayload = {
    token?: string;
    accepted_terms?: boolean;
    identity_email?: string | null;
    identity_phone?: string | null;
    notification_channel?: PetPassChannel | null;
    notification_types?: string[];
    consent_types?: string[];
};

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const token = new URL(req.url).searchParams.get('token');
    if (!token) {
        return NextResponse.json({ error: 'token is required.' }, { status: 400 });
    }

    const preview = await previewOwnerInvitation(getSupabaseServer(), token);
    if (!preview) {
        return NextResponse.json({ error: 'PetPass invitation was not found.' }, { status: 404 });
    }

    const statusCode = preview.status === 'expired' || preview.status === 'revoked' ? 410 : 200;
    return NextResponse.json({ invitation: preview }, { status: statusCode });
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const parsed = await safeJson<InviteAcceptancePayload>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (!parsed.data.token) {
        return NextResponse.json({ error: 'token is required.' }, { status: 400 });
    }

    if (parsed.data.accepted_terms !== true) {
        return NextResponse.json({ error: 'accepted_terms must be true.' }, { status: 400 });
    }

    const identity = parsed.data.identity_email ?? parsed.data.identity_phone ?? null;
    const accepted = await acceptOwnerInvitation(getSupabaseServer(), {
        token: parsed.data.token,
        identity,
        userAgent: req.headers.get('user-agent'),
        consentTypes: parsed.data.consent_types,
        notificationChannel: normalizeChannel(parsed.data.notification_channel),
        notificationTypes: parsed.data.notification_types,
    });

    return NextResponse.json({
        invitation: {
            id: accepted.invitation.id,
            status: accepted.invitation.status,
            accepted_at: accepted.invitation.accepted_at,
            expires_at: accepted.invitation.expires_at,
        },
        owner_app: accepted.owner_app,
    });
}

function normalizeChannel(value: unknown): PetPassChannel | null {
    return value === 'sms' || value === 'email' || value === 'push' ? value : null;
}
