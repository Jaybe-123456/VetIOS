import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { updatePartnerStatus } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
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

    const partner = await updatePartnerStatus(access.access.client, params.id, 'active');
    return NextResponse.json({ partner });
}
