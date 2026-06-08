import { getDeveloperOpenApiYaml } from '@/lib/platform/developerContract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    return new Response(getDeveloperOpenApiYaml(baseUrl), {
        headers: {
            'Content-Type': 'application/yaml; charset=utf-8',
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
            'API-Version': '1.0.0',
        },
    });
}
