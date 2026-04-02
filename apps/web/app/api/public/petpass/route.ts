import { NextResponse } from 'next/server';
import { getPublicPetPassSnapshot } from '@/lib/petpass/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const snapshot = await getPublicPetPassSnapshot();
    if (!snapshot.configured) {
        return NextResponse.json(
            {
                error: 'Public PetPass snapshot is not configured.',
                snapshot,
            },
            { status: 503 },
        );
    }

    return NextResponse.json({ snapshot });
}
