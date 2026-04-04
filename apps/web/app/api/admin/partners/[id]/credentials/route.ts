import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { listPartnerCredentials } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId: crypto.randomUUID(),
        allowApiKey: false,
        requireAdmin: true,
        partnerId: params.id,
    });

    if (access.response) {
        return access.response;
    }

    const credentials = await listPartnerCredentials(access.access.client, params.id);
    return NextResponse.json(credentials);
}
