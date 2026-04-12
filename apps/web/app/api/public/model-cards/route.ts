import { NextResponse } from 'next/server';
import { getPublicModelCardsCatalog } from '@/lib/platform/publicModelCards';
import { requirePublicPlatformDetailAccess } from '@/lib/platform/publicAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const blocked = requirePublicPlatformDetailAccess(req);
    if (blocked) return blocked;

    const catalog = await getPublicModelCardsCatalog();
    return NextResponse.json({ catalog });
}
