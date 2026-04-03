import { NextResponse } from 'next/server';
import { getPublicEdgeBoxSnapshot } from '@/lib/edgeBox/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const snapshot = await getPublicEdgeBoxSnapshot();
    return NextResponse.json({ snapshot });
}
