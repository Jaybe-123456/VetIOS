import { NextResponse } from 'next/server';
import { getPublicPetPassSnapshot } from '@/lib/petpass/service';
import { requirePublicPlatformDetailAccess } from '@/lib/platform/publicAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const blocked = requirePublicPlatformDetailAccess(req);
    if (blocked) return blocked;

    const snapshot = await getPublicPetPassSnapshot();
    return NextResponse.json({ snapshot });
}
