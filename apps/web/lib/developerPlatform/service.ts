import type { SupabaseClient } from '@supabase/supabase-js';
import {
    createServiceAccountWithCredential,
    listServiceAccounts,
    type ApiCredentialRecord,
    type MachineCredentialScope,
    type ServiceAccountRecord,
} from '@/lib/auth/machineAuth';
import {
    PARTNER_API_PRODUCTS,
    PARTNER_ONBOARDING_REQUESTS,
    PARTNER_ORGANIZATIONS,
    PARTNER_SERVICE_ACCOUNT_LINKS,
} from '@/lib/db/schemaContracts';
import { developerEndpoints, type DeveloperEndpointDefinition } from '@/lib/platform/developerCatalog';
import { resolvePublicCatalogTenant, type PublicCatalogSource } from '@/lib/platform/publicTenant';
import { getSupabaseServer } from '@/lib/supabaseServer';

export type PartnerOrganizationStatus = 'prospect' | 'active' | 'suspended';
export type PartnerTier = 'sandbox' | 'production' | 'strategic';
export type PartnerApiProductStatus = 'draft' | 'published' | 'retired';
export type PartnerAccessTier = 'sandbox' | 'production' | 'strategic';
export type PartnerOnboardingStatus = 'requested' | 'reviewing' | 'approved' | 'rejected';
export type PartnerEnvironment = 'sandbox' | 'production';

