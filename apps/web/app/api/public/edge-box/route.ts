import { NextResponse } from 'next/server';
import { getPublicEdgeBoxSnapshot } from '@/lib/edgeBox/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const snapshot = await getPublicEdgeBoxSnapshot();
    if (!snapshot.configured) {
        return NextResponse.json(
            {
                error: 'Public edge-box catalog is not configured.',
                snapshot,
            },
            { status: 503 },
        );
    }

    return NextResponse.json({ snapshot });
}
