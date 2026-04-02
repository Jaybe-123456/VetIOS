import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    createClinicOwnerLink,
    createNotificationDelivery,
    createOwnerAccount,
    createPetProfile,
    createTimelineEntry,
    getPetPassControlPlaneSnapshot,
    linkOwnerToPet,
    recordConsent,
    upsertNotificationPreference,
    type ClinicOwnerLinkStatus,
    type OwnerAccountStatus,
    type OwnerPetLinkStatus,
    type PetPassChannel,
    type PetPassConsentStatus,
    type PetPassDeliveryStatus,
    type PetPassEntryType,
    type PetPassRiskState,
    type PetPassVisibility,
} from '@/lib/petpass/service';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

type PetPassAction =
    | {
        action?: 'create_owner_account';
        full_name?: string;
        preferred_name?: string | null;
        email?: string | null;
        phone?: string | null;
        external_owner_ref?: string | null;
        status?: OwnerAccountStatus | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'create_pet_profile';
        pet_name?: string;
        species?: string | null;
        breed?: string | null;
        age_display?: string | null;
        sex?: string | null;
        risk_state?: PetPassRiskState | null;
        clinic_id?: string | null;
        clinic_name?: string | null;
        patient_id?: string | null;
        latest_case_id?: string | null;
        latest_episode_id?: string | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'link_owner_pet';
        owner_account_id?: string | null;
        pet_profile_id?: string | null;
        relationship_type?: string | null;
        primary_owner?: boolean | null;
        status?: OwnerPetLinkStatus | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'create_clinic_owner_link';
        owner_account_id?: string | null;
        clinic_name?: string | null;
        clinic_id?: string | null;
        status?: ClinicOwnerLinkStatus | null;
        invite_token?: string | null;
        invite_expires_at?: string | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'record_consent';
        owner_account_id?: string | null;
        pet_profile_id?: string | null;
        consent_type?: string | null;
        status?: PetPassConsentStatus | null;
        granted_at?: string | null;
        revoked_at?: string | null;
        expires_at?: string | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'upsert_notification_preference';
        owner_account_id?: string | null;
        pet_profile_id?: string | null;
        channel?: PetPassChannel | null;
        notification_type?: string | null;
        enabled?: boolean | null;
        quiet_hours?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'create_timeline_entry';
        owner_account_id?: string | null;
        pet_profile_id?: string | null;
        clinic_owner_link_id?: string | null;
        entry_type?: PetPassEntryType | null;
        title?: string | null;
        detail?: string | null;
        occurred_at?: string | null;
        visibility?: PetPassVisibility | null;
        source_module?: string | null;
        source_record_id?: string | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'create_notification_delivery';
        owner_account_id?: string | null;
        pet_profile_id?: string | null;
        timeline_entry_id?: string | null;
        channel?: PetPassChannel | null;
        notification_type?: string | null;
        title?: string | null;
        body?: string | null;
        delivery_status?: PetPassDeliveryStatus | null;
        scheduled_at?: string | null;
        delivered_at?: string | null;
        error_message?: string | null;
        metadata?: Record<string, unknown>;
    };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const url = new URL(req.url);
    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: url.searchParams.get('tenant_id'),
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolvePetPassAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: 'api/platform/petpass:GET',
            requirement: 'admin',
        });
    }

    const limit = normalizePositiveNumber(url.searchParams.get('limit')) ?? 24;
    const snapshot = await getPetPassControlPlaneSnapshot(adminClient, authContext.tenantId, { limit });
    const response = NextResponse.json({ snapshot, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 12, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<PetPassAction>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolvePetPassAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: `api/platform/petpass:${body.data.action ?? 'create_owner_account'}`,
            requirement: 'admin',
        });
    }

    try {
        const action = body.data.action ?? 'create_owner_account';
        let result: Record<string, unknown>;

        if (action === 'create_owner_account') {
            const ownerBody = body.data as Extract<PetPassAction, { action?: 'create_owner_account' }>;
            result = {
                owner_account: await createOwnerAccount(adminClient, {
                    tenantId: authContext.tenantId,
                    actor: authContext.userId,
                    fullName: requireText(ownerBody.full_name, 'full_name'),
                    preferredName: normalizeOptionalText(ownerBody.preferred_name),
                    email: normalizeOptionalText(ownerBody.email),
                    phone: normalizeOptionalText(ownerBody.phone),
                    externalOwnerRef: normalizeOptionalText(ownerBody.external_owner_ref),
                    status: normalizeOwnerStatus(ownerBody.status) ?? 'active',
                    metadata: asRecord(ownerBody.metadata),
                }),
            };
        } else if (action === 'create_pet_profile') {
            const petBody = body.data as Extract<PetPassAction, { action: 'create_pet_profile' }>;
            result = {
                pet_profile: await createPetProfile(adminClient, {
                    tenantId: authContext.tenantId,
                    actor: authContext.userId,
                    petName: requireText(petBody.pet_name, 'pet_name'),
                    species: normalizeOptionalText(petBody.species),
                    breed: normalizeOptionalText(petBody.breed),
                    ageDisplay: normalizeOptionalText(petBody.age_display),
                    sex: normalizeOptionalText(petBody.sex),
                    riskState: normalizeRiskState(petBody.risk_state) ?? 'stable',
                    clinicId: normalizeOptionalText(petBody.clinic_id),
                    clinicName: normalizeOptionalText(petBody.clinic_name),
                    patientId: normalizeOptionalText(petBody.patient_id),
                    latestCaseId: normalizeOptionalText(petBody.latest_case_id),
                    latestEpisodeId: normalizeOptionalText(petBody.latest_episode_id),
                    metadata: asRecord(petBody.metadata),
                }),
            };
        } else if (action === 'link_owner_pet') {
            const linkBody = body.data as Extract<PetPassAction, { action: 'link_owner_pet' }>;
            result = {
                owner_pet_link: await linkOwnerToPet(adminClient, {
                    tenantId: authContext.tenantId,
                    ownerAccountId: requireText(linkBody.owner_account_id, 'owner_account_id'),
                    petProfileId: requireText(linkBody.pet_profile_id, 'pet_profile_id'),
                    relationshipType: normalizeOptionalText(linkBody.relationship_type) ?? 'owner',
                    primaryOwner: linkBody.primary_owner ?? true,
                    status: normalizeOwnerPetStatus(linkBody.status) ?? 'active',
                    metadata: asRecord(linkBody.metadata),
                }),
            };
        } else if (action === 'create_clinic_owner_link') {
            const clinicBody = body.data as Extract<PetPassAction, { action: 'create_clinic_owner_link' }>;
            result = {
                clinic_owner_link: await createClinicOwnerLink(adminClient, {
                    tenantId: authContext.tenantId,
                    ownerAccountId: requireText(clinicBody.owner_account_id, 'owner_account_id'),
                    clinicName: requireText(clinicBody.clinic_name, 'clinic_name'),
                    clinicId: normalizeOptionalText(clinicBody.clinic_id),
                    linkedBy: authContext.userId,
                    status: normalizeClinicOwnerStatus(clinicBody.status) ?? 'active',
                    inviteToken: normalizeOptionalText(clinicBody.invite_token),
                    inviteExpiresAt: normalizeOptionalText(clinicBody.invite_expires_at),
                    metadata: asRecord(clinicBody.metadata),
                }),
            };
        } else if (action === 'record_consent') {
            const consentBody = body.data as Extract<PetPassAction, { action: 'record_consent' }>;
            result = {
                consent: await recordConsent(adminClient, {
                    tenantId: authContext.tenantId,
                    actor: authContext.userId,
                    ownerAccountId: requireText(consentBody.owner_account_id, 'owner_account_id'),
                    petProfileId: normalizeOptionalText(consentBody.pet_profile_id),
                    consentType: requireText(consentBody.consent_type, 'consent_type'),
                    status: normalizeConsentStatus(consentBody.status) ?? 'granted',
                    grantedAt: normalizeOptionalText(consentBody.granted_at),
                    revokedAt: normalizeOptionalText(consentBody.revoked_at),
                    expiresAt: normalizeOptionalText(consentBody.expires_at),
                    metadata: asRecord(consentBody.metadata),
                }),
            };
        } else if (action === 'upsert_notification_preference') {
            const preferenceBody = body.data as Extract<PetPassAction, { action: 'upsert_notification_preference' }>;
            result = {
                notification_preference: await upsertNotificationPreference(adminClient, {
                    tenantId: authContext.tenantId,
                    ownerAccountId: requireText(preferenceBody.owner_account_id, 'owner_account_id'),
                    petProfileId: normalizeOptionalText(preferenceBody.pet_profile_id),
                    channel: normalizeChannel(preferenceBody.channel) ?? 'push',
                    notificationType: requireText(preferenceBody.notification_type, 'notification_type'),
                    enabled: preferenceBody.enabled ?? true,
                    quietHours: asRecord(preferenceBody.quiet_hours),
                    metadata: asRecord(preferenceBody.metadata),
                }),
            };
        } else if (action === 'create_timeline_entry') {
            const timelineBody = body.data as Extract<PetPassAction, { action: 'create_timeline_entry' }>;
            result = {
                timeline_entry: await createTimelineEntry(adminClient, {
                    tenantId: authContext.tenantId,
                    ownerAccountId: normalizeOptionalText(timelineBody.owner_account_id),
                    petProfileId: requireText(timelineBody.pet_profile_id, 'pet_profile_id'),
                    clinicOwnerLinkId: normalizeOptionalText(timelineBody.clinic_owner_link_id),
                    entryType: normalizeEntryType(timelineBody.entry_type) ?? 'visit',
                    title: requireText(timelineBody.title, 'title'),
                    detail: requireText(timelineBody.detail, 'detail'),
                    occurredAt: normalizeOptionalText(timelineBody.occurred_at),
                    visibility: normalizeVisibility(timelineBody.visibility) ?? 'owner_safe',
                    sourceModule: normalizeOptionalText(timelineBody.source_module),
                    sourceRecordId: normalizeOptionalText(timelineBody.source_record_id),
                    metadata: asRecord(timelineBody.metadata),
                }),
            };
        } else if (action === 'create_notification_delivery') {
            const deliveryBody = body.data as Extract<PetPassAction, { action: 'create_notification_delivery' }>;
            result = {
                notification_delivery: await createNotificationDelivery(adminClient, {
                    tenantId: authContext.tenantId,
                    ownerAccountId: requireText(deliveryBody.owner_account_id, 'owner_account_id'),
                    petProfileId: normalizeOptionalText(deliveryBody.pet_profile_id),
                    timelineEntryId: normalizeOptionalText(deliveryBody.timeline_entry_id),
                    channel: normalizeChannel(deliveryBody.channel) ?? 'push',
                    notificationType: requireText(deliveryBody.notification_type, 'notification_type'),
                    title: requireText(deliveryBody.title, 'title'),
                    body: requireText(deliveryBody.body, 'body'),
                    deliveryStatus: normalizeDeliveryStatus(deliveryBody.delivery_status) ?? 'queued',
                    scheduledAt: normalizeOptionalText(deliveryBody.scheduled_at),
                    deliveredAt: normalizeOptionalText(deliveryBody.delivered_at),
                    errorMessage: normalizeOptionalText(deliveryBody.error_message),
                    metadata: asRecord(deliveryBody.metadata),
                }),
            };
        } else {
            return NextResponse.json({ error: 'Unsupported PetPass action.', request_id: requestId }, { status: 400 });
        }

        const response = NextResponse.json({
            ...result,
            snapshot: await getPetPassControlPlaneSnapshot(adminClient, authContext.tenantId, { limit: 24 }),
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'PetPass action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolvePetPassAuthorizationContext(
    actor: Awaited<ReturnType<typeof resolveExperimentApiActor>>,
): Promise<RouteAuthorizationContext> {
    if (actor?.authMode === 'internal_token') {
        return buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'internal_token',
            user: null,
        });
    }

    const session = await resolveSessionTenant();
    if (session) {
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId: session.tenantId,
            userId: session.userId,
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

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireText(value: unknown, field: string): string {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        throw new Error(`${field} is required.`);
    }
    return normalized;
}

function normalizePositiveNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    }
    return null;
}