export interface PartnerOrganizationRecord {
    id: string;
    tenant_id: string;
    legal_name: string;
    display_name: string;
    website_url: string | null;
    contact_name: string | null;
    contact_email: string | null;
    status: PartnerOrganizationStatus;
    partner_tier: PartnerTier;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface PartnerApiProductRecord {
    id: string;
    tenant_id: string;
    product_key: string;
    title: string;
    summary: string;
    access_tier: PartnerAccessTier;
    status: PartnerApiProductStatus;
    documentation_url: string | null;
    default_scopes: MachineCredentialScope[];
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface PartnerOnboardingRequestRecord {
    id: string;
    tenant_id: string;
    partner_organization_id: string | null;
    company_name: string;
    contact_name: string;
    contact_email: string;
    use_case: string;
    requested_products: string[];
    requested_scopes: MachineCredentialScope[];
    status: PartnerOnboardingStatus;
    notes: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface PartnerServiceAccountLinkRecord {
    id: string;
    tenant_id: string;
    partner_organization_id: string;
    service_account_id: string;
    onboarding_request_id: string | null;
    environment: PartnerEnvironment;
    created_by: string | null;
    created_at: string;
}

export interface DeveloperPlatformSnapshot {
    tenant_id: string;
    partners: PartnerOrganizationRecord[];
    api_products: PartnerApiProductRecord[];
    onboarding_requests: PartnerOnboardingRequestRecord[];
    partner_service_account_links: PartnerServiceAccountLinkRecord[];
    service_accounts: ServiceAccountRecord[];
    summary: {
        active_partners: number;
        sandbox_partners: number;
        published_products: number;
        pending_requests: number;
        approved_requests: number;
        provisioned_service_accounts: number;
    };
    refreshed_at: string;
}

export interface PublicDeveloperPlatformSnapshot {
    configured: boolean;
    source: PublicCatalogSource;
    tenant_id: string | null;
    endpoints: DeveloperEndpointDefinition[];
    api_products: PartnerApiProductRecord[];
    summary: {
        published_products: number;
        active_partners: number;
        sandbox_partners: number;
        pending_requests: number;
    };
    refreshed_at: string | null;
}

export async function getDeveloperPlatformSnapshot(
    client: SupabaseClient,
    tenantId: string,
    options: { limit?: number } = {},
): Promise<DeveloperPlatformSnapshot> {
    const limit = options.limit ?? 24;
    const [partners, apiProducts, onboardingRequests, partnerLinks, serviceAccounts] = await Promise.all([
        listPartnerOrganizations(client, tenantId, limit),
        listPartnerApiProducts(client, tenantId, limit),
        listPartnerOnboardingRequests(client, tenantId, limit),
        listPartnerServiceAccountLinks(client, tenantId, limit),
        listServiceAccounts(client, tenantId),
    ]);

    return {
        tenant_id: tenantId,
        partners,
        api_products: apiProducts,
        onboarding_requests: onboardingRequests,
        partner_service_account_links: partnerLinks,
        service_accounts: serviceAccounts,
        summary: {
            active_partners: partners.filter((partner) => partner.status === 'active').length,
            sandbox_partners: partners.filter((partner) => partner.partner_tier === 'sandbox').length,
            published_products: apiProducts.filter((product) => product.status === 'published').length,
            pending_requests: onboardingRequests.filter((request) => request.status === 'requested' || request.status === 'reviewing').length,
            approved_requests: onboardingRequests.filter((request) => request.status === 'approved').length,
            provisioned_service_accounts: partnerLinks.length,
        },
        refreshed_at: new Date().toISOString(),
    };
}

export async function getPublicDeveloperPlatformSnapshot(): Promise<PublicDeveloperPlatformSnapshot> {
    const target = await resolvePublicCatalogTenant();
    if (!target.tenantId) {
        return {
            configured: false,
            source: target.source,
            tenant_id: null,
            endpoints: developerEndpoints,
            api_products: [],
            summary: {
                published_products: 0,
                active_partners: 0,
                sandbox_partners: 0,
                pending_requests: 0,
            },
            refreshed_at: null,
        };
    }

    try {
        const snapshot = await getDeveloperPlatformSnapshot(getSupabaseServer(), target.tenantId, { limit: 24 });
        return {
            configured: true,
            source: target.source,
            tenant_id: target.tenantId,
            endpoints: developerEndpoints,
            api_products: snapshot.api_products.filter((product) => product.status === 'published'),
            summary: {
                published_products: snapshot.summary.published_products,
                active_partners: snapshot.summary.active_partners,
                sandbox_partners: snapshot.summary.sandbox_partners,
                pending_requests: snapshot.summary.pending_requests,
            },
            refreshed_at: snapshot.refreshed_at,
        };
    } catch {
        return {
            configured: true,
            source: target.source,
            tenant_id: target.tenantId,
            endpoints: developerEndpoints,
            api_products: [],
            summary: {
                published_products: 0,
                active_partners: 0,
                sandbox_partners: 0,
                pending_requests: 0,
            },
            refreshed_at: new Date().toISOString(),
        };
    }
}

export async function createPartnerOrganization(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        legalName: string;
        displayName: string;
        websiteUrl?: string | null;
        contactName?: string | null;
        contactEmail?: string | null;
        status?: PartnerOrganizationStatus;
        partnerTier?: PartnerTier;
        metadata?: Record<string, unknown>;
    },
): Promise<PartnerOrganizationRecord> {
    const C = PARTNER_ORGANIZATIONS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_ORGANIZATIONS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.legal_name]: requireText(input.legalName, 'legal_name'),
            [C.display_name]: requireText(input.displayName, 'display_name'),
            [C.website_url]: normalizeOptionalText(input.websiteUrl),
            [C.contact_name]: normalizeOptionalText(input.contactName),
            [C.contact_email]: normalizeOptionalText(input.contactEmail),
            [C.status]: input.status ?? 'prospect',
            [C.partner_tier]: input.partnerTier ?? 'sandbox',
            [C.metadata]: input.metadata ?? {},
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create partner organization: ${error?.message ?? 'Unknown error'}`);
    }

    return mapPartnerOrganization(asRecord(data));
}

export async function createPartnerApiProduct(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        productKey: string;
        title: string;
        summary: string;
        accessTier?: PartnerAccessTier;
        status?: PartnerApiProductStatus;
        documentationUrl?: string | null;
        defaultScopes?: readonly string[];
        metadata?: Record<string, unknown>;
    },
): Promise<PartnerApiProductRecord> {
    const C = PARTNER_API_PRODUCTS.COLUMNS;
    const payload = {
        [C.tenant_id]: input.tenantId,
        [C.product_key]: requireText(input.productKey, 'product_key'),
        [C.title]: requireText(input.title, 'title'),
        [C.summary]: requireText(input.summary, 'summary'),
        [C.access_tier]: input.accessTier ?? 'sandbox',
        [C.status]: input.status ?? 'draft',
        [C.documentation_url]: normalizeOptionalText(input.documentationUrl),
        [C.default_scopes]: normalizeScopes(input.defaultScopes),
        [C.metadata]: input.metadata ?? {},
        [C.created_by]: input.actor,
    };

    const { data, error } = await client
        .from(PARTNER_API_PRODUCTS.TABLE)
        .upsert(payload, {
            onConflict: `${C.tenant_id},${C.product_key}`,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create API product: ${error?.message ?? 'Unknown error'}`);
    }

    return mapPartnerApiProduct(asRecord(data));
}

