import { NextResponse } from 'next/server';
import { getPublicPetPassSnapshot } from '@/lib/petpass/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const snapshot = await getPublicPetPassSnapshot();
    return NextResponse.json({ snapshot });
}
