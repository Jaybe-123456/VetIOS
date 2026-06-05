import { NextResponse } from 'next/server';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { listPublicProductPlans } from '@/lib/billing/entitlements';
import { resolveAccountProductSummary } from '@/lib/billing/entitlements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await resolveSessionTenant();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const summary = await resolveAccountProductSummary({
        tenantId: session.tenantId,
        userId: session.userId,
        client: getSupabaseServer(),
    });

    return NextResponse.json({
        account: summary,
        plans: listPublicProductPlans(),
    });
}