function normalizeOwnerStatus(value: unknown): OwnerAccountStatus | null {
    return value === 'invited' || value === 'active' || value === 'inactive' ? value : null;
}

function normalizeOwnerPetStatus(value: unknown): OwnerPetLinkStatus | null {
    return value === 'invited' || value === 'active' || value === 'inactive' ? value : null;
}

function normalizeClinicOwnerStatus(value: unknown): ClinicOwnerLinkStatus | null {
    return value === 'invited' || value === 'active' || value === 'paused' || value === 'revoked' ? value : null;
}

function normalizeConsentStatus(value: unknown): PetPassConsentStatus | null {
    return value === 'pending' || value === 'granted' || value === 'revoked' ? value : null;
}

function normalizeRiskState(value: unknown): PetPassRiskState | null {
    return value === 'stable' || value === 'watch' || value === 'urgent' ? value : null;
}

function normalizeChannel(value: unknown): PetPassChannel | null {
    return value === 'sms' || value === 'email' || value === 'push' ? value : null;
}

function normalizeEntryType(value: unknown): PetPassEntryType | null {
    return value === 'visit' || value === 'result' || value === 'medication' || value === 'alert' || value === 'message' || value === 'referral'
        ? value
        : null;
}

function normalizeVisibility(value: unknown): PetPassVisibility | null {
    return value === 'owner_safe' || value === 'internal' ? value : null;
}

function normalizeDeliveryStatus(value: unknown): PetPassDeliveryStatus | null {
    return value === 'queued' || value === 'sent' || value === 'failed' || value === 'canceled' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
