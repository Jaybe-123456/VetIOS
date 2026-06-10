import { NextResponse } from 'next/server';
import { getCireOpenStandard } from '@/lib/cire/standard';
import { getConfiguredSiteOrigin } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const standard = getCireOpenStandard(getConfiguredSiteOrigin() ?? 'https://www.vetios.tech');

    return NextResponse.json(standard, {
        headers: {
            'Cache-Control': 'public, max-age=300, s-maxage=3600',
            'CIRE-Standard-Version': standard.version,
        },
    });
}
