import { NextResponse } from 'next/server';
import { buildForbiddenRouteResponse, buildRouteAuthorizationContext } from '@/lib/auth/authorization';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import {
    approvePartnerOnboardingRequest,
    createPartnerApiProduct,
    createPartnerOrganization,
    getDeveloperPlatformSnapshot,
    submitPartnerOnboardingRequest,
} from '@/lib/developerPlatform/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DeveloperPlatformAction =
    | {
        action: 'create_partner_organization';
        legal_name?: string;
        display_name?: string;
        website_url?: string | null;
        contact_name?: string | null;
        contact_email?: string | null;
        partner_tier?: 'sandbox' | 'production' | 'strategic';
    }
    | {
        action: 'create_api_product';
        product_key?: string;
        title?: string;
        summary?: string;
        access_tier?: 'sandbox' | 'production' | 'strategic';
        status?: 'draft' | 'published' | 'retired';
        documentation_url?: string | null;
        default_scopes?: string[];
    }
    | {
        action: 'submit_onboarding_request';
        company_name?: string;
        contact_name?: string;
        contact_email?: string;
        use_case?: string;
        requested_products?: string[];
        requested_scopes?: string[];
    }
    | {
        action: 'approve_onboarding_request';
        request_id?: string;
        notes?: string | null;
        partner_tier?: 'sandbox' | 'production' | 'strategic';
        environment?: 'sandbox' | 'production';
        service_account_label?: string | null;
        scopes?: string[];
    };

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const client = getSupabaseServer();
    const context = await resolveAdminContext(session);
    if (context.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: 'api/platform/developer-platform:GET',
            requirement: 'admin',
        });
    }

    const snapshot = await getDeveloperPlatformSnapshot(client, context.tenantId);
    const response = NextResponse.json({ snapshot, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const parsed = await safeJson<DeveloperPlatformAction>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const client = getSupabaseServer();
    const context = await resolveAdminContext(session);
    if (context.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: `api/platform/developer-platform:${parsed.data.action ?? 'unknown'}`,
            requirement: 'admin',
        });
    }

    try {
        let result: Record<string, unknown> = {};
        if (parsed.data.action === 'create_partner_organization') {
            result.partner_organization = await createPartnerOrganization(client, {
                tenantId: context.tenantId,
                actor: context.userId,
                legalName: parsed.data.legal_name ?? '',
                displayName: parsed.data.display_name ?? '',
                websiteUrl: parsed.data.website_url ?? null,
                contactName: parsed.data.contact_name ?? null,
                contactEmail: parsed.data.contact_email ?? null,
                partnerTier: parsed.data.partner_tier ?? 'sandbox',
                status: 'prospect',
            });
        } else if (parsed.data.action === 'create_api_product') {
            result.api_product = await createPartnerApiProduct(client, {
                tenantId: context.tenantId,
                actor: context.userId,
                productKey: parsed.data.product_key ?? '',
                title: parsed.data.title ?? '',
                summary: parsed.data.summary ?? '',
                accessTier: parsed.data.access_tier ?? 'sandbox',
                status: parsed.data.status ?? 'published',
                documentationUrl: parsed.data.documentation_url ?? null,
                defaultScopes: parsed.data.default_scopes ?? [],
            });
        } else if (parsed.data.action === 'submit_onboarding_request') {
            result.onboarding_request = await submitPartnerOnboardingRequest(client, {
                tenantId: context.tenantId,
                companyName: parsed.data.company_name ?? '',
                contactName: parsed.data.contact_name ?? '',
                contactEmail: parsed.data.contact_email ?? '',
                useCase: parsed.data.use_case ?? '',
                requestedProducts: parsed.data.requested_products ?? [],
                requestedScopes: parsed.data.requested_scopes ?? [],
            });
        } else if (parsed.data.action === 'approve_onboarding_request') {
            const approved = await approvePartnerOnboardingRequest(client, {
                tenantId: context.tenantId,
                actor: context.userId,
                requestId: parsed.data.request_id ?? '',
                notes: parsed.data.notes ?? null,
                partnerTier: parsed.data.partner_tier ?? 'sandbox',
                environment: parsed.data.environment ?? 'sandbox',
                serviceAccountLabel: parsed.data.service_account_label ?? null,
                scopes: parsed.data.scopes ?? [],
            });

            result = {
                onboarding_request: approved.request,
                partner_organization: approved.partner,
                service_account: approved.serviceAccount,
                api_credential: approved.credential,
                generated_api_key: approved.apiKey,
                partner_service_account_link: approved.link,
            };
        } else {
            return NextResponse.json({ error: 'Unsupported developer-platform action.', request_id: requestId }, { status: 400 });
        }

        const snapshot = await getDeveloperPlatformSnapshot(client, context.tenantId);
        const response = NextResponse.json({ ...result, snapshot, request_id: requestId });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Developer-platform action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolveAdminContext(session: Awaited<ReturnType<typeof resolveSessionTenant>>) {
    if (session) {
        const actor = resolveRequestActor(session);
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'session',
            user,
        });
    }

    return buildRouteAuthorizationContext({
        tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        userId: process.env.VETIOS_DEV_USER_ID ?? null,
        authMode: process.env.VETIOS_DEV_BYPASS === 'true' ? 'dev_bypass' : 'session',
        user: null,
    });
}
