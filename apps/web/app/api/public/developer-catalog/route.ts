import { NextResponse } from 'next/server';
import { getDeveloperPlatformSnapshot, getPublicDeveloperPlatformSnapshot, submitPartnerOnboardingRequest } from '@/lib/developerPlatform/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { requirePublicPlatformDetailAccess } from '@/lib/platform/publicAccess';
import { resolvePublicCatalogTenant } from '@/lib/platform/publicTenant';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PublicDeveloperOnboardingPayload = {
    company_name?: string;
    contact_name?: string;
    contact_email?: string;
    use_case?: string;
    requested_products?: string[];
    requested_scopes?: string[];
};

export async function GET(req: Request) {
    const blocked = requirePublicPlatformDetailAccess(req);
    if (blocked) return blocked;

    const snapshot = await getPublicDeveloperPlatformSnapshot();
    return NextResponse.json({
        generated_at: new Date().toISOString(),
        endpoints: snapshot.endpoints,
        api_products: snapshot.api_products,
        snapshot,
    });
}

export async function POST(req: Request) {
    const blocked = requirePublicPlatformDetailAccess(req);
    if (blocked) return blocked;

    const guard = await apiGuard(req, { maxRequests: 6, windowMs: 3_600_000 });
    if (guard.blocked) return guard.response!;

    const parsed = await safeJson<PublicDeveloperOnboardingPayload>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const target = await resolvePublicCatalogTenant();
    if (!target.tenantId) {
        return NextResponse.json({ error: 'Public developer onboarding is not configured.' }, { status: 503 });
    }

    const client = getSupabaseServer();
    try {
        const onboardingRequest = await submitPartnerOnboardingRequest(client, {
            tenantId: target.tenantId,
            companyName: parsed.data.company_name ?? '',
            contactName: parsed.data.contact_name ?? '',
            contactEmail: parsed.data.contact_email ?? '',
            useCase: parsed.data.use_case ?? '',
            requestedProducts: parsed.data.requested_products ?? [],
            requestedScopes: parsed.data.requested_scopes ?? [],
        });
        const snapshot = await getDeveloperPlatformSnapshot(client, target.tenantId);

        return NextResponse.json({
            onboarding_request: onboardingRequest,
            snapshot,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unable to submit onboarding request.' },
            { status: 400 },
        );
    }
}
