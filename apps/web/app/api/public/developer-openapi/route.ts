import { NextResponse } from 'next/server';
import { getDeveloperOpenApiDocument } from '@/lib/platform/developerContract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const response = NextResponse.json(getDeveloperOpenApiDocument(baseUrl));

    response.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    response.headers.set('API-Version', '1.0.0');

    return response;
}
