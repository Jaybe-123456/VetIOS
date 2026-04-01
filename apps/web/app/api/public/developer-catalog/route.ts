import { NextResponse } from 'next/server';
import { developerEndpoints } from '@/lib/platform/developerCatalog';

export const runtime = 'nodejs';

export async function GET() {
    return NextResponse.json({
        generated_at: new Date().toISOString(),
        endpoints: developerEndpoints,
    });
}