export async function submitPartnerOnboardingRequest(
    client: SupabaseClient,
    input: {
        tenantId: string;
        companyName: string;
        contactName: string;
        contactEmail: string;
        useCase: string;
        requestedProducts?: readonly string[];
        requestedScopes?: readonly string[];
        partnerOrganizationId?: string | null;
        notes?: string | null;
    },
): Promise<PartnerOnboardingRequestRecord> {
    const C = PARTNER_ONBOARDING_REQUESTS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_ONBOARDING_REQUESTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.partner_organization_id]: normalizeOptionalText(input.partnerOrganizationId),
            [C.company_name]: requireText(input.companyName, 'company_name'),
            [C.contact_name]: requireText(input.contactName, 'contact_name'),
            [C.contact_email]: requireText(input.contactEmail, 'contact_email'),
            [C.use_case]: requireText(input.useCase, 'use_case'),
            [C.requested_products]: normalizeStringArray(input.requestedProducts),
            [C.requested_scopes]: normalizeScopes(input.requestedScopes),
            [C.status]: 'requested',
            [C.notes]: normalizeOptionalText(input.notes),
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to submit onboarding request: ${error?.message ?? 'Unknown error'}`);
    }

    return mapPartnerOnboardingRequest(asRecord(data));
}

export async function linkPartnerServiceAccount(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        partnerOrganizationId: string;
        serviceAccountId: string;
        onboardingRequestId?: string | null;
        environment?: PartnerEnvironment;
    },
): Promise<PartnerServiceAccountLinkRecord> {
    const C = PARTNER_SERVICE_ACCOUNT_LINKS.COLUMNS;
    const payload = {
        [C.tenant_id]: input.tenantId,
        [C.partner_organization_id]: input.partnerOrganizationId,
        [C.service_account_id]: input.serviceAccountId,
        [C.onboarding_request_id]: normalizeOptionalText(input.onboardingRequestId),
        [C.environment]: input.environment ?? 'sandbox',
        [C.created_by]: input.actor,
    };

    const { data, error } = await client
        .from(PARTNER_SERVICE_ACCOUNT_LINKS.TABLE)
        .upsert(payload, {
            onConflict: `${C.tenant_id},${C.partner_organization_id},${C.service_account_id},${C.environment}`,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to link partner service account: ${error?.message ?? 'Unknown error'}`);
    }

    return mapPartnerServiceAccountLink(asRecord(data));
}

