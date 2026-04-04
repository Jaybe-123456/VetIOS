import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { revokePartnerCredential } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId: crypto.randomUUID(),
        allowApiKey: false,
    });

    if (access.response) {
        return access.response;
    }

    const parsed = await safeJson<{ credentialId?: string }>(request);
    if (!parsed.ok || !parsed.data.credentialId) {
        return NextResponse.json({ error: 'credentialId is required.' }, { status: 400 });
    }

    const credential = await revokePartnerCredential(access.access.client, access.access.partner.id, parsed.data.credentialId);
    return NextResponse.json({ credential });
}
