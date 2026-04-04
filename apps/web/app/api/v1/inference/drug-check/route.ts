import type { NextRequest } from 'next/server';
import { POST as internalTreatmentRecommendPost } from '@/app/api/treatment/recommend/route';
import { runPartnerV1Route } from '@/lib/api/v1-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    return runPartnerV1Route(request, {
        endpoint: '/v1/inference/drug-check',
        aggregateType: 'treatment_recommendation',
        handler: async (_auth, req) => internalTreatmentRecommendPost(req),
    });
}