export async function approvePartnerOnboardingRequest(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        requestId: string;
        notes?: string | null;
        partnerTier?: PartnerTier;
        environment?: PartnerEnvironment;
        serviceAccountLabel?: string | null;
        scopes?: readonly string[];
    },
): Promise<{
        request: PartnerOnboardingRequestRecord;
        partner: PartnerOrganizationRecord;
        serviceAccount: ServiceAccountRecord;
        credential: ApiCredentialRecord;
        apiKey: string;
        link: PartnerServiceAccountLinkRecord;
    }> {
    const request = await getPartnerOnboardingRequest(client, input.tenantId, input.requestId);
    const partner = request.partner_organization_id
        ? await getPartnerOrganization(client, input.tenantId, request.partner_organization_id)
        : await createPartnerOrganization(client, {
            tenantId: input.tenantId,
            actor: input.actor,
            legalName: request.company_name,
            displayName: request.company_name,
            contactName: request.contact_name,
            contactEmail: request.contact_email,
            status: 'active',
            partnerTier: input.partnerTier ?? 'sandbox',
            metadata: {
                onboarding_request_id: request.id,
            },
        });

    const issued = await createServiceAccountWithCredential({
        client,
        tenantId: input.tenantId,
        actor: input.actor,
        name: `${partner.display_name} API`,
        description: `Partner service account for ${partner.display_name}`,
        label: normalizeOptionalText(input.serviceAccountLabel) ?? `${partner.display_name} ${input.environment ?? 'sandbox'} key`,
        scopes: normalizeScopes(input.scopes?.length ? input.scopes : request.requested_scopes),
        metadata: {
            partner_organization_id: partner.id,
            onboarding_request_id: request.id,
            environment: input.environment ?? 'sandbox',
        },
    });

    const link = await linkPartnerServiceAccount(client, {
        tenantId: input.tenantId,
        actor: input.actor,
        partnerOrganizationId: partner.id,
        serviceAccountId: issued.serviceAccount.id,
        onboardingRequestId: request.id,
        environment: input.environment ?? 'sandbox',
    });

    const C = PARTNER_ONBOARDING_REQUESTS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_ONBOARDING_REQUESTS.TABLE)
        .update({
            [C.partner_organization_id]: partner.id,
            [C.status]: 'approved',
            [C.notes]: normalizeOptionalText(input.notes) ?? request.notes,
            [C.reviewed_by]: input.actor,
            [C.reviewed_at]: new Date().toISOString(),
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, request.id)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to approve onboarding request: ${error?.message ?? 'Unknown error'}`);
    }

    return {
        request: mapPartnerOnboardingRequest(asRecord(data)),
        partner,
        serviceAccount: issued.serviceAccount,
        credential: issued.credential,
        apiKey: issued.apiKey,
        link,
    };
}

async function listPartnerOrganizations(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PartnerOrganizationRecord[]> {
    const C = PARTNER_ORGANIZATIONS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_ORGANIZATIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list partner organizations: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPartnerOrganization(asRecord(row)));
}

async function listPartnerApiProducts(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PartnerApiProductRecord[]> {
    const C = PARTNER_API_PRODUCTS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_API_PRODUCTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list partner API products: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPartnerApiProduct(asRecord(row)));
}

async function listPartnerOnboardingRequests(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PartnerOnboardingRequestRecord[]> {
    const C = PARTNER_ONBOARDING_REQUESTS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_ONBOARDING_REQUESTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list partner onboarding requests: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPartnerOnboardingRequest(asRecord(row)));
}

async function listPartnerServiceAccountLinks(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PartnerServiceAccountLinkRecord[]> {
    const C = PARTNER_SERVICE_ACCOUNT_LINKS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_SERVICE_ACCOUNT_LINKS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list partner service-account links: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPartnerServiceAccountLink(asRecord(row)));
}

async function getPartnerOnboardingRequest(
    client: SupabaseClient,
    tenantId: string,
    requestId: string,
): Promise<PartnerOnboardingRequestRecord> {
    const C = PARTNER_ONBOARDING_REQUESTS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_ONBOARDING_REQUESTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, requestId)
        .single();

    if (error || !data) {
        throw new Error(`Failed to load onboarding request: ${error?.message ?? 'Unknown error'}`);
    }

    return mapPartnerOnboardingRequest(asRecord(data));
}

async function getPartnerOrganization(
    client: SupabaseClient,
    tenantId: string,
    partnerOrganizationId: string,
): Promise<PartnerOrganizationRecord> {
    const C = PARTNER_ORGANIZATIONS.COLUMNS;
    const { data, error } = await client
        .from(PARTNER_ORGANIZATIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, partnerOrganizationId)
        .single();

    if (error || !data) {
        throw new Error(`Failed to load partner organization: ${error?.message ?? 'Unknown error'}`);
    }

    return mapPartnerOrganization(asRecord(data));
}

function mapPartnerOrganization(row: Record<string, unknown>): PartnerOrganizationRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        legal_name: readString(row.legal_name) ?? 'Unknown partner',
        display_name: readString(row.display_name) ?? 'Unknown partner',
        website_url: readString(row.website_url),
        contact_name: readString(row.contact_name),
        contact_email: readString(row.contact_email),
        status: (readString(row.status) ?? 'prospect') as PartnerOrganizationStatus,
        partner_tier: (readString(row.partner_tier) ?? 'sandbox') as PartnerTier,
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapPartnerApiProduct(row: Record<string, unknown>): PartnerApiProductRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        product_key: readString(row.product_key) ?? 'unknown_product',
        title: readString(row.title) ?? 'Untitled product',
        summary: readString(row.summary) ?? '',
        access_tier: (readString(row.access_tier) ?? 'sandbox') as PartnerAccessTier,
        status: (readString(row.status) ?? 'draft') as PartnerApiProductStatus,
        documentation_url: readString(row.documentation_url),
        default_scopes: normalizeScopes(readStringArray(row.default_scopes)),
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapPartnerOnboardingRequest(row: Record<string, unknown>): PartnerOnboardingRequestRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        partner_organization_id: readString(row.partner_organization_id),
        company_name: readString(row.company_name) ?? 'Unknown company',
        contact_name: readString(row.contact_name) ?? 'Unknown contact',
        contact_email: readString(row.contact_email) ?? 'unknown@example.com',
        use_case: readString(row.use_case) ?? '',
        requested_products: readStringArray(row.requested_products),
        requested_scopes: normalizeScopes(readStringArray(row.requested_scopes)),
        status: (readString(row.status) ?? 'requested') as PartnerOnboardingStatus,
        notes: readString(row.notes),
        reviewed_by: readString(row.reviewed_by),
        reviewed_at: readString(row.reviewed_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapPartnerServiceAccountLink(row: Record<string, unknown>): PartnerServiceAccountLinkRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        partner_organization_id: readString(row.partner_organization_id) ?? 'unknown_partner',
        service_account_id: readString(row.service_account_id) ?? 'unknown_service_account',
        onboarding_request_id: readString(row.onboarding_request_id),
        environment: (readString(row.environment) ?? 'sandbox') as PartnerEnvironment,
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
    };
}

function normalizeScopes(input: readonly string[] | undefined): MachineCredentialScope[] {
    const values = Array.isArray(input) ? input : [];
    const allowed = new Set<MachineCredentialScope>([
        'inference:write',
        'outcome:write',
        'simulation:write',
        'evaluation:write',
        'evaluation:read',
        'signals:ingest',
        'signals:connect',
        'signals:read',
        'machine:manage',
    ]);

    const normalized = values
        .map((value) => value.trim())
        .filter((value): value is MachineCredentialScope => allowed.has(value as MachineCredentialScope));

    return normalized.length > 0 ? Array.from(new Set(normalized)) : ['inference:write'];
}

function normalizeStringArray(input: readonly string[] | undefined): string[] {
    return Array.isArray(input)
        ? input.map((value) => value.trim()).filter((value) => value.length > 0)
        : [];
}

function requireText(value: string | null | undefined, field: string): string {
    if (!value || value.trim().length === 0) {
        throw new Error(`${field} is required.`);
    }
    return value.trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
        : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
