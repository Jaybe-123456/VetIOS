import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { listPartnerCredentials } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId: crypto.randomUUID(),
        allowApiKey: false,
    });

    if (access.response) {
        return access.response;
    }

    const credentials = await listPartnerCredentials(access.access.client, access.access.partner.id);
    return NextResponse.json(credentials);
}
