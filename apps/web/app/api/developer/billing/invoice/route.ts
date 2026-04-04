import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { getUpcomingInvoice } from '@/lib/billing/stripe-service';

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

    try {
        const invoice = await getUpcomingInvoice(access.access.partner.id);
        return NextResponse.json(invoice);
    } catch (error) {
        return NextResponse.json({
            amount_due: 0,
            due_date: null,
            lines: [],
            error: error instanceof Error ? error.message : 'Unable to load upcoming invoice.',
        });
    }
}
