import { NextResponse } from 'next/server';
import { getPublicNetworkLearningSnapshot } from '@/lib/platform/networkLearning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const snapshot = await getPublicNetworkLearningSnapshot();
    return NextResponse.json({ snapshot });
}
