import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { runPartnerV1Route } from '@/lib/api/v1-route';
import { resolvePartnerOwnerTenantId } from '@/lib/api/partner-service';
import { getPetPassControlPlaneSnapshot } from '@/lib/petpass/service';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ pet_id: string }> },
) {
    const params = await context.params;

    return runPartnerV1Route(request, {
        endpoint: '/v1/petpass/history/{pet_id}',
        aggregateType: 'petpass_history',
        handler: async (auth) => {
            const tenantId = resolvePartnerOwnerTenantId(auth.partner);
            if (!tenantId) {
                return NextResponse.json({ error: 'Partner is missing an owner tenant mapping.' }, { status: 400 });
            }

            const snapshot = await getPetPassControlPlaneSnapshot(getSupabaseServer(), tenantId, { limit: 100 });
            const pet = snapshot.pet_profiles.find((profile) => profile.id === params.pet_id) ?? null;

            if (!pet) {
                return NextResponse.json({ error: 'Pet history not found.' }, { status: 404 });
            }

            const timeline = snapshot.timeline_entries.filter((entry) => entry.pet_profile_id === params.pet_id);
            const notifications = snapshot.notification_deliveries.filter((entry) => entry.pet_profile_id === params.pet_id);

            return NextResponse.json({
                pet,
                timeline,
                notifications,
            });
        },
    });
}
