import { NextResponse } from 'next/server';
import { getPublicNetworkLearningSnapshot } from '@/lib/platform/networkLearning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const snapshot = await getPublicNetworkLearningSnapshot();
    if (!snapshot.configured) {
        return NextResponse.json(
            {
                error: 'Public network learning snapshot is not configured.',
                snapshot,
            },
            { status: 503 },
        );
    }

    return NextResponse.json({ snapshot });
}
