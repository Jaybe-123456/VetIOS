import type { NextRequest } from 'next/server';
import { POST as internalInferencePost } from '@/app/api/inference/route';
import { runPartnerV1Route } from '@/lib/api/v1-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    return runPartnerV1Route(request, {
        endpoint: '/v1/inference/differential',
        aggregateType: 'inference',
        handler: async (_auth, req) => internalInferencePost(req),
    });
}
