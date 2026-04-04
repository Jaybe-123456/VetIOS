import type { NextRequest } from 'next/server';
import { POST as internalOutcomePost } from '@/app/api/outcome/route';
import { runPartnerV1Route } from '@/lib/api/v1-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    return runPartnerV1Route(request, {
        endpoint: '/v1/outcomes/contribute',
        aggregateType: 'outcome_contribution',
        handler: async (_auth, req) => internalOutcomePost(req),
    });
}
