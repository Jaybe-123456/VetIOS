import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { listPartnersWithUsageSummary } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId: crypto.randomUUID(),
        allowApiKey: false,
        requireAdmin: true,
    });

    if (access.response) {
        return access.response;
    }

    const partners = await listPartnersWithUsageSummary(access.access.client);
    return NextResponse.json(partners);
}
