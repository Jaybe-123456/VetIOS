import { NextResponse } from 'next/server';
import { getPublicModelCardsCatalog } from '@/lib/platform/publicModelCards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const catalog = await getPublicModelCardsCatalog();
    return NextResponse.json({ catalog });
}
