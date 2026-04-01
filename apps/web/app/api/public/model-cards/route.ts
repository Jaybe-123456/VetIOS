import { NextResponse } from 'next/server';
import { getPublicModelCardsCatalog } from '@/lib/platform/publicModelCards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const catalog = await getPublicModelCardsCatalog();
    if (!catalog.configured) {
        return NextResponse.json(
            {
                error: 'Public model card catalog is not configured.',
                catalog,
            },
            { status: 503 },
        );
    }

    return NextResponse.json({ catalog });
}
