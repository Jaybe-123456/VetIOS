import { NextResponse, type NextRequest } from 'next/server';
import { authenticatePartnerRequest, buildPartnerAuthFailureResponse } from '@/lib/api/auth-middleware';
import { recordUsageEvent } from '@/lib/api/usage-recorder';
import { applyVersionHeaders } from '@/lib/api/versioning';
import type { ApiCredential, ApiPartner, PartnerPlan } from '@/lib/api/types';

interface PartnerRouteAuth {
    partner: ApiPartner;
    credential: ApiCredential;
    plan: PartnerPlan;
    quotaHeaders: Record<string, string>;
}

interface PartnerV1RouteOptions {
    endpoint: string;
    aggregateType?: string;
    isBillable?: boolean;
    handler: (context: PartnerRouteAuth, request: NextRequest) => Promise<Response>;
}

export async function runPartnerV1Route(
    request: NextRequest,
    options: PartnerV1RouteOptions,
): Promise<Response> {
    const startedAt = Date.now();
    const auth = await authenticatePartnerRequest(request);
    if (!auth.success || !auth.partner || !auth.credential || !auth.plan) {
        const failure = buildPartnerAuthFailureResponse(auth);
        applyVersionHeaders(failure.headers, { quotaHeaders: auth.quotaHeaders });
        return failure;
    }

    const response = await options.handler({
        partner: auth.partner,
        credential: auth.credential,
        plan: auth.plan,
        quotaHeaders: auth.quotaHeaders ?? {},
    }, request);

    const finalResponse = response instanceof NextResponse
        ? response
        : new NextResponse(response.body, {
            status: response.status,
            headers: response.headers,
        });

    applyVersionHeaders(finalResponse.headers, { quotaHeaders: auth.quotaHeaders });

    void recordUsageEvent({
        partnerId: auth.partner.id,
        credentialId: auth.credential.id,
        endpoint: options.endpoint,
        method: request.method,
        statusCode: finalResponse.status,
        responseTimeMs: Date.now() - startedAt,
        requestSizeBytes: readLength(request.headers.get('content-length')),
        responseSizeBytes: readLength(finalResponse.headers.get('content-length')),
        aggregateType: options.aggregateType,
        isBillable: options.isBillable ?? true,
    });

    return finalResponse;
}

function readLength(value: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
